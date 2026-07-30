/** Board dimensions (classic Bomberman arena proportions). */
export const TILE_COLS = 15;
export const TILE_ROWS = 13;

/** Room capacity: 1 host + 4 invited friends; bots fill the remaining slots. */
export const MAX_HUMANS = 5;
export const MAX_SLOTS = 6;

/** Movement, in tiles per second. */
export const BASE_SPEED = 3.0;
export const SPEED_INCREMENT = 0.5;
export const MAX_SPEED = 6.0;
export const PLAYER_RADIUS = 0.38;

/** Bombs and flames. */
export const BOMB_FUSE = 2.0;
export const FLAME_TTL = 0.45;
export const BASE_BOMB_CAP = 1;
export const MAX_BOMB_CAP = 8;
export const BASE_FLAME_RANGE = 2;
export const MAX_FLAME_RANGE = 10;

/** Power-ups. */
export const POWERUP_DROP_CHANCE = 0.35;

/** Match. */
export const MATCH_TIME_SECONDS = 180;

/** Simulation runs at a fixed tick; snapshots broadcast at a lower rate. */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 10;
