// Headless PNG writer (node, no dependencies): the way to look at a port without a browser. rgb: Uint8Array w*h*3 or Uint8ClampedArray w*h*4 (RGBA).
// writePngIndexed(path, idx, w, h, pal) takes palette indices (pal[i] = [r, g, b]) and is what the verification screenshots use: read the PNG with an image viewer / the agent's image reader.
import { writeFileSync } from "node:fs"; import { deflateSync, crc32 } from "node:zlib";
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
export function writePng(path, w, h, px, channels = 3) {
  const stride = w * channels + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * channels, w * channels).copy(raw, y * stride + 1);   // filter byte 0 per row
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = channels === 4 ? 6 : 2;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
export function writePngIndexed(path, idx, w, h, pal) {
  const rgb = new Uint8Array(w * h * 3); for (let i = 0; i < w * h; i++) { const c = pal[idx[i]]; rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2]; }
  writePng(path, w, h, rgb, 3);
}
// contact sheet: shelf-pack many small pictures {w, h, px (indices)} into one PNG and return their positions: the fastest way to identify numbered graphics chunks by eye
export function contactSheet(path, pics, pal, W = 640, H = 900) {
  const idx = new Uint8Array(W * H); let x = 0, y = 0, rowh = 0; const pos = [];
  pics.forEach((p, n) => { if (x + p.w > W) { x = 0; y += rowh + 4; rowh = 0; } if (y + p.h > H) return; for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) idx[(y + r) * W + x + c] = p.px[r * p.w + c]; pos.push([n, x, y]); x += p.w + 4; rowh = Math.max(rowh, p.h); });
  writePngIndexed(path, idx, W, H, pal); return pos;
}
