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
import { SNAPSHOT_RATE, TICK_DT, TILE_COLS } from './core/constants';
import { createGame, step } from './core/game';
import type { GameState, MapDef, PlayerInput, RosterEntry } from './core/types';
import { IDLE_INPUT } from './core/types';
import { BoardRenderer } from './render/board';
import { EffectsDriver } from './render/effects';
import type { PostSettings } from './render/post';
import type { MapTheme } from './render/theme';
import { PlayerAnimator } from './render/visuals';

export type MatchMode = 'solo' | 'host' | 'guest';

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
  private animator = new PlayerAnimator();

  private accumulator = 0;
  private snapshotIn = 0;
  private inputSendIn = 0;
  private finishedNotified = false;
  private running = true;
  private paused = false;

  private keys = new Set<string>();
  /** Bomb press latched at frame level: the sim ticks slower than frames do. */
  private bombQueued = false;

  private lastTime = 0;
  private shake = 0;
  private shakePhase = 0;

  /** Turns observed state changes into particles, sound and shake. */
  private effects: EffectsDriver;

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
    this.effects = new EffectsDriver(this.board, audio);

    this.audio.setPanWidth(TILE_COLS / 2);
    this.audio.startAmbient(entry.theme);
    this.audio.setMood('battle', entry.theme);
    this.audio.play('match-start');

    this.effects.seed(this.state);
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
      this.board.sync(this.state, this.animator.visuals(this.state, this.localSlot));
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

    this.animator.advance(this.state, dt);
    this.decayShake(dt);
    this.board.sync(this.state, this.animator.visuals(this.state, this.localSlot));
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
    this.reactToState();
  }

  private notifyFinished(): void {
    if (this.finishedNotified) return;
    this.finishedNotified = true;
    this.audio.setMood(null);
    this.audio.play(this.state.winner === null ? 'draw' : 'victory');
    this.callbacks.onFinished?.(this.state.winner, this.state);
  }

  // ------------------------------------------------- state change effects

  /** Applies everything that changed since the last observation. */
  private reactToState(): void {
    this.shake = Math.min(1, this.shake + this.effects.react(this.state));
    // Guests learn the result from the snapshot, not from a local sim.
    if (this.state.status === 'finished') this.notifyFinished();
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
