/** Board dimensions (classic Bomberman arena proportions). */
export const TILE_COLS = 15;
export const TILE_ROWS = 13;

/** Room capacity: 1 host + 5 invited friends (a full 6-slot arena); bots
 * fill any remaining slots. */
export const MAX_HUMANS = 6;
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

/** Classic campaign power-ups. */
export const MYSTERY_DURATION = 10.0;
export const CURSE_DURATION = 20.0;
export const CURSE_SHORT_FUSE = 0.6;
export const CURSE_SLOW_SPEED = 1.5;
export const CURSE_MIN_RANGE = 1;
export const MAX_LIVES = 5;

/** Match. */
export const MATCH_TIME_SECONDS = 180;

/** Sudden death: walls spiral in from the border, crushing what they cover. */
export const SUDDEN_DEATH_START = 120;
export const SUDDEN_DEATH_INTERVAL = 0.35;

/** Lives (solo/campaign humans get several; bots and online players get 1). */
export const SOLO_LIVES = 3;
export const RESPAWN_DELAY = 2.0;
export const RESPAWN_INVULN = 2.5;

/** Campaign ladder: every map theme is played over several rounds. */
export const ROUNDS_PER_THEME = 5;
export const CAMPAIGN_STAGES = 50;
export const STAGE_TIME_BASE = 200;
export const STAGE_TIME_STEP = 10;
export const STAGE_CRATE_BASE = 0.3;
export const STAGE_CRATE_STEP = 0.06;
/** Crates drop less often than in the arena: the hidden item is the prize. */
export const CAMPAIGN_DROP_CHANCE = 0.18;

/** Monsters. */
export const MONSTER_BASE_COUNT = 3;
export const MONSTER_COUNT_STEP = 2;
export const MONSTER_ROUND_SPEED = 0.08;
export const MONSTER_SAFE_RADIUS = 4;
export const MONSTER_TOUCH = 0.7;
export const MONSTER_DEATH_FADE = 0.5;
export const MONSTER_STRAIGHT_BIAS = 0.7;
/** Dahl wanders more than it advances, which is what makes it look erratic. */
export const MONSTER_ERRATIC_BIAS = 0.45;

/** Exit door. */
export const EXIT_ENRAGE_MONSTERS = 4;
export const EXIT_ENRAGE_MAX = 3;
export const TIME_UP_MONSTERS = 6;

/** Arcade scoring. */
export const SCORE_CRATE = 10;
export const SCORE_POWERUP = 25;
export const SCORE_KILL = 200;
export const SCORE_WIN = 500;
export const SCORE_SUICIDE = -100;
export const SCORE_STAGE_CLEAR = 1000;
/** Points per second left on the stage clock when it is cleared. */
export const SCORE_TIME_BONUS = 2;

/** Simulation runs at a fixed tick; snapshots broadcast at a lower rate. */
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 10;
