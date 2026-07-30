import {
  BASE_BOMB_CAP,
  BASE_FLAME_RANGE,
  BASE_SPEED,
  BOMB_FUSE,
  FLAME_TTL,
  MATCH_TIME_SECONDS,
  MAX_BOMB_CAP,
  MAX_FLAME_RANGE,
  MAX_SLOTS,
  MAX_SPEED,
  PLAYER_RADIUS,
  POWERUP_DROP_CHANCE,
  SPEED_INCREMENT,
  TILE_COLS,
  TILE_ROWS,
} from './constants';
import { parseMap } from './map';
import { rand } from './rng';
import type {
  BombState,
  GameState,
  MapDef,
  PlayerInput,
  PlayerState,
  PowerUpType,
  RosterEntry,
  Vec2,
} from './types';

const EPS = 1e-4;
const DIRS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** Builds the initial state for a match. Same map + roster + seed on every
 * peer produces the same arena. */
export function createGame(
  def: MapDef,
  roster: RosterEntry[],
  seed: number
): GameState {
  if (roster.length < 2 || roster.length > MAX_SLOTS) {
    throw new Error(`roster must have 2..${MAX_SLOTS} players`);
  }
  const { grid, spawns } = parseMap(def, seed);

  const players: PlayerState[] = roster.map((entry, slot) => ({
    id: slot,
    kind: entry.kind,
    name: entry.name,
    pos: { x: spawns[slot].x + 0.5, y: spawns[slot].y + 0.5 },
    alive: true,
    speed: BASE_SPEED,
    bombCap: BASE_BOMB_CAP,
    flameRange: BASE_FLAME_RANGE,
    activeBombs: 0,
  }));

  return {
    tick: 0,
    time: 0,
    status: 'running',
    winner: null,
    grid,
    players,
    bombs: [],
    flames: [],
    powerups: [],
    nextBombId: 1,
    rngState: (seed ^ 0x9e3779b9) | 0,
  };
}

/** Advances the simulation by dt seconds. Mutates state in place. */
export function step(
  state: GameState,
  inputs: PlayerInput[],
  dt: number
): void {
  if (state.status !== 'running') return;
  state.tick++;
  state.time += dt;

  for (const p of state.players) {
    if (!p.alive) continue;
    const input = inputs[p.id] ?? { dx: 0, dy: 0, bomb: false };
    movePlayer(state, p, input, dt);
    if (input.bomb) tryPlaceBomb(state, p);
    pickUpPowerUp(state, p);
  }

  updateBombs(state, dt);
  updateFlames(state, dt);
  killPlayersInFlames(state);
  resolveOutcome(state, dt);
}

export function tileOf(pos: Vec2): Vec2 {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y) };
}

export function bombAt(
  state: GameState,
  x: number,
  y: number
): BombState | undefined {
  return state.bombs.find((b) => b.x === x && b.y === y);
}

export function flameAt(state: GameState, x: number, y: number): boolean {
  return state.flames.some((f) => f.x === x && f.y === y);
}

function isInside(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < TILE_COLS && y < TILE_ROWS;
}

/** A tile blocks `p` if it is a wall, a crate, or a bomb the player is not
 * currently standing on (you can walk off a bomb you just dropped, not back
 * onto it). */
function isSolidFor(
  state: GameState,
  x: number,
  y: number,
  p: PlayerState
): boolean {
  if (!isInside(x, y)) return true;
  if (state.grid[y][x] !== 'floor') return true;
  const bomb = bombAt(state, x, y);
  if (!bomb) return false;
  const here = tileOf(p.pos);
  return !(here.x === x && here.y === y);
}

/**
 * Grid-lane movement: the player moves along one axis at a time and is
 * gently re-centered on the perpendicular lane, which is what makes the
 * classic Bomberman handling feel snappy in corridors.
 */
function movePlayer(
  state: GameState,
  p: PlayerState,
  input: PlayerInput,
  dt: number
): void {
  let dx = Math.sign(input.dx);
  let dy = Math.sign(input.dy);
  if (dx !== 0 && dy !== 0) dy = 0;
  if (dx === 0 && dy === 0) return;

  const dist = p.speed * dt;
  const here = tileOf(p.pos);

  if (dx !== 0) {
    approach(p.pos, 'y', here.y + 0.5, dist);
    let nx = p.pos.x + dx * dist;
    const edgeTile = Math.floor(nx + dx * PLAYER_RADIUS);
    if (edgeTile !== here.x && isSolidFor(state, edgeTile, here.y, p)) {
      nx = dx > 0 ? edgeTile - PLAYER_RADIUS - EPS : edgeTile + 1 + PLAYER_RADIUS + EPS;
    }
    p.pos.x = nx;
  } else {
    approach(p.pos, 'x', here.x + 0.5, dist);
    let ny = p.pos.y + dy * dist;
    const edgeTile = Math.floor(ny + dy * PLAYER_RADIUS);
    if (edgeTile !== here.y && isSolidFor(state, here.x, edgeTile, p)) {
      ny = dy > 0 ? edgeTile - PLAYER_RADIUS - EPS : edgeTile + 1 + PLAYER_RADIUS + EPS;
    }
    p.pos.y = ny;
  }
}

function approach(pos: Vec2, axis: 'x' | 'y', target: number, maxDelta: number): void {
  const diff = target - pos[axis];
  if (Math.abs(diff) <= maxDelta) {
    pos[axis] = target;
  } else {
    pos[axis] += Math.sign(diff) * maxDelta;
  }
}

function tryPlaceBomb(state: GameState, p: PlayerState): void {
  if (p.activeBombs >= p.bombCap) return;
  const here = tileOf(p.pos);
  if (state.grid[here.y][here.x] !== 'floor') return;
  if (bombAt(state, here.x, here.y)) return;

  state.bombs.push({
    id: state.nextBombId++,
    owner: p.id,
    x: here.x,
    y: here.y,
    fuse: BOMB_FUSE,
    range: p.flameRange,
  });
  p.activeBombs++;
}

function pickUpPowerUp(state: GameState, p: PlayerState): void {
  const here = tileOf(p.pos);
  const idx = state.powerups.findIndex((u) => u.x === here.x && u.y === here.y);
  if (idx === -1) return;
  const [taken] = state.powerups.splice(idx, 1);
  applyPowerUp(p, taken.type);
}

function applyPowerUp(p: PlayerState, type: PowerUpType): void {
  switch (type) {
    case 'bomb':
      p.bombCap = Math.min(MAX_BOMB_CAP, p.bombCap + 1);
      break;
    case 'flame':
      p.flameRange = Math.min(MAX_FLAME_RANGE, p.flameRange + 1);
      break;
    case 'speed':
      p.speed = Math.min(MAX_SPEED, p.speed + SPEED_INCREMENT);
      break;
  }
}

function updateBombs(state: GameState, dt: number): void {
  for (const b of state.bombs) b.fuse -= dt;

  const queue = state.bombs.filter((b) => b.fuse <= 0);
  if (queue.length === 0) return;

  const exploded = new Set<number>();
  const flameTiles: Vec2[] = [];
  const crushedCrates: Vec2[] = [];

  while (queue.length > 0) {
    const bomb = queue.shift()!;
    if (exploded.has(bomb.id)) continue;
    exploded.add(bomb.id);
    flameTiles.push({ x: bomb.x, y: bomb.y });

    for (const dir of DIRS) {
      for (let r = 1; r <= bomb.range; r++) {
        const x = bomb.x + dir.x * r;
        const y = bomb.y + dir.y * r;
        if (!isInside(x, y) || state.grid[y][x] === 'wall') break;

        if (state.grid[y][x] === 'crate') {
          crushedCrates.push({ x, y });
          flameTiles.push({ x, y });
          break;
        }

        const other = bombAt(state, x, y);
        if (other && !exploded.has(other.id)) {
          other.fuse = 0;
          queue.push(other);
          flameTiles.push({ x, y });
          break;
        }

        const powerup = state.powerups.findIndex((u) => u.x === x && u.y === y);
        if (powerup !== -1) {
          state.powerups.splice(powerup, 1);
          flameTiles.push({ x, y });
          break;
        }

        flameTiles.push({ x, y });
      }
    }
  }

  // Return capacity to owners and clear the detonated bombs.
  for (const b of state.bombs) {
    if (!exploded.has(b.id)) continue;
    const owner = state.players[b.owner];
    if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
  }
  state.bombs = state.bombs.filter((b) => !exploded.has(b.id));

  for (const t of flameTiles) {
    state.flames.push({ x: t.x, y: t.y, ttl: FLAME_TTL });
  }

  // Crates burn down after flames are laid so a crate's own power-up is not
  // consumed by the blast that revealed it.
  for (const c of crushedCrates) {
    state.grid[c.y][c.x] = 'floor';
    if (rand(state) < POWERUP_DROP_CHANCE) {
      state.powerups.push({ x: c.x, y: c.y, type: rollPowerUp(state) });
    }
  }
}

function rollPowerUp(state: GameState): PowerUpType {
  const roll = rand(state);
  if (roll < 0.4) return 'bomb';
  if (roll < 0.8) return 'flame';
  return 'speed';
}

function updateFlames(state: GameState, dt: number): void {
  for (const f of state.flames) f.ttl -= dt;
  state.flames = state.flames.filter((f) => f.ttl > 0);
}

function killPlayersInFlames(state: GameState): void {
  for (const p of state.players) {
    if (!p.alive) continue;
    const here = tileOf(p.pos);
    if (flameAt(state, here.x, here.y)) {
      p.alive = false;
    }
  }
}

function resolveOutcome(state: GameState, _dt: number): void {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length <= 1) {
    state.status = 'finished';
    state.winner = alive.length === 1 ? alive[0].id : null;
    return;
  }
  if (state.time >= MATCH_TIME_SECONDS) {
    state.status = 'finished';
    state.winner = null;
  }
}
