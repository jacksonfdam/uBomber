/**
 * Deterministic mulberry32 PRNG. The state lives on the object that owns it
 * (usually GameState.rngState) so it serializes with snapshots and every
 * peer that replays the same draws gets the same results.
 */
export interface RngCarrier {
  rngState: number;
}

/** Advances the state and returns a float in [0, 1). */
export function rand(carrier: RngCarrier): number {
  carrier.rngState = (carrier.rngState + 0x6d2b79f5) | 0;
  let t = carrier.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Advances the state and returns an integer in [0, max). */
export function randInt(carrier: RngCarrier, max: number): number {
  return Math.floor(rand(carrier) * max);
}
