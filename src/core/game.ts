import {
  BASE_BOMB_CAP,
  BASE_FLAME_RANGE,
  BASE_SPEED,
  BOMB_FUSE,
  CAMPAIGN_DROP_CHANCE,
  CURSE_DURATION,
  CURSE_MIN_RANGE,
  CURSE_SHORT_FUSE,
  CURSE_SLOW_SPEED,
  EXIT_ENRAGE_MAX,
  EXIT_ENRAGE_MONSTERS,
  FLAME_TTL,
  MATCH_TIME_SECONDS,
  MAX_BOMB_CAP,
  MAX_FLAME_RANGE,
  MAX_LIVES,
  MAX_SLOTS,
  MAX_SPEED,
  MYSTERY_DURATION,
  PLAYER_RADIUS,
  POWERUP_DROP_CHANCE,
  RESPAWN_DELAY,
  RESPAWN_INVULN,
  SCORE_CRATE,
  SCORE_KILL,
  SCORE_POWERUP,
  SCORE_STAGE_CLEAR,
  SCORE_SUICIDE,
  SCORE_TIME_BONUS,
  SCORE_WIN,
  SPEED_INCREMENT,
  SUDDEN_DEATH_INTERVAL,
  SUDDEN_DEATH_START,
  TILE_COLS,
  TILE_ROWS,
  TIME_UP_MONSTERS,
} from './constants';
import { approach, DIRS, isInside, tileOf } from './geometry';
import { parseMap } from './map';
import {
  killMonstersInFlames,
  monsterTouching,
  spawnMonsters,
  tilesAround,
  tilesFarFrom,
  updateMonsters,
} from './monsters';
import { rand, randInt } from './rng';
import type {
  BombState,
  CampaignState,
  CurseKind,
  GameState,
  MapDef,
  MatchConfig,
  MonsterSpecies,
  PlayerInput,
  PlayerState,
  PowerUpType,
  RosterEntry,
  Vec2,
} from './types';

const EPS = 1e-4;

// Re-exported so existing importers (bots, renderer, tests) keep working.
export { approach, DIRS, isInside, tileOf };

const DEATHMATCH: MatchConfig = { mode: 'deathmatch' };

/** Builds the initial state for a match. Same map + roster + seed on every
 * peer produces the same arena. */
export function createGame(
  def: MapDef,
  roster: RosterEntry[],
  seed: number,
  config: MatchConfig = DEATHMATCH
): GameState {
  // A campaign stage is one player against monsters; an arena needs two.
  const minPlayers = config.mode === 'campaign' ? 1 : 2;
  if (roster.length < minPlayers || roster.length > MAX_SLOTS) {
    throw new Error(`roster must have ${minPlayers}..${MAX_SLOTS} players`);
  }
  const setup = config.mode === 'campaign' ? config.campaign : undefined;
  if (config.mode === 'campaign' && !setup) {
    throw new Error('campaign matches need a CampaignSetup');
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
    score: 0,
    lives: Math.max(1, entry.lives ?? 1),
    maxLives: Math.max(1, entry.lives ?? 1),
    respawnIn: 0,
    invulnFor: 0,
    detonator: false,
    wallPass: false,
    bombPass: false,
    flamePass: false,
    invincibleFor: 0,
    curse: null,
    curseFor: 0,
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
    spawns,
    suddenDeathClosed: 0,
    rngState: (seed ^ 0x9e3779b9) | 0,
    mode: config.mode,
    campaign: setup
      ? {
          themeId: setup.themeId,
          round: setup.round,
          stage: setup.stage,
          timeLimit: setup.timeLimit,
          exit: { x: setup.exit.x, y: setup.exit.y },
          exitRevealed: false,
          exitEnraged: 0,
          hidden: { ...setup.hidden },
          timeUp: false,
          cleared: false,
          difficulty: setup.difficulty,
        }
      : null,
    monsters: setup
      ? setup.monsters.map((monster, index) => ({
          id: index + 1,
          species: monster.species,
          pos: { x: monster.at.x + 0.5, y: monster.at.y + 0.5 },
          dir: { x: monster.dir.x, y: monster.dir.y },
          speed: monster.speed,
          alive: true,
          dyingFor: 0,
        }))
      : [],
    nextMonsterId: setup ? setup.monsters.length + 1 : 1,
  };
}

/**
 * The order in which sudden-death walls close over the interior: a spiral
 * from the outer ring inward, matching the classic "hurry up!" behavior.
 */
export const SUDDEN_DEATH_ORDER: Vec2[] = (() => {
  const order: Vec2[] = [];
  let left = 1;
  let top = 1;
  let right = TILE_COLS - 2;
  let bottom = TILE_ROWS - 2;
  while (left <= right && top <= bottom) {
    for (let x = left; x <= right; x++) order.push({ x, y: top });
    for (let y = top + 1; y <= bottom; y++) order.push({ x: right, y });
    if (top < bottom) {
      for (let x = right - 1; x >= left; x--) order.push({ x, y: bottom });
    }
    if (left < right) {
      for (let y = bottom - 1; y > top; y--) order.push({ x: left, y });
    }
    left++;
    top++;
    right--;
    bottom--;
  }
  return order;
})();

/** Advances the simulation by dt seconds. Mutates state in place. */
export function step(
  state: GameState,
  inputs: PlayerInput[],
  dt: number
): void {
  if (state.status !== 'running') return;
  state.tick++;
  state.time += dt;
  updateStatusEffects(state, dt);

  for (const p of state.players) {
    if (!p.alive) continue;
    const input = inputs[p.id] ?? { dx: 0, dy: 0, bomb: false };
    movePlayer(state, p, input, dt);
    // The bomb-drop curse presses the button for you.
    if (input.bomb || p.curse === 'bomb-drop') tryPlaceBomb(state, p);
    // Runs before updateBombs so the blast lands on the same tick as the press.
    if (input.detonate === true) triggerDetonator(state, p);
    pickUpPowerUp(state, p);
  }

  updateMonsters(state, dt);
  updateBombs(state, dt);
  updateFlames(state, dt);
  killPlayersInFlames(state);
  killMonstersInFlames(state);
  killPlayersByMonsters(state);
  // Sudden death would wall over the exit door, so it is arena-only.
  if (state.mode === 'deathmatch') updateSuddenDeath(state);
  updateCampaignTimer(state);
  updateRespawns(state, dt);
  resolveOutcome(state, dt);
}

/** Speed after curses. Kept in one place so bots and the renderer agree. */
export function effectiveSpeed(p: PlayerState): number {
  return p.curse === 'slow' ? CURSE_SLOW_SPEED : p.speed;
}

/** Blast radius of the next bomb this player drops. */
export function effectiveRange(p: PlayerState): number {
  return p.curse === 'min-range' ? CURSE_MIN_RANGE : p.flameRange;
}

/** Fuse of the next bomb this player drops. */
export function effectiveFuse(p: PlayerState): number {
  return p.curse === 'short-fuse' ? CURSE_SHORT_FUSE : BOMB_FUSE;
}

/** Decays the timed buffs and curses. Respawn grace lives in updateRespawns. */
function updateStatusEffects(state: GameState, dt: number): void {
  for (const p of state.players) {
    p.invincibleFor = Math.max(0, p.invincibleFor - dt);
    if (p.curseFor <= 0) continue;
    p.curseFor = Math.max(0, p.curseFor - dt);
    if (p.curseFor === 0) p.curse = null;
  }
}

/** Classic campaign rule: dying costs you every power-up you had collected. */
function resetLoadout(p: PlayerState): void {
  p.speed = BASE_SPEED;
  p.bombCap = BASE_BOMB_CAP;
  p.flameRange = BASE_FLAME_RANGE;
  p.detonator = false;
  p.wallPass = false;
  p.bombPass = false;
  p.flamePass = false;
  p.invincibleFor = 0;
  p.curse = null;
  p.curseFor = 0;
}

/** Takes one life; players with lives left queue a respawn at their spawn. */
function loseLife(state: GameState, p: PlayerState): void {
  p.alive = false;
  p.lives = Math.max(0, p.lives - 1);
  // The arena keeps your kit across respawns; the campaign takes it away.
  if (state.mode === 'campaign') resetLoadout(p);
  if (p.lives > 0) p.respawnIn = RESPAWN_DELAY;
}

function updateRespawns(state: GameState, dt: number): void {
  for (const p of state.players) {
    if (p.alive) {
      p.invulnFor = Math.max(0, p.invulnFor - dt);
      continue;
    }
    if (p.lives <= 0 || p.respawnIn <= 0) continue;
    p.respawnIn -= dt;
    if (p.respawnIn > 0) continue;

    const spawn = state.spawns[p.id];
    // Sudden death may have walled the spawn over; then the life is lost too.
    if (!spawn || state.grid[spawn.y][spawn.x] !== 'floor') {
      p.lives = 0;
      continue;
    }
    p.alive = true;
    p.pos = { x: spawn.x + 0.5, y: spawn.y + 0.5 };
    p.invulnFor = RESPAWN_INVULN;
  }
}

/** From SUDDEN_DEATH_START on, walls close over the arena one tile at a
 * time, crushing players, bombs, power-ups and flames beneath them. */
function updateSuddenDeath(state: GameState): void {
  if (state.time <= SUDDEN_DEATH_START) return;
  const expected = Math.min(
    SUDDEN_DEATH_ORDER.length,
    Math.floor((state.time - SUDDEN_DEATH_START) / SUDDEN_DEATH_INTERVAL)
  );

  while (state.suddenDeathClosed < expected) {
    const t = SUDDEN_DEATH_ORDER[state.suddenDeathClosed++];
    state.grid[t.y][t.x] = 'wall';

    for (const b of state.bombs) {
      if (b.x === t.x && b.y === t.y) {
        const owner = state.players[b.owner];
        if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
      }
    }
    state.bombs = state.bombs.filter((b) => !(b.x === t.x && b.y === t.y));
    state.powerups = state.powerups.filter(
      (u) => !(u.x === t.x && u.y === t.y)
    );
    state.flames = state.flames.filter((f) => !(f.x === t.x && f.y === t.y));

    for (const p of state.players) {
      if (!p.alive) continue;
      const here = tileOf(p.pos);
      if (here.x === t.x && here.y === t.y) loseLife(state, p);
    }
  }
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
  const tile = state.grid[y][x];
  if (tile === 'wall') return true;
  if (tile === 'crate') return !p.wallPass;
  const bomb = bombAt(state, x, y);
  if (!bomb) return false;
  if (p.bombPass) return false;
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

  const dist = effectiveSpeed(p) * dt;
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
    fuse: effectiveFuse(p),
    range: effectiveRange(p),
    // Left undefined without the detonator so ordinary bombs serialize as before.
    remote: p.detonator || undefined,
  });
  p.activeBombs++;
}

/** Pops this player's oldest remote bomb, the classic one-press-per-bomb feel. */
function triggerDetonator(state: GameState, p: PlayerState): void {
  if (!p.detonator) return;
  let oldest: BombState | undefined;
  for (const b of state.bombs) {
    if (b.owner !== p.id || !b.remote) continue;
    if (!oldest || b.id < oldest.id) oldest = b;
  }
  if (!oldest) return;
  oldest.fuse = 0;
  oldest.remote = false;
}

function pickUpPowerUp(state: GameState, p: PlayerState): void {
  const here = tileOf(p.pos);
  const idx = state.powerups.findIndex((u) => u.x === here.x && u.y === here.y);
  if (idx === -1) return;
  const [taken] = state.powerups.splice(idx, 1);
  applyPowerUp(state, p, taken.type);
  p.score += SCORE_POWERUP;
}

/** One skull item; which curse you get is rolled when you touch it. */
const CURSES: CurseKind[] = ['short-fuse', 'min-range', 'slow', 'bomb-drop'];

function applyPowerUp(
  state: GameState,
  p: PlayerState,
  type: PowerUpType
): void {
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
    case 'detonator':
      p.detonator = true;
      break;
    case 'wallpass':
      p.wallPass = true;
      break;
    case 'bombpass':
      p.bombPass = true;
      break;
    case 'flamepass':
      p.flamePass = true;
      break;
    case 'mystery':
      p.invincibleFor = MYSTERY_DURATION;
      break;
    case 'life':
      p.lives = Math.min(MAX_LIVES, p.lives + 1);
      p.maxLives = Math.max(p.maxLives, p.lives);
      break;
    case 'curse':
      p.curse = CURSES[randInt(state, CURSES.length)];
      p.curseFor = CURSE_DURATION;
      break;
  }
}

function updateBombs(state: GameState, dt: number): void {
  // Remote bombs hold their fuse until triggered, but a blast still chains them.
  for (const b of state.bombs) if (!b.remote) b.fuse -= dt;

  const queue = state.bombs.filter((b) => b.fuse <= 0);
  if (queue.length === 0) return;

  const exploded = new Set<number>();
  const flameTiles: Array<Vec2 & { owner: number }> = [];
  const crushedCrates: Array<Vec2 & { owner: number }> = [];

  while (queue.length > 0) {
    const bomb = queue.shift()!;
    if (exploded.has(bomb.id)) continue;
    exploded.add(bomb.id);
    flameTiles.push({ x: bomb.x, y: bomb.y, owner: bomb.owner });

    for (const dir of DIRS) {
      for (let r = 1; r <= bomb.range; r++) {
        const x = bomb.x + dir.x * r;
        const y = bomb.y + dir.y * r;
        if (!isInside(x, y) || state.grid[y][x] === 'wall') break;

        if (state.grid[y][x] === 'crate') {
          crushedCrates.push({ x, y, owner: bomb.owner });
          flameTiles.push({ x, y, owner: bomb.owner });
          break;
        }

        const other = bombAt(state, x, y);
        if (other && !exploded.has(other.id)) {
          other.fuse = 0;
          other.remote = false;
          queue.push(other);
          flameTiles.push({ x, y, owner: bomb.owner });
          break;
        }

        const powerup = state.powerups.findIndex((u) => u.x === x && u.y === y);
        if (powerup !== -1) {
          state.powerups.splice(powerup, 1);
          flameTiles.push({ x, y, owner: bomb.owner });
          break;
        }

        flameTiles.push({ x, y, owner: bomb.owner });
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
    state.flames.push({ x: t.x, y: t.y, ttl: FLAME_TTL, owner: t.owner });
  }

  // Crates burn down after flames are laid so a crate's own power-up is not
  // consumed by the blast that revealed it.
  const campaign = state.campaign;
  // Checked before the crates burn, so the blast that uncovers the door does
  // not also count as angering it.
  if (campaign) enrageExit(state, campaign, flameTiles);

  for (const c of crushedCrates) {
    state.grid[c.y][c.x] = 'floor';
    const owner = state.players[c.owner];
    if (owner) owner.score += SCORE_CRATE;

    // The two special crates skip the drop roll entirely, which is also what
    // keeps the arena's draw order untouched.
    if (campaign && campaign.exit.x === c.x && campaign.exit.y === c.y) {
      campaign.exitRevealed = true;
      continue;
    }
    if (
      campaign &&
      campaign.hidden &&
      campaign.hidden.x === c.x &&
      campaign.hidden.y === c.y
    ) {
      state.powerups.push({ x: c.x, y: c.y, type: campaign.hidden.type });
      campaign.hidden = null;
      continue;
    }

    const chance =
      state.mode === 'campaign' ? CAMPAIGN_DROP_CHANCE : POWERUP_DROP_CHANCE;
    if (rand(state) < chance) {
      state.powerups.push({ x: c.x, y: c.y, type: rollPowerUp(state) });
    }
  }
}

/** Species the exit spits out when you bomb it, hardest the game has so far. */
function enrageSpecies(round: number): MonsterSpecies {
  if (round >= 4) return 'pontan';
  if (round >= 3) return 'pass';
  return 'minvo';
}

/**
 * Classic rule: blasting a revealed exit angers it and it coughs up more
 * monsters. Three times is enough to teach the lesson.
 */
function enrageExit(
  state: GameState,
  campaign: CampaignState,
  flameTiles: Array<Vec2 & { owner: number }>
): void {
  if (!campaign.exitRevealed || campaign.exitEnraged >= EXIT_ENRAGE_MAX) return;
  const hit = flameTiles.some(
    (f) => f.x === campaign.exit.x && f.y === campaign.exit.y
  );
  if (!hit) return;

  campaign.exitEnraged++;
  spawnMonsters(
    state,
    enrageSpecies(campaign.round),
    tilesAround(state, campaign.exit, EXIT_ENRAGE_MONSTERS)
  );
}

/** Once the clock runs out the stage does not end: pontans flood it instead. */
function updateCampaignTimer(state: GameState): void {
  const campaign = state.campaign;
  if (!campaign || campaign.timeUp || state.time < campaign.timeLimit) return;

  campaign.timeUp = true;
  const player = state.players[0];
  const from = player ? tileOf(player.pos) : campaign.exit;
  spawnMonsters(state, 'pontan', tilesFarFrom(state, from, TIME_UP_MONSTERS));
}

interface DropEntry {
  type: PowerUpType;
  weight: number;
}

/** The historical 40/40/20 split, spelled as weights. Arena balance is
 * untouched and the campaign-only items can never reach an online guest. */
const DEATHMATCH_DROPS: DropEntry[] = [
  { type: 'bomb', weight: 40 },
  { type: 'flame', weight: 40 },
  { type: 'speed', weight: 20 },
];

const CAMPAIGN_DROPS: DropEntry[] = [
  { type: 'bomb', weight: 26 },
  { type: 'flame', weight: 26 },
  { type: 'speed', weight: 14 },
  { type: 'bombpass', weight: 6 },
  { type: 'flamepass', weight: 5 },
  { type: 'wallpass', weight: 5 },
  { type: 'detonator', weight: 4 },
  { type: 'mystery', weight: 3 },
  { type: 'life', weight: 2 },
  { type: 'curse', weight: 9 },
];

/** Draws one power-up type. Exactly one rand() draw, whatever the mode. */
export function rollPowerUp(state: GameState): PowerUpType {
  const table = state.mode === 'campaign' ? CAMPAIGN_DROPS : DEATHMATCH_DROPS;
  let total = 0;
  for (const entry of table) total += entry.weight;

  let roll = rand(state) * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) return entry.type;
  }
  return table[table.length - 1].type;
}

function updateFlames(state: GameState, dt: number): void {
  for (const f of state.flames) f.ttl -= dt;
  state.flames = state.flames.filter((f) => f.ttl > 0);
}

function killPlayersInFlames(state: GameState): void {
  for (const p of state.players) {
    if (!p.alive || p.invulnFor > 0) continue;
    if (p.flamePass || p.invincibleFor > 0) continue;
    const here = tileOf(p.pos);
    const flame = state.flames.find((f) => f.x === here.x && f.y === here.y);
    if (!flame) continue;
    loseLife(state, p);
    const killer = state.players[flame.owner];
    if (!killer) continue;
    killer.score += flame.owner === p.id ? SCORE_SUICIDE : SCORE_KILL;
  }
}

/**
 * A campaign stage is one player against the board, so the arena's "last one
 * standing" rule does not apply: it ends when the player runs out of lives.
 */
function resolveCampaign(state: GameState): void {
  const campaign = state.campaign;
  if (!campaign) return;

  const player = state.players[0];
  if (!player) return;

  if (!player.alive && player.lives <= 0) {
    state.status = 'finished';
    state.winner = null;
    campaign.cleared = false;
    return;
  }

  // The door only takes you once every monster on the stage is gone.
  if (!player.alive || !campaign.exitRevealed) return;
  if (state.monsters.some((m) => m.alive)) return;
  const here = tileOf(player.pos);
  if (here.x !== campaign.exit.x || here.y !== campaign.exit.y) return;

  campaign.cleared = true;
  state.status = 'finished';
  state.winner = player.id;
  const left = Math.max(0, Math.floor(campaign.timeLimit - state.time));
  player.score += SCORE_STAGE_CLEAR + left * SCORE_TIME_BONUS;
}

/** Monster contact. Flame pass is no help here; only grace and mystery are. */
function killPlayersByMonsters(state: GameState): void {
  if (state.monsters.length === 0) return;
  for (const p of state.players) {
    if (!p.alive || p.invulnFor > 0 || p.invincibleFor > 0) continue;
    if (!monsterTouching(state, p)) continue;
    loseLife(state, p);
  }
}

function resolveOutcome(state: GameState, _dt: number): void {
  if (state.mode === 'campaign') {
    resolveCampaign(state);
    return;
  }
  // Anyone alive or waiting on a respawn is still in the fight.
  const contenders = state.players.filter((p) => p.alive || p.lives > 0);
  if (contenders.length <= 1) {
    state.status = 'finished';
    state.winner = contenders.length === 1 ? contenders[0].id : null;
    if (state.winner !== null) {
      state.players[state.winner].score += SCORE_WIN;
    }
    return;
  }
  if (state.time >= MATCH_TIME_SECONDS) {
    state.status = 'finished';
    state.winner = null;
  }
}
