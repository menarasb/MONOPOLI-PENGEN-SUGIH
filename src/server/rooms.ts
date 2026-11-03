import { randomBytes, randomInt } from 'node:crypto';
import { CHARACTERS, getEngine } from '../shared/theme.js';
import { cleanName, filterText } from '../shared/filter.js';
import type { ChatMessage, PublicRoom } from '../shared/protocol.js';
import {
  DEFAULT_SETTINGS,
  type CharacterChoice,
  type CharacterParts,
  type GameEvent,
  type GameState,
  type RoomSettings,
} from '../shared/types.js';
import { SeededRng } from './rng.js';

export const RECONNECT_MS = 120_000;
export const EMPTY_ROOM_MS = 10 * 60_000;
/** Jeda sebelum giliran pemain terputus dilewati otomatis (memberi waktu refresh halaman). */
export const DISCONNECT_SKIP_GRACE_MS = 5_000;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface RoomPlayer {
  id: string;
  token: string;
  name: string;
  characterId: string | null;
  customParts: CharacterParts | null;
  customName: string | null;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface Room {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing';
  settings: RoomSettings;
  players: RoomPlayer[];
  game: GameState | null;
  rngSeed: string | null;
  rngCounter: number;
  chat: ChatMessage[];
  chatN: number;
  createdAt: number;
  emptySince: number | null;
  historyId: string | null;
}

export function enabledCharacterIds(): string[] {
  const packs = (process.env.CHARACTER_PACKS ?? 'tokoh,generik').split(',').map((s) => s.trim());
  return CHARACTERS.filter((c) => packs.includes(c.pack)).map((c) => c.id);
}

export function newCode(existing: Set<string>): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!existing.has(c)) return c;
  }
}

export function newId(): string {
  return randomBytes(8).toString('hex');
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function createRoom(code: string, hostName: string, now: number): { room: Room; player: RoomPlayer } {
  const player = newPlayer(hostName);
  const room: Room = {
    code,
    hostId: player.id,
    phase: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    players: [player],
    game: null,
    rngSeed: null,
    rngCounter: 0,
    chat: [],
    chatN: 0,
    createdAt: now,
    emptySince: null,
    historyId: null,
  };
  return { room, player };
}

export function newPlayer(name: string): RoomPlayer {
  return {
    id: newId(),
    token: newToken(),
    name: cleanName(name) || 'Pemain',
    characterId: null,
    customParts: null,
    customName: null,
    ready: false,
    connected: true,
    disconnectedAt: null,
  };
}

const ALLOWED: Record<keyof RoomSettings, unknown[]> = {
  maxPlayers: [2, 3, 4],
  startMoney: [10000, 15000, 20000],
  auction: [true, false],
  freeParkingJackpot: [true, false],
  doubleSalaryOnGo: [true, false],
  gameTimeLimitMin: [0, 30, 60, 90],
  turnTimeSec: [30, 60, 90],
};

export function applySettings(room: Room, patch: Partial<RoomSettings>): string | null {
  const next = { ...room.settings };
  for (const [k, v] of Object.entries(patch ?? {})) {
    const key = k as keyof RoomSettings;
    if (!(key in ALLOWED)) continue;
    if (!ALLOWED[key].includes(v)) return `Nilai ${k} tidak valid`;
    (next as Record<string, unknown>)[key] = v;
  }
  if (next.maxPlayers < room.players.length) return 'Jumlah pemain sudah melebihi batas itu';
  room.settings = next;
  return null;
}

const PARTS_ALLOWED = {
  face: ['oval', 'bulat', 'kotak'],
  hair: ['pendek', 'belah', 'klimis', 'ikal', 'botak', 'panjang', 'bob'],
  headwear: ['none', 'peci', 'kerudung', 'topi'],
};

export function validateParts(p: unknown): CharacterParts | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const int = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
  if (!PARTS_ALLOWED.face.includes(o.face as string)) return null;
  if (!PARTS_ALLOWED.hair.includes(o.hair as string)) return null;
  if (!PARTS_ALLOWED.headwear.includes(o.headwear as string)) return null;
  if (!int(o.skin, 4) || !int(o.hairColor, 4) || !int(o.shirt, 6)) return null;
  return {
    face: o.face as CharacterParts['face'],
    hair: o.hair as CharacterParts['hair'],
    headwear: o.headwear as CharacterParts['headwear'],
    skin: o.skin as number,
    hairColor: o.hairColor as number,
    shirt: o.shirt as number,
    glasses: !!o.glasses,
    mustache: !!o.mustache,
  };
}

export function characterChoice(p: RoomPlayer): CharacterChoice | null {
  if (p.customParts) {
    return { id: `custom:${p.id}`, name: p.customName || p.name, parts: p.customParts, custom: true };
  }
  const def = CHARACTERS.find((c) => c.id === p.characterId);
  if (!def) return null;
  return { id: def.id, name: def.name, parts: def.parts, custom: false };
}

export function startGame(room: Room, now: number): string | null {
  if (room.phase !== 'lobby') return 'Permainan sudah berjalan';
  const ps = room.players.filter((p) => p.connected);
  if (ps.length < 2) return 'Butuh minimal 2 pemain';
  if (ps.length !== room.players.length) return 'Ada pemain yang terputus';
  if (!ps.every((p) => p.ready || p.id === room.hostId)) return 'Semua pemain harus siap';
  if (!ps.every((p) => characterChoice(p))) return 'Semua pemain harus memilih karakter';
  const rng = new SeededRng();
  room.rngSeed = rng.seed;
  const engine = getEngine();
  room.game = engine.createGame(
    ps.map((p) => ({ id: p.id, name: p.name, character: characterChoice(p)! })),
    room.settings,
    { rng, now },
  );
  room.rngCounter = rng.counter;
  engine.log(room.game, `Seed RNG permainan: ${rng.seed.slice(0, 16)}…`);
  room.phase = 'playing';
  room.historyId = `${room.code}-${now}`;
  return null;
}

export function rngFor(room: Room): SeededRng {
  return new SeededRng(room.rngSeed ?? undefined, room.rngCounter);
}

export function backToLobby(room: Room) {
  room.phase = 'lobby';
  room.game = null;
  room.rngSeed = null;
  room.rngCounter = 0;
  for (const p of room.players) p.ready = false;
}

export function addChat(room: Room, from: RoomPlayer, text: string, now: number): ChatMessage | null {
  const clean = filterText(String(text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200));
  if (!clean) return null;
  const m: ChatMessage = { id: ++room.chatN, from: from.id, name: from.name, text: clean, at: now };
  room.chat.push(m);
  if (room.chat.length > 100) room.chat.splice(0, room.chat.length - 100);
  return m;
}

export function publicRoom(room: Room, now: number): PublicRoom {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    enabledCharacters: enabledCharacterIds(),
    serverNow: now,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      characterId: p.characterId,
      customParts: p.customParts,
      customName: p.customName,
      ready: p.ready,
      connected: p.connected,
      reconnectLeft:
        p.connected || p.disconnectedAt === null
          ? null
          : Math.max(0, Math.ceil((p.disconnectedAt + RECONNECT_MS - now) / 1000)),
    })),
    game: room.game ? getEngine(room.game.themeId).publicView(room.game) : null,
  };
}

/**
 * Pemeliharaan berkala satu room: lelang, batas waktu giliran, pemain terputus.
 * Mengembalikan event yang perlu disiarkan, atau null bila tidak ada perubahan.
 */
export function maintainRoom(room: Room, now: number): { changed: boolean; events: GameEvent[] } {
  let changed = false;
  const events: GameEvent[] = [];
  // pemain terputus melewati batas reconnect
  for (const p of [...room.players]) {
    if (p.connected || p.disconnectedAt === null || now - p.disconnectedAt < RECONNECT_MS) continue;
    changed = true;
    if (room.phase === 'lobby') {
      room.players = room.players.filter((x) => x.id !== p.id);
    } else if (room.game) {
      const gp = room.game.players.find((x) => x.id === p.id);
      if (gp && !gp.bankrupt) {
        const rng = rngFor(room);
        events.push(...getEngine(room.game.themeId).forfeit(room.game, p.id, { rng, now }));
        room.rngCounter = rng.counter;
      }
      p.disconnectedAt = null; // sudah diproses; tetap tercatat sebagai pemain terputus
    }
  }
  if (!room.players.some((p) => p.id === room.hostId) || !room.players.find((p) => p.id === room.hostId)?.connected) {
    const next = room.players.find((p) => p.connected);
    if (next && next.id !== room.hostId) {
      room.hostId = next.id;
      changed = true;
    }
  }

  const g = room.game;
  if (room.phase === 'playing' && g && g.stage !== 'gameover') {
    const engine = getEngine(g.themeId);
    const rng = rngFor(room);
    const ctx = { rng, now };
    const before = g.logN;
    events.push(...engine.tick(g, ctx));
    engine.checkTimeLimit(g, ctx);
    const cur = g.players[g.turnIndex];
    const curRp = room.players.find((p) => p.id === cur.id);
    const curGone =
      !curRp || (!curRp.connected && curRp.disconnectedAt !== null && now - curRp.disconnectedAt >= DISCONNECT_SKIP_GRACE_MS) ||
      (!curRp.connected && curRp.disconnectedAt === null);
    const stage = g.stage as GameState['stage'];
    if (stage !== 'gameover' && stage !== 'auction') {
      if (stage === 'debt') {
        if (now >= g.turnDeadline) events.push(...engine.autoAct(g, ctx));
      } else if (curGone) {
        events.push(...engine.autoAct(g, ctx, true));
      } else if (now >= g.turnDeadline) {
        events.push(...engine.autoAct(g, ctx));
      }
    }
    room.rngCounter = rng.counter;
    if (g.logN !== before || events.length) changed = true;
  }
  return { changed, events };
}
