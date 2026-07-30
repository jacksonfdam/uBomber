/**
 * Bridges Godot-side scripts to the bundled network layer.
 *
 * GodotJS cannot resolve npm packages at runtime, so `npm run bundle:net`
 * packs src/net (including @supabase/supabase-js) into scripts/net/bundle.js.
 * This module requires that bundle at runtime while borrowing its types from
 * the source entry point, so callers keep full type safety.
 *
 * Multiplayer needs browser APIs (fetch, WebSocket) and is therefore only
 * available in web exports; solo vs bots works everywhere.
 */
import type * as NetModule from '../net/bundle-entry';

declare const require: (id: string) => any;

let cached: typeof NetModule | null = null;

export function net(): typeof NetModule {
  if (!cached) {
    cached = require('../net/bundle') as typeof NetModule;
  }
  return cached;
}

export function isNetAvailable(): boolean {
  const g = globalThis as { fetch?: unknown; WebSocket?: unknown };
  return typeof g.fetch === 'function' && typeof g.WebSocket === 'function';
}
