"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const godot_1 = require("godot");
const bot_1 = require("../ai/bot");
const audio_1 = require("./audio");
const constants_1 = require("../core/constants");
const game_1 = require("../core/game");
const types_1 = require("../core/types");
const atlas_1 = require("./atlas");
/** 4x the 16px source art; 15x13 tiles fill the 1280x832 viewport exactly. */
const TILE = 64;
const MARGIN_X = (1280 - constants_1.TILE_COLS * TILE) / 2;
const MARGIN_Y = (832 - constants_1.TILE_ROWS * TILE) / 2;
/** How long a defeated character lingers while fading out. */
const DEATH_FADE = 0.6;
const PLAYER_COLORS = [
    '#4f9dde',
    '#e2574c',
    '#57b26a',
    '#e0b34c',
    '#9a6dd7',
    '#5bc8c4',
];
/**
 * Renders and advances a match. Owns the authoritative simulation in solo
 * and host modes; in guest mode it just draws the latest host snapshot and
 * reports local input upward.
 *
 * Rendering is immediate-mode over a single sprite atlas: floor and blocks
 * are grayscale sprites tinted with the map theme, and solids plus characters
 * are painted row by row (painter's y-sort) for a 2.5D look.
 */
class MatchView extends godot_1.Node2D {
    constructor() {
        super(...arguments);
        this.def = null;
        this.state = null;
        this.bots = new Map();
        this.mode = 'solo';
        this.localSlot = 0;
        this.accumulator = 0;
        this.snapshotIn = 0;
        this.inputSendIn = 0;
        this.finishedNotified = false;
        /** Bomb press captured per frame, consumed by the next sim tick. */
        this.bombQueued = false;
        /** Pause is offline-only: solo and campaign, never online matches. */
        this.paused = false;
        /** True when the pause was requested by the quit dialog (no overlay). */
        this.dialogPause = false;
        /** Latest input per remote human slot (host mode). */
        this.remoteInputs = new Map();
        /** Previous-frame tallies used to fire sound effects on state changes. */
        this.heard = { bombs: 0, flames: 0, powerups: 0, alive: 0 };
        this.atlas = null;
        this.anims = new Map();
        this.viewTime = 0;
        this.lastFlameCount = 0;
        this.shake = 0;
        this.mapHash = 0;
        this.white = new godot_1.Color(1, 1, 1, 1);
        this.playerCols = [];
        this.theme = {
            floor: new godot_1.Color(1, 1, 1, 1),
            floorAlt: new godot_1.Color(1, 1, 1, 1),
            wall: new godot_1.Color(1, 1, 1, 1),
            crate: new godot_1.Color(1, 1, 1, 1),
            accent: new godot_1.Color(1, 1, 1, 1),
        };
        this.onSnapshot = null;
        this.onLocalInput = null;
        this.onFinished = null;
        /** Fired when the (dead) local player asks to skip the rest of the match. */
        this.onSkip = null;
        this.font = null;
    }
    _ready() {
        this.atlas = godot_1.ResourceLoader.load(atlas_1.ATLAS_PATH);
        this.font = godot_1.ResourceLoader.load('res://assets/fonts/PressStart2P-Regular.ttf');
        // CanvasItem.TEXTURE_FILTER_NEAREST: keep the pixel art crisp at 4x.
        this.texture_filter = 1;
    }
    startMatch(def, roster, seed, mode, localSlot) {
        this.def = def;
        this.mode = mode;
        this.localSlot = localSlot;
        this.state = (0, game_1.createGame)(def, roster, seed);
        this.bots.clear();
        if (mode !== 'guest') {
            roster.forEach((entry, slot) => {
                if (entry.kind === 'bot')
                    this.bots.set(slot, new bot_1.BotController(slot));
            });
        }
        this.finishedNotified = false;
        this.accumulator = 0;
        this.bombQueued = false;
        this.paused = false;
        this.heard = {
            bombs: 0,
            flames: 0,
            powerups: 0,
            alive: this.state.players.length,
        };
        this.anims.clear();
        this.viewTime = 0;
        this.lastFlameCount = 0;
        this.shake = 0;
        this.mapHash = hashString(def.id);
        this.playerCols = PLAYER_COLORS.map((hex) => new godot_1.Color(hex));
        this.theme = {
            floor: new godot_1.Color(def.theme.floor),
            floorAlt: new godot_1.Color(def.theme.floor).darkened(0.08),
            wall: new godot_1.Color(def.theme.wall),
            crate: new godot_1.Color(def.theme.crate),
            accent: new godot_1.Color(def.theme.accent),
        };
    }
    /** External pause control (quit dialog). Only offline matches truly pause;
     * online matches must keep simulating for the other players. */
    setPaused(value) {
        this.paused = this.mode === 'solo' && this.state?.status === 'running'
            ? value
            : false;
        this.dialogPause = this.paused;
        if (this.paused)
            this.accumulator = 0;
    }
    applySnapshot(state) {
        if (this.mode !== 'guest')
            return;
        this.state = state;
        this.playStateSounds(state);
        this.queue_redraw();
    }
    setRemoteInput(slot, input) {
        this.remoteInputs.set(slot, input);
    }
    getState() {
        return this.state;
    }
    _process(delta) {
        if (!this.state)
            return;
        // Offline pause (solo/campaign). Online matches must keep simulating.
        if (this.mode === 'solo' &&
            this.state.status === 'running' &&
            godot_1.Input.is_action_just_pressed('pause')) {
            this.paused = !this.paused;
            this.dialogPause = false;
        }
        if (this.paused) {
            this.accumulator = 0;
            this.queue_redraw();
            return;
        }
        // A local player who is out of lives can skip the spectator phase.
        const local = this.state.players[this.localSlot];
        if (this.state.status === 'running' &&
            local &&
            !local.alive &&
            local.lives <= 0 &&
            godot_1.Input.is_action_just_pressed('place_bomb')) {
            this.onSkip?.();
            return;
        }
        // Latch the bomb press at frame level: the sim ticks at 30 Hz while
        // frames run faster, so a per-frame "just pressed" often lands on a
        // frame that runs no tick and the press would be lost.
        if (godot_1.Input.is_action_just_pressed('place_bomb'))
            this.bombQueued = true;
        if (this.mode === 'guest') {
            this.inputSendIn -= delta;
            if (this.inputSendIn <= 0) {
                this.inputSendIn = 0.05;
                this.onLocalInput?.(this.readLocalInput());
            }
            this.updateAnims(delta);
            this.queue_redraw();
            return;
        }
        this.accumulator += Math.min(delta, 0.25);
        while (this.accumulator >= constants_1.TICK_DT) {
            this.accumulator -= constants_1.TICK_DT;
            this.stepOnce();
        }
        if (this.mode === 'host' && this.state.status === 'running') {
            this.snapshotIn -= delta;
            if (this.snapshotIn <= 0) {
                this.snapshotIn = 1 / constants_1.SNAPSHOT_RATE;
                this.onSnapshot?.(this.state);
            }
        }
        this.updateAnims(delta);
        this.queue_redraw();
    }
    stepOnce() {
        const state = this.state;
        if (state.status !== 'running') {
            this.notifyFinished();
            return;
        }
        const inputs = state.players.map((p) => {
            if (p.id === this.localSlot)
                return this.readLocalInput();
            const bot = this.bots.get(p.id);
            if (bot)
                return bot.update(state, constants_1.TICK_DT);
            return this.remoteInputs.get(p.id) ?? types_1.IDLE_INPUT;
        });
        (0, game_1.step)(state, inputs, constants_1.TICK_DT);
        this.playStateSounds(state);
        if (state.status !== 'running')
            this.notifyFinished();
    }
    /** Fires sfx by diffing entity tallies, so it works identically for the
     * local simulation and for host snapshots on guests. */
    playStateSounds(state) {
        const alive = state.players.filter((p) => p.alive).length;
        const exploded = this.heard.flames === 0 && state.flames.length > 0;
        if (state.bombs.length > this.heard.bombs)
            audio_1.AudioBank.playSfx('bomb_place');
        if (exploded)
            audio_1.AudioBank.playSfx('explosion');
        if (alive < this.heard.alive)
            audio_1.AudioBank.playSfx('death');
        if (state.powerups.length < this.heard.powerups && !exploded) {
            audio_1.AudioBank.playSfx('item');
        }
        this.heard = {
            bombs: state.bombs.length,
            flames: state.flames.length,
            powerups: state.powerups.length,
            alive,
        };
    }
    notifyFinished() {
        if (this.finishedNotified || !this.state)
            return;
        this.finishedNotified = true;
        try {
            this.onFinished?.(this.state.winner, this.state);
        }
        catch {
            // Last-resort recovery: a crashing finish handler must not soft-lock
            // the match screen — fall back to the skip path (menu / retry).
            this.onSkip?.();
        }
    }
    readLocalInput() {
        let dx = 0;
        let dy = 0;
        if (godot_1.Input.is_action_pressed('move_left'))
            dx -= 1;
        if (godot_1.Input.is_action_pressed('move_right'))
            dx += 1;
        if (godot_1.Input.is_action_pressed('move_up'))
            dy -= 1;
        if (godot_1.Input.is_action_pressed('move_down'))
            dy += 1;
        const bomb = this.bombQueued;
        this.bombQueued = false;
        return { dx, dy, bomb };
    }
    // ----------------------------------------------------------- animation
    updateAnims(delta) {
        const state = this.state;
        this.viewTime += delta;
        for (const p of state.players) {
            let anim = this.anims.get(p.id);
            if (!anim) {
                anim = {
                    x: p.pos.x,
                    y: p.pos.y,
                    facing: 'down',
                    moving: false,
                    walkTime: 0,
                    deathTime: -1,
                };
                this.anims.set(p.id, anim);
            }
            if (!p.alive) {
                anim.deathTime = anim.deathTime < 0 ? 0 : anim.deathTime + delta;
                anim.moving = false;
                continue;
            }
            const dx = p.pos.x - anim.x;
            const dy = p.pos.y - anim.y;
            anim.moving = Math.abs(dx) + Math.abs(dy) > 1e-4;
            if (anim.moving) {
                anim.facing =
                    Math.abs(dx) >= Math.abs(dy)
                        ? dx > 0
                            ? 'right'
                            : 'left'
                        : dy > 0
                            ? 'down'
                            : 'up';
                anim.walkTime += delta;
            }
            anim.x = p.pos.x;
            anim.y = p.pos.y;
        }
        if (state.flames.length > this.lastFlameCount)
            this.shake = 0.2;
        this.lastFlameCount = state.flames.length;
        if (this.shake > 0) {
            this.shake = Math.max(0, this.shake - delta);
            const amp = this.shake * 24;
            this.position = new godot_1.Vector2(Math.sin(this.viewTime * 73) * amp, Math.cos(this.viewTime * 91) * amp);
        }
        else {
            this.position = new godot_1.Vector2(0, 0);
        }
    }
    // ------------------------------------------------------------- drawing
    _draw() {
        const state = this.state;
        if (!state || !this.def || !this.atlas)
            return;
        this.drawFloor();
        this.drawContactShadows(state);
        this.drawDecor(state);
        this.drawPowerups(state);
        this.drawFlames(state);
        this.drawBombs(state);
        this.drawSolidsAndPlayers(state);
        this.drawScores(state);
        if (this.paused && !this.dialogPause)
            this.drawPauseOverlay();
    }
    /** Live scoreboard in the left margin: color chip, name and points per
     * player; dead players gray out. */
    drawScores(state) {
        if (!this.font)
            return;
        const gold = new godot_1.Color(1, 0.84, 0.35, 1);
        const dead = new godot_1.Color(0.45, 0.45, 0.45, 1);
        for (let i = 0; i < state.players.length; i++) {
            const p = state.players[i];
            const y = 26 + i * 62;
            this.draw_rect(new godot_1.Rect2(new godot_1.Vector2(14, y), new godot_1.Vector2(16, 16)), p.alive ? this.playerCols[p.id] : dead);
            this.draw_string(this.font, new godot_1.Vector2(38, y + 13), p.name.slice(0, 12), 0, -1, 9, p.alive ? this.white : dead);
            this.draw_string(this.font, new godot_1.Vector2(14, y + 38), String(p.score), 0, -1, 12, p.alive ? gold : dead);
            // Hearts for players with extra lives (solo/campaign humans): filled
            // for lives remaining, faded for lives spent.
            if (p.maxLives > 1) {
                const remaining = p.lives;
                for (let h = 0; h < p.maxLives; h++) {
                    this.drawHeart(96 + h * 20, y + 28, 2, h < remaining
                        ? new godot_1.Color(0.89, 0.34, 0.3, 1)
                        : new godot_1.Color(1, 1, 1, 0.16));
                }
            }
        }
        const local = state.players[this.localSlot];
        if (state.status === 'running' && local && !local.alive) {
            const out = local.lives <= 0;
            this.draw_string(this.font, new godot_1.Vector2(14, 790), out ? 'OUT! SPACE: skip' : 'Respawning…', 0, -1, 9, new godot_1.Color(0.8, 0.5, 0.4, 1));
        }
    }
    /** Small pixel heart built from rects; `unit` is the pixel size. */
    drawHeart(x, y, unit, color) {
        const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
        for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
                if (rows[r][c] !== 'X')
                    continue;
                this.draw_rect(new godot_1.Rect2(new godot_1.Vector2(x + c * unit, y + r * unit), new godot_1.Vector2(unit, unit)), color);
            }
        }
    }
    /** Dim overlay + label while the offline game is paused. */
    drawPauseOverlay() {
        this.draw_rect(new godot_1.Rect2(new godot_1.Vector2(0, 0), new godot_1.Vector2(1280, 832)), new godot_1.Color(0, 0, 0, 0.55));
        if (!this.font)
            return;
        this.draw_string(this.font, new godot_1.Vector2(0, 400), 'PAUSED', 1, 1280, 32, new godot_1.Color(1, 0.84, 0.35, 1));
        this.draw_string(this.font, new godot_1.Vector2(0, 440), 'P to resume - ESC to leave', 1, 1280, 10, new godot_1.Color(0.8, 0.78, 0.72, 1));
    }
    drawFloor() {
        for (let r = 0; r < constants_1.TILE_ROWS; r++) {
            for (let c = 0; c < constants_1.TILE_COLS; c++) {
                const reg = this.cellHash(c, r) % 7 === 0 ? atlas_1.SPR.floorB : atlas_1.SPR.floorA;
                const tint = (r + c) % 2 === 0 ? this.theme.floor : this.theme.floorAlt;
                this.drawSpr(reg, MARGIN_X + c * TILE, MARGIN_Y + r * TILE, TILE, TILE, tint);
            }
        }
    }
    /** Soft strip on floor tiles right below a wall/crate: cheap ambient
     * occlusion that sells the block height. */
    drawContactShadows(state) {
        const tint = new godot_1.Color(0, 0, 0, 0.17);
        for (let r = 0; r + 1 < constants_1.TILE_ROWS; r++) {
            for (let c = 0; c < constants_1.TILE_COLS; c++) {
                if (state.grid[r][c] === 'floor')
                    continue;
                if (state.grid[r + 1][c] !== 'floor')
                    continue;
                this.draw_rect(new godot_1.Rect2(new godot_1.Vector2(MARGIN_X + c * TILE, MARGIN_Y + (r + 1) * TILE), new godot_1.Vector2(TILE, TILE * 0.22)), tint);
            }
        }
    }
    /** Sparse accent-tinted bushes on deterministic floor cells. */
    drawDecor(state) {
        const tint = new godot_1.Color(this.theme.accent.r, this.theme.accent.g, this.theme.accent.b, 0.9);
        const size = TILE * 0.62;
        for (let r = 0; r < constants_1.TILE_ROWS; r++) {
            for (let c = 0; c < constants_1.TILE_COLS; c++) {
                if (state.grid[r][c] !== 'floor')
                    continue;
                if (this.cellHash(c, r) % 19 !== 3)
                    continue;
                this.drawSpr(atlas_1.SPR.bush, MARGIN_X + (c + 0.5) * TILE - size / 2, MARGIN_Y + (r + 0.55) * TILE - size / 2, size, size, tint);
            }
        }
    }
    drawPowerups(state) {
        for (const u of state.powerups) {
            const cx = MARGIN_X + (u.x + 0.5) * TILE;
            const cy = MARGIN_Y + (u.y + 0.5) * TILE;
            const bob = Math.sin(this.viewTime * 3 + u.x * 5 + u.y * 3) * 3;
            this.drawSpr(atlas_1.SPR.shadow, cx - 16, cy + TILE * 0.22, 32, 13, this.white);
            this.drawSpr(atlas_1.SPR.panel, cx - 22, cy - 22 + bob, 44, 44, this.white);
            const icon = u.type === 'bomb'
                ? (0, atlas_1.bombFrame)(0)
                : u.type === 'flame'
                    ? atlas_1.SPR.flameBall
                    : atlas_1.SPR.bolt;
            const size = u.type === 'speed' ? 34 : 28;
            this.drawSpr(icon, cx - size / 2, cy - size / 2 + bob, size, size, this.white);
        }
    }
    /** Picks beam/tip/center pieces from how each burning cell connects to its
     * neighbors, then fades them out over the flame's lifetime. */
    drawFlames(state) {
        const lit = new Set(state.flames.map((f) => `${f.x},${f.y}`));
        for (const f of state.flames) {
            const left = lit.has(`${f.x - 1},${f.y}`);
            const right = lit.has(`${f.x + 1},${f.y}`);
            const up = lit.has(`${f.x},${f.y - 1}`);
            const down = lit.has(`${f.x},${f.y + 1}`);
            const horiz = left || right;
            const vert = up || down;
            let reg;
            if ((horiz && vert) || (!horiz && !vert))
                reg = atlas_1.SPR.flameCenter;
            else if (horiz)
                reg = left && right ? atlas_1.SPR.flameH : right ? atlas_1.SPR.flameTipL : atlas_1.SPR.flameTipR;
            else
                reg = up && down ? atlas_1.SPR.flameV : down ? atlas_1.SPR.flameTipU : atlas_1.SPR.flameTipD;
            const alpha = Math.min(1, f.ttl / (constants_1.FLAME_TTL * 0.7));
            const size = reg === atlas_1.SPR.flameCenter ? TILE * 1.15 : TILE;
            this.drawSpr(reg, MARGIN_X + (f.x + 0.5) * TILE - size / 2, MARGIN_Y + (f.y + 0.5) * TILE - size / 2, size, size, new godot_1.Color(1, 1, 1, alpha));
        }
    }
    drawBombs(state) {
        for (const b of state.bombs) {
            const cx = MARGIN_X + (b.x + 0.5) * TILE;
            const cy = MARGIN_Y + (b.y + 0.5) * TILE;
            const burning = constants_1.BOMB_FUSE - b.fuse;
            const urgency = 1 - b.fuse / constants_1.BOMB_FUSE;
            const frame = Math.floor(burning * (5 + burning * 5)) % 6;
            const pulse = 1 + 0.05 * Math.sin(this.viewTime * (8 + urgency * 12));
            const size = TILE * 0.95 * pulse;
            this.drawSpr(atlas_1.SPR.shadow, cx - 20, cy + TILE * 0.18, 40, 17, this.white);
            this.drawSpr((0, atlas_1.bombFrame)(frame), cx - size / 2, cy - size / 2 - 3, size, size, new godot_1.Color(1, 1 - urgency * 0.35, 1 - urgency * 0.35, 1));
        }
    }
    /** Solid blocks and characters, painted top row to bottom so lower sprites
     * overlap higher ones (painter's y-sort). */
    drawSolidsAndPlayers(state) {
        const byRow = Array.from({ length: constants_1.TILE_ROWS }, () => []);
        for (const p of state.players) {
            const anim = this.anims.get(p.id);
            if (!p.alive && (!anim || anim.deathTime >= DEATH_FADE))
                continue;
            const row = Math.min(constants_1.TILE_ROWS - 1, Math.max(0, Math.floor(p.pos.y + 0.4)));
            byRow[row].push(p);
        }
        for (let r = 0; r < constants_1.TILE_ROWS; r++) {
            for (let c = 0; c < constants_1.TILE_COLS; c++) {
                const tile = state.grid[r][c];
                if (tile === 'floor')
                    continue;
                this.drawSpr(tile === 'wall' ? atlas_1.SPR.wall : atlas_1.SPR.crate, MARGIN_X + c * TILE, MARGIN_Y + r * TILE, TILE, TILE, tile === 'wall' ? this.theme.wall : this.theme.crate);
            }
            for (const p of byRow[r])
                this.drawPlayer(p);
        }
    }
    drawPlayer(p) {
        const anim = this.anims.get(p.id);
        const px = MARGIN_X + p.pos.x * TILE;
        const feetY = MARGIN_Y + p.pos.y * TILE + TILE * 0.4;
        const fade = p.alive ? 0 : Math.min(1, anim.deathTime / DEATH_FADE);
        if (p.alive) {
            this.drawSpr(atlas_1.SPR.shadow, px - 19, feetY - 7, 38, 15, this.white);
            if (p.id === this.localSlot) {
                this.drawSpr(atlas_1.SPR.ring, px - 26, feetY - 13, 52, 26, this.white);
            }
            this.drawSpr(atlas_1.SPR.ring, px - 21, feetY - 10, 42, 21, this.playerCols[p.id]);
        }
        const step = anim.moving ? Math.floor(anim.walkTime * 9) : 0;
        const reg = (0, atlas_1.charFrame)(p.id % atlas_1.CHAR_VARIANTS, anim.facing, step);
        // Respawn grace period reads as a fast blink.
        const blink = p.alive && p.invulnFor > 0 && Math.floor(this.viewTime * 10) % 2 === 1
            ? 0.25
            : 1;
        // Dead characters drift upward while fading out.
        this.drawSpr(reg, px - TILE / 2, feetY - TILE + 6 - fade * 24, TILE, TILE, new godot_1.Color(1, 1, 1, (1 - fade) * blink));
    }
    drawSpr(reg, x, y, w, h, tint) {
        this.draw_texture_rect_region(this.atlas, new godot_1.Rect2(new godot_1.Vector2(x, y), new godot_1.Vector2(w, h)), new godot_1.Rect2(new godot_1.Vector2(reg.x, reg.y), new godot_1.Vector2(reg.w, reg.h)), tint);
    }
    /** Deterministic per-cell hash, stable per map, for floor variety. */
    cellHash(c, r) {
        return ((c * 73856093) ^ (r * 19349663) ^ this.mapHash) >>> 0;
    }
}
exports.default = MatchView;
function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h = (h ^ text.charCodeAt(i)) >>> 0;
        h = (h * 16777619) >>> 0;
    }
    return h;
}
