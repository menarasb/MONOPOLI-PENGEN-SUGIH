import { createHash, randomBytes } from 'node:crypto';
import type { Rng } from '../shared/types.js';

/**
 * RNG kriptografis yang bisa direproduksi: SHA-256(seed || counter).
 * Seed acak 256-bit dari crypto.randomBytes dicatat di log permainan.
 */
export class SeededRng implements Rng {
  readonly seed: string;
  counter: number;
  private buf: Buffer = Buffer.alloc(0);
  private pos = 0;

  constructor(seed = randomBytes(32).toString('hex'), counter = 0) {
    this.seed = seed;
    this.counter = counter;
  }

  private nextUint32(): number {
    if (this.pos + 4 > this.buf.length) {
      this.buf = createHash('sha256').update(`${this.seed}:${this.counter++}`).digest();
      this.pos = 0;
    }
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  int(n: number): number {
    // rejection sampling agar distribusi seragam
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    let v: number;
    do v = this.nextUint32();
    while (v >= limit);
    return v % n;
  }
}
