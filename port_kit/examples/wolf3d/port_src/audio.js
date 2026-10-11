// Sound effects. Digitized sounds: VSWAP sound pages, 8-bit unsigned PCM at 7000 Hz; the sound info page (last chunk) lists (start page, length) per digi slot.
// AdLib sounds: AUDIOT chunks 87+n = u32 length, u16 priority, 16 byte instrument, block byte, then one frequency byte per 1/140 s (0 = key off); played on one
// OPL2 channel, rendered here with a small two-operator FM model (envelopes and waveforms of the OPL2, no tremolo/vibrato/key scaling).
// Like the original there is one adlib voice and one digitized voice: a new sound of a kind cuts the previous one. Positional sounds get distance gain and pan.
import { SND, DIGI, LEVELSONGS } from "./sound_data.js";
export function digiSample(vs, slot) {
  const info = vs.chunk(vs.n - 1), dv = new DataView(info.buffer, info.byteOffset, info.byteLength), page = dv.getUint16(slot * 4, true), len = dv.getUint16(slot * 4 + 2, true);
  const out = new Uint8Array(len); let o = 0;
  for (let p = vs.soundStart + page; o < len && p < vs.n - 1; p++) { const c = vs.chunk(p); out.set(c.subarray(0, Math.min(c.length, len - o)), o); o += c.length; }
  return out;
}
import { Opl } from "./opl.js";
const RATE = 44100;
function setup(opl, i) {   // SDL_AlSetFXInst: instrument of an effect on channel 0 (modulator slot 0, carrier slot 3), feedback 0, FM
  opl.write(0x01, 0x20); const [mC, cC, mS, cS, mA, cA, mU, cU, mW, cW] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => i[k]);
  for (const [o, ch, sc, at, su, w] of [[0, mC, mS, mA, mU, mW], [3, cC, cS, cA, cU, cW]]) { opl.write(0x20 + o, ch); opl.write(0x40 + o, sc); opl.write(0x60 + o, at); opl.write(0x80 + o, su); opl.write(0xe0 + o, w); }
  opl.write(0xc0, 0);
}
export function renderAdlib(c) {   // c: Uint8Array chunk -> Float32Array at 44100 Hz (140 Hz service: one frequency byte per tick, 0 = key off)
  const len = new DataView(c.buffer, c.byteOffset, c.byteLength).getUint32(0, true), block = c[22] & 7, data = c.subarray(23, 23 + len), per = RATE / 140, tail = 6615, out = new Float32Array(len * per + tail), opl = new Opl(RATE);
  setup(opl, c.subarray(6, 16));
  for (let b = 0, o = 0; b < len; b++, o += per) { const s = data[b]; if (s) { opl.write(0xa0, s); opl.write(0xb0, block << 2 | 0x20); } else opl.write(0xb0, 0); opl.gen(out, o, per, 0.6); }
  opl.write(0xb0, 0); opl.gen(out, len * per, tail, 0.6);
  return out;
}
// IMF song chunk: u16 byte length, then (register, value, u16 delay) records, delay in 1/700 s; the song restarts at the end. Renders pass after pass so the loop point keeps its tails.
// A generator so the page can render in slices without freezing: each yield is ~one slice of work; the return value is the Float32Array of the second pass.
export function* songSteps(c) {
  const dv = new DataView(c.buffer, c.byteOffset, c.byteLength), len = dv.getUint16(0, true), ev = [];
  let ticks = 0; for (let p = 2; p + 4 <= 2 + len; p += 4) { ev.push([c[p], c[p + 1], ticks]); ticks += dv.getUint16(p + 2, true); }
  const per = RATE / 700, opl = new Opl(RATE), out = new Float32Array(Math.round(ticks * per)), scratch = new Float32Array(out.length);
  for (const pass of [0, 1]) for (let i = 0; i < ev.length; i++) {   // the second pass is the one kept
    opl.write(ev[i][0], ev[i][1]); const end = i + 1 < ev.length ? ev[i + 1][2] : ticks, n = (end - ev[i][2]) * per;
    if (n > 0) opl.gen(pass ? out : scratch, Math.round(ev[i][2] * per), n, 0.3);
    if (i % 400 === 399) yield;
  }
  return out;
}
export function renderSong(c) { const g = songSteps(c); for (;;) { const r = g.next(); if (r.done) return r.value; } }
export class Sfx {
  // vs: parsed VSWAP; audiohed/audiot: ArrayBuffers
  constructor(vs, audiohed, audiot) { this.vs = vs; this.hed = new DataView(audiohed); this.t = new Uint8Array(audiot); this.cache = {}; this.ctx = null; this.cur = {}; this.enabled = true; this.music = true; this.want = null; this.song = null; this.songBuf = {}; }
  start() { if (this.ctx) return; const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return; this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(this.ctx.destination); this.mgain = this.ctx.createGain(); this.mgain.gain.value = 0.5; this.mgain.connect(this.ctx.destination); this.setMusic(this.want); }
  // song number (AUDIOT chunk 261 + n) or null; renders in slices (about a second of work per song) and loops the second pass
  setMusic(n) {
    this.want = n; if (!this.ctx || n === this.song) return; this.song = n;
    try { this.src?.stop(); } catch {} this.src = null; if (n === null || !this.music) { this.song = this.music ? n : null; return; }
    const done = buf => { if (this.song !== n || !this.music) return; const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(this.mgain); s.start(); this.src = s; };
    if (this.songBuf[n]) return done(this.songBuf[n]);
    const a = this.hed.getUint32((261 + n) * 4, true), b = this.hed.getUint32((262 + n) * 4, true), g = songSteps(this.t.subarray(a, b));
    const step = () => {
      if (this.song !== n) return; const t0 = performance.now();
      for (;;) { const r = g.next(); if (r.done) { const buf = this.ctx.createBuffer(1, r.value.length, 44100); buf.copyToChannel(r.value, 0); this.songBuf = { [n]: buf }; return done(buf); } if (performance.now() - t0 > 30) break; }
      setTimeout(step, 0);
    };
    step();
  }
  toggleMusic() { this.music = !this.music; const w = this.want; this.song = null; this.setMusic(this.music ? w : null); this.want = w; return this.music; }
  buffer(name) {
    if (name in this.cache) return this.cache[name];
    let data, rate;
    if (name in DIGI) { const u = digiSample(this.vs, DIGI[name]); data = Float32Array.from(u, v => (v - 128) / 128); rate = 7000; }
    else if (name in SND) { const a = this.hed.getUint32((87 + SND[name]) * 4, true), b = this.hed.getUint32((88 + SND[name]) * 4, true); data = renderAdlib(this.t.subarray(a, b)); rate = 44100; }
    else return this.cache[name] = null;
    if (rate < 22050) { const up = Math.round(data.length * 44100 / rate), r = Float32Array.from({ length: up }, (_, i) => { const x = i * rate / 44100, j = Math.floor(x), f = x - j; return data[j] * (1 - f) + (data[j + 1] ?? data[j]) * f; }); data = r; rate = 44100; }   // browsers refuse sample rates below 8 kHz: resample the 7 kHz digitized sounds
    const buf = this.ctx.createBuffer(1, data.length, rate); buf.copyToChannel(data, 0); buf.digi = name in DIGI; return this.cache[name] = buf;
  }
  // ev: {name, x, y} (x, y: 16.16 world position or undefined for a global sound); listener: {x, y, angle}
  play(ev, pl) { try { this.play_(ev, pl); } catch (e) { console.warn("sound", ev.name, e); } }   // a sound problem must never stop the game loop
  play_(ev, pl) {
    if (!this.enabled || !this.ctx) return; const buf = this.buffer(ev.name); if (!buf) return;
    const kind = buf.digi ? "digi" : "adlib"; try { this.cur[kind]?.stop(); } catch {}
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain(), pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null; src.buffer = buf;
    let g = 1, p = 0;
    if (ev.x !== undefined) {   // distance gain (heard up to ~16 tiles) and left/right from the angle to the source
      const dx = (ev.x - pl.x) / 65536, dy = (ev.y - pl.y) / 65536, d = Math.hypot(dx, dy), a = pl.angle * Math.PI / 180;
      g = Math.max(0, 1 - d / 16); p = d < 0.01 ? 0 : Math.max(-1, Math.min(1, (dx * Math.sin(a) + dy * Math.cos(a)) / d));
    }
    gain.gain.value = g; src.connect(gain); if (pan) { pan.pan.value = p; gain.connect(pan); pan.connect(this.master); } else gain.connect(this.master);
    src.start(); this.cur[kind] = src;
  }
}
