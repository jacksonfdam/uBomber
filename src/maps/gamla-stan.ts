/**
 * Gamla Stan — the medieval Old Town.
 * A dense lattice of alleys off Stortorget. Ochre plaster, worn cobbles and
 * gabled townhouses under a low autumn sun; the tightest arena in the catalog.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'gamla-stan',
  name: 'Gamla Stan',
  district: 'Gamla Stan (Old Town)',
  description:
    'Medieval alleys around Stortorget: a dense maze of narrow lanes where every corner hides a blast.',
  grid: [
    '###############',
    '#1.?????????.2#',
    '#.#?#?#?#?#?#.#',
    '#??*???????*??#',
    '#?#?#?#?#?#?#?#',
    '#??????*??????#',
    '#5#?#?#?#?#?#6#',
    '#??????*??????#',
    '#?#?#?#?#?#?#?#',
    '#??*???????*??#',
    '#.#?#?#?#?#?#.#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'cobble',
  face: 'stone',
  floor: { base: '#c9b391', alt: '#a08d6e', grout: '#5d4c37' },
  wall: { top: '#9c7b52', front: '#5f4630', edge: '#c2a075' },
  crate: { top: '#d8a463', front: '#b5854e', interior: '#5b3d24', crack: '#3a2716' },
  flame: { core: '#ffd166', edge: '#f2762e' },
  accent: '#a63a2a',
  sky: {
    top: '#2b2140',
    mid: '#7b4d55',
    bottom: '#d99a63',
    sun: { x: 0.24, y: 0.3, color: '#ffd9a0', size: 30 },
  },
  skyline: [
    { style: 'townhouses', color: '#3a2a34', height: 0.44 },
    { style: 'townhouses', color: '#54383c', height: 0.58, detail: '#ffca7a' },
  ],
  lightDir: { x: -0.6, y: -0.8 },
  lightColor: '#ffd9a0',
  ambient: 'city',
  grading: { gain: [1.08, 1.0, 0.9], lift: [0.02, 0.01, 0.02], saturation: 1.12, vignette: 0.4 },
  bloom: 0.45,
  music: { scale: [0, 2, 3, 7, 8], root: 50, tempo: 104, brightness: 0.45 },
};
