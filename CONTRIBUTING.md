# Contributing

Thanks for helping make uBomber better! It's a small, friendly codebase — the
gameplay is pure TypeScript with a thorough test suite, and there are no art or
audio assets to wrangle.

## Getting started

```bash
make install
make dev         # play it
make test        # must stay green
make typecheck
```

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for the full setup,
including Supabase in Docker for online play.

## Ground rules

- **English everywhere** — code, comments, commits, docs.
- **Micro commits** — one logical change per commit, conventional-commit style
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, with an optional scope like
  `feat(core):`).
- **Tests first-class** — gameplay changes come with tests in `tests/`. New maps
  are validated automatically by the map suite.
- **Keep the core pure** — nothing under `src/core` or `src/ai` may import from
  `src/render`, `src/ui` or the network. `MapDef` in particular must stay free of
  visual data. That boundary is what keeps the game testable.
- **Never let presentation touch the simulation** — particles, sound and shake
  are driven by diffing observed `GameState`, not by hooks inside `step()`.
  Multiplayer is host-authoritative and guests reconcile against snapshots, so
  render-side randomness inside the sim would desync every peer.
- **No binary assets** — every surface, character, blast and sound is generated
  in code. A PR that adds a PNG or a WAV needs a very good reason.

## Good first contributions

- New Stockholm maps (see [docs/MAPS.md](docs/MAPS.md) — one module, no art).
  Note that the distinctness rules mean a new arena also wants a new tileset
  generator and ambient bed; that is deliberate.
- Per-map mechanics: a metro train sweeping a row on a cycle, conveyor tiles at
  Slussen, thin ice at Djurgården. These need a tile behaviour in `src/core`,
  which is where the genre has the most room left.
- Power-ups still on the roadmap: kick, punch, trigger bombs.
- Smarter endgame bots (trapping and cornering instead of pure dodging).
- An online leaderboard backed by Supabase (local rankings already exist).
- Mobile touch controls.

## Pull requests

1. Fork, branch from `main`.
2. Keep the diff focused; split unrelated changes.
3. Make sure `make typecheck`, `make test` and `make build` pass (CI runs
   exactly these).
4. Describe *why*, not just *what*, in the PR body.
5. For anything visual, include a screenshot — and say what you compared it
   against.
