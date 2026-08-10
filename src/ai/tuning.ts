import type { AiDifficulty } from '../core/types';

export type HuntGoal = 'powerup' | 'crate' | 'enemy';

export interface BotTuning {
  /** Base seconds between calm re-plans. */
  replanInterval: number;
  /** How soon the next step of the path must burn before the bot reacts. */
  reactionThreshold: number;
  /** Slack demanded inside the fuse before committing to a bomb. */
  escapeMargin: number;
  /** The same, once the match has dragged past the halfway mark. */
  lateEscapeMargin: number;
  /** Timing pads used when crossing a tile that is about to burn. */
  crossPadBefore: number;
  crossPadAfter: number;
  /** Order the hunt goals are tried in. */
  huntOrder: HuntGoal[];
  /** Chance of passing up an available bombing opportunity, 0..1. */
  hesitation: number;
}

/**
 * Difficulty presets. 'normal' repeats the numbers the bots have always used,
 * so the default is behaviour-preserving down to the tick.
 */
export const BOT_TUNING: Record<AiDifficulty, BotTuning> = {
  easy: {
    replanInterval: 0.45,
    // Kept generous on purpose: an easy bot should be a soft opponent, not a
    // suicidal one. Difficulty lives in the cadence, hesitation and hunt order.
    reactionThreshold: 0.7,
    escapeMargin: 0.6,
    lateEscapeMargin: 0.35,
    // Same crossing pads as normal: widening them shrinks the set of usable
    // escape routes, which makes a bot stand still in a blast rather than look
    // cautious.
    crossPadBefore: 0.35,
    crossPadAfter: 0.25,
    huntOrder: ['crate', 'powerup', 'enemy'],
    hesitation: 0.35,
  },
  normal: {
    replanInterval: 0.25,
    reactionThreshold: 0.6,
    escapeMargin: 0.4,
    lateEscapeMargin: 0.2,
    crossPadBefore: 0.35,
    crossPadAfter: 0.25,
    huntOrder: ['powerup', 'crate', 'enemy'],
    hesitation: 0,
  },
  hard: {
    replanInterval: 0.15,
    reactionThreshold: 0.9,
    escapeMargin: 0.3,
    lateEscapeMargin: 0.15,
    crossPadBefore: 0.25,
    crossPadAfter: 0.15,
    huntOrder: ['enemy', 'powerup', 'crate'],
    hesitation: 0,
  },
};

/**
 * Deterministic 0..1 value from a tick and a slot. Bots must not touch the
 * simulation RNG — that would desync host and guests — so hesitation is hashed
 * instead of drawn.
 */
export function hash01(tick: number, slot: number): number {
  let h = Math.imul(tick ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ Math.imul(slot + 1, 0xc2b2ae35), 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
