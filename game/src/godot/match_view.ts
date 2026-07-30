import { Color, Input, Node2D, Rect2, Vector2 } from 'godot';
import { BotController } from '../ai/bot';
import { AudioBank } from './audio';
import { SNAPSHOT_RATE, TICK_DT, TILE_COLS, TILE_ROWS } from '../core/constants';
import { createGame, step } from '../core/game';
import type {
  GameState,
  MapDef,
  PlayerInput,
  RosterEntry,
} from '../core/types';
import { IDLE_INPUT } from '../core/types';

export type MatchMode = 'solo' | 'host' | 'guest';

const TILE = 56;
const MARGIN_X = (1280 - TILE_COLS * TILE) / 2;
const MARGIN_Y = 60;

const PLAYER_COLORS = [
  '#4f9dde',
  '#e2574c',
  '#57b26a',
  '#e0b34c',
  '#9a6dd7',
  '#5bc8c4',
];

/**
 * Renders and advances a match. Owns the authoritative simulation in solo
 * and host modes; in guest mode it just draws the latest host snapshot and
 * reports local input upward.
 */
export default class MatchView extends Node2D {
  private def: MapDef | null = null;
  private state: GameState | null = null;
  private bots = new Map<number, BotController>();
  private mode: MatchMode = 'solo';
  private localSlot = 0;
  private accumulator = 0;
  private snapshotIn = 0;
  private inputSendIn = 0;
  private finishedNotified = false;

  /** Latest input per remote human slot (host mode). */
  private remoteInputs = new Map<number, PlayerInput>();

  /** Previous-frame tallies used to fire sound effects on state changes. */
  private heard = { bombs: 0, flames: 0, powerups: 0, alive: 0 };

  onSnapshot: ((state: GameState) => void) | null = null;
  onLocalInput: ((input: PlayerInput) => void) | null = null;
  onFinished: ((winner: number | null, state: GameState) => void) | null = null;

  startMatch(
    def: MapDef,
    roster: RosterEntry[],
    seed: number,
    mode: MatchMode,
    localSlot: number
  ): void {
    this.def = def;
    this.mode = mode;
    this.localSlot = localSlot;
    this.state = createGame(def, roster, seed);
    this.bots.clear();
    if (mode !== 'guest') {
      roster.forEach((entry, slot) => {
        if (entry.kind === 'bot') this.bots.set(slot, new BotController(slot));
      });
    }
    this.finishedNotified = false;
    this.accumulator = 0;
    this.heard = {
      bombs: 0,
      flames: 0,
      powerups: 0,
      alive: this.state.players.length,
    };
  }

  applySnapshot(state: GameState): void {
    if (this.mode !== 'guest') return;
    this.state = state;
    this.playStateSounds(state);
    this.queue_redraw();
  }

  setRemoteInput(slot: number, input: PlayerInput): void {
    this.remoteInputs.set(slot, input);
  }

  getState(): GameState | null {
    return this.state;
  }

  _process(delta: number): void {
    if (!this.state) return;

    if (this.mode === 'guest') {
      this.inputSendIn -= delta;
      if (this.inputSendIn <= 0) {
        this.inputSendIn = 0.05;
        this.onLocalInput?.(this.readLocalInput());
      }
      this.queue_redraw();
      return;
    }

    this.accumulator += Math.min(delta, 0.25);
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      this.stepOnce();
    }

    if (this.mode === 'host' && this.state.status === 'running') {
      this.snapshotIn -= delta;
      if (this.snapshotIn <= 0) {
        this.snapshotIn = 1 / SNAPSHOT_RATE;
        this.onSnapshot?.(this.state);
      }
    }

    this.queue_redraw();
  }

  private stepOnce(): void {
    const state = this.state!;
    if (state.status !== 'running') {
      this.notifyFinished();
      return;
    }

    const inputs: PlayerInput[] = state.players.map((p) => {
      if (p.id === this.localSlot) return this.readLocalInput();
      const bot = this.bots.get(p.id);
      if (bot) return bot.update(state, TICK_DT);
      return this.remoteInputs.get(p.id) ?? IDLE_INPUT;
    });

    step(state, inputs, TICK_DT);
    this.playStateSounds(state);
    if (state.status !== 'running') this.notifyFinished();
  }

  /** Fires sfx by diffing entity tallies, so it works identically for the
   * local simulation and for host snapshots on guests. */
  private playStateSounds(state: GameState): void {
    const alive = state.players.filter((p) => p.alive).length;
    const exploded = this.heard.flames === 0 && state.flames.length > 0;

    if (state.bombs.length > this.heard.bombs) AudioBank.playSfx('bomb_place');
    if (exploded) AudioBank.playSfx('explosion');
    if (alive < this.heard.alive) AudioBank.playSfx('death');
    if (state.powerups.length < this.heard.powerups && !exploded) {
      AudioBank.playSfx('item');
    }

    this.heard = {
      bombs: state.bombs.length,
      flames: state.flames.length,
      powerups: state.powerups.length,
      alive,
    };
  }

  private notifyFinished(): void {
    if (this.finishedNotified || !this.state) return;
    this.finishedNotified = true;
    this.onFinished?.(this.state.winner, this.state);
  }

  private readLocalInput(): PlayerInput {
    let dx = 0;
    let dy = 0;
    if (Input.is_action_pressed('move_left')) dx -= 1;
    if (Input.is_action_pressed('move_right')) dx += 1;
    if (Input.is_action_pressed('move_up')) dy -= 1;
    if (Input.is_action_pressed('move_down')) dy += 1;
    const bomb = Input.is_action_just_pressed('place_bomb');
    return { dx, dy, bomb };
  }

  _draw(): void {
    const state = this.state;
    const def = this.def;
    if (!state || !def) return;

    const floor = new Color(def.theme.floor);
    const wall = new Color(def.theme.wall);
    const crate = new Color(def.theme.crate);
    const flame = new Color(def.theme.flame);

    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        const tile = state.grid[r][c];
        const color = tile === 'wall' ? wall : tile === 'crate' ? crate : floor;
        this.draw_rect(this.tileRect(c, r), color);
      }
    }

    for (const u of state.powerups) {
      const center = this.tileCenter(u.x, u.y);
      const color =
        u.type === 'bomb'
          ? new Color('#2b2b2b')
          : u.type === 'flame'
            ? new Color(def.theme.flame)
            : new Color('#3a7bd5');
      this.draw_circle(center, TILE * 0.28, color);
    }

    for (const b of state.bombs) {
      const pulse = 0.3 + 0.1 * Math.sin(state.time * 12);
      this.draw_circle(
        this.tileCenter(b.x, b.y),
        TILE * pulse,
        new Color('#1a1a1a')
      );
    }

    for (const f of state.flames) {
      this.draw_rect(this.tileRect(f.x, f.y), flame);
    }

    for (const p of state.players) {
      if (!p.alive) continue;
      const pos = new Vector2(
        MARGIN_X + p.pos.x * TILE,
        MARGIN_Y + p.pos.y * TILE
      );
      if (p.id === this.localSlot) {
        this.draw_circle(pos, TILE * 0.44, new Color('#ffffff'));
      }
      this.draw_circle(pos, TILE * 0.38, new Color(PLAYER_COLORS[p.id]));
    }
  }

  private tileRect(c: number, r: number): Rect2 {
    return new Rect2(
      new Vector2(MARGIN_X + c * TILE, MARGIN_Y + r * TILE),
      new Vector2(TILE - 1, TILE - 1)
    );
  }

  private tileCenter(c: number, r: number): Vector2 {
    return new Vector2(
      MARGIN_X + (c + 0.5) * TILE,
      MARGIN_Y + (r + 0.5) * TILE
    );
  }
}
