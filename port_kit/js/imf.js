// id-engine sound formats on top of opl.js (node + browser, returns Float32Array at 44100 Hz; the page wraps them in an AudioBuffer).
// - AdLib sound effect chunk: u32 length, u16 priority, 16-byte instrument (mChar cChar mScale cScale mAttack cAttack mSus cSus mWave cWave nConn + 5 unused), block byte, then one frequency
//   byte per 1/140 s (0 = key off): played on one OPL channel (carrier slot 3, modulator slot 0), feedback 0, FM connection.
// - IMF music chunk: u16 byte length, then (register, value, u16 delay) records, delay in ticks of 1/700 s (Wolf3D; some games use 560 or 280 Hz: check the game's timer setup);
//   the song restarts at the end and instrument registers persist, which is why songSteps renders two passes and keeps the second one.
// Rendering is not cycle-exact OPL2 (no KSL, no rhythm mode): check by ear / against a DOSBox capture before relying on timbre.
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
