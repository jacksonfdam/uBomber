import { describe, expect, it } from 'vitest';
import { MAX_SLOTS, TILE_COLS, TILE_ROWS } from '../src/core/constants';
import { parseMap } from '../src/core/map';
import type { Tile } from '../src/core/types';
import { MAPS, MAP_IDS, mapById } from '../src/maps';

/**
 * Walks a theme and yields every hex colour it contains, so a typo in any
 * nested palette fails the suite instead of silently rendering black.
 */
function colorsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.startsWith('#')) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) colorsOf(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) colorsOf(item, out);
  }
  return out;
}

describe('map catalog', () => {
  it('ships exactly 10 maps with unique ids', () => {
    expect(MAPS).toHaveLength(10);
    expect(new Set(MAP_IDS).size).toBe(10);
  });

  it('resolves every id back to its entry', () => {
    for (const id of MAP_IDS) {
      expect(mapById(id)?.def.id).toBe(id);
    }
  });

  it('gives every map full metadata', () => {
    for (const { def } of MAPS) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.district.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  /**
   * The distinctness rules. Ten arenas that share a tileset or a floor colour
   * read as one arena recoloured, which is exactly what the procedural theme
   * contract exists to prevent — so it is enforced, not just intended.
   */
  it('never reuses a tileset across maps', () => {
    const tilesets = MAPS.map((entry) => entry.theme.tileset);
    expect(new Set(tilesets).size).toBe(MAPS.length);
  });

  it('never reuses a base floor colour across maps', () => {
    const floors = MAPS.map((entry) => entry.theme.floor.base.toLowerCase());
    expect(new Set(floors).size).toBe(MAPS.length);
  });

  it('never reuses an ambient bed across maps', () => {
    const beds = MAPS.map((entry) => entry.theme.ambient);
    expect(new Set(beds).size).toBe(MAPS.length);
  });
});

describe.each(MAPS.map((entry) => entry.def.id))('map %s', (id) => {
  const entry = mapById(id)!;
  const { def, theme } = entry;

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

  it('has a well-formed theme the renderer can consume', () => {
    // Six-digit hex only: the shaders concatenate alpha onto these strings.
    for (const color of colorsOf(theme)) {
      expect(color, `${id} colour ${color}`).toMatch(/^#[0-9a-f]{6}$/i);
    }

    expect(theme.skyline).toHaveLength(2);
    for (const layer of theme.skyline) {
      expect(layer.height).toBeGreaterThan(0);
      expect(layer.height).toBeLessThanOrEqual(1);
    }

    // The crate interior must differ from its surface, or destruction reads
    // as a flat cut-out instead of exposed material.
    expect(theme.crate.interior).not.toBe(theme.crate.front);

    expect(theme.grading.gain).toHaveLength(3);
    expect(theme.grading.lift).toHaveLength(3);
    expect(theme.grading.saturation).toBeGreaterThan(0);
    expect(theme.grading.vignette).toBeGreaterThanOrEqual(0);
    expect(theme.bloom).toBeGreaterThanOrEqual(0);

    expect(theme.music.scale.length).toBeGreaterThan(2);
    expect(theme.music.root).toBeGreaterThan(20);
    expect(theme.music.root).toBeLessThan(100);
    expect(theme.music.tempo).toBeGreaterThan(40);
    expect(theme.music.tempo).toBeLessThan(220);
    expect(theme.music.brightness).toBeGreaterThanOrEqual(0);
    expect(theme.music.brightness).toBeLessThanOrEqual(1);

    // A zero light direction would make every bevel unlit.
    expect(Math.abs(theme.lightDir.x) + Math.abs(theme.lightDir.y)).toBeGreaterThan(0.1);
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
