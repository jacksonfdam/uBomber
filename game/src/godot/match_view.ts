import { Color, Input, Node2D, Rect2, ResourceLoader, Vector2 } from 'godot';
import { BotController } from '../ai/bot';
import { AudioBank } from './audio';
import {
  BOMB_FUSE,
  FLAME_TTL,
  SNAPSHOT_RATE,
  TICK_DT,
  TILE_COLS,
  TILE_ROWS,
} from '../core/constants';
import { createGame, step } from '../core/game';
import type {
  GameState,
  MapDef,
  PlayerInput,
  PlayerState,
  RosterEntry,
} from '../core/types';
import { IDLE_INPUT } from '../core/types';
import {
  ATLAS_PATH,
  CHAR_VARIANTS,
  SPR,
  bombFrame,
  charFrame,
  type Facing,
  type Region,
} from './atlas';

export type MatchMode = 'solo' | 'host' | 'guest';

/** 4x the 16px source art; 15x13 tiles fill the 1280x832 viewport exactly. */
const TILE = 64;
const MARGIN_X = (1280 - TILE_COLS * TILE) / 2;
const MARGIN_Y = (832 - TILE_ROWS * TILE) / 2;

/** How long a defeated character lingers while fading out. */
const DEATH_FADE = 0.6;

const PLAYER_COLORS = [
  '#4f9dde',
  '#e2574c',
  '#57b26a',
  '#e0b34c',
  '#9a6dd7',
  '#5bc8c4',
];

/** Per-player view-side animation state, derived from observed movement so it
 * works the same for the local simulation and for guest snapshots. */
interface PlayerAnim {
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  walkTime: number;
  /** Seconds since the death fade started; -1 while alive. */
  deathTime: number;
}

/**
 * Renders and advances a match. Owns the authoritative simulation in solo
 * and host modes; in guest mode it just draws the latest host snapshot and
 * reports local input upward.
 *
 * Rendering is immediate-mode over a single sprite atlas: floor and blocks
 * are grayscale sprites tinted with the map theme, and solids plus characters
 * are painted row by row (painter's y-sort) for a 2.5D look.
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

  private atlas: unknown = null;
  private anims = new Map<number, PlayerAnim>();
  private viewTime = 0;
  private lastFlameCount = 0;
  private shake = 0;
  private mapHash = 0;
  private white = new Color(1, 1, 1, 1);
  private playerCols: Color[] = [];
  private theme = {
    floor: new Color(1, 1, 1, 1),
    floorAlt: new Color(1, 1, 1, 1),
    wall: new Color(1, 1, 1, 1),
    crate: new Color(1, 1, 1, 1),
    accent: new Color(1, 1, 1, 1),
  };

  onSnapshot: ((state: GameState) => void) | null = null;
  onLocalInput: ((input: PlayerInput) => void) | null = null;
  onFinished: ((winner: number | null, state: GameState) => void) | null = null;

  private font: unknown = null;

  _ready(): void {
    this.atlas = ResourceLoader.load(ATLAS_PATH);
    this.font = ResourceLoader.load(
      'res://assets/fonts/PressStart2P-Regular.ttf'
    );
    // CanvasItem.TEXTURE_FILTER_NEAREST: keep the pixel art crisp at 4x.
    this.texture_filter = 1;
  }

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

    this.anims.clear();
    this.viewTime = 0;
    this.lastFlameCount = 0;
    this.shake = 0;
    this.mapHash = hashString(def.id);
    this.playerCols = PLAYER_COLORS.map((hex) => new Color(hex));
    this.theme = {
      floor: new Color(def.theme.floor),
      floorAlt: new Color(def.theme.floor).darkened(0.08),
      wall: new Color(def.theme.wall),
      crate: new Color(def.theme.crate),
      accent: new Color(def.theme.accent),
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
      this.updateAnims(delta);
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

    this.updateAnims(delta);
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

  // ----------------------------------------------------------- animation

  private updateAnims(delta: number): void {
    const state = this.state!;
    this.viewTime += delta;

    for (const p of state.players) {
      let anim = this.anims.get(p.id);
      if (!anim) {
        anim = {
          x: p.pos.x,
          y: p.pos.y,
          facing: 'down',
          moving: false,
          walkTime: 0,
          deathTime: -1,
        };
        this.anims.set(p.id, anim);
      }
      if (!p.alive) {
        anim.deathTime = anim.deathTime < 0 ? 0 : anim.deathTime + delta;
        anim.moving = false;
        continue;
      }
      const dx = p.pos.x - anim.x;
      const dy = p.pos.y - anim.y;
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
        anim.walkTime += delta;
      }
      anim.x = p.pos.x;
      anim.y = p.pos.y;
    }

    if (state.flames.length > this.lastFlameCount) this.shake = 0.2;
    this.lastFlameCount = state.flames.length;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - delta);
      const amp = this.shake * 24;
      this.position = new Vector2(
        Math.sin(this.viewTime * 73) * amp,
        Math.cos(this.viewTime * 91) * amp
      );
    } else {
      this.position = new Vector2(0, 0);
    }
  }

  // ------------------------------------------------------------- drawing

  _draw(): void {
    const state = this.state;
    if (!state || !this.def || !this.atlas) return;

    this.drawFloor();
    this.drawContactShadows(state);
    this.drawDecor(state);
    this.drawPowerups(state);
    this.drawFlames(state);
    this.drawBombs(state);
    this.drawSolidsAndPlayers(state);
    this.drawScores(state);
  }

  /** Live scoreboard in the left margin: color chip, name and points per
   * player; dead players gray out. */
  private drawScores(state: GameState): void {
    if (!this.font) return;
    const gold = new Color(1, 0.84, 0.35, 1);
    const dead = new Color(0.45, 0.45, 0.45, 1);

    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const y = 26 + i * 62;

      this.draw_rect(
        new Rect2(new Vector2(14, y), new Vector2(16, 16)),
        p.alive ? this.playerCols[p.id] : dead
      );
      this.draw_string(
        this.font,
        new Vector2(38, y + 13),
        p.name.slice(0, 12),
        0,
        -1,
        9,
        p.alive ? this.white : dead
      );
      this.draw_string(
        this.font,
        new Vector2(14, y + 38),
        String(p.score),
        0,
        -1,
        12,
        p.alive ? gold : dead
      );
    }
  }

  private drawFloor(): void {
    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        const reg = this.cellHash(c, r) % 7 === 0 ? SPR.floorB : SPR.floorA;
        const tint = (r + c) % 2 === 0 ? this.theme.floor : this.theme.floorAlt;
        this.drawSpr(reg, MARGIN_X + c * TILE, MARGIN_Y + r * TILE, TILE, TILE, tint);
      }
    }
  }

  /** Soft strip on floor tiles right below a wall/crate: cheap ambient
   * occlusion that sells the block height. */
  private drawContactShadows(state: GameState): void {
    const tint = new Color(0, 0, 0, 0.17);
    for (let r = 0; r + 1 < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        if (state.grid[r][c] === 'floor') continue;
        if (state.grid[r + 1][c] !== 'floor') continue;
        this.draw_rect(
          new Rect2(
            new Vector2(MARGIN_X + c * TILE, MARGIN_Y + (r + 1) * TILE),
            new Vector2(TILE, TILE * 0.22)
          ),
          tint
        );
      }
    }
  }

  /** Sparse accent-tinted bushes on deterministic floor cells. */
  private drawDecor(state: GameState): void {
    const tint = new Color(
      this.theme.accent.r,
      this.theme.accent.g,
      this.theme.accent.b,
      0.9
    );
    const size = TILE * 0.62;
    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        if (state.grid[r][c] !== 'floor') continue;
        if (this.cellHash(c, r) % 19 !== 3) continue;
        this.drawSpr(
          SPR.bush,
          MARGIN_X + (c + 0.5) * TILE - size / 2,
          MARGIN_Y + (r + 0.55) * TILE - size / 2,
          size,
          size,
          tint
        );
      }
    }
  }

  private drawPowerups(state: GameState): void {
    for (const u of state.powerups) {
      const cx = MARGIN_X + (u.x + 0.5) * TILE;
      const cy = MARGIN_Y + (u.y + 0.5) * TILE;
      const bob = Math.sin(this.viewTime * 3 + u.x * 5 + u.y * 3) * 3;
      this.drawSpr(SPR.shadow, cx - 16, cy + TILE * 0.22, 32, 13, this.white);
      this.drawSpr(SPR.panel, cx - 22, cy - 22 + bob, 44, 44, this.white);
      const icon =
        u.type === 'bomb'
          ? bombFrame(0)
          : u.type === 'flame'
            ? SPR.flameBall
            : SPR.bolt;
      const size = u.type === 'speed' ? 34 : 28;
      this.drawSpr(icon, cx - size / 2, cy - size / 2 + bob, size, size, this.white);
    }
  }

  /** Picks beam/tip/center pieces from how each burning cell connects to its
   * neighbors, then fades them out over the flame's lifetime. */
  private drawFlames(state: GameState): void {
    const lit = new Set(state.flames.map((f) => `${f.x},${f.y}`));
    for (const f of state.flames) {
      const left = lit.has(`${f.x - 1},${f.y}`);
      const right = lit.has(`${f.x + 1},${f.y}`);
      const up = lit.has(`${f.x},${f.y - 1}`);
      const down = lit.has(`${f.x},${f.y + 1}`);
      const horiz = left || right;
      const vert = up || down;

      let reg: Region;
      if ((horiz && vert) || (!horiz && !vert)) reg = SPR.flameCenter;
      else if (horiz)
        reg = left && right ? SPR.flameH : right ? SPR.flameTipL : SPR.flameTipR;
      else reg = up && down ? SPR.flameV : down ? SPR.flameTipU : SPR.flameTipD;

      const alpha = Math.min(1, f.ttl / (FLAME_TTL * 0.7));
      const size = reg === SPR.flameCenter ? TILE * 1.15 : TILE;
      this.drawSpr(
        reg,
        MARGIN_X + (f.x + 0.5) * TILE - size / 2,
        MARGIN_Y + (f.y + 0.5) * TILE - size / 2,
        size,
        size,
        new Color(1, 1, 1, alpha)
      );
    }
  }

  private drawBombs(state: GameState): void {
    for (const b of state.bombs) {
      const cx = MARGIN_X + (b.x + 0.5) * TILE;
      const cy = MARGIN_Y + (b.y + 0.5) * TILE;
      const burning = BOMB_FUSE - b.fuse;
      const urgency = 1 - b.fuse / BOMB_FUSE;
      const frame = Math.floor(burning * (5 + burning * 5)) % 6;
      const pulse = 1 + 0.05 * Math.sin(this.viewTime * (8 + urgency * 12));
      const size = TILE * 0.95 * pulse;
      this.drawSpr(SPR.shadow, cx - 20, cy + TILE * 0.18, 40, 17, this.white);
      this.drawSpr(
        bombFrame(frame),
        cx - size / 2,
        cy - size / 2 - 3,
        size,
        size,
        new Color(1, 1 - urgency * 0.35, 1 - urgency * 0.35, 1)
      );
    }
  }

  /** Solid blocks and characters, painted top row to bottom so lower sprites
   * overlap higher ones (painter's y-sort). */
  private drawSolidsAndPlayers(state: GameState): void {
    const byRow: PlayerState[][] = Array.from({ length: TILE_ROWS }, () => []);
    for (const p of state.players) {
      const anim = this.anims.get(p.id);
      if (!p.alive && (!anim || anim.deathTime >= DEATH_FADE)) continue;
      const row = Math.min(TILE_ROWS - 1, Math.max(0, Math.floor(p.pos.y + 0.4)));
      byRow[row].push(p);
    }

    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        const tile = state.grid[r][c];
        if (tile === 'floor') continue;
        this.drawSpr(
          tile === 'wall' ? SPR.wall : SPR.crate,
          MARGIN_X + c * TILE,
          MARGIN_Y + r * TILE,
          TILE,
          TILE,
          tile === 'wall' ? this.theme.wall : this.theme.crate
        );
      }
      for (const p of byRow[r]) this.drawPlayer(p);
    }
  }

  private drawPlayer(p: PlayerState): void {
    const anim = this.anims.get(p.id)!;
    const px = MARGIN_X + p.pos.x * TILE;
    const feetY = MARGIN_Y + p.pos.y * TILE + TILE * 0.4;
    const fade = p.alive ? 0 : Math.min(1, anim.deathTime / DEATH_FADE);

    if (p.alive) {
      this.drawSpr(SPR.shadow, px - 19, feetY - 7, 38, 15, this.white);
      if (p.id === this.localSlot) {
        this.drawSpr(SPR.ring, px - 26, feetY - 13, 52, 26, this.white);
      }
      this.drawSpr(SPR.ring, px - 21, feetY - 10, 42, 21, this.playerCols[p.id]);
    }

    const step = anim.moving ? Math.floor(anim.walkTime * 9) : 0;
    const reg = charFrame(p.id % CHAR_VARIANTS, anim.facing, step);
    // Dead characters drift upward while fading out.
    this.drawSpr(
      reg,
      px - TILE / 2,
      feetY - TILE + 6 - fade * 24,
      TILE,
      TILE,
      new Color(1, 1, 1, 1 - fade)
    );
  }

  private drawSpr(
    reg: Region,
    x: number,
    y: number,
    w: number,
    h: number,
    tint: Color
  ): void {
    this.draw_texture_rect_region(
      this.atlas,
      new Rect2(new Vector2(x, y), new Vector2(w, h)),
      new Rect2(new Vector2(reg.x, reg.y), new Vector2(reg.w, reg.h)),
      tint
    );
  }

  /** Deterministic per-cell hash, stable per map, for floor variety. */
  private cellHash(c: number, r: number): number {
    return ((c * 73856093) ^ (r * 19349663) ^ this.mapHash) >>> 0;
  }
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = (h * 16777619) >>> 0;
  }
  return h;
}
