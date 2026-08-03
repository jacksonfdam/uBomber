/**
 * The cabinet: attract mode, menu, options, lobby, rankings, credits, and the
 * match lifecycle.
 *
 * Menu screens share one persistent "cabinet" layer — a live attract-mode match
 * with a CRT overlay on top — so moving between the menu and its sub-screens
 * never restarts the demo. Only starting a real match tears it down.
 *
 * The Supabase client is loaded on demand: a solo player never downloads the
 * networking code at all, which is most of the JavaScript weight.
 */

import type { AudioEngine } from './audio/audio';
import { MAX_HUMANS, MAX_SLOTS, SOLO_LIVES } from './core/constants';
import type { GameState, PlayerInput, RosterEntry } from './core/types';
import { MAPS, mapById, mapOrFirst, MAP_IDS } from './maps';
import { Match, type MatchMode } from './match';
import type { LobbyMember, RoomClient } from './net/room';
import type { RoomMsg, StartMsg } from './net/protocol';
import {
  bestForMap,
  type CampaignProgress,
  loadCampaign,
  loadNickname,
  loadQuality,
  loadRankings,
  overallRanking,
  recordResults,
  resetCampaign,
  saveCampaign,
  saveNickname,
  saveQuality,
} from './persist';
import type { PostSettings } from './render/post';
import { AttractMode } from './ui/attract';
import { Hud, showOverlay } from './ui/hud';
import { mountLogo } from './ui/logo';
import { ArcadeMenu, type MenuRow } from './ui/menu';
import { arcadeCase } from './ui/text';

/** Total combatants when humans alone do not fill the arena. */
const TARGET_COMBATANTS = 4;

const BOT_NAMES = ['Nils', 'Astrid', 'Erik', 'Greta', 'Sven'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.addEventListener('click', onClick);
  return node;
}

export class App {
  private root: HTMLElement;
  private audio: AudioEngine;

  // --- cabinet (menu screens)
  private cabinet: HTMLElement | null = null;
  private arcade: HTMLElement | null = null;
  private attract: AttractMode | null = null;
  private disposeLogo: (() => void) | null = null;
  private menu: ArcadeMenu | null = null;

  // --- match
  private match: Match | null = null;
  private stage: HTMLElement | null = null;
  private closeOverlay: (() => void) | null = null;
  private resultTimer: number | null = null;

  private room: RoomClient | null = null;
  private members: LobbyMember[] = [];
  private lobbyList: { heading: HTMLElement; list: HTMLElement } | null = null;

  private nickname = loadNickname();
  private roomCode = '';
  private mapIndex = 0;
  private quality: PostSettings = loadQuality();

  private campaign = false;
  private campaignMapId: string | null = null;
  private progress: CampaignProgress = loadCampaign();
  private afterMatch: 'menu' | 'campaign-next' | 'campaign-retry' = 'menu';
  private currentMapId: string | null = null;

  private status = '';

  constructor(root: HTMLElement, audio: AudioEngine) {
    this.root = root;
    this.audio = audio;
    window.addEventListener('keydown', this.onGlobalKey);

    const invited = this.inviteCodeFromLocation();
    if (invited) {
      this.roomCode = invited;
      this.status = `INVITE ${invited} DETECTED — SELECT JOIN ROOM`;
    }
    this.showMenu();
  }

  // ------------------------------------------------------------- navigation

  /** Esc backs out of sub-screens; in a match it asks first. */
  private onGlobalKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    if (this.closeOverlay) return; // The open dialog owns Escape.
    if (this.match) {
      event.preventDefault();
      this.openQuitConfirm();
      return;
    }
    if (this.room) {
      void this.leaveRoom();
      return;
    }
    if (this.arcade?.dataset.screen && this.arcade.dataset.screen !== 'menu') {
      this.audio.play('menu-back');
      this.showMenu();
    }
  };

  // ---------------------------------------------------------------- cabinet

  /** Creates the attract layer once, then reuses it across menu screens. */
  private ensureCabinet(): HTMLElement {
    if (this.cabinet && this.arcade) return this.arcade;

    this.teardownMatch();
    this.root.replaceChildren();

    const cabinet = el('div');
    cabinet.style.cssText = 'position:absolute;inset:0';

    const attractLayer = el('div', 'attract');
    const canvas = el('canvas');
    attractLayer.appendChild(canvas);
    cabinet.appendChild(attractLayer);
    cabinet.appendChild(el('div', 'crt'));

    const arcade = el('div', 'arcade');
    cabinet.appendChild(arcade);

    this.root.appendChild(cabinet);
    this.cabinet = cabinet;
    this.arcade = arcade;
    this.attract = new AttractMode(canvas);
    return arcade;
  }

  private teardownCabinet(): void {
    this.menu?.destroy();
    this.menu = null;
    this.disposeLogo?.();
    this.disposeLogo = null;
    this.attract?.dispose();
    this.attract = null;
    this.cabinet?.remove();
    this.cabinet = null;
    this.arcade = null;
  }

  private teardownMatch(): void {
    this.closeOverlay?.();
    this.closeOverlay = null;
    if (this.resultTimer !== null) {
      window.clearTimeout(this.resultTimer);
      this.resultTimer = null;
    }
    this.match?.dispose();
    this.match = null;
    this.stage?.remove();
    this.stage = null;
  }

  /** Clears the current menu screen, keeping the attract match running. */
  private openScreen(name: string): HTMLElement {
    const arcade = this.ensureCabinet();
    this.menu?.destroy();
    this.menu = null;
    this.disposeLogo?.();
    this.disposeLogo = null;
    arcade.replaceChildren();
    arcade.dataset.screen = name;
    arcade.scrollTop = 0;
    return arcade;
  }

  // ------------------------------------------------------------------ menu

  private showMenu(): void {
    const arcade = this.openScreen('menu');
    this.audio.setMood('title');

    const marquee = el('div', 'marquee');
    arcade.appendChild(marquee);
    this.disposeLogo = mountLogo(marquee);

    arcade.appendChild(el('div', 'tagline', 'TEN ARENAS · ONE STOCKHOLM'));

    const plate = el('div', 'arena-plate');
    plate.innerHTML = `NOW SHOWING <b>${arcadeCase(this.attract?.arenaName ?? '')}</b>`;
    arcade.appendChild(plate);

    const done = this.progress.completed.length;
    const rows: MenuRow[] = [
      { label: 'PLAY SOLO', onActivate: () => this.startSolo() },
      {
        label: 'CAMPAIGN',
        value: () =>
          this.progress.completed.length >= MAP_IDS.length
            ? 'CLEARED'
            : `${this.progress.completed.length}/${MAP_IDS.length}`,
        onActivate: () => this.startCampaign(),
      },
      {
        label: 'ARENA',
        value: () => `◀ ${arcadeCase(MAPS[this.mapIndex].def.name)} ▶`,
        onAdjust: (dir) => {
          this.mapIndex = (this.mapIndex + dir + MAPS.length) % MAPS.length;
        },
        onActivate: () => this.startSolo(),
      },
      {
        label: 'PLAYER',
        input: {
          placeholder: 'PLAYER',
          maxLength: 12,
          initial: this.nickname,
          onChange: (value) => {
            this.nickname = value.trim();
            saveNickname(this.nickname);
          },
        },
      },
      { rule: true },
      { label: 'CREATE ROOM', onActivate: () => void this.createRoom() },
      {
        label: 'JOIN ROOM',
        input: {
          placeholder: 'CODE',
          maxLength: 6,
          initial: this.roomCode,
          uppercase: true,
          onChange: (value) => {
            this.roomCode = value.trim();
          },
        },
        onActivate: () => void this.joinRoom(this.roomCode),
      },
      { rule: true },
      { label: 'RANKINGS', onActivate: () => this.showRankings() },
      { label: 'OPTIONS', onActivate: () => this.showOptions() },
      { label: 'CREDITS', onActivate: () => this.showCredits() },
    ];

    this.menu = new ArcadeMenu(arcade, rows, {
      onMove: () => this.audio.play('menu-move'),
      onSelect: () => this.audio.play('menu-accept'),
    });

    const statusLine = el('div', 'status', this.status);
    arcade.appendChild(statusLine);

    arcade.appendChild(el('div', 'insert', done > 0 ? 'CONTINUE YOUR RUN' : 'INSERT COIN'));
    const hint = el('div', 'hint');
    hint.innerHTML =
      '<b>↑↓</b> SELECT &nbsp;·&nbsp; <b>←→</b> CHANGE &nbsp;·&nbsp; <b>SPACE</b> START<br />' +
      'IN GAME: <b>ARROWS/WASD</b> MOVE &nbsp;·&nbsp; <b>SPACE</b> BOMB &nbsp;·&nbsp; <b>P</b> PAUSE';
    arcade.appendChild(hint);

    // The plate follows the attract match as arenas rotate. It stops on its own
    // once the element leaves the document, so screen changes cannot pile up
    // duplicate loops.
    const followArena = (): void => {
      if (!plate.isConnected || !this.attract) return;
      const name = arcadeCase(this.attract.arenaName);
      const next = `NOW SHOWING <b>${name}</b>`;
      if (plate.innerHTML !== next) plate.innerHTML = next;
      requestAnimationFrame(followArena);
    };
    requestAnimationFrame(followArena);
  }

  // --------------------------------------------------------------- options

  private showOptions(): void {
    const arcade = this.openScreen('options');
    arcade.appendChild(el('h1', 'screen-title', 'OPTIONS'));

    /** An 8-bit level readout: ASCII only, so the pixel font always has it. */
    const bar = (level: number): string => {
      const filled = Math.round(level * 10);
      return `[${'#'.repeat(filled)}${'.'.repeat(10 - filled)}] ${filled * 10}%`;
    };

    const volumeRow = (
      label: string,
      key: 'sfx' | 'ambient' | 'music'
    ): MenuRow => ({
      label,
      value: () => bar(this.audio.volumes[key]),
      onAdjust: (dir) => {
        const next = Math.max(0, Math.min(1, Math.round(this.audio.volumes[key] * 10 + dir) / 10));
        this.audio.setVolumes({ ...this.audio.volumes, [key]: next });
      },
    });

    const toggleRow = (label: string, key: keyof PostSettings): MenuRow => {
      const flip = (): void => {
        this.quality = { ...this.quality, [key]: !this.quality[key] };
        saveQuality(this.quality);
        this.match?.applyPost(this.quality);
      };
      return {
        label,
        value: () => (this.quality[key] ? 'ON' : 'OFF'),
        onAdjust: flip,
        onActivate: flip,
      };
    };

    const rows: MenuRow[] = [
      volumeRow('EFFECTS', 'sfx'),
      volumeRow('AMBIENCE', 'ambient'),
      volumeRow('MUSIC', 'music'),
      { rule: true },
      toggleRow('POST FX', 'enabled'),
      toggleRow('BLOOM', 'bloom'),
      toggleRow('FILM GRAIN', 'grain'),
      toggleRow('ABERRATION', 'aberration'),
      { rule: true },
      {
        label: 'BACK',
        onActivate: () => {
          this.audio.play('menu-back');
          this.showMenu();
        },
      },
    ];

    this.menu = new ArcadeMenu(arcade, rows, {
      onMove: () => this.audio.play('menu-move'),
      onSelect: () => this.audio.play('menu-accept'),
    });

    arcade.appendChild(
      el(
        'div',
        'hint',
        'TURN POST FX OFF IF THE FRAME RATE DIPS — THE ARENA STILL DRAWS IN A HANDFUL OF CALLS'
      )
    );
  }

  // -------------------------------------------------------------- rankings

  private showRankings(): void {
    const arcade = this.openScreen('rankings');
    arcade.appendChild(el('h1', 'screen-title', 'HIGH SCORES'));

    const entries = loadRankings();
    const overall = overallRanking(entries).slice(0, 8);

    const overallPanel = el('div', 'panel');
    overallPanel.appendChild(el('h2', undefined, 'OVERALL'));
    if (overall.length === 0) {
      overallPanel.appendChild(el('div', 'list is-empty', 'NO MATCHES RECORDED YET'));
    } else {
      overall.forEach((entry, i) => {
        const rowEl = el('div', 'rank-row');
        rowEl.appendChild(el('span', 'pos', String(i + 1).padStart(2, '0')));
        rowEl.appendChild(el('span', undefined, arcadeCase(entry.name)));
        rowEl.appendChild(el('span', 'pts', `${entry.total} PTS · ${entry.wins}W`));
        overallPanel.appendChild(rowEl);
      });
    }
    arcade.appendChild(overallPanel);

    const perMap = el('div', 'panel');
    perMap.appendChild(el('h2', undefined, 'BEST PER ARENA'));
    for (const entry of MAPS) {
      const best = bestForMap(entries, entry.def.id);
      const rowEl = el('div', 'rank-row');
      rowEl.appendChild(el('span', 'pos', ''));
      rowEl.appendChild(el('span', undefined, arcadeCase(entry.def.name)));
      rowEl.appendChild(
        el('span', 'pts', best ? `${arcadeCase(best.name)} · ${best.score}` : '—')
      );
      perMap.appendChild(rowEl);
    }
    arcade.appendChild(perMap);

    const back = el('div', 'row');
    back.appendChild(
      button('BACK', 'primary', () => {
        this.audio.play('menu-back');
        this.showMenu();
      })
    );
    arcade.appendChild(back);
  }

  private showCredits(): void {
    const arcade = this.openScreen('credits');
    arcade.appendChild(el('h1', 'screen-title', 'CREDITS'));

    const panel = el('div', 'panel');
    const prose = el('div', 'prose');
    prose.innerHTML = `
      <p><strong>Concept &amp; direction:</strong> Jackson Mafra.</p>
      <p><strong>Art:</strong> every tileset, block, bomb, blast and character in
      this game is generated by code in this repository. There are no image
      assets.</p>
      <p><strong>Audio:</strong> every sound effect, ambient bed and music track
      is synthesized at runtime with the Web Audio API. There are no recordings
      and no sample libraries.</p>
      <p><strong>Technology:</strong> Three.js (MIT), Vite (MIT), TypeScript
      (Apache-2.0), Vitest (MIT), Supabase Realtime for multiplayer.</p>
      <p><strong>Typography:</strong> Press Start 2P and Inter (SIL OFL 1.1).</p>
      <p><strong>Setting:</strong> the ten arenas are affectionate
      interpretations of real places in Stockholm. No affiliation with or
      endorsement by any depicted location or operator is implied.</p>
      <p>uBomber belongs to the maze-bomber genre pioneered in the 1980s. It is
      an original work: all names, characters, art, audio and arena layouts were
      created for this project, and it is not affiliated with or endorsed by any
      other game or rights holder.</p>
    `;
    panel.appendChild(prose);
    arcade.appendChild(panel);

    const back = el('div', 'row');
    back.appendChild(
      button('BACK', 'primary', () => {
        this.audio.play('menu-back');
        this.showMenu();
      })
    );
    arcade.appendChild(back);
  }

  // ------------------------------------------------------------------ solo

  private get selectedMapId(): string {
    return MAPS[this.mapIndex].def.id;
  }

  private soloRoster(): RosterEntry[] {
    // Solo and campaign humans get spare lives; bots always have one.
    return [
      { kind: 'human', name: this.playerName(), lives: SOLO_LIVES },
      { kind: 'bot', name: 'Nils' },
      { kind: 'bot', name: 'Astrid' },
      { kind: 'bot', name: 'Erik' },
    ];
  }

  private playerName(): string {
    return this.nickname.length > 0 ? this.nickname.slice(0, 16) : 'Player';
  }

  private startSolo(): void {
    this.campaign = false;
    this.beginMatch(this.selectedMapId, this.soloRoster(), this.newSeed(), 'solo', 0);
  }

  private startCampaign(): void {
    if (this.progress.completed.length >= MAP_IDS.length) {
      this.progress = resetCampaign();
    }
    const next = this.nextCampaignMap();
    if (!next) return;
    this.campaign = true;
    this.campaignMapId = next;
    this.beginMatch(next, this.soloRoster(), this.newSeed(), 'solo', 0);
  }

  private nextCampaignMap(): string | null {
    return MAP_IDS.find((id) => !this.progress.completed.includes(id)) ?? null;
  }

  // ---------------------------------------------------------------- online

  private async connect(): Promise<RoomClient | null> {
    if (this.room) return this.room;
    try {
      const [{ RoomClient: Client }, { loadNetConfig }] = await Promise.all([
        import('./net/room'),
        import('./net/config'),
      ]);
      const config = await loadNetConfig('');
      if (!config) {
        this.setStatus('NO /CONFIG.JSON — SUPABASE IS NOT CONFIGURED HERE');
        return null;
      }
      this.room = new Client(config, {
        onLobbyChange: (members) => this.refreshLobby(members),
        onMessage: (msg) => this.handleMessage(msg),
      });
      return this.room;
    } catch (error) {
      this.setStatus(`ONLINE PLAY FAILED: ${arcadeCase(String(error))}`);
      return null;
    }
  }

  private async createRoom(): Promise<void> {
    const client = await this.connect();
    if (!client) return;
    try {
      const code = await client.createRoom(this.selectedMapId, this.playerName());
      this.showLobby(code, true);
    } catch (error) {
      this.setStatus(arcadeCase(String(error)));
    }
  }

  private async joinRoom(code: string): Promise<void> {
    if (!code) {
      this.setStatus('ENTER A ROOM CODE FIRST');
      return;
    }
    const client = await this.connect();
    if (!client) return;
    try {
      await client.joinRoom(code, this.playerName());
      this.showLobby(client.code, false);
    } catch (error) {
      this.setStatus(arcadeCase(String(error)));
    }
  }

  private showLobby(code: string, isHost: boolean): void {
    const arcade = this.openScreen('lobby');
    this.audio.setMood('lobby');

    arcade.appendChild(el('h1', 'screen-title', 'LOBBY'));

    const panel = el('div', 'panel');
    panel.appendChild(el('h2', undefined, 'ROOM CODE'));
    const codePlate = el('div', 'screen-title', code);
    codePlate.style.textAlign = 'center';
    panel.appendChild(codePlate);
    panel.appendChild(
      el('div', 'hint', arcadeCase(`${window.location.origin}/?room=${code}`))
    );
    panel.appendChild(
      el(
        'div',
        'hint',
        isHost
          ? 'SHARE THE LINK, THEN START. BOTS FILL EMPTY SLOTS.'
          : 'WAITING FOR THE HOST TO START…'
      )
    );
    arcade.appendChild(panel);

    const playersPanel = el('div', 'panel');
    const heading = el('h2', undefined, `PLAYERS 0/${MAX_HUMANS}`);
    playersPanel.appendChild(heading);
    const list = el('div', 'list is-empty', 'CONNECTING…');
    playersPanel.appendChild(list);
    arcade.appendChild(playersPanel);
    this.lobbyList = { heading, list };

    const controls = el('div', 'row');
    if (isHost) {
      controls.appendChild(
        button('START MATCH', 'primary', () => {
          this.audio.play('menu-accept');
          this.startOnlineMatch();
        })
      );
    }
    controls.appendChild(
      button('LEAVE', '', () => {
        this.audio.play('menu-back');
        void this.leaveRoom();
      })
    );
    arcade.appendChild(controls);

    this.refreshLobby(this.members);
  }

  private refreshLobby(members: LobbyMember[]): void {
    this.members = members;
    if (!this.lobbyList) return;
    this.lobbyList.heading.textContent = `PLAYERS ${members.length}/${MAX_HUMANS}`;
    if (members.length === 0) {
      this.lobbyList.list.className = 'list is-empty';
      this.lobbyList.list.textContent = 'CONNECTING…';
      return;
    }
    this.lobbyList.list.className = 'list';
    this.lobbyList.list.textContent = members
      .map((m) => `${arcadeCase(m.nickname)}${m.isHost ? '  (HOST)' : ''}`)
      .join('\n');
  }

  private startOnlineMatch(): void {
    const room = this.room;
    if (!room || !room.isHost) return;

    const humans = this.members;
    const roster: StartMsg['roster'] = humans.map((m) => ({
      kind: 'human',
      name: m.nickname,
      clientId: m.clientId,
    }));
    while (
      roster.length < Math.min(MAX_SLOTS, Math.max(TARGET_COMBATANTS, roster.length + 1))
    ) {
      roster.push({
        kind: 'bot',
        name: BOT_NAMES[roster.length - humans.length] ?? 'Bot',
        clientId: null,
      });
    }

    const start: StartMsg = {
      type: 'start',
      version: 1,
      mapId: this.selectedMapId,
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
        this.match?.setRemoteInput(msg.slot, msg.input);
        break;
      case 'snapshot':
        this.match?.applySnapshot(msg.state);
        break;
      case 'game_over':
        break;
    }
  }

  private launchFromStart(msg: StartMsg): void {
    const room = this.room;
    if (!room) return;
    const roster: RosterEntry[] = msg.roster.map((entry) => ({
      kind: entry.kind,
      name: entry.name,
    }));
    const localSlot = msg.roster.findIndex((entry) => entry.clientId === room.clientId);
    const mode: MatchMode = room.isHost ? 'host' : 'guest';
    this.beginMatch(msg.mapId, roster, msg.seed, mode, Math.max(0, localSlot));
  }

  private async leaveRoom(): Promise<void> {
    await this.room?.leave();
    this.room = null;
    this.members = [];
    this.lobbyList = null;
    this.showMenu();
  }

  // ----------------------------------------------------------------- match

  private beginMatch(
    mapId: string,
    roster: RosterEntry[],
    seed: number,
    mode: MatchMode,
    localSlot: number
  ): void {
    const entry = mapById(mapId) ?? MAPS[0];

    // A real match takes the whole cabinet: the attract demo must stop so it
    // is not paying for a second WebGL context and a second bot simulation.
    this.teardownCabinet();
    this.teardownMatch();
    this.root.replaceChildren();
    this.currentMapId = entry.def.id;

    const stage = el('div', 'stage');
    const canvas = el('canvas');
    stage.append(canvas);
    this.root.append(stage);
    // A lighter tube treatment during play: scanlines yes, rolling band no.
    stage.appendChild(el('div', 'crt crt--game'));
    this.stage = stage;

    const hud = new Hud(entry.def);
    stage.append(hud.root);

    const match = new Match(
      canvas,
      entry,
      roster,
      seed,
      mode,
      localSlot,
      this.audio,
      this.quality,
      {
        onSnapshot: (state) => {
          void this.room?.send({ type: 'snapshot', state });
        },
        onLocalInput: (input: PlayerInput) => {
          void this.room?.send({ type: 'input', slot: localSlot, input });
        },
        onFinished: (winner, state) => this.onMatchFinished(winner, state),
        onSkip: () => {
          this.afterMatch = this.campaign ? 'campaign-retry' : 'menu';
          this.endMatch();
        },
        onPauseChange: (paused) => this.onPauseChange(paused),
      }
    );
    this.match = match;

    // The HUD refreshes on the same rAF cadence as the renderer.
    const pump = (): void => {
      if (this.match !== match) return;
      hud.update(match.getState(), localSlot);
      requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
  }

  private onPauseChange(paused: boolean): void {
    if (!paused) {
      this.closeOverlay?.();
      this.closeOverlay = null;
      return;
    }
    if (this.closeOverlay || !this.stage) return;
    this.closeOverlay = showOverlay(
      this.stage,
      'PAUSED',
      'P TO RESUME · ESC TO LEAVE',
      [
        { label: 'RESUME', primary: true, onSelect: () => this.match?.setPaused(false) },
        {
          label: 'LEAVE MATCH',
          onSelect: () => {
            this.campaign = false;
            this.afterMatch = 'menu';
            this.endMatch();
          },
        },
      ]
    );
  }

  private openQuitConfirm(): void {
    if (!this.stage || this.closeOverlay) return;
    this.match?.setPaused(true);
    // setPaused already raised the pause overlay for offline matches.
    if (this.closeOverlay) return;
    this.closeOverlay = showOverlay(
      this.stage,
      'LEAVE THE MATCH?',
      'ONLINE MATCHES KEEP RUNNING FOR THE OTHERS WHILE YOU DECIDE.',
      [
        {
          label: 'KEEP PLAYING',
          primary: true,
          onSelect: () => {
            this.closeOverlay?.();
            this.closeOverlay = null;
            this.match?.setPaused(false);
          },
        },
        {
          label: 'LEAVE',
          onSelect: () => {
            this.campaign = false;
            this.afterMatch = 'menu';
            this.endMatch();
          },
        },
      ]
    );
  }

  private onMatchFinished(winner: number | null, state: GameState): void {
    if (this.room?.isHost) void this.room.send({ type: 'game_over', winner });

    const scores = [...state.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => `${arcadeCase(p.name)} — ${p.score}`);
    const headline =
      winner === null ? 'DRAW!' : `${arcadeCase(state.players[winner].name)} WINS!`;

    // Persistence and campaign bookkeeping are best-effort: a failure here must
    // never keep the result screen (and the way back) from appearing.
    this.afterMatch = 'menu';
    let epilogue = '';
    try {
      const mapId = this.currentMapId ?? MAP_IDS[0];
      recordResults(
        state.players.map((p) => ({
          name: p.name,
          mapId,
          score: p.score,
          won: p.id === winner,
        }))
      );

      if (this.campaign) {
        const localWon = winner === 0;
        if (localWon && this.campaignMapId) {
          if (!this.progress.completed.includes(this.campaignMapId)) {
            this.progress.completed.push(this.campaignMapId);
          }
          this.progress.totalScore += state.players[0].score;
          saveCampaign(this.progress);
          const next = this.nextCampaignMap();
          if (next) {
            this.afterMatch = 'campaign-next';
            epilogue = `NEXT STOP: ${arcadeCase(mapOrFirst(next).def.name)}`;
          } else {
            epilogue = `CAMPAIGN CLEARED — ${this.progress.totalScore} PTS`;
          }
        } else {
          this.afterMatch = 'campaign-retry';
          epilogue = 'TRY THIS ARENA AGAIN';
        }
      }
    } catch {
      // Keep going: the result screen must always show.
    }

    if (this.stage) {
      this.closeOverlay?.();
      this.closeOverlay = showOverlay(
        this.stage,
        headline,
        epilogue,
        [
          {
            label: this.afterMatch === 'menu' ? 'BACK TO MENU' : 'CONTINUE',
            primary: true,
            onSelect: () => this.endMatch(),
          },
        ],
        scores
      );
    }
    // Auto-advance so a walked-away player is never stuck on the podium.
    this.resultTimer = window.setTimeout(() => this.endMatch(), 8000);
  }

  private endMatch(): void {
    const next = this.afterMatch;
    const campaignMapId = this.campaignMapId;
    this.teardownMatch();
    this.audio.stopAmbient();

    if (this.room) {
      void this.leaveRoom();
      return;
    }
    if (next === 'campaign-next' || next === 'campaign-retry') {
      const mapId = next === 'campaign-next' ? this.nextCampaignMap() : campaignMapId;
      if (mapId) {
        this.campaignMapId = mapId;
        this.beginMatch(mapId, this.soloRoster(), this.newSeed(), 'solo', 0);
        return;
      }
    }
    this.campaign = false;
    this.showMenu();
  }

  // ------------------------------------------------------------------ misc

  private setStatus(text: string): void {
    this.status = text;
    const node = this.arcade?.querySelector('.status');
    if (node) node.textContent = text;
  }

  private newSeed(): number {
    return (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
  }

  private inviteCodeFromLocation(): string | null {
    const code = new URLSearchParams(window.location.search).get('room');
    if (!code) return null;
    const normalized = code.toUpperCase();
    return /^[A-Z2-9]{6}$/.test(normalized) ? normalized : null;
  }
}
