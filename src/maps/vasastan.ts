/**
 * Vasastan — turn-of-the-century housing blocks.
 * Brick-paved courtyards walled in by tenement frontage. Tight cover, short
 * escape routes, and a warm evening glow off the render.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'vasastan',
  name: 'Vasastan',
  district: 'Vasastan',
  description:
    'Dense turn-of-the-century housing blocks: tight courtyards packed with cover and short escape routes.',
  grid: [
    '###############',
    '#1.?????????.2#',
    '#.#?#?#?#?#?#.#',
    '#?*?????????*?#',
    '#?#?#?#?#?#?#?#',
    '#????*???*????#',
    '#5#?#?#?#?#?#6#',
    '#????*???*????#',
    '#?#?#?#?#?#?#?#',
    '#?*?????????*?#',
    '#.#?#?#?#?#?#.#',
    '#3.?????????.4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'brick',
  face: 'brick',
  floor: { base: '#b8785a', alt: '#965c47', grout: '#5a3427' },
  wall: { top: '#c98a5e', front: '#7b3f2e', edge: '#a35b3c' },
  crate: { top: '#d69066', front: '#c07a50', interior: '#4f2c1c', crack: '#331b11' },
  flame: { core: '#ffdd8a', edge: '#ffa000' },
  accent: '#9c4722',
  sky: {
    top: '#2a2338',
    mid: '#6b4553',
    bottom: '#c98a63',
    sun: { x: 0.16, y: 0.26, color: '#ffcf94', size: 26 },
  },
  skyline: [
    { style: 'tenements', color: '#33232c', height: 0.56 },
    { style: 'tenements', color: '#4a3038', height: 0.72, detail: '#ffcb7d' },
  ],
  lightDir: { x: -0.7, y: -0.72 },
  lightColor: '#ffcf94',
  ambient: 'courtyard',
  grading: { gain: [1.1, 0.98, 0.88], lift: [0.03, 0.02, 0.02], saturation: 1.16, vignette: 0.44 },
  bloom: 0.48,
  music: { scale: [0, 2, 3, 7, 9], root: 49, tempo: 98, brightness: 0.42 },
};
