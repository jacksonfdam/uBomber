"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMap = parseMap;
const constants_1 = require("./constants");
const rng_1 = require("./rng");
const RANDOM_CRATE_CHANCE = 0.7;
/**
 * Parses a MapDef grid into a tile matrix plus spawn points.
 * '?' tiles roll a crate with RANDOM_CRATE_CHANCE using the given seed, so
 * every peer that parses with the same seed sees the same arena.
 * Spawn tiles and their orthogonal neighbors are always kept crate-free.
 */
function parseMap(def, seed) {
    validateShape(def);
    const rng = { rngState: seed | 0 };
    const grid = [];
    const spawnBySlot = new Map();
    for (let r = 0; r < constants_1.TILE_ROWS; r++) {
        const row = [];
        for (let c = 0; c < constants_1.TILE_COLS; c++) {
            const ch = def.grid[r][c];
            switch (ch) {
                case '#':
                    row.push('wall');
                    break;
                case '*':
                    row.push('crate');
                    break;
                case '?':
                    row.push((0, rng_1.rand)(rng) < RANDOM_CRATE_CHANCE ? 'crate' : 'floor');
                    break;
                case '.':
                    row.push('floor');
                    break;
                default: {
                    const slot = parseInt(ch, 10);
                    if (Number.isNaN(slot) || slot < 1 || slot > constants_1.MAX_SLOTS) {
                        throw new Error(`map ${def.id}: invalid tile '${ch}' at ${c},${r}`);
                    }
                    if (spawnBySlot.has(slot - 1)) {
                        throw new Error(`map ${def.id}: duplicate spawn ${slot}`);
                    }
                    spawnBySlot.set(slot - 1, { x: c, y: r });
                    row.push('floor');
                }
            }
        }
        grid.push(row);
    }
    if (spawnBySlot.size !== constants_1.MAX_SLOTS) {
        throw new Error(`map ${def.id}: expected ${constants_1.MAX_SLOTS} spawns, found ${spawnBySlot.size}`);
    }
    const spawns = [];
    for (let slot = 0; slot < constants_1.MAX_SLOTS; slot++) {
        spawns.push(spawnBySlot.get(slot));
    }
    clearAroundSpawns(grid, spawns);
    return { grid, spawns };
}
function validateShape(def) {
    if (def.grid.length !== constants_1.TILE_ROWS) {
        throw new Error(`map ${def.id}: expected ${constants_1.TILE_ROWS} rows`);
    }
    def.grid.forEach((row, r) => {
        if (row.length !== constants_1.TILE_COLS) {
            throw new Error(`map ${def.id}: row ${r} must have ${constants_1.TILE_COLS} tiles`);
        }
    });
    for (let c = 0; c < constants_1.TILE_COLS; c++) {
        if (def.grid[0][c] !== '#' || def.grid[constants_1.TILE_ROWS - 1][c] !== '#') {
            throw new Error(`map ${def.id}: top/bottom border must be walls`);
        }
    }
    for (let r = 0; r < constants_1.TILE_ROWS; r++) {
        if (def.grid[r][0] !== '#' || def.grid[r][constants_1.TILE_COLS - 1] !== '#') {
            throw new Error(`map ${def.id}: left/right border must be walls`);
        }
    }
}
function clearAroundSpawns(grid, spawns) {
    for (const s of spawns) {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = s.x + dx;
            const y = s.y + dy;
            if (grid[y]?.[x] === 'crate') {
                grid[y][x] = 'floor';
            }
        }
    }
}
