import { FileAccess } from 'godot';
import type { MapDef } from '../core/types';

/** Reads the map catalog bundled with the game (res://maps). */
export function loadMapIds(): string[] {
  const raw = FileAccess.get_file_as_string('res://maps/index.json');
  return (JSON.parse(String(raw)) as { maps: string[] }).maps;
}

export function loadMapDef(id: string): MapDef {
  const raw = FileAccess.get_file_as_string(`res://maps/${id}.json`);
  return JSON.parse(String(raw)) as MapDef;
}
