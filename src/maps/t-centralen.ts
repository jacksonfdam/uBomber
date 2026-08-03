/**
 * T-Centralen — the Blue Line concourse.
 * Blasted bedrock painted cobalt, glazed platform tile and long straight
 * corridors: the map where a flame upgrade reaches all the way across.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 't-centralen',
  name: 'T-Centralen',
  district: 'Norrmalm (Metro hub)',
  description:
    "Stockholm's central metro station: long tunnel corridors and platforms where blasts travel far.",
  grid: [
    '###############',
    '#1.?????????.2#',
    '#.#?#?#?#?#?#.#',
    '#?????????????#',
    '#??..??*??..??#',
    '#?????????????#',
    '#5#?#?#?#?#?#6#',
    '#?????????????#',
    '#??..??*??..??#',
    '#?????????????#',
    '#.#?#?#?#?#?#.#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'metro',
  face: 'tiled',
  floor: { base: '#39558c', alt: '#6c93d6', grout: '#1f3054' },
  wall: { top: '#a9c8ff', front: '#37474f', edge: '#5d7fa8' },
  crate: { top: '#9fb3bd', front: '#78909c', interior: '#2b3a42', crack: '#16232b' },
  flame: { core: '#fff0a8', edge: '#ffb300' },
  accent: '#0277bd',
  sky: {
    top: '#050a18',
    mid: '#112245',
    bottom: '#274a86',
    sun: { x: 0.72, y: 0.18, color: '#a9c8ff', size: 22 },
  },
  skyline: [
    { style: 'cavern', color: '#0c1730', height: 0.6 },
    { style: 'cavern', color: '#182a52', height: 0.42, detail: '#5f8fe0' },
  ],
  lightDir: { x: -0.35, y: -0.9 },
  lightColor: '#cfe0ff',
  ambient: 'metro',
  grading: { gain: [0.9, 1.0, 1.26], lift: [0.01, 0.02, 0.06], saturation: 1.18, vignette: 0.46 },
  bloom: 0.6,
  music: { scale: [0, 3, 5, 7, 10], root: 55, tempo: 96, brightness: 0.35 },
};
