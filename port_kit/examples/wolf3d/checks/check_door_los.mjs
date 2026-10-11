// Line of sight through closed doors: 180k player/guard placements on opposite sides of every door of 7 levels; CheckLine must never see through a closed door (shots use it).
import { readFileSync } from "node:fs"; import { decodeLevel } from "./src/map.js"; import { Game } from "./src/game.js";
const R = new URL("../vendor/ref/", import.meta.url).pathname, ab = f => { const b = readFileSync(R + f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const rt = JSON.parse(readFileSync(new URL("rndtable.json", import.meta.url).pathname)); let total = 0, leaks = 0, ex = [];
for (const lv of [0, 1, 2, 3, 9, 10, 20]) {
  const g = new Game(decodeLevel(ab("MAPHEAD.WL6"), ab("GAMEMAPS.WL6"), lv), { rndtable: rt, level: lv }), A = g.actors, w = g.w, e = A.list.find(o => o.cls);
  if (!e) continue;
  for (const d of w.doors) {
    const V = d.vertical, cx = d.x + 0.5, cy = d.y + 0.5;
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) for (const l of [-0.45, -0.2, 0, 0.2, 0.45]) for (const m of [-0.45, -0.1, 0.3, 0.45]) for (const s of [2, 3]) {
      // player on one side (along the door normal), guard on the other, offsets along the door
      const p = V ? [cx - s + 0.0, cy + a * 0.5 + l * 0.3] : [cx + a * 0.5 + l * 0.3, cy - s], q = V ? [cx + s + 0.0, cy + b * 0.5 + m * 0.3] : [cx + b * 0.5 + m * 0.3, cy + s];
      if (w.solidAt(Math.floor(p[0]), Math.floor(p[1])) && !(Math.floor(p[0]) === d.x && Math.floor(p[1]) === d.y)) continue;
      if (w.solidAt(Math.floor(q[0]), Math.floor(q[1]))) continue;
      A.grid[e.tiley * w.w + e.tilex] = null; e.tilex = Math.floor(q[0]); e.tiley = Math.floor(q[1]); e.x = (q[0] * 65536) | 0; e.y = (q[1] * 65536) | 0;
      g.pl.x = (p[0] * 65536) | 0; g.pl.y = (p[1] * 65536) | 0;
      const t = V ? (cx - p[0]) / (q[0] - p[0]) : (cy - p[1]) / (q[1] - p[1]); const lat = V ? p[1] + t * (q[1] - p[1]) - d.y : p[0] + t * (q[0] - p[0]) - d.x;
      if (!(t > 0 && t < 1 && lat >= 0 && lat < 1)) continue;
      // every tile on the way must be open except the door: skip lines that clip other walls
      total++; if (A.checkLine(e)) { leaks++; if (ex.length < 6) ex.push({ lv, door: [d.x, d.y, V ? "V" : "H"], p, q, lat }); }
    }
  }
}
console.log("lines through closed doors:", total, "leaks:", leaks); console.log(JSON.stringify(ex));
if (leaks) { console.log("FAIL"); process.exit(1); } console.log("PASS");
