/**
 * Bridges Godot-side scripts to the bundled network layer.
 *
 * GodotJS cannot resolve npm packages at runtime, so `npm run bundle:net`
 * packs src/net (including @supabase/supabase-js) into an IIFE that assigns
 * itself to `globalThis.UBomberNet`. The web export loads it via a <script>
 * tag injected through the export preset's html/head_include, so the bundle
 * ships next to the exported game instead of inside the pck.
 *
 * Multiplayer needs browser APIs (fetch, WebSocket) and is therefore only
 * available in web exports; solo vs bots works everywhere.
 */
import type * as NetModule from '../net/bundle-entry';

export function net(): typeof NetModule | null {
  const bundle = (globalThis as { UBomberNet?: typeof NetModule }).UBomberNet;
  return bundle ?? null;
}

export function isNetAvailable(): boolean {
  const g = globalThis as { fetch?: unknown; WebSocket?: unknown };
  return (
    typeof g.fetch === 'function' &&
    typeof g.WebSocket === 'function' &&
    net() !== null
  );
}
