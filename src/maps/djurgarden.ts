/**
 * Djurgården — the royal park island in autumn.
 * Mown grass and gravel between the museums, oak canopy behind, leaves coming
 * down. Few walls to hide behind and long tree-lines of crates.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';

export const def: MapDef = {
  id: 'djurgarden',
  name: 'Djurgården',
  district: 'Djurgården (Royal park island)',
  description:
    'Open parkland between the museums: few walls to hide behind, tree lines of crates everywhere.',
  grid: [
    '###############',
    '#1..???????..2#',
    '#.??.??*??.??.#',
    '#??#???????#??#',
    '#.???.???.???.#',
    '#??????*??????#',
    '#5?.???????.?6#',
    '#??????*??????#',
    '#.???.???.???.#',
    '#??#???????#??#',
    '#.??.??*??.??.#',
    '#3..???????..4#',
    '###############',
  ],
};

export const theme: MapTheme = {
  tileset: 'park',
  face: 'timber',
  floor: { base: '#7f9455', alt: '#a8b573', grout: '#4e5c33' },
  wall: { top: '#6d8a4a', front: '#38512f', edge: '#87a35c' },
  crate: { top: '#d0a05a', front: '#a87e46', interior: '#4d3a20', crack: '#312414' },
  flame: { core: '#ffe08a', edge: '#ff8f00' },
  accent: '#c76a2a',
  sky: {
    top: '#3f6ea8',
    mid: '#8fb2cf',
    bottom: '#e8d7ae',
    sun: { x: 0.8, y: 0.22, color: '#ffe9b8', size: 30 },
  },
  skyline: [
    { style: 'trees', color: '#2f4a2e', height: 0.5 },
    { style: 'trees', color: '#46652f', height: 0.64, detail: '#c98a35' },
  ],
  lightDir: { x: 0.55, y: -0.82 },
  lightColor: '#ffe9b8',
  weather: 'leaves',
  ambient: 'park',
  grading: { gain: [1.06, 1.02, 0.9], lift: [0.02, 0.02, 0.01], saturation: 1.14, vignette: 0.34 },
  bloom: 0.4,
  music: { scale: [0, 2, 4, 5, 7, 9], root: 53, tempo: 108, brightness: 0.68 },
};
