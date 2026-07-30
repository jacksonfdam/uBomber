# Local development

Everything runs locally and free: the Supabase stack in Docker, the game
served by nginx in Docker, tests in Node.

## Prerequisites

- Node.js 22+
- Docker (Desktop or Engine)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- A [GodotJS](https://godotjs.github.io/) editor build (Godot 4.x with the
  GodotJS module) — only needed to run/export the game itself, not for the
  simulation tests

## 1. Install and test

```bash
make install   # npm install in game/
make test      # 60+ unit tests: simulation, maps, bots, protocol
make typecheck
```

The core simulation is pure TypeScript, so you can iterate on gameplay with
tests alone — no engine required.

## 2. Compile the scripts

```bash
make build     # tsc → game/scripts/ + esbuild bundle of the net layer
```

GodotJS loads the compiled `game/scripts/**/*.js`. Re-run after every
TypeScript change (or keep `npx tsc -w` running).

## 3. Backend (Supabase in Docker)

```bash
make db-start        # supabase start — full local stack in Docker
```

The CLI prints your local `API URL` and `anon key` (also available via
`supabase status`). Migrations in `supabase/migrations/` are applied
automatically; `make db-reset` re-applies them from scratch.

## 4. Run the game

### In the editor (solo vs bots)

Open `game/` in the GodotJS editor and press Play. Online play is
unavailable in native builds (it needs browser `fetch`/`WebSocket`); solo vs
bots works fully.

### Web build (full experience, including multiplayer)

1. Export the Web build (see [DEPLOYMENT.md](DEPLOYMENT.md#building-the-web-export));
   it lands in `web/public/game/`.
2. Point the game at your local Supabase:

   ```bash
   cp web/public/config.json.example web/public/config.json
   # fill in the API URL + anon key from `supabase status`
   # (use http://<your-LAN-IP>:54321 if friends on your network will join)
   ```

3. Serve it:

   ```bash
   make web-up   # nginx in Docker at http://localhost:8080
   ```

nginx adds the same cross-origin-isolation headers as production, so the
local build behaves exactly like the Vercel deployment. Create a room in one
browser tab, join from another with the invite link, and you have a full
multiplayer match against the bots on localhost.

## Repository layout

```
game/            GodotJS project (project.godot, scenes, maps, src, tests)
supabase/        Database migrations + local stack config
web/             Static hosting shell (landing page, config, export target)
ops/             nginx config for the local Docker web server
docs/            You are here
```
