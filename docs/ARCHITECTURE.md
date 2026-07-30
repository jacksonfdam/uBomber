# Architecture

uBomber is split into four layers with strict boundaries, so the gameplay
logic stays testable without an engine and the engine stays swappable.

```
┌─────────────────────────────────────────────────────────┐
│ web/            Landing page + hosting shell (Vercel)   │
│                 Serves the exported game + config.json  │
├─────────────────────────────────────────────────────────┤
│ game/src/godot  GodotJS integration layer               │
│                 Scenes, input, rendering, menu/lobby UI │
├─────────────────────────────────────────────────────────┤
│ game/src/net    Multiplayer (Supabase Realtime)         │
│ game/src/ai     Bot opponents                           │
├─────────────────────────────────────────────────────────┤
│ game/src/core   Pure TypeScript simulation              │
│                 No engine imports. Fully unit-tested.   │
└─────────────────────────────────────────────────────────┘
```

## game/src/core — the simulation

The entire game — movement, bombs, chain explosions, power-ups, win
conditions — is a pure, deterministic state machine:

- `createGame(mapDef, roster, seed)` builds a `GameState`.
- `step(state, inputs, dt)` advances it one fixed tick (30 Hz).
- Randomness (crate placement, power-up drops) flows through a seeded
  mulberry32 PRNG whose state lives inside `GameState`, so two peers with the
  same seed produce identical arenas.

Because the core has zero engine dependencies it runs in Node, which is what
`game/tests/` exercises (59+ tests: physics, blasts, chains, maps, bots,
protocol).

## game/src/ai — bots

`BotController` produces a regular `PlayerInput` each tick, so bots and
humans are indistinguishable to the simulation. Bots build a danger map
(seconds-until-blast per tile), flee threatened tiles via BFS, drop bombs
when a crate or enemy is in range *and* an escape route exists, and otherwise
hunt power-ups, crates and enemies in that order.

## game/src/net — multiplayer

Host-authoritative topology over Supabase Realtime (see
[MULTIPLAYER.md](MULTIPLAYER.md)). Postgres stores only the invite-code
registry; all gameplay traffic is broadcast channels.

## game/src/godot — GodotJS layer

Thin scripts attached to Godot nodes:

- `main.ts` — menu, lobby and match lifecycle (attached to `main.tscn`).
- `match_view.ts` — steps the simulation on a fixed-tick accumulator and
  renders `GameState` with `_draw()` primitives (no art assets needed).
- `maps.ts` / `net_bridge.ts` — resource loading and the require-bridge to
  the bundled network layer.

Scenes attach the `.ts` sources directly (GodotJS convention); `tsc`
compiles them into the `.godot/GodotJS/` mirror, which the engine loads and
the exporter packs. `typings/godot.d.ts` is a loose stub so the project
typechecks without an editor; the GodotJS editor can generate exact typings
that replace it.

Note on npm packages: GodotJS does not resolve `node_modules` at runtime, so
`npm run bundle:net` packs the network layer (including
`@supabase/supabase-js`) into an IIFE (`globalThis.UBomberNet`) emitted to
`web/public/game/net-bundle.js`. The web export loads it with a `<script>`
tag injected via the preset's `html/head_include`, and
`src/godot/net_bridge.ts` picks it up from the global.

## Data

- **Maps** are JSON (`game/maps/*.json`): a 15×13 character grid plus theme
  colors and metadata. Format spec in [MAPS.md](MAPS.md).
- **Rooms** are a single Postgres table with RLS enabled
  (`supabase/migrations/`).

## Platform notes

- Online multiplayer requires browser APIs (`fetch`, `WebSocket`) and is
  therefore available in **web builds**. Native/editor builds play solo vs
  bots.
- Godot 4 web exports need cross-origin isolation; both `vercel.json` and
  `ops/nginx.conf` set `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on `/game/*`.
