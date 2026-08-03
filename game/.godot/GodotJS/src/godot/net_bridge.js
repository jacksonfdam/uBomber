"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.net = net;
exports.isNetAvailable = isNetAvailable;
function net() {
    const bundle = globalThis.UBomberNet;
    return bundle ?? null;
}
function isNetAvailable() {
    const g = globalThis;
    return (typeof g.fetch === 'function' &&
        typeof g.WebSocket === 'function' &&
        net() !== null);
}
