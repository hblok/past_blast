// W5 oracle check: replay a scenario in the port and compare every actor (x, y, tile, dir, area, distance, hitpoints, speed, flags) with the original's per-frame objlist dump.
// usage: node check_enemy_oracle.mjs <ref.jsonl> <scenario.txt> [frames]   (ref: state.jsonl of harness/run.py with field "objs" = objlist raw words, 30 words per object)
import { readFileSync } from "node:fs"; import { gunzipSync } from "node:zlib"; import { decodeLevel } from "./src/map.js"; import { Game } from "./src/game.js"; import { STATES } from "./src/states_data.js";
const R = new URL("../vendor/ref/", import.meta.url), ab = f => { const b = readFileSync(new URL(f, R)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const rt = JSON.parse(readFileSync(new URL("rndtable.json", import.meta.url)));
const [refFile, scenFile, nfr] = process.argv.slice(2);
const ref = (refFile.endsWith(".gz") ? gunzipSync(readFileSync(refFile)).toString() : readFileSync(refFile, "utf8")).trim().split("\n").map(JSON.parse), N = +nfr || ref.length;
const ev = {}; for (const l of readFileSync(scenFile, "utf8").split("\n")) { const m = l.match(/^(\d+):\s*(.*)/); if (m) ev[m[1]] = (ev[m[1]] || []).concat(m[2].trim().split(/\s+/)); }
const mkGame = (lv, last = 0) => new Game(decodeLevel(ab("MAPHEAD.WL6"), ab("GAMEMAPS.WL6"), lv), { rndtable: rt, level: lv, last });
let g = mkGame(0), lvl = 0, startScore = 0;
// objlist slot of every port actor: initial actors take slots 1..n in spawn order; later ones (projectiles, morphs, smoke) take the head of the free list (GetNewActor), removed ones go back to its head (RemoveObj)
let slotOf = new Map(), seen = 0, freeList = [], nextFresh = 1;
const syncSlots = () => {
  for (const [kind, a] of g.actors.log.splice(0)) {
    if (kind === "s") slotOf.set(a, freeList.length ? freeList.shift() : nextFresh++); else freeList.unshift(slotOf.get(a));
  }
};
const resetSlots = () => { slotOf = new Map(); freeList = []; nextFresh = 1; syncSlots(); };
resetSlots();
const names = { Up: "up", Down: "down", Left: "left", Right: "right", rshift: "run", space: "use", ctrl: "fire" }; const keys = {};
const u32 = (o, i) => (o[i] | o[i + 1] << 16) >>> 0, s16 = v => v << 16 >> 16;
const dec = (words, k) => { const o = words.slice(k * 30, k * 30 + 30); return { ticcount: s16(o[1]), x: u32(o, 8), y: u32(o, 10), tilex: o[12], tiley: o[13], area: o[14] & 0xff, flags: o[4] & 0xff, dist: u32(o, 5) | 0, dir: s16(o[7]), hp: s16(o[22]), speed: u32(o, 23), statep: o[3] }; };
// alignment (found by comparing frame 0): the recorded state f is the state AFTER the logic of frame f; the first logic frame ran with tics=1 even though the tics field of frame 0 says 10
g.tick({}, 1);
let firstBad = null, stats = { frames: 0, fieldsBad: {} }; const stMap = new Map();
const compare = (f) => {
  const r = ref[f].objs; if (!r) return; stats.frames++;
  if (ref[f].rndindex !== undefined && ref[f].rndindex !== g.last) { stats.fieldsBad.rndindex = (stats.fieldsBad.rndindex || 0) + 1; if (!firstBad) firstBad = { frame: f, key: "rndindex", port: g.last, orig: ref[f].rndindex }; }   /* the random index is the earliest sign of a desync */
  for (const [k, mine] of [["health", g.w.gs.health], ["ammo", g.w.gs.ammo], ["score", g.w.gs.score], ...(ref[f].health > 0 ? [["player.x", g.pl.x], ["player.y", g.pl.y], ["player.angle", g.pl.angle]] : [])])   /* while dying the original swings the view to the killer (Died()); not modelled */ if (ref[f][k] !== undefined && ref[f][k] !== mine) { stats.fieldsBad[k.startsWith("player.") ? k : "player." + k] = (stats.fieldsBad["player." + k] || 0) + 1; if (!firstBad) firstBad = { frame: f, key: k.startsWith("player.") ? k : "player." + k, port: mine, orig: ref[f][k] }; }
  g.actors.list.forEach((a, i) => {
    const k = slotOf.get(a); if (a.removed || (k + 1) * 30 > r.length) return;   /* only the first slots of the objlist are recorded */ const o = dec(r, k), mine = { x: a.x, y: a.y, tilex: a.tilex, tiley: a.tiley, dir: a.dir, area: a.area, hp: a.hitpoints, distance: a.distance };
    const cmp = { x: o.x, y: o.y, tilex: o.tilex, tiley: o.tiley, dir: o.dir, area: o.area, hp: o.hp, distance: o.dist };
    for (const key of Object.keys(mine)) if (mine[key] !== cmp[key]) { stats.fieldsBad[key] = (stats.fieldsBad[key] || 0) + 1; if (!firstBad) firstBad = { frame: f, actor: k, key, port: mine[key], orig: cmp[key], cls: a.cls, state: a.state, origState: o.statep, portAngle: a.angle, origAngle: r[k * 30 + 21] }; }
  });
};
compare(0);
for (let f = 0; f < N - 1; f++) {
  let warped = false;
  for (const e of ev[f] || []) {
    if (e.startsWith("set:8CC2=")) { const b = e.slice(9).match(/../g).map(h => parseInt(h, 16)), lv = b[0] | b[1] << 8; g = mkGame(lv, 0); resetSlots(); lvl = lv; startScore = g.w.gs.score; warped = true; continue; }   /* the harness patches US_InitRndT: every level setup starts the random index at 0 */
    if (e.startsWith("set:8CBE=")) continue;
    { const m = e.match(/^set:8CD([248CAC])=(..)(..)$/); if (m) { const v = parseInt(m[3] + m[2], 16), gs = g.w.gs; ({ 2: () => gs.health = v, 4: () => gs.ammo = v, 8: () => gs.bestweapon = v, 10: () => gs.weapon = v, 12: () => gs.chosenweapon = v })[parseInt(m[1], 16)]?.(); continue; } }
    if (e.startsWith("set:AC5E=")) { const b = e.slice(9).match(/../g).map(h => parseInt(h, 16)); g.pl.x = (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0; }
    else if (e.startsWith("set:AC62=")) { const b = e.slice(9).match(/../g).map(h => parseInt(h, 16)); g.pl.y = (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0; }
    else if (e.startsWith("set:AC78=")) { const b = e.slice(9).match(/../g).map(h => parseInt(h, 16)); g.pl.angle = b[0] | b[1] << 8; }
    else if (/^[+-]/.test(e) && names[e.slice(1)]) keys[names[e.slice(1)]] = e[0] === "+";
  }
  if (warped) { compare(f + 1); continue; }   // ref[f+1] shows the freshly loaded level (before its first logic step; ref[f].tics is the tics of the step f -> f+1)
  if (process.env.DBG_ACTOR && f >= +process.env.DBG_FROM && f <= +process.env.DBG_TO) { const a = [...slotOf.entries()].find(([, k]) => k === +process.env.DBG_ACTOR)?.[0] || g.actors.list[0]; console.log("f", f, "tics", ref[f].tics, a.cls, a.state, "tic", a.ticcount, "x", a.x, "y", a.y, "dir", a.dir, "dist", a.distance, "last", g.last, "los", g.actors.checkLine(a)); }   /* debug: DBG_ACTOR=k DBG_FROM=f DBG_TO=f */
  if (process.env.DBG_PL && f >= +process.env.DBG_PL.split("-")[0] && f <= +process.env.DBG_PL.split("-")[1]) { const near = g.actors.list.filter(o => !o.removed && Math.abs(o.x - g.pl.x) < 3 * 65536 && Math.abs(o.y - g.pl.y) < 3 * 65536).map(o => `${o.cls}:${o.state}:${o.x},${o.y}:fl${o.flags}:grid${(g.actors.grid[o.tiley * g.w.w + o.tilex] || {cls:"none"}).cls + "@" + o.tilex + "," + o.tiley}`); console.log("pl f", f, g.pl.x, g.pl.y, JSON.stringify(keys), near.join(" ")); }
  g.tick({ ...keys }, ref[f].tics); syncSlots();
  if (g.w.sounds.length) { if (process.env.DBG_SND) console.log("snd f", f, g.w.sounds.map(x => x.name).join(",")); g.w.sounds.length = 0; }   /* DBG_SND=1 lists the sound events */
  if (g.w.playstate === "died") {   // Died(): after the death animation the level restarts with 100 health, pistol, 8 ammo, one life less, the score of the level start, random index 0
    const lives = g.w.gs.lives, j = ref.findIndex((r, i) => i > f && r.lives < lives); compare(f + 1);
    if (j < 0) break; const gs = g.w.gs; g = new Game(decodeLevel(ab("MAPHEAD.WL6"), ab("GAMEMAPS.WL6"), lvl), { rndtable: rt, level: lvl, last: 0, gs: { health: 100, ammo: 8, score: startScore, lives: lives - 1, nextextra: gs.nextextra, bestweapon: 1, weapon: 1, chosenweapon: 1 } }); resetSlots();
    for (const k in keys) keys[k] = false;   /* Died() calls IN_ClearKeysDown: keys held by the script stay released until their next +Key event */
    f = j - 1; compare(j); continue;
  }
  compare(f + 1);
}
console.log(JSON.stringify(stats), firstBad ? "FIRST DIFFERENCE " + JSON.stringify(firstBad) : "ALL MATCH");
process.exit(firstBad ? 1 : 0);
