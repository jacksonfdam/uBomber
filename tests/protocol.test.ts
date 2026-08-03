import { describe, expect, it } from 'vitest';
import {
  CODE_LENGTH,
  generateRoomCode,
  inviteUrl,
  isValidRoomCode,
  roomCodeFromUrl,
} from '../src/net/protocol';

describe('room codes', () => {
  it('generates valid codes without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('rejects malformed codes', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('ABCDE0')).toBe(false);
    expect(isValidRoomCode('abcdef!')).toBe(false);
  });
});

describe('invite links', () => {
  it('builds and parses round-trip', () => {
    const url = inviteUrl('https://ubomber.example.com', 'ABCDEF');
    expect(url).toBe('https://ubomber.example.com/?room=ABCDEF');
    expect(roomCodeFromUrl(url)).toBe('ABCDEF');
  });

  it('normalizes lowercase codes and rejects junk', () => {
    expect(roomCodeFromUrl('https://x.test/?room=abcdef')).toBe('ABCDEF');
    expect(roomCodeFromUrl('https://x.test/?room=nope')).toBeNull();
    expect(roomCodeFromUrl('https://x.test/')).toBeNull();
  });
});
