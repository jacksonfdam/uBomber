import { FileAccess } from 'godot';

/**
 * Local persistence for campaign progress and rankings, stored as JSON under
 * user:// (browser IndexedDB in web builds, the Godot data dir natively).
 * Everything degrades gracefully: missing or corrupt files read as empty.
 */

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

const CAMPAIGN_PATH = 'user://campaign.json';
const RANKINGS_PATH = 'user://rankings.json';
const MAX_ENTRIES = 200;

function readJson<T>(path: string): T | null {
  if (!FileAccess.file_exists(path)) return null;
  try {
    return JSON.parse(String(FileAccess.get_file_as_string(path))) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  const file = FileAccess.open(path, FileAccess.WRITE);
  if (!file) return;
  file.store_string(JSON.stringify(value));
  file.close();
}

// ------------------------------------------------------------- campaign

export function loadCampaign(): CampaignProgress {
  const raw = readJson<CampaignProgress>(CAMPAIGN_PATH);
  if (!raw || !Array.isArray(raw.completed)) {
    return { completed: [], totalScore: 0 };
  }
  return { completed: raw.completed, totalScore: raw.totalScore ?? 0 };
}

export function saveCampaign(progress: CampaignProgress): void {
  writeJson(CAMPAIGN_PATH, progress);
}

export function resetCampaign(): CampaignProgress {
  const fresh = { completed: [], totalScore: 0 };
  saveCampaign(fresh);
  return fresh;
}

// ------------------------------------------------------------- rankings

export function loadRankings(): RankingEntry[] {
  const raw = readJson<{ entries: RankingEntry[] }>(RANKINGS_PATH);
  return raw && Array.isArray(raw.entries) ? raw.entries : [];
}

export function recordResults(entries: RankingEntry[]): void {
  const all = [...loadRankings(), ...entries];
  writeJson(RANKINGS_PATH, { entries: all.slice(-MAX_ENTRIES) });
}

/** Total points per player name, best first. */
export function overallRanking(
  entries: RankingEntry[]
): Array<{ name: string; total: number; wins: number }> {
  const byName = new Map<string, { name: string; total: number; wins: number }>();
  for (const e of entries) {
    const row = byName.get(e.name) ?? { name: e.name, total: 0, wins: 0 };
    row.total += e.score;
    if (e.won) row.wins += 1;
    byName.set(e.name, row);
  }
  return [...byName.values()].sort((a, b) => b.total - a.total);
}

/** Highest-scoring entry for one map, or null if it was never played. */
export function bestForMap(
  entries: RankingEntry[],
  mapId: string
): RankingEntry | null {
  let best: RankingEntry | null = null;
  for (const e of entries) {
    if (e.mapId !== mapId) continue;
    if (!best || e.score > best.score) best = e;
  }
  return best;
}
