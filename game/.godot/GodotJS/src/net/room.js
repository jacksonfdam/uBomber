"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomClient = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const constants_1 = require("../core/constants");
const protocol_1 = require("./protocol");
/**
 * Thin wrapper around Supabase for one room.
 *
 * The `rooms` table is the invite-code registry (so a code can be validated
 * before joining); everything realtime — lobby presence, inputs, snapshots —
 * flows through a broadcast channel and never touches the database.
 */
class RoomClient {
    constructor(config, events = {}) {
        this.events = events;
        this.channel = null;
        this.code = '';
        this.isHost = false;
        this.supabase = (0, supabase_js_1.createClient)(config.supabaseUrl, config.supabaseAnonKey, {
            auth: { persistSession: false },
        });
        this.clientId = cryptoRandomId();
    }
    /** Registers a room and joins its channel as host. Returns the code. */
    async createRoom(mapId, nickname) {
        const code = (0, protocol_1.generateRoomCode)();
        const { error } = await this.supabase.from('rooms').insert({
            code,
            map_id: mapId,
            host_client_id: this.clientId,
        });
        if (error)
            throw new Error(`could not create room: ${error.message}`);
        this.isHost = true;
        await this.joinChannel(code, nickname);
        return code;
    }
    /** Validates the code against the registry and joins the lobby. */
    async joinRoom(code, nickname) {
        const normalized = code.toUpperCase();
        if (!(0, protocol_1.isValidRoomCode)(normalized)) {
            throw new Error('invalid room code');
        }
        const { data, error } = await this.supabase
            .from('rooms')
            .select('code,status')
            .eq('code', normalized)
            .maybeSingle();
        if (error)
            throw new Error(`could not look up room: ${error.message}`);
        if (!data)
            throw new Error('room not found');
        if (data.status !== 'lobby')
            throw new Error('match already started');
        this.isHost = false;
        await this.joinChannel(normalized, nickname);
    }
    async joinChannel(code, nickname) {
        this.code = code;
        const channel = this.supabase.channel((0, protocol_1.channelName)(code), {
            config: { presence: { key: this.clientId }, broadcast: { self: false } },
        });
        channel.on('presence', { event: 'sync' }, () => {
            this.events.onLobbyChange?.(this.members());
        });
        channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
            this.events.onMessage?.(payload);
        });
        await new Promise((resolve, reject) => {
            channel.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ nickname, isHost: this.isHost });
                    resolve();
                }
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    reject(new Error(`channel ${status}`));
                }
            });
        });
        this.channel = channel;
    }
    /** Current lobby roster from presence, host first, capped at MAX_HUMANS. */
    members() {
        if (!this.channel)
            return [];
        const state = this.channel.presenceState();
        const members = Object.entries(state).map(([clientId, metas]) => ({
            clientId,
            nickname: metas[0]?.nickname ?? 'Player',
            isHost: metas[0]?.isHost ?? false,
        }));
        members.sort((a, b) => Number(b.isHost) - Number(a.isHost));
        return members.slice(0, constants_1.MAX_HUMANS);
    }
    async send(msg) {
        if (!this.channel)
            throw new Error('not in a room');
        await this.channel.send({ type: 'broadcast', event: 'msg', payload: msg });
    }
    /** Host marks the room as started so late joins are rejected. */
    async markStarted() {
        if (!this.isHost)
            return;
        await this.supabase
            .from('rooms')
            .update({ status: 'playing' })
            .eq('code', this.code);
    }
    async leave() {
        if (this.channel) {
            await this.channel.unsubscribe();
            this.channel = null;
        }
        if (this.isHost && this.code) {
            await this.supabase
                .from('rooms')
                .update({ status: 'finished' })
                .eq('code', this.code);
        }
    }
}
exports.RoomClient = RoomClient;
function cryptoRandomId() {
    const globalCrypto = globalThis.crypto;
    if (globalCrypto?.randomUUID)
        return globalCrypto.randomUUID();
    return `c-${Math.random().toString(36).slice(2, 10)}`;
}
