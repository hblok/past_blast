// A small OPL2 (YM3812) model: 9 two-operator channels, register interface as the AdLib card (id's IMF music and AdLib effects are plain register writes).
// Implemented: frequency/block/multiplier, the four waveforms, attack (exponential) / decay / sustain / release envelopes with rate and key-scaling-of-rate, total level,
// sustain level, FM and additive connection, modulator feedback, tremolo and vibrato. Not implemented: level key scaling (KSL), rhythm mode, exact OPL integer arithmetic.
const N = 4096, WAVE = [0, 1, 2, 3].map(w => Float32Array.from({ length: N }, (_, i) => {
  const p = i / N * 2 * Math.PI, s = Math.sin(p), q = p % Math.PI;
  return w === 0 ? s : w === 1 ? Math.max(0, s) : w === 2 ? Math.abs(s) : q < Math.PI / 2 ? Math.sin(q) : 0;   // sine, half sine, absolute sine, quarter-sine pulses
}));
const MULT = [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 12, 12, 15, 15], FB = [0, Math.PI / 16, Math.PI / 8, Math.PI / 4, Math.PI / 2, Math.PI, 2 * Math.PI, 4 * Math.PI];
const SLOTOF = (() => { const t = Array(32).fill(-1); for (let i = 0; i < 18; i++) t[i + 2 * Math.floor(i / 6)] = i; return t; })();   // register offset -> slot (offsets 6, 7, 14, 15 are unused)
const MODSLOT = [0, 1, 2, 6, 7, 8, 12, 13, 14], MODIDX = 4 * Math.PI, OPLRATE = 49716;
class Slot {
  constructor() { Object.assign(this, { chr: 0, scale: 0, atk: 0, sus: 0, ws: 0, phase: 0, att: 96, stage: 0, out: 0, prev: 0 }); }   // stage: 0 off, 1 attack, 2 decay, 3 sustain, 4 release
}
export class Opl {
  constructor(rate = 44100) {
    this.rate = rate; this.s = Array.from({ length: 18 }, () => new Slot());
    this.ch = Array.from({ length: 9 }, () => ({ fnum: 0, block: 0, key: 0, conn: 0, fb: 0 })); this.bd = 0; this.lfo = 0;
  }
  write(r, v) {
    const lo = r & 0xff;
    if (lo === 0xbd) { this.bd = v; return; }
    if (lo >= 0xa0 && lo <= 0xa8) { this.ch[lo - 0xa0].fnum = this.ch[lo - 0xa0].fnum & 0x300 | v; return; }
    if (lo >= 0xb0 && lo <= 0xb8) {
      const c = this.ch[lo - 0xb0], key = v >> 5 & 1; c.fnum = c.fnum & 0xff | (v & 3) << 8; c.block = v >> 2 & 7;
      if (key !== c.key) { const m = this.s[MODSLOT[lo - 0xb0]], k = this.s[MODSLOT[lo - 0xb0] + 3]; for (const o of [m, k]) { if (key) { o.stage = 1; o.phase = 0; } else if (o.stage) o.stage = 4; } c.key = key; }
      return;
    }
    if (lo >= 0xc0 && lo <= 0xc8) { const c = this.ch[lo - 0xc0]; c.conn = v & 1; c.fb = v >> 1 & 7; return; }
    const base = lo & 0xe0, off = lo & 0x1f, sl = SLOTOF[off]; if (sl < 0 || off > 0x15) return; const o = this.s[sl];
    if (base === 0x20) o.chr = v; else if (base === 0x40) o.scale = v; else if (base === 0x60) o.atk = v; else if (base === 0x80) o.sus = v; else if (base === 0xe0) o.ws = v & 3;
  }
  // envelope step of one slot for dt seconds; rof = 4 * rate + key scale offset
  env(o, dt, rof) {
    if (o.stage === 1) {
      const R = o.atk >> 4; if (!R) return; const r = Math.min(63, 4 * R + rof);
      if (r >= 60) { o.att = 0; o.stage = 2; } else { o.att *= Math.exp(-Math.log(320) * dt / (2.826 * 2 ** (1 - r / 4))); if (o.att < 0.3) { o.att = 0; o.stage = 2; } }
    } else if (o.stage === 2 || o.stage === 3 || o.stage === 4) {
      const R = o.stage === 2 ? o.atk & 15 : o.sus & 15; if (o.stage === 3 || !R) return; const r = Math.min(63, 4 * R + rof);
      o.att += 96 * dt / (39.28 * 2 ** (1 - r / 4)); const sl = (o.sus >> 4) === 15 ? 93 : (o.sus >> 4) * 3;
      if (o.stage === 2 && o.att >= sl) { o.att = sl; o.stage = o.chr & 0x20 ? 3 : 4; } else if (o.att >= 96) { o.att = 96; o.stage = 0; }
    }
  }
  // adds `n` samples (scaled by `gain`) to out[at...]. Envelopes, tremolo and amplitude are updated every 16 samples, phases every sample.
  gen(out, at, n, gain = 0.25) {
    const dt = 1 / this.rate, trem = this.bd & 0x80 ? 4.8 : 1, vib = this.bd & 0x40 ? 0.0081 : 0.0040, B = 16, mA = new Float64Array(9), kA = new Float64Array(9);
    for (let i0 = 0; i0 < n; i0 += B) {
      const len = Math.min(B, n - i0), t = (this.lfo += dt * len), tl = Math.abs(((t * 3.7) % 1) * 2 - 1) * trem, vl = 1 + vib * Math.sin(2 * Math.PI * 6.1 * t);
      for (let c = 0; c < 9; c++) {
        const ch = this.ch[c], m = this.s[MODSLOT[c]], k = this.s[MODSLOT[c] + 3]; if (!m.stage && !k.stage) { mA[c] = kA[c] = 0; continue; }
        const rof = ch.block * 2 + (ch.fnum >> 9 & 1), base = ch.fnum * 2 ** ch.block * OPLRATE / 2 ** 20 * dt, wm = WAVE[m.ws], wk = WAVE[k.ws], fb = ch.fb ? FB[ch.fb] : 0;
        for (const [o, A] of [[m, mA], [k, kA]]) { if (o.stage) this.env(o, dt * len, rof >> (o.chr & 0x10 ? 0 : 2)); A[c] = o.stage ? 10 ** (-(o.att + (o.scale & 63) * 0.75 + (o.chr & 0x80 ? tl : 0)) / 20) : 0; }
        const mi = base * MULT[m.chr & 15] * (m.chr & 0x40 ? vl : 1), ki = base * MULT[k.chr & 15] * (k.chr & 0x40 ? vl : 1), am = mA[c], ak = kA[c], conn = ch.conn;
        for (let i = 0; i < len; i++) {
          let mo = 0, ko = 0;
          if (am) { m.phase += mi; const ph = m.phase + fb * (m.out + m.prev) / 12.566370614359172; m.prev = m.out; mo = m.out = wm[(ph - Math.floor(ph)) * N | 0] * am; }
          if (ak) { k.phase += ki; const ph = k.phase + (conn ? 0 : mo * 2); ko = wk[(ph - Math.floor(ph)) * N | 0] * ak; }   // modulation index 4 pi = 2 cycles
          out[at + i0 + i] += (conn ? mo + ko : ko) * gain;
        }
      }
    }
  }
}
