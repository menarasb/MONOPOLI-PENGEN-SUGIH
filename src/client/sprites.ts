// Semua grafis pixel art digambar dari kode (orisinal, tanpa aset pihak ketiga).
import type { CharacterParts, Expression } from '../shared/types';

// Palet terbatas (≤32 warna): merah putih, hijau sawah, cokelat batik, biru laut.
export const PAL: Record<string, string> = {
  k: '#2a1a12', // garis gelap
  w: '#fff8e7', // putih hangat
  c: '#f3e3c3', // krem papan
  g: '#e0a82e', // emas
  y: '#f4d03f', // kuning
  r: '#c0392b', // merah
  p: '#e8649c', // merah muda
  o: '#e67e22', // oranye
  b: '#2e6fb5', // biru
  l: '#8fd0f0', // biru muda
  W: '#2f78b7', // air laut
  G: '#3fa34d', // hijau sawah
  d: '#1f6b35', // hijau tua
  n: '#8b5a2b', // cokelat batik
  N: '#5d3a1a', // cokelat tua
  t: '#d4a76a', // pasir
  s: '#a7b0b3', // batu
  S: '#5b6770', // batu gelap
};

export const SKINS = ['#f3cfa0', '#e0ac69', '#c68642', '#9b6235', '#6b4226'];
export const HAIR_COLORS = ['#1c1410', '#4a2c17', '#7a7a7a', '#dcdcdc', '#9a6a3a'];
export const SHIRTS = ['#f4f1e8', '#c9a66b', '#7a4a26', '#2b4a6f', '#b07aa1', '#3f6e8c', '#5d7a3a'];
export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];

const OUT = '#2a1a12';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

// ---------------------------------------------------------------- kepala karakter 32x32

const headCache = new Map<string, HTMLCanvasElement>();

export function head(parts: CharacterParts, expr: Expression = 'normal'): HTMLCanvasElement {
  const key = JSON.stringify(parts) + expr;
  const hit = headCache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(32, 32);
  const grid: (string | null)[][] = Array.from({ length: 32 }, () => Array(32).fill(null));
  const set = (x: number, y: number, col: string) => {
    if (x >= 0 && x < 32 && y >= 0 && y < 32) grid[y][x] = col;
  };
  const skin = SKINS[parts.skin] ?? SKINS[1];
  const hair = HAIR_COLORS[parts.hairColor] ?? HAIR_COLORS[0];
  const shirt = SHIRTS[parts.shirt] ?? SHIRTS[0];
  const cx = 15.5;

  const inFace = (x: number, y: number): boolean => {
    const dx = x - cx;
    if (parts.face === 'oval') return (dx / 8.6) ** 2 + ((y - 14) / 10.5) ** 2 <= 1;
    if (parts.face === 'bulat') return (dx / 9.8) ** 2 + ((y - 14.5) / 9.8) ** 2 <= 1;
    // kotak dengan sudut bulat
    if (Math.abs(dx) > 9 || y < 5 || y > 24) return false;
    if (y > 21 && Math.abs(dx) > 9 - (y - 21) * 1.5) return false;
    if (y < 7 && Math.abs(dx) > 7 + (y - 5)) return false;
    return true;
  };

  // baju & leher
  for (let y = 25; y < 32; y++)
    for (let x = 3; x < 29; x++) {
      const w = 9 + (y - 25) * 2;
      if (Math.abs(x - cx) <= w) set(x, y, shirt);
    }
  for (let y = 22; y < 27; y++) for (let x = 13; x < 19; x++) set(x, y, skin);
  // kerah
  set(13, 26, '#ffffff');
  set(18, 26, '#ffffff');
  set(14, 27, '#ffffff');
  set(17, 27, '#ffffff');

  // rambut panjang / bob di belakang wajah
  if (parts.hair === 'panjang' || parts.hair === 'bob') {
    const bottom = parts.hair === 'panjang' ? 28 : 21;
    for (let y = 4; y <= bottom; y++)
      for (let x = 4; x < 28; x++) if (Math.abs(x - cx) <= 11 && (y < 14 || Math.abs(x - cx) > 6)) set(x, y, hair);
  }
  // kerudung di belakang
  if (parts.headwear === 'kerudung') {
    for (let y = 2; y < 30; y++)
      for (let x = 2; x < 30; x++) {
        const dx = x - cx;
        const inside = (dx / 12) ** 2 + ((y - 14) / 12) ** 2 <= 1 || (y > 20 && Math.abs(dx) <= 12 + (y - 20) * 0.6);
        if (inside) set(x, y, shiftColor(shirt, -10));
      }
  }

  // wajah
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (inFace(x, y)) set(x, y, skin);
  // telinga
  if (parts.headwear !== 'kerudung') {
    const ear = parts.face === 'bulat' ? 10.5 : 9.5;
    for (const sx of [-1, 1]) for (let y = 13; y < 17; y++) set(Math.round(cx + sx * ear), y, skin);
  }

  // rambut depan
  const hairTop = (x: number, y: number, h: number) => inFace(x, y + 1) || inFace(x, y + 2) || (y >= 3 && y < h && inFace(x, h));
  const hairStyle = parts.hair;
  if (parts.headwear !== 'kerudung') {
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const dx = Math.abs(x - cx);
        let isHair = false;
        switch (hairStyle) {
          case 'pendek':
            isHair = (y <= 7 && hairTop(x, y, 7)) || (y <= 12 && dx >= 8 && hairTop(x, y, 12));
            break;
          case 'belah':
            isHair = ((y <= 7 && hairTop(x, y, 7)) || (y <= 11 && dx >= 8 && hairTop(x, y, 11))) && !(x === 11 && y <= 6);
            if (y === 8 && x >= 12 && x <= 20 && inFace(x, y)) isHair = true;
            break;
          case 'klimis':
            isHair = (y <= 7 && hairTop(x, y, 7)) || (y <= 13 && dx >= 8 && hairTop(x, y, 13));
            break;
          case 'ikal':
            isHair =
              (y <= 8 && (hairTop(x, y, 8) || ((x + y) % 3 === 0 && hairTop(x, y + 1, 8)))) ||
              (y <= 13 && dx >= 7.5 && hairTop(x, y, 13));
            break;
          case 'botak':
            isHair = y >= 10 && y <= 15 && dx >= 8 && inFace(x, y);
            break;
          case 'panjang':
          case 'bob':
            isHair = (y <= 8 && hairTop(x, y, 8)) || (y <= 9 && x >= 8 && x <= 14 && inFace(x, y));
            break;
        }
        if (isHair) set(x, y, hair);
      }
    if (hairStyle === 'klimis') for (let x = 12; x < 18; x++) set(x, 3, shiftColor(hair, 60));
  }

  // penutup kepala
  if (parts.headwear === 'peci') {
    for (let y = 0; y <= 6; y++)
      for (let x = 6; x < 26; x++) {
        const dx = Math.abs(x - cx);
        if (dx <= 8.5 - (y < 2 ? 1 : 0)) set(x, y, '#1c1c1c');
      }
    for (let x = 8; x < 24; x++) set(x, 1, '#333333');
  } else if (parts.headwear === 'topi') {
    for (let y = 1; y <= 6; y++) for (let x = 7; x < 25; x++) set(x, y, shirt === SHIRTS[0] ? '#c0392b' : shiftColor(shirt, -30));
    for (let x = 5; x < 29; x++) set(x, 7, shiftColor(shirt === SHIRTS[0] ? '#c0392b' : shirt, -50));
  } else if (parts.headwear === 'kerudung') {
    const hood = shiftColor(shirt, -10);
    for (let y = 2; y < 10; y++) for (let x = 0; x < 32; x++) if (inFace(x, y) && (y < 8 || Math.abs(x - cx) > 7)) set(x, y, hood);
    for (let y = 8; y < 24; y++) for (let x = 0; x < 32; x++) if (inFace(x, y) && Math.abs(x - cx) > 8) set(x, y, hood);
  }

  // ekspresi: mata, alis, mulut
  const ey = 14;
  const ex = [12, 19];
  const dark = '#1c1410';
  if (expr === 'senang') {
    for (const x of ex) {
      set(x, ey, dark);
      set(x + 1, ey, dark);
      set(x - 1, ey + 1, dark);
      set(x + 2, ey + 1, dark);
    }
    set(10, 17, '#e8869c');
    set(21, 17, '#e8869c');
    for (let x = 13; x <= 18; x++) set(x, 19, dark);
    for (let x = 14; x <= 17; x++) set(x, 20, '#ffffff');
    set(13, 18, dark);
    set(18, 18, dark);
  } else if (expr === 'sedih') {
    for (const x of ex) {
      set(x, ey, dark);
      set(x + 1, ey, dark);
      set(x, ey + 1, dark);
      set(x + 1, ey + 1, dark);
    }
    set(11, 12, dark);
    set(12, 11, dark);
    set(20, 11, dark);
    set(21, 12, dark);
    for (let x = 14; x <= 17; x++) set(x, 19, dark);
    set(13, 20, dark);
    set(18, 20, dark);
    set(12, 16, '#5dade2');
    set(12, 17, '#5dade2');
  } else if (expr === 'kaget') {
    for (const x of ex) {
      for (let dy = -1; dy <= 1; dy++) {
        set(x, ey + dy, '#ffffff');
        set(x + 1, ey + dy, '#ffffff');
      }
      set(x, ey, dark);
      set(x + 1, ey, dark);
    }
    set(12, 11, dark);
    set(13, 11, dark);
    set(19, 11, dark);
    set(20, 11, dark);
    for (let y = 18; y <= 21; y++) for (let x = 15; x <= 16; x++) set(x, y, dark);
    set(14, 19, dark);
    set(17, 19, dark);
    set(14, 20, dark);
    set(17, 20, dark);
  } else {
    for (const x of ex) {
      set(x, ey, dark);
      set(x + 1, ey, dark);
      set(x, ey + 1, dark);
      set(x + 1, ey + 1, dark);
    }
    set(12, 12, shiftColor(hair, 10));
    set(13, 12, shiftColor(hair, 10));
    set(19, 12, shiftColor(hair, 10));
    set(20, 12, shiftColor(hair, 10));
    for (let x = 14; x <= 17; x++) set(x, 20, dark);
    set(13, 19, dark);
    set(18, 19, dark);
  }
  // hidung
  set(15, 17, shiftColor(skin, -35));
  set(16, 17, shiftColor(skin, -35));

  if (parts.mustache) for (let x = 13; x <= 18; x++) set(x, 18, hair === HAIR_COLORS[3] ? '#9a9a9a' : hair);
  if (parts.glasses) {
    const gl = '#222222';
    for (const x0 of [10, 17]) {
      for (let x = x0; x < x0 + 5; x++) {
        set(x, 12, gl);
        set(x, 16, gl);
      }
      for (let y = 12; y <= 16; y++) {
        set(x0, y, gl);
        set(x0 + 4, y, gl);
      }
    }
    set(15, 13, gl);
    set(16, 13, gl);
  }

  // garis luar
  const filled = (x: number, y: number) => x >= 0 && x < 32 && y >= 0 && y < 32 && grid[y][x] !== null;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const v = grid[y][x];
      if (v) ctx.fillStyle = v;
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) ctx.fillStyle = OUT;
      else continue;
      ctx.fillRect(x, y, 1, 1);
    }
  headCache.set(key, c);
  return c;
}

export function shiftColor(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/** Elemen <canvas> avatar berskala integer. */
export function avatarEl(parts: CharacterParts, expr: Expression = 'normal', scale = 2): HTMLCanvasElement {
  const src = head(parts, expr);
  const [c, ctx] = canvas(32 * scale, 32 * scale);
  ctx.drawImage(src, 0, 0, 32 * scale, 32 * scale);
  c.className = 'pixel avatar';
  return c;
}

// ---------------------------------------------------------------- ikon 16x16

const ICONS: Record<string, string[]> = {
  monas: ['.......gg.......', '......gyyg......', '.......gg.......', '.......ss.......', '.......ws.......', '.......ws.......', '.......ws.......', '.......ws.......', '.......ws.......', '......wwss......', '......wwss......', '.....swwwss.....', '...ssssssssss...', '...swwwwwwwws...', '..ssssssssssss..', '.kkkkkkkkkkkkkk.'],
  garuda: ['................', '.......gg.......', '......gkgg......', '.g....gggg....g.', '.gg..gggggg..gg.', '.ggg.gggggg.ggg.', '.gggggggggggggg.', '..gggggrrggggg..', '...ggggwwgggg...', '.....grwwrg.....', '.....ggrrgg.....', '......gggg......', '.....gg..gg.....', '....gg....gg....'],
  monumen: ['.......ww.......', '.......ww.......', '......wwww......', '......wsws......', '......wwww......', '......wwss......', '.....wwwsss.....', '.....wwwsss.....', '.....wwwsss.....', '....wwwwssss....', '....wwwwssss....', '...wwwwwsssss...', '..sssssssssssss.', '..GGGGGGGGGGGG..', '..dddddddddddd..'],
  gedung: ['.......kk.......', '.......ss.......', '......swws......', '......wwww......', '.....rrrrrr.....', '.....wkwwkw.....', '..rrrrrrrrrrrr..', '..wwwwwwwwwwww..', '..wkwkwwwwkwkw..', '..wkwkwkkwkwkw..', '..wwwwwkkwwwww..', '..wkwkwkkwkwkw..', '..wwwwwkkwwwww..', '.ssssssssssssss.', '.SSSSSSSSSSSSSS.'],
  istana: ['.......gg.......', '......gyyg......', '.....gyyyyg.....', '.....yyyyyy.....', '...yyyyyyyyyy...', '...ykykyykyky...', '.gg.yyyyyyyy.gg.', 'gyyg.yyyyyy.gyyg', 'yyyyyyyyyyyyyyyy', 'ykkykyykkyykykky', 'ykkykyykkyykykky', 'yyyyyyyykyyyyyyy', 'yyyyyyykkkyyyyyy', 'yyyyyyykkkyyyyyy', 'ssssssssssssssss'],
  tugu: ['.......gg.......', '......gyyg......', '.......gg.......', '......wwww......', '.......ws.......', '.......ws.......', '......wwss......', '......wwss......', '......wwss......', '.....wwwsss.....', '.....wwwsss.....', '.....wwwsss.....', '....wwwwssss....', '...ssssssssss...', '..SSSSSSSSSSSS..'],
  gunung: ['................', '................', '.......ww.......', '......wwss......', '.....wwsss......', '....GwsssGG.....', '...GGGssGGGG....', '..GGGGGGGGdGG...', '.GGGGGdGGGGdGG..', 'GGdGGGGGGdGGGGG.', 'GGGGdGGGGGGGdGGG', 'dGGGGGGdGGGGGGGd'],
  pura: ['...kk......kk...', '...nn......nn...', '..nnnn....nnnn..', '..nNnn....nnNn..', '.nnnnnn..nnnnnn.', '.nNnnnn..nnnnNn.', 'nnnnnnn..nnnnnnn', 'nNnnnnn..nnnnnNn', 'nnnnnnn..nnnnnnn', 'nnnnnnn..nnnnnnn', 'ssssssssssssssss', 'SSSSSSSSSSSSSSSS'],
  benteng: ['.s.s.s....s.s.s.', '.sssss....sssss.', '.sSsss....sssSs.', '.ssssssssssssss.', '.sssssskkssssss.', '.ssSsskkkkssSss.', '.ssssskkkksssss.', '.ssssskkkksssss.', '.ssssskkkksssss.', 'SSSSSSSSSSSSSSSS', 'WWWWWWWWWWWWWWWW'],
  ikan: ['................', '................', '.....ooo........', '...oooooooo..o..', '..ookooooooooo..', '.oowoooooooooo..', '..oooooooooo.oo.', '...oooooooo...o.', '.....ooo........', 'WWWWWWWWWWWWWWWW', 'WlWWWWlWWWWWlWWW'],
  ampera: ['...rr......rr...', '...rr......rr...', '..rrrr....rrrr..', '..rkkr....rkkr..', '..rrrr....rrrr..', '..rrrr....rrrr..', 'rrrrrrrrrrrrrrrr', 'rkrkrkrkrkrkrkrk', 'rrrrrrrrrrrrrrrr', '..rr........rr..', 'WWrrWWWWWWWWrrWW', 'WWWWWlWWWWlWWWWW'],
  rumahadat: ['k..............k', 'nk............kn', '.nk...k..k...kn.', '.nnk.knnnnk.knn.', '..nnnnnnnnnnnnn.', '..NNNNNNNNNNNN..', '..rgrgrgrgrgrg..', '..nnnnnnnnnnnn..', '..nwwnnkknnwwn..', '..nwwnnkknnwwn..', '..nnnnnkknnnnn..', '..nnnnnkknnnnn..', '...N........N...', '...N........N...'],
  jamgadang: ['...k........k...', '...nk......kn...', '....nnnnnnnn....', '.....nNNNNn.....', '.....wwwwww.....', '.....wwkkww.....', '.....wkwwkw.....', '.....wwkkww.....', '.....wwwwww.....', '.....wwwwww.....', '.....wwkkww.....', '.....wwkkww.....', '....wwwwwwww....', '...ssssssssss...'],
  masjid: ['.......g........', '......GGG.......', '.....GGGGG......', '....GGGGGGG.....', '.g..GGGGGGG..g..', '.w..wwwwwww..w..', '.w.wwwwwwwww.w..', '.w.wkwwkwwkw.w..', '.w.wkwwkwwkw.w..', '.w.wwwwkwwww.w..', '.w.wwwkkkwww.w..', '.w.wwwkkkwww.w..', 'ssssssssssssssss'],
  perahu: ['........y.......', '.......yyy......', '......oyyyo.....', '.....GoyoyG.....', '................', '.nnnnnnnnnnnnnn.', '..nNNNNNNNNNNn..', '...nnnnnnnnnn...', 'WWWWWWWWWWWWWWWW', 'WWlWWWWWWWlWWWWW'],
  jembatan: ['................', '......yyyy......', '....yy....yy....', '...y........y...', '..y.k..k..k..y..', '.y..k..k..k...y.', 'y...k..k..k....y', 'ssssssssssssssss', 'SSSSSSSSSSSSSSSS', '.s............s.', 'WsWWWWWWWWWWWWsW', 'WsWWWlWWWWWlWWsW'],
  honai: ['................', '.......k........', '......nnn.......', '.....ntnnn......', '....nntnnnn.....', '...nntnnnnnn....', '..nnnnnnnnnnnn..', '.nnnnnnnnnnnnnn.', '..NNNNNNNNNNNN..', '..tttttttttttt..', '..tttttkkttttt..', '..tttttkkttttt..', '..tttttkkttttt..', 'GGGGGGGGGGGGGGGG'],
  pantai: ['....GG..........', '..GGGGGG........', '.GG.Gn.GG.......', '.G...n..G.......', '.....n..........', '.....n.....y....', '......n...yyy...', '......n....y....', '......n.........', 'tttttttttttttttt', 'WWWWWWWWWWWWWWWW', 'WlWWWWWlWWWWWlWW'],
  kereta: ['................', '..oooooooooooo..', '.owwowwowwowwoo.', '.owwowwowwowwoo.', '.oooooooooooooo.', '.oyyyyyyyyyyyyo.', '.oooooooooooooo.', '..kk..kk..kk.kk.', '..kk..kk..kk.kk.', 'ssssssssssssssss', '.n..n..n..n..n..'],
  kapal: ['................', '.......r........', '......wrw.......', '.....wwwww......', '....wkwkwkw.....', '...wwwwwwwwwr...', '.rrrrrrrrrrrrrr.', '.wwwwwwwwwwwwww.', '..wkwkwkwkwkww..', '...rrrrrrrrrr...', 'WWWWWWWWWWWWWWWW', 'WlWWWWWlWWWWWlWW'],
  pesawat: ['................', '.......ww.......', '......wbbw......', '......wwww......', '......wwww......', '..wwwwwwwwwwww..', '.wwwwwwwwwwwwww.', '......wwww......', '......wwww......', '.......ww.......', '.....wwwwww.....', '.......ww.......'],
  listrik: ['.........yy.....', '........yyk.....', '.......yyk......', '......yyk.......', '.....yyyyyyy....', '.....kkkyyk.....', '.......yyk......', '......yyk.......', '.....yyk........', '....yk..........'],
  air: ['.......l........', '.......l........', '......lll.......', '.....llWll......', '....llWWWll.....', '....lWWWWWl.....', '...lWWWWWWWl....', '...lWWwWWWWl....', '...lWWwWWWWl....', '....lWWWWWl.....', '.....lllll......'],
  pajak: ['.....kkkk.......', '......kk........', '.....gggg.......', '....gggggg......', '...gggkgggg.....', '..gggkkkgggg....', '..ggggkggggg....', '..gggkkkgggg....', '..ggggkggggg....', '...gggggggg.....', '....gggggg......'],
  cincin: ['......llll......', '.....lwlllw.....', '......llll......', '.......ll.......', '......g..g......', '.....g....g.....', '.....g....g.....', '......g..g......', '.......gg.......'],
  danaumum: ['................', '...nnnnnnnnnn...', '..nNNNNNNNNNNn..', '..nnnnnnnnnnnn..', '..gggggggggggg..', '..nnnnnggnnnnn..', '..nnnnngknnnnn..', '..nnnnnnnnnnnn..', '..NNNNNNNNNNNN..'],
  kesempatan: ['.....oooooo.....', '....oo....oo....', '....oo....oo....', '.........oo.....', '........oo......', '.......oo.......', '.......oo.......', '................', '.......oo.......', '.......oo.......'],
  start: ['................', '........rr......', '........rrr.....', '.rrrrrrrrrrrr...', '.rrrrrrrrrrrrr..', '.rrrrrrrrrrrr...', '........rrr.....', '........rr......'],
  penjara: ['SSSSSSSSSSSSSSSS', 'SkkkkkkkkkkkkkkS', 'SksksksksksksksS', 'SksksksksksksksS', 'SksksksksksksksS', 'SksksksksksksksS', 'SkkkkkkkkkkkkkkS', 'SSSSSSSSSSSSSSSS'],
  parkir: ['.bbbbbbbbbbbbb..', '.bbwwwwwbbbbbb..', '.bbwwbbbwwbbbb..', '.bbwwbbbwwbbbb..', '.bbwwwwwwbbbbb..', '.bbwwbbbbbbbbb..', '.bbwwbbbbbbbbb..', '.bbbbbbbbbbbbb..', '.......ss.......', '.......ss.......'],
  polisi: ['......rrbb......', '.....rrrbbb.....', '....rrwrbwbb....', '....rrrrbbbb....', '...ssssssssss...', '...SSSSSSSSSS...'],
};

const iconCache = new Map<string, HTMLCanvasElement>();

/** Ikon 16x16 (baris dipusatkan vertikal). */
export function icon(name: string): HTMLCanvasElement {
  const hit = iconCache.get(name);
  if (hit) return hit;
  const rows = ICONS[name] ?? ICONS.tugu;
  const [c, ctx] = canvas(16, 16);
  const off = Math.floor((16 - rows.length) / 2);
  rows.forEach((row, y) => {
    for (let x = 0; x < Math.min(16, row.length); x++) {
      const col = PAL[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y + off, 1, 1);
    }
  });
  iconCache.set(name, c);
  return c;
}

// ---------------------------------------------------------------- bangunan 3D isometrik (rumah & hotel)
// Digambar per-pixel dari bentuk 3D (proyeksi isometrik 2:1) supaya tetap bergaya pixel art
// tapi punya sisi terang/gelap, atap pelana, jendela, dan garis tepi.

type P3 = [number, number, number];
type Face = { pts: P3[]; col: string };

export interface BuildingSprite {
  c: HTMLCanvasElement;
  /** titik jangkar (tengah alas paling bawah) dalam pixel kanvas */
  ax: number;
  ay: number;
}

const HOUSE_ROOFS = ['#c0392b', '#3f8f4a', '#a0522d', '#2e6fb5'];
const bCache = new Map<string, BuildingSprite>();

function inPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rasterisasi daftar sisi (urut belakang -> depan) menjadi sprite ber-outline. */
function rasterIso(a: number, b: number, top: number, faces: Face[]): BuildingSprite {
  const pad = 2;
  const W = a + b + pad * 2 + 4;
  const H = Math.ceil((a + b) / 2 + top) + pad * 2 + 2;
  const ox = b + pad + 2;
  const oy = top + pad;
  const proj = ([x, y, z]: P3): [number, number] => [ox + x - y, oy + (x + y) / 2 - z];
  const buf: (string | null)[] = new Array(W * H).fill(null);
  for (const f of faces) {
    const poly = f.pts.map(proj);
    const xs = poly.map((q) => q[0]);
    const ys = poly.map((q) => q[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(W - 1, Math.ceil(Math.max(...xs))); x++)
        if (inPoly(x + 0.5, y + 0.5, poly)) buf[y * W + x] = f.col;
  }
  // garis tepi luar
  const out = buf.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (buf[y * W + x]) continue;
      const n = (dx: number, dy: number) => {
        const X = x + dx;
        const Y = y + dy;
        return X >= 0 && Y >= 0 && X < W && Y < H && !!buf[Y * W + X];
      };
      if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) out[y * W + x] = OUT;
    }
  const [c, ctx] = canvas(W, H);
  out.forEach((col, k) => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(k % W, Math.floor(k / W), 1, 1);
  });
  const [bx, by] = proj([a, b, 0]);
  const [lx] = proj([0, b, 0]);
  const [rx] = proj([a, 0, 0]);
  return { c, ax: (lx + rx) / 2, ay: by + 1 };
}

/** persegi di bidang y = Y (sisi kiri-depan) */
const onY = (Y: number, x0: number, x1: number, z0: number, z1: number, col: string): Face => ({
  pts: [[x0, Y, z0], [x1, Y, z0], [x1, Y, z1], [x0, Y, z1]],
  col,
});
/** persegi di bidang x = X (sisi kanan-depan) */
const onX = (X: number, y0: number, y1: number, z0: number, z1: number, col: string): Face => ({
  pts: [[X, y0, z0], [X, y1, z0], [X, y1, z1], [X, y0, z1]],
  col,
});

export function building(kind: 'house' | 'hotel' | 'mall', variant = 0): BuildingSprite {
  const key = kind + variant;
  const hit = bCache.get(key);
  if (hit) return hit;
  let spr: BuildingSprite;
  if (kind === 'house') {
    const a = 12, b = 10, h = 10, r = 9;
    const roof = HOUSE_ROOFS[variant % 4];
    const wallL = '#f6e7c8';
    const wallR = '#cdb48a';
    const m = b / 2;
    spr = rasterIso(a, b, h + r + 2, [
      // atap belakang (hanya ujungnya yang terlihat)
      { pts: [[-1, -1, h - 1], [a + 1, -1, h - 1], [a + 1, m, h + r], [-1, m, h + r]], col: shiftColor(roof, -55) },
      onY(b, 0, a, 0, h, wallL),
      onX(a, 0, b, 0, h, wallR),
      { pts: [[a, 0, h], [a, b, h], [a, m, h + r]], col: wallR },
      // fondasi
      onY(b, 0, a, 0, 1.5, '#9a8466'),
      onX(a, 0, b, 0, 1.5, '#7a6650'),
      // pintu & jendela
      onY(b, 7, 10, 1.5, 7, '#6b3b1f'),
      onY(b, 1.5, 5, 4, 7, '#7fc6e8'),
      onX(a, 2.5, 7.5, 4, 7, '#5aa0c4'),
      { pts: [[a, m - 1, h + 2], [a, m + 1, h + 2], [a, m + 1, h + 4], [a, m - 1, h + 4]], col: '#5aa0c4' },
      // cerobong
      onY(3, 2, 4, h + r - 4, h + r + 1, '#b0563c'),
      onX(4, 1, 3, h + r - 4, h + r + 1, '#7f3a28'),
      // atap depan + lis
      { pts: [[-1, m, h + r], [a + 1, m, h + r], [a + 1, b + 1, h - 1], [-1, b + 1, h - 1]], col: roof },
      { pts: [[-1, m, h + r], [a + 1, m, h + r], [a + 1, m + 1, h + r - 1.6], [-1, m + 1, h + r - 1.6]], col: shiftColor(roof, 45) },
      { pts: [[-1, b, h - 0.2], [a + 1, b, h - 0.2], [a + 1, b + 1, h - 1], [-1, b + 1, h - 1]], col: shiftColor(roof, -35) },
    ]);
  } else if (kind === 'mall') {
    // Mall: bangunan lebar & pendek, fasad kaca, kanopi bergaris, papan nama di atap.
    const a = 22, b = 16, h = 15;
    const wallL = '#f0ece2';
    const wallR = '#b9b2a2';
    const accent = ['#16a085', '#8e44ad', '#d35400', '#2980b9'][variant % 4];
    const faces: Face[] = [
      onY(b, 0, a, 0, h, wallL),
      onX(a, 0, b, 0, h, wallR),
      // pita warna di atas
      onY(b, 0, a, h - 3, h, accent),
      onX(a, 0, b, h - 3, h, shiftColor(accent, -40)),
      // etalase kaca lantai 1 & 2
      onY(b, 1.5, a - 1.5, 1, 5.5, '#7fc6e8'),
      onY(b, 1.5, a - 1.5, 7, 10.5, '#5aa0c4'),
      onX(a, 1.5, b - 1.5, 1, 5.5, '#5aa0c4'),
      onX(a, 1.5, b - 1.5, 7, 10.5, '#3f7fa3'),
      // pintu putar
      onY(b, a / 2 - 2, a / 2 + 2, 0, 5.5, '#2a3f52'),
    ];
    // tiang kaca vertikal
    for (let x = 5; x < a - 2; x += 4) faces.push(onY(b, x, x + 0.6, 1, 10.5, '#e8f6fc'));
    for (let y = 5; y < b - 2; y += 4) faces.push(onX(a, y, y + 0.6, 1, 10.5, '#b4d8e8'));
    // kanopi bergaris di atas pintu
    for (let k = 0; k < 4; k++)
      faces.push({
        pts: [[a / 2 - 4 + k * 2, b, 6.5], [a / 2 - 2 + k * 2, b, 6.5], [a / 2 - 2 + k * 2, b + 2.5, 5.5], [a / 2 - 4 + k * 2, b + 2.5, 5.5]],
        col: k % 2 ? '#fff8e7' : '#c0392b',
      });
    faces.push(
      // atap datar
      { pts: [[0, 0, h], [a, 0, h], [a, b, h], [0, b, h]], col: '#d8d2c4' },
      { pts: [[1.5, 1.5, h], [a - 1.5, 1.5, h], [a - 1.5, b - 1.5, h], [1.5, b - 1.5, h]], col: '#9c9483' },
      // papan nama "M"
      onX(a / 2 + 1, 5, 11, h, h + 7, shiftColor(accent, -40)),
      onY(a / 2, a / 2 - 4, a / 2 + 4, h, h + 7, accent),
      onY(a / 2, a / 2 - 3, a / 2 - 1.8, h + 1.2, h + 5.8, '#fff8e7'),
      onY(a / 2, a / 2 + 1.8, a / 2 + 3, h + 1.2, h + 5.8, '#fff8e7'),
      onY(a / 2, a / 2 - 1.8, a / 2 + 1.8, h + 3.8, h + 5.8, '#fff8e7'),
      onY(a / 2, a / 2 - 0.6, a / 2 + 0.6, h + 2.4, h + 4.6, '#fff8e7'),
    );
    spr = rasterIso(a, b, h + 9, faces);
  } else {
    const a = 16, b = 16, h = 26;
    const wallL = '#d64532';
    const wallR = '#94291c';
    const faces: Face[] = [onY(b, 0, a, 0, h, wallL), onX(a, 0, b, 0, h, wallR)];
    // lantai-lantai jendela (sebagian menyala)
    for (let f = 0; f < 4; f++) {
      const z = 7.5 + f * 4.6;
      for (let k = 0; k < 3; k++) {
        const lit = (f * 3 + k + variant) % 4 !== 1;
        faces.push(onY(b, 2 + k * 4.8, 4.2 + k * 4.8, z, z + 2.8, lit ? '#ffe9a0' : '#3d5a73'));
        faces.push(onX(a, 2 + k * 4.8, 4.2 + k * 4.8, z, z + 2.8, lit ? '#d9b65e' : '#2a3f52'));
      }
    }
    faces.push(
      // lobi kaca + kanopi emas
      onY(b, 4.5, 10.5, 0, 4.5, '#7fc6e8'),
      onY(b, 7.2, 7.8, 0, 4.5, '#2a3f52'),
      { pts: [[3.5, b, 5.5], [11.5, b, 5.5], [11.5, b + 2.5, 4.5], [3.5, b + 2.5, 4.5]], col: '#f4d03f' },
      onY(b + 2.5, 3.5, 11.5, 3.8, 4.5, '#b7950b'),
      onX(a, 0, b, 0, 1.2, '#6e1f15'),
      onY(b, 0, a, 0, 1.2, '#8f2a1d'),
      // atap datar + tembok pembatas
      { pts: [[0, 0, h], [a, 0, h], [a, b, h], [0, b, h]], col: '#e8b4a8' },
      { pts: [[1.5, 1.5, h], [a - 1.5, 1.5, h], [a - 1.5, b - 1.5, h], [1.5, b - 1.5, h]], col: '#a7685d' },
      // papan nama "H"
      onX(a / 2 + 1, 4, 11, h, h + 8.5, '#b7950b'),
      onY(a / 2, a / 2 - 3.5, a / 2 + 3.5, h, h + 8.5, '#f4d03f'),
      onY(a / 2, a / 2 - 2, a / 2 - 0.8, h + 1.5, h + 7, '#8b1e1e'),
      onY(a / 2, a / 2 + 0.8, a / 2 + 2, h + 1.5, h + 7, '#8b1e1e'),
      onY(a / 2, a / 2 - 1, a / 2 + 1, h + 3.7, h + 4.8, '#8b1e1e'),
    );
    spr = rasterIso(a, b, h + 10, faces);
  }
  bCache.set(key, spr);
  return spr;
}

// ---------------------------------------------------------------- landmark 3D (voxel)
// Ikon landmark 16x16 tiap kota diekstrusi jadi model voxel 3D di atas alas batu berlis emas.
// Model yang sama dipakai untuk sprite isometrik di petak dan animasi berputar di tengah papan.

export interface Voxel {
  x: number;
  y: number;
  z: number;
  col: string;
}

const modelCache = new Map<string, Voxel[]>();

/** Model voxel landmark dari ikon kota (x = kolom, y = kedalaman, z = tinggi). */
export function landmarkModel(name: string): Voxel[] {
  const hit = modelCache.get(name);
  if (hit) return hit;
  const rows = ICONS[name] ?? ICONS.tugu;
  const D = 4; // ketebalan ekstrusi
  const PED = 2; // tinggi alas
  const vox: Voxel[] = [];
  // alas: batu 2 lapis, lapis atas berlis emas
  for (let x = -1; x <= 16; x++)
    for (let y = -2; y < D + 2; y++)
      for (let z = 0; z < PED; z++) {
        const edge = x === -1 || x === 16 || y === -2 || y === D + 1;
        vox.push({ x, y, z, col: z === PED - 1 && edge ? PAL.g : z === 0 ? PAL.S : PAL.s });
      }
  rows.forEach((row, r) => {
    const z = PED + (rows.length - 1 - r);
    for (let x = 0; x < Math.min(16, row.length); x++) {
      const col = PAL[row[x]];
      if (!col) continue;
      for (let y = 0; y < D; y++) vox.push({ x, y, z, col });
    }
  });
  modelCache.set(name, vox);
  return vox;
}

const shadeCache = new Map<string, string>();
function shade(col: string, amt: number): string {
  const k = col + amt;
  let v = shadeCache.get(k);
  if (!v) shadeCache.set(k, (v = shiftColor(col, amt)));
  return v;
}

/**
 * Gambar model voxel diputar `theta` (radian, sumbu vertikal) dengan proyeksi miring 2:1.
 * (cx, cy) = titik tengah alas di kanvas, `sc` = ukuran satu voxel dalam pixel.
 */
export function drawVoxels(ctx: CanvasRenderingContext2D, vox: Voxel[], cx: number, cy: number, sc: number, theta: number) {
  const occ = new Set(vox.map((v) => `${v.x},${v.y},${v.z}`));
  const has = (x: number, y: number, z: number) => occ.has(`${x},${y},${z}`);
  // pusat rotasi = tengah alas
  let mx = 0, my = 0;
  for (const v of vox) {
    mx += v.x;
    my += v.y;
  }
  mx = mx / vox.length + 0.5;
  my = my / vox.length + 0.5;
  const c = Math.cos(theta), s = Math.sin(theta);
  const P = (x: number, y: number, z: number): [number, number] => {
    const X = (x - mx) * c - (y - my) * s;
    const Y = (x - mx) * s + (y - my) * c;
    return [cx + X * sc, cy + Y * sc * 0.5 - z * sc];
  };
  const depth = (v: Voxel) => (v.x + 0.5 - mx) * s + (v.y + 0.5 - my) * c;
  const sorted = [...vox].sort((a, b) => depth(a) - depth(b) || a.z - b.z);
  // normal sisi samping: [dx, dy] -> komponen menghadap kamera = dx*s + dy*c
  const sides: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const quad = (pts: [number, number][], col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    ctx.closePath();
    ctx.fill();
  };
  for (const v of sorted) {
    const { x, y, z } = v;
    for (const [dx, dy] of sides) {
      const facing = dx * s + dy * c;
      if (facing <= 0.001 || has(x + dx, y + dy, z)) continue;
      // cahaya dari kiri-depan
      const light = -(dx * c - dy * s);
      const amt = Math.round(-28 + light * 22 - (1 - facing) * 10);
      const x0 = dx === 1 ? x + 1 : x, y0 = dy === 1 ? y + 1 : y;
      const x1 = dx === 0 ? x + 1 : x0, y1 = dy === 0 ? y + 1 : y0;
      quad([P(x0, y0, z), P(x1, y1, z), P(x1, y1, z + 1), P(x0, y0, z + 1)], shade(v.col, amt));
    }
    if (!has(x, y, z + 1)) quad([P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(v.col, 18));
  }
}

/** Ubah gambar anti-alias jadi pixel tegas + garis tepi gelap. */
export function crispen(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const W = c.width, H = c.height;
  const solid = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (d[k * 4 + 3] >= 110) {
      solid[k] = 1;
      d[k * 4 + 3] = 255;
    } else d[k * 4 + 3] = 0;
  }
  const [or, og, ob] = [0x2a, 0x1a, 0x12];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (solid[k]) continue;
      if ((x > 0 && solid[k - 1]) || (x < W - 1 && solid[k + 1]) || (y > 0 && solid[k - W]) || (y < H - 1 && solid[k + W])) {
        d[k * 4] = or;
        d[k * 4 + 1] = og;
        d[k * 4 + 2] = ob;
        d[k * 4 + 3] = 255;
      }
    }
  ctx.putImageData(img, 0, 0);
}

/** Sprite isometrik landmark untuk ditaruh di petak (sudut pandang sama dengan rumah/hotel). */
export function landmarkSprite(name: string): BuildingSprite {
  const key = 'landmark:' + name;
  const hit = bCache.get(key);
  if (hit) return hit;
  const sc = 2.1;
  const W = 54, H = 68;
  const [c, ctx] = canvas(W, H);
  const ax = W / 2, ay = H - 12;
  drawVoxels(ctx, landmarkModel(name), ax, ay, sc, Math.PI / 4);
  crispen(c);
  const spr = { c, ax, ay: ay + 9 };
  bCache.set(key, spr);
  return spr;
}

// ---------------------------------------------------------------- dadu 16x16

const PIPS: Record<number, [number, number][]> = {
  1: [[7, 7]],
  2: [[3, 3], [11, 11]],
  3: [[3, 3], [7, 7], [11, 11]],
  4: [[3, 3], [11, 3], [3, 11], [11, 11]],
  5: [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]],
  6: [[3, 3], [11, 3], [3, 7], [11, 7], [3, 11], [11, 11]],
};

export function drawDie(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, s: number) {
  ctx.fillStyle = OUT;
  ctx.fillRect(x + s, y, 14 * s, 16 * s);
  ctx.fillRect(x, y + s, 16 * s, 14 * s);
  ctx.fillStyle = '#fff8e7';
  ctx.fillRect(x + s, y + s, 14 * s, 14 * s);
  ctx.fillStyle = '#e6d6b8';
  ctx.fillRect(x + s, y + 13 * s, 14 * s, 2 * s);
  ctx.fillStyle = v === 1 ? '#c0392b' : OUT;
  for (const [px, py] of PIPS[v] ?? []) ctx.fillRect(x + px * s, y + py * s, 2 * s, 2 * s);
}
