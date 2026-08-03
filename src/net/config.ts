import type { NetConfig } from './room';

/**
 * Runtime configuration for the web build. The hosting site serves a
 * /config.json next to the game (see web/public/config.json.example and
 * ops/ for the local Docker equivalent), so the same export runs against
 * any Supabase project without rebuilding.
 */
export async function loadNetConfig(baseUrl = ''): Promise<NetConfig | null> {
  try {
    const res = await fetch(`${baseUrl}/config.json`);
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      supabaseUrl?: string;
      supabaseAnonKey?: string;
    };
    if (!raw.supabaseUrl || !raw.supabaseAnonKey) return null;
    return { supabaseUrl: raw.supabaseUrl, supabaseAnonKey: raw.supabaseAnonKey };
  } catch {
    return null;
  }
}
