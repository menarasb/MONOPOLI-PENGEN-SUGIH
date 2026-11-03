// Papan 480x480 (logis) digambar ke kanvas 960x960 lalu diskalakan dengan image-rendering: pixelated.
import type { PublicGameState } from '../shared/engine';
import type { GameEvent, Theme } from '../shared/types';
import { audio } from './audio';
import { building, drawDie, head, icon, PAL, shiftColor } from './sprites';

const L = 480;
const C = 51; // sudut
const T = 42; // petak
const S = 2; // skala internal
const FONT = '"Press Start 2P", monospace';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  side: 'bottom' | 'left' | 'top' | 'right' | 'corner';
}

export function tileRect(i: number): Rect {
  if (i === 0) return { x: L - C, y: L - C, w: C, h: C, side: 'corner' };
  if (i < 10) return { x: L - C - i * T, y: L - C, w: T, h: C, side: 'bottom' };
  if (i === 10) return { x: 0, y: L - C, w: C, h: C, side: 'corner' };
  if (i < 20) return { x: 0, y: L - C - (i - 10) * T, w: C, h: T, side: 'left' };
  if (i === 20) return { x: 0, y: 0, w: C, h: C, side: 'corner' };
  if (i < 30) return { x: C + (i - 21) * T, y: 0, w: T, h: C, side: 'top' };
  if (i === 30) return { x: L - C, y: 0, w: C, h: C, side: 'corner' };
  return { x: L - C, y: C + (i - 31) * T, w: C, h: T, side: 'right' };
}

// Garis pantai kasar Indonesia (bujur, lintang) untuk peta pixel di tengah papan.
const ISLANDS: [number, number][][] = [
  // Sumatra
  [[95.3, 5.6], [97.5, 5.2], [100.3, 2.5], [103.8, 1.0], [104.5, -1.5], [106.0, -3.2], [105.8, -5.8], [104.6, -5.9], [102.3, -4.0], [100.4, -1.0], [98.6, 1.7], [96.0, 3.8]],
  // Jawa
  [[105.2, -6.8], [106.0, -5.9], [108.3, -6.2], [110.4, -6.7], [112.6, -6.8], [114.4, -7.6], [114.6, -8.7], [111.0, -8.3], [108.0, -7.9], [106.4, -7.4]],
  // Bali
  [[114.4, -8.1], [115.7, -8.3], [115.4, -8.85], [114.5, -8.5]],
  // Lombok-Sumbawa
  [[116.0, -8.2], [117.0, -8.1], [119.0, -8.1], [119.1, -8.8], [116.0, -8.95]],
  // Flores
  [[119.8, -8.3], [123.0, -8.1], [123.0, -8.7], [119.9, -8.9]],
  // Sumba
  [[119.0, -9.4], [120.8, -9.6], [120.6, -10.3], [119.0, -9.8]],
  // Timor
  [[123.4, -10.4], [124.4, -10.2], [127.2, -8.3], [125.2, -8.6], [123.6, -9.9]],
  // Kalimantan
  [[109.0, 1.8], [109.6, 1.9], [111.0, 1.5], [113.5, 3.3], [115.5, 4.9], [116.7, 7.0], [117.9, 6.0], [119.2, 5.0], [118.0, 2.3], [118.9, 1.0], [117.9, 0.8], [117.5, -0.8], [116.5, -2.5], [116.4, -3.9], [114.5, -4.1], [113.0, -3.2], [111.7, -3.0], [110.2, -2.9], [109.6, -1.3], [109.0, 0.4]],
  // Papua
  [[131.0, -1.3], [132.5, -0.4], [134.1, -0.9], [135.0, -3.3], [137.8, -1.5], [141.0, -2.6], [141.0, -9.1], [139.0, -8.1], [137.7, -8.4], [138.0, -6.5], [135.0, -4.4], [132.9, -4.1], [132.0, -2.9], [133.6, -2.5], [132.0, -2.2]],
];
// Pulau tipis digambar sebagai garis tebal: [titik..., tebal derajat]
const STROKES: { pts: [number, number][]; w: number }[] = [
  { pts: [[120.0, 0.6], [123.0, 0.7], [125.0, 1.5]], w: 0.9 }, // Sulawesi utara
  { pts: [[119.9, -0.3], [119.5, -2.5], [119.6, -5.5]], w: 1.4 }, // Sulawesi badan
  { pts: [[120.5, -1.2], [123.3, -0.9]], w: 0.8 }, // lengan timur
  { pts: [[120.8, -2.3], [122.0, -3.6], [122.6, -5.0]], w: 0.9 }, // lengan tenggara
  { pts: [[127.6, 1.9], [127.9, -0.6]], w: 0.8 }, // Halmahera
  { pts: [[128.0, -3.2], [130.8, -3.4]], w: 0.6 }, // Seram
  { pts: [[126.0, -3.2], [127.2, -3.5]], w: 0.6 }, // Buru
  { pts: [[105.6, -2.0], [106.6, -3.0]], w: 0.8 }, // Bangka
];

const MAP = { x0: C + 12, y0: 112, w: L - 2 * C - 24, lon0: 94.5, lon1: 141.5, lat0: 7.5, lat1: -11 };
const CELL = 3; // ukuran pixel peta (logis)

function project(lon: number, lat: number): [number, number] {
  return [
    MAP.x0 + ((lon - MAP.lon0) / (MAP.lon1 - MAP.lon0)) * MAP.w,
    MAP.y0 + ((lat - MAP.lat0) / (MAP.lat1 - MAP.lat0)) * (MAP.w * ((MAP.lat0 - MAP.lat1) / (MAP.lon1 - MAP.lon0))),
  ];
}

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSeg(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

let landCache: boolean[][] | null = null;
function landGrid(): boolean[][] {
  if (landCache) return landCache;
  const cols = Math.floor(MAP.w / CELL);
  const rows = Math.floor((MAP.w * ((MAP.lat0 - MAP.lat1) / (MAP.lon1 - MAP.lon0))) / CELL);
  const g: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    g.push([]);
    for (let c = 0; c < cols; c++) {
      const lon = MAP.lon0 + ((c + 0.5) / cols) * (MAP.lon1 - MAP.lon0);
      const lat = MAP.lat0 + ((r + 0.5) / rows) * (MAP.lat1 - MAP.lat0);
      let land = ISLANDS.some((p) => pointInPoly(lon, lat, p));
      if (!land)
        land = STROKES.some((s) => s.pts.slice(1).some((b, k) => distToSeg(lon, lat, s.pts[k], b) <= s.w / 2));
      g[r].push(land);
    }
  }
  landCache = g;
  return g;
}

interface TokenAnim {
  from: [number, number];
  to: [number, number];
  t0: number;
  dur: number;
  jump: boolean;
}

export class BoardView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private theme: Theme;
  private state: PublicGameState | null = null;
  private staticLayer: HTMLCanvasElement;
  private staticKey = '';
  private displayPos = new Map<string, number>();
  private anims = new Map<string, TokenAnim>();
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private dice: { vals: [number, number]; rolling: number } | null = null;
  colors = new Map<string, string>();
  highlight: number | null = null;
  onTile: (i: number) => void = () => {};
  onCard: (deck: string, text: string) => Promise<void> = async () => {};

  constructor(theme: Theme) {
    this.theme = theme;
    this.canvas = document.createElement('canvas');
    this.canvas.width = L * S;
    this.canvas.height = L * S;
    this.canvas.className = 'board pixel';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.staticLayer = document.createElement('canvas');
    this.staticLayer.width = L * S;
    this.staticLayer.height = L * S;
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * L;
      const y = ((e.clientY - r.top) / r.height) * L;
      for (let i = 0; i < 40; i++) {
        const t = tileRect(i);
        if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return this.onTile(i);
      }
    });
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    document.fonts?.ready.then(() => (this.staticKey = ''));
  }

  setState(s: PublicGameState, events: GameEvent[]) {
    this.state = s;
    for (const ev of events) {
      if (ev.t === 'dice') this.queue.push(() => this.animDice(ev.dice));
      else if (ev.t === 'move') this.queue.push(() => this.animMove(ev.player, ev.from, ev.steps, ev.to, ev.direct));
      else if (ev.t === 'card') this.queue.push(() => this.onCard(ev.deck, ev.text));
      else if (ev.t === 'sfx' && ev.name !== 'dice') {
        const n = ev.name;
        this.queue.push(async () => audio.play(n));
      }
    }
    this.queue.push(async () => this.sync());
    if (!this.running) void this.run();
  }

  /** true bila animasi masih berjalan (UI bisa menunda pop-up). */
  get busy() {
    return this.running;
  }

  private async run() {
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift()!;
      try {
        await job();
      } catch (e) {
        console.error(e);
      }
    }
    this.running = false;
  }

  private sync() {
    if (!this.state) return;
    for (const p of this.state.players) this.displayPos.set(p.id, p.position);
  }

  private wait(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  private async animDice(vals: [number, number]) {
    audio.play('dice');
    // 8 frame lempar, hasil ditentukan server
    for (let f = 0; f < 8; f++) {
      this.dice = { vals: [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)], rolling: f };
      await this.wait(55);
    }
    this.dice = { vals, rolling: -1 };
    await this.wait(200);
  }

  private async animMove(pid: string, from: number, steps: number, to: number, direct: boolean) {
    if (!this.displayPos.has(pid)) this.displayPos.set(pid, from);
    if (direct || steps === 0) {
      const a = this.slotXY(pid, this.displayPos.get(pid)!);
      this.displayPos.set(pid, to);
      const b = this.slotXY(pid, to);
      this.anims.set(pid, { from: a, to: b, t0: performance.now(), dur: 450, jump: false });
      await this.wait(470);
      this.anims.delete(pid);
      return;
    }
    const dir = Math.sign(steps);
    let cur = from;
    const n = Math.abs(steps);
    const per = n > 12 ? 90 : 150;
    for (let k = 0; k < n; k++) {
      const next = (cur + dir + 40) % 40;
      const a = this.slotXY(pid, cur);
      this.displayPos.set(pid, next);
      const b = this.slotXY(pid, next);
      this.anims.set(pid, { from: a, to: b, t0: performance.now(), dur: per, jump: true });
      audio.play('step');
      await this.wait(per);
      cur = next;
    }
    this.anims.delete(pid);
  }

  /** Posisi (logis) bidak di petak, dengan slot 2x2 untuk beberapa pemain. */
  private slotXY(pid: string, tile: number): [number, number] {
    const r = tileRect(tile);
    const s = this.state;
    const ids = s ? s.players.filter((p) => !p.bankrupt).map((p) => p.id) : [pid];
    const idx = Math.max(0, ids.indexOf(pid));
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const off: [number, number][] = [[-10, -9], [10, -9], [-10, 10], [10, 10]];
    return [cx + off[idx % 4][0], cy + off[idx % 4][1] + (r.side === 'corner' ? 0 : 2)];
  }

  // ---------------------------------------------------------------- menggambar

  private text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, size = 8, color = PAL.k, align: CanvasTextAlign = 'center') {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(str, Math.round(x), Math.round(y));
  }

  private buildStatic() {
    const s = this.state;
    const key = JSON.stringify([s?.props, [...this.colors.entries()], s?.pot, s?.settings.freeParkingJackpot]);
    if (key === this.staticKey) return;
    this.staticKey = key;
    const ctx = this.staticLayer.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    // latar
    ctx.fillStyle = '#2f6b3a';
    ctx.fillRect(0, 0, L * S, L * S);
    // tengah: laut
    ctx.fillStyle = '#2b5f8f';
    ctx.fillRect(C * S, C * S, (L - 2 * C) * S, (L - 2 * C) * S);
    // pola ombak
    ctx.fillStyle = '#336ea3';
    for (let y = C + 4; y < L - C; y += 10)
      for (let x = C + ((y / 10) % 2) * 6; x < L - C - 4; x += 12) ctx.fillRect(x * S, y * S, 4 * S, S);
    this.drawMap(ctx);
    this.drawCenter(ctx);
    for (let i = 0; i < 40; i++) this.drawTile(ctx, i);
    ctx.restore();
  }

  private drawMap(ctx: CanvasRenderingContext2D) {
    const g = landGrid();
    for (let r = 0; r < g.length; r++)
      for (let c = 0; c < g[r].length; c++) {
        if (!g[r][c]) continue;
        const edge = !g[r - 1]?.[c] || !g[r + 1]?.[c] || !g[r][c - 1] || !g[r][c + 1];
        ctx.fillStyle = edge ? '#e9d8a6' : (r + c) % 7 === 0 ? '#3c8f45' : '#4caf50';
        ctx.fillRect((MAP.x0 + c * CELL) * S, (MAP.y0 + r * CELL) * S, CELL * S, CELL * S);
      }
    // titik kota: menyala dengan warna pemilik
    for (const t of this.theme.tiles) {
      if (!t.geo) continue;
      const [x, y] = project(t.geo[0], t.geo[1]);
      const owner = this.state?.props[t.index]?.owner;
      const col = owner ? this.colors.get(owner) ?? '#fff' : '#2a1a12';
      if (owner) {
        ctx.fillStyle = shiftColor(col, 80) + '';
        ctx.globalAlpha = 0.5;
        ctx.fillRect((x - 4) * S, (y - 4) * S, 8 * S, 8 * S);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = PAL.k;
      ctx.fillRect((x - 2) * S, (y - 2) * S, 4 * S, 4 * S);
      ctx.fillStyle = owner ? col : '#fff8e7';
      ctx.fillRect((x - 1) * S, (y - 1) * S, 2 * S, 2 * S);
    }
  }

  private drawCenter(ctx: CanvasRenderingContext2D) {
    const cx = (L / 2) * S;
    // judul
    this.text(ctx, 'MONOPOLI', cx + 2 * S, (C + 16) * S + 2 * S, 24, PAL.k);
    this.text(ctx, 'MONOPOLI', cx, (C + 16) * S, 24, '#f4d03f');
    this.text(ctx, 'Pengen Sugih', cx + S, (C + 34) * S + S, 16, PAL.k);
    this.text(ctx, 'Pengen Sugih', cx, (C + 34) * S, 16, '#fff8e7');
    // tumpukan kartu
    const cardW = 72;
    const cardH = 44;
    const yC = L - C - cardH - 18;
    const decks: [string, string, number][] = [
      ['KESEMPATAN', '#e67e22', C + 30],
      ['DANA UMUM', '#f4d03f', L - C - 30 - cardW],
    ];
    for (const [label, col, x] of decks) {
      ctx.fillStyle = PAL.k;
      ctx.fillRect((x + 3) * S, (yC + 3) * S, cardW * S, cardH * S);
      ctx.fillStyle = col;
      ctx.fillRect(x * S, yC * S, cardW * S, cardH * S);
      ctx.strokeStyle = PAL.k;
      ctx.lineWidth = S;
      ctx.strokeRect(x * S + 1, yC * S + 1, cardW * S - 2, cardH * S - 2);
      ctx.drawImage(icon(label === 'KESEMPATAN' ? 'kesempatan' : 'danaumum'), (x + cardW / 2 - 8) * S, (yC + 6) * S, 16 * S, 16 * S);
      this.text(ctx, label, (x + cardW / 2) * S, (yC + 28) * S, 8);
    }
    if (this.state?.settings.freeParkingJackpot) {
      this.text(ctx, `Pot: Rp${(this.state.pot ?? 0).toLocaleString('id-ID')}rb`, cx, (yC - 14) * S, 8, '#fff8e7');
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, i: number) {
    const t = this.theme.tiles[i];
    const r = tileRect(i);
    const X = r.x * S;
    const Y = r.y * S;
    const W = r.w * S;
    const H = r.h * S;
    ctx.fillStyle = PAL.c;
    ctx.fillRect(X, Y, W, H);
    ctx.strokeStyle = PAL.k;
    ctx.lineWidth = S;
    ctx.strokeRect(X + 1, Y + 1, W - 2, H - 2);
    const o = this.state?.props[i];
    const group = t.group ? this.theme.groups.find((g) => g.id === t.group) : undefined;

    // pita warna grup di sisi dalam + huruf penanda
    const strip = 11;
    let content = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (group && r.side !== 'corner') {
      let sx = r.x, sy = r.y, sw = r.w, sh = r.h;
      if (r.side === 'bottom') { sh = strip; content = { x: r.x, y: r.y + strip, w: r.w, h: r.h - strip }; }
      if (r.side === 'top') { sy = r.y + r.h - strip; sh = strip; content = { x: r.x, y: r.y, w: r.w, h: r.h - strip }; }
      if (r.side === 'left') { sx = r.x + r.w - strip; sw = strip; content = { x: r.x, y: r.y, w: r.w - strip, h: r.h }; }
      if (r.side === 'right') { sw = strip; content = { x: r.x + strip, y: r.y, w: r.w - strip, h: r.h }; }
      ctx.fillStyle = group.color;
      ctx.fillRect(sx * S, sy * S, sw * S, sh * S);
      ctx.strokeRect(sx * S + 1, sy * S + 1, sw * S - 2, sh * S - 2);
      const light = ['kuning', 'birumuda'].includes(group.id);
      // bangunan atau huruf grup
      if (o && o.houses > 0) {
        if (o.houses === 5) {
          const b = building('hotel');
          const vertical = r.side === 'left' || r.side === 'right';
          const bx = vertical ? sx + 1.5 : sx + sw / 2 - 4;
          const by = vertical ? sy + sh / 2 - 6 : sy + 0;
          ctx.drawImage(b, bx * S, by * S, 8 * S, (vertical ? 12 : 11) * S);
        } else {
          for (let k = 0; k < o.houses; k++) {
            const b = building('house', (i + k) % 4);
            const vertical = r.side === 'left' || r.side === 'right';
            const bx = vertical ? sx + 1.5 : sx + 1 + k * 10;
            const by = vertical ? sy + 1 + k * 10 : sy + 1.5;
            ctx.drawImage(b, bx * S, by * S, 8 * S, 8 * S);
          }
        }
      } else {
        this.text(ctx, group.letter, (sx + sw / 2) * S, (sy + sh / 2 - 4) * S + 1, 8, light ? PAL.k : '#fff8e7');
      }
    }

    // ikon, nama, harga
    const label = t.label ?? [t.name];
    const cx = (content.x + content.w / 2) * S;
    const isCorner = r.side === 'corner';
    const iconSize = isCorner ? 32 : 16;
    let y = content.y + (isCorner ? 4 : 3);
    if (t.icon) {
      ctx.drawImage(icon(t.icon), cx - (iconSize / 2) * S, y * S, iconSize * S, iconSize * S);
      y += iconSize + 2;
    }
    for (const line of label) {
      this.text(ctx, line.toUpperCase() === line ? line : line, cx, y * S, 8, PAL.k);
      y += 5;
    }
    if (t.price && !isCorner) {
      const owner = o?.owner;
      const priceText = `${t.price >= 1000 ? (t.price / 1000).toLocaleString('id-ID') + 'jt' : t.price + 'rb'}`;
      this.text(ctx, priceText, cx, (content.y + content.h - 6) * S - 2, 8, owner ? '#7a6a55' : '#8b1e1e');
    } else if (t.type === 'tax') {
      this.text(ctx, `${(t.amount! / 1000).toLocaleString('id-ID')}jt`, cx, (content.y + content.h - 6) * S - 2, 8, '#8b1e1e');
    }

    // pemilik: bingkai warna pemain; tergadai: arsiran
    if (o?.owner) {
      const col = this.colors.get(o.owner) ?? '#fff';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * S;
      ctx.strokeRect(X + 3 * S, Y + 3 * S, W - 6 * S, H - 6 * S);
      ctx.fillStyle = col;
      const fx = content.x + 3, fy = content.y + 3;
      ctx.fillRect(fx * S, fy * S, 5 * S, 5 * S);
      ctx.strokeStyle = PAL.k;
      ctx.lineWidth = S;
      ctx.strokeRect(fx * S, fy * S, 5 * S, 5 * S);
      if (o.mortgaged) {
        ctx.fillStyle = 'rgba(40,30,20,0.45)';
        ctx.fillRect(X, Y, W, H);
        this.text(ctx, 'GADAI', cx, (content.y + content.h / 2 - 4) * S, 8, '#fff8e7');
      }
    }
  }

  private draw() {
    const ctx = this.ctx;
    this.buildStatic();
    ctx.drawImage(this.staticLayer, 0, 0);
    const s = this.state;
    if (!s) return;
    const now = performance.now();

    // sorot petak terpilih
    if (this.highlight !== null) {
      const r = tileRect(this.highlight);
      ctx.strokeStyle = Math.floor(now / 300) % 2 ? '#ffffff' : '#f4d03f';
      ctx.lineWidth = 3 * S;
      ctx.strokeRect(r.x * S, r.y * S, r.w * S, r.h * S);
    }

    // dadu
    const d = this.dice ?? (s.dice ? { vals: s.dice, rolling: -1 } : null);
    if (d) {
      const shake = d.rolling >= 0 ? (d.rolling % 2 ? -2 : 2) : 0;
      drawDie(ctx, (L / 2 - 28) * S, (L / 2 + 36 + shake) * S, d.vals[0], 3);
      drawDie(ctx, (L / 2 + 4) * S, (L / 2 + 36 - shake) * S, d.vals[1], 3);
    }

    // bidak
    const cur = s.players[s.turnIndex];
    const order = [...s.players].filter((p) => !p.bankrupt).sort((a, b) => (a.id === cur.id ? 1 : b.id === cur.id ? -1 : 0));
    for (const p of order) {
      const pos = this.displayPos.get(p.id) ?? p.position;
      let [x, y] = this.slotXY(p.id, pos);
      const a = this.anims.get(p.id);
      let lift = 0;
      if (a) {
        const k = Math.min(1, (now - a.t0) / a.dur);
        x = a.from[0] + (a.to[0] - a.from[0]) * k;
        y = a.from[1] + (a.to[1] - a.from[1]) * k;
        // lompat 4 frame
        if (a.jump) lift = [0, 4, 6, 3][Math.min(3, Math.floor(k * 4))];
      } else {
        // idle 2 frame
        lift = Math.floor(now / 500 + p.position) % 2;
      }
      const expr = a ? 'senang' : p.expression;
      const img = head(p.character.parts, expr);
      const size = 18;
      const col = this.colors.get(p.id) ?? '#fff';
      // bayangan & cincin warna pemain
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect((x - 6) * S, (y + 7) * S, 12 * S, 2 * S);
      ctx.fillStyle = col;
      ctx.fillRect((x - size / 2 - 1) * S, (y - size / 2 - 1 - lift) * S, (size + 2) * S, (size + 2) * S);
      ctx.drawImage(img, (x - size / 2) * S, (y - size / 2 - lift) * S, size * S, size * S);
      if (p.inJail && pos === this.theme.jailIndex) {
        ctx.fillStyle = '#5b6770';
        for (let k = 0; k < 4; k++) ctx.fillRect((x - 7 + k * 4.5) * S, (y - 9) * S, S, 18 * S);
      }
      if (p.id === cur.id && !a) {
        const bob = Math.floor(now / 250) % 2;
        ctx.fillStyle = PAL.k;
        ctx.fillRect((x - 3) * S, (y - 16 - bob) * S, 6 * S, 2 * S);
        ctx.fillRect((x - 2) * S, (y - 14 - bob) * S, 4 * S, 2 * S);
        ctx.fillStyle = '#f4d03f';
        ctx.fillRect((x - 2) * S, (y - 16 - bob) * S, 4 * S, S);
        ctx.fillRect((x - 1) * S, (y - 14 - bob) * S, 2 * S, S);
      }
    }
  }
}
