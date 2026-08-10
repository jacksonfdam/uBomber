import { CAMPAIGN_STAGES, ROUNDS_PER_THEME } from './constants';
import { clampStage, stageAt } from './stage';

/**
 * Saved campaign progress. Version 1 tracked beaten map ids; version 2 tracks
 * the stage ladder, so the shape has to be migrated on load.
 */
export interface CampaignProgress {
  version: number;
  /** Highest stage cleared, 0..CAMPAIGN_STAGES. The next stage is this + 1. */
  cleared: number;
  /** Sum of the local player's stage scores. */
  totalScore: number;
}

export const CAMPAIGN_VERSION = 2;

export const EMPTY_PROGRESS: CampaignProgress = {
  version: CAMPAIGN_VERSION,
  cleared: 0,
  totalScore: 0,
};

/** The stage a player resumes on, clamped into the ladder. */
export function nextStage(progress: CampaignProgress): number {
  return clampStage(progress.cleared + 1);
}

export function isCampaignComplete(progress: CampaignProgress): boolean {
  return progress.cleared >= CAMPAIGN_STAGES;
}

/** Map id a stage is played on, given the catalog order. */
export function stageMapId(mapIds: string[], stage: number): string {
  const { themeIndex } = stageAt(stage, mapIds.length);
  return mapIds[Math.min(mapIds.length - 1, themeIndex)];
}

/** Round within the stage's theme, 1..ROUNDS_PER_THEME. */
export function stageRound(stage: number, themeCount: number): number {
  return stageAt(stage, themeCount).round;
}

/**
 * Campaign layouts are fixed: the seed comes from the stage number, not the
 * clock, so retrying a stage gives the identical arena and everyone's stage 12
 * is the same stage 12.
 */
export function campaignSeed(stage: number): number {
  return (0x5bd1e995 ^ Math.imul(clampStage(stage), 2654435761)) | 0;
}

/**
 * Normalizes any saved shape — version 2, the legacy map-id list, or garbage —
 * into a version 2 record.
 */
export function migrateProgress(raw: unknown): CampaignProgress {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PROGRESS };
  const record = raw as {
    cleared?: unknown;
    completed?: unknown;
    totalScore?: unknown;
  };

  const totalScore =
    typeof record.totalScore === 'number' && isFinite(record.totalScore)
      ? record.totalScore
      : 0;

  // Version 1 stored one entry per beaten map. Each of those districts is a
  // whole run of rounds now, so credit it as such. Ids are counted, never
  // looked up, so renaming a map can never wipe someone's progress.
  if (typeof record.cleared !== 'number' && Array.isArray(record.completed)) {
    const districts = record.completed.filter(
      (id) => typeof id === 'string'
    ).length;
    return {
      version: CAMPAIGN_VERSION,
      cleared: Math.min(CAMPAIGN_STAGES, districts * ROUNDS_PER_THEME),
      totalScore,
    };
  }

  const cleared =
    typeof record.cleared === 'number' && record.cleared > 0
      ? Math.min(CAMPAIGN_STAGES, Math.floor(record.cleared))
      : 0;
  return { version: CAMPAIGN_VERSION, cleared, totalScore };
}
