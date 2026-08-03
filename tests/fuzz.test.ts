import { describe, expect, it } from 'vitest';
import { BotController } from '../src/ai/bot';
import { MATCH_TIME_SECONDS, TICK_DT } from '../src/core/constants';
import { createGame, step } from '../src/core/game';
import type { PlayerInput, RosterEntry } from '../src/core/types';
import { MAPS } from '../src/maps';
import { checkInvariants, makeRng, scriptedInputs } from './helpers';

/**
 * Random play against every arena. The point is not to find a losing line but
 * to prove the simulation cannot be driven into an impossible state: a player
 * standing inside a wall, a bomb on a crate, a negative counter, a match that
 * never resolves.
 */

const HUMANS: RosterEntry[] = [
  { kind: 'human', name: 'A' },
  { kind: 'human', name: 'B' },
  { kind: 'human', name: 'C' },
  { kind: 'human', name: 'D' },
  { kind: 'human', name: 'E' },
  { kind: 'human', name: 'F' },
];

describe('fuzz', () => {
  it('random inputs never break an invariant on any map', () => {
    const TICKS = 1200;
    for (let mapIndex = 0; mapIndex < MAPS.length; mapIndex++) {
      const entry = MAPS[mapIndex];
      for (const seed of [1, 8191, 65537]) {
        const state = createGame(entry.def, HUMANS, seed);
        const stream = scriptedInputs(seed ^ 0x5f37, TICKS, HUMANS.length);
        for (let t = 0; t < TICKS; t++) {
          step(state, stream[t], TICK_DT);
          const bad = checkInvariants(state);
          expect(
            bad,
            `${entry.def.id} seed ${seed}: ${bad.map((v) => `t${v.tick} ${v.what}`).join('; ')}`
          ).toHaveLength(0);
          if (state.status !== 'running') break;
        }
      }
    }
  });

  it('bots never break an invariant and every match resolves', () => {
    const roster: RosterEntry[] = [
      { kind: 'bot', name: 'Bot 1' },
      { kind: 'bot', name: 'Bot 2' },
      { kind: 'bot', name: 'Bot 3' },
      { kind: 'bot', name: 'Bot 4' },
    ];
    // A whole match at 30 Hz, plus a margin for the finishing tick.
    const MAX_TICKS = Math.ceil(MATCH_TIME_SECONDS / TICK_DT) + 60;

    for (const entry of MAPS) {
      for (const seed of [3, 1337]) {
        const state = createGame(entry.def, roster, seed);
        const bots = roster.map((_, slot) => new BotController(slot));
        let ticks = 0;
        while (state.status === 'running' && ticks < MAX_TICKS) {
          const inputs: PlayerInput[] = state.players.map((p) =>
            bots[p.id].update(state, TICK_DT)
          );
          step(state, inputs, TICK_DT);
          ticks++;
          const bad = checkInvariants(state);
          expect(
            bad,
            `${entry.def.id} seed ${seed}: ${bad.map((v) => `t${v.tick} ${v.what}`).join('; ')}`
          ).toHaveLength(0);
        }
        expect(state.status, `${entry.def.id} seed ${seed} never finished`).toBe('finished');
      }
    }
  });

  it('spamming bombs never exceeds the bomb cap', () => {
    const rng = makeRng(99);
    const state = createGame(MAPS[3].def, HUMANS, 4321);
    for (let t = 0; t < 900; t++) {
      const inputs: PlayerInput[] = state.players.map(() => ({
        dx: rng() < 0.5 ? 1 : -1,
        dy: 0,
        bomb: true,
      }));
      step(state, inputs, TICK_DT);
      for (const p of state.players) {
        expect(p.activeBombs).toBeLessThanOrEqual(p.bombCap);
      }
      if (state.status !== 'running') break;
    }
  });
});
