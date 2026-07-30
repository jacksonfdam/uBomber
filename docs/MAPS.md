# Maps

Ten arenas, each themed after a Stockholm district or landmark. All are
15×13 tiles.

| # | Map | Setting | Flavor |
|---|-----|---------|--------|
| 1 | **Gamla Stan** | The Old Town | Dense medieval lattice, narrow alleys, lots of fixed crates |
| 2 | **T-Centralen** | Central metro hub | Long open tunnel rows — blasts travel far |
| 3 | **Södermalm** | Medborgarplatsen | Wide open plaza in the center, no cover |
| 4 | **Östermalm** | Grid boulevards | The classic, perfectly regular arena |
| 5 | **Djurgården** | Royal park island | Few walls, tree lines of crates everywhere |
| 6 | **Vasastan** | Housing blocks | Dense lattice with crate clusters |
| 7 | **Kungsholmen** | Norr Mälarstrand | A quay wall with gaps splits the south side |
| 8 | **Skansen** | Open-air museum | Wall "enclosures" break the usual lattice |
| 9 | **Slussen** | The interchange | A concrete ring funnels fights into the middle |
| 10 | **Skärgården** | The archipelago | Scattered wall islets, crate bridges |

## File format

One JSON file per map in `game/maps/`, listed in `game/maps/index.json`:

```jsonc
{
  "id": "gamla-stan",          // matches the filename
  "name": "Gamla Stan",
  "district": "Gamla Stan (Old Town)",
  "description": "One-line flavor text shown in menus.",
  "theme": {                    // hex colors consumed by the renderer
    "floor": "#d9c8a7",
    "wall": "#7a5c3d",
    "crate": "#b5854e",
    "flame": "#f2762e",
    "accent": "#a63a2a"
  },
  "grid": [ "###############", "…13 rows total…" ]
}
```

### Grid legend

| Char | Meaning |
|------|---------|
| `#`  | Wall (indestructible) |
| `.`  | Floor |
| `*`  | Crate (always present) |
| `?`  | Crate with 70% probability (seeded — identical for all peers) |
| `1`–`6` | Spawn points, one per slot |

Rules enforced by `parseMap` and the test suite:

- Exactly 15 columns × 13 rows; the outer border is all walls.
- Exactly 6 spawn points, no duplicates.
- Crates orthogonally adjacent to a spawn are cleared at parse time.
- Every spawn keeps at least two open (non-wall) escape directions.
- All spawns must be mutually reachable through non-wall tiles (crates count
  as reachable, since they can be bombed through).

## Adding a map

1. Create `game/maps/<id>.json` following the format above.
2. Add the id to `game/maps/index.json`.
3. Run `npm test` in `game/` — the map suite validates geometry, spawns and
   connectivity automatically.

The menu picks up the catalog from `index.json`; no code changes needed.
