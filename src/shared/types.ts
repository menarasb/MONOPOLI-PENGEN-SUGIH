// Tipe data bersama klien & server.

export type TileType =
  | 'go'
  | 'city'
  | 'transport'
  | 'utility'
  | 'tax'
  | 'chance'
  | 'community'
  | 'jail'
  | 'parking'
  | 'gotojail';

export interface Tile {
  index: number;
  type: TileType;
  name: string;
  icon?: string;
  group?: string;
  price?: number;
  /** [dasar, 1 rumah, 2 rumah, 3 rumah, 4 rumah, hotel] */
  rent?: number[];
  houseCost?: number;
  amount?: number;
  /** [bujur, lintang] untuk peta di tengah papan */
  geo?: [number, number];
  /** Teks pendek di papan (maks ~8 huruf per baris) */
  label?: string[];
}

export interface Group {
  id: string;
  name: string;
  color: string;
  /** Huruf penanda untuk pengguna buta warna */
  letter: string;
}

export type DeckName = 'chance' | 'community';

export interface Card {
  id: string;
  text: string;
  effect: string;
}

export interface Theme {
  id: string;
  name: string;
  currency: { prefix: string; suffix: string; note: string };
  startMoneyOptions: number[];
  salary: number;
  jailIndex: number;
  jailFine: number;
  maxJailTurns: number;
  transportRents: number[];
  utilityMultipliers: [number, number];
  utilityScale: number;
  bank: { houses: number; hotels: number };
  auction: { minBid: number; timeoutSec: number };
  mortgageRate: number;
  mortgageInterest: number;
  buildingSellRate: number;
  groups: Group[];
  tiles: Tile[];
  cards: { chance: Card[]; community: Card[] };
}

export interface CharacterParts {
  face: 'oval' | 'bulat' | 'kotak';
  skin: number;
  hair: 'pendek' | 'belah' | 'klimis' | 'ikal' | 'botak' | 'panjang' | 'bob';
  hairColor: number;
  headwear: 'none' | 'peci' | 'kerudung' | 'topi';
  glasses: boolean;
  mustache: boolean;
  shirt: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  pack: string;
  parts: CharacterParts;
}

/** Karakter yang dipakai pemain: bawaan (id) atau custom (parts). */
export interface CharacterChoice {
  id: string; // id bawaan atau 'custom:<playerId>'
  name: string;
  parts: CharacterParts;
  custom: boolean;
}

export interface RoomSettings {
  maxPlayers: number; // 2..4
  startMoney: number; // 10000 | 15000 | 20000
  auction: boolean;
  freeParkingJackpot: boolean;
  doubleSalaryOnGo: boolean;
  gameTimeLimitMin: number; // 0 = tanpa batas, 30 | 60 | 90
  turnTimeSec: number; // 30 | 60 | 90
}

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 4,
  startMoney: 15000,
  auction: true,
  freeParkingJackpot: false,
  doubleSalaryOnGo: false,
  gameTimeLimitMin: 0,
  turnTimeSec: 60,
};

export interface JailCard {
  deck: DeckName;
  id: string;
}

export interface PlayerStats {
  rentPaid: number;
  rentReceived: number;
  bought: number;
  jailed: number;
  doubles: number;
  passedGo: number;
}

export type Expression = 'normal' | 'senang' | 'sedih' | 'kaget';

export interface PlayerState {
  id: string;
  name: string;
  character: CharacterChoice;
  money: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailFreeCards: JailCard[];
  bankrupt: boolean;
  bankruptAt: number | null;
  expression: Expression;
  stats: PlayerStats;
}

export interface Ownership {
  owner: string | null;
  /** 0-4 rumah, 5 = hotel */
  houses: number;
  mortgaged: boolean;
}

/** Penerima pembayaran: id pemain, bank, atau pot Parkir Bebas. */
export type Creditor = string | 'bank' | 'pot';

export interface Debt {
  debtor: string;
  creditor: Creditor;
  amount: number;
  reason: string;
}

export interface Auction {
  tile: number;
  highBid: number;
  highBidder: string | null;
  endsAt: number;
}

export interface Offer {
  money: number;
  tiles: number[];
  jailCards: number;
}

export interface Trade {
  id: number;
  from: string;
  to: string;
  give: Offer; // dari pengusul ke penerima
  get: Offer; // dari penerima ke pengusul
}

export type Stage = 'roll' | 'buy' | 'auction' | 'debt' | 'end' | 'gameover';

export type Resume = { kind: 'move'; steps: number } | null;

export interface LogEntry {
  n: number;
  text: string;
}

export interface GameState {
  themeId: string;
  settings: RoomSettings;
  players: PlayerState[];
  turnIndex: number;
  turnNo: number;
  stage: Stage;
  props: Record<number, Ownership>;
  bankHouses: number;
  bankHotels: number;
  /** Urutan id kartu; rahasia, tidak dikirim ke klien. */
  decks: { chance: string[]; community: string[] };
  dice: [number, number] | null;
  doublesCount: number;
  rollAgain: boolean;
  pendingBuy: number | null;
  debts: Debt[];
  resume: Resume;
  auction: Auction | null;
  auctionQueue: number[];
  trades: Trade[];
  nextTradeId: number;
  pot: number;
  lastCard: { deck: DeckName; id: string; text: string; player: string } | null;
  startedAt: number;
  endsAt: number | null;
  turnDeadline: number;
  winner: string | null;
  ranking: string[];
  log: LogEntry[];
  logN: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'payJail' }
  | { type: 'useJailCard' }
  | { type: 'buy' }
  | { type: 'decline' }
  | { type: 'bid'; amount: number }
  | { type: 'build'; tile: number }
  | { type: 'sell'; tile: number }
  | { type: 'mortgage'; tile: number }
  | { type: 'unmortgage'; tile: number }
  | { type: 'payDebt' }
  | { type: 'bankrupt' }
  | { type: 'endTurn' }
  | { type: 'proposeTrade'; to: string; give: Offer; get: Offer }
  | { type: 'respondTrade'; id: number; accept: boolean }
  | { type: 'cancelTrade'; id: number };

/** Kejadian untuk animasi & suara di klien. */
export type GameEvent =
  | { t: 'dice'; player: string; dice: [number, number] }
  | { t: 'move'; player: string; from: number; to: number; steps: number; direct: boolean }
  | { t: 'card'; player: string; deck: DeckName; text: string }
  | { t: 'sfx'; name: SfxName }
  | { t: 'toast'; text: string };

export type SfxName =
  | 'dice'
  | 'step'
  | 'buy'
  | 'rent'
  | 'jail'
  | 'bankrupt'
  | 'card'
  | 'build'
  | 'coin'
  | 'win'
  | 'bid';

export interface Rng {
  /** Bilangan bulat acak 0..n-1 */
  int(n: number): number;
}

export interface Ctx {
  rng: Rng;
  now: number;
}

export type ActionResult = { ok: true; events: GameEvent[] } | { ok: false; error: string };
