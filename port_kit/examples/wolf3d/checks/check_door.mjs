// W3 gate: scenario door_wait in the port. The original (captures/door_wait, 134cb DoorOpen calls) has the first door's tic counter at frame F (after the frame) = F-105,
// and CloseDoor starts when it reaches 300 (frame 405). Player snapped to tile (31,57) facing east, +space at frame 41.
import { readFileSync } from "node:fs"; import { decodeLevel } from "./src/map.js"; import { World, DR } from "./src/world.js";
const R = new URL("../vendor/ref/", import.meta.url), ab = f => { const b = readFileSync(new URL(f, R)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const w = new World(decodeLevel(ab("MAPHEAD.WL6"), ab("GAMEMAPS.WL6"), 0));
const pl = { x: 0x1f8000, y: 0x398000, angle: 0 }, d = w.doors.find(d => d.x === 32 && d.y === 57); let bad = 0;
const log = {};
for (let f = 0; f < 440; f++) {   // state f+1 = step(state f); events at hook f act in step f -> f+1
  if (f === 41) w.use(pl);
  w.tick(pl, 1); const F = f + 1; log[F] = { action: d.action, pos: d.pos, tic: d.tic };
}
const expect = (cond, msg) => { if (!cond) { bad++; console.log("FAIL", msg); } };
expect(log[42].action === DR.opening, "opening at frame 42");
expect(log[104].action === DR.opening && log[105].action === DR.open, `fully open at frame 105 (got ${log[104].action}/${log[105].action})`);
for (let F = 106; F <= 404; F++) expect(log[F].tic === F - 105, `tic at ${F}: ${log[F].tic} want ${F - 105}`);
expect(log[404].action === DR.open, "still open at 404");
expect(log[405].action === DR.closing, `closing starts at 405 (got ${log[405].action}, tic ${log[405].tic})`);
expect(log[440].pos < 0xffff && log[440].pos > 0 || log[440].action === DR.closed, "closing progresses");
console.log("door timeline:", [42, 105, 106, 405, 440].map(F => `${F}:${log[F].action}/${log[F].pos}/${log[F].tic}`).join(" "), bad ? "FAIL" : "PASS");
process.exit(bad ? 1 : 0);
