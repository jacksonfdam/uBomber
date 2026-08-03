/**
 * Skärgården — the archipelago in winter.
 * Bare glacier-scoured granite islets scattered across open water, wall
 * clusters forming islands and crates bridging the channels. Snow falling.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'skargarden',
  name: 'Skärgården',
  district: 'Stockholm Archipelago',
  description:
    'Rocky islets scattered across open water: wall clusters form islands, crates bridge the channels.',
  grid: [
    '###############',
    '#1..???.???..2#',
    '#.?#?.???.?#?.#',
    '#??..??#??..??#',
    '#?.##?...?##.?#',
    '#????.???.????#',
    '#5?.??.#.??.?6#',
    '#????.???.????#',
    '#?.##?...?##.?#',
    '#??..??#??..??#',
    '#.?#?.???.?#?.#',
    '#3..???.???..4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'granite',
  face: 'stone',
  floor: { base: '#8f9aa4', alt: '#b7c2cb', grout: '#4c545d' },
  wall: { top: '#c2d0da', front: '#33505c', edge: '#6d8794' },
  crate: { top: '#cfa87a', front: '#ab8a5e', interior: '#4c3a24', crack: '#2e2316' },
  flame: { core: '#fff2b4', edge: '#ffab00' },
  accent: '#d64545',
  sky: {
    top: '#0f1c2e',
    mid: '#42607f',
    bottom: '#b9cbd6',
    stars: true,
    sun: { x: 0.86, y: 0.3, color: '#ffe0b0', size: 20 },
  },
  skyline: [
    { style: 'islets', color: '#365064', height: 0.36, detail: '#1f3324' },
    { style: 'islets', color: '#243a4c', height: 0.24, detail: '#16261a' },
  ],
  lightDir: { x: 0.66, y: -0.75 },
  lightColor: '#e6f0fa',
  weather: 'snow',
  ambient: 'archipelago',
  grading: { gain: [0.92, 0.99, 1.16], lift: [0.03, 0.04, 0.06], saturation: 0.98, vignette: 0.42 },
  bloom: 0.5,
  music: { scale: [0, 2, 3, 7, 10], root: 46, tempo: 86, brightness: 0.3 },
};
