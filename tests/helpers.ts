import { TILE_COLS, TILE_ROWS } from '../src/core/constants';
import { tileOf } from '../src/core/game';
import type { GameState, PlayerInput } from '../src/core/types';

/**
 * A stable hash of everything in GameState that gameplay depends on.
 *
 * Used to assert that identical inputs produce identical state. Positions are
 * hashed at 1e-6 precision: the simulation stores continuous floats, so this
 * checks bit-for-bit reproducibility within one JavaScript engine, which is the
 * property the host-authoritative topology actually relies on (guests adopt
 * host snapshots rather than re-deriving them).
 */
export function stateHash(state: GameState): string {
  const parts: (string | number)[] = [
    state.tick,
    state.time.toFixed(6),
    state.status,
    state.winner ?? -1,
    state.rngState,
    state.nextBombId,
    state.suddenDeathClosed,
  ];

  for (const row of state.grid) parts.push(row.join(''));

  for (const p of state.players) {
    parts.push(
      p.id,
      p.pos.x.toFixed(6),
      p.pos.y.toFixed(6),
      p.alive ? 1 : 0,
      p.speed.toFixed(6),
      p.bombCap,
      p.flameRange,
      p.activeBombs,
      p.score,
      p.lives,
      p.respawnIn.toFixed(6),
      p.invulnFor.toFixed(6)
    );
  }
  for (const b of state.bombs) {
    parts.push('b', b.id, b.owner, b.x, b.y, b.fuse.toFixed(6), b.range);
  }
  for (const f of state.flames) {
    parts.push('f', f.x, f.y, f.ttl.toFixed(6), f.owner);
  }
  for (const u of state.powerups) parts.push('u', u.x, u.y, u.type);

  const text = parts.join('|');
  // FNV-1a over the serialized state.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Deterministic mulberry32, independent of the simulation's own stream. */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A reproducible stream of inputs for `slots` players over `ticks` ticks.
 * Directions persist for a few ticks at a time so players actually travel
 * instead of jittering in place.
 */
export function scriptedInputs(
  seed: number,
  ticks: number,
  slots: number
): PlayerInput[][] {
  const rng = makeRng(seed);
  const stream: PlayerInput[][] = [];
  const held: PlayerInput[] = Array.from({ length: slots }, () => ({
    dx: 0,
    dy: 0,
    bomb: false,
  }));
  const holdFor = new Array<number>(slots).fill(0);

  for (let t = 0; t < ticks; t++) {
    const frame: PlayerInput[] = [];
    for (let slot = 0; slot < slots; slot++) {
      if (holdFor[slot] <= 0) {
        const roll = rng();
        held[slot] = {
          dx: roll < 0.25 ? -1 : roll < 0.5 ? 1 : 0,
          dy: roll >= 0.5 && roll < 0.75 ? -1 : roll >= 0.75 ? 1 : 0,
          bomb: false,
        };
        holdFor[slot] = 3 + Math.floor(rng() * 9);
      }
      holdFor[slot]--;
      frame.push({ ...held[slot], bomb: rng() < 0.06 });
    }
    stream.push(frame);
  }
  return stream;
}

export interface Violation {
  tick: number;
  what: string;
}

/**
 * Invariants that must hold after every tick, whatever the inputs were.
 * Returns the violations found so a fuzz failure names the exact problem.
 */
export function checkInvariants(state: GameState): Violation[] {
  const bad: Violation[] = [];
  const note = (what: string): void => bad.push({ tick: state.tick, what });

  for (const p of state.players) {
    if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) {
      note(`player ${p.id} position is not finite`);
      continue;
    }
    if (p.pos.x < 0 || p.pos.y < 0 || p.pos.x > TILE_COLS || p.pos.y > TILE_ROWS) {
      note(`player ${p.id} left the board at ${p.pos.x},${p.pos.y}`);
      continue;
    }
    if (p.alive) {
      const here = tileOf(p.pos);
      const tile = state.grid[here.y]?.[here.x];
      if (tile !== 'floor') {
        note(`player ${p.id} is alive inside a ${tile} at ${here.x},${here.y}`);
      }
    }
    if (p.activeBombs < 0) note(`player ${p.id} has negative active bombs`);
    if (p.activeBombs > p.bombCap) {
      note(`player ${p.id} exceeded its bomb cap (${p.activeBombs}/${p.bombCap})`);
    }
    if (p.lives < 0) note(`player ${p.id} has negative lives`);
  }

  for (const b of state.bombs) {
    if (b.x < 0 || b.y < 0 || b.x >= TILE_COLS || b.y >= TILE_ROWS) {
      note(`bomb ${b.id} is off the board`);
    } else if (state.grid[b.y][b.x] !== 'floor') {
      note(`bomb ${b.id} is inside a ${state.grid[b.y][b.x]}`);
    }
  }

  const bombTiles = new Set<string>();
  for (const b of state.bombs) {
    const key = `${b.x},${b.y}`;
    if (bombTiles.has(key)) note(`two bombs stacked on ${key}`);
    bombTiles.add(key);
  }

  for (const u of state.powerups) {
    if (state.grid[u.y]?.[u.x] !== 'floor') {
      note(`power-up at ${u.x},${u.y} is inside a block`);
    }
  }

  for (const f of state.flames) {
    if (f.ttl <= 0) note(`expired flame still present at ${f.x},${f.y}`);
  }

  return bad;
}
