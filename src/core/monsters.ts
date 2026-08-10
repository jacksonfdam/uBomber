import {
  MONSTER_DEATH_FADE,
  MONSTER_ERRATIC_BIAS,
  MONSTER_STRAIGHT_BIAS,
  MONSTER_TOUCH,
} from './constants';
import { approach, DIRS, isInside, tileOf } from './geometry';
import { rand, randInt } from './rng';
import type {
  AiDifficulty,
  GameState,
  MonsterSpecies,
  MonsterState,
  PlayerState,
  Vec2,
} from './types';

/**
 * Campaign monsters are the classic Bomberman creeps: no pathfinding and no
 * memory, just a heading and a decision rule applied at tile centers. Their
 * whole brain is `dir`, which is why they live in the simulation (and in the
 * snapshot) instead of in a controller object like the bots.
 */
export interface MonsterTraits {
  /** Tiles per second at round 1 on normal difficulty. */
  speed: number;
  /** Chance of turning toward the player at a junction. 0 = pure wanderer. */
  chase: number;
  /** Manhattan range within which `chase` applies. */
  sight: number;
  /** Walks through crates. Never through walls or bombs. */
  wallPass: boolean;
  /** Points awarded to whoever blew it up. */
  score: number;
}

export const MONSTER_TRAITS: Record<MonsterSpecies, MonsterTraits> = {
  balloom: { speed: 1.0, chase: 0.0, sight: 0, wallPass: false, score: 100 },
  onil: { speed: 1.4, chase: 0.35, sight: 6, wallPass: false, score: 150 },
  dahl: { speed: 1.9, chase: 0.15, sight: 4, wallPass: false, score: 200 },
  minvo: { speed: 2.1, chase: 0.55, sight: 8, wallPass: false, score: 300 },
  ovape: { speed: 1.2, chase: 0.45, sight: 8, wallPass: true, score: 400 },
  pass: { speed: 2.4, chase: 0.7, sight: 10, wallPass: false, score: 600 },
  pontan: { speed: 2.8, chase: 0.9, sight: 99, wallPass: true, score: 900 },
};

export interface MonsterTuning {
  speedScale: number;
  chaseScale: number;
  sightScale: number;
}

export const MONSTER_TUNING: Record<AiDifficulty, MonsterTuning> = {
  easy: { speedScale: 0.85, chaseScale: 0.6, sightScale: 0.7 },
  normal: { speedScale: 1.0, chaseScale: 1.0, sightScale: 1.0 },
  hard: { speedScale: 1.2, chaseScale: 1.4, sightScale: 1.5 },
};

/** Monsters always come to rest exactly on a center, so this only absorbs
 * floating-point drift from the lane snapping. */
const CENTER_EPS = 1e-6;

/** The first tile center strictly ahead of `pos` along `dir`. */
function centerAhead(pos: number, dir: number): number {
  return dir > 0 ? Math.floor(pos + 0.5) + 0.5 : Math.ceil(pos - 0.5) - 0.5;
}

export function monsterTuning(state: GameState): MonsterTuning {
  return MONSTER_TUNING[state.campaign?.difficulty ?? 'normal'];
}

/** Walls always stop a monster, crates only stop the ones without wall pass,
 * and bombs stop everything — which is what makes bomb-trapping work. */
function solidForMonster(
  state: GameState,
  x: number,
  y: number,
  traits: MonsterTraits
): boolean {
  if (!isInside(x, y)) return true;
  const tile = state.grid[y][x];
  if (tile === 'wall') return true;
  if (tile === 'crate' && !traits.wallPass) return true;
  return state.bombs.some((b) => b.x === x && b.y === y);
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Nearest living player by Manhattan distance; ties go to the lower slot. */
function nearestPlayerTile(state: GameState, from: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDist = Infinity;
  for (const p of state.players) {
    if (!p.alive) continue;
    const tile = tileOf(p.pos);
    const dist = manhattan(from, tile);
    if (dist >= bestDist) continue;
    bestDist = dist;
    best = tile;
  }
  return best;
}

function straightBias(species: MonsterSpecies): number {
  return species === 'dahl' ? MONSTER_ERRATIC_BIAS : MONSTER_STRAIGHT_BIAS;
}

/** Picks the heading for the tile the monster just arrived at. */
function chooseDir(
  state: GameState,
  m: MonsterState,
  traits: MonsterTraits,
  tuning: MonsterTuning
): void {
  const tile = tileOf(m.pos);
  const open = DIRS.filter(
    (d) => !solidForMonster(state, tile.x + d.x, tile.y + d.y, traits)
  );
  if (open.length === 0) {
    m.dir = { x: -m.dir.x, y: -m.dir.y };
    return;
  }

  const target = nearestPlayerTile(state, tile);
  const chase = Math.min(1, traits.chase * tuning.chaseScale);
  const sight = traits.sight * tuning.sightScale;
  if (target && manhattan(tile, target) <= sight && rand(state) < chase) {
    let best = open[0];
    let bestDist = Infinity;
    for (const d of open) {
      const dist = manhattan({ x: tile.x + d.x, y: tile.y + d.y }, target);
      if (dist >= bestDist) continue;
      bestDist = dist;
      best = d;
    }
    m.dir = { x: best.x, y: best.y };
    return;
  }

  const forward = open.find((d) => d.x === m.dir.x && d.y === m.dir.y);
  if (forward && rand(state) < straightBias(m.species)) {
    m.dir = { x: forward.x, y: forward.y };
    return;
  }

  const nonReverse = open.filter(
    (d) => !(d.x === -m.dir.x && d.y === -m.dir.y)
  );
  const pool = nonReverse.length > 0 ? nonReverse : open;
  const pick = pool[randInt(state, pool.length)];
  m.dir = { x: pick.x, y: pick.y };
}

/** Advances every monster. A no-op — and free of RNG draws — in deathmatch. */
export function updateMonsters(state: GameState, dt: number): void {
  if (state.monsters.length === 0) return;
  const tuning = monsterTuning(state);

  for (const m of state.monsters) {
    if (!m.alive) {
      m.dyingFor = Math.max(0, m.dyingFor - dt);
      continue;
    }

    const traits = MONSTER_TRAITS[m.species];
    const dist = m.speed * dt;
    const tile = tileOf(m.pos);
    const axis = m.dir.x !== 0 ? 'x' : 'y';
    const lane = axis === 'x' ? 'y' : 'x';

    // Stay on the lane, exactly like players do.
    approach(m.pos, lane, (lane === 'x' ? tile.x : tile.y) + 0.5, dist);

    const center = tile[axis] + 0.5;
    const atCenter = Math.abs(m.pos[axis] - center) < CENTER_EPS;
    const ahead = { x: tile.x + m.dir.x, y: tile.y + m.dir.y };

    // Decisions happen on tile centers, so a blocked monster turns in place.
    if (atCenter && solidForMonster(state, ahead.x, ahead.y, traits)) {
      chooseDir(state, m, traits, tuning);
      continue;
    }

    const nextCenter = centerAhead(m.pos[axis], m.dir[axis]);
    const after = m.pos[axis] + m.dir[axis] * dist;
    const reached = m.dir[axis] > 0 ? after >= nextCenter : after <= nextCenter;
    m.pos[axis] = reached ? nextCenter : after;
    if (reached) chooseDir(state, m, traits, tuning);
  }

  state.monsters = state.monsters.filter((m) => m.alive || m.dyingFor > 0);
}

/** Kills monsters caught in a blast and credits the flame owner. */
export function killMonstersInFlames(state: GameState): void {
  for (const m of state.monsters) {
    if (!m.alive) continue;
    const tile = tileOf(m.pos);
    const flame = state.flames.find((f) => f.x === tile.x && f.y === tile.y);
    if (!flame) continue;

    m.alive = false;
    m.dyingFor = MONSTER_DEATH_FADE;
    const killer = state.players[flame.owner];
    if (killer) killer.score += MONSTER_TRAITS[m.species].score;
  }
}

/** True when a living monster is close enough to `p` to kill them. */
export function monsterTouching(state: GameState, p: PlayerState): boolean {
  return state.monsters.some(
    (m) =>
      m.alive &&
      m.dyingFor === 0 &&
      Math.abs(m.pos.x - p.pos.x) < MONSTER_TOUCH &&
      Math.abs(m.pos.y - p.pos.y) < MONSTER_TOUCH
  );
}

/** Adds monsters at the given tiles, scaled like the ones the stage started with. */
export function spawnMonsters(
  state: GameState,
  species: MonsterSpecies,
  tiles: Vec2[]
): void {
  const traits = MONSTER_TRAITS[species];
  const tuning = monsterTuning(state);
  for (const tile of tiles) {
    state.monsters.push({
      id: state.nextMonsterId++,
      species,
      pos: { x: tile.x + 0.5, y: tile.y + 0.5 },
      dir: { ...DIRS[randInt(state, DIRS.length)] },
      speed: traits.speed * tuning.speedScale,
      alive: true,
      dyingFor: 0,
    });
  }
}

/** Free floor tiles nearest to `from`, used for exit enrage waves. */
export function tilesAround(
  state: GameState,
  from: Vec2,
  count: number
): Vec2[] {
  const found: Vec2[] = [];
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: Vec2[] = [from];

  while (queue.length > 0 && found.length < count) {
    const at = queue.shift() as Vec2;
    for (const d of DIRS) {
      const next = { x: at.x + d.x, y: at.y + d.y };
      const key = `${next.x},${next.y}`;
      if (seen.has(key) || !isInside(next.x, next.y)) continue;
      seen.add(key);
      if (state.grid[next.y][next.x] !== 'floor') continue;
      queue.push(next);
      // Spawning into the blast that summoned them would kill them instantly.
      if (state.flames.some((f) => f.x === next.x && f.y === next.y)) continue;
      found.push(next);
      if (found.length >= count) break;
    }
  }
  return found;
}

/** Free floor tiles as far as possible from `from`, for the time-up wave. */
export function tilesFarFrom(
  state: GameState,
  from: Vec2,
  count: number
): Vec2[] {
  const open: Vec2[] = [];
  for (let y = 0; y < state.grid.length; y++) {
    for (let x = 0; x < state.grid[y].length; x++) {
      if (state.grid[y][x] === 'floor') open.push({ x, y });
    }
  }
  open.sort((a, b) => {
    const byDist = manhattan(b, from) - manhattan(a, from);
    return byDist !== 0 ? byDist : a.y - b.y || a.x - b.x;
  });
  return open.slice(0, count);
}
