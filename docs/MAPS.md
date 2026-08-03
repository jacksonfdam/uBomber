# Maps

Ten arenas, each themed after a Stockholm district or landmark. All are
15×13 tiles.

| # | Map | Setting | Flavor | Tileset | Weather |
|---|-----|---------|--------|---------|---------|
| 1 | **Gamla Stan** | The Old Town | Dense medieval lattice, narrow alleys | cobble | — |
| 2 | **T-Centralen** | Central metro hub | Long open tunnel rows — blasts travel far | metro | — |
| 3 | **Södermalm** | Medborgarplatsen | Wide open plaza in the center, no cover | plaza | rain |
| 4 | **Östermalm** | Grid boulevards | The classic, perfectly regular arena | setts | — |
| 5 | **Djurgården** | Royal park island | Few walls, tree lines of crates everywhere | park | leaves |
| 6 | **Vasastan** | Housing blocks | Dense lattice with crate clusters | brick | — |
| 7 | **Kungsholmen** | Norr Mälarstrand | A quay wall with gaps splits the south side | quay | — |
| 8 | **Skansen** | Open-air museum | Wall "enclosures" break the usual lattice | timber | — |
| 9 | **Slussen** | The interchange | A concrete ring funnels fights into the middle | concrete | embers |
| 10 | **Skärgården** | The archipelago | Scattered wall islets, crate bridges | granite | snow |

## Why a map costs no art

A map is **one TypeScript file**: a character grid plus a `MapTheme`. The
renderer synthesizes the tileset, the block faces, the sky, the skyline, the
particle palette, the colour grade and the music from that theme at match start.
There is no atlas to rebuild, no image to draw and no audio to record.

## File format

One module per map in `src/maps/`, listed in `src/maps/index.ts`:

```ts
import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'gamla-stan',          // matches the filename
  name: 'Gamla Stan',
  district: 'Gamla Stan (Old Town)',
  description: 'One-line flavor text shown in menus.',
  grid: ['###############', /* …13 rows total… */],
};

export const theme: MapTheme = {
  tileset: 'cobble',         // picks the floor generator
  face: 'stone',             // picks the block-face family
  floor: { base, alt, grout },
  wall:  { top, front, edge },
  crate: { top, front, interior, crack },
  flame: { core, edge },
  accent: '#a63a2a',         // decor props
  sky:   { top, mid, bottom, sun?, stars? },
  skyline: [farBand, nearBand],
  lightDir: { x, y },
  lightColor: '#ffd9a0',
  weather: 'rain' | 'snow' | 'leaves' | 'embers' | null,
  ambient: 'city',           // picks the ambient noise bed
  grading: { gain, lift, saturation, vignette },
  bloom: 0.45,
  music: { scale, root, tempo, brightness },
};
```

`MapDef` lives in `core` and is purely structural — the simulation never sees a
colour. `MapTheme` lives in `render`. See `src/render/theme.ts` for the full
contract and the available `tileset`, `face`, `SkylineStyle` and `AmbientBed`
values.

### Grid legend

| Char | Meaning |
|------|---------|
| `#`  | Wall (indestructible) |
| `.`  | Floor |
| `*`  | Crate (always present) |
| `?`  | Crate with 70% probability (seeded — identical for all peers) |
| `1`–`6` | Spawn points, one per slot |

## Rules the test suite enforces

Geometry, from `parseMap` and `tests/maps.test.ts`:

- Exactly 15 columns × 13 rows; the outer border is all walls.
- Exactly 6 spawn points, no duplicates.
- Crates orthogonally adjacent to a spawn are cleared at parse time.
- Every spawn keeps at least two open (non-wall) escape directions.
- All spawns are mutually reachable through non-wall tiles (crates count as
  reachable, since they can be bombed through).

Theme well-formedness:

- Every colour is six-digit hex (the shaders concatenate alpha onto these
  strings, so `#abc` would silently break them).
- `crate.interior` differs from `crate.front` — it is the debris colour, and
  matching the surface makes a destroyed crate read as nothing happening.
- Grading arrays are length 3; bloom, saturation and vignette are non-negative.
- The music scale has at least three degrees and the root, tempo and brightness
  are in range.
- `lightDir` is non-zero, or every bevel would be unlit.

**Distinctness**, which is the point of the whole theme contract:

- No two maps share a `tileset`.
- No two maps share a base floor colour.
- No two maps share an `ambient` bed.

Ten arenas that share a tileset read as one arena recoloured. That failure mode
is what the contract exists to prevent, so it is asserted rather than intended.

## Adding a map

1. Create `src/maps/<id>.ts` following the format above.
2. Add the module to the `MAPS` array in `src/maps/index.ts`.
3. Run `npm test` — geometry, spawns, connectivity, theme validity and
   distinctness are all checked automatically.

Note that the distinctness rules mean an 11th map needs a new tileset generator
in `src/render/textures.ts` and a new ambient bed in `src/audio/audio.ts`. That
is by design: a new arena should be a new place, not a new palette.
