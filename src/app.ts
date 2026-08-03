/**
 * Screen router and match lifecycle: main menu, online lobby, rankings,
 * credits, and the match itself.
 *
 * The Supabase client is loaded on demand — a solo player never downloads the
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
import { Hud, showOverlay } from './ui/hud';

/** Total combatants when humans alone do not fill the arena. */
const TARGET_COMBATANTS = 4;

const BOT_NAMES = ['Bot Nils', 'Bot Astrid', 'Bot Erik', 'Bot Greta', 'Bot Sven'];

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

  private match: Match | null = null;
  private stage: HTMLElement | null = null;
  private closeOverlay: (() => void) | null = null;
  private resultTimer: number | null = null;

  private room: RoomClient | null = null;
  private members: LobbyMember[] = [];

  private nickname = loadNickname();
  private selectedMapId = MAP_IDS[0];
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
    if (invited) this.status = `Invite detected — press "Join room" to enter ${invited}.`;
    this.showMenu(invited ?? '');
  }

  // ------------------------------------------------------------ navigation

  /** Esc backs out of sub-screens; in a match it asks first. */
  private onGlobalKey = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    if (this.closeOverlay) {
      // The quit dialog owns Escape while it is open.
      return;
    }
    if (this.match) {
      event.preventDefault();
      this.openQuitConfirm();
      return;
    }
    if (this.room) {
      void this.leaveRoom();
      return;
    }
    if (this.root.querySelector('[data-screen="rankings"], [data-screen="credits"]')) {
      this.audio.play('menu-back');
      this.showMenu();
    }
  };

  private clear(): void {
    this.closeOverlay?.();
    this.closeOverlay = null;
    if (this.resultTimer !== null) {
      window.clearTimeout(this.resultTimer);
      this.resultTimer = null;
    }
    this.match?.dispose();
    this.match = null;
    this.stage = null;
    this.root.replaceChildren();
  }

  // ------------------------------------------------------------------ menu

  private showMenu(prefillCode = ''): void {
    this.clear();
    this.audio.stopAmbient();
    this.audio.setMood('title');

    const screen = el('div', 'screen');
    screen.dataset.screen = 'menu';

    const brand = el('h1', 'brand');
    brand.innerHTML = 'u<span>Bomber</span>';
    screen.append(brand);
    screen.append(
      el(
        'p',
        'tagline',
        'Arcade battles across ten Stockholm arenas. Play the bots, run the campaign, or invite up to five friends with a link.'
      )
    );

    // --- play panel
    const play = el('div', 'panel');
    play.append(el('h2', undefined, 'Play'));

    const nameField = el('div', 'field');
    nameField.append(el('label', undefined, 'Nickname'));
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.placeholder = 'Player';
    nameInput.value = this.nickname;
    nameInput.addEventListener('input', () => {
      this.nickname = nameInput.value.trim();
      saveNickname(this.nickname);
    });
    nameField.append(nameInput);
    play.append(nameField);

    const mapField = el('div', 'field');
    mapField.append(el('label', undefined, 'Arena'));
    const mapSelect = el('select');
    for (const entry of MAPS) {
      const option = el('option', undefined, entry.def.name);
      option.value = entry.def.id;
      mapSelect.append(option);
    }
    mapSelect.value = this.selectedMapId;
    mapField.append(mapSelect);
    play.append(mapField);

    const preview = el('div', 'map-preview');
    const refreshPreview = (): void => {
      const entry = mapOrFirst(this.selectedMapId);
      preview.textContent = `${entry.def.district} — ${entry.def.description}`;
    };
    mapSelect.addEventListener('change', () => {
      this.selectedMapId = mapSelect.value;
      this.audio.play('menu-move');
      refreshPreview();
    });
    refreshPreview();
    play.append(preview);

    const actions = el('div', 'row');
    actions.append(
      button('Play solo', 'primary', () => {
        this.audio.play('menu-accept');
        this.startSolo();
      }),
      button(this.campaignLabel(), '', () => {
        this.audio.play('menu-accept');
        this.startCampaign();
      })
    );
    play.append(actions);
    screen.append(play);

    // --- online panel
    const online = el('div', 'panel');
    online.append(el('h2', undefined, 'Play with friends'));

    const codeField = el('div', 'field');
    codeField.append(el('label', undefined, 'Room code'));
    const codeInput = el('input');
    codeInput.type = 'text';
    codeInput.maxLength = 6;
    codeInput.placeholder = 'K7WQ2R';
    codeInput.value = prefillCode;
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase();
    });
    codeField.append(codeInput);
    online.append(codeField);

    const netRow = el('div', 'row');
    netRow.append(
      button('Create room', '', () => {
        this.audio.play('menu-accept');
        void this.createRoom();
      }),
      button('Join room', '', () => {
        this.audio.play('menu-accept');
        void this.joinRoom(codeInput.value.trim());
      })
    );
    online.append(netRow);

    const statusLine = el('div', 'status', this.status);
    online.append(statusLine);
    screen.append(online);

    // --- settings panel
    screen.append(this.buildSettingsPanel());

    // --- secondary navigation
    const nav = el('div', 'row');
    nav.append(
      button('Rankings', 'ghost', () => {
        this.audio.play('menu-accept');
        this.showRankings();
      }),
      button('Credits', 'ghost', () => {
        this.audio.play('menu-accept');
        this.showCredits();
      })
    );
    const navPanel = el('div', 'panel');
    navPanel.append(nav);
    screen.append(navPanel);

    const footer = el('div', 'footer');
    footer.innerHTML =
      'Open source under the MIT license · <a href="https://github.com/jacksonfdam/uBomber">Source &amp; docs on GitHub</a>';
    screen.append(footer);

    this.root.append(screen);
    requestAnimationFrame(() => {
      (play.querySelector('button.primary') as HTMLButtonElement | null)?.focus();
    });
  }

  private campaignLabel(): string {
    const done = this.progress.completed.length;
    return done >= MAP_IDS.length
      ? `Campaign complete (${this.progress.totalScore} pts) — restart`
      : `Campaign ${done}/${MAP_IDS.length}`;
  }

  private buildSettingsPanel(): HTMLElement {
    const panel = el('div', 'panel');
    panel.append(el('h2', undefined, 'Sound & visuals'));

    const grid = el('div', 'settings-grid');
    const slider = (label: string, value: number, onChange: (v: number) => void): HTMLElement => {
      const field = el('div', 'field');
      field.append(el('label', undefined, label));
      const input = el('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(value * 100));
      input.addEventListener('input', () => onChange(Number(input.value) / 100));
      field.append(input);
      return field;
    };

    grid.append(
      slider('Effects', this.audio.volumes.sfx, (v) =>
        this.audio.setVolumes({ ...this.audio.volumes, sfx: v })
      ),
      slider('Ambience', this.audio.volumes.ambient, (v) =>
        this.audio.setVolumes({ ...this.audio.volumes, ambient: v })
      ),
      slider('Music', this.audio.volumes.music, (v) =>
        this.audio.setVolumes({ ...this.audio.volumes, music: v })
      )
    );
    panel.append(grid);

    const toggles = el('div', 'settings-grid');
    const toggle = (label: string, key: keyof PostSettings): HTMLElement => {
      const wrap = el('label', 'toggle');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = this.quality[key];
      input.addEventListener('change', () => {
        this.quality = { ...this.quality, [key]: input.checked };
        saveQuality(this.quality);
        this.match?.applyPost(this.quality);
      });
      wrap.append(input, document.createTextNode(label));
      return wrap;
    };
    toggles.append(
      toggle('Post-processing', 'enabled'),
      toggle('Bloom', 'bloom'),
      toggle('Film grain', 'grain'),
      toggle('Chromatic aberration', 'aberration')
    );
    panel.append(toggles);
    panel.append(
      el(
        'div',
        'map-preview',
        'Turn post-processing off if the frame rate dips — the arena renders in a handful of draw calls without it.'
      )
    );
    return panel;
  }

  // -------------------------------------------------------------- rankings

  private showRankings(): void {
    this.clear();
    const screen = el('div', 'screen');
    screen.dataset.screen = 'rankings';
    screen.append(el('h1', 'brand', 'Rankings'));

    const entries = loadRankings();
    const overall = overallRanking(entries).slice(0, 8);

    const overallPanel = el('div', 'panel');
    overallPanel.append(el('h2', undefined, 'Overall'));
    if (overall.length === 0) {
      overallPanel.append(el('div', 'list is-empty', 'No matches recorded yet.'));
    } else {
      overallPanel.append(
        el(
          'div',
          'list',
          overall
            .map((row, i) => `${i + 1}. ${row.name} — ${row.total} pts (${row.wins} wins)`)
            .join('\n')
        )
      );
    }
    screen.append(overallPanel);

    const perMap = el('div', 'panel');
    perMap.append(el('h2', undefined, 'Best per arena'));
    perMap.append(
      el(
        'div',
        'list',
        MAPS.map((entry) => {
          const best = bestForMap(entries, entry.def.id);
          return best
            ? `${entry.def.name}: ${best.name} — ${best.score}`
            : `${entry.def.name}: —`;
        }).join('\n')
      )
    );
    screen.append(perMap);

    const back = el('div', 'panel');
    back.append(
      button('Back', '', () => {
        this.audio.play('menu-back');
        this.showMenu();
      })
    );
    screen.append(back);
    this.root.append(screen);
  }

  private showCredits(): void {
    this.clear();
    const screen = el('div', 'screen');
    screen.dataset.screen = 'credits';
    screen.append(el('h1', 'brand', 'Credits'));

    const panel = el('div', 'panel credits');
    panel.innerHTML = `
      <h2>uBomber</h2>
      <p><strong>Concept &amp; direction:</strong> Jackson Mafra.</p>
      <p><strong>Art:</strong> every tileset, block, bomb, blast and character in
      this game is generated by code in this repository. There are no image
      assets.</p>
      <p><strong>Audio:</strong> every sound effect, ambient bed and music track
      is synthesized at runtime with the Web Audio API. There are no recordings
      and no sample libraries.</p>
      <p><strong>Technology:</strong> Three.js (MIT), Vite (MIT), TypeScript
      (Apache-2.0), Vitest (MIT), Supabase Realtime for multiplayer.</p>
      <p><strong>Typography:</strong> Familjen Grotesk and Martian Mono
      (SIL OFL 1.1).</p>
      <p><strong>Setting:</strong> the ten arenas are affectionate
      interpretations of real places in Stockholm. No affiliation with or
      endorsement by any depicted location or operator is implied.</p>
      <p>uBomber belongs to the maze-bomber genre pioneered in the 1980s. It is
      an original work: all names, characters, art, audio and arena layouts were
      created for this project, and it is not affiliated with or endorsed by any
      other game or rights holder.</p>
    `;
    screen.append(panel);

    const back = el('div', 'panel');
    back.append(
      button('Back', '', () => {
        this.audio.play('menu-back');
        this.showMenu();
      })
    );
    screen.append(back);
    this.root.append(screen);
  }

  // ------------------------------------------------------------------ solo

  private soloRoster(): RosterEntry[] {
    // Solo and campaign humans get spare lives; bots always have one.
    return [
      { kind: 'human', name: this.playerName(), lives: SOLO_LIVES },
      { kind: 'bot', name: 'Bot Nils' },
      { kind: 'bot', name: 'Bot Astrid' },
      { kind: 'bot', name: 'Bot Erik' },
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
        this.setStatus('Missing /config.json — Supabase is not configured for this deployment.');
        return null;
      }
      this.room = new Client(config, {
        onLobbyChange: (members) => this.refreshLobby(members),
        onMessage: (msg) => this.handleMessage(msg),
      });
      return this.room;
    } catch (error) {
      this.setStatus(`Could not start online play: ${String(error)}`);
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
      this.setStatus(String(error));
    }
  }

  private async joinRoom(code: string): Promise<void> {
    if (!code) {
      this.setStatus('Enter a room code first.');
      return;
    }
    const client = await this.connect();
    if (!client) return;
    try {
      await client.joinRoom(code, this.playerName());
      this.showLobby(client.code, false);
    } catch (error) {
      this.setStatus(String(error));
    }
  }

  private showLobby(code: string, isHost: boolean): void {
    this.clear();
    this.audio.setMood('lobby');

    const screen = el('div', 'screen');
    screen.dataset.screen = 'lobby';
    screen.append(el('h1', 'brand', 'Lobby'));

    const panel = el('div', 'panel');
    panel.append(el('h2', undefined, 'Room code'));
    panel.append(el('div', 'code', code));
    panel.append(
      el('div', 'invite', `${window.location.origin}/?room=${code}`)
    );
    panel.append(
      el(
        'div',
        'map-preview',
        isHost
          ? 'Share the link, then press Start. Bots fill any empty slots.'
          : 'Waiting for the host to start…'
      )
    );
    screen.append(panel);

    const playersPanel = el('div', 'panel');
    playersPanel.append(el('h2', undefined, `Players (0/${MAX_HUMANS})`));
    const list = el('div', 'list is-empty', 'Connecting…');
    playersPanel.append(list);
    screen.append(playersPanel);
    this.lobbyList = { heading: playersPanel.querySelector('h2')!, list };

    const controls = el('div', 'panel');
    const row = el('div', 'row');
    if (isHost) {
      row.append(
        button('Start match', 'primary', () => {
          this.audio.play('menu-accept');
          this.startOnlineMatch();
        })
      );
    }
    row.append(
      button('Leave', '', () => {
        this.audio.play('menu-back');
        void this.leaveRoom();
      })
    );
    controls.append(row);
    screen.append(controls);

    this.root.append(screen);
    this.refreshLobby(this.members);
  }

  private lobbyList: { heading: HTMLElement; list: HTMLElement } | null = null;

  private refreshLobby(members: LobbyMember[]): void {
    this.members = members;
    if (!this.lobbyList) return;
    this.lobbyList.heading.textContent = `Players (${members.length}/${MAX_HUMANS})`;
    if (members.length === 0) {
      this.lobbyList.list.className = 'list is-empty';
      this.lobbyList.list.textContent = 'Connecting…';
      return;
    }
    this.lobbyList.list.className = 'list';
    this.lobbyList.list.textContent = members
      .map((m) => `${m.nickname}${m.isHost ? '  (host)' : ''}`)
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
    this.clear();
    this.currentMapId = entry.def.id;

    const stage = el('div', 'stage');
    const canvas = el('canvas');
    stage.append(canvas);
    this.root.append(stage);
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

    // The HUD refreshes off the same rAF cadence as the renderer.
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
      'Paused',
      'P to resume · Esc to leave the match.',
      [
        {
          label: 'Resume',
          primary: true,
          onSelect: () => this.match?.setPaused(false),
        },
        {
          label: 'Leave match',
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
    // setPaused already opened the pause overlay for offline matches.
    if (this.closeOverlay) return;
    this.closeOverlay = showOverlay(
      this.stage,
      'Leave the match?',
      'Online matches keep running for the other players while you decide.',
      [
        {
          label: 'Keep playing',
          primary: true,
          onSelect: () => {
            this.closeOverlay?.();
            this.closeOverlay = null;
            this.match?.setPaused(false);
          },
        },
        {
          label: 'Leave',
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
      .map((p) => `${p.name} — ${p.score} pts`);
    const headline = winner === null ? 'Draw!' : `${state.players[winner].name} wins!`;

    // Persistence and campaign bookkeeping are best-effort: a failure in here
    // must never keep the result screen (and the way back to the menu) from
    // appearing.
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
            epilogue = `Next stop: ${mapOrFirst(next).def.name}.`;
          } else {
            epilogue = `Campaign complete — ${this.progress.totalScore} pts!`;
          }
        } else {
          this.afterMatch = 'campaign-retry';
          epilogue = 'Try this arena again.';
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
            label: this.afterMatch === 'menu' ? 'Back to menu' : 'Continue',
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
    this.clear();
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
    const node = this.root.querySelector('.status');
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
