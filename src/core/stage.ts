import {
  CAMPAIGN_STAGES,
  MONSTER_BASE_COUNT,
  MONSTER_COUNT_STEP,
  MONSTER_ROUND_SPEED,
  MONSTER_SAFE_RADIUS,
  ROUNDS_PER_THEME,
  STAGE_CRATE_BASE,
  STAGE_CRATE_STEP,
  STAGE_TIME_BASE,
  STAGE_TIME_STEP,
  TILE_COLS,
  TILE_ROWS,
} from './constants';
import { DIRS } from './geometry';
import { MONSTER_TRAITS, MONSTER_TUNING } from './monsters';
import { randInt, type RngCarrier } from './rng';
import type {
  AiDifficulty,
  CampaignSetup,
  MapDef,
  MonsterSpawn,
  MonsterSpecies,
  PowerUpType,
  Vec2,
} from './types';

export interface GeneratedStage {
  /**
   * The stage as a playable map. It keeps the theme map's id on purpose: the
   * renderer and the rankings both resolve a map by that id, so a generated
   * stage inherits its arena's look and its score table for free.
   */
  def: MapDef;
  campaign: CampaignSetup;
}

/**
 * The guaranteed item hidden under a brick, by round. Early stages teach the
 * three classic upgrades before the exotic ones show up.
 */
const STAGE_ITEM_POOL: PowerUpType[][] = [
  ['bomb', 'flame', 'speed'],
  ['bomb', 'flame', 'speed', 'bombpass'],
  ['bomb', 'flame', 'speed', 'bombpass', 'flamepass', 'detonator'],
  ['flame', 'speed', 'flamepass', 'wallpass', 'detonator', 'mystery'],
  ['flame', 'speed', 'wallpass', 'detonator', 'mystery', 'life'],
];

/** Species pools per round. Repeats act as weights. */
const ROUND_SPECIES: MonsterSpecies[][] = [
  ['balloom', 'balloom', 'onil'],
  ['balloom', 'onil', 'onil', 'dahl'],
  ['onil', 'dahl', 'dahl', 'minvo', 'ovape'],
  ['dahl', 'minvo', 'minvo', 'ovape', 'pass'],
  ['minvo', 'ovape', 'pass', 'pass', 'pontan'],
];

/**
 * Ladder position to theme and round. Stages 1..10 are round 1 across the ten
 * themes, 11..20 are round 2, and so on, so the difficulty ramp is felt across
 * the whole map catalog rather than five stages at a time.
 */
export function stageAt(
  index: number,
  themeCount: number
): { themeIndex: number; round: number } {
  const stage = clampStage(index);
  const themes = Math.max(1, themeCount);
  return {
    themeIndex: (stage - 1) % themes,
    round: Math.min(ROUNDS_PER_THEME, Math.floor((stage - 1) / themes) + 1),
  };
}

export function clampStage(stage: number): number {
  if (!Number.isFinite(stage)) return 1;
  return Math.min(CAMPAIGN_STAGES, Math.max(1, Math.floor(stage)));
}

/** Deterministic in (theme, round, stage, seed): same inputs, same stage. */
export function generateStage(
  theme: MapDef,
  round: number,
  stage: number,
  seed: number,
  difficulty: AiDifficulty
): GeneratedStage {
  const rng: RngCarrier = {
    rngState:
      (seed ^ Math.imul(round, 0x9e3779b9) ^ Math.imul(stage, 0x85ebca6b)) | 0,
  };

  // The theme supplies the wall skeleton and the spawn digits; everything the
  // generator decides is written on top of it.
  const cells = theme.grid.map((row) => [...row]);
  const spawns: Vec2[] = [];
  for (let y = 0; y < TILE_ROWS; y++) {
    for (let x = 0; x < TILE_COLS; x++) {
      const ch = cells[y][x];
      if (ch === '#') continue;
      const slot = parseInt(ch, 10);
      if (!Number.isNaN(slot)) spawns.push({ x, y });
      // Wipe the theme's own crates; only '#', '.' and the digits survive.
      if (ch === '*' || ch === '?') cells[y][x] = '.';
    }
  }

  const candidates = crateCandidates(cells, spawns);
  shuffle(candidates, rng);

  const density = STAGE_CRATE_BASE + STAGE_CRATE_STEP * (round - 1);
  const crateCount = Math.max(8, Math.round(candidates.length * density));
  const crates = candidates.slice(0, crateCount);
  for (const c of crates) cells[c.y][c.x] = '*';

  keepSpawnBreathable(cells, spawns[0]);
  const placed = crates.filter((c) => cells[c.y][c.x] === '*');

  const exitIndex = randInt(rng, placed.length);
  let hiddenIndex = randInt(rng, placed.length);
  if (hiddenIndex === exitIndex) hiddenIndex = (hiddenIndex + 1) % placed.length;
  const exit = placed[exitIndex];
  const hiddenTile = placed[hiddenIndex];

  const pool = STAGE_ITEM_POOL[Math.min(round, STAGE_ITEM_POOL.length) - 1];
  const hidden = {
    x: hiddenTile.x,
    y: hiddenTile.y,
    type: pool[randInt(rng, pool.length)],
  };

  const monsters = placeMonsters(cells, spawns[0], round, difficulty, rng);

  return {
    def: {
      id: theme.id,
      name: `${theme.name} — Round ${round}`,
      district: theme.district,
      description: theme.description,
      grid: cells.map((row) => row.join('')),
    },
    campaign: {
      themeId: theme.id,
      round,
      stage: clampStage(stage),
      timeLimit: STAGE_TIME_BASE - STAGE_TIME_STEP * (round - 1),
      exit,
      hidden,
      monsters,
      difficulty,
    },
  };
}

/** Open tiles that may hold a crate: never a spawn or one of its neighbors,
 * which mirrors what parseMap's clearAroundSpawns would strip anyway. */
function crateCandidates(cells: string[][], spawns: Vec2[]): Vec2[] {
  const reserved = new Set<string>();
  for (const s of spawns) {
    reserved.add(`${s.x},${s.y}`);
    for (const d of DIRS) reserved.add(`${s.x + d.x},${s.y + d.y}`);
  }

  const tiles: Vec2[] = [];
  for (let y = 0; y < TILE_ROWS; y++) {
    for (let x = 0; x < TILE_COLS; x++) {
      if (cells[y][x] !== '.') continue;
      if (reserved.has(`${x},${y}`)) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

function shuffle(tiles: Vec2[], rng: RngCarrier): void {
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const swap = tiles[i];
    tiles[i] = tiles[j];
    tiles[j] = swap;
  }
}

/** The player's spawn keeps at least two open escape directions, the same
 * guarantee the hand-authored maps are tested for. */
function keepSpawnBreathable(cells: string[][], spawn: Vec2): void {
  const open = () =>
    DIRS.filter((d) => cells[spawn.y + d.y]?.[spawn.x + d.x] === '.');

  for (const d of DIRS) {
    if (open().length >= 2) return;
    const x = spawn.x + d.x;
    const y = spawn.y + d.y;
    if (cells[y]?.[x] === '*') cells[y][x] = '.';
  }
}

function placeMonsters(
  cells: string[][],
  spawn: Vec2,
  round: number,
  difficulty: AiDifficulty,
  rng: RngCarrier
): MonsterSpawn[] {
  const count =
    MONSTER_BASE_COUNT + MONSTER_COUNT_STEP * (round - 1) + randInt(rng, 2);
  const pool = ROUND_SPECIES[Math.min(round, ROUND_SPECIES.length) - 1];
  const speedScale =
    MONSTER_TUNING[difficulty].speedScale *
    (1 + MONSTER_ROUND_SPEED * (round - 1));

  const free: Vec2[] = [];
  for (let y = 0; y < TILE_ROWS; y++) {
    for (let x = 0; x < TILE_COLS; x++) {
      if (cells[y][x] === '.') free.push({ x, y });
    }
  }
  shuffle(free, rng);

  // Monsters start away from the player. Tight maps relax the ring rather
  // than dropping monsters, so every stage keeps its intended pressure.
  let tiles: Vec2[] = [];
  for (let radius = MONSTER_SAFE_RADIUS; radius >= 2; radius--) {
    tiles = free.filter(
      (t) =>
        Math.max(Math.abs(t.x - spawn.x), Math.abs(t.y - spawn.y)) >= radius
    );
    if (tiles.length >= count) break;
  }

  const monsters: MonsterSpawn[] = [];
  for (let i = 0; i < Math.min(count, tiles.length); i++) {
    const species = pool[randInt(rng, pool.length)];
    monsters.push({
      species,
      at: tiles[i],
      speed: MONSTER_TRAITS[species].speed * speedScale,
      dir: { ...DIRS[randInt(rng, DIRS.length)] },
    });
  }
  return monsters;
}
