import { describe, expect, it } from 'vitest';
import { applySettings, createRoom, maintainRoom, newCode, startGame, validateParts } from '../src/server/rooms';
import { SeededRng } from '../src/server/rng';
import { cleanName, filterText } from '../src/shared/filter';

describe('room', () => {
  it('kode room 6 huruf dan unik', () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = newCode(set);
      expect(c).toMatch(/^[A-Z]{6}$/);
      set.add(c);
    }
    expect(set.size).toBe(200);
  });

  it('pengaturan hanya menerima pilihan yang valid', () => {
    const { room } = createRoom('ABCDEF', 'Host', 0);
    expect(applySettings(room, { startMoney: 20000, turnTimeSec: 30 })).toBeNull();
    expect(room.settings.startMoney).toBe(20000);
    expect(applySettings(room, { startMoney: 999999 })).not.toBeNull();
    expect(room.settings.startMoney).toBe(20000);
  });

  it('mulai butuh 2 pemain yang siap dengan karakter', () => {
    const { room } = createRoom('ABCDEF', 'Host', 0);
    expect(startGame(room, 0)).toBe('Butuh minimal 2 pemain');
    room.players[0].characterId = 'jokowi';
    room.players.push({ ...room.players[0], id: 'p2', token: 't2', name: 'Dua', characterId: 'anies', ready: false });
    expect(startGame(room, 0)).toBe('Semua pemain harus siap');
    room.players[1].ready = true;
    expect(startGame(room, 0)).toBeNull();
    expect(room.phase).toBe('playing');
    expect(room.rngSeed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('giliran pemain terputus dilewati otomatis, lalu dikeluarkan setelah 120 detik', () => {
    const { room } = createRoom('ABCDEF', 'Host', 0);
    room.players[0].characterId = 'jokowi';
    room.players.push({ ...room.players[0], id: 'p2', token: 't2', name: 'Dua', characterId: 'anies', ready: true });
    startGame(room, 0);
    const g = room.game!;
    const first = g.players[0].id;
    const rp = room.players.find((p) => p.id === first)!;
    rp.connected = false;
    rp.disconnectedAt = 1000;
    maintainRoom(room, 7000);
    expect(g.players[g.turnIndex].id).not.toBe(first);
    expect(g.players[0].position).toBe(0);
    maintainRoom(room, 1000 + 121_000);
    expect(g.players.find((p) => p.id === first)!.bankrupt).toBe(true);
    expect(g.stage).toBe('gameover');
  });
});

describe('validasi', () => {
  it('karakter custom divalidasi', () => {
    const ok = { face: 'oval', skin: 1, hair: 'ikal', hairColor: 0, headwear: 'peci', glasses: true, mustache: false, shirt: 2 };
    expect(validateParts(ok)).toEqual(ok);
    expect(validateParts({ ...ok, face: 'alien' })).toBeNull();
    expect(validateParts({ ...ok, skin: 99 })).toBeNull();
  });

  it('penyaring kata kasar & nama maks 16 karakter', () => {
    expect(filterText('dasar goblok kamu')).toBe('dasar ****** kamu');
    expect(filterText('tukang kebun')).toBe('tukang kebun');
    expect(cleanName('<b>Namaku Panjang Sekali Banget</b>')).toHaveLength(16);
  });

  it('RNG ber-seed dapat direproduksi dan seragam', () => {
    const a = new SeededRng('abc');
    const b = new SeededRng('abc');
    const xs = Array.from({ length: 50 }, () => a.int(6));
    expect(Array.from({ length: 50 }, () => b.int(6))).toEqual(xs);
    const counts = Array(6).fill(0);
    const r = new SeededRng();
    for (let i = 0; i < 60000; i++) counts[r.int(6)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });
});
