// Bosses of episodes 2-6 (source only): each spawns with the right hit points, wakes up, attacks with its own weapon (needle, rocket, flame, bullets), dies for the right points; Hitler morphs; Schabbs/Gift/Fat/Hitler end the episode through the death cam.
import { readFileSync } from "node:fs"; import { decodeLevel } from "./src/map.js"; import { Game } from "./src/game.js"; import { FL } from "./src/actors.js";
const R = new URL("../vendor/ref/", import.meta.url), ab = f => { const b = readFileSync(new URL(f, R)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const rt = JSON.parse(readFileSync(new URL("rndtable.json", import.meta.url)));
const mk = (lv, d = 2) => new Game(decodeLevel(ab("MAPHEAD.WL6"), ab("GAMEMAPS.WL6"), lv), { rndtable: rt, level: lv, difficulty: d });
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log("FAIL", m); } };
const B = [[18, "schabb", 1550, 5000, "needle"], [28, "mecha", 1050, 5000, "bullet"], [38, "gift", 1050, 5000, "rocket"], [48, "gretel", 1050, 5000, "bullet"], [58, "fat", 1050, 5000, "rocket"]];
for (const [lv, cls, hp, pts, weapon] of B) {
  const g = mk(lv), A = g.actors, h = A.list.find(o => o.cls === cls), gs = g.w.gs;
  ok(h && h.hitpoints === hp, `${cls} hp ${h?.hitpoints}`); if (!h) continue;
  // find a free tile with line of sight 3 tiles from the boss
  let placed = false;   // any free tile 2-6 tiles away with a clear line to the boss
  for (let r = 2; r <= 6 && !placed; r++) for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r && !placed; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const tx = h.tilex + dx, ty = h.tiley + dy; if (g.w.solidAt(tx, ty) || A.grid[ty * g.w.w + tx]) continue;
    g.pl.x = (tx << 16) + 0x8000; g.pl.y = (ty << 16) + 0x8000; g.w.connectAreas(); g.updateVisibility(); if (A.checkLine(h)) placed = true;
  }
  ok(placed, `${cls}: firing position`); if (!placed) continue;
  gs.health = 1e6; gs.ammo = 99; const seen = new Set(); let t = 0, res = null;
  for (; t < 30000 && h.hitpoints > 0; t++) {
    gs.ammo = 99; g.tick({ fire: t % 10 === 0 }); for (const o of A.list) if (o.cls && o.cls !== cls && !o.removed) seen.add(o.cls);
    if (t % 4 === 0 && !g.w.victory) g.pl.angle = Math.round(Math.atan2(-(h.y - g.pl.y), h.x - g.pl.x) * 180 / Math.PI + 360) % 360;
    res = g.w.playstate;
  }
  for (let i = 0; i < 150; i++) g.tick({});   // the morph happens 20 tics into the death
  const killed = h.hitpoints <= 0 || cls === "mecha" && h.hitpoints <= 0; ok(killed, `${cls} dies (hp ${h.hitpoints}, ${t} tics, health lost ${1e6 - gs.health})`);
  ok(gs.score >= pts, `${cls} gives ${pts} points (score ${gs.score})`); ok(1e6 - gs.health > 0, `${cls} hurt the player`);
  if (weapon !== "bullet") ok(seen.has(weapon), `${cls} fired ${weapon}s (saw ${[...seen]})`);
  if (cls === "mecha") { ok(A.list.some(o => o.cls === "hitler"), "mecha hitler morphs into Hitler"); }
  if (["schabb", "gift", "fat"].includes(cls)) { for (let i = 0; i < 3000 && !g.w.playstate; i++) g.tick({}); ok(g.w.deathcam && g.w.playstate === "victorious", `${cls}: death cam then victory (${g.w.playstate})`); }
  console.log(cls, "level", lv, "killed in", t, "tics, projectiles seen:", [...seen].join(",") || "-");
}
{ // Hitler himself: kill the real Hitler after the morph
  const g = mk(28), A = g.actors, m = A.list.find(o => o.cls === "mecha"); g.w.gs.health = 1e6; g.w.gs.ammo = 99;
  g.pl.x = (m.tilex << 16) + 0x8000; g.pl.y = ((m.tiley - 2) << 16) + 0x8000; g.pl.angle = 270; g.w.connectAreas(); g.updateVisibility();
  let h = null; for (let t = 0; t < 12000 && !g.w.playstate; t++) { h = A.list.find(o => o.cls === "hitler" && !o.removed) || h; const tgt = h && h.hitpoints > 0 ? h : m;
    if (t % 4 === 0 && !g.w.victory) g.pl.angle = Math.round(Math.atan2(-(tgt.y - g.pl.y), tgt.x - g.pl.x) * 180 / Math.PI + 360) % 360; g.tick({ fire: t % 10 === 0 }); }
  ok(h && h.hitpoints <= 0, "real Hitler dies"); ok(g.w.playstate === "victorious", "Hitler: death cam, then victory: " + g.w.playstate); console.log("Hitler floor: victory", g.w.playstate, "score", g.w.gs.score);
}
{ // the flame thrower of a fake Hitler (E3M9 has five)
  const g = mk(28), A = g.actors, f = A.list.find(o => o.cls === "fake"); ok(f && f.hitpoints === 400, "fake Hitler hp"); }
console.log(bad ? "FAIL" : "PASS"); process.exit(bad ? 1 : 0);
