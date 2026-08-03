import { describe, expect, it } from 'vitest';
import { BotController } from '../src/ai/bot';
import { TICK_DT } from '../src/core/constants';
import { createGame, step } from '../src/core/game';
import type { PlayerInput, RosterEntry } from '../src/core/types';
import { MAPS } from '../src/maps';
import { scriptedInputs } from './helpers';

/**
 * The simulation's share of the frame budget.
 *
 * A 60 fps frame is 16.6 ms and the renderer needs almost all of it, so the sim
 * — which only runs at 30 Hz — has to be far cheaper than that. These ceilings
 * are generous against measured cost; they exist to catch an accidental
 * quadratic, not to chase microseconds.
 *
 * Every measurement is the *fastest* of several attempts. On a shared CI runner
 * any single run can be preempted by the scheduler, and a ceiling that trips on
 * someone else's noise is worse than no ceiling at all: it teaches people to
 * ignore a red build. The best run measures what the machine can do, which is
 * the thing being asserted.
 */

const ATTEMPTS = 3;
const PERF_TIMEOUT = 60_000;

const FULL_ROSTER: RosterEntry[] = Array.from({ length: 6 }, (_, i) => ({
  kind: 'bot' as const,
  name: `Bot ${i + 1}`,
}));

/**
 * The same six players with lives to spare.
 *
 * Six one-life players in a dense arena wipe each other out inside ~70 ticks,
 * which is far too short a window to measure sustained cost in. Respawning keeps
 * the simulation busy for the whole sample without changing what a tick does.
 */
const ENDLESS_ROSTER: RosterEntry[] = FULL_ROSTER.map((entry) => ({
  ...entry,
  lives: 99,
}));

/** Runs `attempt` several times and returns the lowest ms-per-tick it saw. */
function bestPerTick(attempt: () => { ms: number; ticks: number }): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ATTEMPTS; i++) {
    const { ms, ticks } = attempt();
    expect(ticks).toBeGreaterThan(100);
    best = Math.min(best, ms / ticks);
  }
  return best;
}

describe('performance budget', () => {
  it(
    'a full 6-player tick with bots costs well under the frame budget',
    () => {
      // Gamla Stan is the densest arena: most crates, most walls, most pathing.
      const entry = MAPS[0];

      const perTick = bestPerTick(() => {
        const state = createGame(entry.def, FULL_ROSTER, 20260803);
        const bots = FULL_ROSTER.map((_, slot) => new BotController(slot));
        const tick = (): void => {
          const inputs: PlayerInput[] = state.players.map((p) =>
            bots[p.id].update(state, TICK_DT)
          );
          step(state, inputs, TICK_DT);
        };

        // Warm up so the measurement is not dominated by first-call JIT.
        for (let t = 0; t < 60 && state.status === 'running'; t++) tick();

        let ticks = 0;
        const started = performance.now();
        for (let t = 0; t < 900 && state.status === 'running'; t++) {
          tick();
          ticks++;
        }
        return { ms: performance.now() - started, ticks };
      });

      // Bot decision-making is the expensive half; 2 ms covers both.
      expect(perTick, `${perTick.toFixed(3)} ms/tick`).toBeLessThan(2);
    },
    PERF_TIMEOUT
  );

  it(
    'the simulation alone is an order of magnitude cheaper than the bots',
    () => {
      const entry = MAPS[0];
      const TICKS = 1500;

      // A scripted stream rather than "walk right and bomb every tick": that
      // kills all six players to their own first bomb inside ~60 ticks, leaving
      // nothing to measure. This keeps the match alive while still exercising
      // bombs, flames and crate destruction.
      const stream = scriptedInputs(4242, TICKS + 120, ENDLESS_ROSTER.length);

      const perTick = bestPerTick(() => {
        const state = createGame(entry.def, ENDLESS_ROSTER, 4242);
        let cursor = 0;
        for (let t = 0; t < 60 && state.status === 'running'; t++) {
          step(state, stream[cursor++], TICK_DT);
        }

        let ticks = 0;
        const started = performance.now();
        for (let t = 0; t < TICKS && state.status === 'running'; t++) {
          step(state, stream[cursor++], TICK_DT);
          ticks++;
        }
        return { ms: performance.now() - started, ticks };
      });

      expect(perTick, `${perTick.toFixed(4)} ms/tick`).toBeLessThan(0.4);
    },
    PERF_TIMEOUT
  );

  it('creating a match on every map stays inside the load budget', () => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ATTEMPTS; i++) {
      const started = performance.now();
      for (const entry of MAPS) createGame(entry.def, FULL_ROSTER, 7);
      best = Math.min(best, performance.now() - started);
    }
    expect(best, `${best.toFixed(2)} ms for ${MAPS.length} maps`).toBeLessThan(50);
  });
});
