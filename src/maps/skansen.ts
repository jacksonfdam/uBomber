/**
 * Skansen — the open-air museum.
 * Falu-red timber, boardwalk planking and fenced enclosures that turn the
 * arena into paddocks. Bright, rustic, the friendliest-looking map to die in.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'skansen',
  name: 'Skansen',
  district: 'Djurgården (Open-air museum)',
  description:
    "The world's oldest open-air museum: fenced enclosures and farmsteads turn the arena into paddocks.",
  grid: [
    '###############',
    '#1.?????????.2#',
    '#..##?????##..#',
    '#?????????????#',
    '#??#?#???#?#??#',
    '#?????????????#',
    '#5?#??.?.??#?6#',
    '#?????????????#',
    '#??#?#???#?#??#',
    '#?????????????#',
    '#..##?????##..#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'timber',
  face: 'timber',
  floor: { base: '#a8753f', alt: '#c99a5c', grout: '#5d3d1f' },
  wall: { top: '#8f3626', front: '#4e2b1c', edge: '#b04a32' },
  crate: { top: '#cf9f5d', front: '#a87c47', interior: '#4a3418', crack: '#2f2110' },
  flame: { core: '#ffdb8a', edge: '#ef6c00' },
  accent: '#6d8b3d',
  sky: {
    top: '#4a86bd',
    mid: '#9fc4dd',
    bottom: '#e6ecd6',
    sun: { x: 0.5, y: 0.14, color: '#fff8dc', size: 36 },
  },
  skyline: [
    { style: 'trees', color: '#33502f', height: 0.42 },
    { style: 'farmstead', color: '#8e3628', height: 0.5, detail: '#f3e6c8' },
  ],
  lightDir: { x: -0.3, y: -0.94 },
  lightColor: '#fff8dc',
  ambient: 'market',
  grading: { gain: [1.06, 1.02, 0.94], lift: [0.02, 0.02, 0.02], saturation: 1.12, vignette: 0.3 },
  bloom: 0.36,
  music: { scale: [0, 2, 4, 7, 9, 11], root: 54, tempo: 112, brightness: 0.72 },
};
