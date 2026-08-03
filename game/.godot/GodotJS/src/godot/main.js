"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const godot_1 = require("godot");
const constants_1 = require("../core/constants");
const audio_1 = require("./audio");
const maps_1 = require("./maps");
const match_view_1 = __importDefault(require("./match_view"));
const net_bridge_1 = require("./net_bridge");
const persist_1 = require("./persist");
/** Total combatants when humans alone don't fill the arena. */
const TARGET_COMBATANTS = 4;
/**
 * Root scene controller: main menu, online lobby, and match lifecycle.
 * Attached to res://scenes/main.tscn.
 */
class Main extends godot_1.Control {
    constructor() {
        super(...arguments);
        this.room = null;
        this.view = null;
        this.members = [];
        this.mapIds = [];
        /** Campaign state: beat every map, in catalog order, progress persisted. */
        this.campaign = false;
        this.campaignMapId = null;
        this.progress = { completed: [], totalScore: 0 };
        /** What endMatch() should do after the results screen. */
        this.afterMatch = 'menu';
        this.currentMapId = null;
    }
    _ready() {
        audio_1.AudioBank.init(this);
        this.mapIds = (0, maps_1.loadMapIds)();
        const mapOption = this.node('Menu/MapOption');
        for (const id of this.mapIds) {
            mapOption.add_item((0, maps_1.loadMapDef)(id).name);
        }
        mapOption.select(0);
        this.progress = (0, persist_1.loadCampaign)();
        this.onPressed('Menu/PlaySolo', () => this.startSolo());
        this.onPressed('Menu/CampaignButton', () => this.startCampaign());
        this.onPressed('Menu/CreateRoom', () => void this.createRoom());
        this.onPressed('Menu/JoinRoom', () => void this.joinRoom());
        this.onPressed('Menu/RankingsButton', () => this.showRankings());
        this.onPressed('Rankings/BackButton', () => this.showMenu());
        this.onPressed('Menu/CreditsButton', () => this.showCredits());
        this.onPressed('Credits/CreditsBack', () => this.showMenu());
        this.onPressed('Lobby/StartButton', () => this.startOnlineMatch());
        this.onPressed('Lobby/LeaveButton', () => void this.leaveRoom());
        this.onPressed('Quit/QuitYes', () => this.confirmQuit());
        this.onPressed('Quit/QuitNo', () => this.closeQuitConfirm());
        // Invite links (/game/?room=CODE) drop straight into the join flow.
        const invited = this.roomCodeFromLocation();
        if (invited) {
            this.node('Menu/RoomCodeEdit').text = invited;
            this.setStatus(`Invite detected: press "Join room" to enter ${invited}`);
        }
        this.showMenu();
    }
    /** Esc navigation: back out of sub-screens; in a match, ask first. */
    _process(_delta) {
        if (!godot_1.Input.is_action_just_pressed('back'))
            return;
        if (this.node('Quit').visible) {
            this.closeQuitConfirm();
            return;
        }
        if (this.view && this.view.getState()?.status === 'running') {
            this.openQuitConfirm();
            return;
        }
        if (this.node('Lobby').visible) {
            void this.leaveRoom();
            return;
        }
        if (this.node('Rankings').visible ||
            this.node('Credits').visible) {
            this.showMenu();
        }
    }
    // -------------------------------------------------------- quit confirm
    openQuitConfirm() {
        this.node('Quit').visible = true;
        this.node('QuitPanel').visible = true;
        this.node('Quit/QuitNo').grab_focus();
        // Solo/campaign matches hold still behind the dialog; online keeps going.
        this.view?.setPaused(true);
    }
    closeQuitConfirm() {
        this.node('Quit').visible = false;
        this.node('QuitPanel').visible = false;
        this.view?.setPaused(false);
    }
    confirmQuit() {
        this.closeQuitConfirm();
        this.campaign = false;
        this.afterMatch = 'menu';
        this.endMatch();
    }
    // ---------------------------------------------------------------- solo
    soloRoster() {
        // Solo and campaign humans get extra lives; bots (and online players,
        // whose roster is built in startOnlineMatch) always have one.
        return [
            { kind: 'human', name: this.nickname(), lives: constants_1.SOLO_LIVES },
            { kind: 'bot', name: 'Bot Nils' },
            { kind: 'bot', name: 'Bot Astrid' },
            { kind: 'bot', name: 'Bot Erik' },
        ];
    }
    startSolo() {
        this.campaign = false;
        this.beginMatch(this.selectedMapId(), this.soloRoster(), this.newSeed(), 'solo', 0);
    }
    // ------------------------------------------------------------ campaign
    startCampaign() {
        if (this.progress.completed.length >= this.mapIds.length) {
            this.progress = (0, persist_1.resetCampaign)();
        }
        const next = this.nextCampaignMap();
        if (!next)
            return;
        this.campaign = true;
        this.campaignMapId = next;
        this.beginMatch(next, this.soloRoster(), this.newSeed(), 'solo', 0);
    }
    nextCampaignMap() {
        return this.mapIds.find((id) => !this.progress.completed.includes(id)) ?? null;
    }
    // -------------------------------------------------------------- online
    async createRoom() {
        const client = await this.connect();
        if (!client)
            return;
        try {
            const code = await client.createRoom(this.selectedMapId(), this.nickname());
            this.showLobby(code, true);
        }
        catch (err) {
            this.setStatus(String(err));
        }
    }
    async joinRoom() {
        const code = this.node('Menu/RoomCodeEdit').text.trim();
        if (!code) {
            this.setStatus('Enter a room code first.');
            return;
        }
        const client = await this.connect();
        if (!client)
            return;
        try {
            await client.joinRoom(code, this.nickname());
            this.showLobby(client.code, false);
        }
        catch (err) {
            this.setStatus(String(err));
        }
    }
    async connect() {
        const netMod = (0, net_bridge_1.net)();
        if (!netMod || !(0, net_bridge_1.isNetAvailable)()) {
            this.setStatus('Online play needs the web build (see docs).');
            return null;
        }
        if (this.room)
            return this.room;
        const config = await netMod.loadNetConfig('');
        if (!config) {
            this.setStatus('Missing /config.json: Supabase is not configured.');
            return null;
        }
        this.room = new netMod.RoomClient(config, {
            onLobbyChange: (members) => this.refreshLobby(members),
            onMessage: (msg) => this.handleMessage(msg),
        });
        return this.room;
    }
    startOnlineMatch() {
        const room = this.room;
        const netMod = (0, net_bridge_1.net)();
        if (!room || !room.isHost || !netMod)
            return;
        const humans = this.members;
        const roster = humans.map((m) => ({
            kind: 'human',
            name: m.nickname,
            clientId: m.clientId,
        }));
        const botNames = ['Bot Nils', 'Bot Astrid', 'Bot Erik', 'Bot Greta', 'Bot Sven'];
        while (roster.length < Math.min(constants_1.MAX_SLOTS, Math.max(TARGET_COMBATANTS, roster.length + 1))) {
            roster.push({ kind: 'bot', name: botNames[roster.length - humans.length], clientId: null });
        }
        const start = {
            type: 'start',
            version: netMod.PROTOCOL_VERSION,
            mapId: this.selectedMapId(),
            seed: this.newSeed(),
            roster,
        };
        void room.markStarted();
        void room.send(start);
        this.launchFromStart(start);
    }
    handleMessage(msg) {
        switch (msg.type) {
            case 'start':
                if (!this.room?.isHost)
                    this.launchFromStart(msg);
                break;
            case 'input':
                this.view?.setRemoteInput(msg.slot, msg.input);
                break;
            case 'snapshot':
                this.view?.applySnapshot(msg.state);
                break;
            case 'game_over':
                break;
        }
    }
    launchFromStart(msg) {
        const room = this.room;
        const roster = msg.roster.map((r) => ({
            kind: r.kind,
            name: r.name,
        }));
        const localSlot = msg.roster.findIndex((r) => r.clientId === room.clientId);
        const mode = room.isHost ? 'host' : 'guest';
        this.beginMatch(msg.mapId, roster, msg.seed, mode, Math.max(0, localSlot));
    }
    refreshLobby(members) {
        this.members = members;
        const names = members
            .map((m) => `${m.nickname}${m.isHost ? ' (host)' : ''}`)
            .join('\n');
        this.node('Lobby/PlayersLabel').text =
            `Players (${members.length}/${constants_1.MAX_HUMANS}):\n${names}`;
    }
    async leaveRoom() {
        await this.room?.leave();
        this.room = null;
        this.members = [];
        this.showMenu();
    }
    // --------------------------------------------------------------- match
    beginMatch(mapId, roster, seed, mode, localSlot) {
        const def = (0, maps_1.loadMapDef)(mapId);
        this.currentMapId = mapId;
        const view = new match_view_1.default();
        view.startMatch(def, roster, seed, mode, localSlot);
        view.onFinished = (winner, state) => this.onMatchFinished(winner, state);
        view.onSkip = () => {
            this.afterMatch = this.campaign ? 'campaign-retry' : 'menu';
            this.endMatch();
        };
        if (mode === 'host') {
            view.onSnapshot = (state) => {
                void this.room?.send({ type: 'snapshot', state });
            };
        }
        if (mode === 'guest') {
            view.onLocalInput = (input) => {
                void this.room?.send({ type: 'input', slot: localSlot, input });
            };
        }
        this.view = view;
        this.node('MatchContainer').add_child(view);
        this.node('Menu').visible = false;
        this.node('MenuPanel').visible = false;
        this.node('Lobby').visible = false;
        this.node('LobbyPanel').visible = false;
        this.node('Rankings').visible = false;
        this.node('RankingsPanel').visible = false;
        this.node('Credits').visible = false;
        this.node('CreditsPanel').visible = false;
        this.node('Quit').visible = false;
        this.node('QuitPanel').visible = false;
        this.node('MenuBackground').visible = false;
        this.node('HudLabel').text =
            `${def.name} — ${def.district}. Arrows/WASD to move, Space to bomb.`;
        this.node('HudLabel').visible = true;
        audio_1.AudioBank.playMusic('battle');
        audio_1.AudioBank.playSfx('start');
    }
    onMatchFinished(winner, state) {
        if (this.room?.isHost) {
            void this.room.send({ type: 'game_over', winner });
        }
        const scoreboard = [...state.players]
            .sort((a, b) => b.score - a.score)
            .map((p) => `${p.name} ${p.score}`)
            .join('  ·  ');
        const headline = winner === null ? 'Draw!' : `${state.players[winner].name} wins!`;
        // Persistence and campaign bookkeeping are best-effort: any failure in
        // here must never keep the end screen (and the return to menu) from
        // happening — that soft-locked finished matches once.
        this.afterMatch = 'menu';
        let epilogue = '';
        try {
            const mapId = this.currentMapId ?? this.mapIds[0];
            (0, persist_1.recordResults)(state.players.map((p) => ({
                name: p.name,
                mapId,
                score: p.score,
                won: p.id === winner,
            })));
            if (this.campaign) {
                const localWon = winner === 0;
                if (localWon && this.campaignMapId) {
                    if (!this.progress.completed.includes(this.campaignMapId)) {
                        this.progress.completed.push(this.campaignMapId);
                    }
                    this.progress.totalScore += state.players[0].score;
                    (0, persist_1.saveCampaign)(this.progress);
                    const remaining = this.mapIds.length - this.progress.completed.length;
                    if (remaining > 0) {
                        this.afterMatch = 'campaign-next';
                        epilogue = ` Next stop: ${(0, maps_1.loadMapDef)(this.nextCampaignMap()).name}…`;
                    }
                    else {
                        epilogue = ` CAMPAIGN COMPLETE — ${this.progress.totalScore} pts!`;
                    }
                }
                else {
                    this.afterMatch = 'campaign-retry';
                    epilogue = ' Try this map again…';
                }
            }
        }
        catch {
            /* keep going — the end screen must always show */
        }
        this.node('HudLabel').text = `${headline}  ${scoreboard}.${epilogue}`;
        audio_1.AudioBank.playMusic(winner === null ? 'draw' : 'victory');
        if (winner !== null)
            audio_1.AudioBank.playSfx('winner');
        this.get_tree()
            .create_timer(4.0)
            .timeout.connect(godot_1.Callable.create(this, () => this.endMatch()));
    }
    endMatch() {
        if (this.view) {
            this.view.queue_free();
            this.view = null;
        }
        if (this.room) {
            void this.leaveRoom();
            return;
        }
        if (this.afterMatch === 'campaign-next' || this.afterMatch === 'campaign-retry') {
            const mapId = this.afterMatch === 'campaign-next'
                ? this.nextCampaignMap()
                : this.campaignMapId;
            if (mapId) {
                this.campaignMapId = mapId;
                this.beginMatch(mapId, this.soloRoster(), this.newSeed(), 'solo', 0);
                return;
            }
        }
        this.campaign = false;
        this.showMenu();
    }
    // ------------------------------------------------------------------ ui
    showMenu() {
        this.node('Menu').visible = true;
        this.node('MenuPanel').visible = true;
        this.node('Lobby').visible = false;
        this.node('LobbyPanel').visible = false;
        this.node('Rankings').visible = false;
        this.node('RankingsPanel').visible = false;
        this.node('Credits').visible = false;
        this.node('CreditsPanel').visible = false;
        this.node('Quit').visible = false;
        this.node('QuitPanel').visible = false;
        this.node('MenuBackground').visible = true;
        this.node('HudLabel').visible = false;
        this.setStatus('');
        const done = this.progress.completed.length;
        this.node('Menu/CampaignButton').text =
            done >= this.mapIds.length
                ? `Campaign complete! (${this.progress.totalScore} pts) — restart`
                : `Campaign  ${done}/${this.mapIds.length}`;
        // Keyboard-first: Enter starts a solo match right away.
        this.node('Menu/PlaySolo').grab_focus();
        audio_1.AudioBank.playMusic('title');
    }
    showCredits() {
        this.node('Menu').visible = false;
        this.node('MenuPanel').visible = false;
        this.node('Credits').visible = true;
        this.node('CreditsPanel').visible = true;
        this.node('Credits/CreditsBack').grab_focus();
    }
    showRankings() {
        this.node('Menu').visible = false;
        this.node('MenuPanel').visible = false;
        this.node('Rankings').visible = true;
        this.node('RankingsPanel').visible = true;
        const entries = (0, persist_1.loadRankings)();
        const overall = (0, persist_1.overallRanking)(entries).slice(0, 8);
        this.node('Rankings/OverallLabel').text =
            overall.length === 0
                ? 'No matches recorded yet.'
                : overall
                    .map((row, i) => `${i + 1}. ${row.name} — ${row.total} pts (${row.wins} wins)`)
                    .join('\n');
        this.node('Rankings/PerMapLabel').text = this.mapIds
            .map((id) => {
            const best = (0, persist_1.bestForMap)(entries, id);
            const name = (0, maps_1.loadMapDef)(id).name;
            return best ? `${name}: ${best.name} — ${best.score}` : `${name}: —`;
        })
            .join('\n');
    }
    showLobby(code, isHost) {
        this.node('Menu').visible = false;
        this.node('MenuPanel').visible = false;
        this.node('Lobby').visible = true;
        this.node('LobbyPanel').visible = true;
        audio_1.AudioBank.playMusic('lobby');
        this.node('Lobby/CodeLabel').text = `Room code: ${code}`;
        this.node('Lobby/InviteLabel').text =
            `Invite link: ${this.origin()}/game/?room=${code}`;
        this.node('Lobby/StartButton').visible = isHost;
        this.node('Lobby/LobbyStatus').text = isHost
            ? 'Share the link, then press Start. Bots fill empty slots.'
            : 'Waiting for the host to start…';
    }
    setStatus(text) {
        this.node('Menu/Status').text = text;
    }
    node(path) {
        return this.get_node(path);
    }
    /** GodotJS signals reject bare JS functions; they must be wrapped in a
     * Callable bound to a Godot object. */
    onPressed(path, fn) {
        this.node(path).pressed.connect(godot_1.Callable.create(this, () => {
            audio_1.AudioBank.playSfx('menu_accept');
            fn();
        }));
    }
    nickname() {
        const raw = this.node('Menu/NicknameEdit').text.trim();
        return raw.length > 0 ? raw.slice(0, 16) : 'Player';
    }
    selectedMapId() {
        const idx = this.node('Menu/MapOption').selected;
        return this.mapIds[Math.max(0, idx)];
    }
    newSeed() {
        return (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
    }
    origin() {
        const loc = globalThis.location;
        return loc?.origin ?? 'http://localhost:8080';
    }
    roomCodeFromLocation() {
        const loc = globalThis.location;
        return (loc?.href && (0, net_bridge_1.net)()?.roomCodeFromUrl(loc.href)) || null;
    }
}
exports.default = Main;
