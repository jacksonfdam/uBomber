import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  BOMB_FUSE,
  FLAME_TTL,
  MATCH_TIME_SECONDS,
  SPEED_INCREMENT,
  TICK_DT,
} from '../src/core/constants';
import { createGame, flameAt, step } from '../src/core/game';
import { rand } from '../src/core/rng';
import { IDLE_INPUT, type MapDef, type PlayerInput } from '../src/core/types';

/** Open arena with no crates or inner walls, for predictable physics. */
const TEST_MAP: MapDef = {
  id: 'test-arena',
  name: 'Test Arena',
  district: 'Test',
  description: 'Open arena used by the unit tests.',
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

const TWO_PLAYERS = [
  { kind: 'human' as const, name: 'A' },
  { kind: 'human' as const, name: 'B' },
];

function inputsFor(id: number, input: PlayerInput): PlayerInput[] {
  const all = [IDLE_INPUT, IDLE_INPUT];
  all[id] = input;
  return all;
}

function run(state: ReturnType<typeof createGame>, inputs: PlayerInput[], seconds: number) {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(state, inputs, TICK_DT);
}

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = { rngState: 12345 };
    const b = { rngState: 12345 };
    for (let i = 0; i < 100; i++) {
      expect(rand(a)).toBe(rand(b));
    }
  });
});

describe('createGame', () => {
  it('places players on their spawns, alive and at base stats', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    expect(state.players).toHaveLength(2);
    expect(state.players[0].pos).toEqual({ x: 1.5, y: 1.5 });
    expect(state.players[1].pos).toEqual({ x: 13.5, y: 1.5 });
    expect(state.players.every((p) => p.alive)).toBe(true);
    expect(state.status).toBe('running');
  });

  it('rejects rosters below 2 players', () => {
    expect(() => createGame(TEST_MAP, [TWO_PLAYERS[0]], 1)).toThrow();
  });
});

describe('movement', () => {
  it('moves at the player speed across open floor', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    run(state, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 1);
    expect(state.players[0].pos.x).toBeCloseTo(1.5 + BASE_SPEED, 1);
    expect(state.players[0].pos.y).toBeCloseTo(1.5, 3);
  });

  it('is blocked by walls', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    run(state, inputsFor(0, { dx: -1, dy: 0, bomb: false }), 1);
    expect(state.players[0].pos.x).toBeGreaterThan(1.3);
    expect(state.players[0].pos.x).toBeLessThan(1.6);
  });
});

describe('bombs and flames', () => {
  it('explodes after the fuse, leaving flames that then expire', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: true }), TICK_DT);
    expect(state.bombs).toHaveLength(1);
    expect(state.players[0].activeBombs).toBe(1);

    // Move the owner out of blast range, then let the fuse finish.
    run(state, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 1);
    run(state, inputsFor(0, { dx: 0, dy: 1, bomb: false }), 0.6);
    run(state, [], BOMB_FUSE - 1.6 + 0.1);

    expect(state.bombs).toHaveLength(0);
    expect(state.players[0].activeBombs).toBe(0);
    expect(state.players[0].alive).toBe(true);
    expect(flameAt(state, 1, 1)).toBe(true);
    expect(flameAt(state, 2, 1)).toBe(true);
    expect(flameAt(state, 3, 1)).toBe(true);

    run(state, [], FLAME_TTL + 0.1);
    expect(state.flames).toHaveLength(0);
  });

  it('respects the bomb cap', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: true }), TICK_DT);
    run(state, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 0.5);
    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: true }), TICK_DT);
    expect(state.bombs).toHaveLength(1);
  });

  it('destroys crates and stops the blast there', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.grid[1][3] = 'crate';
    state.bombs.push({ id: 99, owner: 0, x: 1, y: 1, fuse: 0.01, range: 4 });
    state.players[0].activeBombs = 1;
    state.players[0].pos = { x: 1.5, y: 3.5 };

    step(state, [], TICK_DT);

    expect(state.grid[1][3]).toBe('floor');
    expect(flameAt(state, 3, 1)).toBe(true);
    expect(flameAt(state, 4, 1)).toBe(false);
  });

  it('chains adjacent bombs in the same detonation', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.bombs.push(
      { id: 98, owner: 0, x: 3, y: 3, fuse: 0.01, range: 2 },
      { id: 99, owner: 0, x: 5, y: 3, fuse: 60, range: 2 }
    );
    state.players[0].activeBombs = 2;

    step(state, [], TICK_DT);

    expect(state.bombs).toHaveLength(0);
    expect(flameAt(state, 3, 3)).toBe(true);
    expect(flameAt(state, 5, 3)).toBe(true);
    expect(state.players[0].activeBombs).toBe(0);
  });

  it('kills a player caught in the blast and ends the match', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: true }), TICK_DT);
    run(state, [], BOMB_FUSE);

    expect(state.players[0].alive).toBe(false);
    expect(state.status).toBe('finished');
    expect(state.winner).toBe(1);
  });
});

describe('power-ups', () => {
  it('applies a speed power-up on pickup', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.powerups.push({ x: 2, y: 1, type: 'speed' });
    run(state, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 0.5);

    expect(state.powerups).toHaveLength(0);
    expect(state.players[0].speed).toBeCloseTo(BASE_SPEED + SPEED_INCREMENT, 5);
  });

  it('raises the bomb cap with a bomb power-up', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.powerups.push({ x: 2, y: 1, type: 'bomb' });
    run(state, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 0.5);
    expect(state.players[0].bombCap).toBe(2);
  });
});

describe('match end', () => {
  it('ends in a draw when the timer runs out', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.time = MATCH_TIME_SECONDS;
    step(state, [], TICK_DT);
    expect(state.status).toBe('finished');
    expect(state.winner).toBeNull();
  });

  it('ignores further steps once finished', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.status = 'finished';
    const tick = state.tick;
    step(state, [], TICK_DT);
    expect(state.tick).toBe(tick);
  });
});
