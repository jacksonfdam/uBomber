"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNetConfig = loadNetConfig;
/**
 * Runtime configuration for the web build. The hosting site serves a
 * /config.json next to the game (see web/public/config.json.example and
 * ops/ for the local Docker equivalent), so the same export runs against
 * any Supabase project without rebuilding.
 */
async function loadNetConfig(baseUrl = '') {
    try {
        const res = await fetch(`${baseUrl}/config.json`);
        if (!res.ok)
            return null;
        const raw = (await res.json());
        if (!raw.supabaseUrl || !raw.supabaseAnonKey)
            return null;
        return { supabaseUrl: raw.supabaseUrl, supabaseAnonKey: raw.supabaseAnonKey };
    }
    catch {
        return null;
    }
}
