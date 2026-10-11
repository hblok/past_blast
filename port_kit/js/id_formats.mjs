// Formats shared by id Software's DOS engines (Wolfenstein 3D, Keen Dreams/Commander Keen 4-6 in part, Spear of Destiny, Blake Stone, ...). Pure functions, node + browser.
// Verify every one against the original data before trusting it (an ASCII dump compared with an independent decoder, a picture looked at). Numbers of the chunks differ per game and version.

// Carmack compression (map planes): 16-bit words; tag high byte 0xA7 = near copy (count in low byte, offset byte follows), 0xA8 = far copy (offset word follows); count 0 = escaped literal.
export function carmack(b, nbytes) {
  const out = []; let i = 0;
  while (out.length < nbytes / 2) {
    const lo = b[i], hi = b[i + 1]; i += 2;
    if ((hi === 0xA7 || hi === 0xA8) && lo === 0) { out.push(b[i] | hi << 8); i++; continue; }
    if (hi === 0xA7) { for (let k = 0; k < lo; k++) out.push(out[out.length - b[i]]); i++; }
    else if (hi === 0xA8) { const o = b[i] | b[i + 1] << 8; i += 2; for (let k = 0; k < lo; k++) out.push(out[o + k]); }
    else out.push(lo | hi << 8);
  }
  return out;
}
// RLEW: word `tag` (from the map header) = run: tag, count, value
export function rlew(w, tag) { const out = []; let i = 0; while (i < w.length) { if (w[i] === tag) { for (let k = 0; k < w[i + 1]; k++) out.push(w[i + 2]); i += 3; } else out.push(w[i++]); } return out; }
// Map plane from a GAMEMAPS-style file: rawBytes = the compressed chunk, tag = RLEW tag. Layout: u16 expanded length, Carmack stream -> words, first word is the RLEW expanded length.
export const decodePlane = (raw, tag) => { const n = raw[0] | raw[1] << 8; return Uint16Array.from(rlew(carmack(raw.subarray(2), n).slice(1), tag)); };

// Huffman graphics (VGAGRAPH/EGAGRAPH): dictionary = 255 nodes of (u16 bit0, u16 bit1), root 254; values < 256 are leaves, else node - 256; bits LSB first.
// chunk = u32 expanded length + stream. head = 3-byte little-endian offsets per chunk. Planar pictures: plane p holds the pixels with x & 3 == p (VGA mode X), rows of width/4 bytes.
export function huffmanReader(graph, head, dict) {
  const hd = new DataView(head), dv = new DataView(dict), g = new Uint8Array(graph), nodes = [];
  for (let i = 0; i < 255; i++) nodes.push([dv.getUint16(i * 4, true), dv.getUint16(i * 4 + 2, true)]);
  const start = c => hd.getUint8(c * 3) | hd.getUint8(c * 3 + 1) << 8 | hd.getUint8(c * 3 + 2) << 16;
  return function chunk(c) {
    const a = start(c), len = g[a] | g[a + 1] << 8 | g[a + 2] << 16 | g[a + 3] << 24, out = new Uint8Array(len);
    let src = a + 4, byte = g[src++], bit = 1, o = 0, node = 254;
    while (o < len) { const v = nodes[node][byte & bit ? 1 : 0]; bit <<= 1; if (bit > 0xff) { byte = g[src++]; bit = 1; } if (v < 256) { out[o++] = v; node = 254; } else node = v - 256; }
    return out;
  };
}
export function planarPicture(data, w, h) { const px = new Uint8Array(w * h), pw = w >> 2; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = data[(x & 3) * pw * h + y * pw + (x >> 2)]; return { w, h, px }; }
// Proportional font chunk (id): u16 height, u16 location[256], u8 width[256], then 1 byte per pixel, rows of `width`; non-zero = foreground.
export function parseFont(d) { const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); return { h: dv.getUint16(0, true), loc: i => dv.getUint16(2 + i * 2, true), wid: i => d[514 + i], d }; }
