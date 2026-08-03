"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUDDEN_DEATH_ORDER = void 0;
exports.createGame = createGame;
exports.step = step;
exports.tileOf = tileOf;
exports.bombAt = bombAt;
exports.flameAt = flameAt;
const constants_1 = require("./constants");
const map_1 = require("./map");
const rng_1 = require("./rng");
const EPS = 1e-4;
const DIRS = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
];
/** Builds the initial state for a match. Same map + roster + seed on every
 * peer produces the same arena. */
function createGame(def, roster, seed) {
    if (roster.length < 2 || roster.length > constants_1.MAX_SLOTS) {
        throw new Error(`roster must have 2..${constants_1.MAX_SLOTS} players`);
    }
    const { grid, spawns } = (0, map_1.parseMap)(def, seed);
    const players = roster.map((entry, slot) => ({
        id: slot,
        kind: entry.kind,
        name: entry.name,
        pos: { x: spawns[slot].x + 0.5, y: spawns[slot].y + 0.5 },
        alive: true,
        speed: constants_1.BASE_SPEED,
        bombCap: constants_1.BASE_BOMB_CAP,
        flameRange: constants_1.BASE_FLAME_RANGE,
        activeBombs: 0,
        score: 0,
        lives: Math.max(1, entry.lives ?? 1),
        maxLives: Math.max(1, entry.lives ?? 1),
        respawnIn: 0,
        invulnFor: 0,
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
    };
}
/**
 * The order in which sudden-death walls close over the interior: a spiral
 * from the outer ring inward, matching the classic "hurry up!" behavior.
 */
exports.SUDDEN_DEATH_ORDER = (() => {
    const order = [];
    let left = 1;
    let top = 1;
    let right = constants_1.TILE_COLS - 2;
    let bottom = constants_1.TILE_ROWS - 2;
    while (left <= right && top <= bottom) {
        for (let x = left; x <= right; x++)
            order.push({ x, y: top });
        for (let y = top + 1; y <= bottom; y++)
            order.push({ x: right, y });
        if (top < bottom) {
            for (let x = right - 1; x >= left; x--)
                order.push({ x, y: bottom });
        }
        if (left < right) {
            for (let y = bottom - 1; y > top; y--)
                order.push({ x: left, y });
        }
        left++;
        top++;
        right--;
        bottom--;
    }
    return order;
})();
/** Advances the simulation by dt seconds. Mutates state in place. */
function step(state, inputs, dt) {
    if (state.status !== 'running')
        return;
    state.tick++;
    state.time += dt;
    for (const p of state.players) {
        if (!p.alive)
            continue;
        const input = inputs[p.id] ?? { dx: 0, dy: 0, bomb: false };
        movePlayer(state, p, input, dt);
        if (input.bomb)
            tryPlaceBomb(state, p);
        pickUpPowerUp(state, p);
    }
    updateBombs(state, dt);
    updateFlames(state, dt);
    killPlayersInFlames(state);
    updateSuddenDeath(state);
    updateRespawns(state, dt);
    resolveOutcome(state, dt);
}
/** Takes one life; players with lives left queue a respawn at their spawn. */
function loseLife(state, p) {
    p.alive = false;
    p.lives = Math.max(0, p.lives - 1);
    if (p.lives > 0)
        p.respawnIn = constants_1.RESPAWN_DELAY;
}
function updateRespawns(state, dt) {
    for (const p of state.players) {
        if (p.alive) {
            p.invulnFor = Math.max(0, p.invulnFor - dt);
            continue;
        }
        if (p.lives <= 0 || p.respawnIn <= 0)
            continue;
        p.respawnIn -= dt;
        if (p.respawnIn > 0)
            continue;
        const spawn = state.spawns[p.id];
        // Sudden death may have walled the spawn over; then the life is lost too.
        if (!spawn || state.grid[spawn.y][spawn.x] !== 'floor') {
            p.lives = 0;
            continue;
        }
        p.alive = true;
        p.pos = { x: spawn.x + 0.5, y: spawn.y + 0.5 };
        p.invulnFor = constants_1.RESPAWN_INVULN;
    }
}
/** From SUDDEN_DEATH_START on, walls close over the arena one tile at a
 * time, crushing players, bombs, power-ups and flames beneath them. */
function updateSuddenDeath(state) {
    if (state.time <= constants_1.SUDDEN_DEATH_START)
        return;
    const expected = Math.min(exports.SUDDEN_DEATH_ORDER.length, Math.floor((state.time - constants_1.SUDDEN_DEATH_START) / constants_1.SUDDEN_DEATH_INTERVAL));
    while (state.suddenDeathClosed < expected) {
        const t = exports.SUDDEN_DEATH_ORDER[state.suddenDeathClosed++];
        state.grid[t.y][t.x] = 'wall';
        for (const b of state.bombs) {
            if (b.x === t.x && b.y === t.y) {
                const owner = state.players[b.owner];
                if (owner)
                    owner.activeBombs = Math.max(0, owner.activeBombs - 1);
            }
        }
        state.bombs = state.bombs.filter((b) => !(b.x === t.x && b.y === t.y));
        state.powerups = state.powerups.filter((u) => !(u.x === t.x && u.y === t.y));
        state.flames = state.flames.filter((f) => !(f.x === t.x && f.y === t.y));
        for (const p of state.players) {
            if (!p.alive)
                continue;
            const here = tileOf(p.pos);
            if (here.x === t.x && here.y === t.y)
                loseLife(state, p);
        }
    }
}
function tileOf(pos) {
    return { x: Math.floor(pos.x), y: Math.floor(pos.y) };
}
function bombAt(state, x, y) {
    return state.bombs.find((b) => b.x === x && b.y === y);
}
function flameAt(state, x, y) {
    return state.flames.some((f) => f.x === x && f.y === y);
}
function isInside(x, y) {
    return x >= 0 && y >= 0 && x < constants_1.TILE_COLS && y < constants_1.TILE_ROWS;
}
/** A tile blocks `p` if it is a wall, a crate, or a bomb the player is not
 * currently standing on (you can walk off a bomb you just dropped, not back
 * onto it). */
function isSolidFor(state, x, y, p) {
    if (!isInside(x, y))
        return true;
    if (state.grid[y][x] !== 'floor')
        return true;
    const bomb = bombAt(state, x, y);
    if (!bomb)
        return false;
    const here = tileOf(p.pos);
    return !(here.x === x && here.y === y);
}
/**
 * Grid-lane movement: the player moves along one axis at a time and is
 * gently re-centered on the perpendicular lane, which is what makes the
 * classic Bomberman handling feel snappy in corridors.
 */
function movePlayer(state, p, input, dt) {
    let dx = Math.sign(input.dx);
    let dy = Math.sign(input.dy);
    if (dx !== 0 && dy !== 0)
        dy = 0;
    if (dx === 0 && dy === 0)
        return;
    const dist = p.speed * dt;
    const here = tileOf(p.pos);
    if (dx !== 0) {
        approach(p.pos, 'y', here.y + 0.5, dist);
        let nx = p.pos.x + dx * dist;
        const edgeTile = Math.floor(nx + dx * constants_1.PLAYER_RADIUS);
        if (edgeTile !== here.x && isSolidFor(state, edgeTile, here.y, p)) {
            nx = dx > 0 ? edgeTile - constants_1.PLAYER_RADIUS - EPS : edgeTile + 1 + constants_1.PLAYER_RADIUS + EPS;
        }
        p.pos.x = nx;
    }
    else {
        approach(p.pos, 'x', here.x + 0.5, dist);
        let ny = p.pos.y + dy * dist;
        const edgeTile = Math.floor(ny + dy * constants_1.PLAYER_RADIUS);
        if (edgeTile !== here.y && isSolidFor(state, here.x, edgeTile, p)) {
            ny = dy > 0 ? edgeTile - constants_1.PLAYER_RADIUS - EPS : edgeTile + 1 + constants_1.PLAYER_RADIUS + EPS;
        }
        p.pos.y = ny;
    }
}
function approach(pos, axis, target, maxDelta) {
    const diff = target - pos[axis];
    if (Math.abs(diff) <= maxDelta) {
        pos[axis] = target;
    }
    else {
        pos[axis] += Math.sign(diff) * maxDelta;
    }
}
function tryPlaceBomb(state, p) {
    if (p.activeBombs >= p.bombCap)
        return;
    const here = tileOf(p.pos);
    if (state.grid[here.y][here.x] !== 'floor')
        return;
    if (bombAt(state, here.x, here.y))
        return;
    state.bombs.push({
        id: state.nextBombId++,
        owner: p.id,
        x: here.x,
        y: here.y,
        fuse: constants_1.BOMB_FUSE,
        range: p.flameRange,
    });
    p.activeBombs++;
}
function pickUpPowerUp(state, p) {
    const here = tileOf(p.pos);
    const idx = state.powerups.findIndex((u) => u.x === here.x && u.y === here.y);
    if (idx === -1)
        return;
    const [taken] = state.powerups.splice(idx, 1);
    applyPowerUp(p, taken.type);
    p.score += constants_1.SCORE_POWERUP;
}
function applyPowerUp(p, type) {
    switch (type) {
        case 'bomb':
            p.bombCap = Math.min(constants_1.MAX_BOMB_CAP, p.bombCap + 1);
            break;
        case 'flame':
            p.flameRange = Math.min(constants_1.MAX_FLAME_RANGE, p.flameRange + 1);
            break;
        case 'speed':
            p.speed = Math.min(constants_1.MAX_SPEED, p.speed + constants_1.SPEED_INCREMENT);
            break;
    }
}
function updateBombs(state, dt) {
    for (const b of state.bombs)
        b.fuse -= dt;
    const queue = state.bombs.filter((b) => b.fuse <= 0);
    if (queue.length === 0)
        return;
    const exploded = new Set();
    const flameTiles = [];
    const crushedCrates = [];
    while (queue.length > 0) {
        const bomb = queue.shift();
        if (exploded.has(bomb.id))
            continue;
        exploded.add(bomb.id);
        flameTiles.push({ x: bomb.x, y: bomb.y, owner: bomb.owner });
        for (const dir of DIRS) {
            for (let r = 1; r <= bomb.range; r++) {
                const x = bomb.x + dir.x * r;
                const y = bomb.y + dir.y * r;
                if (!isInside(x, y) || state.grid[y][x] === 'wall')
                    break;
                if (state.grid[y][x] === 'crate') {
                    crushedCrates.push({ x, y, owner: bomb.owner });
                    flameTiles.push({ x, y, owner: bomb.owner });
                    break;
                }
                const other = bombAt(state, x, y);
                if (other && !exploded.has(other.id)) {
                    other.fuse = 0;
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
        if (!exploded.has(b.id))
            continue;
        const owner = state.players[b.owner];
        if (owner)
            owner.activeBombs = Math.max(0, owner.activeBombs - 1);
    }
    state.bombs = state.bombs.filter((b) => !exploded.has(b.id));
    for (const t of flameTiles) {
        state.flames.push({ x: t.x, y: t.y, ttl: constants_1.FLAME_TTL, owner: t.owner });
    }
    // Crates burn down after flames are laid so a crate's own power-up is not
    // consumed by the blast that revealed it.
    for (const c of crushedCrates) {
        state.grid[c.y][c.x] = 'floor';
        const owner = state.players[c.owner];
        if (owner)
            owner.score += constants_1.SCORE_CRATE;
        if ((0, rng_1.rand)(state) < constants_1.POWERUP_DROP_CHANCE) {
            state.powerups.push({ x: c.x, y: c.y, type: rollPowerUp(state) });
        }
    }
}
function rollPowerUp(state) {
    const roll = (0, rng_1.rand)(state);
    if (roll < 0.4)
        return 'bomb';
    if (roll < 0.8)
        return 'flame';
    return 'speed';
}
function updateFlames(state, dt) {
    for (const f of state.flames)
        f.ttl -= dt;
    state.flames = state.flames.filter((f) => f.ttl > 0);
}
function killPlayersInFlames(state) {
    for (const p of state.players) {
        if (!p.alive || p.invulnFor > 0)
            continue;
        const here = tileOf(p.pos);
        const flame = state.flames.find((f) => f.x === here.x && f.y === here.y);
        if (!flame)
            continue;
        loseLife(state, p);
        const killer = state.players[flame.owner];
        if (!killer)
            continue;
        killer.score += flame.owner === p.id ? constants_1.SCORE_SUICIDE : constants_1.SCORE_KILL;
    }
}
function resolveOutcome(state, _dt) {
    // Anyone alive or waiting on a respawn is still in the fight.
    const contenders = state.players.filter((p) => p.alive || p.lives > 0);
    if (contenders.length <= 1) {
        state.status = 'finished';
        state.winner = contenders.length === 1 ? contenders[0].id : null;
        if (state.winner !== null) {
            state.players[state.winner].score += constants_1.SCORE_WIN;
        }
        return;
    }
    if (state.time >= constants_1.MATCH_TIME_SECONDS) {
        state.status = 'finished';
        state.winner = null;
    }
}
