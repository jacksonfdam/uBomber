"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SNAPSHOT_RATE = exports.TICK_DT = exports.TICK_RATE = exports.SCORE_SUICIDE = exports.SCORE_WIN = exports.SCORE_KILL = exports.SCORE_POWERUP = exports.SCORE_CRATE = exports.RESPAWN_INVULN = exports.RESPAWN_DELAY = exports.SOLO_LIVES = exports.SUDDEN_DEATH_INTERVAL = exports.SUDDEN_DEATH_START = exports.MATCH_TIME_SECONDS = exports.POWERUP_DROP_CHANCE = exports.MAX_FLAME_RANGE = exports.BASE_FLAME_RANGE = exports.MAX_BOMB_CAP = exports.BASE_BOMB_CAP = exports.FLAME_TTL = exports.BOMB_FUSE = exports.PLAYER_RADIUS = exports.MAX_SPEED = exports.SPEED_INCREMENT = exports.BASE_SPEED = exports.MAX_SLOTS = exports.MAX_HUMANS = exports.TILE_ROWS = exports.TILE_COLS = void 0;
/** Board dimensions (classic Bomberman arena proportions). */
exports.TILE_COLS = 15;
exports.TILE_ROWS = 13;
/** Room capacity: 1 host + 5 invited friends (a full 6-slot arena); bots
 * fill any remaining slots. */
exports.MAX_HUMANS = 6;
exports.MAX_SLOTS = 6;
/** Movement, in tiles per second. */
exports.BASE_SPEED = 3.0;
exports.SPEED_INCREMENT = 0.5;
exports.MAX_SPEED = 6.0;
exports.PLAYER_RADIUS = 0.38;
/** Bombs and flames. */
exports.BOMB_FUSE = 2.0;
exports.FLAME_TTL = 0.45;
exports.BASE_BOMB_CAP = 1;
exports.MAX_BOMB_CAP = 8;
exports.BASE_FLAME_RANGE = 2;
exports.MAX_FLAME_RANGE = 10;
/** Power-ups. */
exports.POWERUP_DROP_CHANCE = 0.35;
/** Match. */
exports.MATCH_TIME_SECONDS = 180;
/** Sudden death: walls spiral in from the border, crushing what they cover. */
exports.SUDDEN_DEATH_START = 120;
exports.SUDDEN_DEATH_INTERVAL = 0.35;
/** Lives (solo/campaign humans get several; bots and online players get 1). */
exports.SOLO_LIVES = 3;
exports.RESPAWN_DELAY = 2.0;
exports.RESPAWN_INVULN = 2.5;
/** Arcade scoring. */
exports.SCORE_CRATE = 10;
exports.SCORE_POWERUP = 25;
exports.SCORE_KILL = 200;
exports.SCORE_WIN = 500;
exports.SCORE_SUICIDE = -100;
/** Simulation runs at a fixed tick; snapshots broadcast at a lower rate. */
exports.TICK_RATE = 30;
exports.TICK_DT = 1 / exports.TICK_RATE;
exports.SNAPSHOT_RATE = 10;
