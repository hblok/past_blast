// VGAGRAPH.WL6 + VGAHEAD.WL6 + VGADICT.WL6: Huffman-compressed pictures (ID_CA.C CAL_HuffExpand). Chunk = u32 expanded length, then the Huffman stream (bits LSB first, root node 254).
// A picture is stored planar (plane p holds the pixels with x & 3 == p, rows of width/4 bytes); chunk 0 is the pic table (width, height per pic, indexed by pic - STARTPICS).
import { STARTPICS, NUMPICS } from "./gfx_names.js";
export function openVgagraph(graph, head, dict) {
  const hd = new DataView(head), dv = new DataView(dict), g = new Uint8Array(graph), nodes = [];
  for (let i = 0; i < 255; i++) nodes.push([dv.getUint16(i * 4, true), dv.getUint16(i * 4 + 2, true)]);
  const start = c => hd.getUint8(c * 3) | hd.getUint8(c * 3 + 1) << 8 | hd.getUint8(c * 3 + 2) << 16;
  function chunk(c) {
    const a = start(c), b = start(c + 1), len = g[a] | g[a + 1] << 8 | g[a + 2] << 16 | g[a + 3] << 24, out = new Uint8Array(len);
    let src = a + 4, byte = g[src++], bit = 1, o = 0, node = 254;
    while (o < len) {
      const v = nodes[node][byte & bit ? 1 : 0]; bit <<= 1; if (bit > 0xff) { byte = g[src++]; bit = 1; }
      if (v < 256) { out[o++] = v; node = 254; } else node = v - 256;
    }
    return out;
  }
  const table = chunk(0), cache = {};
  // -> {w, h, px: Uint8Array w*h palette indices}
  function pic(n) {
    if (cache[n]) return cache[n];
    const t = (n - STARTPICS) * 4, w = table[t] | table[t + 1] << 8, h = table[t + 2] | table[t + 3] << 8, d = chunk(n), px = new Uint8Array(w * h), pw = w >> 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = d[(x & 3) * pw * h + y * pw + (x >> 2)];
    return cache[n] = { w, h, px };
  }
  return { chunk, pic };
}
