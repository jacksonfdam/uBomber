import { BOMB_FUSE, FLAME_TTL, TILE_COLS, TILE_ROWS } from '../core/constants';
import { bombAt, tileOf } from '../core/game';
import type { GameState, PlayerInput, PlayerState, Vec2 } from '../core/types';
import { IDLE_INPUT } from '../core/types';

const DIRS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** How often the bot re-plans, in seconds. Keeps bots beatable and cheap. */
const REPLAN_INTERVAL = 0.25;

/**
 * One controller per bot slot. Call update() every tick with the authoritative
 * state; it returns the PlayerInput the bot wants for that tick.
 *
 * Strategy, in priority order:
 *  1. If standing on a threatened tile, run to the nearest safe tile.
 *  2. If a bomb dropped here would hit a crate or an enemy and an escape
 *     route exists, drop it.
 *  3. Otherwise walk toward the nearest power-up, crate or enemy.
 */
export class BotController {
  private path: Vec2[] = [];
  private replanIn = 0;
  private wantBomb = false;

  constructor(public readonly slot: number) {}

  update(state: GameState, dt: number): PlayerInput {
    const me = state.players[this.slot];
    if (!me || !me.alive || state.status !== 'running') return IDLE_INPUT;

    this.replanIn -= dt;
    const danger = dangerMap(state);
    const here = tileOf(me.pos);

    // React immediately when the ground under us — or the very next step of
    // the current path — turns dangerous; the fixed cadence is only for calm
    // decisions. Slow reactions here were the main cause of bot suicides.
    const next = this.path[0];
    const urgent =
      danger[here.y][here.x] !== Infinity ||
      (next !== undefined && danger[next.y][next.x] < 0.6);

    if (urgent || this.replanIn <= 0 || this.path.length === 0) {
      this.replanIn = REPLAN_INTERVAL;
      this.plan(state, me, danger, here);
    }

    const bomb = this.wantBomb;
    this.wantBomb = false;
    return { ...this.followPath(me), bomb };
  }

  private plan(
    state: GameState,
    me: PlayerState,
    danger: number[][],
    here: Vec2
  ): void {
    if (danger[here.y][here.x] !== Infinity) {
      this.path = fleePath(state, here, danger, me.speed);
      return;
    }

    if (this.shouldBomb(state, me, here)) {
      this.wantBomb = true;
      const withBomb = dangerMap(state, {
        x: here.x,
        y: here.y,
        range: me.flameRange,
      });
      this.path = fleePath(state, here, withBomb, me.speed);
      return;
    }

    this.path = huntPath(state, me, here, danger);
  }

  private shouldBomb(state: GameState, me: PlayerState, here: Vec2): boolean {
    if (me.activeBombs >= me.bombCap) return false;
    if (bombAt(state, here.x, here.y)) return false;
    if (!blastHitsTarget(state, me, here)) return false;
    const withBomb = dangerMap(state, {
      x: here.x,
      y: here.y,
      range: me.flameRange,
    });
    const escape = fleePath(state, here, withBomb, me.speed);
    if (escape.length === 0) return false;
    // Only commit if the escape fits comfortably inside the fuse.
    return escape.length / me.speed <= BOMB_FUSE - 0.5;
  }

  private followPath(me: PlayerState): PlayerInput {
    while (this.path.length > 0) {
      const next = this.path[0];
      const target = { x: next.x + 0.5, y: next.y + 0.5 };
      const dx = target.x - me.pos.x;
      const dy = target.y - me.pos.y;
      if (Math.abs(dx) < 0.08 && Math.abs(dy) < 0.08) {
        this.path.shift();
        continue;
      }
      if (Math.abs(dx) > Math.abs(dy)) {
        return { dx: Math.sign(dx), dy: 0, bomb: false };
      }
      return { dx: 0, dy: Math.sign(dy), bomb: false };
    }
    return IDLE_INPUT;
  }
}

interface HypotheticalBomb {
  x: number;
  y: number;
  range: number;
}

/**
 * Seconds until each tile is covered by a blast (Infinity = safe).
 * Includes live flames (0) and, optionally, a bomb the bot is about to drop.
 */
export function dangerMap(
  state: GameState,
  extra?: HypotheticalBomb
): number[][] {
  const danger: number[][] = [];
  for (let r = 0; r < TILE_ROWS; r++) {
    danger.push(new Array<number>(TILE_COLS).fill(Infinity));
  }

  for (const f of state.flames) {
    danger[f.y][f.x] = 0;
  }

  const bombs = state.bombs.map((b) => ({
    x: b.x,
    y: b.y,
    range: b.range,
    at: Math.max(0, b.fuse),
  }));
  if (extra) bombs.push({ ...extra, at: BOMB_FUSE });

  // Chain detonations: a bomb caught in another blast explodes early, so
  // every bomb inherits the earliest fuse that can reach it.
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of bombs) {
      for (const dir of DIRS) {
        for (let r = 1; r <= a.range; r++) {
          const x = a.x + dir.x * r;
          const y = a.y + dir.y * r;
          if (outOfBounds(x, y) || state.grid[y][x] !== 'floor') break;
          const hit = bombs.find((b) => b.x === x && b.y === y);
          if (hit) {
            if (a.at < hit.at) {
              hit.at = a.at;
              changed = true;
            }
            break;
          }
        }
      }
    }
  }

  for (const b of bombs) {
    mark(danger, b.x, b.y, b.at);
    for (const dir of DIRS) {
      for (let r = 1; r <= b.range; r++) {
        const x = b.x + dir.x * r;
        const y = b.y + dir.y * r;
        if (outOfBounds(x, y) || state.grid[y][x] === 'wall') break;
        mark(danger, x, y, b.at);
        if (state.grid[y][x] === 'crate') break;
        if (bombAt(state, x, y)) break;
      }
    }
  }
  return danger;
}

function mark(danger: number[][], x: number, y: number, at: number): void {
  danger[y][x] = Math.min(danger[y][x], at);
}

function outOfBounds(x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= TILE_COLS || y >= TILE_ROWS;
}

function walkable(state: GameState, x: number, y: number, from: Vec2): boolean {
  if (outOfBounds(x, y)) return false;
  if (state.grid[y][x] !== 'floor') return false;
  const bomb = bombAt(state, x, y);
  if (bomb && !(from.x === x && from.y === y)) return false;
  return true;
}

/**
 * BFS to the nearest fully safe tile. Danger tiles may be crossed only when
 * we would be through them well before (or well after) their blast window —
 * walking into a tile as it ignites was the main way bots killed themselves.
 */
function fleePath(
  state: GameState,
  from: Vec2,
  danger: number[][],
  speed: number
): Vec2[] {
  const found = bfs(
    state,
    from,
    (x, y, dist) => danger[y][x] === Infinity && dist <= 10,
    (x, y, dist) => {
      const blastAt = danger[y][x];
      if (blastAt === Infinity) return false;
      const arrival = dist / speed;
      return arrival > blastAt - 0.35 && arrival < blastAt + FLAME_TTL + 0.25;
    }
  );
  return found ?? [];
}

function huntPath(
  state: GameState,
  me: PlayerState,
  from: Vec2,
  danger: number[][]
): Vec2[] {
  // While hunting there is no urgency: never route through a threatened tile.
  const avoidDanger = (x: number, y: number) => danger[y][x] !== Infinity;

  // Priority 1: reachable power-up.
  const toPowerUp = bfs(
    state,
    from,
    (x, y) => state.powerups.some((u) => u.x === x && u.y === y),
    avoidDanger
  );
  if (toPowerUp) return toPowerUp;

  // Priority 2: a safe tile next to a crate (so the next plan drops a bomb).
  const toCrate = bfs(
    state,
    from,
    (x, y) => DIRS.some((d) => state.grid[y + d.y]?.[x + d.x] === 'crate'),
    avoidDanger
  );
  if (toCrate) return toCrate;

  // Priority 3: close in on the nearest living enemy.
  const enemies = state.players.filter((p) => p.alive && p.id !== me.id);
  const enemyTiles = new Set(
    enemies.map((p) => {
      const t = tileOf(p.pos);
      return `${t.x},${t.y}`;
    })
  );
  const toEnemy = bfs(
    state,
    from,
    (x, y) => DIRS.some((d) => enemyTiles.has(`${x + d.x},${y + d.y}`)),
    avoidDanger
  );
  return toEnemy ?? [];
}

/**
 * Breadth-first search over walkable tiles. Returns the path (excluding the
 * start tile) to the first tile matching `goal`, or null. `blocked` vetoes
 * entering a tile at a given walking distance (used for timing-aware danger
 * avoidance).
 */
function bfs(
  state: GameState,
  from: Vec2,
  goal: (x: number, y: number, dist: number) => boolean,
  blocked?: (x: number, y: number, dist: number) => boolean
): Vec2[] | null {
  const key = (x: number, y: number) => y * TILE_COLS + x;
  const cameFrom = new Map<number, number>();
  const queue: Array<{ x: number; y: number; dist: number }> = [
    { x: from.x, y: from.y, dist: 0 },
  ];
  const seen = new Set<number>([key(from.x, from.y)]);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (goal(cur.x, cur.y, cur.dist)) {
      return reconstruct(cameFrom, from, cur, key);
    }
    for (const d of DIRS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      const k = key(nx, ny);
      if (seen.has(k) || !walkable(state, nx, ny, from)) continue;
      if (blocked?.(nx, ny, cur.dist + 1)) continue;
      seen.add(k);
      cameFrom.set(k, key(cur.x, cur.y));
      queue.push({ x: nx, y: ny, dist: cur.dist + 1 });
    }
  }
  return null;
}

function reconstruct(
  cameFrom: Map<number, number>,
  from: Vec2,
  end: Vec2,
  key: (x: number, y: number) => number
): Vec2[] {
  const path: Vec2[] = [];
  let cur = key(end.x, end.y);
  const start = key(from.x, from.y);
  while (cur !== start) {
    path.unshift({ x: cur % TILE_COLS, y: Math.floor(cur / TILE_COLS) });
    const prev = cameFrom.get(cur);
    if (prev === undefined) break;
    cur = prev;
  }
  return path;
}

function blastHitsTarget(
  state: GameState,
  me: PlayerState,
  here: Vec2
): boolean {
  const enemyTiles = new Set(
    state.players
      .filter((p) => p.alive && p.id !== me.id)
      .map((p) => {
        const t = tileOf(p.pos);
        return `${t.x},${t.y}`;
      })
  );

  for (const dir of DIRS) {
    for (let r = 1; r <= me.flameRange; r++) {
      const x = here.x + dir.x * r;
      const y = here.y + dir.y * r;
      if (outOfBounds(x, y) || state.grid[y][x] === 'wall') break;
      if (state.grid[y][x] === 'crate') return true;
      if (enemyTiles.has(`${x},${y}`)) return true;
      if (bombAt(state, x, y)) break;
    }
  }
  return false;
}
