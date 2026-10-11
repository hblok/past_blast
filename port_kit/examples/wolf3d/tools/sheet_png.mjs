// node sheet_png.mjs out.png from to: contact sheet of VGAGRAPH pics (shelf packing, positions printed) - for identifying chunk numbers
import { readFileSync, writeFileSync } from "node:fs"; import { deflateSync, crc32 } from "node:zlib"; import { openVgagraph } from "./src/vgagraph.js";
const D = new URL("../vendor/ref/", import.meta.url), ab = f => { const b = readFileSync(new URL(f, D)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const vg = openVgagraph(ab("VGAGRAPH.WL6"), ab("VGAHEAD.WL6"), ab("VGADICT.WL6")), pal = JSON.parse(readFileSync(new URL("palette.json", import.meta.url)));
const [out, a, b] = process.argv.slice(2), W = 640, H = 900, idx = new Uint8Array(W * H).fill(0x00);
let x = 0, y = 0, rowh = 0; const log = [];
for (let n = +a; n <= +b; n++) {
  const p = vg.pic(n); if (x + p.w > W) { x = 0; y += rowh + 4; rowh = 0; } if (y + p.h > H) break;
  for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) idx[(y + r) * W + x + c] = p.px[r * p.w + c];
  log.push(`${n}@${x},${y}`); x += p.w + 4; rowh = Math.max(rowh, p.h);
}
console.log(log.join(" "));
const raw = Buffer.alloc((W * 3 + 1) * H); for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const c = pal[idx[yy * W + xx]], o = yy * (W * 3 + 1) + 1 + xx * 3; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
const ch = (t, d) => { const bb = Buffer.alloc(12 + d.length); bb.writeUInt32BE(d.length); bb.write(t, 4); d.copy(bb, 8); bb.writeUInt32BE(crc32(bb.subarray(4, 8 + d.length)), 8 + d.length); return bb; };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", deflateSync(raw)), ch("IEND", Buffer.alloc(0))]));
