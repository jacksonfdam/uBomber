/**
 * Entry point for `npm run bundle:net`. GodotJS scripts cannot resolve npm
 * packages at runtime, so the whole network layer (including
 * @supabase/supabase-js) is bundled into an IIFE assigned to
 * `globalThis.UBomberNet` and shipped next to the web export, where the
 * exported index.html loads it via a <script> tag (see
 * export_presets.cfg html/head_include and src/godot/net_bridge.ts).
 */
export { loadNetConfig } from './config';
export * from './protocol';
export { RoomClient } from './room';
export type { LobbyMember, NetConfig, RoomEvents } from './room';
