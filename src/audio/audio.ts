/**
 * Every sound in uBomber is synthesized live with the Web Audio API — no
 * recordings, no sample libraries, nothing to license and nothing to download.
 *
 * Three buses (sfx / ambient / music), stereo panning derived from a tile's
 * position on the board, a per-map ambient bed built from filtered noise, and a
 * generative music layer driven by the map's scale, tempo and brightness.
 */

import type { AmbientBed, MapTheme } from '../render/theme';

export type SfxName =
  | 'menu-move'
  | 'menu-accept'
  | 'menu-back'
  | 'match-start'
  | 'bomb-place'
  | 'explosion'
  | 'crate-break'
  | 'pickup'
  | 'death'
  | 'respawn'
  | 'hurry'
  | 'wall-slam'
  | 'victory'
  | 'draw';

export type MusicMood = 'title' | 'lobby' | 'battle' | null;

export interface Volumes {
  sfx: number;
  ambient: number;
  music: number;
}

const DEFAULT_VOLUMES: Volumes = { sfx: 0.8, ambient: 0.5, music: 0.35 };
const STORAGE_KEY = 'ubomber.volumes';

function loadVolumes(): Volumes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOLUMES };
    const parsed = JSON.parse(raw) as Partial<Volumes>;
    return {
      sfx: clamp01(parsed.sfx ?? DEFAULT_VOLUMES.sfx),
      ambient: clamp01(parsed.ambient ?? DEFAULT_VOLUMES.ambient),
      music: clamp01(parsed.music ?? DEFAULT_VOLUMES.music),
    };
  } catch {
    return { ...DEFAULT_VOLUMES };
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const midiHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private sfxBus!: GainNode;
  private ambientBus!: GainNode;
  private musicBus!: GainNode;
  private ambientNodes: AudioNode[] = [];
  private musicTimer: number | null = null;
  private theme: MapTheme | null = null;
  private mood: MusicMood = null;
  private noise: AudioBuffer | null = null;

  volumes: Volumes = loadVolumes();

  /** Half-width of the board in tile units, for the pan model. */
  private panHalfWidth = 7.5;

  /** Web Audio may only start from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.ambientBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    for (const bus of [this.sfxBus, this.ambientBus, this.musicBus]) bus.connect(comp);
    this.applyVolumes();

    if (this.theme) this.startAmbient(this.theme);
    if (this.mood) this.setMood(this.mood, this.theme);
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  setVolumes(v: Volumes): void {
    this.volumes = { sfx: clamp01(v.sfx), ambient: clamp01(v.ambient), music: clamp01(v.music) };
    this.applyVolumes();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.volumes));
    } catch {
      // Persisting preferences is best-effort.
    }
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.ambientBus.gain.value = this.volumes.ambient;
    this.musicBus.gain.value = this.volumes.music;
  }

  setPanWidth(halfWidthTiles: number): void {
    this.panHalfWidth = Math.max(1, halfWidthTiles);
  }

  // ------------------------------------------------------------ primitives

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    if (this.noise) return this.noise;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /** Pan node for a board column, or a centred gain when position is unknown. */
  private panFor(tileX?: number): AudioNode {
    const ctx = this.ctx!;
    if (tileX === undefined) return ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.9, Math.min(0.9, (tileX - this.panHalfWidth) / this.panHalfWidth));
    return pan;
  }

  /** Filtered noise burst: the workhorse for thuds, cracks and blasts. */
  private burst(
    tileX: number | undefined,
    freq: number,
    dur: number,
    gain: number,
    type: BiquadFilterType = 'lowpass',
    q = 1,
    sweepTo?: number
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(30, sweepTo),
        ctx.currentTime + dur
      );
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter).connect(env).connect(this.panFor(tileX)).connect(this.sfxBus);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  private tone(
    tileX: number | undefined,
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    slideTo?: number,
    delay = 0
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), at + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.02, dur * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env).connect(this.panFor(tileX)).connect(this.sfxBus);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  // --------------------------------------------------------------- effects

  /** `tileX` is the board column, used for stereo placement. */
  play(name: SfxName, tileX?: number): void {
    if (!this.ctx) return;
    switch (name) {
      case 'menu-move':
        this.tone(undefined, 520, 0.05, 0.12, 'triangle');
        break;
      case 'menu-accept':
        this.tone(undefined, 660, 0.06, 0.16, 'triangle', 990);
        this.tone(undefined, 990, 0.1, 0.1, 'sine', undefined, 0.06);
        break;
      case 'menu-back':
        this.tone(undefined, 440, 0.08, 0.13, 'triangle', 260);
        break;
      case 'match-start':
        // Three-note fanfare into a low hit.
        this.tone(undefined, 523, 0.12, 0.2, 'square');
        this.tone(undefined, 659, 0.12, 0.2, 'square', undefined, 0.13);
        this.tone(undefined, 880, 0.24, 0.22, 'square', undefined, 0.26);
        this.burst(undefined, 220, 0.3, 0.3, 'lowpass', 1, 60);
        break;

      case 'bomb-place':
        // Soft set-down plus the fuse catching.
        this.burst(tileX, 380, 0.09, 0.2, 'lowpass');
        this.tone(tileX, 180, 0.1, 0.12, 'sine', 110);
        this.burst(tileX, 4200, 0.16, 0.05, 'highpass');
        break;

      case 'explosion':
        // Sub thump, mid body, bright shrapnel.
        this.tone(tileX, 120, 0.45, 0.5, 'sine', 34);
        this.burst(tileX, 900, 0.5, 0.6, 'lowpass', 1, 90);
        this.burst(tileX, 2600, 0.22, 0.24, 'bandpass', 0.8);
        this.burst(tileX, 6000, 0.12, 0.1, 'highpass');
        break;

      case 'crate-break':
        this.burst(tileX, 1500, 0.14, 0.26, 'bandpass', 1.4);
        this.tone(tileX, 260 + Math.random() * 60, 0.09, 0.14, 'square', 170);
        break;

      case 'pickup':
        // Rising arpeggio: unmistakably good news.
        this.tone(tileX, 660, 0.07, 0.16, 'triangle');
        this.tone(tileX, 880, 0.07, 0.16, 'triangle', undefined, 0.06);
        this.tone(tileX, 1320, 0.14, 0.14, 'triangle', undefined, 0.12);
        break;

      case 'death':
        this.burst(tileX, 700, 0.3, 0.34, 'lowpass', 1, 120);
        this.tone(tileX, 320, 0.34, 0.2, 'sawtooth', 70);
        break;

      case 'respawn':
        this.tone(tileX, 300, 0.18, 0.14, 'sine', 900);
        this.burst(tileX, 3000, 0.2, 0.06, 'highpass');
        break;

      case 'hurry':
        // Sudden death announcing itself.
        this.tone(undefined, 740, 0.16, 0.2, 'square');
        this.tone(undefined, 560, 0.22, 0.2, 'square', undefined, 0.18);
        break;

      case 'wall-slam':
        this.tone(tileX, 90, 0.26, 0.36, 'sine', 40);
        this.burst(tileX, 600, 0.24, 0.3, 'lowpass', 1, 100);
        break;

      case 'victory': {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => this.tone(undefined, f, 0.3, 0.2, 'square', undefined, i * 0.11));
        break;
      }

      case 'draw':
        this.tone(undefined, 400, 0.3, 0.18, 'triangle', 300);
        this.tone(undefined, 300, 0.42, 0.16, 'triangle', 220, 0.2);
        break;
    }
  }

  // --------------------------------------------------------------- ambient

  /** Per-map ambient bed: layered filtered noise, no recorded loops. */
  startAmbient(theme: MapTheme): void {
    this.theme = theme;
    if (!this.ctx) return;
    this.stopAmbient();
    const ctx = this.ctx;

    const layer = (
      freq: number,
      q: number,
      gain: number,
      type: BiquadFilterType,
      lfoRate = 0
    ): void => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const env = ctx.createGain();
      env.gain.value = gain;
      if (lfoRate > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = lfoRate;
        const depth = ctx.createGain();
        depth.gain.value = gain * 0.55;
        lfo.connect(depth).connect(env.gain);
        lfo.start();
        this.ambientNodes.push(lfo);
      }
      src.connect(filter).connect(env).connect(this.ambientBus);
      src.start();
      this.ambientNodes.push(src);
    };

    const beds: Record<AmbientBed, () => void> = {
      city: () => {
        layer(120, 1, 0.26, 'lowpass');
        layer(900, 4, 0.05, 'bandpass', 0.05);
      },
      metro: () => {
        layer(65, 1, 0.4, 'lowpass', 0.09);
        layer(480, 6, 0.06, 'bandpass');
      },
      plaza: () => {
        layer(150, 1, 0.22, 'lowpass');
        layer(1600, 3, 0.05, 'bandpass', 0.12);
      },
      boulevard: () => {
        layer(110, 1, 0.24, 'lowpass', 0.04);
        layer(700, 5, 0.05, 'bandpass', 0.07);
      },
      park: () => {
        layer(420, 1.6, 0.14, 'bandpass', 0.13);
        layer(200, 1, 0.12, 'lowpass', 0.05);
      },
      courtyard: () => {
        layer(180, 2, 0.2, 'lowpass', 0.06);
        layer(1200, 6, 0.04, 'bandpass', 0.1);
      },
      water: () => {
        layer(600, 1.5, 0.22, 'bandpass', 0.18);
        layer(190, 1, 0.18, 'lowpass', 0.11);
      },
      market: () => {
        layer(300, 2, 0.18, 'bandpass', 0.16);
        layer(140, 1, 0.16, 'lowpass', 0.05);
      },
      site: () => {
        layer(85, 1, 0.32, 'lowpass', 0.3);
        layer(1400, 8, 0.05, 'bandpass', 0.6);
      },
      archipelago: () => {
        layer(380, 2, 0.26, 'bandpass', 0.15);
        layer(140, 1, 0.2, 'lowpass', 0.08);
      },
    };

    beds[theme.ambient]();
  }

  stopAmbient(): void {
    for (const node of this.ambientNodes) {
      try {
        (node as AudioBufferSourceNode).stop?.();
      } catch {
        // Already stopped.
      }
      node.disconnect();
    }
    this.ambientNodes = [];
  }

  // ----------------------------------------------------------------- music

  /**
   * Switches the generative track. `title` and `lobby` use a neutral scale;
   * `battle` uses the map's own so each arena sounds like itself.
   */
  setMood(mood: MusicMood, theme: MapTheme | null = this.theme): void {
    this.mood = mood;
    this.theme = theme ?? this.theme;
    if (!this.ctx) return;
    this.stopMusic();
    if (!mood) return;

    const music =
      mood === 'battle' && theme
        ? theme.music
        : mood === 'lobby'
          ? { scale: [0, 3, 5, 7, 10], root: 50, tempo: 84, brightness: 0.4 }
          : { scale: [0, 2, 4, 7, 9], root: 52, tempo: 96, brightness: 0.55 };

    const ctx = this.ctx;
    const beatMs = 60000 / music.tempo;
    let step = 0;

    this.musicTimer = window.setInterval(() => {
      step++;
      const now = ctx.currentTime;

      // Sparse plucked melody drawn from the map's scale.
      if (Math.random() < 0.5) {
        const deg = music.scale[Math.floor(Math.random() * music.scale.length)];
        const octave = Math.random() < 0.28 ? 12 : 0;
        const osc = ctx.createOscillator();
        osc.type = music.brightness > 0.5 ? 'triangle' : 'sine';
        osc.frequency.value = midiHz(music.root + deg + octave + 12);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1100 + music.brightness * 2600;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.085, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + beatMs / 1000 + 0.35);
        osc.connect(filter).connect(env).connect(this.musicBus);
        osc.start(now);
        osc.stop(now + beatMs / 1000 + 0.45);
      }

      // Arcade pulse: kick on the beat, hat on the off-beat.
      const kick = ctx.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(120, now);
      kick.frequency.exponentialRampToValueAtTime(42, now + 0.11);
      const kickEnv = ctx.createGain();
      kickEnv.gain.setValueAtTime(0.16 + music.brightness * 0.1, now);
      kickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      kick.connect(kickEnv).connect(this.musicBus);
      kick.start(now);
      kick.stop(now + 0.16);

      if (step % 2 === 1) {
        const hat = ctx.createBufferSource();
        hat.buffer = this.noiseBuffer();
        hat.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 7000;
        const hatEnv = ctx.createGain();
        hatEnv.gain.setValueAtTime(0.05 * (0.5 + music.brightness), now);
        hatEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        hat.connect(hp).connect(hatEnv).connect(this.musicBus);
        hat.start(now);
        hat.stop(now + 0.07);
      }

      // Slow root pad every eight steps.
      if (step % 8 === 1) {
        for (const deg of [0, 7]) {
          const pad = ctx.createOscillator();
          pad.type = 'sine';
          pad.frequency.value = midiHz(music.root - 12 + deg);
          const env = ctx.createGain();
          const dur = (beatMs / 1000) * 7;
          env.gain.setValueAtTime(0.0001, now);
          env.gain.linearRampToValueAtTime(0.05, now + dur * 0.3);
          env.gain.linearRampToValueAtTime(0.0001, now + dur);
          pad.connect(env).connect(this.musicBus);
          pad.start(now);
          pad.stop(now + dur + 0.1);
        }
      }
    }, beatMs);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  stopAll(): void {
    this.stopAmbient();
    this.stopMusic();
    this.mood = null;
  }
}
