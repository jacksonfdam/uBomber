# Local development

Everything runs locally and free: the game on the Vite dev server, the Supabase
stack in Docker, tests in Node.

## Prerequisites

- Node.js 22+
- Docker (Desktop or Engine) — only for the Supabase stack
- [Supabase CLI](https://supabase.com/docs/guides/cli)
  (`brew install supabase/tap/supabase`) — only for multiplayer

Solo play and the whole test suite need nothing but Node.

## 1. Install and test

```bash
make install     # npm install
make test        # simulation, maps, bots, protocol, determinism, fuzz, perf
make typecheck
```

The core simulation is pure TypeScript, so you can iterate on gameplay with
tests alone.

## 2. Run the game

```bash
make dev         # vite dev server, prints a local URL
```

That is the full experience: ten arenas, campaign, bots, rankings. Hot module
reload applies renderer and theme changes immediately — tweak a colour in
`src/maps/<id>.ts` and the arena repaints on the next match.

## 3. Backend (only needed for online play)

```bash
make db-start    # supabase start — full local stack in Docker
```

The CLI prints your local `API URL` and `anon key` (also available from
`supabase status`). Migrations in `supabase/migrations/` are applied
automatically; `make db-reset` re-applies them from scratch.

Point the game at it:

```bash
cp public/config.json.example public/config.json
# fill in the API URL + anon key from `supabase status`
# (use http://<your-LAN-IP>:54321 if friends on your network will join)
```

Vite serves `public/` at the site root, so the dev server picks `/config.json`
up with no restart. Create a room in one tab, join from another with the invite
link, and you have a full multiplayer match against the bots on localhost.

## 4. Production build

```bash
make build       # tsc --noEmit && vite build → dist/
make preview     # serve dist/ locally
```

## Working on the renderer

There are no art assets to rebuild — every surface, block, bomb, blast and
character is painted from the map's `MapTheme` at match start. The useful entry
points are:

- `src/render/theme.ts` — the contract every map fills in.
- `src/render/textures.ts` — the ten floor generators and five face families.
- `src/render/sprites.ts` — the character pose table and draw routine.
- `src/render/atlas.ts` — how the sheet is composed.

To inspect the generated sheet directly, build it from the browser console:

```js
const atlas = await import('/src/render/atlas.ts');
const tex = await import('/src/render/textures.ts');
const maps = await import('/src/maps/index.ts');
const entry = maps.MAPS[0];
const sheet = atlas.buildAtlas(entry.theme, tex.generateMaterials(entry.theme, 1), 1);
document.body.replaceChildren(sheet.canvas);
```

If the arena looks wrong, check the console first: a shader that fails to
compile shows up as `THREE.WebGLProgram: Shader Error` with the GLSL line
number, and the affected mesh simply does not draw.

## Repository layout

```
index.html       Vite entry point
src/core         Pure simulation (no renderer imports)
src/ai           Bots
src/net          Supabase Realtime multiplayer
src/maps         Ten arenas: grid + theme, one module each
src/render       Three.js renderer, procedural art, VFX, post
src/audio        Web Audio synthesis
src/ui           Menu, lobby, HUD (DOM)
tests/           Vitest suites
public/          Served at the site root (config.json lives here)
supabase/        Database migrations + local stack config
docs/            You are here
```
