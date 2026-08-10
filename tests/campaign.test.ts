import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_VERSION,
  EMPTY_PROGRESS,
  campaignSeed,
  isCampaignComplete,
  migrateProgress,
  nextStage,
  stageMapId,
  stageRound,
} from '../src/core/campaign';
import {
  BASE_SPEED,
  CAMPAIGN_STAGES,
  EXIT_ENRAGE_MAX,
  EXIT_ENRAGE_MONSTERS,
  FLAME_TTL,
  ROUNDS_PER_THEME,
  SCORE_STAGE_CLEAR,
  SUDDEN_DEATH_START,
  TICK_DT,
  TIME_UP_MONSTERS,
} from '../src/core/constants';
import { createGame, step } from '../src/core/game';
import { MONSTER_TRAITS } from '../src/core/monsters';
import type {
  CampaignSetup,
  MapDef,
  MonsterSpawn,
  PlayerInput,
} from '../src/core/types';

const ARENA: MapDef = {
  id: 'campaign-arena',
  name: 'Campaign Arena',
  district: 'Test',
  description: 'Open arena used by the campaign tests.',
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

const SOLO = [{ kind: 'human' as const, name: 'A', lives: 3 }];
const EXIT = { x: 7, y: 6 };
const HIDDEN = { x: 9, y: 6, type: 'flame' as const };

function setup(overrides: Partial<CampaignSetup> = {}): CampaignSetup {
  return {
    themeId: 'campaign-arena',
    round: 1,
    stage: 1,
    timeLimit: 200,
    exit: EXIT,
    hidden: HIDDEN,
    monsters: [],
    difficulty: 'normal',
    ...overrides,
  };
}

function stage(overrides: Partial<CampaignSetup> = {}) {
  const state = createGame(ARENA, SOLO, 7, {
    mode: 'campaign',
    campaign: setup(overrides),
  });
  state.grid[EXIT.y][EXIT.x] = 'crate';
  state.grid[HIDDEN.y][HIDDEN.x] = 'crate';
  return state;
}

function monster(x: number, y: number): MonsterSpawn {
  return {
    species: 'balloom',
    at: { x, y },
    speed: MONSTER_TRAITS.balloom.speed,
    dir: { x: 1, y: 0 },
  };
}

function run(
  state: ReturnType<typeof createGame>,
  seconds: number,
  inputs: PlayerInput[] = []
) {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(state, inputs, TICK_DT);
}

/** Detonates a bomb on the tile west of (x, y), so its blast covers (x, y). */
function blast(state: ReturnType<typeof createGame>, x: number, y: number) {
  state.bombs.push({
    id: 500 + x * 20 + y,
    owner: 0,
    x: x - 1,
    y,
    fuse: 0.01,
    range: 1,
  });
  step(state, [], TICK_DT);
}

describe('campaign rosters', () => {
  it('accepts a single player in campaign but not in deathmatch', () => {
    expect(() =>
      createGame(ARENA, SOLO, 1, { mode: 'campaign', campaign: setup() })
    ).not.toThrow();
    expect(() => createGame(ARENA, SOLO, 1)).toThrow();
  });

  it('needs a setup when the mode is campaign', () => {
    expect(() => createGame(ARENA, SOLO, 1, { mode: 'campaign' })).toThrow();
  });

  it('does not end the stage on the first tick', () => {
    const state = stage();
    step(state, [], TICK_DT);
    expect(state.status).toBe('running');
  });
});

describe('sudden death', () => {
  it('never closes in on a campaign stage', () => {
    const state = stage();
    run(state, SUDDEN_DEATH_START + 30);
    expect(state.suddenDeathClosed).toBe(0);
    expect(state.grid[1][1]).toBe('floor');
  });
});

describe('the exit door', () => {
  it('is revealed by bombing its crate and drops nothing', () => {
    const state = stage();
    blast(state, EXIT.x, EXIT.y);

    expect(state.campaign?.exitRevealed).toBe(true);
    expect(state.grid[EXIT.y][EXIT.x]).toBe('floor');
    expect(state.powerups).toHaveLength(0);
  });

  it('always drops the stage item from the hidden crate', () => {
    const state = stage();
    blast(state, HIDDEN.x, HIDDEN.y);

    expect(state.powerups).toEqual([
      { x: HIDDEN.x, y: HIDDEN.y, type: HIDDEN.type },
    ]);
    expect(state.campaign?.hidden).toBeNull();
  });

  it('does not clear the stage while a monster lives', () => {
    const state = stage({ monsters: [monster(2, 2)] });
    blast(state, EXIT.x, EXIT.y);
    state.players[0].pos = { x: EXIT.x + 0.5, y: EXIT.y + 0.5 };

    step(state, [], TICK_DT);
    expect(state.status).toBe('running');
  });

  it('clears the stage once the last monster is gone', () => {
    const state = stage({ monsters: [monster(2, 2)] });
    blast(state, EXIT.x, EXIT.y);
    run(state, FLAME_TTL + 0.1);
    state.monsters = [];
    state.players[0].pos = { x: EXIT.x + 0.5, y: EXIT.y + 0.5 };

    step(state, [], TICK_DT);
    expect(state.status).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.campaign?.cleared).toBe(true);
    expect(state.players[0].score).toBeGreaterThanOrEqual(SCORE_STAGE_CLEAR);
  });

  it('spawns monsters when bombed, up to the enrage cap', () => {
    const state = stage();
    blast(state, EXIT.x, EXIT.y);
    run(state, FLAME_TTL + 0.1);

    for (let i = 1; i <= EXIT_ENRAGE_MAX + 1; i++) {
      blast(state, EXIT.x, EXIT.y);
      run(state, FLAME_TTL + 0.1);
      expect(state.campaign?.exitEnraged).toBe(Math.min(i, EXIT_ENRAGE_MAX));
    }
    // Some of the summoned monsters walk into the following blasts, so this is
    // a range: at least one wave survives, and never more than the cap allows.
    expect(state.monsters.length).toBeGreaterThanOrEqual(EXIT_ENRAGE_MONSTERS);
    expect(state.monsters.length).toBeLessThanOrEqual(
      EXIT_ENRAGE_MAX * EXIT_ENRAGE_MONSTERS
    );
  });
});

describe('the stage clock', () => {
  it('floods pontans without ending the stage', () => {
    const state = stage({ timeLimit: 2 });
    state.players[0].invincibleFor = 999;
    run(state, 2.5);

    expect(state.campaign?.timeUp).toBe(true);
    expect(state.status).toBe('running');
    expect(state.monsters).toHaveLength(TIME_UP_MONSTERS);
    expect(state.monsters.every((m) => m.species === 'pontan')).toBe(true);
  });
});

describe('losing a campaign stage', () => {
  it('finishes with no winner once the last life is gone', () => {
    const state = stage();
    state.players[0].lives = 1;
    state.flames.push({ x: 1, y: 1, ttl: 99, owner: 0 });

    step(state, [], TICK_DT);
    expect(state.status).toBe('finished');
    expect(state.winner).toBeNull();
    expect(state.campaign?.cleared).toBe(false);
  });

  it('strips the loadout on death in campaign but not in deathmatch', () => {
    const campaign = stage();
    campaign.players[0].speed = 5;
    campaign.players[0].wallPass = true;
    campaign.flames.push({ x: 1, y: 1, ttl: 99, owner: 0 });
    step(campaign, [], TICK_DT);
    expect(campaign.players[0].speed).toBe(BASE_SPEED);
    expect(campaign.players[0].wallPass).toBe(false);

    const arena = createGame(ARENA, [
      { kind: 'human', name: 'A', lives: 3 },
      { kind: 'human', name: 'B', lives: 3 },
    ], 7);
    arena.players[0].speed = 5;
    arena.players[0].wallPass = true;
    arena.flames.push({ x: 1, y: 1, ttl: 99, owner: 1 });
    step(arena, [], TICK_DT);
    expect(arena.players[0].speed).toBe(5);
    expect(arena.players[0].wallPass).toBe(true);
  });
});

describe('saved progress', () => {
  it('starts empty when there is nothing saved', () => {
    expect(migrateProgress(null)).toEqual(EMPTY_PROGRESS);
    expect(migrateProgress('nonsense')).toEqual(EMPTY_PROGRESS);
    expect(migrateProgress({})).toEqual(EMPTY_PROGRESS);
  });

  it('credits a whole run of rounds per beaten map from version 1', () => {
    const migrated = migrateProgress({
      completed: ['gamla-stan', 't-centralen'],
      totalScore: 1234,
    });
    expect(migrated.version).toBe(CAMPAIGN_VERSION);
    expect(migrated.cleared).toBe(2 * ROUNDS_PER_THEME);
    expect(migrated.totalScore).toBe(1234);
    expect(nextStage(migrated)).toBe(11);
  });

  it('keeps version 2 records and clamps them to the ladder', () => {
    expect(migrateProgress({ version: 2, cleared: 12, totalScore: 5 })).toEqual({
      version: CAMPAIGN_VERSION,
      cleared: 12,
      totalScore: 5,
    });
    expect(migrateProgress({ cleared: 999 }).cleared).toBe(CAMPAIGN_STAGES);
    expect(migrateProgress({ cleared: -4 }).cleared).toBe(0);
  });

  it('reports completion only at the end of the ladder', () => {
    expect(isCampaignComplete({ ...EMPTY_PROGRESS, cleared: 49 })).toBe(false);
    const done = { ...EMPTY_PROGRESS, cleared: CAMPAIGN_STAGES };
    expect(isCampaignComplete(done)).toBe(true);
    expect(nextStage(done)).toBe(CAMPAIGN_STAGES);
  });

  it('derives a stable seed and map from the stage number', () => {
    const ids = ['a', 'b', 'c'];
    expect(campaignSeed(12)).toBe(campaignSeed(12));
    expect(campaignSeed(12)).not.toBe(campaignSeed(13));
    expect(stageMapId(ids, 1)).toBe('a');
    expect(stageMapId(ids, 4)).toBe('a');
    expect(stageRound(ids.length + 1, ids.length)).toBe(2);
  });
});

describe('determinism', () => {
  it('replays identically from the same seed', () => {
    const a = stage({ monsters: [monster(3, 3), monster(9, 9)] });
    const b = stage({ monsters: [monster(3, 3), monster(9, 9)] });
    const inputs = [{ dx: 1, dy: 0, bomb: true }];

    run(a, 20, inputs);
    run(b, 20, inputs);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
