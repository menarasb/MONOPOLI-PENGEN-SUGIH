// Mesin aturan Monopoli: Pengen Sugih.
// Modul TypeScript murni tanpa I/O: dipakai server (otoritatif) dan klien (tampilan aksi valid).
import type {
  Action,
  ActionResult,
  Auction,
  CharacterChoice,
  Creditor,
  Ctx,
  DeckName,
  GameEvent,
  GameState,
  Offer,
  PlayerState,
  RoomSettings,
  Theme,
  Tile,
} from './types.js';
import { formatMoney as fmt } from './format.js';

const BOARD = 40;

export interface NewPlayer {
  id: string;
  name: string;
  character: CharacterChoice;
}

class RuleError extends Error {}
function fail(msg: string): never {
  throw new RuleError(msg);
}

/** Satu instance per tema; membungkus data papan + aturan. */
export class Engine {
  readonly theme: Theme;
  private cardIndex = new Map<string, { deck: DeckName; text: string; effect: string }>();

  constructor(theme: Theme) {
    this.theme = theme;
    for (const deck of ['chance', 'community'] as DeckName[]) {
      for (const c of theme.cards[deck]) this.cardIndex.set(c.id, { deck, text: c.text, effect: c.effect });
    }
  }

  tile(i: number): Tile {
    return this.theme.tiles[i];
  }

  isOwnable(i: number): boolean {
    const t = this.tile(i).type;
    return t === 'city' || t === 'transport' || t === 'utility';
  }

  groupTiles(groupId: string): number[] {
    return this.theme.tiles.filter((t) => t.group === groupId).map((t) => t.index);
  }

  // ---------------------------------------------------------------- setup

  createGame(players: NewPlayer[], settings: RoomSettings, ctx: Ctx): GameState {
    if (players.length < 2 || players.length > 4) throw new Error('Butuh 2–4 pemain');
    const s: GameState = {
      themeId: this.theme.id,
      settings: { ...settings },
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        character: p.character,
        money: settings.startMoney,
        position: 0,
        inJail: false,
        jailTurns: 0,
        jailFreeCards: [],
        bankrupt: false,
        bankruptAt: null,
        expression: 'normal',
        stats: { rentPaid: 0, rentReceived: 0, bought: 0, jailed: 0, doubles: 0, passedGo: 0 },
      })),
      turnIndex: 0,
      turnNo: 1,
      stage: 'roll',
      props: {},
      bankHouses: this.theme.bank.houses,
      bankHotels: this.theme.bank.hotels,
      decks: {
        chance: shuffle(this.theme.cards.chance.map((c) => c.id), ctx.rng),
        community: shuffle(this.theme.cards.community.map((c) => c.id), ctx.rng),
      },
      dice: null,
      doublesCount: 0,
      rollAgain: false,
      pendingBuy: null,
      debts: [],
      resume: null,
      auction: null,
      auctionQueue: [],
      trades: [],
      nextTradeId: 1,
      pot: 0,
      lastCard: null,
      startedAt: ctx.now,
      endsAt: settings.gameTimeLimitMin > 0 ? ctx.now + settings.gameTimeLimitMin * 60_000 : null,
      turnDeadline: ctx.now + settings.turnTimeSec * 1000,
      winner: null,
      ranking: [],
      log: [],
      logN: 0,
    };
    for (const t of this.theme.tiles) {
      if (this.isOwnable(t.index)) s.props[t.index] = { owner: null, houses: 0, mortgaged: false };
    }

    // Lempar dadu urutan giliran: tertinggi jalan duluan, seri dilempar ulang.
    const rolls = new Map<string, number[]>();
    let contenders = s.players.map((p) => p.id);
    const order: string[] = [];
    const rankGroup = (ids: string[]) => {
      const vals = new Map<string, number>();
      for (const id of ids) {
        const v = ctx.rng.int(6) + 1 + ctx.rng.int(6) + 1;
        vals.set(id, v);
        rolls.set(id, [...(rolls.get(id) ?? []), v]);
      }
      const distinct = [...new Set(vals.values())].sort((a, b) => b - a);
      for (const v of distinct) {
        const same = ids.filter((id) => vals.get(id) === v);
        if (same.length === 1) order.push(same[0]);
        else rankGroup(same);
      }
    };
    rankGroup(contenders);
    contenders = order;
    s.players.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    this.log(
      s,
      'Lempar dadu urutan: ' +
        s.players.map((p) => `${p.name} (${rolls.get(p.id)!.join('→')})`).join(', ') +
        `. ${s.players[0].name} jalan duluan.`,
    );
    return s;
  }

  // ---------------------------------------------------------------- helpers

  current(s: GameState): PlayerState {
    return s.players[s.turnIndex];
  }

  player(s: GameState, id: string): PlayerState {
    const p = s.players.find((x) => x.id === id);
    if (!p) fail('Pemain tidak ditemukan');
    return p;
  }

  alive(s: GameState): PlayerState[] {
    return s.players.filter((p) => !p.bankrupt);
  }

  log(s: GameState, text: string) {
    s.logN += 1;
    s.log.push({ n: s.logN, text });
    if (s.log.length > 150) s.log.splice(0, s.log.length - 150);
  }

  ownsGroup(s: GameState, owner: string, groupId: string): boolean {
    return this.groupTiles(groupId).every((i) => s.props[i].owner === owner);
  }

  countOwned(s: GameState, owner: string, type: Tile['type']): number {
    return this.theme.tiles.filter((t) => t.type === type && s.props[t.index]?.owner === owner).length;
  }

  ownedTiles(s: GameState, owner: string): number[] {
    return Object.keys(s.props)
      .map(Number)
      .filter((i) => s.props[i].owner === owner);
  }

  mortgageValue(i: number): number {
    return Math.round((this.tile(i).price ?? 0) * this.theme.mortgageRate);
  }

  unmortgageCost(i: number): number {
    return Math.round(this.mortgageValue(i) * (1 + this.theme.mortgageInterest));
  }

  buildingSellValue(i: number): number {
    return Math.floor((this.tile(i).houseCost ?? 0) * this.theme.buildingSellRate);
  }

  /** Sewa yang ditagih ketika `payer` berhenti di petak i. */
  rentFor(s: GameState, i: number, diceSum: number, opts: { transportMult?: number; utilityTen?: boolean } = {}): number {
    const t = this.tile(i);
    const o = s.props[i];
    if (!o || !o.owner || o.mortgaged) return 0;
    if (t.type === 'city') {
      if (o.houses === 0) return t.rent![0] * (this.ownsGroup(s, o.owner, t.group!) ? 2 : 1);
      return t.rent![o.houses];
    }
    if (t.type === 'transport') {
      const n = this.countOwned(s, o.owner, 'transport');
      return this.theme.transportRents[n - 1] * (opts.transportMult ?? 1);
    }
    if (t.type === 'utility') {
      const n = this.countOwned(s, o.owner, 'utility');
      const mult = opts.utilityTen ? this.theme.utilityMultipliers[1] : this.theme.utilityMultipliers[n >= 2 ? 1 : 0];
      return diceSum * mult * this.theme.utilityScale;
    }
    return 0;
  }

  /** Uang + nilai jual bangunan + nilai gadai properti yang belum tergadai. */
  liquidationValue(s: GameState, id: string): number {
    const p = this.player(s, id);
    let v = p.money;
    for (const i of this.ownedTiles(s, id)) {
      const o = s.props[i];
      if (this.tile(i).type === 'city') v += this.buildingSellValue(i) * (o.houses === 5 ? 5 : o.houses);
      if (!o.mortgaged) v += this.mortgageValue(i);
    }
    return v;
  }

  /** Total aset untuk penentuan pemenang saat batas waktu (tergadai dihitung 50%). */
  netWorth(s: GameState, id: string): number {
    const p = this.player(s, id);
    let v = p.money;
    for (const i of this.ownedTiles(s, id)) {
      const t = this.tile(i);
      const o = s.props[i];
      v += o.mortgaged ? Math.round((t.price ?? 0) * 0.5) : t.price ?? 0;
      if (t.type === 'city') v += (t.houseCost ?? 0) * o.houses;
    }
    return v;
  }

  debtOf(s: GameState, id: string): number {
    return s.debts.filter((d) => d.debtor === id).reduce((a, d) => a + d.amount, 0);
  }

  // ---------------------------------------------------------------- aksi

  /** Validasi & jalankan aksi. State hanya berubah bila aksi valid. */
  apply(s: GameState, playerId: string, action: Action, ctx: Ctx): ActionResult {
    // Semua validasi dilakukan sebelum state diubah, jadi aksi gagal tidak meninggalkan perubahan.
    const ev: GameEvent[] = [];
    try {
      if (s.stage === 'gameover') fail('Permainan sudah selesai');
      const p = this.player(s, playerId);
      if (p.bankrupt) fail('Kamu sudah bangkrut');
      this.dispatch(s, p, action, ctx, ev);
      return { ok: true, events: ev };
    } catch (e) {
      if (e instanceof RuleError) return { ok: false, error: e.message };
      throw e;
    }
  }

  private requireTurn(s: GameState, p: PlayerState, stage: GameState['stage']) {
    if (this.current(s).id !== p.id) fail('Bukan giliranmu');
    if (s.stage !== stage) fail('Aksi tidak tersedia sekarang');
  }

  private dispatch(s: GameState, p: PlayerState, a: Action, ctx: Ctx, ev: GameEvent[]): void {
    switch (a.type) {
      case 'roll':
        this.requireTurn(s, p, 'roll');
        return this.roll(s, p, ctx, ev);
      case 'payJail': {
        this.requireTurn(s, p, 'roll');
        if (!p.inJail) fail('Kamu tidak di penjara');
        if (p.money < this.theme.jailFine) fail('Uang tidak cukup untuk bayar denda');
        this.transfer(s, p.id, s.settings.freeParkingJackpot ? 'pot' : 'bank', this.theme.jailFine);
        p.inJail = false;
        p.jailTurns = 0;
        this.log(s, `${p.name} bayar denda ${fmt(this.theme.jailFine)} dan keluar penjara.`);
        ev.push({ t: 'sfx', name: 'coin' });
        return;
      }
      case 'useJailCard': {
        this.requireTurn(s, p, 'roll');
        if (!p.inJail) fail('Kamu tidak di penjara');
        const card = p.jailFreeCards.pop();
        if (!card) fail('Kamu tidak punya kartu Bebas dari Penjara');
        s.decks[card.deck].push(card.id);
        p.inJail = false;
        p.jailTurns = 0;
        this.log(s, `${p.name} memakai kartu Bebas dari Penjara.`);
        return;
      }
      case 'buy': {
        this.requireTurn(s, p, 'buy');
        const i = s.pendingBuy!;
        const price = this.tile(i).price!;
        if (p.money < price) fail('Uang tidak cukup');
        p.money -= price;
        s.props[i].owner = p.id;
        p.stats.bought += 1;
        p.expression = 'senang';
        s.pendingBuy = null;
        this.log(s, `${p.name} membeli ${this.tile(i).name} seharga ${fmt(price)}.`);
        ev.push({ t: 'sfx', name: 'buy' });
        return this.settle(s, ctx, ev);
      }
      case 'decline': {
        this.requireTurn(s, p, 'buy');
        const i = s.pendingBuy!;
        s.pendingBuy = null;
        if (s.settings.auction) {
          this.log(s, `${p.name} tidak membeli ${this.tile(i).name}. Properti dilelang!`);
          s.auctionQueue.push(i);
        } else {
          this.log(s, `${p.name} tidak membeli ${this.tile(i).name}.`);
        }
        return this.settle(s, ctx, ev);
      }
      case 'bid': {
        if (s.stage !== 'auction' || !s.auction) fail('Tidak ada lelang');
        const amt = Math.floor(Number(a.amount));
        const min = Math.max(this.theme.auction.minBid, s.auction.highBid + 1);
        if (!Number.isFinite(amt) || amt < min) fail(`Tawaran minimal ${fmt(min)}`);
        if (amt > p.money) fail('Uang tidak cukup');
        if (s.auction.highBidder === p.id) fail('Kamu sudah penawar tertinggi');
        s.auction.highBid = amt;
        s.auction.highBidder = p.id;
        s.auction.endsAt = ctx.now + this.theme.auction.timeoutSec * 1000;
        this.log(s, `${p.name} menawar ${fmt(amt)}.`);
        ev.push({ t: 'sfx', name: 'bid' });
        return;
      }
      case 'build':
        return this.build(s, p, a.tile, ev);
      case 'sell':
        return this.sellBuilding(s, p, a.tile, ev);
      case 'mortgage':
        return this.mortgage(s, p, a.tile);
      case 'unmortgage':
        return this.unmortgage(s, p, a.tile);
      case 'payDebt': {
        if (s.stage !== 'debt') fail('Tidak ada utang');
        const total = this.debtOf(s, p.id);
        if (total === 0) fail('Kamu tidak punya utang');
        if (p.money < total) fail(`Uang kurang ${fmt(total - p.money)}. Jual bangunan atau gadaikan properti dulu.`);
        this.payDebtsOf(s, p);
        ev.push({ t: 'sfx', name: 'coin' });
        return this.settle(s, ctx, ev);
      }
      case 'bankrupt': {
        if (s.stage !== 'debt' || this.debtOf(s, p.id) === 0) fail('Kamu tidak sedang berutang');
        const total = this.debtOf(s, p.id);
        if (this.liquidationValue(s, p.id) >= total)
          fail('Asetmu masih cukup. Jual bangunan / gadaikan properti untuk membayar.');
        this.goBankrupt(s, p, ctx, ev);
        return this.settle(s, ctx, ev);
      }
      case 'endTurn':
        this.requireTurn(s, p, 'end');
        return this.nextTurn(s, ctx);
      case 'proposeTrade':
        return this.proposeTrade(s, p, a.to, a.give, a.get);
      case 'respondTrade':
        return this.respondTrade(s, p, a.id, a.accept, ev);
      case 'cancelTrade': {
        const t = s.trades.find((x) => x.id === a.id);
        if (!t || t.from !== p.id) fail('Tawaran tidak ditemukan');
        s.trades = s.trades.filter((x) => x.id !== a.id);
        return;
      }
      default:
        fail('Aksi tidak dikenal');
    }
  }

  // ---------------------------------------------------------------- giliran

  private roll(s: GameState, p: PlayerState, ctx: Ctx, ev: GameEvent[]): void {
    const d: [number, number] = [ctx.rng.int(6) + 1, ctx.rng.int(6) + 1];
    const sum = d[0] + d[1];
    const dbl = d[0] === d[1];
    s.dice = d;
    p.expression = 'normal';
    ev.push({ t: 'dice', player: p.id, dice: d }, { t: 'sfx', name: 'dice' });
    if (dbl) p.stats.doubles += 1;
    this.log(s, `${p.name} melempar ${d[0]} + ${d[1]} = ${sum}${dbl ? ' (kembar!)' : ''}.`);

    if (p.inJail) {
      if (dbl) {
        p.inJail = false;
        p.jailTurns = 0;
        s.rollAgain = false;
        this.log(s, `${p.name} keluar penjara karena angka kembar.`);
        this.moveBy(s, p, sum, ev);
        this.resolveTile(s, p, ctx, ev, sum);
      } else {
        p.jailTurns += 1;
        if (p.jailTurns >= this.theme.maxJailTurns) {
          p.inJail = false;
          p.jailTurns = 0;
          s.rollAgain = false;
          this.log(s, `${p.name} gagal kembar 3 kali, wajib bayar denda ${fmt(this.theme.jailFine)}.`);
          this.charge(s, p.id, s.settings.freeParkingJackpot ? 'pot' : 'bank', this.theme.jailFine, 'Denda penjara');
          s.resume = { kind: 'move', steps: sum };
        } else {
          this.log(s, `${p.name} masih di penjara (percobaan ${p.jailTurns}/${this.theme.maxJailTurns}).`);
          s.rollAgain = false;
        }
      }
      return this.settle(s, ctx, ev);
    }

    if (dbl) {
      s.doublesCount += 1;
      if (s.doublesCount >= 3) {
        this.log(s, `${p.name} kembar 3 kali berturut-turut!`);
        this.sendToJail(s, p, ev);
        return this.settle(s, ctx, ev);
      }
    }
    s.rollAgain = dbl;
    this.moveBy(s, p, sum, ev);
    this.resolveTile(s, p, ctx, ev, sum);
    return this.settle(s, ctx, ev);
  }

  /** Lanjutkan alur sampai butuh input pemain. */
  private settle(s: GameState, ctx: Ctx, ev: GameEvent[]): void {
    for (let guard = 0; guard < 50; guard++) {
      if (s.stage === 'gameover') return;
      if (s.debts.length) {
        if (s.stage !== 'debt') this.setStage(s, 'debt', ctx);
        return;
      }
      if (s.auction) return;
      if (s.auctionQueue.length) {
        this.startAuction(s, s.auctionQueue.shift()!, ctx);
        return;
      }
      if (s.pendingBuy !== null) {
        this.setStage(s, 'buy', ctx);
        return;
      }
      if (s.resume) {
        const r = s.resume;
        s.resume = null;
        const p = this.current(s);
        if (!p.bankrupt && r.kind === 'move') {
          this.moveBy(s, p, r.steps, ev);
          this.resolveTile(s, p, ctx, ev, r.steps);
        }
        continue;
      }
      break;
    }
    const cur = this.current(s);
    if (cur.bankrupt) return this.nextTurn(s, ctx);
    const next = s.rollAgain && !cur.inJail ? 'roll' : 'end';
    if (s.stage !== next || next === 'roll') this.setStage(s, next, ctx);
  }

  private setStage(s: GameState, stage: GameState['stage'], ctx: Ctx) {
    s.stage = stage;
    s.turnDeadline = ctx.now + s.settings.turnTimeSec * 1000;
  }

  private nextTurn(s: GameState, ctx: Ctx): void {
    s.rollAgain = false;
    s.doublesCount = 0;
    s.dice = null;
    s.pendingBuy = null;
    if (this.alive(s).length <= 1) return this.endGame(s, 'last');
    if (s.endsAt !== null && ctx.now >= s.endsAt) return this.endGame(s, 'time');
    let i = s.turnIndex;
    do {
      i = (i + 1) % s.players.length;
    } while (s.players[i].bankrupt);
    s.turnIndex = i;
    s.turnNo += 1;
    for (const p of s.players) if (!p.bankrupt && p.expression !== 'sedih') p.expression = 'normal';
    const p = s.players[i];
    this.setStage(s, 'roll', ctx);
    this.log(s, `— Giliran ${p.name}${p.inJail ? ' (di penjara)' : ''}.`);
  }

  endGame(s: GameState, reason: 'last' | 'time' | 'left') {
    const alive = this.alive(s);
    const byWorth = [...alive].sort((a, b) => this.netWorth(s, b.id) - this.netWorth(s, a.id));
    const dead = s.players.filter((p) => p.bankrupt).sort((a, b) => (b.bankruptAt ?? 0) - (a.bankruptAt ?? 0));
    s.ranking = [...byWorth, ...dead].map((p) => p.id);
    s.winner = s.ranking[0];
    s.stage = 'gameover';
    s.auction = null;
    s.auctionQueue = [];
    s.debts = [];
    s.trades = [];
    const w = this.player(s, s.winner);
    w.expression = 'senang';
    this.log(
      s,
      reason === 'time'
        ? `Waktu habis! ${w.name} menang dengan total aset ${fmt(this.netWorth(s, w.id))}.`
        : reason === 'left'
          ? `${w.name} menang! Tinggal dia sendiri yang tersisa.`
          : `${w.name} menang! Semua lawan bangkrut.`,
    );
  }

  /** Dipanggil server ketika batas waktu permainan habis di tengah giliran. */
  checkTimeLimit(s: GameState, ctx: Ctx): boolean {
    if (s.stage === 'gameover' || s.endsAt === null || ctx.now < s.endsAt) return false;
    if (s.stage === 'auction' || s.stage === 'debt') return false; // tunggu selesai dulu
    this.endGame(s, 'time');
    return true;
  }

  // ---------------------------------------------------------------- gerak

  private salary(s: GameState, landedOnGo: boolean): number {
    return landedOnGo && s.settings.doubleSalaryOnGo ? this.theme.salary * 2 : this.theme.salary;
  }

  private moveBy(s: GameState, p: PlayerState, steps: number, ev: GameEvent[]) {
    const from = p.position;
    const to = (((from + steps) % BOARD) + BOARD) % BOARD;
    p.position = to;
    ev.push({ t: 'move', player: p.id, from, to, steps, direct: false });
    if (steps > 0 && from + steps >= BOARD) this.passGo(s, p, to === 0, ev);
  }

  /** Maju (selalu searah jarum jam) ke petak tujuan. */
  private moveTo(s: GameState, p: PlayerState, target: number, ev: GameEvent[]) {
    const from = p.position;
    const steps = (target - from + BOARD) % BOARD || BOARD;
    p.position = target;
    ev.push({ t: 'move', player: p.id, from, to: target, steps, direct: false });
    if (from + steps >= BOARD) this.passGo(s, p, target === 0, ev);
  }

  private passGo(s: GameState, p: PlayerState, landed: boolean, ev: GameEvent[]) {
    const amt = this.salary(s, landed);
    p.money += amt;
    p.stats.passedGo += 1;
    p.expression = 'senang';
    this.log(s, `${p.name} ${landed ? 'berhenti di' : 'lewat'} START, terima ${fmt(amt)}.`);
    ev.push({ t: 'sfx', name: 'coin' });
  }

  private sendToJail(s: GameState, p: PlayerState, ev: GameEvent[]) {
    const from = p.position;
    p.position = this.theme.jailIndex;
    p.inJail = true;
    p.jailTurns = 0;
    p.expression = 'kaget';
    p.stats.jailed += 1;
    s.rollAgain = false;
    s.doublesCount = 0;
    ev.push({ t: 'move', player: p.id, from, to: p.position, steps: 0, direct: true }, { t: 'sfx', name: 'jail' });
    this.log(s, `${p.name} masuk penjara!`);
  }

  // ---------------------------------------------------------------- petak

  private resolveTile(
    s: GameState,
    p: PlayerState,
    ctx: Ctx,
    ev: GameEvent[],
    diceSum: number,
    opts: { transportMult?: number; utilityTen?: boolean } = {},
  ): void {
    const i = p.position;
    const t = this.tile(i);
    switch (t.type) {
      case 'city':
      case 'transport':
      case 'utility': {
        const o = s.props[i];
        if (!o.owner) {
          s.pendingBuy = i;
          return;
        }
        if (o.owner === p.id) return;
        const owner = this.player(s, o.owner);
        if (o.mortgaged) {
          this.log(s, `${t.name} sedang digadaikan, ${p.name} tidak bayar sewa.`);
          return;
        }
        let sum = diceSum;
        if (t.type === 'utility' && opts.utilityTen) {
          const d: [number, number] = [ctx.rng.int(6) + 1, ctx.rng.int(6) + 1];
          ev.push({ t: 'dice', player: p.id, dice: d });
          sum = d[0] + d[1];
          this.log(s, `${p.name} melempar dadu untuk tagihan utilitas: ${sum}.`);
        }
        const rent = this.rentFor(s, i, sum, opts);
        this.log(s, `${p.name} bayar sewa ${fmt(rent)} ke ${owner.name} (${t.name}).`);
        ev.push({ t: 'sfx', name: 'rent' });
        if (rent >= 2000) p.expression = 'sedih';
        this.charge(s, p.id, owner.id, rent, `Sewa ${t.name}`, true);
        return;
      }
      case 'tax':
        this.log(s, `${p.name} bayar ${t.name} ${fmt(t.amount!)}.`);
        this.charge(s, p.id, s.settings.freeParkingJackpot ? 'pot' : 'bank', t.amount!, t.name);
        return;
      case 'chance':
      case 'community':
        return this.drawCard(s, p, t.type, ctx, ev);
      case 'gotojail':
        return this.sendToJail(s, p, ev);
      case 'parking':
        if (s.settings.freeParkingJackpot && s.pot > 0) {
          this.log(s, `${p.name} dapat jackpot Parkir Bebas ${fmt(s.pot)}!`);
          p.money += s.pot;
          s.pot = 0;
          p.expression = 'senang';
          ev.push({ t: 'sfx', name: 'coin' });
        }
        return;
      default:
        return;
    }
  }

  private drawCard(s: GameState, p: PlayerState, deck: DeckName, ctx: Ctx, ev: GameEvent[]): void {
    const id = s.decks[deck].shift()!;
    const card = this.cardIndex.get(id)!;
    s.lastCard = { deck, id, text: card.text, player: p.id };
    ev.push({ t: 'card', player: p.id, deck, text: card.text }, { t: 'sfx', name: 'card' });
    this.log(s, `${p.name} ambil kartu ${deck === 'chance' ? 'Kesempatan' : 'Dana Umum'}: "${card.text}"`);
    const [kind, arg = ''] = card.effect.split(':');
    if (kind === 'jail_free') {
      p.jailFreeCards.push({ deck, id });
      return; // kartu disimpan pemain
    }
    s.decks[deck].push(id);
    const others = this.alive(s).filter((x) => x.id !== p.id);
    switch (kind) {
      case 'move_to':
        this.moveTo(s, p, Number(arg), ev);
        return this.resolveTile(s, p, ctx, ev, s.dice ? s.dice[0] + s.dice[1] : 0);
      case 'move_relative':
        this.moveBy(s, p, Number(arg), ev);
        return this.resolveTile(s, p, ctx, ev, s.dice ? s.dice[0] + s.dice[1] : 0);
      case 'nearest': {
        const type = arg === 'utility' ? 'utility' : 'transport';
        let i = p.position;
        do i = (i + 1) % BOARD;
        while (this.tile(i).type !== type);
        this.moveTo(s, p, i, ev);
        return this.resolveTile(
          s,
          p,
          ctx,
          ev,
          0,
          type === 'utility' ? { utilityTen: true } : { transportMult: 2 },
        );
      }
      case 'collect':
        p.money += Number(arg);
        p.expression = 'senang';
        ev.push({ t: 'sfx', name: 'coin' });
        return;
      case 'pay':
        return this.charge(s, p.id, s.settings.freeParkingJackpot ? 'pot' : 'bank', Number(arg), 'Kartu');
      case 'pay_each':
        for (const o of others) this.charge(s, p.id, o.id, Number(arg), 'Kartu');
        return;
      case 'collect_each':
        for (const o of others) this.charge(s, o.id, p.id, Number(arg), 'Kartu');
        return;
      case 'go_to_jail':
        return this.sendToJail(s, p, ev);
      case 'repairs': {
        const [perHouse, perHotel] = arg.split('/').map(Number);
        let houses = 0;
        let hotels = 0;
        for (const i of this.ownedTiles(s, p.id)) {
          const h = s.props[i].houses;
          if (h === 5) hotels++;
          else houses += h;
        }
        const total = houses * perHouse + hotels * perHotel;
        if (total > 0) {
          this.log(s, `${p.name} bayar perbaikan ${houses} rumah & ${hotels} hotel: ${fmt(total)}.`);
          this.charge(s, p.id, s.settings.freeParkingJackpot ? 'pot' : 'bank', total, 'Perbaikan');
        }
        return;
      }
    }
  }

  // ---------------------------------------------------------------- uang

  private transfer(s: GameState, from: string, to: Creditor, amount: number, isRent = false) {
    const p = this.player(s, from);
    p.money -= amount;
    if (to === 'pot') s.pot += amount;
    else if (to !== 'bank') {
      const r = this.player(s, to);
      r.money += amount;
      if (isRent) {
        r.stats.rentReceived += amount;
        p.stats.rentPaid += amount;
      }
    }
  }

  /** Tagih sekarang bila cukup; jika tidak, catat sebagai utang (fase debt). */
  private charge(s: GameState, debtor: string, creditor: Creditor, amount: number, reason: string, isRent = false) {
    if (amount <= 0) return;
    const p = this.player(s, debtor);
    const owed = this.debtOf(s, debtor);
    if (p.money - owed >= amount) this.transfer(s, debtor, creditor, amount, isRent);
    else {
      s.debts.push({ debtor, creditor, amount, reason: isRent ? `rent|${reason}` : reason });
      this.log(s, `${p.name} kekurangan uang untuk membayar ${fmt(amount)}. Jual/gadai aset atau bangkrut.`);
    }
  }

  private payDebtsOf(s: GameState, p: PlayerState) {
    for (const d of s.debts.filter((x) => x.debtor === p.id)) {
      this.transfer(s, p.id, d.creditor, d.amount, d.reason.startsWith('rent|'));
    }
    s.debts = s.debts.filter((x) => x.debtor !== p.id);
    this.log(s, `${p.name} melunasi utangnya.`);
  }

  private goBankrupt(s: GameState, p: PlayerState, ctx: Ctx, ev: GameEvent[], left = false) {
    const myDebts = s.debts.filter((d) => d.debtor === p.id);
    const creditors = [...new Set(myDebts.map((d) => d.creditor))];
    const toPlayer = creditors.length === 1 && creditors[0] !== 'bank' && creditors[0] !== 'pot' ? creditors[0] : null;
    // Jual semua bangunan ke bank dulu.
    for (const i of this.ownedTiles(s, p.id)) {
      const o = s.props[i];
      if (o.houses > 0) {
        p.money += this.buildingSellValue(i) * o.houses;
        if (o.houses === 5) s.bankHotels += 1;
        else s.bankHouses += o.houses;
        o.houses = 0;
      }
    }
    s.debts = s.debts.filter((d) => d.debtor !== p.id);
    // Utang orang lain ke pemain ini dialihkan ke bank (dihapus).
    s.debts = s.debts.filter((d) => d.creditor !== p.id);
    s.trades = s.trades.filter((t) => t.from !== p.id && t.to !== p.id);
    if (s.auction?.highBidder === p.id) {
      s.auction.highBidder = null;
      s.auction.highBid = 0;
    }
    const tiles = this.ownedTiles(s, p.id);
    if (toPlayer) {
      const r = this.player(s, toPlayer);
      r.money += Math.max(0, p.money);
      for (const i of tiles) s.props[i].owner = r.id;
      r.jailFreeCards.push(...p.jailFreeCards);
      this.log(s, `${p.name} BANGKRUT! Semua aset pindah ke ${r.name}.`);
    } else {
      for (const i of tiles) s.props[i] = { owner: null, houses: 0, mortgaged: false };
      for (const c of p.jailFreeCards) s.decks[c.deck].push(c.id);
      if (s.settings.auction) s.auctionQueue.push(...tiles);
      this.log(s, `${p.name} BANGKRUT ke bank!${tiles.length && s.settings.auction ? ' Propertinya akan dilelang ulang.' : ''}`);
    }
    p.money = 0;
    p.jailFreeCards = [];
    p.bankrupt = true;
    p.bankruptAt = ctx.now;
    p.inJail = false;
    p.expression = 'sedih';
    ev.push({ t: 'sfx', name: 'bankrupt' });
    if (this.current(s).id === p.id) {
      s.resume = null;
      s.rollAgain = false;
      s.pendingBuy = null;
    }
    if (this.alive(s).length <= 1) this.endGame(s, left ? 'left' : 'last');
  }

  // ---------------------------------------------------------------- lelang

  private startAuction(s: GameState, tile: number, ctx: Ctx) {
    s.auction = { tile, highBid: 0, highBidder: null, endsAt: ctx.now + this.theme.auction.timeoutSec * 1000 };
    s.stage = 'auction';
    s.turnDeadline = s.auction.endsAt;
    this.log(s, `Lelang ${this.tile(tile).name} dimulai! Tawaran mulai ${fmt(this.theme.auction.minBid)}.`);
  }

  /** Dipanggil server secara berkala; menutup lelang yang waktunya habis. */
  tick(s: GameState, ctx: Ctx): GameEvent[] {
    const ev: GameEvent[] = [];
    if (s.stage === 'auction' && s.auction && ctx.now >= s.auction.endsAt) {
      this.closeAuction(s, s.auction, ev);
      s.auction = null;
      this.settle(s, ctx, ev);
    }
    return ev;
  }

  private closeAuction(s: GameState, a: Auction, ev: GameEvent[]) {
    const t = this.tile(a.tile);
    if (a.highBidder) {
      const w = this.player(s, a.highBidder);
      if (w.money >= a.highBid) {
        w.money -= a.highBid;
        s.props[a.tile].owner = w.id;
        w.stats.bought += 1;
        w.expression = 'senang';
        this.log(s, `${w.name} memenangkan lelang ${t.name} seharga ${fmt(a.highBid)}.`);
        ev.push({ t: 'sfx', name: 'buy' });
        return;
      }
    }
    this.log(s, `Lelang ${t.name} selesai tanpa pemenang.`);
  }

  // ---------------------------------------------------------------- bangunan & hipotek

  private noAuction(s: GameState) {
    if (s.stage === 'auction') fail('Tunggu lelang selesai');
  }

  canBuild(s: GameState, pid: string, i: number): string | null {
    const t = this.tile(i);
    const o = s.props[i];
    if (t.type !== 'city') return 'Hanya kota yang bisa dibangun';
    if (o.owner !== pid) return 'Bukan propertimu';
    if (!this.ownsGroup(s, pid, t.group!)) return 'Harus punya satu grup warna lengkap';
    const g = this.groupTiles(t.group!);
    if (g.some((x) => s.props[x].mortgaged)) return 'Ada properti tergadai di grup ini';
    if (o.houses >= 5) return 'Sudah ada hotel';
    if (o.houses > Math.min(...g.map((x) => s.props[x].houses))) return 'Bangun merata dulu di grup ini';
    if (o.houses === 4 && s.bankHotels <= 0) return 'Stok hotel bank habis';
    if (o.houses < 4 && s.bankHouses <= 0) return 'Stok rumah bank habis';
    if (this.player(s, pid).money < t.houseCost!) return 'Uang tidak cukup';
    return null;
  }

  canSell(s: GameState, pid: string, i: number): string | null {
    const t = this.tile(i);
    const o = s.props[i];
    if (t.type !== 'city' || o.owner !== pid) return 'Bukan propertimu';
    if (o.houses === 0) return 'Tidak ada bangunan';
    const g = this.groupTiles(t.group!);
    if (o.houses < Math.max(...g.map((x) => s.props[x].houses))) return 'Jual merata dulu di grup ini';
    if (o.houses === 5 && s.bankHouses < 4) return 'Stok rumah bank kurang untuk memecah hotel';
    return null;
  }

  private build(s: GameState, p: PlayerState, i: number, ev: GameEvent[]) {
    this.noAuction(s);
    const err = this.canBuild(s, p.id, i);
    if (err) fail(err);
    const t = this.tile(i);
    const o = s.props[i];
    p.money -= t.houseCost!;
    if (o.houses === 4) {
      s.bankHotels -= 1;
      s.bankHouses += 4;
    } else s.bankHouses -= 1;
    o.houses += 1;
    this.log(s, `${p.name} membangun ${o.houses === 5 ? 'hotel' : 'rumah'} di ${t.name}.`);
    ev.push({ t: 'sfx', name: 'build' });
  }

  private sellBuilding(s: GameState, p: PlayerState, i: number, ev: GameEvent[]) {
    this.noAuction(s);
    const err = this.canSell(s, p.id, i);
    if (err) fail(err);
    const o = s.props[i];
    if (o.houses === 5) {
      s.bankHotels += 1;
      s.bankHouses -= 4;
    } else s.bankHouses += 1;
    o.houses -= 1;
    p.money += this.buildingSellValue(i);
    this.log(s, `${p.name} menjual bangunan di ${this.tile(i).name} (+${fmt(this.buildingSellValue(i))}).`);
    ev.push({ t: 'sfx', name: 'coin' });
  }

  canMortgage(s: GameState, pid: string, i: number): string | null {
    const o = s.props[i];
    if (!o || o.owner !== pid) return 'Bukan propertimu';
    if (o.mortgaged) return 'Sudah digadaikan';
    const t = this.tile(i);
    if (t.type === 'city' && this.groupTiles(t.group!).some((x) => s.props[x].houses > 0))
      return 'Jual semua bangunan di grup ini dulu';
    return null;
  }

  private mortgage(s: GameState, p: PlayerState, i: number) {
    this.noAuction(s);
    const err = this.canMortgage(s, p.id, i);
    if (err) fail(err);
    s.props[i].mortgaged = true;
    p.money += this.mortgageValue(i);
    this.log(s, `${p.name} menggadaikan ${this.tile(i).name} (+${fmt(this.mortgageValue(i))}).`);
  }

  private unmortgage(s: GameState, p: PlayerState, i: number) {
    this.noAuction(s);
    const o = s.props[i];
    if (!o || o.owner !== p.id) fail('Bukan propertimu');
    if (!o.mortgaged) fail('Properti tidak tergadai');
    const cost = this.unmortgageCost(i);
    if (p.money - this.debtOf(s, p.id) < cost) fail('Uang tidak cukup');
    p.money -= cost;
    o.mortgaged = false;
    this.log(s, `${p.name} menebus ${this.tile(i).name} (${fmt(cost)}).`);
  }

  // ---------------------------------------------------------------- tukar-menukar

  private validateOffer(s: GameState, pid: string, o: Offer, checkMoney: boolean) {
    const p = this.player(s, pid);
    if (!Number.isInteger(o.money) || o.money < 0) fail('Nominal uang tidak valid');
    if (checkMoney && o.money > p.money) fail(`Uang ${p.name} tidak cukup`);
    if (!Number.isInteger(o.jailCards) || o.jailCards < 0 || o.jailCards > p.jailFreeCards.length)
      fail(`${p.name} tidak punya kartu Bebas Penjara sebanyak itu`);
    if (!Array.isArray(o.tiles) || new Set(o.tiles).size !== o.tiles.length) fail('Daftar properti tidak valid');
    for (const i of o.tiles) {
      if (!s.props[i] || s.props[i].owner !== pid) fail(`${this.tile(i)?.name ?? i} bukan milik ${p.name}`);
      const t = this.tile(i);
      if (t.type === 'city' && this.groupTiles(t.group!).some((x) => s.props[x].houses > 0))
        fail(`Jual bangunan di grup ${t.name} dulu sebelum ditukar`);
    }
  }

  private proposeTrade(s: GameState, p: PlayerState, to: string, give: Offer, get: Offer) {
    this.noAuction(s);
    const r = this.player(s, to);
    if (r.bankrupt || r.id === p.id) fail('Pemain tujuan tidak valid');
    give = normOffer(give);
    get = normOffer(get);
    if (!give.money && !give.tiles.length && !give.jailCards && !get.money && !get.tiles.length && !get.jailCards)
      fail('Tawaran kosong');
    this.validateOffer(s, p.id, give, true);
    this.validateOffer(s, r.id, get, false);
    if (s.trades.filter((t) => t.from === p.id).length >= 3) fail('Maksimal 3 tawaran aktif');
    s.trades.push({ id: s.nextTradeId++, from: p.id, to: r.id, give, get });
    this.log(s, `${p.name} menawarkan tukar-menukar ke ${r.name}.`);
  }

  private respondTrade(s: GameState, p: PlayerState, id: number, accept: boolean, ev: GameEvent[]) {
    const t = s.trades.find((x) => x.id === id);
    if (!t || t.to !== p.id) fail('Tawaran tidak ditemukan');
    const from = this.player(s, t.from);
    if (!accept) {
      s.trades = s.trades.filter((x) => x.id !== id);
      this.log(s, `${p.name} menolak tawaran ${from.name}.`);
      return;
    }
    this.noAuction(s);
    this.validateOffer(s, from.id, t.give, true);
    this.validateOffer(s, p.id, t.get, true);
    const move = (a: PlayerState, b: PlayerState, o: Offer) => {
      a.money -= o.money;
      b.money += o.money;
      for (const i of o.tiles) s.props[i].owner = b.id;
      for (let k = 0; k < o.jailCards; k++) b.jailFreeCards.push(a.jailFreeCards.pop()!);
    };
    move(from, p, t.give);
    move(p, from, t.get);
    s.trades = s.trades.filter((x) => x.id !== id);
    this.log(s, `${p.name} menerima tawaran tukar-menukar dari ${from.name}.`);
    ev.push({ t: 'sfx', name: 'buy' });
  }

  // ---------------------------------------------------------------- otomatis

  /**
   * Aksi otomatis saat waktu giliran habis atau pemain terputus.
   * `skip` = pemain terputus: gilirannya dilewati tanpa membeli apa pun.
   */
  autoAct(s: GameState, ctx: Ctx, skip = false): GameEvent[] {
    const ev: GameEvent[] = [];
    const cur = this.current(s);
    switch (s.stage) {
      case 'roll':
        if (skip) {
          this.log(s, `${cur.name} terputus, giliran dilewati.`);
          this.nextTurn(s, ctx);
        } else this.roll(s, cur, ctx, ev);
        break;
      case 'buy':
        this.dispatch(s, cur, { type: 'decline' }, ctx, ev);
        break;
      case 'end':
        this.nextTurn(s, ctx);
        break;
      case 'debt':
        for (const id of [...new Set(s.debts.map((d) => d.debtor))]) {
          const p = this.player(s, id);
          this.autoLiquidate(s, p, ctx, ev);
        }
        this.settle(s, ctx, ev);
        break;
      default:
        break;
    }
    return ev;
  }

  /** Jual bangunan & gadaikan otomatis sampai utang lunas; jika tidak cukup, bangkrut. */
  autoLiquidate(s: GameState, p: PlayerState, ctx: Ctx, ev: GameEvent[]) {
    const need = () => this.debtOf(s, p.id) - p.money;
    if (this.liquidationValue(s, p.id) < this.debtOf(s, p.id)) return this.goBankrupt(s, p, ctx, ev);
    const tiles = this.ownedTiles(s, p.id).sort((a, b) => (this.tile(a).price ?? 0) - (this.tile(b).price ?? 0));
    for (let guard = 0; guard < 200 && need() > 0; guard++) {
      const sellable = tiles.find((i) => this.canSell(s, p.id, i) === null);
      if (sellable !== undefined) {
        this.sellBuilding(s, p, sellable, ev);
        continue;
      }
      const m = tiles.find((i) => this.canMortgage(s, p.id, i) === null);
      if (m !== undefined) {
        this.mortgage(s, p, m);
        continue;
      }
      break;
    }
    if (need() > 0) return this.goBankrupt(s, p, ctx, ev);
    this.payDebtsOf(s, p);
  }

  /** Pemain keluar / tidak kembali setelah batas reconnect: dianggap bangkrut ke bank. */
  forfeit(s: GameState, playerId: string, ctx: Ctx): GameEvent[] {
    const ev: GameEvent[] = [];
    const p = this.player(s, playerId);
    if (p.bankrupt || s.stage === 'gameover') return ev;
    s.debts = s.debts.map((d) => (d.debtor === p.id ? { ...d, creditor: 'bank' } : d));
    this.log(s, `${p.name} meninggalkan permainan.`);
    this.goBankrupt(s, p, ctx, ev, true);
    const stage = s.stage as GameState['stage'];
    if (stage === 'gameover' || (stage === 'auction' && s.auction)) return ev;
    this.settle(s, ctx, ev);
    return ev;
  }

  /** Salinan state yang aman dikirim ke klien (urutan dek disembunyikan). */
  publicView(s: GameState): Omit<GameState, 'decks'> & { deckSizes: { chance: number; community: number } } {
    const { decks, ...rest } = s;
    return { ...rest, deckSizes: { chance: decks.chance.length, community: decks.community.length } };
  }
}

function normOffer(o: Offer | undefined): Offer {
  return {
    money: Math.floor(Number(o?.money ?? 0)) || 0,
    tiles: Array.isArray(o?.tiles) ? o!.tiles.map(Number) : [],
    jailCards: Math.floor(Number(o?.jailCards ?? 0)) || 0,
  };
}

export function shuffle<T>(arr: T[], rng: { int(n: number): number }): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type PublicGameState = ReturnType<Engine['publicView']>;
