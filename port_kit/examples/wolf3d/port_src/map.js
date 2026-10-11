// Level decode: MAPHEAD + GAMEMAPS (Carmack + RLEW), port of tools/wolf_map.py. Works in node and the browser.
function carmack(b, n) {
  const out = []; let i = 0;
  while (out.length < n / 2) {
    const lo = b[i], hi = b[i + 1]; i += 2;
    if ((hi === 0xA7 || hi === 0xA8) && lo === 0) { out.push(b[i] | hi << 8); i++; continue; }  // escaped literal
    if (hi === 0xA7) { for (let k = 0; k < lo; k++) out.push(out[out.length - b[i]]); i++; }     // near copy
    else if (hi === 0xA8) { const o = b[i] | b[i + 1] << 8; i += 2; for (let k = 0; k < lo; k++) out.push(out[o + k]); }  // far copy
    else out.push(lo | hi << 8);
  }
  return out;
}
function rlew(w, tag) {
  const out = []; let i = 0;
  while (i < w.length) {
    if (w[i] === tag) { for (let k = 0; k < w[i + 1]; k++) out.push(w[i + 2]); i += 3; }
    else out.push(w[i++]);
  }
  return out;
}
// head, maps: ArrayBuffer. Returns {name, w, h, walls: Uint16Array, things: Uint16Array} or null if the level does not exist.
export function decodeLevel(head, maps, level) {
  const mh = new DataView(head), g = new DataView(maps), gb = new Uint8Array(maps);
  const tag = mh.getUint16(0, true), off = mh.getInt32(2 + 4 * level, true);
  if (off <= 0) return null;
  const w = g.getUint16(off + 18, true), h = g.getUint16(off + 20, true);
  const name = String.fromCharCode(...gb.subarray(off + 22, off + 38)).split("\0")[0];
  const planes = [0, 1].map(p => {
    const s = g.getInt32(off + 4 * p, true), l = g.getUint16(off + 12 + 2 * p, true);
    const raw = gb.subarray(s, s + l), n = raw[0] | raw[1] << 8;
    return Uint16Array.from(rlew(carmack(raw.subarray(2), n).slice(1), tag));
  });
  return { name, w, h, walls: planes[0], things: planes[1] };
}
export const LEVELS = 100;   // MAPHEAD has room for 100 entries; 60 exist in WL6
