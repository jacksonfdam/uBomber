# Architecture

uBomber is a static web app: a deterministic TypeScript simulation with a
Three.js renderer on top. The layers have strict boundaries, so the gameplay
logic stays testable in Node and the presentation stays replaceable.

```
┌─────────────────────────────────────────────────────────┐
│ src/ui          Menu, lobby, HUD, rankings (DOM)        │
│ src/app.ts      Screen router + match lifecycle         │
├─────────────────────────────────────────────────────────┤
│ src/render      Three.js: procedural art, VFX, post     │
│ src/audio       Web Audio: synthesized sfx and music    │
│ src/match.ts    Fixed-step pump + state→presentation    │
├─────────────────────────────────────────────────────────┤
│ src/net         Multiplayer (Supabase Realtime)         │
│ src/ai          Bot opponents                           │
├─────────────────────────────────────────────────────────┤
│ src/core        Pure TypeScript simulation              │
│                 No renderer imports. Fully unit-tested. │
└─────────────────────────────────────────────────────────┘
```

## src/core — the simulation

The entire game — movement, bombs, chain explosions, power-ups, sudden death,
win conditions — is a pure, deterministic state machine:

- `createGame(mapDef, roster, seed)` builds a `GameState`.
- `step(state, inputs, dt)` advances it one fixed tick (30 Hz).
- Randomness (crate placement, power-up drops) flows through a seeded
  mulberry32 PRNG whose state lives inside `GameState`, so two peers with the
  same seed produce identical arenas.

`MapDef` is purely structural. Nothing in `core` knows a colour exists.

Because the core has zero rendering dependencies it runs in Node, which is what
`tests/` exercises: gameplay rules, map validation, bots, wire protocol, plus
determinism, fuzz and performance budgets.

## src/ai — bots

`BotController` produces a regular `PlayerInput` each tick, so bots and humans
are indistinguishable to the simulation. Bots build a danger map
(seconds-until-blast per tile), flee threatened tiles via BFS, drop bombs when a
crate or enemy is in range *and* an escape route exists, and otherwise hunt
power-ups, crates and enemies in that order.

## src/net — multiplayer

Host-authoritative topology over Supabase Realtime (see
[MULTIPLAYER.md](MULTIPLAYER.md)). Postgres stores only the invite-code
registry; all gameplay traffic is broadcast channels. The Supabase client is
dynamically imported, so a solo player never downloads it.

## src/render — the renderer

Everything visible is generated at match start from the map's `MapTheme`. The
repository ships **no image assets**.

| Module | Responsibility |
| --- | --- |
| `theme.ts` | The `MapTheme` contract: tileset, palettes, sky, skyline, light, weather, grading, music |
| `textures.ts` | Ten floor generators and five block-face families, painted on canvas and tiled seamlessly |
| `sprites.ts` | The parametric bomber: a pose table (lean, squash, stride, arms, eyes, hat) plus one draw routine |
| `atlas.ts` | Composes blocks, bombs, blasts, power-ups, decor and all six character colour sets into one sheet |
| `backdrop.ts` | Sky gradient plus two procedural skyline bands |
| `vfx.ts` | One fixed-size particle pool: blasts, splinters, dust, sparkles, weather |
| `post.ts` | Bloom, per-map colour grade, vignette, grain, aberration — all switchable |
| `board.ts` | The scene: camera, floor shader, sprite batch, shake |

### Draw-call budget

```
1  backdrop sky          1  floor plane (shader-tiled)
2  skyline bands         1  sprite batch (blocks + entities + players)
1  particle points       +  post-processing passes
```

The sprite batch is a single `InstancedMesh`. Instances are filled row by row
and instance order *is* draw order, so that alone produces a correct painter's
y-sort across blocks, bombs and characters — no per-frame sorting, no depth
tricks, no extra passes.

Every sprite quad follows one convention: 1.5× TILE, horizontally centred on its
tile and bottom-aligned to the tile's bottom edge.

### Performance

Generation happens once per match (the atlas costs single-digit milliseconds)
and never per frame. The post stack is switchable from the menu; with it off the
arena is a plain forward render of the handful of draws above.

## src/audio — sound

Three buses (sfx / ambient / music) over the Web Audio API. Effects are
synthesized from filtered noise bursts and oscillator envelopes, and panned by
the board column they happen on. Each map gets an ambient bed built from layered
filtered noise plus a generative music track driven by its own scale, root, tempo
and brightness. There are no recordings and no sample libraries.

## src/match.ts — the match runtime

Owns the authoritative simulation in solo and host modes; in guest mode it draws
the latest host snapshot and reports local input upward. It derives all
presentation from *observed state changes* — a bomb that vanished means a blast,
a crate that turned to floor means splinters — rather than from hooks inside the
simulation.

That is deliberate and load-bearing: the same code path lights up a locally
simulated match and a stream of host snapshots, and nothing render-side can
perturb the deterministic state that guests reconcile to.

## Data

- **Maps** are TypeScript modules (`src/maps/*.ts`), each exporting a `MapDef`
  grid and a `MapTheme`. Format spec in [MAPS.md](MAPS.md).
- **Rooms** are a single Postgres table with RLS enabled
  (`supabase/migrations/`).
- **Scores** live inside the simulation (`PlayerState.score`) with blast
  attribution via `FlameState.owner`, so guests see them through ordinary
  snapshots.
- **Campaign progress, rankings, nickname and quality settings** are in
  `localStorage`, managed by `src/persist.ts`. An online Supabase leaderboard is
  a natural follow-up but is not implemented.

## Platform notes

- Online multiplayer needs a `/config.json` with Supabase credentials served
  next to the build. Without it the online buttons say so and solo play keeps
  working.
- There is no cross-origin isolation requirement any more — that was a Godot web
  export constraint. This is an ordinary Vite build.
