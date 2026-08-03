"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rand = rand;
exports.randInt = randInt;
/** Advances the state and returns a float in [0, 1). */
function rand(carrier) {
    carrier.rngState = (carrier.rngState + 0x6d2b79f5) | 0;
    let t = carrier.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Advances the state and returns an integer in [0, max). */
function randInt(carrier, max) {
    return Math.floor(rand(carrier) * max);
}
