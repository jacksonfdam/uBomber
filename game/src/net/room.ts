import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { MAX_HUMANS } from '../core/constants';
import {
  channelName,
  generateRoomCode,
  isValidRoomCode,
  type RoomMsg,
} from './protocol';

export interface NetConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export interface LobbyMember {
  clientId: string;
  nickname: string;
  isHost: boolean;
}

export interface RoomEvents {
  onLobbyChange?: (members: LobbyMember[]) => void;
  onMessage?: (msg: RoomMsg) => void;
  onClosed?: (reason: string) => void;
}

/**
 * Thin wrapper around Supabase for one room.
 *
 * The `rooms` table is the invite-code registry (so a code can be validated
 * before joining); everything realtime — lobby presence, inputs, snapshots —
 * flows through a broadcast channel and never touches the database.
 */
export class RoomClient {
  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  readonly clientId: string;
  code = '';
  isHost = false;

  constructor(config: NetConfig, private events: RoomEvents = {}) {
    this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    this.clientId = cryptoRandomId();
  }

  /** Registers a room and joins its channel as host. Returns the code. */
  async createRoom(mapId: string, nickname: string): Promise<string> {
    const code = generateRoomCode();
    const { error } = await this.supabase.from('rooms').insert({
      code,
      map_id: mapId,
      host_client_id: this.clientId,
    });
    if (error) throw new Error(`could not create room: ${error.message}`);

    this.isHost = true;
    await this.joinChannel(code, nickname);
    return code;
  }

  /** Validates the code against the registry and joins the lobby. */
  async joinRoom(code: string, nickname: string): Promise<void> {
    const normalized = code.toUpperCase();
    if (!isValidRoomCode(normalized)) {
      throw new Error('invalid room code');
    }
    const { data, error } = await this.supabase
      .from('rooms')
      .select('code,status')
      .eq('code', normalized)
      .maybeSingle();
    if (error) throw new Error(`could not look up room: ${error.message}`);
    if (!data) throw new Error('room not found');
    if (data.status !== 'lobby') throw new Error('match already started');

    this.isHost = false;
    await this.joinChannel(normalized, nickname);
  }

  private async joinChannel(code: string, nickname: string): Promise<void> {
    this.code = code;
    const channel = this.supabase.channel(channelName(code), {
      config: { presence: { key: this.clientId }, broadcast: { self: false } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      this.events.onLobbyChange?.(this.members());
    });
    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      this.events.onMessage?.(payload as RoomMsg);
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ nickname, isHost: this.isHost });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`channel ${status}`));
        }
      });
    });
    this.channel = channel;
  }

  /** Current lobby roster from presence, host first, capped at MAX_HUMANS. */
  members(): LobbyMember[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<{
      nickname: string;
      isHost: boolean;
    }>();
    const members: LobbyMember[] = Object.entries(state).map(
      ([clientId, metas]) => ({
        clientId,
        nickname: metas[0]?.nickname ?? 'Player',
        isHost: metas[0]?.isHost ?? false,
      })
    );
    members.sort((a, b) => Number(b.isHost) - Number(a.isHost));
    return members.slice(0, MAX_HUMANS);
  }

  async send(msg: RoomMsg): Promise<void> {
    if (!this.channel) throw new Error('not in a room');
    await this.channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  }

  /** Host marks the room as started so late joins are rejected. */
  async markStarted(): Promise<void> {
    if (!this.isHost) return;
    await this.supabase
      .from('rooms')
      .update({ status: 'playing' })
      .eq('code', this.code);
  }

  async leave(): Promise<void> {
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

function cryptoRandomId(): string {
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}
