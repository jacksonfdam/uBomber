import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BotController, dangerMap } from '../src/ai/bot';
import { BOMB_FUSE, TICK_DT } from '../src/core/constants';
import { createGame, step, tileOf } from '../src/core/game';
import type { GameState, MapDef, PlayerInput } from '../src/core/types';
import { IDLE_INPUT } from '../src/core/types';

function loadMap(id: string): MapDef {
  return JSON.parse(
    readFileSync(join(__dirname, '..', 'maps', `${id}.json`), 'utf8')
  );
}

/** Crate-free arena so escape routes always exist. */
const OPEN_MAP: MapDef = {
  id: 'open-arena',
  name: 'Open Arena',
  district: 'Test',
  description: 'Crate-free arena used by the bot tests.',
  theme: {
    floor: '#ffffff',
    wall: '#000000',
    crate: '#888888',
    flame: '#ff0000',
    accent: '#00ff00',
  },
  grid: [
    '###############',
    '#1...........2#',
    '#.............#',
    '#.............#',
    '#.............#',
    '#.............#',
    '#5...........6#',
    '#.............#',
    '#.............#',
    '#.............#',
    '#.............#',
    '#3...........4#',
    '###############',
  ],
};

describe('dangerMap', () => {
  it('marks the blast cross of a live bomb and leaves the rest safe', () => {
    const state = createGame(
      loadMap('ostermalm'),
      [
        { kind: 'bot', name: 'A' },
        { kind: 'bot', name: 'B' },
      ],
      7
    );
    state.bombs.push({ id: 1, owner: 0, x: 1, y: 1, fuse: 1.5, range: 2 });

    const danger = dangerMap(state);
    expect(danger[1][1]).toBe(1.5);
    expect(danger[1][2]).toBe(1.5);
    expect(danger[2][1]).toBe(1.5);
    expect(danger[6][7]).toBe(Infinity);
  });
});

describe('BotController', () => {
  it('flees a bomb dropped on its tile', () => {
    const state = createGame(
      OPEN_MAP,
      [
        { kind: 'bot', name: 'A' },
        { kind: 'bot', name: 'B' },
      ],
      7
    );
    const bot = new BotController(0);
    const start = tileOf(state.players[0].pos);
    state.bombs.push({ ...start, id: 1, owner: 1, fuse: BOMB_FUSE, range: 2 });

    for (let i = 0; i < Math.round(1.5 / TICK_DT); i++) {
      const input = bot.update(state, TICK_DT);
      step(state, [input, IDLE_INPUT], TICK_DT);
    }

    const now = tileOf(state.players[0].pos);
    const danger = dangerMap(state);
    expect(danger[now.y][now.x]).toBe(Infinity);
  });

  it('plays a full match without stalling: bombs are placed and crates fall', () => {
    const state = createGame(
      loadMap('gamla-stan'),
      [
        { kind: 'bot', name: 'A' },
        { kind: 'bot', name: 'B' },
        { kind: 'bot', name: 'C' },
        { kind: 'bot', name: 'D' },
      ],
      42
    );
    const bots = state.players.map((p) => new BotController(p.id));
    const cratesBefore = countCrates(state);
    let bombsPlaced = 0;

    const maxTicks = Math.round(120 / TICK_DT);
    for (let i = 0; i < maxTicks && state.status === 'running'; i++) {
      const inputs: PlayerInput[] = bots.map((b) => b.update(state, TICK_DT));
      const bombsBefore = state.bombs.length;
      step(state, inputs, TICK_DT);
      if (state.bombs.length > bombsBefore) bombsPlaced++;
    }

    expect(bombsPlaced).toBeGreaterThan(0);
    expect(countCrates(state)).toBeLessThan(cratesBefore);
  });
});

function countCrates(state: GameState): number {
  return state.grid.flat().filter((t) => t === 'crate').length;
}
