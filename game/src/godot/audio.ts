import { AudioStreamPlayer, Node, ResourceLoader } from 'godot';

/**
 * Runtime audio bank. All clips live in res://assets/audio/, which is
 * intentionally NOT shipped with the repository (see game/assets/audio/
 * README.md): drop in any sound pack with ops/install-sound-pack.sh and the
 * bank picks it up. Every lookup degrades to silence when a clip is absent,
 * so the game runs fine with no audio installed.
 */

const SFX_DIR = 'res://assets/audio/sfx';
const MUSIC_DIR = 'res://assets/audio/music';

export type SfxName =
  | 'menu_accept'
  | 'menu_move'
  | 'bomb_place'
  | 'explosion'
  | 'item'
  | 'death'
  | 'start'
  | 'winner';

export type MusicName = 'title' | 'lobby' | 'battle' | 'victory' | 'draw';

/** Jingles play once; everything else loops. */
const ONE_SHOT_MUSIC: MusicName[] = ['victory', 'draw'];

const SFX_POOL_SIZE = 8;
const MUSIC_DB = -8;
const SFX_DB = -4;

class AudioBankImpl {
  private pool: AudioStreamPlayer[] = [];
  private next = 0;
  private music: AudioStreamPlayer | null = null;
  private currentMusic: MusicName | null = null;
  private streams = new Map<string, unknown>();

  /** Creates the player nodes under `root`. Call once from the main scene. */
  init(root: Node): void {
    if (this.pool.length > 0) return;
    for (let i = 0; i < SFX_POOL_SIZE; i++) {
      const player = new AudioStreamPlayer();
      player.volume_db = SFX_DB;
      root.add_child(player);
      this.pool.push(player);
    }
    this.music = new AudioStreamPlayer();
    this.music.volume_db = MUSIC_DB;
    root.add_child(this.music);
  }

  playSfx(name: SfxName): void {
    const stream = this.loadStream(`${SFX_DIR}/${name}.wav`);
    if (!stream || this.pool.length === 0) return;
    const player = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    player.stream = stream;
    player.play();
  }

  playMusic(name: MusicName): void {
    if (!this.music) return;
    if (this.currentMusic === name && this.music.playing) return;
    const stream = this.loadStream(`${MUSIC_DIR}/${name}.ogg`) as {
      loop?: boolean;
    } | null;
    if (!stream) {
      this.stopMusic();
      return;
    }
    if ('loop' in stream || stream.loop !== undefined) {
      stream.loop = !ONE_SHOT_MUSIC.includes(name);
    }
    this.currentMusic = name;
    this.music.stream = stream;
    this.music.play();
  }

  stopMusic(): void {
    this.currentMusic = null;
    this.music?.stop();
  }

  private loadStream(path: string): unknown | null {
    if (this.streams.has(path)) return this.streams.get(path) ?? null;
    let stream: unknown | null = null;
    if (ResourceLoader.exists(path)) {
      stream = ResourceLoader.load(path);
    }
    this.streams.set(path, stream);
    return stream;
  }
}

export const AudioBank = new AudioBankImpl();
