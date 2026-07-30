# uBomber 💣

**An open-source Bomberman-style arcade game set in Stockholm.**

Battle the computer across 10 arenas themed after Stockholm's districts —
from the medieval alleys of Gamla Stan to the open water of the archipelago.
Play solo in your browser, or create a room and invite up to **4 friends
with a single link** to take on the bots together.

Built with [GodotJS](https://godotjs.github.io/) (Godot 4 + TypeScript),
backed by [Supabase](https://supabase.com) Realtime, hosted on
[Vercel](https://vercel.com) — and fully playable locally with Docker.

## Features

- 💥 Classic bomberman rules: bombs, chain explosions, destructible crates,
  power-ups (extra bomb, bigger flame, speed), last-one-standing wins
- 🗺️ **10 Stockholm maps**: Gamla Stan, T-Centralen, Södermalm, Östermalm,
  Djurgården, Vasastan, Kungsholmen, Skansen, Slussen, Skärgården
- 🤖 Bots with danger-aware pathfinding — they flee blasts, farm crates and
  hunt you down
- 🔗 Link-based multiplayer: create a room, share
  `https://…/game/?room=K7WQ2R`, friends drop straight into the lobby
  (up to 5 humans; bots fill the remaining slots)
- 🌱 Deterministic seeded arenas — every peer sees the same crates
- 🧪 The whole simulation is pure TypeScript with 60+ unit tests; the engine
  only renders

## Quick start

### Play locally (tests + simulation)

```bash
make install && make test
```

The gameplay core has no engine dependency — you can hack on it with tests
alone.

### Run the full game locally (Docker)

```bash
make db-start        # Supabase stack in Docker (Supabase CLI)
make build           # compile TypeScript → game/scripts/
# export the Web build with a GodotJS editor (docs/DEPLOYMENT.md), then:
cp web/public/config.json.example web/public/config.json   # fill from `supabase status`
make web-up          # play at http://localhost:8080
```

Full walkthrough: [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

### Deploy your own

Vercel (static hosting) + Supabase (backend). Step-by-step in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## How it works

| Layer | Tech | Docs |
|-------|------|------|
| Simulation | Pure TypeScript, fixed 30 Hz tick, seeded RNG | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Rendering & UI | Godot 4 via GodotJS (TypeScript scripts) | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Bots | Danger maps + BFS pathfinding | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Multiplayer | Host-authoritative over Supabase Realtime channels | [MULTIPLAYER.md](docs/MULTIPLAYER.md) |
| Maps | JSON grids, validated by tests | [MAPS.md](docs/MAPS.md) |
| Hosting | Vercel (static + COOP/COEP headers), Docker locally | [DEPLOYMENT.md](docs/DEPLOYMENT.md) |

## Repository layout

```
game/       GodotJS project: scenes, maps, TypeScript sources, tests
supabase/   Database migrations + local stack config
web/        Landing page + hosting shell (Vercel serves web/public)
ops/        nginx config for local Docker serving
docs/       Architecture, multiplayer, maps, local dev, deployment
```

## Contributing

New maps need only a JSON file. See [CONTRIBUTING.md](CONTRIBUTING.md) for
ground rules and good first issues.

## License

[MIT](LICENSE). uBomber is a fan-made homage to the classic *Atomic
Bomberman* (1997); it contains no original assets and is not affiliated with
or endorsed by Konami.
