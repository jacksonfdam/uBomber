/**
 * Östermalm — the stately boulevards.
 * The textbook arena: a perfectly regular lattice on pale granite setts, with
 * mansard frontage behind and clean midday light. Elegant and unforgiving.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'ostermalm',
  name: 'Östermalm',
  district: 'Östermalm',
  description:
    'Stately boulevards laid out in a perfect grid: the classic arena, elegant and unforgiving.',
  grid: [
    '###############',
    '#1.?????????.2#',
    '#.#?#?#?#?#?#.#',
    '#?????????????#',
    '#?#?#?#?#?#?#?#',
    '#?????????????#',
    '#5#?#?#?#?#?#6#',
    '#?????????????#',
    '#?#?#?#?#?#?#?#',
    '#?????????????#',
    '#.#?#?#?#?#?#.#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'setts',
  face: 'stone',
  floor: { base: '#ded8cb', alt: '#b8b0a2', grout: '#736c60' },
  wall: { top: '#efe8d8', front: '#6e6a5e', edge: '#c4bda9' },
  crate: { top: '#d3c3a2', front: '#bfae8e', interior: '#5c4c33', crack: '#3b3122' },
  flame: { core: '#ffe0a0', edge: '#ffa726' },
  accent: '#2f4858',
  sky: {
    top: '#5d8dc4',
    mid: '#9dbde0',
    bottom: '#dfe6ea',
    sun: { x: 0.62, y: 0.16, color: '#fff6dc', size: 34 },
  },
  skyline: [
    { style: 'boulevard', color: '#7d8a9c', height: 0.4 },
    { style: 'boulevard', color: '#5f6c80', height: 0.54, detail: '#f2ead2' },
  ],
  lightDir: { x: -0.5, y: -0.86 },
  lightColor: '#fff6dc',
  ambient: 'boulevard',
  grading: { gain: [1.02, 1.02, 1.0], lift: [0.02, 0.02, 0.02], saturation: 1.0, vignette: 0.34 },
  bloom: 0.34,
  music: { scale: [0, 2, 4, 7, 9], root: 52, tempo: 100, brightness: 0.6 },
};
