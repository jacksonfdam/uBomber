import { Button, Callable, Control, Label, LineEdit, OptionButton } from 'godot';
import { MAX_SLOTS } from '../core/constants';
import type { GameState, PlayerInput, RosterEntry } from '../core/types';
import type { LobbyMember, RoomClient } from '../net/room';
import type { RoomMsg, StartMsg } from '../net/protocol';
import { loadMapDef, loadMapIds } from './maps';
import MatchView from './match_view';
import { isNetAvailable, net } from './net_bridge';

/** Total combatants when humans alone don't fill the arena. */
const TARGET_COMBATANTS = 4;

/**
 * Root scene controller: main menu, online lobby, and match lifecycle.
 * Attached to res://scenes/main.tscn.
 */
export default class Main extends Control {
  private room: RoomClient | null = null;
  private view: MatchView | null = null;
  private members: LobbyMember[] = [];
  private mapIds: string[] = [];

  _ready(): void {
    this.mapIds = loadMapIds();
    const mapOption = this.node<OptionButton>('Menu/MapOption');
    for (const id of this.mapIds) {
      mapOption.add_item(loadMapDef(id).name);
    }
    mapOption.select(0);

    this.onPressed('Menu/PlaySolo', () => this.startSolo());
    this.onPressed('Menu/CreateRoom', () => void this.createRoom());
    this.onPressed('Menu/JoinRoom', () => void this.joinRoom());
    this.onPressed('Lobby/StartButton', () => this.startOnlineMatch());
    this.onPressed('Lobby/LeaveButton', () => void this.leaveRoom());

    // Invite links (/game/?room=CODE) drop straight into the join flow.
    const invited = this.roomCodeFromLocation();
    if (invited) {
      this.node<LineEdit>('Menu/RoomCodeEdit').text = invited;
      this.setStatus(`Invite detected: press "Join room" to enter ${invited}`);
    }

    this.showMenu();
  }

  // ---------------------------------------------------------------- solo

  private startSolo(): void {
    const def = loadMapDef(this.selectedMapId());
    const roster: RosterEntry[] = [
      { kind: 'human', name: this.nickname() },
      { kind: 'bot', name: 'Bot Nils' },
      { kind: 'bot', name: 'Bot Astrid' },
      { kind: 'bot', name: 'Bot Erik' },
    ];
    this.beginMatch(def.id, roster, this.newSeed(), 'solo', 0);
  }

  // -------------------------------------------------------------- online

  private async createRoom(): Promise<void> {
    const client = await this.connect();
    if (!client) return;
    try {
      const code = await client.createRoom(this.selectedMapId(), this.nickname());
      this.showLobby(code, true);
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  private async joinRoom(): Promise<void> {
    const code = this.node<LineEdit>('Menu/RoomCodeEdit').text.trim();
    if (!code) {
      this.setStatus('Enter a room code first.');
      return;
    }
    const client = await this.connect();
    if (!client) return;
    try {
      await client.joinRoom(code, this.nickname());
      this.showLobby(client.code, false);
    } catch (err) {
      this.setStatus(String(err));
    }
  }

  private async connect(): Promise<RoomClient | null> {
    const netMod = net();
    if (!netMod || !isNetAvailable()) {
      this.setStatus('Online play needs the web build (see docs).');
      return null;
    }
    if (this.room) return this.room;

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

  private startOnlineMatch(): void {
    const room = this.room;
    const netMod = net();
    if (!room || !room.isHost || !netMod) return;

    const humans = this.members;
    const roster: StartMsg['roster'] = humans.map((m) => ({
      kind: 'human',
      name: m.nickname,
      clientId: m.clientId,
    }));
    const botNames = ['Bot Nils', 'Bot Astrid', 'Bot Erik', 'Bot Greta', 'Bot Sven'];
    while (
      roster.length < Math.min(MAX_SLOTS, Math.max(TARGET_COMBATANTS, roster.length + 1))
    ) {
      roster.push({ kind: 'bot', name: botNames[roster.length - humans.length], clientId: null });
    }

    const start: StartMsg = {
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

  private handleMessage(msg: RoomMsg): void {
    switch (msg.type) {
      case 'start':
        if (!this.room?.isHost) this.launchFromStart(msg);
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

  private launchFromStart(msg: StartMsg): void {
    const room = this.room!;
    const roster: RosterEntry[] = msg.roster.map((r) => ({
      kind: r.kind,
      name: r.name,
    }));
    const localSlot = msg.roster.findIndex(
      (r) => r.clientId === room.clientId
    );
    const mode = room.isHost ? 'host' : 'guest';
    this.beginMatch(msg.mapId, roster, msg.seed, mode, Math.max(0, localSlot));
  }

  private refreshLobby(members: LobbyMember[]): void {
    this.members = members;
    const names = members
      .map((m) => `${m.nickname}${m.isHost ? ' (host)' : ''}`)
      .join('\n');
    this.node<Label>('Lobby/PlayersLabel').text =
      `Players (${members.length}/5):\n${names}`;
  }

  private async leaveRoom(): Promise<void> {
    await this.room?.leave();
    this.room = null;
    this.members = [];
    this.showMenu();
  }

  // --------------------------------------------------------------- match

  private beginMatch(
    mapId: string,
    roster: RosterEntry[],
    seed: number,
    mode: 'solo' | 'host' | 'guest',
    localSlot: number
  ): void {
    const def = loadMapDef(mapId);
    const view = new MatchView();
    view.startMatch(def, roster, seed, mode, localSlot);
    view.onFinished = (winner, state) => this.onMatchFinished(winner, state);
    if (mode === 'host') {
      view.onSnapshot = (state) => {
        void this.room?.send({ type: 'snapshot', state });
      };
    }
    if (mode === 'guest') {
      view.onLocalInput = (input: PlayerInput) => {
        void this.room?.send({ type: 'input', slot: localSlot, input });
      };
    }

    this.view = view;
    this.node('MatchContainer').add_child(view);
    this.node<Control>('Menu').visible = false;
    this.node<Control>('Lobby').visible = false;
    this.node<Label>('HudLabel').text =
      `${def.name} — ${def.district}. Arrows/WASD to move, Space to bomb.`;
    this.node<Label>('HudLabel').visible = true;
  }

  private onMatchFinished(winner: number | null, state: GameState): void {
    if (this.room?.isHost) {
      void this.room.send({ type: 'game_over', winner });
    }
    const label = this.node<Label>('HudLabel');
    label.text =
      winner === null
        ? 'Draw! Returning to menu…'
        : `${state.players[winner].name} wins! Returning to menu…`;
    this.get_tree()
      .create_timer(4.0)
      .timeout.connect(Callable.create(this, () => this.endMatch()));
  }

  private endMatch(): void {
    if (this.view) {
      this.view.queue_free();
      this.view = null;
    }
    if (this.room) {
      void this.leaveRoom();
    } else {
      this.showMenu();
    }
  }

  // ------------------------------------------------------------------ ui

  private showMenu(): void {
    this.node<Control>('Menu').visible = true;
    this.node<Control>('Lobby').visible = false;
    this.node<Label>('HudLabel').visible = false;
    this.setStatus('');
    // Keyboard-first: Enter starts a solo match right away.
    this.node<Button>('Menu/PlaySolo').grab_focus();
  }

  private showLobby(code: string, isHost: boolean): void {
    this.node<Control>('Menu').visible = false;
    this.node<Control>('Lobby').visible = true;
    this.node<Label>('Lobby/CodeLabel').text = `Room code: ${code}`;
    this.node<Label>('Lobby/InviteLabel').text =
      `Invite link: ${this.origin()}/game/?room=${code}`;
    this.node<Button>('Lobby/StartButton').visible = isHost;
    this.node<Label>('Lobby/LobbyStatus').text = isHost
      ? 'Share the link, then press Start. Bots fill empty slots.'
      : 'Waiting for the host to start…';
  }

  private setStatus(text: string): void {
    this.node<Label>('Menu/Status').text = text;
  }

  private node<T = any>(path: string): T {
    return this.get_node(path) as T;
  }

  /** GodotJS signals reject bare JS functions; they must be wrapped in a
   * Callable bound to a Godot object. */
  private onPressed(path: string, fn: () => void): void {
    this.node<Button>(path).pressed.connect(Callable.create(this, fn));
  }

  private nickname(): string {
    const raw = this.node<LineEdit>('Menu/NicknameEdit').text.trim();
    return raw.length > 0 ? raw.slice(0, 16) : 'Player';
  }

  private selectedMapId(): string {
    const idx = this.node<OptionButton>('Menu/MapOption').selected;
    return this.mapIds[Math.max(0, idx)];
  }

  private newSeed(): number {
    return (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
  }

  private origin(): string {
    const loc = (globalThis as { location?: { origin?: string } }).location;
    return loc?.origin ?? 'http://localhost:8080';
  }

  private roomCodeFromLocation(): string | null {
    const loc = (globalThis as { location?: { href?: string } }).location;
    return (loc?.href && net()?.roomCodeFromUrl(loc.href)) || null;
  }
}
