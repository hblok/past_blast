// node frame_png.mjs out.png [level] [ticks]: a whole 320x200 frame (3D view + status bar) from a fresh session, headless; USE_TICS-like: runs `ticks` idle tics first
import { readFileSync, writeFileSync } from "node:fs"; import { deflateSync, crc32 } from "node:zlib";
import { Session } from "./src/session.js"; import { parseVswap } from "./src/vswap.js"; import { render } from "./src/render.js"; import { openVgagraph } from "./src/vgagraph.js"; import { drawHud } from "./src/hud.js";
const D = new URL("../vendor/ref/", import.meta.url), ab = f => { const b = readFileSync(new URL(f, D)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const [out, level = 0, ticks = 0] = process.argv.slice(2), pal = JSON.parse(readFileSync(new URL("palette.json", import.meta.url))), rt = JSON.parse(readFileSync(new URL("rndtable.json", import.meta.url)));
const S = new Session(ab("MAPHEAD.WL6"), ab("GAMEMAPS.WL6"), rt, { level: +level }), vs = parseVswap(ab("VSWAP.WL6")), vg = openVgagraph(ab("VGAGRAPH.WL6"), ab("VGAHEAD.WL6"), ab("VGADICT.WL6"));
for (let i = 0; i < +ticks; i++) S.tick({});
const g = S.game, p = g.pl, W = 320, view = new Uint8ClampedArray(W * 160 * 4), idx = new Uint8Array(W * 200);
render(view, W, 160, g.w, { x: p.x / 65536, y: p.y / 65536, a: p.angle * Math.PI / 180 }, vs, pal, S.level); drawHud(idx, W, vg, g.w.gs, g.w.keys, S.level);
const raw = Buffer.alloc((W * 4 + 1) * 200);
for (let y = 0; y < 200; y++) for (let x = 0; x < W; x++) { const o = y * (W * 4 + 1) + 1 + x * 4; if (y < 160) { for (let c = 0; c < 4; c++) raw[o + c] = view[(y * W + x) * 4 + c]; } else { const c = pal[idx[y * W + x]]; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255; } }
const ch = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(200, 4); ih[8] = 8; ih[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", deflateSync(raw)), ch("IEND", Buffer.alloc(0))]));
