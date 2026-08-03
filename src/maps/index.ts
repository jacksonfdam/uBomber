/**
 * The map catalog, in campaign order.
 *
 * Adding a map is one file plus one line here: a MapDef grid and a MapTheme.
 * No art, no audio, no build step — the renderer synthesizes the tileset,
 * backdrop, particle palette, colour grade and music from the theme alone.
 */

import type { MapDef } from '../core/types';
import type { MapTheme } from '../render/theme';
import * as gamlaStan from './gamla-stan';
import * as tCentralen from './t-centralen';
import * as sodermalm from './sodermalm';
import * as ostermalm from './ostermalm';
import * as djurgarden from './djurgarden';
import * as vasastan from './vasastan';
import * as kungsholmen from './kungsholmen';
import * as skansen from './skansen';
import * as slussen from './slussen';
import * as skargarden from './skargarden';

export interface MapEntry {
  def: MapDef;
  theme: MapTheme;
}

export const MAPS: MapEntry[] = [
  gamlaStan,
  tCentralen,
  sodermalm,
  ostermalm,
  djurgarden,
  vasastan,
  kungsholmen,
  skansen,
  slussen,
  skargarden,
].map((module) => ({ def: module.def, theme: module.theme }));

export const MAP_IDS: string[] = MAPS.map((entry) => entry.def.id);

export function mapById(id: string): MapEntry | undefined {
  return MAPS.find((entry) => entry.def.id === id);
}

/** Falls back to the first map so a stale saved id can never wedge the menu. */
export function mapOrFirst(id: string | null): MapEntry {
  return (id ? mapById(id) : undefined) ?? MAPS[0];
}
