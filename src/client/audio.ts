// Musik chiptune & efek suara disintesis dengan WebAudio (orisinal, tanpa file audio).
import type { SfxName } from '../shared/types';

const LS_MUSIC = 'mps.music';
const LS_SFX = 'mps.sfx';

function readPref(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === '1';
  } catch {
    return def;
  }
}
function writePref(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* abaikan */
  }
}

// Tangga nada pelog-ish (Hz) untuk nuansa gamelan 8-bit.
const PELOG = [293.66, 311.13, 349.23, 415.3, 440.0, 466.16, 523.25, 587.33, 622.25, 698.46, 830.61, 880.0];

// Dua lagu: urutan indeks nada (-1 = diam), tempo dalam detik per ketukan.
const SONGS: { melody: number[]; bass: number[]; beat: number }[] = [
  {
    // "Pasar Malam" — riang
    melody: [0, 2, 3, 4, 3, 2, 4, -1, 6, 4, 3, 2, 3, -1, 0, -1, 2, 3, 4, 6, 7, 6, 4, -1, 3, 4, 3, 2, 0, -1, -1, -1],
    bass: [0, -1, 0, -1, 3, -1, 3, -1, 2, -1, 2, -1, 0, -1, 0, -1],
    beat: 0.2,
  },
  {
    // "Sore di Kampung" — santai ala dangdut
    melody: [4, -1, 3, 4, 6, -1, 4, 3, 2, -1, 0, 2, 3, -1, -1, -1, 6, -1, 7, 6, 4, -1, 3, 2, 3, -1, 2, 0, 0, -1, -1, -1],
    bass: [0, -1, -1, 0, 3, -1, -1, 3, 2, -1, -1, 2, 0, -1, 4, -1],
    beat: 0.24,
  },
];

class Audio8 {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  musicOn = readPref(LS_MUSIC, true);
  sfxOn = readPref(LS_SFX, true);
  private songIdx = 0;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;

  /** Dipanggil saat interaksi pertama pengguna (kebijakan autoplay browser). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? 0.5 : 0;
    this.musicGain.connect(this.master);
    // musik dimuat belakangan: mulai setelah jeda singkat
    setTimeout(() => this.startMusic(), 800);
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    writePref(LS_MUSIC, on);
    if (this.musicGain) this.musicGain.gain.value = on ? 0.5 : 0;
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    writePref(LS_SFX, on);
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, slide = 0) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, start + dur);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    o.connect(g).connect(dest);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  private noise(start: number, dur: number, vol: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.buffer = buf;
    src.connect(g).connect(this.master!);
    src.start(start);
  }

  private startMusic() {
    if (!this.ctx || this.timer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  private schedule() {
    const ctx = this.ctx!;
    const song = SONGS[this.songIdx];
    while (this.nextTime < ctx.currentTime + 0.4) {
      const m = song.melody[this.step % song.melody.length];
      if (m >= 0) this.tone(PELOG[m] * 2, this.nextTime, song.beat * 0.9, 'square', 0.25, this.musicGain!);
      if (this.step % 2 === 0) {
        const b = song.bass[(this.step / 2) % song.bass.length];
        if (b >= 0) this.tone(PELOG[b] / 2, this.nextTime, song.beat * 1.8, 'triangle', 0.5, this.musicGain!);
      }
      // kendang: tak-dung sederhana
      if (this.step % 4 === 0) this.tone(110, this.nextTime, 0.12, 'sine', 0.5, this.musicGain!, -50);
      if (this.step % 4 === 2) this.tone(220, this.nextTime, 0.06, 'square', 0.12, this.musicGain!, -80);
      this.nextTime += song.beat;
      this.step++;
      if (this.step >= song.melody.length * 4) {
        this.step = 0;
        this.songIdx = (this.songIdx + 1) % SONGS.length;
      }
    }
  }

  play(name: SfxName) {
    if (!this.sfxOn || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const m = this.master;
    switch (name) {
      case 'dice':
        for (let i = 0; i < 6; i++) this.noise(t + i * 0.06, 0.04, 0.5);
        break;
      case 'step':
        this.tone(660, t, 0.06, 'square', 0.3, m, 200);
        break;
      case 'buy': // "kaching"
        this.tone(1318, t, 0.08, 'square', 0.4, m);
        this.tone(1760, t + 0.08, 0.25, 'square', 0.4, m);
        this.noise(t + 0.02, 0.15, 0.2);
        break;
      case 'rent':
        this.tone(523, t, 0.1, 'square', 0.4, m);
        this.tone(392, t + 0.1, 0.18, 'square', 0.4, m);
        break;
      case 'jail':
        this.tone(330, t, 0.15, 'sawtooth', 0.35, m);
        this.tone(247, t + 0.15, 0.15, 'sawtooth', 0.35, m);
        this.tone(196, t + 0.3, 0.35, 'sawtooth', 0.35, m);
        break;
      case 'bankrupt':
        for (let i = 0; i < 5; i++) this.tone(400 - i * 60, t + i * 0.15, 0.15, 'square', 0.35, m, -40);
        break;
      case 'card':
        this.tone(880, t, 0.05, 'triangle', 0.4, m, 400);
        this.tone(1320, t + 0.06, 0.08, 'triangle', 0.3, m);
        break;
      case 'build':
        this.tone(220, t, 0.05, 'square', 0.4, m);
        this.tone(330, t + 0.07, 0.05, 'square', 0.4, m);
        this.tone(440, t + 0.14, 0.12, 'square', 0.4, m);
        break;
      case 'coin':
        this.tone(988, t, 0.06, 'square', 0.35, m);
        this.tone(1319, t + 0.06, 0.15, 'square', 0.35, m);
        break;
      case 'bid':
        this.tone(740, t, 0.08, 'square', 0.3, m);
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.12, 0.2, 'square', 0.35, m));
        break;
    }
  }
}

export const audio = new Audio8();
