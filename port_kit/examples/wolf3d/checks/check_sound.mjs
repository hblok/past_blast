// Sound data: digitized samples decode from VSWAP (length, not silent), every adlib chunk renders to a finite, non-silent buffer of the right length.
import { readFileSync } from "node:fs"; import { parseVswap } from "./src/vswap.js"; import { digiSample, renderAdlib } from "./src/audio.js"; import { SND, DIGI } from "./src/sound_data.js";
const R = new URL("../vendor/ref/", import.meta.url), ab = f => { const b = readFileSync(new URL(f, R)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const vs = parseVswap(ab("VSWAP.WL6")), hed = new DataView(ab("AUDIOHED.WL6")), t = new Uint8Array(ab("AUDIOT.WL6"));
for (const [n, slot] of Object.entries(DIGI)) { const s = digiSample(vs, slot); ok(s.length > 500, `${n} digi length ${s.length}`); const dev = s.reduce((a, v) => Math.max(a, Math.abs(v - 128)), 0); ok(dev > 8, `${n} digi not silent (${dev})`); }
let adl = 0;
for (const [n, i] of Object.entries(SND)) { const a = hed.getUint32((87 + i) * 4, true), b = hed.getUint32((88 + i) * 4, true); if (b - a < 24) continue; const c = t.subarray(a, b), len = new DataView(c.buffer, c.byteOffset).getUint32(0, true), o = renderAdlib(c);
  ok(o.length === len * 315 + 6615 && o.every(Number.isFinite), n + " adlib renders"); if (!(n in DIGI)) ok(o.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0.01, n + " adlib not silent"); /* digitized names never use their adlib chunk */ adl++; }
{ // Sfx.play with a stub AudioContext: every event name resolves to a buffer, positional and global
  const node = () => ({ connect() {}, start() {}, stop() {}, gain: {}, pan: {} });
  globalThis.AudioContext = class { constructor() { this.destination = node(); } createGain() { return node(); } createStereoPanner() { return node(); } createBufferSource() { return node(); } createBuffer(c, n, r) { return { copyToChannel() {}, n, r }; } };
  const { Sfx } = await import("./src/audio.js"); const sfx = new Sfx(vs, ab("AUDIOHED.WL6"), ab("AUDIOT.WL6")); sfx.start();
  for (const n of Object.keys(SND)) { sfx.play({ name: n, x: 5 << 16, y: 5 << 16 }, { x: 1 << 16, y: 2 << 16, angle: 30 }); ok(sfx.buffer(n), n + " has a buffer"); }
  sfx.play({ name: "NOSUCHSND" }); }
{ // every song renders to a finite, non-silent loop of the right length
  const { renderSong } = await import("./src/audio.js"); const { MUS } = await import("./src/sound_data.js"); let n = 0;
  for (const [name, i] of Object.entries(MUS).filter(([, i]) => [0, 2, 7, 14].includes(i))) { /* a few songs: each takes seconds to render */ const a = hed.getUint32((261 + i) * 4, true), b = hed.getUint32((262 + i) * 4, true), c = t.subarray(a, b), o = renderSong(c);
    const dv = new DataView(c.buffer, c.byteOffset), len = dv.getUint16(0, true); let ticks = 0; for (let p = 2; p + 4 <= 2 + len; p += 4) ticks += dv.getUint16(p + 2, true);
    ok(o.length === Math.round(ticks * 63) && o.every(Number.isFinite), name + " renders"); ok(o.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0.02, name + " not silent"); ok(o.reduce((m, v) => Math.max(m, Math.abs(v)), 0) < 1.5, name + " not clipping hard"); n++; }
  console.log(n, "songs rendered"); }
console.log(Object.keys(DIGI).length, "digitized,", adl, "adlib sounds checked"); console.log(bad ? "FAIL" : "PASS"); process.exit(bad ? 1 : 0);
