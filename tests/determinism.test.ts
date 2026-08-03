import { describe, expect, it } from 'vitest';
import { TICK_DT } from '../src/core/constants';
import { createGame, step } from '../src/core/game';
import type { RosterEntry } from '../src/core/types';
import { MAPS } from '../src/maps';
import { scriptedInputs, stateHash } from './helpers';

/**
 * The determinism contract the host-authoritative topology rests on: the same
 * (map, roster, seed, input stream) must produce the same state every time.
 *
 * Without this, two peers that both parse the same map with the same seed can
 * drift apart between snapshots, and every desync bug looks like a network bug.
 */

const ROSTER: RosterEntry[] = [
  { kind: 'human', name: 'A' },
  { kind: 'human', name: 'B' },
  { kind: 'human', name: 'C' },
  { kind: 'human', name: 'D' },
];

function runToHash(mapIndex: number, seed: number, ticks: number, inputSeed: number): string {
  const entry = MAPS[mapIndex];
  const state = createGame(entry.def, ROSTER, seed);
  const stream = scriptedInputs(inputSeed, ticks, ROSTER.length);
  for (let t = 0; t < ticks; t++) step(state, stream[t], TICK_DT);
  return stateHash(state);
}

describe('determinism', () => {
  it('repeated runs of the same seed and inputs are identical', () => {
    const RUNS = 25;
    const reference = runToHash(0, 12345, 900, 999);
    for (let run = 0; run < RUNS; run++) {
      expect(runToHash(0, 12345, 900, 999)).toBe(reference);
    }
  });

  it('every map is reproducible', () => {
    MAPS.forEach((_entry, index) => {
      const a = runToHash(index, 4242, 600, 7);
      const b = runToHash(index, 4242, 600, 7);
      expect(a, MAPS[index].def.id).toBe(b);
    });
  });

  it('a different arena seed produces a different arena', () => {
    // The seed decides which '?' cells become crates, so the state must differ.
    expect(runToHash(0, 1, 300, 5)).not.toBe(runToHash(0, 2, 300, 5));
  });

  it('a different input stream produces a different outcome', () => {
    expect(runToHash(0, 77, 600, 1)).not.toBe(runToHash(0, 77, 600, 2));
  });

  it('the hash actually covers the state it claims to', () => {
    const entry = MAPS[3];
    const a = createGame(entry.def, ROSTER, 555);
    const b = createGame(entry.def, ROSTER, 555);
    expect(stateHash(a)).toBe(stateHash(b));

    // One extra bomb press has to change the hash.
    const idle = { dx: 0, dy: 0, bomb: false };
    step(a, [idle, idle, idle, idle], TICK_DT);
    step(b, [{ dx: 0, dy: 0, bomb: true }, idle, idle, idle], TICK_DT);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });
});
