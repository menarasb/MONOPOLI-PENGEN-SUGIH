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

// ---------------------------------------------------------------- rumah adat 8x8 (4 varian) & hotel 8x12

const HOUSE = ['...kk...', '..kRRk..', '.kRRRRk.', 'kRRRRRRk', '.wwwwww.', '.wkwwnw.', '.wkwwnw.', '.NNNNNN.'];
const HOUSE_ROOFS = ['#b0412e', '#3f8f4a', '#8b5a2b', '#2e6fb5'];
const HOTEL = ['.kkkkkk.', '.rrrrrr.', '.wbwwbw.', '.wwwwww.', '.wbwwbw.', '.wwwwww.', '.wbwwbw.', '.wwwwww.', '.wbwwbw.', '.wwwwww.', '.wwkkww.', '.SSSSSS.'];

const bCache = new Map<string, HTMLCanvasElement>();
export function building(kind: 'house' | 'hotel', variant = 0): HTMLCanvasElement {
  const key = kind + variant;
  const hit = bCache.get(key);
  if (hit) return hit;
  const rows = kind === 'house' ? HOUSE : HOTEL;
  const [c, ctx] = canvas(8, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < 8; x++) {
      const ch = row[x];
      const col = ch === 'R' ? HOUSE_ROOFS[variant % 4] : PAL[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  bCache.set(key, c);
  return c;
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
