/**
 * Kungsholmen — the Norr Mälarstrand waterfront.
 * Stone quay slabs beside Riddarfjärden, with a long wall splitting the island
 * from the shore promenade. Cool, damp, low sun off the water.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'kungsholmen',
  name: 'Kungsholmen',
  district: 'Kungsholmen',
  description:
    'The Norr Mälarstrand waterfront: a long quay wall splits the island from the shore promenade.',
  grid: [
    '###############',
    '#1.?????????.2#',
    '#.#?#?#?#?#?#.#',
    '#?????????????#',
    '#?#?#?#?#?#?#?#',
    '#?????????????#',
    '#5#?#?#?#?#?#6#',
    '#?????????????#',
    '#..##?.?.?##..#',
    '#?????????????#',
    '#.#?#?#?#?#?#.#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'quay',
  face: 'stone',
  floor: { base: '#aebdc4', alt: '#8b9ca6', grout: '#4f5d66' },
  wall: { top: '#a3b6bf', front: '#3d5760', edge: '#758d98' },
  crate: { top: '#c9a678', front: '#a4855a', interior: '#4a3c2b', crack: '#2d241a' },
  flame: { core: '#fff0b0', edge: '#ffb300' },
  accent: '#2e7d9c',
  sky: {
    top: '#22406a',
    mid: '#6a90b4',
    bottom: '#c7d9e2',
    sun: { x: 0.3, y: 0.24, color: '#ffe8c0', size: 28 },
  },
  skyline: [
    { style: 'waterfront', color: '#456a86', height: 0.34, detail: '#e8f4ff' },
    { style: 'blocks', color: '#2c4258', height: 0.5, detail: '#ffdc9a' },
  ],
  lightDir: { x: -0.45, y: -0.88 },
  lightColor: '#e8f4ff',
  ambient: 'water',
  grading: { gain: [0.94, 1.0, 1.14], lift: [0.02, 0.03, 0.05], saturation: 1.06, vignette: 0.38 },
  bloom: 0.44,
  music: { scale: [0, 2, 5, 7, 9], root: 51, tempo: 90, brightness: 0.5 },
};
