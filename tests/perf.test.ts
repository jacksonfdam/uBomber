import { describe, expect, it } from 'vitest';
import { BotController } from '../src/ai/bot';
import { TICK_DT } from '../src/core/constants';
import { createGame, step } from '../src/core/game';
import type { PlayerInput, RosterEntry } from '../src/core/types';
import { MAPS } from '../src/maps';

/**
 * The simulation's share of the frame budget.
 *
 * A 60 fps frame is 16.6 ms and the renderer needs almost all of it, so the sim
 * — which only runs at 30 Hz — has to be far cheaper than it. These ceilings
 * are generous against measured cost; they exist to catch an accidental
 * quadratic, not to chase microseconds.
 */

const FULL_ROSTER: RosterEntry[] = Array.from({ length: 6 }, (_, i) => ({
  kind: 'bot' as const,
  name: `Bot ${i + 1}`,
}));

describe('performance budget', () => {
  it('a full 6-player tick with bots costs well under the frame budget', () => {
    // Gamla Stan is the densest arena: most crates, most walls, most pathing.
    const entry = MAPS[0];
    const state = createGame(entry.def, FULL_ROSTER, 20260803);
    const bots = FULL_ROSTER.map((_, slot) => new BotController(slot));

    // Warm up so the measurement is not dominated by first-call JIT.
    for (let t = 0; t < 60 && state.status === 'running'; t++) {
      step(
        state,
        state.players.map((p) => bots[p.id].update(state, TICK_DT)),
        TICK_DT
      );
    }

    const TICKS = 900;
    let ran = 0;
    const started = performance.now();
    for (let t = 0; t < TICKS && state.status === 'running'; t++) {
      const inputs: PlayerInput[] = state.players.map((p) => bots[p.id].update(state, TICK_DT));
      step(state, inputs, TICK_DT);
      ran++;
    }
    const perTick = (performance.now() - started) / Math.max(1, ran);

    expect(ran).toBeGreaterThan(100);
    // Bot decision-making is the expensive half; 2 ms covers both.
    expect(perTick, `${perTick.toFixed(3)} ms/tick`).toBeLessThan(2);
  });

  it('the simulation alone is an order of magnitude cheaper than the bots', () => {
    const entry = MAPS[0];
    const state = createGame(entry.def, FULL_ROSTER, 4242);
    const idle: PlayerInput[] = state.players.map(() => ({ dx: 1, dy: 0, bomb: true }));

    for (let t = 0; t < 60 && state.status === 'running'; t++) step(state, idle, TICK_DT);

    const TICKS = 2000;
    let ran = 0;
    const started = performance.now();
    for (let t = 0; t < TICKS && state.status === 'running'; t++) {
      step(state, idle, TICK_DT);
      ran++;
    }
    const perTick = (performance.now() - started) / Math.max(1, ran);
    expect(perTick, `${perTick.toFixed(4)} ms/tick`).toBeLessThan(0.4);
  });

  it('creating a match on every map stays inside the load budget', () => {
    const started = performance.now();
    for (const entry of MAPS) {
      createGame(entry.def, FULL_ROSTER, 7);
    }
    const total = performance.now() - started;
    expect(total, `${total.toFixed(2)} ms for ${MAPS.length} maps`).toBeLessThan(50);
  });
});
