"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotController = void 0;
exports.dangerMap = dangerMap;
const constants_1 = require("../core/constants");
const game_1 = require("../core/game");
const types_1 = require("../core/types");
const DIRS = [
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
class BotController {
    constructor(slot) {
        this.slot = slot;
        this.path = [];
        this.wantBomb = false;
        /** Seconds spent hugging an enemy without finding a shot (stall breaker). */
        this.stalledFor = 0;
        this.cadence = REPLAN_INTERVAL + ((slot * 13) % 5) * 0.02;
        this.replanIn = ((slot * 7) % 10) * 0.025;
    }
    update(state, dt) {
        const me = state.players[this.slot];
        if (!me || !me.alive || state.status !== 'running')
            return types_1.IDLE_INPUT;
        this.replanIn -= dt;
        const danger = dangerMap(state);
        const here = (0, game_1.tileOf)(me.pos);
        // React immediately when the ground under us — or the very next step of
        // the current path — turns dangerous; the fixed cadence is only for calm
        // decisions. Slow reactions here were the main cause of bot suicides.
        const next = this.path[0];
        const urgent = danger[here.y][here.x] !== Infinity ||
            (next !== undefined && danger[next.y][next.x] < 0.6);
        if (urgent || this.replanIn <= 0 || this.path.length === 0) {
            this.replanIn = this.cadence;
            this.plan(state, me, danger, here);
        }
        const bomb = this.wantBomb;
        this.wantBomb = false;
        return { ...this.followPath(me), bomb };
    }
    plan(state, me, danger, here) {
        if (danger[here.y][here.x] !== Infinity) {
            this.stalledFor = 0;
            this.path = fleePath(state, here, danger, me.speed, me.id, true);
            return;
        }
        if (this.shouldBomb(state, me, here)) {
            this.stalledFor = 0;
            this.wantBomb = true;
            const withBomb = dangerMap(state, {
                x: here.x,
                y: here.y,
                range: me.flameRange,
            });
            this.path = fleePath(state, here, withBomb, me.speed, me.id, true);
            return;
        }
        // Stall breaker: hugging an enemy without ever getting a safe shot turns
        // into an endless corner dance (two symmetric bots chase each other's
        // tile forever). After a couple of seconds of that, wander somewhere
        // else — slot-dependent, so both duelists break in different directions.
        const enemyNearby = state.players.some((p) => {
            if (!p.alive || p.id === me.id)
                return false;
            const t = (0, game_1.tileOf)(p.pos);
            return Math.abs(t.x - here.x) + Math.abs(t.y - here.y) <= 1;
        });
        this.stalledFor = enemyNearby ? this.stalledFor + REPLAN_INTERVAL : 0;
        if (this.stalledFor > 2) {
            this.stalledFor = 0;
            const wander = wanderPath(state, here, danger, this.slot);
            if (wander.length > 0) {
                this.path = wander;
                return;
            }
        }
        this.path = huntPath(state, me, here, danger);
    }
    shouldBomb(state, me, here) {
        if (me.activeBombs >= me.bombCap)
            return false;
        if ((0, game_1.bombAt)(state, here.x, here.y))
            return false;
        if (!blastHitsTarget(state, me, here))
            return false;
        const withBomb = dangerMap(state, {
            x: here.x,
            y: here.y,
            range: me.flameRange,
        });
        const escape = fleePath(state, here, withBomb, me.speed);
        if (escape.length === 0)
            return false;
        // Only commit if the escape fits inside the fuse; as the match drags on,
        // accept tighter escapes so endgame duels actually resolve.
        const margin = state.time > 90 ? 0.2 : 0.4;
        return escape.length / me.speed <= constants_1.BOMB_FUSE - margin;
    }
    followPath(me) {
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
        return types_1.IDLE_INPUT;
    }
}
exports.BotController = BotController;
/**
 * Seconds until each tile is covered by a blast (Infinity = safe).
 * Includes live flames (0) and, optionally, a bomb the bot is about to drop.
 */
function dangerMap(state, extra) {
    const danger = [];
    for (let r = 0; r < constants_1.TILE_ROWS; r++) {
        danger.push(new Array(constants_1.TILE_COLS).fill(Infinity));
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
    if (extra)
        bombs.push({ ...extra, at: constants_1.BOMB_FUSE });
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
                    if (outOfBounds(x, y) || state.grid[y][x] !== 'floor')
                        break;
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
                if (outOfBounds(x, y) || state.grid[y][x] === 'wall')
                    break;
                mark(danger, x, y, b.at);
                if (state.grid[y][x] === 'crate')
                    break;
                if ((0, game_1.bombAt)(state, x, y))
                    break;
            }
        }
    }
    // Sudden death: treat the next few tiles of the closing spiral as timed
    // hazards so bots step out of the wall's way.
    if (state.time > constants_1.SUDDEN_DEATH_START - 3) {
        const upcoming = Math.min(game_1.SUDDEN_DEATH_ORDER.length, state.suddenDeathClosed + 10);
        for (let k = state.suddenDeathClosed; k < upcoming; k++) {
            const closeAt = constants_1.SUDDEN_DEATH_START + (k + 1) * constants_1.SUDDEN_DEATH_INTERVAL - state.time;
            const t = game_1.SUDDEN_DEATH_ORDER[k];
            mark(danger, t.x, t.y, Math.max(0, closeAt));
        }
    }
    return danger;
}
function mark(danger, x, y, at) {
    danger[y][x] = Math.min(danger[y][x], at);
}
function outOfBounds(x, y) {
    return x < 0 || y < 0 || x >= constants_1.TILE_COLS || y >= constants_1.TILE_ROWS;
}
function walkable(state, x, y, from) {
    if (outOfBounds(x, y))
        return false;
    if (state.grid[y][x] !== 'floor')
        return false;
    const bomb = (0, game_1.bombAt)(state, x, y);
    if (bomb && !(from.x === x && from.y === y))
        return false;
    return true;
}
/**
 * Escape destinations already claimed during the current tick. When a bomb
 * drops, every threatened bot replans on that same tick (the urgent path),
 * and identical BFS orders used to send them all to the same safe pocket —
 * where they sat stacked for the whole fuse. Bots run in slot order, so
 * later bots see earlier claims and spread out.
 */
const escapeClaims = new WeakMap();
function claimsFor(state) {
    let entry = escapeClaims.get(state);
    if (!entry || entry.tick !== state.tick) {
        entry = { tick: state.tick, tiles: new Set() };
        escapeClaims.set(state, entry);
    }
    return entry.tiles;
}
/**
 * BFS to the nearest fully safe tile. Danger tiles may be crossed only when
 * we would be through them well before (or well after) their blast window —
 * walking into a tile as it ignites was the main way bots killed themselves.
 *
 * Prefers a safe tile nobody stands on or has claimed this tick; when the
 * only escape is contested, safety wins and the constraint is dropped.
 */
function fleePath(state, from, danger, speed, meId, claim = false) {
    const timingBlocked = (x, y, dist) => {
        const blastAt = danger[y][x];
        if (blastAt === Infinity)
            return false;
        const arrival = dist / speed;
        return arrival > blastAt - 0.35 && arrival < blastAt + constants_1.FLAME_TTL + 0.25;
    };
    const claims = claimsFor(state);
    const occupied = meId === undefined ? new Set() : occupiedTiles(state, meId);
    const free = (x, y) => {
        const k = y * constants_1.TILE_COLS + x;
        return !claims.has(k) && !occupied.has(k);
    };
    const spread = bfs(state, from, (x, y, dist) => danger[y][x] === Infinity && dist <= 10 && free(x, y), timingBlocked);
    const found = spread ??
        bfs(state, from, (x, y, dist) => danger[y][x] === Infinity && dist <= 10, timingBlocked);
    if (claim && found && found.length > 0) {
        const end = found[found.length - 1];
        claims.add(end.y * constants_1.TILE_COLS + end.x);
    }
    return found ?? [];
}
/** Tiles under other living players; calm pathing treats them as solid so
 * bots stop overlapping and marching through each other. Fleeing ignores
 * this on purpose — escaping a blast beats personal space. */
function occupiedTiles(state, meId) {
    const occupied = new Set();
    for (const p of state.players) {
        if (!p.alive || p.id === meId)
            continue;
        const t = (0, game_1.tileOf)(p.pos);
        occupied.add(t.y * constants_1.TILE_COLS + t.x);
    }
    return occupied;
}
function huntPath(state, me, from, danger) {
    // While hunting there is no urgency: never route through a threatened tile
    // or another player.
    const occupied = occupiedTiles(state, me.id);
    const avoidDanger = (x, y) => danger[y][x] !== Infinity || occupied.has(y * constants_1.TILE_COLS + x);
    // Priority 1: reachable power-up.
    const toPowerUp = bfs(state, from, (x, y) => state.powerups.some((u) => u.x === x && u.y === y), avoidDanger);
    if (toPowerUp)
        return toPowerUp;
    // Priority 2: a safe tile next to a crate (so the next plan drops a bomb).
    const toCrate = bfs(state, from, (x, y) => DIRS.some((d) => state.grid[y + d.y]?.[x + d.x] === 'crate'), avoidDanger);
    if (toCrate)
        return toCrate;
    // Priority 3: close in on the nearest living enemy.
    const enemies = state.players.filter((p) => p.alive && p.id !== me.id);
    const enemyTiles = new Set(enemies.map((p) => {
        const t = (0, game_1.tileOf)(p.pos);
        return `${t.x},${t.y}`;
    }));
    const toEnemy = bfs(state, from, (x, y) => DIRS.some((d) => enemyTiles.has(`${x + d.x},${y + d.y}`)), avoidDanger);
    return toEnemy ?? [];
}
/** Safe tile a few steps away; the slot seasons the pick so two stalled
 * duelists scatter instead of mirroring each other. */
function wanderPath(state, from, danger, slot) {
    const occupied = occupiedTiles(state, slot);
    const avoid = (x, y) => danger[y][x] !== Infinity || occupied.has(y * constants_1.TILE_COLS + x);
    const far = bfs(state, from, (x, y, dist) => dist >= 3 &&
        danger[y][x] === Infinity &&
        (x * 7 + y * 13 + slot * 5) % 3 === 0, avoid);
    if (far)
        return far;
    const any = bfs(state, from, (x, y, dist) => dist >= 2 && danger[y][x] === Infinity, avoid);
    return any ?? [];
}
/**
 * Breadth-first search over walkable tiles. Returns the path (excluding the
 * start tile) to the first tile matching `goal`, or null. `blocked` vetoes
 * entering a tile at a given walking distance (used for timing-aware danger
 * avoidance).
 */
function bfs(state, from, goal, blocked) {
    const key = (x, y) => y * constants_1.TILE_COLS + x;
    const cameFrom = new Map();
    const queue = [
        { x: from.x, y: from.y, dist: 0 },
    ];
    const seen = new Set([key(from.x, from.y)]);
    while (queue.length > 0) {
        const cur = queue.shift();
        if (goal(cur.x, cur.y, cur.dist)) {
            return reconstruct(cameFrom, from, cur, key);
        }
        for (const d of DIRS) {
            const nx = cur.x + d.x;
            const ny = cur.y + d.y;
            const k = key(nx, ny);
            if (seen.has(k) || !walkable(state, nx, ny, from))
                continue;
            if (blocked?.(nx, ny, cur.dist + 1))
                continue;
            seen.add(k);
            cameFrom.set(k, key(cur.x, cur.y));
            queue.push({ x: nx, y: ny, dist: cur.dist + 1 });
        }
    }
    return null;
}
function reconstruct(cameFrom, from, end, key) {
    const path = [];
    let cur = key(end.x, end.y);
    const start = key(from.x, from.y);
    while (cur !== start) {
        path.unshift({ x: cur % constants_1.TILE_COLS, y: Math.floor(cur / constants_1.TILE_COLS) });
        const prev = cameFrom.get(cur);
        if (prev === undefined)
            break;
        cur = prev;
    }
    return path;
}
function blastHitsTarget(state, me, here) {
    const enemyTiles = new Set(state.players
        .filter((p) => p.alive && p.id !== me.id)
        .map((p) => {
        const t = (0, game_1.tileOf)(p.pos);
        return `${t.x},${t.y}`;
    }));
    // Players can pass through each other; an enemy sharing this very tile is
    // the best target of all (this used to deadlock the 1v1 endgame).
    if (enemyTiles.has(`${here.x},${here.y}`))
        return true;
    for (const dir of DIRS) {
        for (let r = 1; r <= me.flameRange; r++) {
            const x = here.x + dir.x * r;
            const y = here.y + dir.y * r;
            if (outOfBounds(x, y) || state.grid[y][x] === 'wall')
                break;
            if (state.grid[y][x] === 'crate')
                return true;
            if (enemyTiles.has(`${x},${y}`))
                return true;
            if ((0, game_1.bombAt)(state, x, y))
                break;
        }
    }
    return false;
}
