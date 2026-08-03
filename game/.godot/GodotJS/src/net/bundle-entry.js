"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomClient = exports.loadNetConfig = void 0;
/**
 * Entry point for `npm run bundle:net`. GodotJS scripts cannot resolve npm
 * packages at runtime, so the whole network layer (including
 * @supabase/supabase-js) is bundled into an IIFE assigned to
 * `globalThis.UBomberNet` and shipped next to the web export, where the
 * exported index.html loads it via a <script> tag (see
 * export_presets.cfg html/head_include and src/godot/net_bridge.ts).
 */
var config_1 = require("./config");
Object.defineProperty(exports, "loadNetConfig", { enumerable: true, get: function () { return config_1.loadNetConfig; } });
__exportStar(require("./protocol"), exports);
var room_1 = require("./room");
Object.defineProperty(exports, "RoomClient", { enumerable: true, get: function () { return room_1.RoomClient; } });
