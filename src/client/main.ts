import '@fontsource/press-start-2p/400.css';
import './style.css';
import { io, type Socket } from 'socket.io-client';
import { Engine, LEVEL_NAMES, MAX_LEVEL, shuffle, type PublicGameState } from '../shared/engine';
import { formatMoney as fmt } from '../shared/format';
import { REACTIONS, type ChatMessage, type ClientToServer, type JoinResult, type PublicRoom, type ServerToClient } from '../shared/protocol';
import { CHARACTER_DISCLAIMER, CHARACTERS, THEMES } from '../shared/theme';
import type { Action, CharacterParts, Expression, GameEvent, GameState, Offer, PlayerState, RoomSettings } from '../shared/types';
import { audio } from './audio';
import { BoardView } from './board';
import { avatarEl, HAIR_COLORS, head, PLAYER_COLORS, SHIRTS, SKINS } from './sprites';
import { T } from './strings';

const theme = THEMES.indonesia;
const engine = new Engine(theme);

// ---------------------------------------------------------------- state klien

interface Session {
  code: string;
  token: string;
  playerId: string;
}

const app = {
  room: null as PublicRoom | null,
  session: null as Session | null,
  chat: [] as ChatMessage[],
  tab: 'log' as 'log' | 'chat',
  clockOffset: 0,
  charOrder: shuffle(CHARACTERS.map((c) => c.id), { int: (n) => Math.floor(Math.random() * n) }),
  screen: '' as '' | 'home' | 'lobby' | 'game',
  bidDraft: '',
  shownGameOver: false,
  /** Persinggahan terakhir yang sudah ditawari pop-up upgrade (turnNo:posisi:dadu). */
  upgradePrompted: '',
  unreadChat: 0,
  seenTrades: new Set<number>(),
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const root = $('#app');

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function storage<T>(key: string, value?: T | null): T | null {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? 'null');
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* mode privat */
  }
  return null;
}

// ---------------------------------------------------------------- avatar (data URL, dicache)

const avatarCache = new Map<string, string>();
function avatarUrl(parts: CharacterParts, expr: Expression = 'normal'): string {
  const key = JSON.stringify(parts) + expr;
  let u = avatarCache.get(key);
  if (!u) {
    u = avatarEl(parts, expr, 2).toDataURL();
    avatarCache.set(key, u);
  }
  return u;
}

function avatarImg(parts: CharacterParts, expr: Expression = 'normal', cls = '') {
  return `<img class="pixel avatar ${cls}" src="${avatarUrl(parts, expr)}" alt="" width="64" height="64">`;
}

// ---------------------------------------------------------------- jaringan

const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'] });

function emitAck<K extends 'game:action' | 'lobby:settings' | 'lobby:start' | 'lobby:character' | 'room:playAgain'>(
  ev: K,
  ...args: unknown[]
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    (socket.emit as (...a: unknown[]) => void)(ev, ...args, (res: { ok: boolean; error?: string }) => {
      if (!res.ok && res.error) toast(res.error, true);
      resolve(res);
    });
  });
}

function act(a: Action) {
  audio.unlock();
  return emitAck('game:action', a);
}

socket.on('connect', () => {
  const s = app.session;
  if (s) {
    socket.emit('room:join', { code: s.code, name: '', token: s.token }, (res: JoinResult) => {
      if (!res.ok) {
        toast(res.error ?? 'Gagal kembali ke room', true);
        app.session = null;
        storage('mps.session', null);
        app.room = null;
        render();
      }
    });
  }
});
socket.on('disconnect', () => toast('Koneksi terputus, mencoba menyambung lagi…', true));

let pendingEvents: GameEvent[] = [];
socket.on('game:events', (ev) => {
  pendingEvents.push(...ev);
});
socket.on('room:state', (r) => {
  app.clockOffset = r.serverNow - Date.now();
  const prev = app.room;
  app.room = r;
  const evs = pendingEvents;
  pendingEvents = [];
  if (r.phase === 'lobby') app.shownGameOver = false;
  render(evs, prev);
});
socket.on('room:closed', (reason) => {
  toast(reason, true);
  leaveLocal();
});
socket.on('chat:history', (msgs) => {
  app.chat = msgs;
  renderChat();
});
socket.on('chat:msg', (m) => {
  app.chat.push(m);
  if (app.chat.length > 100) app.chat.shift();
  if (app.tab !== 'chat' && m.from !== app.session?.playerId) app.unreadChat++;
  renderChat();
  renderTabs();
});
socket.on('chat:reaction', ({ from, emoji }) => floatReaction(from, emoji));

function leaveLocal() {
  app.session = null;
  app.room = null;
  storage('mps.session', null);
  history.replaceState(null, '', '/');
  render();
}

// ---------------------------------------------------------------- toast & modal

function toast(text: string, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

let modalClose: (() => void) | null = null;
function openModal(html: string, opts: { onClose?: () => void; cls?: string; dismiss?: boolean } = {}): HTMLElement {
  closeModal();
  const m = $('#modal');
  m.className = 'modal open ' + (opts.cls ?? '');
  m.innerHTML = `<div class="modal-box">${opts.dismiss === false ? '' : '<button class="x" aria-label="Tutup">✕</button>'}${html}</div>`;
  modalClose = opts.onClose ?? null;
  m.onclick = (e) => {
    if (opts.dismiss !== false && (e.target === m || (e.target as HTMLElement).classList.contains('x'))) closeModal();
  };
  return m;
}
function closeModal() {
  const m = $('#modal');
  if (!m.classList.contains('open')) return;
  m.className = 'modal';
  m.innerHTML = '';
  const cb = modalClose;
  modalClose = null;
  cb?.();
}

// ---------------------------------------------------------------- routing awal

function codeFromUrl(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z]{6})$/) ?? location.search.match(/[?&]r=([A-Za-z]{6})/);
  return m ? m[1].toUpperCase() : null;
}

const saved = storage<Session>('mps.session');
const urlCode = codeFromUrl();
if (saved && (!urlCode || urlCode === saved.code)) app.session = saved;

// ---------------------------------------------------------------- render utama

function render(events: GameEvent[] = [], prev: PublicRoom | null = null) {
  const r = app.room;
  const screen = !app.session || !r ? 'home' : r.phase === 'lobby' ? 'lobby' : 'game';
  if (screen !== app.screen) {
    app.screen = screen;
    closeModal();
    if (screen === 'home') mountHome();
    if (screen === 'lobby') mountLobby();
    if (screen === 'game') mountGame();
  }
  if (screen === 'lobby') updateLobby();
  if (screen === 'game') updateGame(events, prev);
}

function headerBar(extra = '', leave = false) {
  return `<header class="bar">
    <div class="logo">MONOPOLI<small>Pengen Sugih</small></div>
    <div class="bar-mid">${extra}</div>
    <div class="bar-right">
      <button class="icon-btn" id="btn-music" title="${T.music}">${audio.musicOn ? '♫' : '<s>♫</s>'}</button>
      <button class="icon-btn" id="btn-sfx" title="${T.sfx}">${audio.sfxOn ? '🔊' : '🔇'}</button>
      <button class="icon-btn" id="btn-rules" title="${T.rules}">?</button>
      ${leave ? `<button class="icon-btn leave-btn" id="btn-leave" title="${T.leaveGame}">🚪</button>` : ''}
    </div>
  </header>`;
}

function bindHeader() {
  $('#btn-music').onclick = () => {
    audio.unlock();
    audio.setMusic(!audio.musicOn);
    $('#btn-music').innerHTML = audio.musicOn ? '♫' : '<s>♫</s>';
  };
  $('#btn-sfx').onclick = () => {
    audio.unlock();
    audio.setSfx(!audio.sfxOn);
    $('#btn-sfx').textContent = audio.sfxOn ? '🔊' : '🔇';
  };
  $('#btn-rules').onclick = showRules;
  const leave = document.getElementById('btn-leave');
  if (leave) leave.onclick = confirmLeaveGame;
}

function confirmLeaveGame() {
  const g = app.room?.game;
  const me = g?.players.find((p) => p.id === app.session?.playerId);
  const stillIn = g && me && !me.bankrupt && g.stage !== 'gameover';
  const msg = stillIn
    ? 'Yakin keluar dari permainan? Kamu dianggap bangkrut dan semua asetmu kembali ke bank.'
    : 'Keluar dari room ini?';
  if (!confirm(msg)) return;
  socket.emit('room:leave');
  leaveLocal();
}

function showRules() {
  openModal(`<h2>Aturan singkat</h2>
  <ul class="rules">
    <li>Lempar 2 dadu dan maju. Kembar = lempar lagi; kembar 3× = masuk penjara.</li>
    <li>Berhenti di properti kosong: beli, atau properti dilelang ke semua pemain (mulai 10, 15 detik setelah tawaran terakhir).</li>
    <li>Punya satu grup warna lengkap: sewa tanah kosong 2×.</li>
    <li>Upgrade bangunan hanya saat pionmu berhenti di kotamu sendiri, satu level tiap singgah: Rumah → Hotel → Mall → Landmark.</li>
    <li>Kota ber-Landmark tidak bisa diambil alih lawan, tapi pemiliknya tetap bisa menjual bangunannya saat butuh uang.</li>
    <li>Gadai = dapat 50% harga. Tebus = nilai gadai + bunga 10%. Properti tergadai tidak menarik sewa.</li>
    <li>Penjara: bayar ${fmt(theme.jailFine)}, pakai kartu Bebas, atau lempar kembar (maks. 3 giliran).</li>
    <li>Tidak sanggup bayar: jual bangunan / gadai dulu. Masih kurang = bangkrut.</li>
    <li>Lewat START dapat ${fmt(theme.salary)}. Semua nominal dalam Rp ribu.</li>
  </ul>
  <p class="muted">${esc(CHARACTER_DISCLAIMER)} ${esc(T.disclaimer)}</p>`);
}

// ---------------------------------------------------------------- beranda

function mountHome() {
  const code = urlCode ?? '';
  const name = storage<string>('mps.name') ?? '';
  const sample = CHARACTERS.slice(0, 7);
  root.innerHTML = `${headerBar()}
  <main class="home">
    <div class="hero">
      <div class="hero-heads">${sample.map((c, i) => avatarImg(c.parts, i % 3 === 0 ? 'senang' : 'normal', 'bob')).join('')}</div>
      <h1>MONOPOLI<br><span>Pengen Sugih</span></h1>
      <p>${T.tagline}</p>
    </div>
    <div class="panel home-form">
      <label>${T.nickname}<input id="name" maxlength="16" autocomplete="nickname" value="${esc(name)}" placeholder="mis. Budi"></label>
      ${code ? '' : `<button class="btn big primary" id="create">${T.createRoom}</button><div class="or">atau</div>`}
      <div class="join-row">
        <input id="code" maxlength="6" placeholder="${T.roomCode}" value="${esc(code)}" autocapitalize="characters">
        <button class="btn big ${code ? 'primary' : ''}" id="join">${T.joinRoom}</button>
      </div>
      ${code ? `<button class="btn link" id="create">…atau ${T.createRoom.toLowerCase()} baru</button>` : ''}
    </div>
    <p class="muted small disclaimer">${esc(T.disclaimer)}</p>
  </main>`;
  bindHeader();
  const nameEl = $<HTMLInputElement>('#name');
  const getName = () => {
    const n = nameEl.value.trim();
    if (!n) {
      toast('Isi nama panggilan dulu ya', true);
      nameEl.focus();
      return null;
    }
    storage('mps.name', n);
    return n;
  };
  const done = (res: JoinResult) => {
    if (!res.ok) return toast(res.error ?? 'Gagal', true);
    app.session = { code: res.code!, token: res.token!, playerId: res.playerId! };
    storage('mps.session', app.session);
    history.replaceState(null, '', `/r/${res.code}`);
  };
  $('#create').onclick = () => {
    audio.unlock();
    const n = getName();
    if (n) socket.emit('room:create', { name: n }, done);
  };
  $('#join').onclick = () => {
    audio.unlock();
    const n = getName();
    const c = $<HTMLInputElement>('#code').value.trim().toUpperCase();
    if (!n) return;
    if (!/^[A-Z]{6}$/.test(c)) return toast('Kode room harus 6 huruf', true);
    socket.emit('room:join', { code: c, name: n }, done);
  };
  $<HTMLInputElement>('#code').oninput = (e) => {
    const el = e.target as HTMLInputElement;
    el.value = el.value.toUpperCase().replace(/[^A-Z]/g, '');
  };
}

// ---------------------------------------------------------------- lobi

function myLobbyPlayer() {
  return app.room?.players.find((p) => p.id === app.session?.playerId);
}

function partsOf(p: PublicRoom['players'][number]): CharacterParts | null {
  if (p.customParts) return p.customParts;
  return CHARACTERS.find((c) => c.id === p.characterId)?.parts ?? null;
}

function mountLobby() {
  root.innerHTML = `${headerBar('<span id="room-code-bar"></span>')}
  <main class="lobby">
    <section class="panel share">
      <h2>${T.lobby} <span class="code" id="lobby-code"></span></h2>
      <p>${T.shareLink}</p>
      <div class="share-row"><input id="share-link" readonly><button class="btn" id="copy">${T.copy}</button><a class="btn wa" id="wa" target="_blank" rel="noopener">${T.shareWa}</a></div>
    </section>
    <section class="panel players-lobby"><h2>Pemain</h2><div id="lobby-players"></div></section>
    <section class="panel chars"><h2>${T.chooseChar}</h2><p class="muted small">${esc(CHARACTER_DISCLAIMER)} Urutan diacak.</p><div id="char-grid" class="char-grid"></div>
      <button class="btn" id="custom">${T.customChar}</button></section>
    <section class="panel settings"><h2>${T.settings}</h2><div id="settings"></div></section>
    <section class="panel lobby-actions">
      <button class="btn big" id="ready"></button>
      <button class="btn big primary" id="start">${T.start}</button>
      <p id="start-hint" class="muted small"></p>
      <button class="btn link" id="leave">${T.leave}</button>
    </section>
    <section class="panel lobby-chat"><h2>${T.chat}</h2><div id="chat-box"></div></section>
  </main>`;
  bindHeader();
  mountChat($('#chat-box'));
  $('#copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText($<HTMLInputElement>('#share-link').value);
      toast(T.copied);
    } catch {
      $<HTMLInputElement>('#share-link').select();
    }
  };
  $('#ready').onclick = () => {
    const me = myLobbyPlayer();
    if (!me?.characterId && !me?.customParts) return toast('Pilih karakter dulu', true);
    socket.emit('lobby:ready', !me.ready);
  };
  $('#start').onclick = () => emitAck('lobby:start');
  $('#leave').onclick = () => {
    socket.emit('room:leave');
    leaveLocal();
  };
  $('#custom').onclick = () => openCustomEditor();
}

const SETTING_DEFS: { key: keyof RoomSettings; label: string; options: [unknown, string][] }[] = [
  { key: 'maxPlayers', label: 'Jumlah pemain maks.', options: [[2, '2'], [3, '3'], [4, '4']] },
  { key: 'startMoney', label: 'Uang awal', options: [[10000, '10.000'], [15000, '15.000'], [20000, '20.000']] },
  { key: 'auction', label: 'Lelang', options: [[true, 'Aktif'], [false, 'Nonaktif']] },
  { key: 'freeParkingJackpot', label: 'Jackpot Parkir Bebas', options: [[false, 'Nonaktif'], [true, 'Aktif']] },
  { key: 'doubleSalaryOnGo', label: 'Gaji ganda tepat di START', options: [[false, 'Nonaktif'], [true, 'Aktif']] },
  { key: 'gameTimeLimitMin', label: 'Batas waktu permainan', options: [[0, 'Tidak ada'], [30, '30 menit'], [60, '60 menit'], [90, '90 menit']] },
  { key: 'turnTimeSec', label: 'Batas waktu per giliran', options: [[30, '30 detik'], [60, '60 detik'], [90, '90 detik']] },
];

function updateLobby() {
  const r = app.room!;
  const me = myLobbyPlayer();
  const isHost = r.hostId === app.session?.playerId;
  const link = `${location.origin}/r/${r.code}`;
  $('#lobby-code').textContent = r.code;
  $<HTMLInputElement>('#share-link').value = link;
  $<HTMLAnchorElement>('#wa').href = `https://wa.me/?text=${encodeURIComponent(`Yuk main Monopoli: Pengen Sugih! Kode room ${r.code}: ${link}`)}`;

  $('#lobby-players').innerHTML = r.players
    .map((p) => {
      const parts = partsOf(p);
      const charName = p.customParts ? p.customName : CHARACTERS.find((c) => c.id === p.characterId)?.name;
      return `<div class="lp ${p.connected ? '' : 'off'}">
        ${parts ? avatarImg(parts, p.ready ? 'senang' : 'normal') : '<div class="avatar empty">?</div>'}
        <div><b>${esc(p.name)}</b>${p.id === r.hostId ? ` <span class="tag">${T.host}</span>` : ''}${p.id === me?.id ? ' <span class="tag you">kamu</span>' : ''}
        <div class="small muted">${esc(charName ?? 'belum pilih karakter')}</div>
        <div class="small ${p.ready || p.id === r.hostId ? 'ok' : 'muted'}">${p.connected ? (p.id === r.hostId ? 'host' : p.ready ? 'SIAP' : 'belum siap') : `terputus (${p.reconnectLeft ?? 0} dtk)`}</div></div>
      </div>`;
    })
    .join('') + (r.players.length < r.settings.maxPlayers ? `<div class="lp empty-slot muted small">Menunggu pemain… (${r.players.length}/${r.settings.maxPlayers})</div>` : '');

  const taken = new Map(r.players.filter((p) => p.characterId).map((p) => [p.characterId!, p]));
  $('#char-grid').innerHTML = app.charOrder
    .filter((id) => r.enabledCharacters.includes(id))
    .map((id) => {
      const c = CHARACTERS.find((x) => x.id === id)!;
      const by = taken.get(id);
      const mine = by?.id === me?.id;
      return `<button class="char ${mine ? 'mine' : ''} ${by && !mine ? 'locked' : ''}" data-id="${id}" ${by && !mine ? 'disabled' : ''}>
        ${avatarImg(c.parts, mine ? 'senang' : 'normal')}<span>${esc(c.name)}</span>${by && !mine ? `<em>🔒 ${esc(by.name)}</em>` : ''}</button>`;
    })
    .join('');
  root.querySelectorAll<HTMLButtonElement>('.char').forEach((b) => {
    b.onclick = () => {
      audio.unlock();
      emitAck('lobby:character', { characterId: b.dataset.id });
    };
  });

  $('#settings').innerHTML = SETTING_DEFS.map(
    (d) => `<label class="setting"><span>${d.label}</span>
      <select data-key="${d.key}" ${isHost ? '' : 'disabled'}>${d.options
        .map(([v, l]) => `<option value='${JSON.stringify(v)}' ${r.settings[d.key] === v ? 'selected' : ''}>${l}</option>`)
        .join('')}</select></label>`,
  ).join('') + (isHost ? '' : `<p class="muted small">Hanya host yang bisa mengubah aturan.</p>`);
  root.querySelectorAll<HTMLSelectElement>('#settings select').forEach((sel) => {
    sel.onchange = () => emitAck('lobby:settings', { [sel.dataset.key!]: JSON.parse(sel.value) });
  });

  const readyBtn = $('#ready');
  readyBtn.style.display = isHost ? 'none' : '';
  readyBtn.textContent = me?.ready ? `✓ ${T.ready}` : T.notReady;
  readyBtn.classList.toggle('primary', !me?.ready);
  const startBtn = $<HTMLButtonElement>('#start');
  startBtn.style.display = isHost ? '' : 'none';
  const hasChar = (p: PublicRoom['players'][number]) => !!(p.characterId || p.customParts);
  const canStart = r.players.length >= 2 && r.players.every((p) => p.connected && hasChar(p) && (p.ready || p.id === r.hostId));
  startBtn.disabled = !canStart;
  $('#start-hint').textContent = isHost
    ? r.players.length < 2
      ? 'Butuh minimal 2 pemain.'
      : !canStart
        ? 'Tunggu semua pemain memilih karakter dan siap.'
        : 'Semua siap, gas!'
    : T.waitingHost;
}

function openCustomEditor() {
  const me = myLobbyPlayer();
  const parts: CharacterParts = me?.customParts ?? {
    face: 'oval',
    skin: 1,
    hair: 'pendek',
    hairColor: 0,
    headwear: 'none',
    glasses: false,
    mustache: false,
    shirt: 0,
  };
  let name = me?.customName ?? me?.name ?? '';
  const swatch = (arr: string[], key: 'skin' | 'hairColor' | 'shirt') =>
    `<div class="swatches" data-key="${key}">${arr.map((c, i) => `<button class="sw ${parts[key] === i ? 'on' : ''}" data-v="${i}" style="background:${c}" aria-label="warna ${i + 1}"></button>`).join('')}</div>`;
  const choice = (key: 'face' | 'hair' | 'headwear', opts: [string, string][]) =>
    `<div class="choices" data-key="${key}">${opts.map(([v, l]) => `<button class="ch ${parts[key] === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const m = openModal(`<h2>${T.customChar}</h2>
    <div class="editor">
      <div class="preview"><div id="prev"></div><div class="exprs" id="exprs"></div></div>
      <div class="controls">
        <label>Nama karakter<input id="cname" maxlength="16" value="${esc(name)}"></label>
        <h4>Bentuk wajah</h4>${choice('face', [['oval', 'Oval'], ['bulat', 'Bulat'], ['kotak', 'Kotak']])}
        <h4>Warna kulit</h4>${swatch(SKINS, 'skin')}
        <h4>Rambut</h4>${choice('hair', [['pendek', 'Pendek'], ['belah', 'Belah'], ['klimis', 'Klimis'], ['ikal', 'Ikal'], ['botak', 'Botak'], ['panjang', 'Panjang'], ['bob', 'Bob']])}
        <h4>Warna rambut</h4>${swatch(HAIR_COLORS, 'hairColor')}
        <h4>Penutup kepala</h4>${choice('headwear', [['none', 'Tidak ada'], ['peci', 'Peci'], ['kerudung', 'Kerudung'], ['topi', 'Topi']])}
        <div class="toggles"><label><input type="checkbox" id="glasses" ${parts.glasses ? 'checked' : ''}> Kacamata</label>
        <label><input type="checkbox" id="mustache" ${parts.mustache ? 'checked' : ''}> Kumis</label></div>
        <h4>Baju</h4>${swatch(SHIRTS, 'shirt')}
      </div>
    </div>
    <button class="btn big primary" id="save-custom">Pakai karakter ini</button>`);
  const refresh = () => {
    const prev = $('#prev', m);
    prev.innerHTML = '';
    prev.appendChild(avatarEl(parts, 'normal', 4));
    $('#exprs', m).innerHTML = (['normal', 'senang', 'sedih', 'kaget'] as Expression[])
      .map((e) => `<img class="pixel" src="${avatarEl(parts, e, 1).toDataURL()}" width="32" height="32" title="${e}">`)
      .join('');
  };
  refresh();
  m.querySelectorAll<HTMLElement>('.swatches, .choices').forEach((group) => {
    group.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        const key = group.dataset.key as keyof CharacterParts;
        const v = b.dataset.v!;
        (parts as unknown as Record<string, unknown>)[key] = group.classList.contains('swatches') ? Number(v) : v;
        group.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        refresh();
      };
    });
  });
  $<HTMLInputElement>('#glasses', m).onchange = (e) => {
    parts.glasses = (e.target as HTMLInputElement).checked;
    refresh();
  };
  $<HTMLInputElement>('#mustache', m).onchange = (e) => {
    parts.mustache = (e.target as HTMLInputElement).checked;
    refresh();
  };
  $('#save-custom', m).onclick = async () => {
    name = $<HTMLInputElement>('#cname', m).value.trim();
    const res = await emitAck('lobby:character', { custom: parts, name });
    if (res.ok) closeModal();
  };
}

// ---------------------------------------------------------------- chat

function mountChat(box: HTMLElement) {
  box.innerHTML = `<div class="chat-list" id="chat-list"></div>
    <div class="reactions">${REACTIONS.map((e) => `<button class="react" data-e="${e}">${e}</button>`).join('')}</div>
    <form class="chat-form" id="chat-form"><input id="chat-input" maxlength="200" placeholder="Ketik pesan…" autocomplete="off"><button class="btn">${T.send}</button></form>`;
  $<HTMLFormElement>('#chat-form', box).onsubmit = (e) => {
    e.preventDefault();
    const inp = $<HTMLInputElement>('#chat-input', box);
    if (inp.value.trim()) socket.emit('chat:send', inp.value);
    inp.value = '';
  };
  box.querySelectorAll<HTMLButtonElement>('.react').forEach((b) => (b.onclick = () => socket.emit('chat:react', b.dataset.e!)));
  renderChat();
}

function renderChat() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  const me = app.session?.playerId;
  list.innerHTML = app.chat
    .map((m) => `<div class="msg ${m.from === me ? 'mine' : ''}"><b style="color:${colorOf(m.from)}">${esc(m.name)}</b> ${esc(m.text)}</div>`)
    .join('') || '<p class="muted small">Belum ada pesan.</p>';
  list.scrollTop = list.scrollHeight;
}

function floatReaction(pid: string, emoji: string) {
  const target = document.querySelector(`[data-pid="${pid}"] .avatar`) ?? document.querySelector('#board-wrap');
  if (!target) return;
  const r = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-react';
  el.textContent = emoji;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ---------------------------------------------------------------- permainan

let board: BoardView | null = null;

function colorOf(pid: string): string {
  const g = app.room?.game;
  const idx = g ? g.players.findIndex((p) => p.id === pid) : app.room?.players.findIndex((p) => p.id === pid) ?? -1;
  return PLAYER_COLORS[idx >= 0 ? idx % 4 : 0];
}

function game(): PublicGameState {
  return app.room!.game!;
}
function asState(): GameState {
  return game() as unknown as GameState;
}
function meP(): PlayerState | undefined {
  return game().players.find((p) => p.id === app.session?.playerId);
}
function pname(id: string | null) {
  return game().players.find((p) => p.id === id)?.name ?? 'Bank';
}

function mountGame() {
  root.innerHTML = `${headerBar('<span class="turn-timer" id="timer"></span>', true)}
  <main class="game">
    <div id="board-wrap"></div>
    <aside class="side">
      <div id="actions" class="panel actions"></div>
      <div id="players" class="players"></div>
      <div class="panel tabs-panel">
        <div class="tabs" id="tabs"></div>
        <div id="tab-log" class="log"></div>
        <div id="tab-chat" class="chat-tab"></div>
      </div>
    </aside>
  </main>`;
  bindHeader();
  board = new BoardView(theme);
  moneyTarget.clear();
  moneyShown.clear();
  moneyTweens.clear();
  board.onTile = (i) => showTile(i);
  board.onCard = (deck, text) => showCard(deck, text);
  $('#board-wrap').appendChild(board.canvas);
  mountChat($('#tab-chat'));
  renderTabs();
  fitBoard();
  board.canvas.addEventListener('click', () => audio.unlock());
}

function fitBoard() {
  const wrap = document.getElementById('board-wrap');
  if (!wrap || !board) return;
  const mobile = window.innerWidth < 900;
  const avail = mobile ? wrap.clientWidth : Math.min(wrap.clientWidth, window.innerHeight - 64);
  // Kanvas internal 960px (= papan 480 logis ×2). Skala bilangan bulat bila muat (×1 = 960, ×2 = 1920);
  // di layar lebih kecil diskalakan pas ruang yang tersedia.
  const size = avail >= 960 ? Math.floor(avail / 960) * 960 : Math.max(280, Math.floor(avail));
  board.canvas.style.width = `${size}px`;
  board.canvas.style.height = `${size}px`;
}
window.addEventListener('resize', fitBoard);

function renderTabs() {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  tabs.innerHTML = `<button class="tab ${app.tab === 'log' ? 'on' : ''}" data-t="log">${T.log}</button>
    <button class="tab ${app.tab === 'chat' ? 'on' : ''}" data-t="chat">${T.chat}${app.unreadChat ? ` <span class="badge">${app.unreadChat}</span>` : ''}</button>`;
  tabs.querySelectorAll<HTMLButtonElement>('.tab').forEach(
    (b) =>
      (b.onclick = () => {
        app.tab = b.dataset.t as 'log' | 'chat';
        if (app.tab === 'chat') app.unreadChat = 0;
        renderTabs();
      }),
  );
  $('#tab-log').style.display = app.tab === 'log' ? '' : 'none';
  $('#tab-chat').style.display = app.tab === 'chat' ? '' : 'none';
  if (app.tab === 'chat') renderChat();
}

function updateGame(events: GameEvent[], _prev: PublicRoom | null) {
  const g = game();
  if (!board) return;
  g.players.forEach((p, i) => board!.colors.set(p.id, PLAYER_COLORS[i % 4]));
  board.setState(g, events);
  for (const ev of events) if (ev.t === 'toast') toast(ev.text);
  trackMoney(g);
  renderPlayers();
  renderActions();
  renderLog();
  notifyTrades();
  board.after(promptUpgrade);
  if (g.stage === 'gameover' && !app.shownGameOver) {
    app.shownGameOver = true;
    const wait = () => (board?.busy ? setTimeout(wait, 300) : showGameOver());
    setTimeout(wait, 600);
  }
}

// ---------------------------------------------------------------- animasi & notifikasi uang

/** nilai uang terakhir dari server, nilai yang sedang ditampilkan, dan animasi hitung berjalan */
const moneyTarget = new Map<string, number>();
const moneyShown = new Map<string, number>();
const moneyTweens = new Map<string, { from: number; to: number; t0: number; dir: 'up' | 'down' }>();
let moneyRaf = 0;

function trackMoney(g: PublicGameState) {
  const diffs: { pid: string; delta: number; to: number }[] = [];
  for (const p of g.players) {
    const prev = moneyTarget.get(p.id);
    moneyTarget.set(p.id, p.money);
    if (prev === undefined) moneyShown.set(p.id, p.money);
    else if (prev !== p.money) diffs.push({ pid: p.id, delta: p.money - prev, to: p.money });
  }
  // tampilkan setelah dadu & bidak selesai bergerak, supaya terasa "saat mendarat"
  if (diffs.length) board?.after(() => diffs.forEach((d, k) => setTimeout(() => moneyChanged(d.pid, d.delta, d.to), k * 140)));
}

function moneyChanged(pid: string, delta: number, to: number) {
  if (app.screen !== 'game' || !app.room?.game) return;
  const p = game().players.find((x) => x.id === pid);
  if (!p) return;
  const from = moneyShown.get(pid) ?? to - delta;
  moneyTweens.set(pid, { from, to, t0: performance.now(), dir: delta > 0 ? 'up' : 'down' });
  if (!moneyRaf) moneyRaf = requestAnimationFrame(tickMoney);
  board?.floatMoney(pid, delta);
  moneyToast(pid, delta);
  moneyPop(pid, delta);
}

function tickMoney(now: number) {
  moneyRaf = 0;
  const DUR = 900;
  for (const [pid, tw] of moneyTweens) {
    const k = Math.min(1, (now - tw.t0) / DUR);
    const e = 1 - Math.pow(1 - k, 3);
    moneyShown.set(pid, Math.round(tw.from + (tw.to - tw.from) * e));
    const el = document.querySelector<HTMLElement>(`.pcard[data-pid="${pid}"] .money`);
    const p = app.room?.game?.players.find((x) => x.id === pid);
    if (el && p && !p.bankrupt) {
      el.textContent = fmt(moneyShown.get(pid)!);
      el.classList.toggle('up', k < 1 && tw.dir === 'up');
      el.classList.toggle('down', k < 1 && tw.dir === 'down');
    }
    if (k >= 1) moneyTweens.delete(pid);
  }
  if (moneyTweens.size) moneyRaf = requestAnimationFrame(tickMoney);
}

function moneyToast(pid: string, delta: number) {
  const box = $('#money-toasts');
  // taruh di area laut di tengah papan supaya tidak menutupi tombol aksi
  const br = board?.canvas.getBoundingClientRect();
  if (br && br.width > 0 && window.innerWidth > 520) {
    box.style.left = `${br.left + br.width / 2}px`;
    box.style.top = `${Math.max(8, br.top + br.height * 0.2)}px`;
  } else {
    box.style.left = '50%';
    box.style.top = '8px';
  }
  const up = delta > 0;
  const mine = pid === app.session?.playerId;
  const el = document.createElement('div');
  el.className = `mtoast ${up ? 'up' : 'down'} ${mine ? 'mine' : ''}`;
  el.style.setProperty('--pc', colorOf(pid));
  el.innerHTML = `<span class="mt-ico">${up ? '💰' : '💸'}</span><span class="mt-txt"><span class="mt-name">${mine ? 'Kamu' : esc(pname(pid))}</span>${up ? 'dapat' : 'bayar'}</span><b class="mt-amt">${up ? '+' : '−'}${fmt(Math.abs(delta))}</b>`;
  box.appendChild(el);
  while (box.children.length > 4) box.firstElementChild!.remove();
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

function moneyPop(pid: string, delta: number) {
  const target = document.querySelector(`.pcard[data-pid="${pid}"] .money`);
  if (!target) return;
  const r = target.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return;
  const up = delta > 0;
  const el = document.createElement('div');
  el.className = `money-pop ${up ? 'up' : 'down'}`;
  el.textContent = `${up ? '+' : '−'}${fmt(Math.abs(delta))}`;
  el.style.left = `${r.right + 10}px`;
  el.style.top = `${r.top - 2}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
  // koin pixel memancar (dapat) atau jatuh (bayar)
  const n = Math.min(8, 3 + Math.floor(Math.log10(Math.abs(delta) + 1) * 1.5));
  for (let k = 0; k < n; k++) {
    const c = document.createElement('div');
    c.className = `coin ${up ? 'up' : 'down'}`;
    c.style.left = `${r.left + 10 + Math.random() * 30}px`;
    c.style.top = `${r.top + 6}px`;
    c.style.setProperty('--dx', `${(Math.random() - 0.5) * 80}px`);
    c.style.setProperty('--dy', `${up ? -(30 + Math.random() * 40) : 30 + Math.random() * 40}px`);
    c.style.animationDelay = `${k * 40}ms`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 1100 + k * 40);
  }
}

function renderLog() {
  const el = document.getElementById('tab-log');
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  el.innerHTML = game()
    .log.slice(-80)
    .map((l) => `<div class="log-line ${l.text.startsWith('—') ? 'turn' : ''}">${esc(l.text)}</div>`)
    .join('');
  if (atBottom || true) el.scrollTop = el.scrollHeight;
}

function renderPlayers() {
  const g = game();
  const cur = g.players[g.turnIndex];
  const roomPlayers = new Map(app.room!.players.map((p) => [p.id, p]));
  $('#players').innerHTML = g.players
    .map((p, i) => {
      const rp = roomPlayers.get(p.id);
      const tiles = engine.ownedTiles(asState(), p.id).sort((a, b) => a - b);
      const chips = tiles
        .map((t) => {
          const tile = theme.tiles[t];
          const grp = theme.groups.find((x) => x.id === tile.group);
          const o = g.props[t];
          const col = grp?.color ?? (tile.type === 'transport' ? '#444' : '#999');
          return `<span class="chip ${o.mortgaged ? 'mort' : ''}" style="background:${col}" title="${esc(tile.name)}${o.houses ? ` (${LEVEL_NAMES[o.houses]})` : ''}${o.mortgaged ? ' — tergadai' : ''}">${o.houses ? LEVEL_NAMES[o.houses][0] : ''}</span>`;
        })
        .join('');
      return `<div class="pcard ${p.id === cur.id && g.stage !== 'gameover' ? 'turn' : ''} ${p.bankrupt ? 'dead' : ''}" data-pid="${p.id}" style="--pc:${PLAYER_COLORS[i % 4]}">
        ${avatarImg(p.character.parts, p.expression)}
        <div class="pinfo">
          <div class="pname">${esc(p.name)}${p.id === app.session?.playerId ? ' <span class="tag you">kamu</span>' : ''}${app.room!.hostId === p.id ? ' <span class="tag">host</span>' : ''}</div>
          <div class="small muted">${esc(p.character.name)}</div>
          <div class="money ${moneyTweens.get(p.id)?.dir ?? ''}">${p.bankrupt ? 'BANGKRUT' : fmt(moneyShown.get(p.id) ?? p.money)}</div>
          <div class="flags small">${p.inJail ? '<span class="tag jail">di penjara</span>' : ''}${p.jailFreeCards.length ? `<span class="tag">🎫×${p.jailFreeCards.length}</span>` : ''}${rp && !rp.connected ? `<span class="tag off">terputus${rp.reconnectLeft !== null ? ` ${rp.reconnectLeft}s` : ''}</span>` : ''}</div>
          <div class="chips">${chips}</div>
        </div>
      </div>`;
    })
    .join('');
  root.querySelectorAll<HTMLElement>('.pcard').forEach((el) => {
    el.onclick = () => showPlayer(el.dataset.pid!);
  });
}

function timeLeft(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - (Date.now() + app.clockOffset)) / 1000));
}

setInterval(() => {
  if (app.screen !== 'game' || !app.room?.game) return;
  const g = game();
  const el = document.getElementById('timer');
  if (el) {
    if (g.stage === 'gameover') el.textContent = 'Selesai';
    else {
      const left = g.stage === 'auction' && g.auction ? timeLeft(g.auction.endsAt) : timeLeft(g.turnDeadline);
      const total = g.endsAt ? ` · sisa ${Math.max(0, Math.ceil((g.endsAt - Date.now() - app.clockOffset) / 60000))} mnt` : '';
      el.textContent = `⏱ ${left}s${total}`;
      el.classList.toggle('hurry', left <= 10);
    }
  }
  const at = document.getElementById('auction-left');
  if (at && g.auction) at.textContent = `${timeLeft(g.auction.endsAt)}s`;
}, 250);

function tileTitle(i: number) {
  const t = theme.tiles[i];
  const grp = theme.groups.find((x) => x.id === t.group);
  return `<div class="tile-title" style="--gc:${grp?.color ?? '#5b6770'}"><span class="gl">${grp?.letter ?? ''}</span>${esc(t.name)}</div>`;
}

/** Tombol upgrade bila pemain sedang berhenti di kotanya sendiri (hanya di sana boleh upgrade). */
function upgradeBox(pid: string): string {
  const s = asState();
  const p = s.players.find((x) => x.id === pid);
  if (!p || s.dice === null) return '';
  const i = p.position;
  const t = theme.tiles[i];
  const o = s.props[i];
  if (t.type !== 'city' || !o || o.owner !== pid) return '';
  if (o.houses >= MAX_LEVEL)
    return `<p class="ok small">🏛 ${esc(t.name)} sudah ber-Landmark ${esc(t.landmark ?? '')}. Aman dari ambil alih!</p>`;
  const err = engine.canBuild(s, pid, i);
  if (err === 'Sudah upgrade di persinggahan ini') return `<p class="small muted">Sudah upgrade ${esc(t.name)} kali ini. Singgah lagi untuk level berikutnya.</p>`;
  const next = o.houses + 1;
  const label = next === MAX_LEVEL ? `🏛 Bangun Landmark ${t.landmark ?? ''}` : `🏗 Upgrade ke ${LEVEL_NAMES[next]}`;
  return `<p class="small">Kamu berhenti di kotamu sendiri. Sewa ${LEVEL_NAMES[next]}: <b>${fmt(t.rent![next])}</b>.</p>
    <div class="btns"><button class="btn big" data-build="${i}" ${err ? `disabled title="${esc(err)}"` : ''}>${esc(label)} ${fmt(engine.levelCost(i, next))}</button></div>`;
}

/** Pop-up "Bangun Rumah?" begitu pion berhenti di kota milik sendiri (sekali per persinggahan). */
function promptUpgrade() {
  const g = app.room?.game;
  const me = meP();
  if (!g || !me || me.bankrupt || g.dice === null) return;
  if (g.players[g.turnIndex].id !== me.id || (g.stage !== 'end' && g.stage !== 'roll')) return;
  const i = me.position;
  const t = theme.tiles[i];
  const o = g.props[i];
  if (t.type !== 'city' || !o || o.owner !== me.id || o.houses >= MAX_LEVEL) return;
  const key = `${g.turnNo}:${i}:${g.dice.join('')}`;
  if (app.upgradePrompted === key) return;
  const err = engine.canBuild(asState(), me.id, i);
  if (err && err !== 'Uang tidak cukup') return;
  if ($('#modal').classList.contains('open')) return;
  app.upgradePrompted = key;
  const next = o.houses + 1;
  const cost = engine.levelCost(i, next);
  const what = next === MAX_LEVEL ? `Landmark ${t.landmark ?? ''}` : LEVEL_NAMES[next];
  const m = openModal(`${tileTitle(i)}<p>Kamu berhenti di kotamu sendiri! Bangun <b>${esc(what)}</b> seharga <b>${fmt(cost)}</b>?</p>
    <p class="small">Sewa naik dari ${fmt(engine.rentFor(asState(), i, 7))} jadi <b>${fmt(t.rent![next])}</b>.${next === MAX_LEVEL ? ' Landmark tidak bisa diambil alih lawan.' : ''}</p>
    ${err ? `<p class="bad">Uang kurang ${fmt(cost - me.money)}.</p>` : ''}
    <div class="btns"><button class="btn big primary" data-up="yes" ${err ? 'disabled' : ''}>${next === MAX_LEVEL ? '🏛' : '🏗'} Bangun ${esc(LEVEL_NAMES[next])}</button><button class="btn big" data-up="no">Nanti</button></div>`);
  m.querySelectorAll<HTMLButtonElement>('[data-up]').forEach(
    (b) =>
      (b.onclick = () => {
        closeModal();
        if (b.dataset.up === 'yes') void act({ type: 'build', tile: i });
      }),
  );
}

function renderActions() {
  const g = game();
  const me = meP();
  const cur = g.players[g.turnIndex];
  const myTurn = cur.id === me?.id;
  const el = $('#actions');
  let html = '';
  const btn = (id: string, label: string, cls = '', disabled = false) =>
    `<button class="btn big ${cls}" data-act="${id}" ${disabled ? 'disabled' : ''}>${label}</button>`;

  if (!me) html = '<p>Kamu menonton permainan ini.</p>';
  else if (me.bankrupt && g.stage !== 'gameover') html = '<p>Kamu sudah bangkrut. Tetap nonton dan ramaikan chat ya!</p>';
  else
    switch (g.stage) {
      case 'roll':
        if (myTurn) {
          html = `<p class="prompt">Giliranmu!${me.inJail ? ` Kamu di penjara (percobaan ${me.jailTurns + 1}/${theme.maxJailTurns}).` : ''}</p>${upgradeBox(me.id)}
          <div class="btns">${btn('roll', `🎲 ${me.inJail ? 'Coba Kembar' : T.roll}`, 'primary')}
          ${me.inJail ? btn('payJail', `${T.payJail} ${fmt(theme.jailFine)}`, '', me.money < theme.jailFine) : ''}
          ${me.inJail && me.jailFreeCards.length ? btn('useJailCard', T.useCard) : ''}</div>`;
        } else html = `<p class="prompt">Menunggu <b>${esc(cur.name)}</b> melempar dadu…</p>`;
        break;
      case 'buy': {
        const i = g.pendingBuy!;
        const t = theme.tiles[i];
        if (myTurn)
          html = `${tileTitle(i)}<p>Beli seharga <b>${fmt(t.price!)}</b>? Uangmu ${fmt(me.money)}.</p>
          <div class="btns">${btn('buy', `${T.buy} ${fmt(t.price!)}`, 'primary', me.money < t.price!)}${btn('decline', g.settings.auction ? 'Lelang saja' : T.skipBuy)}</div>
          <button class="btn link" data-tile="${i}">Lihat detail sewa</button>`;
        else html = `<p class="prompt"><b>${esc(cur.name)}</b> sedang memutuskan membeli ${esc(t.name)}…</p>`;
        break;
      }
      case 'takeover': {
        const i = g.pendingTakeover!;
        const t = theme.tiles[i];
        const o = g.props[i];
        const price = engine.takeoverPrice(asState(), i);
        const owner = pname(o.owner);
        const bld = o.houses > 0 ? ` + ${LEVEL_NAMES[o.houses]}` : '';
        if (myTurn) {
          const free = me.money - engine.debtOf(asState(), me.id);
          html = `${tileTitle(i)}<p>Ambil alih dari <b>${esc(owner)}</b>${bld}? Bayar <b>${fmt(price)}</b> (2x harga) ke ${esc(owner)}. Uangmu ${fmt(me.money)}.</p>
          ${free < price ? `<p class="bad">Uang kurang ${fmt(price - free)}. Gadai/jual aset dulu kalau mau ambil alih.</p>` : ''}
          <div class="btns">${btn('takeover', `${T.takeover} ${fmt(price)}`, 'primary', free < price)}${btn('declineTakeover', T.skipBuy)}</div>
          <button class="btn link" data-tile="${i}">Lihat detail sewa</button>`;
        } else
          html = `<p class="prompt"><b>${esc(cur.name)}</b> sedang menimbang mengambil alih ${esc(t.name)} milik ${esc(owner)} (${fmt(price)})…</p>`;
        break;
      }
      case 'auction': {
        const a = g.auction!;
        const t = theme.tiles[a.tile];
        const min = Math.max(theme.auction.minBid, a.highBid + 1);
        const leading = a.highBidder === me.id;
        html = `<p class="prompt">🔨 LELANG <span class="auction-left" id="auction-left">${timeLeft(a.endsAt)}s</span></p>${tileTitle(a.tile)}
          <p>Harga normal ${fmt(t.price!)}. Tawaran tertinggi: <b>${a.highBidder ? `${fmt(a.highBid)} oleh ${esc(pname(a.highBidder))}` : 'belum ada'}</b></p>
          ${leading ? '<p class="ok">Kamu penawar tertinggi!</p>' : ''}
          <div class="btns bid-quick">${[10, 50, 100, 500]
            .map((d) => {
              const v = Math.max(min, a.highBid + d);
              return `<button class="btn" data-bid="${v}" ${leading || v > me.money ? 'disabled' : ''}>${fmt(v)}</button>`;
            })
            .join('')}</div>
          <div class="bid-row"><input id="bid-input" type="number" inputmode="numeric" min="${min}" step="10" placeholder="${min}" value="${esc(app.bidDraft)}"><button class="btn primary" data-act="bid" ${leading ? 'disabled' : ''}>${T.bid}</button></div>`;
        break;
      }
      case 'debt': {
        const owed = engine.debtOf(asState(), me.id);
        if (owed > 0) {
          const liq = engine.liquidationValue(asState(), me.id);
          html = `<p class="prompt bad">Kamu harus membayar ${fmt(owed)}!</p><p>Uangmu ${fmt(me.money)}. Jual bangunan atau gadaikan properti untuk menutup kekurangan.</p>
          <div class="btns">${btn('payDebt', `${T.pay} ${fmt(owed)}`, 'primary', me.money < owed)}${btn('manage', T.manage)}
          ${liq < owed ? btn('bankrupt', T.bankrupt, 'danger') : ''}</div>`;
        } else {
          const debtors = [...new Set(g.debts.map((d) => pname(d.debtor)))];
          html = `<p class="prompt">Menunggu ${esc(debtors.join(', '))} melunasi utang…</p>`;
        }
        break;
      }
      case 'end':
        if (myTurn) html = `<p class="prompt">Gadai atau tukar sekarang. Kalau sudah, akhiri giliran.</p>${upgradeBox(me.id)}<div class="btns">${btn('endTurn', T.endTurn, 'primary')}</div>`;
        else html = `<p class="prompt"><b>${esc(cur.name)}</b> sedang mengatur strategi…</p>`;
        break;
      case 'gameover':
        html = `<p class="prompt">🏆 ${esc(pname(g.winner))} menang!</p><div class="btns">${btn('results', 'Lihat hasil', 'primary')}</div>`;
        break;
    }

  const myTrades = me ? g.trades.filter((t) => t.to === me.id || t.from === me.id) : [];
  if (myTrades.length)
    html += `<div class="trades">${myTrades
      .map((t) =>
        t.to === me!.id
          ? `<button class="btn trade-in" data-trade="${t.id}">📨 Tawaran dari ${esc(pname(t.from))}</button>`
          : `<button class="btn link" data-trade="${t.id}">Tawaranmu ke ${esc(pname(t.to))} (menunggu)</button>`,
      )
      .join('')}</div>`;
  if (me && !me.bankrupt && g.stage !== 'gameover' && g.stage !== 'auction')
    html += `<div class="btns secondary">${btn('manage', `🏠 ${T.manage}`)}${btn('trade', `🤝 ${T.trade}`)}</div>`;

  el.innerHTML = html;
  el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
    b.onclick = () => {
      const a = b.dataset.act!;
      if (a === 'manage') return showManage();
      if (a === 'trade') return showTradeComposer();
      if (a === 'results') return showGameOver();
      if (a === 'bankrupt') {
        if (confirm('Yakin menyatakan bangkrut? Semua asetmu akan diserahkan.')) act({ type: 'bankrupt' });
        return;
      }
      if (a === 'bid') {
        const v = Number($<HTMLInputElement>('#bid-input').value);
        app.bidDraft = '';
        return act({ type: 'bid', amount: v });
      }
      act({ type: a } as Action);
    };
  });
  el.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((b) => (b.onclick = () => act({ type: 'build', tile: Number(b.dataset.build) })));
  el.querySelectorAll<HTMLButtonElement>('[data-bid]').forEach((b) => (b.onclick = () => act({ type: 'bid', amount: Number(b.dataset.bid) })));
  el.querySelectorAll<HTMLButtonElement>('[data-trade]').forEach((b) => (b.onclick = () => showTrade(Number(b.dataset.trade))));
  el.querySelectorAll<HTMLButtonElement>('[data-tile]').forEach((b) => (b.onclick = () => showTile(Number(b.dataset.tile))));
  const bi = document.getElementById('bid-input') as HTMLInputElement | null;
  if (bi) bi.oninput = () => (app.bidDraft = bi.value);
}

// ---------------------------------------------------------------- pop-up

function showCard(deck: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = `card-pop ${deck}`;
    el.innerHTML = `<div class="card-inner"><div class="card-back">${deck === 'chance' ? '?' : '◆'}</div>
      <div class="card-front"><h3>${deck === 'chance' ? 'KESEMPATAN' : 'DANA UMUM'}</h3><p>${esc(text)}</p></div></div>`;
    document.body.appendChild(el);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 250);
      resolve();
    };
    el.onclick = finish;
    setTimeout(finish, 3800);
  });
}

function rentTable(i: number) {
  const t = theme.tiles[i];
  if (t.type === 'city') {
    const r = t.rent!;
    const rows = [['Sewa dasar', r[0], ''], ['Grup lengkap', r[0] * 2, '']];
    for (let k = 1; k <= MAX_LEVEL; k++)
      rows.push([k === MAX_LEVEL ? `Landmark${t.landmark ? ` (${esc(t.landmark)})` : ''}` : LEVEL_NAMES[k], r[k], fmt(engine.levelCost(i, k))]);
    return `<table class="rent"><tr class="muted small"><td></td><td>Sewa</td><td>Biaya bangun</td></tr>${rows.map(([l, v, c]) => `<tr><td>${l}</td><td>${fmt(v as number)}</td><td>${c}</td></tr>`).join('')}
      <tr><td>Nilai gadai</td><td>${fmt(engine.mortgageValue(i))}</td><td></td></tr></table>
      <p class="small muted">Upgrade hanya saat berhenti di kota ini. Landmark tidak bisa diambil alih.</p>`;
  }
  if (t.type === 'transport')
    return `<table class="rent">${theme.transportRents.map((v, k) => `<tr><td>Punya ${k + 1} transportasi</td><td>${fmt(v)}</td></tr>`).join('')}<tr><td>Nilai gadai</td><td>${fmt(engine.mortgageValue(i))}</td></tr></table>`;
  if (t.type === 'utility')
    return `<p>Sewa = total dadu × ${theme.utilityMultipliers[0]} × ${theme.utilityScale} (punya 1), atau × ${theme.utilityMultipliers[1]} × ${theme.utilityScale} (punya 2).</p><table class="rent"><tr><td>Nilai gadai</td><td>${fmt(engine.mortgageValue(i))}</td></tr></table>`;
  if (t.type === 'tax') return `<p>Bayar ${fmt(t.amount!)}.</p>`;
  const desc: Record<string, string> = {
    go: `Terima ${fmt(theme.salary)} setiap lewat atau berhenti.`,
    chance: 'Ambil kartu Kesempatan.',
    community: 'Ambil kartu Dana Umum.',
    jail: 'Hanya mampir, atau tempat pemain yang dipenjara.',
    parking: 'Istirahat. Jika jackpot aktif, ambil semua uang di pot!',
    gotojail: 'Langsung masuk penjara tanpa lewat START.',
  };
  return `<p>${desc[t.type] ?? ''}</p>`;
}

function showTile(i: number) {
  if (!board) return;
  board.highlight = i;
  const t = theme.tiles[i];
  const o = app.room?.game?.props[i];
  const ownerTxt = o ? (o.owner ? `Milik <b style="color:${colorOf(o.owner)}">${esc(pname(o.owner))}</b>${o.mortgaged ? ' (tergadai)' : ''}${o.houses ? ` · ${LEVEL_NAMES[o.houses]}` : ''}` : 'Belum ada pemilik') : '';
  openModal(`${tileTitle(i)}${t.price ? `<p>Harga ${fmt(t.price)}</p>` : ''}${rentTable(i)}<p>${ownerTxt}</p>`, {
    onClose: () => board && (board.highlight = null),
  });
}

function showPlayer(pid: string) {
  const g = game();
  const p = g.players.find((x) => x.id === pid)!;
  const tiles = engine.ownedTiles(asState(), pid).sort((a, b) => a - b);
  openModal(`<div class="pdetail">${avatarImg(p.character.parts, p.expression)}<div><h2>${esc(p.name)}</h2><p class="muted">${esc(p.character.name)}</p>
    <p>Uang ${fmt(p.money)} · Total aset ${fmt(engine.netWorth(asState(), pid))}</p></div></div>
    <ul class="plist">${tiles.map((i) => `<li>${tileTitle(i)} <span class="small">${g.props[i].mortgaged ? 'tergadai' : g.props[i].houses ? LEVEL_NAMES[g.props[i].houses] : ''}</span></li>`).join('') || '<li class="muted">Belum punya properti</li>'}</ul>`);
}

function showManage() {
  const me = meP();
  if (!me) return;
  const render = () => {
    const s = asState();
    const tiles = engine.ownedTiles(s, me.id).sort((a, b) => a - b);
    const box = $('#manage-list');
    if (!box) return;
    box.innerHTML =
      tiles
        .map((i) => {
          const t = theme.tiles[i];
          const o = s.props[i];
          const can = (r: string | null) => (r ? `disabled title="${esc(r)}"` : '');
          const status = o.mortgaged ? 'Tergadai' : t.type === 'city' ? LEVEL_NAMES[o.houses] + (o.houses === MAX_LEVEL ? ' 🏛' : '') : '';
          let buttons = '';
          if (t.type === 'city' && !o.mortgaged) {
            if (o.houses < MAX_LEVEL)
              buttons += `<button class="btn sm" data-m="build" data-i="${i}" ${can(engine.canBuild(s, me.id, i))}>+${LEVEL_NAMES[o.houses + 1]} ${fmt(engine.levelCost(i, o.houses + 1))}</button>`;
            if (o.houses) buttons += `<button class="btn sm" data-m="sell" data-i="${i}" ${can(engine.canSell(s, me.id, i))}>Jual ${LEVEL_NAMES[o.houses]} +${fmt(engine.buildingSellValue(s, i))}</button>`;
          }
          if (!o.mortgaged) buttons += `<button class="btn sm" data-m="mortgage" data-i="${i}" ${can(engine.canMortgage(s, me.id, i))}>Gadai +${fmt(engine.mortgageValue(i))}</button>`;
          else buttons += `<button class="btn sm" data-m="unmortgage" data-i="${i}" ${me.money < engine.unmortgageCost(i) ? 'disabled' : ''}>Tebus ${fmt(engine.unmortgageCost(i))}</button>`;
          return `<div class="mrow">${tileTitle(i)}<div class="small muted">${status}</div><div class="mbtns">${buttons}</div></div>`;
        })
        .join('') || '<p class="muted">Kamu belum punya properti.</p>';
    $('#manage-money').textContent = fmt(game().players.find((p) => p.id === me.id)!.money);
    $('#manage-stock').textContent = 'Upgrade hanya saat berhenti di kotamu sendiri.';
    box.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(
      (b) => (b.onclick = async () => {
        await act({ type: b.dataset.m, tile: Number(b.dataset.i) } as Action);
      }),
    );
  };
  openModal(`<h2>${T.manage}</h2><p>Uang: <b id="manage-money"></b> · <span id="manage-stock" class="small muted"></span></p>
    <p class="small muted">Bangun harus merata di satu grup warna lengkap. Bangunan dijual 50% dari biaya.</p><div id="manage-list" class="manage"></div>`, {
    onClose: () => (manageRefresh = null),
  });
  manageRefresh = render;
  render();
}
let manageRefresh: (() => void) | null = null;

function offerSummary(o: Offer) {
  const parts = [] as string[];
  if (o.money) parts.push(fmt(o.money));
  for (const i of o.tiles) parts.push(esc(theme.tiles[i].name));
  if (o.jailCards) parts.push(`${o.jailCards} kartu Bebas Penjara`);
  return parts.length ? parts.join(', ') : '—';
}

function showTrade(id: number) {
  const g = game();
  const t = g.trades.find((x) => x.id === id);
  if (!t) return;
  const incoming = t.to === app.session?.playerId;
  const m = openModal(`<h2>Tukar-menukar</h2>
    <p><b>${esc(pname(t.from))}</b> memberi: ${offerSummary(t.give)}</p>
    <p><b>${esc(pname(t.to))}</b> memberi: ${offerSummary(t.get)}</p>
    <div class="btns">${incoming ? `<button class="btn big primary" id="tr-yes">Terima</button><button class="btn big danger" id="tr-no">Tolak</button>` : `<button class="btn big" id="tr-cancel">Batalkan tawaran</button>`}</div>`);
  if (incoming) {
    $('#tr-yes', m).onclick = async () => (await act({ type: 'respondTrade', id, accept: true })).ok && closeModal();
    $('#tr-no', m).onclick = async () => (await act({ type: 'respondTrade', id, accept: false })).ok && closeModal();
  } else $('#tr-cancel', m).onclick = async () => (await act({ type: 'cancelTrade', id })).ok && closeModal();
}

function notifyTrades() {
  const g = game();
  for (const t of g.trades) {
    if (t.to === app.session?.playerId && !app.seenTrades.has(t.id)) {
      app.seenTrades.add(t.id);
      toast(`📨 ${pname(t.from)} menawarkan tukar-menukar!`);
      audio.play('card');
    }
  }
  manageRefresh?.();
}

function showTradeComposer() {
  const g = game();
  const me = meP()!;
  const others = g.players.filter((p) => !p.bankrupt && p.id !== me.id);
  if (!others.length) return;
  let target = others[0].id;
  const tradable = (pid: string) =>
    engine.ownedTiles(asState(), pid).filter((i) => {
      const t = theme.tiles[i];
      return !(t.type === 'city' && g.props[i].houses > 0);
    });
  const side = (pid: string, key: string) => {
    const p = g.players.find((x) => x.id === pid)!;
    return `<div class="tside"><h4>${pid === me.id ? 'Kamu beri' : `Kamu minta dari ${esc(p.name)}`}</h4>
      <label>Uang (maks ${fmt(p.money)})<input type="number" min="0" step="10" data-k="${key}-money" value="0"></label>
      ${p.jailFreeCards.length ? `<label>Kartu Bebas Penjara<input type="number" min="0" max="${p.jailFreeCards.length}" data-k="${key}-jail" value="0"></label>` : ''}
      <div class="tlist">${tradable(pid).map((i) => `<label class="tcheck"><input type="checkbox" data-k="${key}-tile" value="${i}">${tileTitle(i)}${g.props[i].mortgaged ? '<span class="small muted">gadai</span>' : ''}</label>`).join('') || '<p class="muted small">Tidak ada properti yang bisa ditukar</p>'}</div></div>`;
  };
  const m = openModal(`<h2>Tawarkan tukar-menukar</h2>
    <label>Ke pemain <select id="tr-target">${others.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
    <div class="tgrid" id="tr-grid"></div>
    <button class="btn big primary" id="tr-send">Kirim tawaran</button>`);
  const draw = () => ($('#tr-grid', m).innerHTML = side(me.id, 'give') + side(target, 'get'));
  draw();
  $<HTMLSelectElement>('#tr-target', m).onchange = (e) => {
    target = (e.target as HTMLSelectElement).value;
    draw();
  };
  $('#tr-send', m).onclick = async () => {
    const read = (key: string): Offer => ({
      money: Number(($(`[data-k="${key}-money"]`, m) as HTMLInputElement)?.value || 0),
      jailCards: Number((m.querySelector(`[data-k="${key}-jail"]`) as HTMLInputElement | null)?.value || 0),
      tiles: [...m.querySelectorAll<HTMLInputElement>(`[data-k="${key}-tile"]:checked`)].map((x) => Number(x.value)),
    });
    const res = await act({ type: 'proposeTrade', to: target, give: read('give'), get: read('get') });
    if (res.ok) {
      toast('Tawaran terkirim!');
      closeModal();
    }
  };
}

function showGameOver() {
  const g = game();
  const isHost = app.room!.hostId === app.session?.playerId;
  audio.play('win');
  const m = openModal(`<h2 class="center">🏆 Permainan selesai!</h2>
    <ol class="ranking">${g.ranking
      .map((id, k) => {
        const p = g.players.find((x) => x.id === id)!;
        return `<li class="${k === 0 ? 'winner' : ''}">${avatarImg(p.character.parts, k === 0 ? 'senang' : p.bankrupt ? 'sedih' : 'normal')}
        <div><b>#${k + 1} ${esc(p.name)}</b><div class="small muted">${esc(p.character.name)}</div>
        <div class="small">${p.bankrupt ? 'Bangkrut' : `Total aset ${fmt(engine.netWorth(asState(), id))}`}</div>
        <div class="small muted">Beli ${p.stats.bought} properti · bayar sewa ${fmt(p.stats.rentPaid)} · terima sewa ${fmt(p.stats.rentReceived)} · ${p.stats.jailed}× penjara · ${p.stats.doubles}× kembar</div></div></li>`;
      })
      .join('')}</ol>
    <p class="muted small center">Durasi ${Math.round((Date.now() + app.clockOffset - g.startedAt) / 60000)} menit · ${g.turnNo} giliran</p>
    <div class="btns">${isHost ? `<button class="btn big primary" id="again">${T.playAgain}</button>` : `<p class="muted">Menunggu host memilih Main Lagi…</p>`}<button class="btn big" id="exit">${T.leave}</button></div>`, { cls: 'gameover' });
  const again = m.querySelector<HTMLButtonElement>('#again');
  if (again) again.onclick = () => emitAck('room:playAgain');
  $('#exit', m).onclick = () => {
    socket.emit('room:leave');
    leaveLocal();
  };
}

// ---------------------------------------------------------------- mulai

render();
document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
// render ulang avatar setelah font siap agar tata letak stabil
document.fonts?.ready.then(() => app.screen === 'game' && fitBoard());
// preload sprite kepala supaya animasi lancar
for (const c of CHARACTERS) for (const e of ['normal', 'senang', 'sedih', 'kaget'] as Expression[]) head(c.parts, e);
