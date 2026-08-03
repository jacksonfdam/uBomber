/**
 * Slussen — the eternally-under-construction interchange.
 * Raw shuttered concrete, rust bleed and tower cranes overhead. A concrete
 * ring in the middle funnels everyone into the same fight. Welding embers fall.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'slussen',
  name: 'Slussen',
  district: 'Södermalm (The lock)',
  description:
    'The eternally-under-construction interchange: a concrete ring in the middle funnels everyone together.',
  grid: [
    '###############',
    '#1.?????????.2#',
    '#.#?#?#?#?#?#.#',
    '#?????????????#',
    '#?#??##?##??#?#',
    '#????#???#????#',
    '#5?..?.?.?..?6#',
    '#????#???#????#',
    '#?#??##?##??#?#',
    '#?????????????#',
    '#.#?#?#?#?#?#.#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'concrete',
  face: 'concrete',
  floor: { base: '#b5b5b8', alt: '#8e8e94', grout: '#5a5a62' },
  wall: { top: '#b0b0b6', front: '#4c4c56', edge: '#7c7c88' },
  crate: { top: '#c99b6d', front: '#a37f52', interior: '#463525', crack: '#2b2016' },
  flame: { core: '#ffe49a', edge: '#ff9100' },
  accent: '#c98f00',
  sky: {
    top: '#1d2430',
    mid: '#3c4654',
    bottom: '#6d7484',
  },
  skyline: [
    { style: 'cranes', color: '#e0a21c', height: 0.66, detail: '#ff5c3a' },
    { style: 'blocks', color: '#242b38', height: 0.44, detail: '#ffcf7a' },
  ],
  lightDir: { x: 0.5, y: -0.86 },
  lightColor: '#dfe6f0',
  weather: 'embers',
  ambient: 'site',
  grading: { gain: [1.0, 0.98, 1.02], lift: [0.03, 0.03, 0.04], saturation: 0.96, vignette: 0.48 },
  bloom: 0.56,
  music: { scale: [0, 1, 5, 7, 8], root: 47, tempo: 118, brightness: 0.34 },
};
