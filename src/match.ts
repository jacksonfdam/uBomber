/**
 * Runs and renders one match.
 *
 * Owns the authoritative simulation in solo and host modes; in guest mode it
 * only draws the latest host snapshot and reports local input upward. The
 * simulation itself is untouched engine-agnostic code in src/core — everything
 * here is presentation plus the fixed-step pump.
 *
 * All audio and particle work is driven by *diffing observed state*, never by
 * hooks inside the simulation. That is what lets the exact same code light up
 * a locally simulated match and a stream of host snapshots, and it guarantees
 * nothing render-side can perturb the deterministic state guests reconcile to.
 */

import type { AudioEngine } from './audio/audio';
import { BotController } from './ai/bot';
import {
  SNAPSHOT_RATE,
  TICK_DT,
  TILE_COLS,
  TILE_ROWS,
} from './core/constants';
import { createGame, step, SUDDEN_DEATH_ORDER } from './core/game';
import type { GameState, MapDef, PlayerInput, RosterEntry } from './core/types';
import { IDLE_INPUT } from './core/types';
import { PLAYER_COLORS } from './render/atlas';
import { BoardRenderer, type PlayerVisual, TILE } from './render/board';
import type { PostSettings } from './render/post';
import type { MapTheme } from './render/theme';

export type MatchMode = 'solo' | 'host' | 'guest';

/** Seconds a defeated character lingers while fading out. */
const DEATH_FADE = 0.7;

/** Seconds the plant animation plays after dropping a bomb. */
const PLANT_TIME = 0.24;

type Facing = 'down' | 'up' | 'left' | 'right';

interface Anim {
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  /** Animation clock in 60 Hz frames, matching ANIM_TICKS units. */
  ticks: number;
  /** Seconds since the death fade began; -1 while alive. */
  deathTime: number;
  plantTime: number;
}

export interface MatchCallbacks {
  onSnapshot?: (state: GameState) => void;
  onLocalInput?: (input: PlayerInput) => void;
  onFinished?: (winner: number | null, state: GameState) => void;
  /** The local player is out and asked to skip the spectator phase. */
  onSkip?: () => void;
  /** Pause state changed (offline only), so the shell can show an overlay. */
  onPauseChange?: (paused: boolean) => void;
}

const MOVE_KEYS: Record<string, Partial<{ dx: number; dy: number }>> = {
  ArrowLeft: { dx: -1 },
  ArrowRight: { dx: 1 },
  ArrowUp: { dy: -1 },
  ArrowDown: { dy: 1 },
  KeyA: { dx: -1 },
  KeyD: { dx: 1 },
  KeyW: { dy: -1 },
  KeyS: { dy: 1 },
};

export class Match {
  readonly board: BoardRenderer;

  private state: GameState;
  private def: MapDef;
  private mode: MatchMode;
  private localSlot: number;
  private audio: AudioEngine;
  private callbacks: MatchCallbacks;

  private bots = new Map<number, BotController>();
  private remoteInputs = new Map<number, PlayerInput>();
  private anims = new Map<number, Anim>();

  private accumulator = 0;
  private snapshotIn = 0;
  private inputSendIn = 0;
  private finishedNotified = false;
  private running = true;
  private paused = false;

  private keys = new Set<string>();
  /** Bomb press latched at frame level: the sim ticks slower than frames do. */
  private bombQueued = false;

  private frame = 0;
  private lastTime = 0;
  private shake = 0;
  private shakePhase = 0;

  // Previous-frame tallies used to detect what just happened.
  private prevBombIds = new Set<number>();
  private prevCrates = new Set<string>();
  private prevPowerups = new Set<string>();
  private prevAlive: boolean[] = [];
  private prevSuddenClosed = 0;
  private prevWinner: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    entry: { def: MapDef; theme: MapTheme },
    roster: RosterEntry[],
    seed: number,
    mode: MatchMode,
    localSlot: number,
    audio: AudioEngine,
    post: PostSettings,
    callbacks: MatchCallbacks = {}
  ) {
    this.def = entry.def;
    this.mode = mode;
    this.localSlot = localSlot;
    this.audio = audio;
    this.callbacks = callbacks;

    this.state = createGame(entry.def, roster, seed);
    if (mode !== 'guest') {
      roster.forEach((player, slot) => {
        if (player.kind === 'bot') this.bots.set(slot, new BotController(slot));
      });
    }

    this.board = new BoardRenderer(canvas, entry.theme, entry.def.id, seed);
    this.board.applyPost(post);

    this.audio.setPanWidth(TILE_COLS / 2);
    this.audio.startAmbient(entry.theme);
    this.audio.setMood('battle', entry.theme);
    this.audio.play('match-start');

    this.seedDiffState();
    this.bindInput();
    this.bindResize();

    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ api

  getState(): GameState {
    return this.state;
  }

  getMapDef(): MapDef {
    return this.def;
  }

  getLocalSlot(): number {
    return this.localSlot;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Only offline matches truly pause; online must keep simulating. */
  setPaused(value: boolean): void {
    const next = this.mode === 'solo' && this.state.status === 'running' ? value : false;
    if (next === this.paused) return;
    this.paused = next;
    if (this.paused) this.accumulator = 0;
    this.callbacks.onPauseChange?.(this.paused);
  }

  togglePause(): void {
    this.setPaused(!this.paused);
  }

  applySnapshot(state: GameState): void {
    if (this.mode !== 'guest') return;
    this.state = state;
    this.reactToState();
  }

  setRemoteInput(slot: number, input: PlayerInput): void {
    this.remoteInputs.set(slot, input);
  }

  applyPost(settings: PostSettings): void {
    this.board.applyPost(settings);
  }

  dispose(): void {
    this.running = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.board.dispose();
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private bindResize(): void {
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    this.board.resize();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Space') {
      event.preventDefault();
      const local = this.state.players[this.localSlot];
      // A player who is out of lives can skip the rest of the match.
      if (this.state.status === 'running' && local && !local.alive && local.lives <= 0) {
        this.callbacks.onSkip?.();
        return;
      }
      this.bombQueued = true;
      return;
    }
    if (event.code === 'KeyP' && this.mode === 'solo') {
      this.togglePause();
      return;
    }
    if (MOVE_KEYS[event.code]) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  /** Losing focus must not leave the player walking into a bomb. */
  private onBlur = (): void => {
    this.keys.clear();
    if (this.mode === 'solo') this.setPaused(true);
  };

  private readLocalInput(): PlayerInput {
    let dx = 0;
    let dy = 0;
    for (const code of this.keys) {
      const move = MOVE_KEYS[code];
      if (!move) continue;
      dx += move.dx ?? 0;
      dy += move.dy ?? 0;
    }
    const bomb = this.bombQueued;
    this.bombQueued = false;
    return { dx: Math.sign(dx), dy: Math.sign(dy), bomb };
  }

  // ----------------------------------------------------------------- loop

  private loop = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.paused) {
      this.board.sync(this.state, this.buildVisuals());
      this.board.render(0);
      requestAnimationFrame(this.loop);
      return;
    }

    if (this.mode === 'guest') {
      this.inputSendIn -= dt;
      if (this.inputSendIn <= 0) {
        this.inputSendIn = 0.05;
        this.callbacks.onLocalInput?.(this.readLocalInput());
      }
    } else {
      this.accumulator += dt;
      while (this.accumulator >= TICK_DT) {
        this.accumulator -= TICK_DT;
        this.tick();
      }
      if (this.mode === 'host' && this.state.status === 'running') {
        this.snapshotIn -= dt;
        if (this.snapshotIn <= 0) {
          this.snapshotIn = 1 / SNAPSHOT_RATE;
          this.callbacks.onSnapshot?.(this.state);
        }
      }
    }

    this.advanceAnims(dt);
    this.decayShake(dt);
    this.board.sync(this.state, this.buildVisuals());
    this.board.render(dt);
    requestAnimationFrame(this.loop);
  };

  private tick(): void {
    if (this.state.status !== 'running') {
      this.notifyFinished();
      return;
    }
    const inputs: PlayerInput[] = this.state.players.map((player) => {
      if (player.id === this.localSlot && this.mode !== 'guest') return this.readLocalInput();
      const bot = this.bots.get(player.id);
      if (bot) return bot.update(this.state, TICK_DT);
      return this.remoteInputs.get(player.id) ?? IDLE_INPUT;
    });

    step(this.state, inputs, TICK_DT);
    this.frame++;
    this.reactToState();
    if (this.state.status !== 'running') this.notifyFinished();
  }

  private notifyFinished(): void {
    if (this.finishedNotified) return;
    this.finishedNotified = true;
    this.audio.setMood(null);
    this.audio.play(this.state.winner === null ? 'draw' : 'victory');
    this.callbacks.onFinished?.(this.state.winner, this.state);
  }

  // -------------------------------------------------- state change effects

  private seedDiffState(): void {
    this.prevBombIds = new Set(this.state.bombs.map((b) => b.id));
    this.prevCrates = this.crateKeys();
    this.prevPowerups = new Set(this.state.powerups.map((u) => `${u.x},${u.y}`));
    this.prevAlive = this.state.players.map((p) => p.alive);
    this.prevSuddenClosed = this.state.suddenDeathClosed;
    this.prevWinner = this.state.winner;
  }

  private crateKeys(): Set<string> {
    const keys = new Set<string>();
    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        if (this.state.grid[r][c] === 'crate') keys.add(`${c},${r}`);
      }
    }
    return keys;
  }

  /** World-space centre of a tile, for particle emission. */
  private tileCentre(x: number, y: number): [number, number] {
    return [
      (x + 0.5) * TILE - (TILE_COLS * TILE) / 2,
      (TILE_ROWS * TILE) / 2 - (y + 0.5) * TILE,
    ];
  }

  /**
   * Turns "what changed since last frame" into sound, particles and shake.
   * Runs after every sim tick and after every applied snapshot.
   */
  private reactToState(): void {
    const state = this.state;

    // --- bombs placed
    const bombIds = new Set(state.bombs.map((b) => b.id));
    for (const bomb of state.bombs) {
      if (this.prevBombIds.has(bomb.id)) continue;
      const [wx, wy] = this.tileCentre(bomb.x, bomb.y);
      this.board.vfx.place(wx, wy);
      this.audio.play('bomb-place', bomb.x);
    }

    // --- bombs that vanished detonated (sudden death removes them silently,
    //     but those tiles also produce a wall-slam, so the cue still reads)
    let blasts = 0;
    for (const id of this.prevBombIds) {
      if (bombIds.has(id)) continue;
      blasts++;
    }
    if (blasts > 0) {
      // Emit at the freshest flame tiles: that is where the blast is visible.
      const centres = state.flames.slice(0, Math.max(1, blasts * 3));
      for (const flame of centres) {
        const [wx, wy] = this.tileCentre(flame.x, flame.y);
        this.board.vfx.blast(wx, wy);
      }
      const loudest = state.flames[0];
      this.audio.play('explosion', loudest ? loudest.x : undefined);
      this.shake = Math.min(1, this.shake + 0.35 + blasts * 0.1);
      this.board.addFlash(0.1 + blasts * 0.03);
    }

    // --- crates destroyed
    const crates = this.crateKeys();
    let broken = 0;
    for (const key of this.prevCrates) {
      if (crates.has(key)) continue;
      broken++;
      const [cx, cy] = key.split(',').map(Number);
      const [wx, wy] = this.tileCentre(cx, cy);
      this.board.vfx.crateBreak(wx, wy);
    }
    if (broken > 0) this.audio.play('crate-break');

    // --- power-ups collected (removed without a flame on that tile)
    const powerups = new Set(state.powerups.map((u) => `${u.x},${u.y}`));
    for (const key of this.prevPowerups) {
      if (powerups.has(key)) continue;
      const [ux, uy] = key.split(',').map(Number);
      const burned = state.flames.some((f) => f.x === ux && f.y === uy);
      if (burned) continue;
      const [wx, wy] = this.tileCentre(ux, uy);
      this.board.vfx.pickup(wx, wy);
      this.audio.play('pickup', ux);
    }

    // --- players down and back up
    state.players.forEach((player, slot) => {
      const wasAlive = this.prevAlive[slot] ?? true;
      if (wasAlive && !player.alive) {
        const [wx, wy] = this.tileCentre(Math.floor(player.pos.x), Math.floor(player.pos.y));
        this.board.vfx.death(wx, wy, PLAYER_COLORS[slot % PLAYER_COLORS.length]);
        this.audio.play('death', player.pos.x);
        this.shake = Math.min(1, this.shake + 0.25);
      } else if (!wasAlive && player.alive) {
        this.audio.play('respawn', player.pos.x);
      }
    });

    // --- sudden death closing in
    if (state.suddenDeathClosed > this.prevSuddenClosed) {
      if (this.prevSuddenClosed === 0) this.audio.play('hurry');
      this.audio.play('wall-slam');
      this.shake = Math.min(1, this.shake + 0.18);
      // The newly walled tiles kick up dust.
      for (let i = this.prevSuddenClosed; i < state.suddenDeathClosed; i++) {
        const tile = SUDDEN_DEATH_ORDER[i];
        if (!tile) continue;
        const [wx, wy] = this.tileCentre(tile.x, tile.y);
        this.board.vfx.slam(wx, wy);
      }
    }

    // --- guests learn the result from the snapshot, not from their own sim
    if (this.prevWinner === null && state.status === 'finished') this.notifyFinished();

    this.prevBombIds = bombIds;
    this.prevCrates = crates;
    this.prevPowerups = powerups;
    this.prevAlive = state.players.map((p) => p.alive);
    this.prevSuddenClosed = state.suddenDeathClosed;
    this.prevWinner = state.winner;
  }

  // ----------------------------------------------------------- animation

  private advanceAnims(dt: number): void {
    const frames = dt * 60;
    for (const player of this.state.players) {
      let anim = this.anims.get(player.id);
      if (!anim) {
        anim = {
          x: player.pos.x,
          y: player.pos.y,
          facing: 'down',
          moving: false,
          ticks: 0,
          deathTime: -1,
          plantTime: 0,
        };
        this.anims.set(player.id, anim);
      }

      anim.plantTime = Math.max(0, anim.plantTime - dt);

      if (!player.alive) {
        anim.deathTime = anim.deathTime < 0 ? 0 : anim.deathTime + dt;
        anim.moving = false;
        anim.ticks += frames;
        continue;
      }
      if (anim.deathTime >= 0) {
        // Respawned: reset the death clock so the fade does not linger.
        anim.deathTime = -1;
        anim.ticks = 0;
      }

      const dx = player.pos.x - anim.x;
      const dy = player.pos.y - anim.y;
      anim.moving = Math.abs(dx) + Math.abs(dy) > 1e-4;
      if (anim.moving) {
        anim.facing =
          Math.abs(dx) >= Math.abs(dy)
            ? dx > 0
              ? 'right'
              : 'left'
            : dy > 0
              ? 'down'
              : 'up';
      }
      anim.x = player.pos.x;
      anim.y = player.pos.y;
      anim.ticks += frames;

      // A bomb the player owns that appeared under them plays the plant pose.
      const standing = this.state.bombs.find(
        (b) =>
          b.owner === player.id &&
          b.x === Math.floor(player.pos.x) &&
          b.y === Math.floor(player.pos.y) &&
          b.fuse > 1.9
      );
      if (standing) anim.plantTime = PLANT_TIME;
    }
  }

  /** True when a live bomb threatens this tile soon: drives the panic pose. */
  private inDanger(x: number, y: number): boolean {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    return this.state.bombs.some((bomb) => {
      if (bomb.fuse > 0.8) return false;
      if (bomb.x === cx && bomb.y === cy) return true;
      if (bomb.x === cx) return Math.abs(bomb.y - cy) <= bomb.range;
      if (bomb.y === cy) return Math.abs(bomb.x - cx) <= bomb.range;
      return false;
    });
  }

  private buildVisuals(): PlayerVisual[] {
    const visuals: PlayerVisual[] = [];
    const finished = this.state.status === 'finished';

    for (const player of this.state.players) {
      const anim = this.anims.get(player.id);
      if (!anim) continue;

      if (!player.alive) {
        const fade = anim.deathTime < 0 ? 0 : Math.min(1, anim.deathTime / DEATH_FADE);
        if (fade >= 1) continue;
        visuals.push({
          slot: player.id,
          x: player.pos.x,
          y: player.pos.y,
          anim: 'die',
          tick: anim.ticks,
          flip: false,
          alpha: 1 - fade,
          lift: fade * 26,
          local: player.id === this.localSlot,
        });
        continue;
      }

      let name: string;
      if (finished && this.state.winner === player.id) name = 'win';
      else if (anim.plantTime > 0) name = 'plant';
      else if (anim.moving) {
        name =
          anim.facing === 'up'
            ? 'walk-up'
            : anim.facing === 'down'
              ? 'walk-down'
              : 'walk-side';
      } else if (this.inDanger(player.pos.x, player.pos.y)) name = 'panic';
      else {
        name =
          anim.facing === 'up'
            ? 'idle-up'
            : anim.facing === 'down'
              ? 'idle-down'
              : 'idle-side';
      }

      // Respawn grace reads as a fast blink.
      const blink =
        player.invulnFor > 0 && Math.floor(this.frame / 3) % 2 === 1 ? 0.35 : 1;

      visuals.push({
        slot: player.id,
        x: player.pos.x,
        y: player.pos.y,
        anim: name,
        tick: anim.ticks,
        flip: anim.facing === 'left',
        alpha: blink,
        lift: 0,
        local: player.id === this.localSlot,
      });
    }
    return visuals;
  }

  // --------------------------------------------------------------- shake

  private decayShake(dt: number): void {
    if (this.shake <= 0) {
      this.board.setShake(0, 0);
      return;
    }
    this.shake = Math.max(0, this.shake - dt * 3.2);
    this.shakePhase += dt;
    const amp = this.shake * this.shake * 22;
    this.board.setShake(
      Math.sin(this.shakePhase * 74) * amp,
      Math.cos(this.shakePhase * 91) * amp
    );
  }
}
