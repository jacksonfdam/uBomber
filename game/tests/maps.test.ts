import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_SLOTS, TILE_COLS, TILE_ROWS } from '../src/core/constants';
import { parseMap } from '../src/core/map';
import type { MapDef, Tile } from '../src/core/types';

const MAPS_DIR = join(__dirname, '..', 'maps');

function loadIndex(): string[] {
  return JSON.parse(readFileSync(join(MAPS_DIR, 'index.json'), 'utf8')).maps;
}

function loadMap(id: string): MapDef {
  return JSON.parse(readFileSync(join(MAPS_DIR, `${id}.json`), 'utf8'));
}

describe('map catalog', () => {
  it('ships exactly 10 maps and the index matches the files on disk', () => {
    const ids = loadIndex();
    expect(ids).toHaveLength(10);
    const files = readdirSync(MAPS_DIR)
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .map((f) => f.replace('.json', ''))
      .sort();
    expect([...ids].sort()).toEqual(files);
  });

  it('every map id matches its filename and has full metadata', () => {
    for (const id of loadIndex()) {
      const def = loadMap(id);
      expect(def.id).toBe(id);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.district.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      for (const color of Object.values(def.theme)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe.each(loadIndex())('map %s', (id) => {
  const def = loadMap(id);

  it(`is ${TILE_COLS}x${TILE_ROWS} and parses with any seed`, () => {
    for (const seed of [1, 42, 123456789]) {
      const { grid, spawns } = parseMap(def, seed);
      expect(grid).toHaveLength(TILE_ROWS);
      expect(grid[0]).toHaveLength(TILE_COLS);
      expect(spawns).toHaveLength(MAX_SLOTS);
    }
  });

  it('parses deterministically for the same seed', () => {
    const a = parseMap(def, 777);
    const b = parseMap(def, 777);
    expect(a.grid).toEqual(b.grid);
  });

  it('gives every spawn at least two open escape directions', () => {
    const { grid, spawns } = parseMap(def, 1);
    for (const s of spawns) {
      const open = neighbors(s.x, s.y).filter(
        ([x, y]) => grid[y]?.[x] !== undefined && grid[y][x] !== 'wall'
      );
      expect(open.length, `spawn at ${s.x},${s.y}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps all spawns connected (crates are bombable, walls are not)', () => {
    const { grid, spawns } = parseMap(def, 1);
    const reached = floodFill(grid, spawns[0].x, spawns[0].y);
    for (const s of spawns) {
      expect(reached.has(`${s.x},${s.y}`), `spawn ${s.x},${s.y}`).toBe(true);
    }
  });
});

function neighbors(x: number, y: number): Array<[number, number]> {
  return [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];
}

function floodFill(grid: Tile[][], sx: number, sy: number): Set<string> {
  const reached = new Set<string>([`${sx},${sy}`]);
  const queue: Array<[number, number]> = [[sx, sy]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [nx, ny] of neighbors(x, y)) {
      const key = `${nx},${ny}`;
      if (reached.has(key)) continue;
      if (grid[ny]?.[nx] === undefined || grid[ny][nx] === 'wall') continue;
      reached.add(key);
      queue.push([nx, ny]);
    }
  }
  return reached;
}
