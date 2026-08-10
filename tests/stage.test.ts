import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_STAGES,
  MAX_SLOTS,
  ROUNDS_PER_THEME,
  TILE_COLS,
  TILE_ROWS,
} from '../src/core/constants';
import { createGame } from '../src/core/game';
import { DIRS } from '../src/core/geometry';
import { parseMap } from '../src/core/map';
import { generateStage, stageAt } from '../src/core/stage';
import type { MapDef, Tile, Vec2 } from '../src/core/types';
import { MAPS } from '../src/maps';

const THEMES: MapDef[] = MAPS.map((entry) => entry.def);

const ROUNDS = [1, 2, 3, 4, 5];
const COMBOS = THEMES.flatMap((theme) =>
  ROUNDS.map((round) => [theme.id, round, theme] as const)
);

const SEED = 20260810;

/** Flood fill treating crates as passable, since they can be bombed through. */
function reachable(grid: Tile[][], from: Vec2): Set<string> {
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: Vec2[] = [from];
  while (queue.length > 0) {
    const at = queue.shift() as Vec2;
    for (const d of DIRS) {
      const next = { x: at.x + d.x, y: at.y + d.y };
      const key = `${next.x},${next.y}`;
      if (seen.has(key)) continue;
      if (grid[next.y]?.[next.x] === undefined) continue;
      if (grid[next.y][next.x] === 'wall') continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

describe('stageAt', () => {
  it('covers every theme and round exactly once', () => {
    const seen = new Set<string>();
    for (let stage = 1; stage <= CAMPAIGN_STAGES; stage++) {
      const { themeIndex, round } = stageAt(stage, THEMES.length);
      expect(themeIndex).toBeGreaterThanOrEqual(0);
      expect(themeIndex).toBeLessThan(THEMES.length);
      expect(round).toBeGreaterThanOrEqual(1);
      expect(round).toBeLessThanOrEqual(ROUNDS_PER_THEME);
      seen.add(`${themeIndex}-${round}`);
    }
    expect(seen.size).toBe(THEMES.length * ROUNDS_PER_THEME);
  });

  it('clamps out-of-range stages', () => {
    expect(stageAt(0, 10)).toEqual(stageAt(1, 10));
    expect(stageAt(999, 10)).toEqual(stageAt(CAMPAIGN_STAGES, 10));
  });
});

describe.each(COMBOS)('stage on %s round %i', (_id, round, theme) => {
  const { def, campaign } = generateStage(theme, round, round, SEED, 'normal');
  const parsed = parseMap(def, SEED);

  it('produces a playable map definition', () => {
    expect(def.grid).toHaveLength(TILE_ROWS);
    for (const row of def.grid) expect(row).toHaveLength(TILE_COLS);
    expect(parsed.spawns).toHaveLength(MAX_SLOTS);
  });

  it('leaves no random tiles, so parsing is seed independent', () => {
    expect(def.grid.join('')).not.toContain('?');
    const other = parseMap(def, SEED + 1);
    expect(other.grid).toEqual(parsed.grid);
  });

  it('keeps the theme identity so the renderer can resolve it', () => {
    expect(campaign.themeId).toBe(theme.id);
    expect(def.id).toBe(theme.id);
  });

  it('hides the exit and the stage item under two different crates', () => {
    expect(campaign.exit).not.toEqual({
      x: campaign.hidden.x,
      y: campaign.hidden.y,
    });
    expect(parsed.grid[campaign.exit.y][campaign.exit.x]).toBe('crate');
    expect(parsed.grid[campaign.hidden.y][campaign.hidden.x]).toBe('crate');
  });

  it('leaves the player at least two ways out', () => {
    const spawn = parsed.spawns[0];
    const open = DIRS.filter(
      (d) => parsed.grid[spawn.y + d.y]?.[spawn.x + d.x] === 'floor'
    );
    expect(open.length).toBeGreaterThanOrEqual(2);
  });

  it('starts monsters on the floor, away from the player', () => {
    expect(campaign.monsters.length).toBeGreaterThan(0);
    const spawn = parsed.spawns[0];
    for (const m of campaign.monsters) {
      expect(parsed.grid[m.at.y][m.at.x]).toBe('floor');
      const ring = Math.max(
        Math.abs(m.at.x - spawn.x),
        Math.abs(m.at.y - spawn.y)
      );
      expect(ring).toBeGreaterThanOrEqual(2);
      expect(m.speed).toBeGreaterThan(0);
    }
  });

  it('connects the spawn to the exit, the item and every monster', () => {
    const seen = reachable(parsed.grid, parsed.spawns[0]);
    expect(seen.has(`${campaign.exit.x},${campaign.exit.y}`)).toBe(true);
    expect(seen.has(`${campaign.hidden.x},${campaign.hidden.y}`)).toBe(true);
    for (const m of campaign.monsters) {
      expect(seen.has(`${m.at.x},${m.at.y}`)).toBe(true);
    }
  });

  it('boots a campaign match', () => {
    const state = createGame(def, [{ kind: 'human', name: 'A', lives: 3 }], SEED, {
      mode: 'campaign',
      campaign,
    });
    expect(state.status).toBe('running');
    expect(state.monsters).toHaveLength(campaign.monsters.length);
  });
});

describe('stage generation', () => {
  it('is deterministic and seed sensitive', () => {
    const a = generateStage(THEMES[0], 2, 12, SEED, 'normal');
    const b = generateStage(THEMES[0], 2, 12, SEED, 'normal');
    const c = generateStage(THEMES[0], 2, 12, SEED + 1, 'normal');

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.def.grid).not.toEqual(c.def.grid);
  });

  it('ramps crates and monsters up and the clock down across rounds', () => {
    let crates = -1;
    let monsters = -1;
    let timeLimit = Infinity;

    for (const round of ROUNDS) {
      const { def, campaign } = generateStage(
        THEMES[3],
        round,
        round,
        SEED,
        'normal'
      );
      const count = def.grid.join('').split('*').length - 1;
      expect(count).toBeGreaterThanOrEqual(crates);
      expect(campaign.monsters.length).toBeGreaterThanOrEqual(monsters);
      expect(campaign.timeLimit).toBeLessThanOrEqual(timeLimit);
      crates = count;
      monsters = campaign.monsters.length;
      timeLimit = campaign.timeLimit;
    }
  });

  it('scales monster speed with difficulty', () => {
    const speedOf = (difficulty: 'easy' | 'normal' | 'hard') =>
      generateStage(THEMES[0], 1, 1, SEED, difficulty).campaign.monsters[0]
        .speed;
    expect(speedOf('easy')).toBeLessThan(speedOf('normal'));
    expect(speedOf('hard')).toBeGreaterThan(speedOf('normal'));
  });
});
