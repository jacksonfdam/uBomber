/**
 * Grid helpers shared by the simulation and the monsters.
 *
 * They live in their own module so `monsters.ts` can use them without
 * importing `game.ts`, which imports `monsters.ts` in turn.
 */

import { TILE_COLS, TILE_ROWS } from './constants';
import type { Vec2 } from './types';

/** The four orthogonal steps, in the order every scan walks them. */
export const DIRS: Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function tileOf(pos: Vec2): Vec2 {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y) };
}

export function isInside(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < TILE_COLS && y < TILE_ROWS;
}

/** Moves one axis of `pos` toward `target`, never overshooting it. */
export function approach(
  pos: Vec2,
  axis: 'x' | 'y',
  target: number,
  maxDelta: number
): void {
  const diff = target - pos[axis];
  if (Math.abs(diff) <= maxDelta) {
    pos[axis] = target;
  } else {
    pos[axis] += Math.sign(diff) * maxDelta;
  }
}
