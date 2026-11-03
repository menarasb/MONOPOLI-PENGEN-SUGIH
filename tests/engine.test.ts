import { describe, expect, it } from 'vitest';
import { Engine } from '../src/shared/engine';
import { THEMES } from '../src/shared/theme';
import { DEFAULT_SETTINGS, type Ctx, type GameState, type RoomSettings } from '../src/shared/types';

const theme = THEMES.indonesia;
const engine = new Engine(theme);

/** RNG yang bisa diatur: nilai antrean dipakai dulu, lalu acak deterministik. */
function scriptedRng() {
  const queue: number[] = [];
  let seed = 7;
  return {
    queue,
    /** Antrekan lemparan dadu (nilai 1..6). */
    dice(...vals: number[]) {
      for (const v of vals) queue.push(v - 1);
    },
    int(n: number) {
      if (queue.length) return queue.shift()! % n;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    },
  };
}

function setup(n = 2, settings: Partial<RoomSettings> = {}) {
  const rng = scriptedRng();
  let now = 1_000_000;
  const ctx = (): Ctx => ({ rng, now });
  const players = ['A', 'B', 'C', 'D'].slice(0, n).map((id) => ({
    id,
    name: `Pemain ${id}`,
    character: { id, name: id, custom: false, parts: {} as never },
  }));
  // urutan: A lempar 6+6, sisanya lebih kecil
  rng.dice(6, 6, 1, 1, 2, 1, 1, 2);
  const s = engine.createGame(players, { ...DEFAULT_SETTINGS, ...settings }, ctx());
  // kocok dek tidak perlu deterministik; atur ulang supaya bisa diuji
  s.decks.chance = theme.cards.chance.map((c) => c.id);
  s.decks.community = theme.cards.community.map((c) => c.id);
  return {
    s,
    rng,
    ctx,
    advance(ms: number) {
      now += ms;
    },
    act(pid: string, a: Parameters<Engine['apply']>[2]) {
      const r = engine.apply(s, pid, a, ctx());
      if (!r.ok) throw new Error(r.error);
      return r.events;
    },
    tryAct(pid: string, a: Parameters<Engine['apply']>[2]) {
      return engine.apply(s, pid, a, ctx());
    },
  };
}

const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

describe('data tema', () => {
  it('papan 40 petak dengan komposisi standar', () => {
    const count = (t: string) => theme.tiles.filter((x) => x.type === t).length;
    expect(theme.tiles).toHaveLength(40);
    expect(count('city')).toBe(22);
    expect(count('transport')).toBe(4);
    expect(count('utility')).toBe(2);
    expect(count('tax')).toBe(2);
    expect(count('chance')).toBe(3);
    expect(count('community')).toBe(3);
    expect(theme.cards.chance).toHaveLength(16);
    expect(theme.cards.community).toHaveLength(16);
    expect(theme.tiles[39].name).toBe('Jakarta');
  });
});

describe('setup & urutan giliran', () => {
  it('lempar dadu tertinggi jalan duluan dan uang awal sesuai', () => {
    const { s } = setup(2, { startMoney: 20000 });
    expect(s.players[0].id).toBe('A');
    expect(s.players.every((p) => p.money === 20000)).toBe(true);
    expect(s.stage).toBe('roll');
  });
});

describe('giliran dasar', () => {
  it('lempar, maju, beli properti', () => {
    const g = setup();
    g.rng.dice(1, 2); // ke petak 3 Mataram
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(3);
    expect(g.s.stage).toBe('buy');
    g.act('A', { type: 'buy' });
    expect(g.s.props[3].owner).toBe('A');
    expect(P(g.s, 'A').money).toBe(15000 - 600);
    expect(g.s.stage).toBe('end');
    g.act('A', { type: 'endTurn' });
    expect(g.s.players[g.s.turnIndex].id).toBe('B');
  });

  it('menolak aksi di luar giliran', () => {
    const g = setup();
    expect(g.tryAct('B', { type: 'roll' })).toEqual({ ok: false, error: 'Bukan giliranmu' });
  });

  it('angka kembar memberi lemparan lagi, kembar 3x masuk penjara', () => {
    const g = setup();
    g.rng.dice(1, 1); // petak 2 Dana Umum -> D1 maju ke START
    g.act('A', { type: 'roll' });
    expect(g.s.stage).toBe('roll');
    g.rng.dice(2, 2);
    g.act('A', { type: 'roll' });
    expect(g.s.stage).not.toBe('end');
    if (g.s.stage === 'buy') g.act('A', { type: 'buy' });
    g.rng.dice(3, 3);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').inJail).toBe(true);
    expect(P(g.s, 'A').position).toBe(10);
    expect(g.s.stage).toBe('end');
  });

  it('lewat START menerima gaji 2.000', () => {
    const g = setup();
    P(g.s, 'A').position = 38;
    g.rng.dice(1, 2); // 38 + 3 = 1 (Kupang)
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(1);
    expect(P(g.s, 'A').money).toBe(17000);
  });

  it('gaji ganda bila berhenti tepat di START (opsi)', () => {
    const g = setup(2, { doubleSalaryOnGo: true });
    P(g.s, 'A').position = 35;
    g.rng.dice(2, 3);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').money).toBe(19000);
  });
});

describe('sewa', () => {
  it('sewa dasar, grup lengkap 2x, rumah & hotel', () => {
    const g = setup();
    g.s.props[1].owner = 'B';
    expect(engine.rentFor(g.s, 1, 7)).toBe(20);
    g.s.props[3].owner = 'B';
    expect(engine.rentFor(g.s, 1, 7)).toBe(40);
    g.s.props[1].houses = 3;
    expect(engine.rentFor(g.s, 1, 7)).toBe(900);
    g.s.props[1].houses = 5;
    expect(engine.rentFor(g.s, 1, 7)).toBe(2500);
    g.s.props[1].mortgaged = true;
    expect(engine.rentFor(g.s, 1, 7)).toBe(0);
  });

  it('transportasi & utilitas', () => {
    const g = setup();
    g.s.props[5].owner = 'B';
    expect(engine.rentFor(g.s, 5, 7)).toBe(250);
    g.s.props[15].owner = 'B';
    g.s.props[25].owner = 'B';
    expect(engine.rentFor(g.s, 5, 7)).toBe(1000);
    g.s.props[35].owner = 'B';
    expect(engine.rentFor(g.s, 5, 7)).toBe(2000);
    g.s.props[12].owner = 'B';
    expect(engine.rentFor(g.s, 12, 7)).toBe(280);
    g.s.props[28].owner = 'B';
    expect(engine.rentFor(g.s, 12, 7)).toBe(700);
  });

  it('berhenti di properti lawan membayar sewa otomatis', () => {
    const g = setup();
    g.s.props[3].owner = 'B';
    g.rng.dice(1, 2);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').money).toBe(15000 - 40);
    expect(P(g.s, 'B').money).toBe(15000 + 40);
    expect(P(g.s, 'A').stats.rentPaid).toBe(40);
  });
});

describe('lelang', () => {
  it('menolak beli memulai lelang; penawar tertinggi menang setelah 15 detik', () => {
    const g = setup();
    g.rng.dice(1, 2);
    g.act('A', { type: 'roll' });
    g.act('A', { type: 'decline' });
    expect(g.s.stage).toBe('auction');
    expect(g.tryAct('B', { type: 'bid', amount: 5 }).ok).toBe(false);
    g.act('B', { type: 'bid', amount: 10 });
    g.act('A', { type: 'bid', amount: 50 });
    g.act('B', { type: 'bid', amount: 100 });
    g.advance(14_000);
    engine.tick(g.s, g.ctx());
    expect(g.s.stage).toBe('auction');
    g.advance(2_000);
    engine.tick(g.s, g.ctx());
    expect(g.s.props[3].owner).toBe('B');
    expect(P(g.s, 'B').money).toBe(14900);
    expect(g.s.stage).toBe('end');
  });

  it('tanpa lelang jika opsi nonaktif', () => {
    const g = setup(2, { auction: false });
    g.rng.dice(1, 2);
    g.act('A', { type: 'roll' });
    g.act('A', { type: 'decline' });
    expect(g.s.stage).toBe('end');
    expect(g.s.props[3].owner).toBeNull();
  });
});

describe('bangunan', () => {
  function monopoly() {
    const g = setup();
    g.s.props[1].owner = 'A';
    g.s.props[3].owner = 'A';
    return g;
  }

  it('wajib punya grup lengkap dan bangun merata', () => {
    const g = setup();
    g.s.props[1].owner = 'A';
    expect(g.tryAct('A', { type: 'build', tile: 1 }).ok).toBe(false);
    const m = monopoly();
    m.act('A', { type: 'build', tile: 1 });
    expect(m.tryAct('A', { type: 'build', tile: 1 })).toEqual({ ok: false, error: 'Bangun merata dulu di grup ini' });
    m.act('A', { type: 'build', tile: 3 });
    m.act('A', { type: 'build', tile: 1 });
    expect(m.s.props[1].houses).toBe(2);
    expect(m.s.bankHouses).toBe(29);
    expect(P(m.s, 'A').money).toBe(15000 - 1500);
  });

  it('hotel mengembalikan 4 rumah ke bank, jual 50%', () => {
    const g = monopoly();
    for (let k = 0; k < 4; k++) {
      g.act('A', { type: 'build', tile: 1 });
      g.act('A', { type: 'build', tile: 3 });
    }
    expect(g.s.bankHouses).toBe(24);
    g.act('A', { type: 'build', tile: 1 });
    expect(g.s.props[1].houses).toBe(5);
    expect(g.s.bankHouses).toBe(28);
    expect(g.s.bankHotels).toBe(11);
    const before = P(g.s, 'A').money;
    g.act('A', { type: 'sell', tile: 1 });
    expect(g.s.props[1].houses).toBe(4);
    expect(P(g.s, 'A').money).toBe(before + 250);
  });

  it('stok rumah bank terbatas', () => {
    const g = monopoly();
    g.s.bankHouses = 0;
    expect(g.tryAct('A', { type: 'build', tile: 1 })).toEqual({ ok: false, error: 'Stok rumah bank habis' });
  });
});

describe('hipotek', () => {
  it('gadai 50%, tebus +10%, tidak bisa gadai bila ada bangunan', () => {
    const g = setup();
    g.s.props[39].owner = 'A';
    g.act('A', { type: 'mortgage', tile: 39 });
    expect(P(g.s, 'A').money).toBe(17000);
    g.act('A', { type: 'unmortgage', tile: 39 });
    expect(P(g.s, 'A').money).toBe(17000 - 2200);
    g.s.props[37].owner = 'A';
    g.s.props[37].houses = 1;
    expect(g.tryAct('A', { type: 'mortgage', tile: 39 }).ok).toBe(false);
  });
});

describe('penjara', () => {
  it('bayar denda 500 lalu lempar normal', () => {
    const g = setup();
    Object.assign(P(g.s, 'A'), { inJail: true, position: 10 });
    g.act('A', { type: 'payJail' });
    expect(P(g.s, 'A').money).toBe(14500);
    expect(P(g.s, 'A').inJail).toBe(false);
  });

  it('kembar di penjara: keluar dan maju tanpa lempar lagi', () => {
    const g = setup();
    Object.assign(P(g.s, 'A'), { inJail: true, position: 10 });
    g.rng.dice(4, 4);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(18);
    expect(P(g.s, 'A').inJail).toBe(false);
    g.act('A', { type: 'decline' });
    g.advance(20_000);
    engine.tick(g.s, g.ctx());
    expect(g.s.stage).toBe('end');
  });

  it('gagal kembar 3 kali: wajib bayar 500 lalu maju', () => {
    const g = setup();
    Object.assign(P(g.s, 'A'), { inJail: true, position: 10, jailTurns: 2 });
    g.rng.dice(1, 2);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').inJail).toBe(false);
    expect(P(g.s, 'A').position).toBe(13);
    expect(P(g.s, 'A').money).toBe(14500);
  });

  it('kartu Bebas dari Penjara dipakai dan kembali ke dek', () => {
    const g = setup();
    Object.assign(P(g.s, 'A'), { inJail: true, position: 10, jailFreeCards: [{ deck: 'chance', id: 'K8' }] });
    g.s.decks.chance = g.s.decks.chance.filter((x) => x !== 'K8');
    g.act('A', { type: 'useJailCard' });
    expect(P(g.s, 'A').inJail).toBe(false);
    expect(g.s.decks.chance.at(-1)).toBe('K8');
  });

  it('petak Masuk Penjara tidak memberi gaji START', () => {
    const g = setup();
    P(g.s, 'A').position = 25;
    g.rng.dice(2, 3);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(10);
    expect(P(g.s, 'A').inJail).toBe(true);
    expect(P(g.s, 'A').money).toBe(15000);
  });
});

describe('kartu', () => {
  it('kartu kembali ke bawah dek', () => {
    const g = setup();
    g.s.decks.community = ['D2', ...g.s.decks.community.filter((x) => x !== 'D2')];
    g.rng.dice(1, 1);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').money).toBe(17000);
    expect(g.s.decks.community.at(-1)).toBe('D2');
  });

  it('transportasi terdekat bayar 2x sewa', () => {
    const g = setup();
    g.s.props[15].owner = 'B';
    g.s.decks.chance = ['K5', ...g.s.decks.chance.filter((x) => x !== 'K5')];
    g.rng.dice(3, 4); // ke 7 Kesempatan -> transportasi terdekat 15
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(15);
    expect(P(g.s, 'B').money).toBe(15500);
  });

  it('utilitas terdekat bayar 10x dadu x10', () => {
    const g = setup();
    g.s.props[12].owner = 'B';
    g.s.decks.chance = ['K4', ...g.s.decks.chance.filter((x) => x !== 'K4')];
    g.rng.dice(3, 4, 2, 3); // ke 7, lalu lempar 5 untuk tagihan
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(12);
    expect(P(g.s, 'B').money).toBe(15000 + 500);
  });

  it('mundur 3 petak tidak memberi gaji', () => {
    const g = setup();
    g.s.decks.chance = ['K9', ...g.s.decks.chance.filter((x) => x !== 'K9')];
    g.rng.dice(3, 4);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(4);
    expect(P(g.s, 'A').money).toBe(13000); // kena Pajak Penghasilan
  });

  it('bayar ke tiap pemain & terima dari tiap pemain', () => {
    const g = setup(3);
    g.s.decks.chance = ['K15', ...g.s.decks.chance.filter((x) => x !== 'K15')];
    g.rng.dice(3, 4);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').money).toBe(14000);
    expect(P(g.s, 'B').money).toBe(15500);
    expect(P(g.s, 'C').money).toBe(15500);
  });

  it('perbaikan per rumah dan hotel', () => {
    const g = setup();
    g.s.props[1] = { owner: 'A', houses: 2, mortgaged: false };
    g.s.props[3] = { owner: 'A', houses: 5, mortgaged: false };
    g.s.decks.chance = ['K11', ...g.s.decks.chance.filter((x) => x !== 'K11')];
    g.rng.dice(3, 4);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').money).toBe(15000 - 2 * 250 - 1000);
  });
});

describe('jackpot Parkir Bebas', () => {
  it('pajak masuk pot dan diambil di Parkir Bebas', () => {
    const g = setup(2, { freeParkingJackpot: true });
    g.rng.dice(1, 3);
    g.act('A', { type: 'roll' });
    expect(g.s.pot).toBe(2000);
    P(g.s, 'A').position = 15;
    g.act('A', { type: 'endTurn' });
    g.s.turnIndex = 0;
    g.s.stage = 'roll';
    g.rng.dice(2, 3);
    g.act('A', { type: 'roll' });
    expect(P(g.s, 'A').position).toBe(20);
    expect(P(g.s, 'A').money).toBe(15000);
    expect(g.s.pot).toBe(0);
  });
});

describe('utang & bangkrut', () => {
  it('kekurangan uang -> fase utang, gadai lalu bayar', () => {
    const g = setup();
    const a = P(g.s, 'A');
    a.money = 10;
    g.s.props[39].owner = 'A';
    g.s.props[3].owner = 'B';
    g.rng.dice(1, 2);
    g.act('A', { type: 'roll' });
    expect(g.s.stage).toBe('debt');
    expect(g.tryAct('A', { type: 'bankrupt' }).ok).toBe(false);
    g.act('A', { type: 'mortgage', tile: 39 });
    g.act('A', { type: 'payDebt' });
    expect(a.money).toBe(10 + 2000 - 40);
    expect(g.s.stage).toBe('end');
  });

  it('bangkrut ke pemain: semua aset pindah, permainan selesai', () => {
    const g = setup();
    const a = P(g.s, 'A');
    a.money = 10;
    g.s.props[5].owner = 'A';
    g.s.props[5].mortgaged = true;
    g.s.props[3] = { owner: 'B', houses: 0, mortgaged: false };
    g.s.props[1] = { owner: 'B', houses: 0, mortgaged: false };
    g.s.props[3].houses = 5;
    g.rng.dice(1, 2);
    g.act('A', { type: 'roll' });
    expect(g.s.stage).toBe('debt');
    g.act('A', { type: 'bankrupt' });
    expect(a.bankrupt).toBe(true);
    expect(g.s.props[5].owner).toBe('B');
    expect(g.s.stage).toBe('gameover');
    expect(g.s.winner).toBe('B');
    expect(g.s.ranking).toEqual(['B', 'A']);
  });

  it('bangkrut ke bank: properti dilelang ulang', () => {
    const g = setup(3);
    const a = P(g.s, 'A');
    a.money = 100;
    g.s.props[1].owner = 'A';
    g.s.props[1].mortgaged = true;
    g.rng.dice(1, 3); // pajak 2.000
    g.act('A', { type: 'roll' });
    expect(g.s.stage).toBe('debt');
    g.act('A', { type: 'bankrupt' });
    expect(g.s.stage).toBe('auction');
    expect(g.s.auction?.tile).toBe(1);
    expect(g.s.props[1].owner).toBeNull();
    g.act('C', { type: 'bid', amount: 300 });
    g.advance(16_000);
    engine.tick(g.s, g.ctx());
    expect(g.s.props[1].owner).toBe('C');
    expect(g.s.stage).toBe('roll');
    expect(g.s.players[g.s.turnIndex].id).toBe('C'); // urutan: A, C, B
  });

  it('auto-likuidasi saat waktu habis', () => {
    const g = setup();
    const a = P(g.s, 'A');
    a.money = 0;
    g.s.props[39].owner = 'A';
    g.rng.dice(1, 3);
    g.act('A', { type: 'roll' });
    expect(g.s.stage).toBe('debt');
    engine.autoAct(g.s, g.ctx());
    expect(g.s.props[39].mortgaged).toBe(true);
    expect(a.money).toBe(0);
    expect(g.s.stage).toBe('end');
  });
});

describe('tukar-menukar', () => {
  it('tawar properti + uang, diterima', () => {
    const g = setup();
    g.s.props[1].owner = 'A';
    g.s.props[3].owner = 'B';
    g.act('A', { type: 'proposeTrade', to: 'B', give: { money: 100, tiles: [1], jailCards: 0 }, get: { money: 0, tiles: [3], jailCards: 0 } });
    expect(g.s.trades).toHaveLength(1);
    expect(g.tryAct('A', { type: 'respondTrade', id: 1, accept: true }).ok).toBe(false);
    g.act('B', { type: 'respondTrade', id: 1, accept: true });
    expect(g.s.props[1].owner).toBe('B');
    expect(g.s.props[3].owner).toBe('A');
    expect(P(g.s, 'B').money).toBe(15100);
  });

  it('tidak boleh menukar properti di grup yang ada bangunannya', () => {
    const g = setup();
    g.s.props[1] = { owner: 'A', houses: 1, mortgaged: false };
    g.s.props[3] = { owner: 'A', houses: 0, mortgaged: false };
    const r = g.tryAct('A', { type: 'proposeTrade', to: 'B', give: { money: 0, tiles: [3], jailCards: 0 }, get: { money: 100, tiles: [], jailCards: 0 } });
    expect(r.ok).toBe(false);
  });
});

describe('batas waktu', () => {
  it('pemenang = total aset terbesar', () => {
    const g = setup(2, { gameTimeLimitMin: 30 });
    g.s.props[39].owner = 'B';
    g.advance(31 * 60_000);
    g.rng.dice(1, 3);
    g.act('A', { type: 'roll' });
    g.act('A', { type: 'endTurn' });
    expect(g.s.stage).toBe('gameover');
    expect(g.s.winner).toBe('B');
  });
});

describe('otomatis', () => {
  it('pemain terputus dilewati tanpa membeli', () => {
    const g = setup();
    engine.autoAct(g.s, g.ctx(), true);
    expect(g.s.players[g.s.turnIndex].id).toBe('B');
    expect(P(g.s, 'A').position).toBe(0);
  });

  it('simulasi acak 60 permainan tidak error dan uang tidak negatif', () => {
    for (let k = 0; k < 60; k++) {
      const g = setup(4, { freeParkingJackpot: k % 2 === 0, gameTimeLimitMin: 0 });
      for (let step = 0; step < 3000 && g.s.stage !== 'gameover'; step++) {
        const cur = g.s.players[g.s.turnIndex];
        if (g.s.stage === 'auction') {
          const bidder = g.s.players.filter((p) => !p.bankrupt)[step % 4] ?? cur;
          if (bidder && !bidder.bankrupt) g.tryAct(bidder.id, { type: 'bid', amount: (g.s.auction!.highBid || 0) + 10 + (step % 50) });
          g.advance(16_000);
          engine.tick(g.s, g.ctx());
          continue;
        }
        if (g.s.stage === 'buy') {
          if (!g.tryAct(cur.id, { type: step % 3 ? 'buy' : 'decline' }).ok) g.act(cur.id, { type: 'decline' });
          continue;
        }
        if (g.s.stage === 'end') {
          for (const i of engine.ownedTiles(g.s, cur.id)) g.tryAct(cur.id, { type: 'build', tile: i });
        }
        engine.autoAct(g.s, g.ctx());
        for (const p of g.s.players) expect(p.money).toBeGreaterThanOrEqual(0);
        expect(g.s.bankHouses).toBeGreaterThanOrEqual(0);
        expect(g.s.bankHotels).toBeGreaterThanOrEqual(0);
      }
      const totalHouses = Object.values(g.s.props).reduce((a, o) => a + (o.houses < 5 ? o.houses : 0), 0);
      const totalHotels = Object.values(g.s.props).filter((o) => o.houses === 5).length;
      expect(totalHouses + g.s.bankHouses).toBe(32);
      expect(totalHotels + g.s.bankHotels).toBe(12);
      expect(g.s.decks.chance.length + g.s.players.reduce((a, p) => a + p.jailFreeCards.filter((c) => c.deck === 'chance').length, 0)).toBe(16);
    }
  }, 60_000);
});

describe('keluar permainan', () => {
  it('pemain yang keluar dianggap bangkrut ke bank dan giliran berpindah', () => {
    const g = setup(3);
    g.s.props[1].owner = 'A';
    engine.forfeit(g.s, 'A', g.ctx());
    expect(P(g.s, 'A').bankrupt).toBe(true);
    expect(g.s.stage).toBe('auction');
    g.advance(16_000);
    engine.tick(g.s, g.ctx());
    expect(g.s.stage).toBe('roll');
    expect(g.s.players[g.s.turnIndex].id).not.toBe('A');
  });

  it('bila tinggal 1 pemain tersisa setelah lawan keluar, dia otomatis menang', () => {
    const g = setup(3);
    engine.forfeit(g.s, 'B', g.ctx());
    expect(g.s.stage).not.toBe('gameover');
    engine.forfeit(g.s, 'A', g.ctx());
    expect(g.s.stage).toBe('gameover');
    expect(g.s.winner).toBe('C');
    expect(g.s.ranking[0]).toBe('C');
    expect(g.s.log.some((l) => l.text.includes('Tinggal dia sendiri'))).toBe(true);
  });
});
