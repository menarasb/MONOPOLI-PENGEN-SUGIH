// Kontrak pesan Socket.IO antara klien dan server.
import type { PublicGameState } from './engine.js';
import type { Action, CharacterParts, GameEvent, RoomSettings } from './types.js';

export interface PublicPlayer {
  id: string;
  name: string;
  characterId: string | null;
  customParts: CharacterParts | null;
  customName: string | null;
  ready: boolean;
  connected: boolean;
  /** detik tersisa untuk reconnect, bila terputus */
  reconnectLeft: number | null;
}

export interface PublicRoom {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing';
  settings: RoomSettings;
  players: PublicPlayer[];
  enabledCharacters: string[];
  game: PublicGameState | null;
  serverNow: number;
}

export interface ChatMessage {
  id: number;
  from: string;
  name: string;
  text: string;
  at: number;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
  token?: string;
}

export type Ack<T = { ok: boolean; error?: string }> = (res: T) => void;

export interface ClientToServer {
  'room:create': (p: { name: string }, ack: Ack<JoinResult>) => void;
  'room:join': (p: { code: string; name: string; token?: string }, ack: Ack<JoinResult>) => void;
  'room:leave': () => void;
  'room:playAgain': (ack: Ack) => void;
  'lobby:character': (
    p: { characterId: string } | { custom: CharacterParts; name: string },
    ack: Ack,
  ) => void;
  'lobby:ready': (ready: boolean) => void;
  'lobby:settings': (s: Partial<RoomSettings>, ack: Ack) => void;
  'lobby:start': (ack: Ack) => void;
  'game:action': (a: Action, ack: Ack) => void;
  'chat:send': (text: string) => void;
  'chat:react': (emoji: string) => void;
}

export interface ServerToClient {
  'room:state': (r: PublicRoom) => void;
  'room:closed': (reason: string) => void;
  'game:events': (ev: GameEvent[]) => void;
  'chat:history': (msgs: ChatMessage[]) => void;
  'chat:msg': (m: ChatMessage) => void;
  'chat:reaction': (p: { from: string; emoji: string }) => void;
}

export const REACTIONS = ['😂', '😭', '😱', '🔥', '👏', '🤑', '😡', '🙏'];
