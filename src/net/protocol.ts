import type { GameState, PlayerInput } from '../core/types';

/**
 * Wire protocol for a room. Messages travel over a Supabase Realtime
 * broadcast channel named `room:<code>`; lobby membership uses the same
 * channel's presence.
 *
 * Topology is host-authoritative: the room creator runs the simulation
 * (including all bots) and broadcasts snapshots; guests send only inputs.
 */

export const PROTOCOL_VERSION = 1;

/** Guest input for a tick. */
export interface InputMsg {
  type: 'input';
  slot: number;
  input: PlayerInput;
}

/** Host state broadcast at SNAPSHOT_RATE Hz. */
export interface SnapshotMsg {
  type: 'snapshot';
  state: GameState;
}

/** Host starts the match: everyone builds the same initial state. */
export interface StartMsg {
  type: 'start';
  version: number;
  mapId: string;
  seed: number;
  roster: Array<{ kind: 'human' | 'bot'; name: string; clientId: string | null }>;
}

/** Host announces the result so guests can show the podium immediately. */
export interface GameOverMsg {
  type: 'game_over';
  winner: number | null;
}

export type RoomMsg = InputMsg | SnapshotMsg | StartMsg | GameOverMsg;

/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function generateRoomCode(randomFloat: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(randomFloat() * CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

/** Invite URL a host shares with friends. */
export function inviteUrl(origin: string, code: string): string {
  return `${origin}/?room=${code}`;
}

/** Extracts a room code from a URL, or null. */
export function roomCodeFromUrl(url: string): string | null {
  const match = /[?&]room=([A-Za-z0-9]+)/.exec(url);
  if (!match) return null;
  const code = match[1].toUpperCase();
  return isValidRoomCode(code) ? code : null;
}

export function channelName(code: string): string {
  return `room:${code}`;
}
