/**
 * Entry point for `npm run bundle:net`. GodotJS scripts cannot resolve npm
 * packages at runtime, so the whole network layer (including
 * @supabase/supabase-js) is bundled into scripts/net/bundle.js and imported
 * from there by the Godot-side scripts.
 */
export { loadNetConfig } from './config';
export * from './protocol';
export { RoomClient } from './room';
export type { LobbyMember, NetConfig, RoomEvents } from './room';
