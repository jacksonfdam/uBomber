"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioBank = void 0;
const godot_1 = require("godot");
/**
 * Runtime audio bank. All clips live in res://assets/audio/, which is
 * intentionally NOT shipped with the repository (see game/assets/audio/
 * README.md): drop in any sound pack with ops/install-sound-pack.sh and the
 * bank picks it up. Every lookup degrades to silence when a clip is absent,
 * so the game runs fine with no audio installed.
 */
const SFX_DIR = 'res://assets/audio/sfx';
const MUSIC_DIR = 'res://assets/audio/music';
/** Jingles play once; everything else loops. */
const ONE_SHOT_MUSIC = ['victory', 'draw'];
const SFX_POOL_SIZE = 8;
const MUSIC_DB = -8;
const SFX_DB = -4;
class AudioBankImpl {
    constructor() {
        this.pool = [];
        this.next = 0;
        this.music = null;
        this.currentMusic = null;
        this.streams = new Map();
    }
    /** Creates the player nodes under `root`. Call once from the main scene. */
    init(root) {
        if (this.pool.length > 0)
            return;
        for (let i = 0; i < SFX_POOL_SIZE; i++) {
            const player = new godot_1.AudioStreamPlayer();
            player.volume_db = SFX_DB;
            root.add_child(player);
            this.pool.push(player);
        }
        this.music = new godot_1.AudioStreamPlayer();
        this.music.volume_db = MUSIC_DB;
        root.add_child(this.music);
    }
    playSfx(name) {
        const stream = this.loadStream(`${SFX_DIR}/${name}.wav`);
        if (!stream || this.pool.length === 0)
            return;
        const player = this.pool[this.next];
        this.next = (this.next + 1) % this.pool.length;
        player.stream = stream;
        player.play();
    }
    playMusic(name) {
        if (!this.music)
            return;
        if (this.currentMusic === name && this.music.playing)
            return;
        const stream = this.loadStream(`${MUSIC_DIR}/${name}.ogg`);
        if (!stream) {
            this.stopMusic();
            return;
        }
        if ('loop' in stream || stream.loop !== undefined) {
            stream.loop = !ONE_SHOT_MUSIC.includes(name);
        }
        this.currentMusic = name;
        this.music.stream = stream;
        this.music.play();
    }
    stopMusic() {
        this.currentMusic = null;
        this.music?.stop();
    }
    loadStream(path) {
        if (this.streams.has(path))
            return this.streams.get(path) ?? null;
        let stream = null;
        if (godot_1.ResourceLoader.exists(path)) {
            stream = godot_1.ResourceLoader.load(path);
        }
        this.streams.set(path, stream);
        return stream;
    }
}
exports.AudioBank = new AudioBankImpl();
