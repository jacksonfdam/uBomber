/**
 * Södermalm — Medborgarplatsen after rain.
 * A wide triangle-paved plaza with no cover at all in the middle, ringed by
 * cluttered side streets. Wet stone, neon spill, brutalist slabs behind.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'sodermalm',
  name: 'Södermalm',
  district: 'Södermalm',
  description:
    'The open square at Medborgarplatsen: a wide central plaza with no cover, ringed by cluttered side streets.',
  grid: [
    '###############',
    '#1.?????????.2#',
    '#.#?#?#?#?#?#.#',
    '#?????????????#',
    '#?#??.....??#?#',
    '#????.....????#',
    '#5?.?.....?.?6#',
    '#????.....????#',
    '#?#??.....??#?#',
    '#?????????????#',
    '#.#?#?#?#?#?#.#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'plaza',
  face: 'concrete',
  floor: { base: '#d5cbbc', alt: '#3b3530', grout: '#2a2621' },
  wall: { top: '#7c7268', front: '#4a3f39', edge: '#9b9186' },
  crate: { top: '#d2a077', front: '#ab7c52', interior: '#4a3325', crack: '#2c1e16' },
  flame: { core: '#ffd0a0', edge: '#ff7043' },
  accent: '#8e4162',
  sky: {
    top: '#141a2c',
    mid: '#2c3550',
    bottom: '#5a6478',
    stars: false,
  },
  skyline: [
    { style: 'blocks', color: '#161c2a', height: 0.5 },
    { style: 'blocks', color: '#242c3e', height: 0.66, detail: '#ff9d6e' },
  ],
  lightDir: { x: 0.4, y: -0.9 },
  lightColor: '#bcd0ff',
  weather: 'rain',
  ambient: 'plaza',
  grading: { gain: [0.94, 0.98, 1.14], lift: [0.03, 0.03, 0.05], saturation: 1.06, vignette: 0.5 },
  bloom: 0.62,
  music: { scale: [0, 2, 3, 5, 7, 10], root: 48, tempo: 92, brightness: 0.4 },
};
