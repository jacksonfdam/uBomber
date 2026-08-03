"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCampaign = loadCampaign;
exports.saveCampaign = saveCampaign;
exports.resetCampaign = resetCampaign;
exports.loadRankings = loadRankings;
exports.recordResults = recordResults;
exports.overallRanking = overallRanking;
exports.bestForMap = bestForMap;
const godot_1 = require("godot");
const CAMPAIGN_PATH = 'user://campaign.json';
const RANKINGS_PATH = 'user://rankings.json';
const MAX_ENTRIES = 200;
/** GodotJS exposes class enums either flat (FileAccess.WRITE) or namespaced
 * (FileAccess.ModeFlags.WRITE) depending on the binding version; 2 is the
 * documented value of ModeFlags.WRITE and the last-resort fallback. */
const WRITE_MODE = godot_1.FileAccess
    .ModeFlags?.WRITE ??
    godot_1.FileAccess.WRITE ??
    2;
function readJson(path) {
    try {
        if (!godot_1.FileAccess.file_exists(path))
            return null;
        return JSON.parse(String(godot_1.FileAccess.get_file_as_string(path)));
    }
    catch {
        return null;
    }
}
function writeJson(path, value) {
    // Persistence is best-effort: a storage failure must never break gameplay.
    try {
        const file = godot_1.FileAccess.open(path, WRITE_MODE);
        if (!file)
            return;
        file.store_string(JSON.stringify(value));
        file.close();
    }
    catch {
        /* ignore */
    }
}
// ------------------------------------------------------------- campaign
function loadCampaign() {
    const raw = readJson(CAMPAIGN_PATH);
    if (!raw || !Array.isArray(raw.completed)) {
        return { completed: [], totalScore: 0 };
    }
    return { completed: raw.completed, totalScore: raw.totalScore ?? 0 };
}
function saveCampaign(progress) {
    writeJson(CAMPAIGN_PATH, progress);
}
function resetCampaign() {
    const fresh = { completed: [], totalScore: 0 };
    saveCampaign(fresh);
    return fresh;
}
// ------------------------------------------------------------- rankings
function loadRankings() {
    const raw = readJson(RANKINGS_PATH);
    return raw && Array.isArray(raw.entries) ? raw.entries : [];
}
function recordResults(entries) {
    const all = [...loadRankings(), ...entries];
    writeJson(RANKINGS_PATH, { entries: all.slice(-MAX_ENTRIES) });
}
/** Total points per player name, best first. */
function overallRanking(entries) {
    const byName = new Map();
    for (const e of entries) {
        const row = byName.get(e.name) ?? { name: e.name, total: 0, wins: 0 };
        row.total += e.score;
        if (e.won)
            row.wins += 1;
        byName.set(e.name, row);
    }
    return [...byName.values()].sort((a, b) => b.total - a.total);
}
/** Highest-scoring entry for one map, or null if it was never played. */
function bestForMap(entries, mapId) {
    let best = null;
    for (const e of entries) {
        if (e.mapId !== mapId)
            continue;
        if (!best || e.score > best.score)
            best = e;
    }
    return best;
}
