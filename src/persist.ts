/**
 * Local persistence for campaign progress, rankings and the player's nickname,
 * kept in localStorage. Everything degrades gracefully: missing or corrupt
 * values read as empty, and a storage failure never interrupts gameplay
 * (private-mode browsers throw on write).
 */

import { DEFAULT_POST, type PostSettings } from './render/post';

export interface CampaignProgress {
  /** Map ids beaten, in the order they were completed. */
  completed: string[];
  /** Sum of the local player's match scores across campaign wins. */
  totalScore: number;
}

export interface RankingEntry {
  name: string;
  mapId: string;
  score: number;
  won: boolean;
}

const CAMPAIGN_KEY = 'ubomber.campaign';
const RANKINGS_KEY = 'ubomber.rankings';
const NICKNAME_KEY = 'ubomber.nickname';
const QUALITY_KEY = 'ubomber.quality';
const MAX_ENTRIES = 200;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort: private browsing and full quotas must not break the game.
  }
}

// -------------------------------------------------------------- campaign

export function loadCampaign(): CampaignProgress {
  const raw = readJson<CampaignProgress>(CAMPAIGN_KEY);
  if (!raw || !Array.isArray(raw.completed)) return { completed: [], totalScore: 0 };
  return { completed: raw.completed, totalScore: raw.totalScore ?? 0 };
}

export function saveCampaign(progress: CampaignProgress): void {
  writeJson(CAMPAIGN_KEY, progress);
}

export function resetCampaign(): CampaignProgress {
  const fresh: CampaignProgress = { completed: [], totalScore: 0 };
  saveCampaign(fresh);
  return fresh;
}

// -------------------------------------------------------------- rankings

export function loadRankings(): RankingEntry[] {
  const raw = readJson<{ entries: RankingEntry[] }>(RANKINGS_KEY);
  return raw && Array.isArray(raw.entries) ? raw.entries : [];
}

export function recordResults(entries: RankingEntry[]): void {
  const all = [...loadRankings(), ...entries];
  writeJson(RANKINGS_KEY, { entries: all.slice(-MAX_ENTRIES) });
}

/** Total points per player name, best first. */
export function overallRanking(
  entries: RankingEntry[]
): Array<{ name: string; total: number; wins: number }> {
  const byName = new Map<string, { name: string; total: number; wins: number }>();
  for (const entry of entries) {
    const row = byName.get(entry.name) ?? { name: entry.name, total: 0, wins: 0 };
    row.total += entry.score;
    if (entry.won) row.wins += 1;
    byName.set(entry.name, row);
  }
  return [...byName.values()].sort((a, b) => b.total - a.total);
}

/** Highest-scoring entry for one map, or null if it was never played. */
export function bestForMap(entries: RankingEntry[], mapId: string): RankingEntry | null {
  let best: RankingEntry | null = null;
  for (const entry of entries) {
    if (entry.mapId !== mapId) continue;
    if (!best || entry.score > best.score) best = entry;
  }
  return best;
}

// -------------------------------------------------------------- nickname

export function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(name: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, name.slice(0, 16));
  } catch {
    // Best-effort.
  }
}

// --------------------------------------------------------------- quality

export function loadQuality(): PostSettings {
  const raw = readJson<Partial<PostSettings>>(QUALITY_KEY);
  if (!raw) return { ...DEFAULT_POST };
  return {
    enabled: raw.enabled ?? DEFAULT_POST.enabled,
    bloom: raw.bloom ?? DEFAULT_POST.bloom,
    grain: raw.grain ?? DEFAULT_POST.grain,
    aberration: raw.aberration ?? DEFAULT_POST.aberration,
  };
}

export function saveQuality(settings: PostSettings): void {
  writeJson(QUALITY_KEY, settings);
}
