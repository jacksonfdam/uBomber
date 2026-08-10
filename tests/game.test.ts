import { describe, expect, it } from 'vitest';
import {
  BASE_SPEED,
  BOMB_FUSE,
  CURSE_DURATION,
  CURSE_MIN_RANGE,
  CURSE_SHORT_FUSE,
  CURSE_SLOW_SPEED,
  FLAME_TTL,
  MATCH_TIME_SECONDS,
  RESPAWN_DELAY,
  RESPAWN_INVULN,
  SCORE_CRATE,
  SCORE_KILL,
  SCORE_POWERUP,
  SCORE_SUICIDE,
  SCORE_WIN,
  SPEED_INCREMENT,
  SUDDEN_DEATH_INTERVAL,
  SUDDEN_DEATH_START,
  TICK_DT,
} from '../src/core/constants';
import {
  createGame,
  effectiveFuse,
  effectiveRange,
  effectiveSpeed,
  flameAt,
  step,
} from '../src/core/game';
import { rand } from '../src/core/rng';
import { IDLE_INPUT, type MapDef, type PlayerInput } from '../src/core/types';

/** Open arena with no crates or inner walls, for predictable physics. */
const TEST_MAP: MapDef = {
  id: 'test-arena',
  name: 'Test Arena',
  district: 'Test',
  description: 'Open arena used by the unit tests.',
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

  it('defaults to deathmatch with no campaign state and no monsters', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    expect(state.mode).toBe('deathmatch');
    expect(state.campaign).toBeNull();
    expect(state.monsters).toEqual([]);
  });

  it('starts players without any of the classic power-up effects', () => {
    const [p] = createGame(TEST_MAP, TWO_PLAYERS, 1).players;
    expect(p.detonator).toBe(false);
    expect(p.wallPass).toBe(false);
    expect(p.bombPass).toBe(false);
    expect(p.flamePass).toBe(false);
    expect(p.invincibleFor).toBe(0);
    expect(p.curse).toBeNull();
    expect(p.curseFor).toBe(0);
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

describe('detonator', () => {
  function holdingDetonator() {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.players[0].detonator = true;
    state.players[0].bombCap = 3;
    // Out of its own blast, so the detonation does not end the match.
    state.players[1].pos = { x: 13.5, y: 11.5 };
    return state;
  }

  it('marks placed bombs as remote and freezes their fuse', () => {
    const state = holdingDetonator();
    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: true }), TICK_DT);
    expect(state.bombs[0].remote).toBe(true);

    run(state, [], BOMB_FUSE * 2);
    expect(state.bombs).toHaveLength(1);
  });

  it('detonates on the trigger tick', () => {
    const state = holdingDetonator();
    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: true }), TICK_DT);
    state.players[0].pos = { x: 7.5, y: 7.5 };

    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: false, detonate: true }), TICK_DT);
    expect(state.bombs).toHaveLength(0);
    expect(flameAt(state, 1, 1)).toBe(true);
  });

  it('pops the oldest bomb first, one per press', () => {
    const state = holdingDetonator();
    state.bombs.push({ id: 7, owner: 0, x: 5, y: 5, fuse: 99, range: 1, remote: true });
    state.bombs.push({ id: 9, owner: 0, x: 9, y: 9, fuse: 99, range: 1, remote: true });
    state.players[0].activeBombs = 2;
    state.players[0].pos = { x: 1.5, y: 7.5 };

    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: false, detonate: true }), TICK_DT);
    expect(state.bombs.map((b) => b.id)).toEqual([9]);
  });

  it('still chains when caught in another blast', () => {
    const state = holdingDetonator();
    state.bombs.push({ id: 7, owner: 0, x: 3, y: 1, fuse: 99, range: 1, remote: true });
    state.bombs.push({ id: 8, owner: 1, x: 1, y: 1, fuse: 0.01, range: 4 });
    state.players[0].pos = { x: 7.5, y: 7.5 };

    step(state, [], TICK_DT);
    expect(state.bombs).toHaveLength(0);
    expect(flameAt(state, 4, 1)).toBe(true);
  });
});

describe('pass power-ups', () => {
  it('walks through crates only with wall pass', () => {
    const blocked = createGame(TEST_MAP, TWO_PLAYERS, 1);
    blocked.grid[1][3] = 'crate';
    run(blocked, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 1);
    expect(blocked.players[0].pos.x).toBeLessThan(3);

    const passing = createGame(TEST_MAP, TWO_PLAYERS, 1);
    passing.grid[1][3] = 'crate';
    passing.players[0].wallPass = true;
    run(passing, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 1);
    expect(passing.players[0].pos.x).toBeGreaterThan(4);
  });

  it('walks back onto a bomb only with bomb pass', () => {
    const blocked = createGame(TEST_MAP, TWO_PLAYERS, 1);
    blocked.bombs.push({ id: 1, owner: 1, x: 3, y: 1, fuse: 99, range: 1 });
    run(blocked, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 1);
    expect(blocked.players[0].pos.x).toBeLessThan(3);

    const passing = createGame(TEST_MAP, TWO_PLAYERS, 1);
    passing.bombs.push({ id: 1, owner: 1, x: 3, y: 1, fuse: 99, range: 1 });
    passing.players[0].bombPass = true;
    run(passing, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 1);
    expect(passing.players[0].pos.x).toBeGreaterThan(4);
  });

  it('survives flames with flame pass', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.players[0].flamePass = true;
    state.flames.push({ x: 1, y: 1, ttl: FLAME_TTL, owner: 1 });
    step(state, [], TICK_DT);
    expect(state.players[0].alive).toBe(true);
  });

  it('survives flames while mystery invincibility lasts, then dies', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.players[0].invincibleFor = 0.5;
    state.flames.push({ x: 1, y: 1, ttl: 99, owner: 1 });

    step(state, [], TICK_DT);
    expect(state.players[0].alive).toBe(true);

    run(state, [], 1);
    expect(state.players[0].alive).toBe(false);
  });
});

describe('curses', () => {
  it('reports base stats while uncursed', () => {
    const [p] = createGame(TEST_MAP, TWO_PLAYERS, 1).players;
    expect(effectiveSpeed(p)).toBe(BASE_SPEED);
    expect(effectiveRange(p)).toBe(p.flameRange);
    expect(effectiveFuse(p)).toBe(BOMB_FUSE);
  });

  it('overrides speed, range and fuse while cursed', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    const p = state.players[0];

    p.curse = 'slow';
    expect(effectiveSpeed(p)).toBe(CURSE_SLOW_SPEED);
    p.curse = 'min-range';
    expect(effectiveRange(p)).toBe(CURSE_MIN_RANGE);
    p.curse = 'short-fuse';
    expect(effectiveFuse(p)).toBe(CURSE_SHORT_FUSE);
  });

  it('slows the player down for real', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.players[0].curse = 'slow';
    state.players[0].curseFor = CURSE_DURATION;
    run(state, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 1);
    expect(state.players[0].pos.x).toBeCloseTo(1.5 + CURSE_SLOW_SPEED, 1);
  });

  it('wears off after CURSE_DURATION', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.players[0].curse = 'slow';
    state.players[0].curseFor = CURSE_DURATION;

    run(state, [], CURSE_DURATION - 1);
    expect(state.players[0].curse).toBe('slow');

    run(state, [], 1.5);
    expect(state.players[0].curse).toBeNull();
    expect(state.players[0].curseFor).toBe(0);
  });

  it('drops bombs on its own under the bomb-drop curse', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.players[0].curse = 'bomb-drop';
    state.players[0].curseFor = CURSE_DURATION;

    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: false }), TICK_DT);
    expect(state.bombs).toHaveLength(1);
  });
});

describe('scoring', () => {
  it('awards crate points to the bomb owner', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.grid[1][3] = 'crate';
    state.bombs.push({ id: 99, owner: 0, x: 1, y: 1, fuse: 0.01, range: 4 });
    state.players[0].activeBombs = 1;
    state.players[0].pos = { x: 7.5, y: 7.5 };

    step(state, [], TICK_DT);
    expect(state.players[0].score).toBe(SCORE_CRATE);
  });

  it('awards power-up points on pickup', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    state.powerups.push({ x: 2, y: 1, type: 'speed' });
    run(state, inputsFor(0, { dx: 1, dy: 0, bomb: false }), 0.5);
    expect(state.players[0].score).toBe(SCORE_POWERUP);
  });

  it('awards a kill to the flame owner and the win bonus to the survivor', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    // Player 1's bomb kills player 0.
    state.bombs.push({ id: 99, owner: 1, x: 1, y: 1, fuse: 0.01, range: 2 });
    state.players[1].activeBombs = 1;
    state.players[1].pos = { x: 13.5, y: 11.5 };

    step(state, [], TICK_DT);

    expect(state.players[0].alive).toBe(false);
    expect(state.players[1].score).toBe(SCORE_KILL + SCORE_WIN);
  });

  it('penalizes dying in your own blast', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    step(state, inputsFor(0, { dx: 0, dy: 0, bomb: true }), TICK_DT);
    run(state, [], BOMB_FUSE);

    expect(state.players[0].alive).toBe(false);
    expect(state.players[0].score).toBe(SCORE_SUICIDE);
    expect(state.players[1].score).toBe(SCORE_WIN);
  });
});

describe('lives and respawn', () => {
  const THREE_LIVES = [
    { kind: 'human' as const, name: 'A', lives: 3 },
    { kind: 'human' as const, name: 'B' },
  ];

  function killPlayerZero(state: ReturnType<typeof createGame>) {
    state.bombs.push({ id: 99, owner: 1, x: 1, y: 1, fuse: 0.01, range: 1 });
    state.players[1].activeBombs = 1;
    step(state, [], TICK_DT);
  }

  it('respawns at the spawn point with brief invulnerability', () => {
    const state = createGame(TEST_MAP, THREE_LIVES, 1);
    state.players[1].pos = { x: 13.5, y: 11.5 };

    killPlayerZero(state);
    expect(state.players[0].alive).toBe(false);
    expect(state.players[0].lives).toBe(2);
    expect(state.status).toBe('running');

    run(state, [], RESPAWN_DELAY + 0.1);
    const p0 = state.players[0];
    expect(p0.alive).toBe(true);
    expect(p0.pos).toEqual({ x: 1.5, y: 1.5 });
    expect(p0.invulnFor).toBeGreaterThan(0);

    // Flames on the spawn cannot kill during the grace period.
    state.flames.push({ x: 1, y: 1, ttl: 0.4, owner: 1 });
    step(state, [], TICK_DT);
    expect(state.players[0].alive).toBe(true);
  });

  it('ends the match once all spare lives are gone', () => {
    const state = createGame(
      TEST_MAP,
      [
        { kind: 'human' as const, name: 'A', lives: 2 },
        { kind: 'human' as const, name: 'B' },
      ],
      1
    );
    state.players[1].pos = { x: 13.5, y: 11.5 };

    killPlayerZero(state);
    expect(state.status).toBe('running');
    run(state, [], RESPAWN_DELAY + RESPAWN_INVULN + 0.2);

    killPlayerZero(state);
    expect(state.players[0].lives).toBe(0);
    expect(state.status).toBe('finished');
    expect(state.winner).toBe(1);
  });
});

describe('sudden death', () => {
  it('closes walls over the arena and crushes whoever stands there', () => {
    const state = createGame(TEST_MAP, TWO_PLAYERS, 1);
    // Player 0 sits on the first spiral tile (1,1); player 1 is far away.
    state.players[1].pos = { x: 7.5, y: 7.5 };
    state.time = SUDDEN_DEATH_START + SUDDEN_DEATH_INTERVAL * 3 + 0.01;

    step(state, [], TICK_DT);

    expect(state.suddenDeathClosed).toBeGreaterThanOrEqual(3);
    expect(state.grid[1][1]).toBe('wall');
    expect(state.players[0].alive).toBe(false);
    expect(state.status).toBe('finished');
    expect(state.winner).toBe(1);
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
