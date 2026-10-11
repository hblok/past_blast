// W2 gate: replay the key script of scenario e5_turn_run in the port and compare with the original's recorded x/y/angle per frame (port/ref/e5_turn_run.jsonl).
// Doors are not implemented until W3, so the check runs from a re-sync point: every window starts from the recorded state; a window ends at the frame where the recorded run opens the door.
import { readFileSync } from "node:fs"; import { decodeLevel } from "./src/map.js"; import { stepPlayer } from "./src/player.js";
const R = new URL("../vendor/ref/", import.meta.url), ab = f => { const b = readFileSync(new URL(f, R)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const lvl = decodeLevel(ab("MAPHEAD.WL6"), ab("GAMEMAPS.WL6"), 0);
const solid = (x, y) => { if (x < 0 || y < 0 || x >= 64 || y >= 64) return true; const t = lvl.walls[y * 64 + x]; return t > 0 && t < 64 || t >= 90 && t < 102; };  // closed doors block
const ref = readFileSync(new URL("ref/e5_turn_run.jsonl", import.meta.url), "utf8").trim().split("\n").map(JSON.parse);
const ev = {}; for (const l of readFileSync(new URL("ref/e5_turn_run.txt", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^(\d+):\s*(.*)/); if (m) ev[m[1]] = m[2].trim().split(/\s+/); }
const name = { Up: "up", Down: "down", Left: "left", Right: "right", rshift: "run", lshift: "run" };
const keys = {}, held = [];   // keys held after the events of frame f apply to the step f -> f+1
for (let f = 0; f < ref.length; f++) { for (const e of ev[f] || []) { const k = name[e.slice(1)]; if (k) keys[k] = e[0] === "+"; } held.push({ ...keys }); }
let bad = 0, checked = 0;
// windows: [from, to) resync at `from`; the door at (32,57) is opened by the original at frame 60 and passed at ~125, so skip 60..150
for (const [a, b] of [[0, 60], [150, 250]]) {
  const r0 = ref[a], p = { x: r0["player.x"], y: r0["player.y"], angle: r0["player.angle"], anglefrac: 0 };
  for (let f = a; f < b - 1; f++) {
    stepPlayer(p, held[f], solid, ref[f + 1].tics); const r = ref[f + 1]; checked++;
    if (p.x !== r["player.x"] || p.y !== r["player.y"] || p.angle !== r["player.angle"]) { if (bad++ < 5) console.log(`frame ${f + 1}: port ${p.x},${p.y},${p.angle}  original ${r["player.x"]},${r["player.y"]},${r["player.angle"]}`); p.x = r["player.x"]; p.y = r["player.y"]; p.angle = r["player.angle"]; }
  }
}
console.log(`${checked} frames checked, ${bad} differ`); process.exit(bad ? 1 : 0);
