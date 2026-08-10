/** Static tile layer. Crates are destructible; walls are not. */
export type Tile = 'wall' | 'floor' | 'crate';

/**
 * Which rule set a match runs under. Deathmatch is the arena mode (solo and
 * online); campaign is the single-player stage ladder against monsters.
 */
export type GameMode = 'deathmatch' | 'campaign';

/**
 * Skill level applied to bots and to campaign monsters. Chosen locally and
 * never sent over the wire, so online matches stay on PROTOCOL_VERSION 1.
 */
export type AiDifficulty = 'easy' | 'normal' | 'hard';

/**
 * Power-ups. The first three drop in both modes; the rest are campaign-only,
 * which is what guarantees an online guest never receives a type its build
 * does not know.
 */
export type PowerUpType =
  | 'bomb'
  | 'flame'
  | 'speed'
  | 'detonator'
  | 'wallpass'
  | 'bombpass'
  | 'flamepass'
  | 'mystery'
  | 'life'
  | 'curse';

/** What a picked-up skull does to you until it wears off. */
export type CurseKind = 'short-fuse' | 'min-range' | 'slow' | 'bomb-drop';

/** Campaign monsters, in the order the ladder introduces them. */
export type MonsterSpecies =
  | 'balloom'
  | 'onil'
  | 'dahl'
  | 'minvo'
  | 'ovape'
  | 'pass'
  | 'pontan';

export type PlayerKind = 'human' | 'bot';

export type MatchStatus = 'running' | 'finished';

export interface Vec2 {
  x: number;
  y: number;
}

/** One player's intent for a tick. dx/dy are -1, 0 or 1. */
export interface PlayerInput {
  dx: number;
  dy: number;
  bomb: boolean;
  /** Detonator trigger. Optional so inputs from older peers stay valid. */
  detonate?: boolean;
}

export const IDLE_INPUT: PlayerInput = { dx: 0, dy: 0, bomb: false };

export interface PlayerState {
  /** Slot index, 0-based. Doubles as the player id inside a match. */
  id: number;
  kind: PlayerKind;
  name: string;
  /** Continuous position in tile units; tile (c, r) spans [c, c+1) x [r, r+1). */
  pos: Vec2;
  alive: boolean;
  speed: number;
  bombCap: number;
  flameRange: number;
  /** Bombs currently ticking that belong to this player. */
  activeBombs: number;
  /** Arcade score earned this match (crates, power-ups, kills, win bonus). */
  score: number;
  /** Lives remaining, counting the one being played. 0 = out of the match. */
  lives: number;
  /** Lives the player started with (for the hearts indicator). */
  maxLives: number;
  /** Seconds until this (dead but not out) player respawns. */
  respawnIn: number;
  /** Post-respawn grace period during which flames don't kill. */
  invulnFor: number;
  /** Bombs wait for a manual trigger instead of burning their fuse. */
  detonator: boolean;
  /** Walk through crates. */
  wallPass: boolean;
  /** Walk through bombs. */
  bombPass: boolean;
  /** Flames never kill you. */
  flamePass: boolean;
  /** Seconds of mystery invincibility left; stops flames and monsters alike. */
  invincibleFor: number;
  /** Active curse, or null when uncursed. */
  curse: CurseKind | null;
  /** Seconds until the curse wears off. */
  curseFor: number;
}

export interface BombState {
  id: number;
  owner: number;
  x: number;
  y: number;
  /** Seconds until detonation. Frozen while `remote` is set. */
  fuse: number;
  range: number;
  /**
   * Detonator bomb: ignores its fuse and waits for the owner's trigger. Left
   * undefined on ordinary bombs so arena snapshots serialize as they did.
   */
  remote?: boolean;
}

export interface FlameState {
  x: number;
  y: number;
  /** Seconds of remaining burn. */
  ttl: number;
  /** Slot of the player whose bomb produced this flame (score attribution). */
  owner: number;
}

export interface PowerUpState {
  x: number;
  y: number;
  type: PowerUpType;
}

export interface MonsterState {
  id: number;
  species: MonsterSpecies;
  /** Continuous position in tile units, same convention as players. */
  pos: Vec2;
  /** Current heading; always one of the four unit directions. */
  dir: Vec2;
  /** Tiles per second, already scaled by round and difficulty. */
  speed: number;
  alive: boolean;
  /** Seconds of death animation left. Dying monsters neither move nor kill. */
  dyingFor: number;
}

/** Everything the campaign rules need at runtime. Null in deathmatch. */
export interface CampaignState {
  /** Map the stage was generated from; supplies the visual theme. */
  themeId: string;
  /** 1..ROUNDS_PER_THEME. */
  round: number;
  /** Position in the ladder, 1..CAMPAIGN_STAGES. */
  stage: number;
  /** Seconds before the stage turns hostile and floods pontans. */
  timeLimit: number;
  /** Tile hiding the exit door. */
  exit: Vec2;
  /** True once the crate covering the exit has been blown up. */
  exitRevealed: boolean;
  /** How many times the revealed exit has been caught in a blast. */
  exitEnraged: number;
  /** Crate hiding this stage's guaranteed item; null once it dropped. */
  hidden: { x: number; y: number; type: PowerUpType } | null;
  /** True once the time-up wave has spawned. Fires exactly once. */
  timeUp: boolean;
  /** True when the player cleared the stage, false when they lost it. */
  cleared: boolean;
  /** Applies to monsters. Local-only, like everywhere else. */
  difficulty: AiDifficulty;
}

export interface GameState {
  tick: number;
  time: number;
  status: MatchStatus;
  /** Winning slot id, or null while running / on a draw. */
  winner: number | null;
  grid: Tile[][];
  players: PlayerState[];
  bombs: BombState[];
  flames: FlameState[];
  powerups: PowerUpState[];
  nextBombId: number;
  /** Spawn tile per slot, used for respawns. */
  spawns: Vec2[];
  /** How many sudden-death wall tiles have been placed so far. */
  suddenDeathClosed: number;
  /** Mulberry32 state; advances deterministically with each random draw. */
  rngState: number;
  /** Rule set for this match. */
  mode: GameMode;
  /** Campaign stage rules, or null in deathmatch. */
  campaign: CampaignState | null;
  /** Campaign monsters. Always empty in deathmatch. */
  monsters: MonsterState[];
  nextMonsterId: number;
}

/**
 * Playable definition of a map. Purely structural: the visual and aural
 * identity lives in the MapTheme exported next to it (see src/render/theme.ts),
 * which keeps the simulation free of any rendering concern.
 *
 * Grid legend: '#' wall, '.' floor, '*' crate, '?' 70% chance of a crate,
 * '1'..'6' spawn points (kept clear of crates on their orthogonal neighbors).
 */
export interface MapDef {
  id: string;
  name: string;
  district: string;
  description: string;
  grid: string[];
}

export interface RosterEntry {
  kind: PlayerKind;
  name: string;
  /** Lives for this player; defaults to 1 (bots and online matches). */
  lives?: number;
}

/** One monster as requested by the stage generator. */
export interface MonsterSpawn {
  species: MonsterSpecies;
  at: Vec2;
  /** Tiles per second, already scaled by round and difficulty. */
  speed: number;
  dir: Vec2;
}

/**
 * Immutable description of a campaign stage, produced by the generator and
 * consumed by createGame.
 */
export interface CampaignSetup {
  themeId: string;
  round: number;
  stage: number;
  timeLimit: number;
  exit: Vec2;
  hidden: { x: number; y: number; type: PowerUpType };
  monsters: MonsterSpawn[];
  difficulty: AiDifficulty;
}

/** Rule-set selector for createGame. Omitted means classic deathmatch. */
export interface MatchConfig {
  mode: GameMode;
  /** Required when mode is 'campaign'. */
  campaign?: CampaignSetup;
}
