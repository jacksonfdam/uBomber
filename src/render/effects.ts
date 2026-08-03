/**
 * Drives particles, sound and shake from *observed changes* to GameState.
 *
 * Nothing in here is ever called from inside the simulation. That is
 * deliberate and load-bearing: the match is host-authoritative and guests
 * reconcile against 10 Hz snapshots, so render-side randomness reaching the sim
 * would desync every peer. Diffing state instead means one code path serves a
 * locally simulated match, a stream of host snapshots, and the menu's attract
 * mode alike.
 */

import type { AudioEngine } from '../audio/audio';
import { TILE_COLS, TILE_ROWS } from '../core/constants';
import { SUDDEN_DEATH_ORDER } from '../core/game';
import type { GameState } from '../core/types';
import { PLAYER_COLORS } from './atlas';
import type { BoardRenderer } from './board';
import { TILE } from './board';

export class EffectsDriver {
  private board: BoardRenderer;
  private audio: AudioEngine | null;

  private prevBombIds = new Set<number>();
  private prevCrates = new Set<string>();
  private prevPowerups = new Set<string>();
  private prevAlive: boolean[] = [];
  private prevSuddenClosed = 0;
  private prevFinished = false;

  /** Pass `null` for audio to run silently, as the attract mode does. */
  constructor(board: BoardRenderer, audio: AudioEngine | null) {
    this.board = board;
    this.audio = audio;
  }

  /** Records the starting state so the first diff reports nothing. */
  seed(state: GameState): void {
    this.prevBombIds = new Set(state.bombs.map((b) => b.id));
    this.prevCrates = crateKeys(state);
    this.prevPowerups = new Set(state.powerups.map((u) => `${u.x},${u.y}`));
    this.prevAlive = state.players.map((p) => p.alive);
    this.prevSuddenClosed = state.suddenDeathClosed;
    this.prevFinished = state.status === 'finished';
  }

  /** World-space centre of a tile, for particle emission. */
  private centre(x: number, y: number): [number, number] {
    return [
      (x + 0.5) * TILE - (TILE_COLS * TILE) / 2,
      (TILE_ROWS * TILE) / 2 - (y + 0.5) * TILE,
    ];
  }

  private play(name: Parameters<AudioEngine['play']>[0], tileX?: number): void {
    this.audio?.play(name, tileX);
  }

  /**
   * Reacts to everything that changed since the last call and returns the
   * shake impulse the caller should add (0 when nothing happened).
   */
  react(state: GameState): number {
    let shake = 0;

    // --- bombs placed
    const bombIds = new Set(state.bombs.map((b) => b.id));
    for (const bomb of state.bombs) {
      if (this.prevBombIds.has(bomb.id)) continue;
      const [wx, wy] = this.centre(bomb.x, bomb.y);
      this.board.vfx.place(wx, wy);
      this.play('bomb-place', bomb.x);
    }

    // --- bombs that vanished detonated
    let blasts = 0;
    for (const id of this.prevBombIds) if (!bombIds.has(id)) blasts++;
    if (blasts > 0) {
      // Emit at the freshest flame tiles: that is where the blast is visible.
      for (const flame of state.flames.slice(0, Math.max(1, blasts * 3))) {
        const [wx, wy] = this.centre(flame.x, flame.y);
        this.board.vfx.blast(wx, wy);
      }
      this.play('explosion', state.flames[0]?.x);
      shake += 0.35 + blasts * 0.1;
      this.board.addFlash(0.1 + blasts * 0.03);
    }

    // --- crates destroyed
    const crates = crateKeys(state);
    let broken = 0;
    for (const key of this.prevCrates) {
      if (crates.has(key)) continue;
      broken++;
      const [cx, cy] = key.split(',').map(Number);
      const [wx, wy] = this.centre(cx, cy);
      this.board.vfx.crateBreak(wx, wy);
    }
    if (broken > 0) this.play('crate-break');

    // --- power-ups collected (removed without a flame on that tile)
    const powerups = new Set(state.powerups.map((u) => `${u.x},${u.y}`));
    for (const key of this.prevPowerups) {
      if (powerups.has(key)) continue;
      const [ux, uy] = key.split(',').map(Number);
      if (state.flames.some((f) => f.x === ux && f.y === uy)) continue;
      const [wx, wy] = this.centre(ux, uy);
      this.board.vfx.pickup(wx, wy);
      this.play('pickup', ux);
    }

    // --- players down and back up
    state.players.forEach((player, slot) => {
      const wasAlive = this.prevAlive[slot] ?? true;
      if (wasAlive && !player.alive) {
        const [wx, wy] = this.centre(Math.floor(player.pos.x), Math.floor(player.pos.y));
        this.board.vfx.death(wx, wy, PLAYER_COLORS[slot % PLAYER_COLORS.length]);
        this.play('death', player.pos.x);
        shake += 0.25;
      } else if (!wasAlive && player.alive) {
        this.play('respawn', player.pos.x);
      }
    });

    // --- sudden death closing in
    if (state.suddenDeathClosed > this.prevSuddenClosed) {
      if (this.prevSuddenClosed === 0) this.play('hurry');
      this.play('wall-slam');
      shake += 0.18;
      for (let i = this.prevSuddenClosed; i < state.suddenDeathClosed; i++) {
        const tile = SUDDEN_DEATH_ORDER[i];
        if (!tile) continue;
        const [wx, wy] = this.centre(tile.x, tile.y);
        this.board.vfx.slam(wx, wy);
      }
    }

    this.prevBombIds = bombIds;
    this.prevCrates = crates;
    this.prevPowerups = powerups;
    this.prevAlive = state.players.map((p) => p.alive);
    this.prevSuddenClosed = state.suddenDeathClosed;
    this.prevFinished = state.status === 'finished';

    return Math.min(1, shake);
  }

  /** True once the observed state has reported a finished match. */
  get finished(): boolean {
    return this.prevFinished;
  }
}

function crateKeys(state: GameState): Set<string> {
  const keys = new Set<string>();
  for (let r = 0; r < TILE_ROWS; r++) {
    for (let c = 0; c < TILE_COLS; c++) {
      if (state.grid[r][c] === 'crate') keys.add(`${c},${r}`);
    }
  }
  return keys;
}
