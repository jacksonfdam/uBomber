/** Static tile layer. Crates are destructible; walls are not. */
export type Tile = 'wall' | 'floor' | 'crate';

export type PowerUpType = 'bomb' | 'flame' | 'speed';

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
}

export interface BombState {
  id: number;
  owner: number;
  x: number;
  y: number;
  /** Seconds until detonation. */
  fuse: number;
  range: number;
}

export interface FlameState {
  x: number;
  y: number;
  /** Seconds of remaining burn. */
  ttl: number;
}

export interface PowerUpState {
  x: number;
  y: number;
  type: PowerUpType;
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
  /** Mulberry32 state; advances deterministically with each random draw. */
  rngState: number;
}

/** Visual identity of a map; colors are hex strings consumed by the renderer. */
export interface MapTheme {
  floor: string;
  wall: string;
  crate: string;
  flame: string;
  accent: string;
}

/**
 * Map definition as stored in game/maps/*.json.
 * Grid legend: '#' wall, '.' floor, '*' crate, '?' 70% chance of a crate,
 * '1'..'6' spawn points (kept clear of crates on their orthogonal neighbors).
 */
export interface MapDef {
  id: string;
  name: string;
  district: string;
  description: string;
  theme: MapTheme;
  grid: string[];
}

export interface RosterEntry {
  kind: PlayerKind;
  name: string;
}
