import type { NetConfig } from './room';

/**
 * Runtime configuration. The hosting site serves a /config.json next to the
 * build (see public/config.json.example), so the same build runs against any
 * Supabase project without being rebuilt. Missing or malformed config simply
 * turns online play off.
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
