// One level of play: the PlayLoop of WL_PLAY.C in order (controls, MoveDoors, MovePWalls, player think, actors, then the view-dependent part: visibility, pickups).
// Weapons follow WL_AGENT.C (Cmd_Fire, T_Attack, GunAttack, KnifeAttack, CheckWeaponChange). Behaviour from id's source only, not yet compared with the original.
import { World } from "./world.js"; import { Actors, FL, MINACTORDIST } from "./actors.js"; import { stepPlayer } from "./player.js"; import { castSpots } from "./render.js";
const ATTACK = [[[6, 0, 1], [6, 2, 2], [6, 0, 3], [6, -1, 4]], [[6, 0, 1], [6, 1, 2], [6, 0, 3], [6, -1, 4]], [[6, 0, 1], [6, 1, 2], [6, 3, 3], [6, -1, 4]], [[6, 0, 1], [6, 1, 2], [6, 4, 3], [6, -1, 4]]];   // [tics, attack, frame]
export const VIEWW = 320, SHOOTDELTA = VIEWW / 10;
export class Game {
  constructor(lvl, { level = 0, difficulty = 2, rndtable, keys = 0, gs = null, last = 0 }) {
    this.level = level; this.rndtable = rndtable; this.last = last; this.timecount = 0;                 // US_InitRndT(false): LastRnd = 0 (the harness boots with seed 0)
    this.w = new World(lvl, keys).spawnStatics(); this.w.gs.difficulty = difficulty; this.w.mapon = level % 10;
    this.actors = new Actors(this.w, () => this.rnd(), difficulty).spawn(); this.w.actors = this.actors;
    const i = lvl.things.findIndex(o => o >= 19 && o <= 22), a = [90, 0, 270, 180][lvl.things[i] - 19];   // SpawnPlayer: 19 north, 20 east, 21 south, 22 west
    this.pl = { x: (i % lvl.w << 16) + 0x8000, y: ((i / lvl.w | 0) << 16) + 0x8000, angle: a, anglefrac: 0, thrustspeed: 0 }; this.w.pl = this.pl;
    const g = this.w.gs; Object.assign(g, { weapon: 1, chosenweapon: 1, attackframe: 0, attackcount: 0, weaponframe: 0, attacking: false, kills: 0 });
    if (gs) Object.assign(g, gs, { attacking: false, attackframe: 0, attackcount: 0, weaponframe: 0 });
    this.held = {}; this.prev = {}; this.w.connectAreas(); this.frame = 0; this.updateVisibility();
  }
  rnd() { this.last = (this.last + 1) & 0xff; return this.rndtable[this.last]; }
  // TryMove actor test: shootable actors in the 3x3 tile block around the player closer than MINACTORDIST on both axes
  actorBlock(p) {
    const A = this.actors, w = this.w, xl = (p.x - 0x5800 >> 16) - 1, xh = (p.x + 0x5800 >> 16) + 1, yl = (p.y - 0x5800 >> 16) - 1, yh = (p.y + 0x5800 >> 16) + 1;
    for (let y = Math.max(0, yl); y <= Math.min(w.h - 1, yh); y++) for (let x = Math.max(0, xl); x <= Math.min(w.w - 1, xh); x++) {
      const c = A.grid[y * w.w + x]; if (!c || !(c.flags & FL.SHOOTABLE)) continue;
      const dx = p.x - c.x; if (dx < -MINACTORDIST || dx > MINACTORDIST) continue;
      const dy = p.y - c.y; if (dy < -MINACTORDIST || dy > MINACTORDIST) continue; return true;
    }
    return false;
  }
  // input: {up, down, left, right, run, strafe, fire, use, weapon (1-4 key or 0)}; one call = one tic
  tick(input, tics = 1) {
    const w = this.w, g = w.gs, A = this.actors, pl = this.pl; if (w.playstate) return w.playstate;
    this.held = { use: this.prev.use, fire: this.prev.fire }; this.prev = { use: !!input.use, fire: !!input.fire };
    A.tick(tics); w.tick(pl, tics);
    // player think: T_Player, or T_Attack while a weapon animation runs; both start with UpdateFace, which consumes random numbers (that is why it matters for the enemies)
    if (w.adlibPlaying() !== "GETGATLINGSND") g.facecount = (g.facecount || 0) + tics;   // UpdateFace returns early while the chaingun pickup sound plays
    if (w.adlibPlaying() !== "GETGATLINGSND" && g.facecount > this.rnd()) { g.faceframe = this.rnd() >> 6; if (g.faceframe === 3) g.faceframe = 1; g.facecount = 0; }
    if (w.victory) { if (!w.deathcam) this.victorySpin(tics); } else this.playerThink(input, tics);   // the death cam has no player think at all
    for (let i = 0; i < A.list.length; i++) if (!A.list[i].removed) A.doActor(A.list[i]);   // actors spawned during this tic (projectiles) are thought later in the same tic: the original walks a linked list
    this.updateVisibility(); w.pickups(pl, this.spots);
    this.frame++; this.timecount += tics; if (w.exit && !w.playstate) w.playstate = w.exit; return w.playstate;
  }
  playerThink(input, tics) {
    const w = this.w, g = w.gs, pl = this.pl;
    const btn = { use: !!input.use, fire: !!input.fire }, wasAttacking = g.attacking;   // Cmd_Fire only starts the animation; T_Attack counts it down from the next tic on
    if (g.attacking) { if (btn.fire && !this.held.fire) btn.fire = false; if (btn.use && !this.held.use) btn.use = false; }
    else {
      if (g.ammo && input.weapon) for (let i = 0; i <= g.bestweapon; i++) if (input.weapon === i + 1) { g.weapon = g.chosenweapon = i; break; }   // CheckWeaponChange
      if (btn.use) { w.use(pl, this.held.use); this.held.use = true; }
      if (btn.fire && !this.held.fire) { g.attacking = true; g.attackframe = 0; g.attackcount = ATTACK[g.weapon][0][0]; g.weaponframe = ATTACK[g.weapon][0][2]; this.held.fire = true; }
    }
    stepPlayer(pl, input, (x, y) => w.solidAt(x, y), tics, p => this.actorBlock(p)); w.thrustspeed = pl.thrustspeed;
    if (wasAttacking) this.attack(btn, tics);
    const t = w.lvl.things[(pl.y >> 16) * w.w + (pl.x >> 16)];
    if (t === 99 && !w.victory) { w.victory = true; this.actors.spawnBJ(pl); }   // VictoryTile: EXITTILE in the info plane; BJ runs out of the castle
  }
  // VictorySpin: the player turns to face 270 degrees and drifts north while BJ runs
  victorySpin(tics) {
    const pl = this.pl;
    if (pl.angle > 270) pl.angle = Math.max(270, pl.angle - tics * 3); else if (pl.angle < 270) pl.angle = Math.min(270, pl.angle + tics * 3);
    const desty = (((pl.y >> 16) - 5) << 16) - 0x3000; if (pl.y > desty) pl.y = Math.max(desty, pl.y - tics * 4096);
  }
  attack(btn, tics) {
    const g = this.w.gs; g.attackcount -= tics;
    while (g.attackcount <= 0) {
      const cur = ATTACK[g.weapon][g.attackframe];
      switch (cur[1]) {
        case -1:
          g.attacking = false; if (!g.ammo) g.weapon = 0; else if (g.weapon !== g.chosenweapon) g.weapon = g.chosenweapon;
          g.attackframe = g.weaponframe = 0; return;
        case 4: if (!g.ammo) break; if (btn.fire) g.attackframe -= 2;      // falls through to the shot
        case 1: if (!g.ammo) { g.attackframe++; break; } this.gunAttack(); g.ammo--; break;
        case 2: this.knifeAttack(); break;
        case 3: if (g.ammo && btn.fire) g.attackframe -= 2; break;
      }
      g.attackcount += cur[0]; g.attackframe++; g.weaponframe = ATTACK[g.weapon][g.attackframe][2];
    }
  }
  targets() { return this.actors.list.filter(o => !o.removed && (o.flags & FL.SHOOTABLE) && (o.flags & FL.VISABLE) && Math.abs(o.viewx - VIEWW / 2) < SHOOTDELTA); }
  knifeAttack() {
    this.w.sound("ATKKNIFESND");
    let best = null, dist = 0x7fffffff;
    for (const o of this.targets()) if (o.transx < dist) { dist = o.transx; best = o; }
    if (!best || dist > 0x18000) return;
    this.actors.damageActor(best, this.rnd() >> 4);
  }
  gunAttack() {
    const A = this.actors, p = this.pl; A.madenoise = true; this.w.sound(["ATKKNIFESND", "ATKPISTOLSND", "ATKMACHINEGUNSND", "ATKGATLINGSND"][this.w.gs.weapon]);
    let viewdist = 0x7fffffff, closest = null;
    for (;;) {
      const old = closest;
      for (const o of this.targets()) if (o.transx < viewdist) { viewdist = o.transx; closest = o; }
      if (closest === old) return;
      if (A.checkLine(closest)) break;
    }
    { const w = this.w, doors = [], n = 60;   // debug: which doors lie on the line to the target and in what state (shown in the page's debug panel)
      for (let i = 1; i < n; i++) { const x = (p.x + (closest.x - p.x) * i / n) / 65536 | 0, y = (p.y + (closest.y - p.y) * i / n) / 65536 | 0, tv = w.tilemap[y * w.w + x]; if (tv & 0x80) { const d = w.doors[tv & 0x7f], k = `${d.x},${d.y}`; if (!doors.includes(k + ` action ${d.action} pos ${d.pos}`)) doors.push(k + ` action ${d.action} pos ${d.pos}`); } }
      w.lastShot = `${closest.cls} at ${closest.tilex},${closest.tiley}; doors on the line: ${doors.join("; ") || "none"}`; }
    const dx = Math.abs(closest.tilex - (p.x >> 16)), dy = Math.abs(closest.tiley - (p.y >> 16)), dist = dx > dy ? dx : dy; let dmg;
    if (dist < 2) dmg = Math.trunc(this.rnd() / 4); else if (dist < 4) dmg = Math.trunc(this.rnd() / 6);
    else { if (Math.trunc(this.rnd() / 12) < dist) return; dmg = Math.trunc(this.rnd() / 6); }
    A.damageActor(closest, dmg);
  }
  // ThreeDRefresh's side effects: which tiles the rays touched, FL_VISABLE / active, view position of every actor (TransformActor)
  updateVisibility() {
    const w = this.w, p = this.pl, spots = this.spots = castSpots(w, { x: p.x / 65536, y: p.y / 65536, a: p.angle * Math.PI / 180 }, VIEWW), a = p.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const vx = p.x - 0x5700 * c, vy = p.y + 0x5700 * s, tan = 0x8000 / (0x5700 + 0x5800), proj = (VIEWW / 2) / tan;
    for (const ob of this.actors.list) {
      if (ob.removed) continue;
      const i = ob.tiley * w.w + ob.tilex; let vis = spots[i];
      for (const d of [-1, 1, -w.w - 1, -w.w, -w.w + 1, w.w - 1, w.w, w.w + 1]) if (!vis && spots[i + d] && !w.tilemap[i + d]) vis = 1;
      if (!vis) { ob.flags &= ~FL.VISABLE; continue; }
      ob.active = true;
      const gx = ob.x - vx, gy = ob.y - vy, nx = gx * c - gy * s - 0x4000, ny = gy * c + gx * s;   // TransformActor: ACTORSIZE 0x4000
      ob.transx = nx; if (nx < 0x5800) { ob.viewheight = 0; continue; }
      ob.viewx = VIEWW / 2 + ny / nx * proj; ob.viewheight = proj * 65536 / nx; ob.flags |= FL.VISABLE;
    }
  }
}
