# Contributing

Thanks for helping make uBomber better! It's a small, friendly codebase —
the gameplay is pure TypeScript with a thorough test suite, so most changes
don't even need a game engine installed.

## Getting started

```bash
make install
make test        # must stay green
make typecheck
```

See [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) for the full
setup (Supabase in Docker, GodotJS editor, web builds).

## Ground rules

- **English everywhere** — code, comments, commits, docs.
- **Micro commits** — one logical change per commit, conventional-commit
  style (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, with an optional scope
  like `feat(core):`).
- **Tests first-class** — gameplay changes come with tests in `game/tests/`.
  New maps are validated automatically by the map suite.
- **Keep the core pure** — nothing under `game/src/core` or `game/src/ai`
  may import from `godot` or touch the network. That boundary is what keeps
  the game testable.

## Good first contributions

- New Stockholm maps (see [docs/MAPS.md](docs/MAPS.md) — JSON only, no code)
- Power-ups from Atomic Bomberman still on the roadmap: kick, punch,
  disease, trigger bombs
- Smarter endgame bots (trapping/cornering instead of pure dodging)
- An online leaderboard backed by Supabase (local rankings already exist)

## Pull requests

1. Fork, branch from `main`.
2. Keep the diff focused; split unrelated changes.
3. Make sure `make test`, `make typecheck` and `make build` pass (CI runs
   exactly these).
4. Describe *why*, not just *what*, in the PR body.
