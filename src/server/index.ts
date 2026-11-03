import express from 'express';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { CHARACTERS, getEngine } from '../shared/theme.js';
import { cleanName } from '../shared/filter.js';
import { REACTIONS, type ClientToServer, type ServerToClient } from '../shared/protocol.js';
import type { Action, GameEvent } from '../shared/types.js';
import {
  addChat,
  applySettings,
  backToLobby,
  createRoom,
  EMPTY_ROOM_MS,
  enabledCharacterIds,
  maintainRoom,
  newCode,
  newPlayer,
  publicRoom,
  rngFor,
  startGame,
  validateParts,
  type Room,
  type RoomPlayer,
} from './rooms.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = resolve(process.env.DATA_DIR ?? 'data');
const HISTORY_DIR = join(DATA_DIR, 'history');
const SNAPSHOT = join(DATA_DIR, 'rooms.json');
const HISTORY_TTL_MS = 30 * 24 * 3600_000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 200);

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = [resolve(here, '../client'), resolve('dist/client')].find((d) => existsSync(join(d, 'index.html')));

mkdirSync(HISTORY_DIR, { recursive: true });

const rooms = new Map<string, Room>();
let dirty = false;

// ---------------------------------------------------------------- persistensi

function loadSnapshot() {
  if (!existsSync(SNAPSHOT)) return;
  try {
    const list = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Room[];
    const now = Date.now();
    for (const r of list) {
      for (const p of r.players) {
        p.connected = false;
        p.disconnectedAt = now; // beri 120 detik untuk kembali setelah server restart
      }
      if (r.game) r.game.turnDeadline = now + r.settings.turnTimeSec * 1000;
      if (r.game?.auction) r.game.auction.endsAt = now + 15_000;
      r.emptySince = now;
      rooms.set(r.code, r);
    }
    console.log(`Memulihkan ${list.length} room dari ${SNAPSHOT}`);
  } catch (e) {
    console.error('Gagal memuat snapshot room:', e);
  }
}

function saveSnapshot() {
  if (!dirty) return;
  dirty = false;
  const tmp = SNAPSHOT + '.tmp';
  writeFileSync(tmp, JSON.stringify([...rooms.values()]));
  renameSync(tmp, SNAPSHOT);
}

function saveHistory(room: Room) {
  if (!room.game || !room.historyId) return;
  const g = room.game;
  const file = join(HISTORY_DIR, `${room.historyId}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      code: room.code,
      startedAt: g.startedAt,
      endedAt: Date.now(),
      seed: room.rngSeed,
      settings: g.settings,
      players: g.players.map((p) => ({ id: p.id, name: p.name, character: p.character.id, stats: p.stats })),
      ranking: g.ranking,
      log: g.log,
    }),
  );
  room.historyId = null;
}

function cleanupHistory() {
  const now = Date.now();
  for (const f of readdirSync(HISTORY_DIR)) {
    const p = join(HISTORY_DIR, f);
    if (now - statSync(p).mtimeMs > HISTORY_TTL_MS) unlinkSync(p);
  }
}

// ---------------------------------------------------------------- http

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
if (CLIENT_DIR) {
  app.use(express.static(CLIENT_DIR, { maxAge: '1h', index: false }));
  app.get(['/', '/r/:code'], (_req, res) => res.sendFile(join(CLIENT_DIR, 'index.html')));
}
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  cors: process.env.NODE_ENV === 'production' ? undefined : { origin: true },
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

interface SocketData {
  code?: string;
  playerId?: string;
  bucket: number;
  bucketAt: number;
  chatTimes: number[];
}
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>;

function broadcast(room: Room, events: GameEvent[] = []) {
  const now = Date.now();
  if (events.length) io.to(room.code).emit('game:events', events);
  io.to(room.code).emit('room:state', publicRoom(room, now));
  if (room.game?.stage === 'gameover' && room.historyId) saveHistory(room);
  dirty = true;
}

/** Rate limit sederhana: token bucket 15 pesan, isi ulang 8/detik. */
function allow(socket: Sock): boolean {
  const d = socket.data;
  const now = Date.now();
  d.bucket = Math.min(15, d.bucket + ((now - d.bucketAt) / 1000) * 8);
  d.bucketAt = now;
  if (d.bucket < 1) return false;
  d.bucket -= 1;
  return true;
}

function ctxOf(socket: Sock): { room: Room; me: RoomPlayer } | null {
  const room = socket.data.code ? rooms.get(socket.data.code) : undefined;
  const me = room?.players.find((p) => p.id === socket.data.playerId);
  return room && me ? { room, me } : null;
}

function attach(socket: Sock, room: Room, me: RoomPlayer) {
  socket.data.code = room.code;
  socket.data.playerId = me.id;
  socket.join(room.code);
  me.connected = true;
  me.disconnectedAt = null;
  room.emptySince = null;
  socket.emit('chat:history', room.chat.slice(-50));
}

const noop = () => {};

io.on('connection', (raw) => {
  const socket = raw as Sock;
  socket.data.bucket = 15;
  socket.data.bucketAt = Date.now();
  socket.data.chatTimes = [];

  socket.use((_packet, next) => (allow(socket) ? next() : next(new Error('Terlalu banyak aksi, pelan-pelan ya'))));

  socket.on('room:create', (p, ack = noop) => {
    if (ctxOf(socket)) return ack({ ok: false, error: 'Kamu sudah di dalam room' });
    if (rooms.size >= MAX_ROOMS) return ack({ ok: false, error: 'Server penuh, coba lagi nanti' });
    const name = cleanName(p?.name);
    if (!name) return ack({ ok: false, error: 'Isi nama panggilan dulu' });
    const { room, player } = createRoom(newCode(new Set(rooms.keys())), name, Date.now());
    rooms.set(room.code, room);
    attach(socket, room, player);
    ack({ ok: true, code: room.code, playerId: player.id, token: player.token });
    broadcast(room);
  });

  socket.on('room:join', (p, ack = noop) => {
    const code = String(p?.code ?? '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Room tidak ditemukan' });
    // reconnect dengan token
    const existing = p?.token ? room.players.find((x) => x.token === p.token) : undefined;
    if (existing) {
      // Pemain yang sudah bangkrut/keluar tetap boleh kembali untuk menonton.
      attach(socket, room, existing);
      ack({ ok: true, code, playerId: existing.id, token: existing.token });
      return broadcast(room);
    }
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'Permainan di room ini sudah dimulai' });
    if (room.players.length >= room.settings.maxPlayers) return ack({ ok: false, error: 'Room sudah penuh' });
    const name = cleanName(p?.name);
    if (!name) return ack({ ok: false, error: 'Isi nama panggilan dulu' });
    const player = newPlayer(name);
    room.players.push(player);
    attach(socket, room, player);
    ack({ ok: true, code, playerId: player.id, token: player.token });
    broadcast(room);
  });

  socket.on('room:leave', () => {
    const c = ctxOf(socket);
    if (!c) return;
    const { room, me } = c;
    socket.leave(room.code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
    let events: GameEvent[] = [];
    if (room.phase === 'lobby') room.players = room.players.filter((p) => p.id !== me.id);
    else {
      me.connected = false;
      me.disconnectedAt = null;
      if (room.game) {
        const rng = rngFor(room);
        events = getEngine(room.game.themeId).forfeit(room.game, me.id, { rng, now: Date.now() });
        room.rngCounter = rng.counter;
      }
    }
    if (room.hostId === me.id) {
      const next = room.players.find((p) => p.connected && p.id !== me.id);
      if (next) room.hostId = next.id;
    }
    broadcast(room, events);
  });

  socket.on('lobby:character', (p, ack = noop) => {
    const c = ctxOf(socket);
    if (!c || c.room.phase !== 'lobby') return ack({ ok: false, error: 'Tidak bisa sekarang' });
    const { room, me } = c;
    if ('characterId' in (p ?? {})) {
      const id = String((p as { characterId: string }).characterId);
      if (!enabledCharacterIds().includes(id) || !CHARACTERS.some((x) => x.id === id))
        return ack({ ok: false, error: 'Karakter tidak tersedia' });
      if (room.players.some((x) => x.id !== me.id && x.characterId === id))
        return ack({ ok: false, error: 'Karakter sudah dipakai pemain lain' });
      me.characterId = id;
      me.customParts = null;
      me.customName = null;
    } else {
      const parts = validateParts((p as { custom: unknown }).custom);
      if (!parts) return ack({ ok: false, error: 'Data karakter custom tidak valid' });
      me.customParts = parts;
      me.customName = cleanName((p as { name: string }).name) || me.name;
      me.characterId = null;
    }
    me.ready = false;
    ack({ ok: true });
    broadcast(room);
  });

  socket.on('lobby:ready', (ready) => {
    const c = ctxOf(socket);
    if (!c || c.room.phase !== 'lobby') return;
    c.me.ready = !!ready && !!(c.me.characterId || c.me.customParts);
    broadcast(c.room);
  });

  socket.on('lobby:settings', (patch, ack = noop) => {
    const c = ctxOf(socket);
    if (!c || c.room.phase !== 'lobby') return ack({ ok: false, error: 'Tidak bisa sekarang' });
    if (c.room.hostId !== c.me.id) return ack({ ok: false, error: 'Hanya host yang bisa mengatur room' });
    const err = applySettings(c.room, patch);
    ack(err ? { ok: false, error: err } : { ok: true });
    broadcast(c.room);
  });

  socket.on('lobby:start', (ack = noop) => {
    const c = ctxOf(socket);
    if (!c) return ack({ ok: false, error: 'Tidak di room' });
    if (c.room.hostId !== c.me.id) return ack({ ok: false, error: 'Hanya host yang bisa memulai' });
    const err = startGame(c.room, Date.now());
    ack(err ? { ok: false, error: err } : { ok: true });
    if (!err) broadcast(c.room);
  });

  socket.on('room:playAgain', (ack = noop) => {
    const c = ctxOf(socket);
    if (!c) return ack({ ok: false, error: 'Tidak di room' });
    if (c.room.game?.stage !== 'gameover') return ack({ ok: false, error: 'Permainan belum selesai' });
    if (c.room.hostId !== c.me.id) return ack({ ok: false, error: 'Hanya host yang bisa memulai ulang' });
    c.room.players = c.room.players.filter((p) => p.connected);
    backToLobby(c.room);
    ack({ ok: true });
    broadcast(c.room);
  });

  socket.on('game:action', (action: Action, ack = noop) => {
    const c = ctxOf(socket);
    if (!c || !c.room.game) return ack({ ok: false, error: 'Tidak ada permainan' });
    if (!action || typeof action !== 'object' || typeof action.type !== 'string')
      return ack({ ok: false, error: 'Aksi tidak valid' });
    const g = c.room.game;
    const rng = rngFor(c.room);
    const res = getEngine(g.themeId).apply(g, c.me.id, action, { rng, now: Date.now() });
    c.room.rngCounter = rng.counter;
    if (!res.ok) return ack(res);
    ack({ ok: true });
    broadcast(c.room, res.events);
  });

  socket.on('chat:send', (text) => {
    const c = ctxOf(socket);
    if (!c) return;
    const now = Date.now();
    const t = (socket.data.chatTimes = socket.data.chatTimes.filter((x) => now - x < 10_000));
    if (t.length >= 6) return;
    t.push(now);
    const m = addChat(c.room, c.me, text, now);
    if (m) io.to(c.room.code).emit('chat:msg', m);
  });

  socket.on('chat:react', (emoji) => {
    const c = ctxOf(socket);
    if (!c || !REACTIONS.includes(emoji)) return;
    io.to(c.room.code).emit('chat:reaction', { from: c.me.id, emoji });
  });

  socket.on('disconnect', () => {
    const c = ctxOf(socket);
    if (!c) return;
    // pemain bisa punya lebih dari satu tab; hanya tandai terputus bila tidak ada socket lain
    const others = [...(io.sockets.adapter.rooms.get(c.room.code) ?? [])]
      .map((id) => io.sockets.sockets.get(id) as Sock | undefined)
      .filter((s) => s && s.id !== socket.id && s.data.playerId === c.me.id);
    if (others.length) return;
    c.me.connected = false;
    c.me.disconnectedAt = Date.now();
    if (!c.room.players.some((p) => p.connected)) c.room.emptySince = Date.now();
    broadcast(c.room);
  });
});

// ---------------------------------------------------------------- loop pemeliharaan

let lastSecond = 0;
setInterval(() => {
  const now = Date.now();
  const everySecond = now - lastSecond >= 1000;
  if (everySecond) lastSecond = now;
  for (const room of rooms.values()) {
    if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_MS) {
      rooms.delete(room.code);
      io.to(room.code).emit('room:closed', 'Room ditutup karena kosong');
      dirty = true;
      continue;
    }
    try {
      const { changed, events } = maintainRoom(room, now);
      const hasDisconnected = room.players.some((p) => !p.connected && p.disconnectedAt !== null);
      if (changed || events.length || (everySecond && hasDisconnected)) broadcast(room, events);
    } catch (e) {
      console.error(`Error di room ${room.code}:`, e);
    }
  }
}, 250);

setInterval(saveSnapshot, 10_000);
setInterval(cleanupHistory, 6 * 3600_000);
cleanupHistory();

function shutdown() {
  dirty = true;
  saveSnapshot();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

loadSnapshot();
http.listen(PORT, () => {
  console.log(`Monopoli: Pengen Sugih berjalan di http://localhost:${PORT}`);
  console.log(`Karakter aktif: ${enabledCharacterIds().join(', ')}`);
  if (!CLIENT_DIR) console.log('Klien belum di-build: jalankan `npm run build` atau pakai `npm run dev`.');
});
