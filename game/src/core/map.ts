import { MAX_SLOTS, TILE_COLS, TILE_ROWS } from './constants';
import { rand } from './rng';
import type { MapDef, Tile, Vec2 } from './types';

const RANDOM_CRATE_CHANCE = 0.7;

export interface ParsedMap {
  grid: Tile[][];
  /** Spawn tiles indexed by slot (0-based). */
  spawns: Vec2[];
}

/**
 * Parses a MapDef grid into a tile matrix plus spawn points.
 * '?' tiles roll a crate with RANDOM_CRATE_CHANCE using the given seed, so
 * every peer that parses with the same seed sees the same arena.
 * Spawn tiles and their orthogonal neighbors are always kept crate-free.
 */
export function parseMap(def: MapDef, seed: number): ParsedMap {
  validateShape(def);

  const rng = { rngState: seed | 0 };
  const grid: Tile[][] = [];
  const spawnBySlot = new Map<number, Vec2>();

  for (let r = 0; r < TILE_ROWS; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < TILE_COLS; c++) {
      const ch = def.grid[r][c];
      switch (ch) {
        case '#':
          row.push('wall');
          break;
        case '*':
          row.push('crate');
          break;
        case '?':
          row.push(rand(rng) < RANDOM_CRATE_CHANCE ? 'crate' : 'floor');
          break;
        case '.':
          row.push('floor');
          break;
        default: {
          const slot = parseInt(ch, 10);
          if (Number.isNaN(slot) || slot < 1 || slot > MAX_SLOTS) {
            throw new Error(`map ${def.id}: invalid tile '${ch}' at ${c},${r}`);
          }
          if (spawnBySlot.has(slot - 1)) {
            throw new Error(`map ${def.id}: duplicate spawn ${slot}`);
          }
          spawnBySlot.set(slot - 1, { x: c, y: r });
          row.push('floor');
        }
      }
    }
    grid.push(row);
  }

  if (spawnBySlot.size !== MAX_SLOTS) {
    throw new Error(
      `map ${def.id}: expected ${MAX_SLOTS} spawns, found ${spawnBySlot.size}`
    );
  }

  const spawns: Vec2[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    spawns.push(spawnBySlot.get(slot)!);
  }

  clearAroundSpawns(grid, spawns);
  return { grid, spawns };
}

function validateShape(def: MapDef): void {
  if (def.grid.length !== TILE_ROWS) {
    throw new Error(`map ${def.id}: expected ${TILE_ROWS} rows`);
  }
  def.grid.forEach((row, r) => {
    if (row.length !== TILE_COLS) {
      throw new Error(`map ${def.id}: row ${r} must have ${TILE_COLS} tiles`);
    }
  });
  for (let c = 0; c < TILE_COLS; c++) {
    if (def.grid[0][c] !== '#' || def.grid[TILE_ROWS - 1][c] !== '#') {
      throw new Error(`map ${def.id}: top/bottom border must be walls`);
    }
  }
  for (let r = 0; r < TILE_ROWS; r++) {
    if (def.grid[r][0] !== '#' || def.grid[r][TILE_COLS - 1] !== '#') {
      throw new Error(`map ${def.id}: left/right border must be walls`);
    }
  }
}

function clearAroundSpawns(grid: Tile[][], spawns: Vec2[]): void {
  for (const s of spawns) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = s.x + dx;
      const y = s.y + dy;
      if (grid[y]?.[x] === 'crate') {
        grid[y][x] = 'floor';
      }
    }
  }
}
