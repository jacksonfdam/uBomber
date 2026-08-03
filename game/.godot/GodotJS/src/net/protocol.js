"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODE_LENGTH = exports.PROTOCOL_VERSION = void 0;
exports.generateRoomCode = generateRoomCode;
exports.isValidRoomCode = isValidRoomCode;
exports.inviteUrl = inviteUrl;
exports.roomCodeFromUrl = roomCodeFromUrl;
exports.channelName = channelName;
/**
 * Wire protocol for a room. Messages travel over a Supabase Realtime
 * broadcast channel named `room:<code>`; lobby membership uses the same
 * channel's presence.
 *
 * Topology is host-authoritative: the room creator runs the simulation
 * (including all bots) and broadcasts snapshots; guests send only inputs.
 */
exports.PROTOCOL_VERSION = 1;
/** Room codes avoid ambiguous characters (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
exports.CODE_LENGTH = 6;
function generateRoomCode(randomFloat = Math.random) {
    let code = '';
    for (let i = 0; i < exports.CODE_LENGTH; i++) {
        code += CODE_ALPHABET[Math.floor(randomFloat() * CODE_ALPHABET.length)];
    }
    return code;
}
function isValidRoomCode(code) {
    if (code.length !== exports.CODE_LENGTH)
        return false;
    return [...code].every((ch) => CODE_ALPHABET.includes(ch));
}
/** Invite URL a host shares with friends. */
function inviteUrl(origin, code) {
    return `${origin}/game/?room=${code}`;
}
/** Extracts a room code from a URL, or null. */
function roomCodeFromUrl(url) {
    const match = /[?&]room=([A-Za-z0-9]+)/.exec(url);
    if (!match)
        return null;
    const code = match[1].toUpperCase();
    return isValidRoomCode(code) ? code : null;
}
function channelName(code) {
    return `room:${code}`;
}
