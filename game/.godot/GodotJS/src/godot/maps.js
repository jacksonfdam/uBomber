"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMapIds = loadMapIds;
exports.loadMapDef = loadMapDef;
const godot_1 = require("godot");
/** Reads the map catalog bundled with the game (res://maps). */
function loadMapIds() {
    const raw = godot_1.FileAccess.get_file_as_string('res://maps/index.json');
    return JSON.parse(String(raw)).maps;
}
function loadMapDef(id) {
    const raw = godot_1.FileAccess.get_file_as_string(`res://maps/${id}.json`);
    return JSON.parse(String(raw));
}
