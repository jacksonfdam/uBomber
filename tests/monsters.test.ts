import { describe, expect, it } from 'vitest';
import { FLAME_TTL, MONSTER_TOUCH, TICK_DT } from '../src/core/constants';
import { createGame, step } from '../src/core/game';
import { tileOf } from '../src/core/geometry';
import { MONSTER_TRAITS, monsterTouching } from '../src/core/monsters';
import type {
  AiDifficulty,
  CampaignSetup,
  MapDef,
  MonsterSpawn,
  MonsterSpecies,
  PlayerInput,
} from '../src/core/types';
import { MAP_IDS, mapById } from '../src/maps';

const ALL_MAP_IDS = MAP_IDS;

function loadMap(id: string): MapDef {
  return mapById(id)!.def;
}

/** Plain floor tiles in a map definition, top-left first. */
function openTiles(def: MapDef): { x: number; y: number }[] {
  const tiles: { x: number; y: number }[] = [];
  def.grid.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === '.') tiles.push({ x, y });
    });
  });
  return tiles;
}

const SPECIES: MonsterSpecies[] = [
  'balloom',
  'onil',
  'dahl',
  'minvo',
  'ovape',
  'pass',
  'pontan',
];

/** Open arena so movement is unconstrained unless a test says otherwise. */
const ARENA: MapDef = {
  id: 'monster-arena',
  name: 'Monster Arena',
  district: 'Test',
  description: 'Open arena used by the monster tests.',
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

function spawn(
  species: MonsterSpecies,
  x: number,
  y: number,
  dir = { x: 1, y: 0 }
): MonsterSpawn {
  return { species, at: { x, y }, speed: MONSTER_TRAITS[species].speed, dir };
}

function setup(
  monsters: MonsterSpawn[],
  difficulty: AiDifficulty = 'normal'
): CampaignSetup {
  return {
    themeId: 'monster-arena',
    round: 1,
    stage: 1,
    timeLimit: 200,
    exit: { x: 13, y: 11 },
    hidden: { x: 12, y: 11, type: 'bomb' },
    monsters,
    difficulty,
  };
}

function stageWith(
  def: MapDef,
  monsters: MonsterSpawn[],
  difficulty: AiDifficulty = 'normal'
) {
  return createGame(def, SOLO, 99, {
    mode: 'campaign',
    campaign: setup(monsters, difficulty),
  });
}

function run(
  state: ReturnType<typeof createGame>,
  seconds: number,
  inputs: PlayerInput[] = []
) {
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) step(state, inputs, TICK_DT);
}

describe('monster traits', () => {
  it('covers every species', () => {
    for (const species of SPECIES) {
      expect(MONSTER_TRAITS[species]).toBeDefined();
      expect(MONSTER_TRAITS[species].speed).toBeGreaterThan(0);
    }
  });
});

describe('monster movement', () => {
  it.each(ALL_MAP_IDS)('never leaves the floor on %s', (id) => {
    const def = loadMap(id);
    const open = openTiles(def);
    const state = stageWith(
      def,
      SPECIES.map((species, i) =>
        spawn(species, open[i].x, open[i].y, { x: 1, y: 0 })
      )
    );
    // The player is out of the picture so only monster motion is under test.
    state.players[0].alive = false;

    for (let i = 0; i < Math.round(30 / TICK_DT); i++) {
      step(state, [], TICK_DT);
      for (const m of state.monsters) {
        const t = tileOf(m.pos);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(state.grid[t.y][t.x]).not.toBe('wall');
      }
    }
  });

  it('lets wall-pass species cross crates and stops the others', () => {
    for (const [species, expected] of [
      ['ovape', true],
      ['pontan', true],
      ['balloom', false],
    ] as const) {
      const state = stageWith(ARENA, [spawn(species, 2, 6, { x: 1, y: 0 })]);
      state.players[0].alive = false;
      // A walled corridor packed with crates: the only way east is through them.
      for (let x = 1; x <= 13; x++) {
        state.grid[5][x] = 'wall';
        state.grid[7][x] = 'wall';
      }
      for (let x = 3; x <= 11; x++) state.grid[6][x] = 'crate';

      run(state, 6);
      const crossed = state.monsters[0].pos.x > 4;
      expect(crossed).toBe(expected);
    }
  });

  it('never crosses a bomb', () => {
    const state = stageWith(ARENA, [spawn('pontan', 2, 6, { x: 1, y: 0 })]);
    state.players[0].alive = false;
    state.bombs.push({ id: 1, owner: 0, x: 5, y: 6, fuse: 999, range: 1 });

    run(state, 5);
    expect(state.monsters[0].pos.x).toBeLessThan(5);
  });

  it('closes in on the player when it hunts', () => {
    const state = stageWith(ARENA, [spawn('pass', 11, 6, { x: -1, y: 0 })]);
    state.players[0].pos = { x: 2.5, y: 6.5 };

    const before = Math.abs(state.monsters[0].pos.x - state.players[0].pos.x);
    run(state, 3);
    const after = Math.abs(state.monsters[0].pos.x - state.players[0].pos.x);
    expect(after).toBeLessThan(before);
  });

  it('hunts harder on hard than on easy', () => {
    const distanceAfter = (difficulty: AiDifficulty) => {
      const state = stageWith(
        ARENA,
        [spawn('minvo', 11, 6, { x: -1, y: 0 })],
        difficulty
      );
      state.players[0].pos = { x: 2.5, y: 6.5 };
      state.players[0].invincibleFor = 999;
      run(state, 6);
      return Math.abs(state.monsters[0].pos.x - state.players[0].pos.x);
    };
    expect(distanceAfter('hard')).toBeLessThan(distanceAfter('easy'));
  });
});

describe('monsters and blasts', () => {
  it('dies in a flame and pays the flame owner', () => {
    const state = stageWith(ARENA, [spawn('onil', 5, 6)]);
    state.players[0].alive = false;
    state.flames.push({ x: 5, y: 6, ttl: FLAME_TTL, owner: 0 });

    step(state, [], TICK_DT);
    expect(state.monsters[0].alive).toBe(false);
    expect(state.players[0].score).toBe(MONSTER_TRAITS.onil.score);
  });

  it('stops being lethal while it fades, then disappears', () => {
    const state = stageWith(ARENA, [spawn('onil', 5, 6)]);
    state.players[0].pos = { x: 5.5, y: 6.5 };
    state.flames.push({ x: 5, y: 6, ttl: FLAME_TTL, owner: 0 });

    step(state, [], TICK_DT);
    expect(monsterTouching(state, state.players[0])).toBe(false);

    run(state, 2);
    expect(state.monsters).toHaveLength(0);
  });
});

describe('monsters and players', () => {
  function touchingStage(prepare: (p: ReturnType<typeof stageWith>) => void) {
    const state = stageWith(ARENA, [spawn('balloom', 5, 6, { x: 0, y: -1 })]);
    state.players[0].pos = { x: 5.5, y: 6.5 };
    prepare(state);
    step(state, [], TICK_DT);
    return state;
  }

  it('kills on contact', () => {
    expect(touchingStage(() => {}).players[0].alive).toBe(false);
  });

  it('is stopped by respawn grace and by mystery invincibility', () => {
    expect(
      touchingStage((s) => {
        s.players[0].invulnFor = 1;
      }).players[0].alive
    ).toBe(true);
    expect(
      touchingStage((s) => {
        s.players[0].invincibleFor = 1;
      }).players[0].alive
    ).toBe(true);
  });

  it('is not stopped by flame pass', () => {
    expect(
      touchingStage((s) => {
        s.players[0].flamePass = true;
      }).players[0].alive
    ).toBe(false);
  });

  it('only touches within MONSTER_TOUCH', () => {
    const state = stageWith(ARENA, [spawn('balloom', 5, 6)]);
    state.players[0].pos = { x: 5.5 + MONSTER_TOUCH + 0.1, y: 6.5 };
    expect(monsterTouching(state, state.players[0])).toBe(false);
  });
});

describe('deathmatch', () => {
  it('never spawns monsters', () => {
    const state = createGame(ARENA, [
      { kind: 'human', name: 'A' },
      { kind: 'human', name: 'B' },
    ], 5);
    run(state, 3);
    expect(state.monsters).toEqual([]);
  });
});
