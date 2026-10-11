// Enemies (W5): guard, officer, SS, dog, mutant. State tables are generated from id's source (states_data.js); the logic below follows WL_STATE.C / WL_ACT2.C
// (behaviour only): NewState, TryWalk, SelectDodgeDir/SelectChaseDir, MoveObj, CheckLine/CheckSight/SightPlayer/FirstSighting, T_Stand/T_Path/T_Chase/T_DogChase/T_Shoot/T_Bite,
// DoActor, KillActor/DamageActor, spawning. Positions are 16.16 integers, one `tics` per call. Nothing here is verified against the original yet ([source] only).
import { STATES } from "./states_data.js"; import { fixedByFrac, sinOf, cosOf } from "./player.js";
for (const n of ["s_schabbdie2", "s_giftdie2", "s_fatdie2", "s_hitlerdie2"]) STATES[n][2] = 140;   // SpawnSchabbs & co: the pause before the fall is 140 tics with digitized sound on
export const TILEGLOBAL = 0x10000, MINACTORDIST = 0x10000, MINDIST = 0x5800;
export const FL = { SHOOTABLE: 1, BONUS: 2, NEVERMARK: 4, VISABLE: 8, ATTACKMODE: 16, FIRSTATTACK: 32, AMBUSH: 64, NONMARK: 128 };
const E = 0, NE = 1, N = 2, NW = 3, W = 4, SW = 5, S = 6, SE = 7, NODIR = 8;
const OPP = [W, SW, S, SE, E, NE, N, NW, NODIR];
const DIAG = (() => { const t = Array.from({ length: 9 }, () => Array(9).fill(NODIR));
  t[E][N] = NE; t[E][S] = SE; t[N][E] = NE; t[N][W] = NW; t[W][N] = NW; t[W][S] = SW; t[S][E] = SE; t[S][W] = SW; return t; })();
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, -1, -1, -1, 0, 1, 1, 1];     // dirtype -> tile step (east, northeast, north, ...)
export const DIRANGLE = [0, 45, 90, 135, 180, 225, 270, 315, 0];
const SPDPATROL = 512, SPDDOG = 1500, RUNSPEED = 6000;
// obclass names and start hit points [difficulty 0..3][guard, officer, ss, dog, mutant, Hans] (starthitpoints, WL_ACT2.C)
const HP = [[25, 50, 100, 1, 45, 850], [25, 50, 100, 1, 55, 950], [25, 50, 100, 1, 55, 1050], [25, 50, 100, 1, 65, 1200]];
const KIND = ["guard", "officer", "ss", "dog", "mutant", "boss"];
const PFX = { guard: "grd", officer: "ofc", ss: "ss", dog: "dog", mutant: "mut", boss: "boss", gretel: "gretel", schabb: "schabb", gift: "gift", fat: "fat", fake: "fake", mecha: "mecha", hitler: "hitler" };
const POINTS = { guard: 100, officer: 400, ss: 500, dog: 200, mutant: 700, boss: 5000, gretel: 5000, schabb: 5000, gift: 5000, fat: 5000, fake: 2000, mecha: 5000, hitler: 5000 };
const SPEEDUP = { guard: 3, officer: 5, mutant: 3, ss: 4, dog: 2, boss: 3, gretel: 3, schabb: 3, gift: 3, fat: 3, fake: 3, mecha: 3, hitler: 5 };
// the bosses of WL6 (start hit points per difficulty, spawn codes of the info plane, facing) [starthitpoints, ScanInfoPlane]
const BOSSHP = { gretel: [850, 950, 1050, 1200], schabb: [850, 950, 1550, 2400], gift: [850, 950, 1050, 1200], fat: [850, 950, 1050, 1200], fake: [200, 300, 400, 500], mecha: [800, 950, 1050, 1200], hitler: [500, 700, 800, 900] };
const BOSSSPAWN = { 197: ["gretel", N], 196: ["schabb", S], 215: ["gift", N], 179: ["fat", S], 160: ["fake", N], 178: ["mecha", S] };
const SIGHT = { boss: "GUTENTAGSND", gretel: "KEINSND", gift: "EINESND", fat: "ERLAUBENSND", schabb: "SCHABBSHASND", fake: "TOT_HUNDSND", mecha: "DIESND", hitler: "DIESND" };
const DEATHSND = { boss: "MUTTISND", schabb: "MEINGOTTSND", fake: "HITLERHASND", mecha: "SCHEISTSND", hitler: "EVASND", gretel: "MEINSND", gift: "DONNERSND", fat: "ROSESND" };
const ISBOSS = new Set(["boss", "gretel", "schabb", "gift", "fat", "fake", "mecha", "hitler"]);
const ICONARROWS = 90, AREATILE = 107, AMBUSHTILE = 106;

export class Actors {
  // w: World; rnd: () => 0..255 (US_RndT); player access through w.pl ({x, y, angle}) and w.gs
  constructor(w, rnd, difficulty = 2) {
    this.w = w; this.rnd = rnd; this.difficulty = difficulty; this.list = []; this.tics = 1; this.madenoise = false;
    this.grid = new Array(w.w * w.h).fill(null); this.kills = 0; this.killtotal = 0; this.log = [];   // log: spawn / remove events in order (the oracle emulates objlist slots with it)
  }
  // ---- spawning (ScanInfoPlane, SpawnStand, SpawnPatrol) ----
  spawn() {
    const { w } = this, lv = w.lvl;
    for (let i = 0; i < lv.w * lv.h; i++) {
      let t = lv.things[i]; if (!t) continue;
      const x = i % lv.w, y = i / lv.w | 0;
      if (t === 124) { this.spawnDead(x, y); continue; }
      if (t === 214) { this.spawnBoss(x, y); continue; }
      if (BOSSSPAWN[t]) { this.spawnBig(x, y, ...BOSSSPAWN[t]); continue; }
      const d = this.difficulty;
      const grp = (base, n, step, kind, patrol) => {      // tiers: easy at base, medium at base+step (difficulty >= 2), hard at base+2*step (difficulty >= 3)
        for (let k = 0; k < 3; k++) if (t >= base + k * step && t < base + k * step + n) {
          if (d < [0, 2, 3][k]) return true;
          const dir = t - (base + k * step); patrol ? this.spawnPatrol(kind, x, y, dir) : this.spawnStand(kind, x, y, dir); return true;
        }
        return false;
      };
      grp(108, 4, 36, 0, false) || grp(112, 4, 36, 0, true) || grp(116, 4, 36, 1, false) || grp(120, 4, 36, 1, true) || grp(126, 4, 36, 2, false) || grp(130, 4, 36, 2, true)
        || grp(134, 4, 36, 3, false) || grp(138, 4, 36, 3, true) || grp(216, 4, 18, 4, false) || grp(220, 4, 18, 4, true);
    }
    return this;
  }
  newObj(tx, ty, state) {
    const ob = { state, ticcount: 0, tilex: tx, tiley: ty, x: tx * TILEGLOBAL + TILEGLOBAL / 2, y: ty * TILEGLOBAL + TILEGLOBAL / 2, dir: NODIR, flags: 0, distance: 0, speed: 0, hitpoints: 0, temp2: 0, active: false, cls: null, viewx: 0, transx: 0, viewheight: 0 };
    const tt = STATES[state][2]; ob.ticcount = tt ? this.rnd() % tt : 0;
    ob.area = this.w.areaAt(tx, ty); this.grid[ty * this.w.w + tx] = ob; this.list.push(ob); this.log.push(["s", ob]); return ob;
  }
  spawnDead(x, y) { const ob = this.newObj(x, y, "s_grddie4"); ob.cls = "inert"; }
  spawnStand(kind, x, y, dir) {
    const k = KIND[kind]; if (!STATES[`s_${PFX[k]}stand`]) return;   // dogs have no stand state in the source
    const ob = this.newObj(x, y, `s_${PFX[k]}stand`);
    ob.speed = SPDPATROL; this.killtotal++;
    const wl = this.w.lvl.walls, i = y * this.w.w + x;
    if (wl[i] === AMBUSHTILE) {                                      // ambush: area taken from a neighbouring floor tile
      this.w.tilemap[i] = 0; let tile = 0;
      for (const j of [i + 1, i - this.w.w, i + this.w.w, i - 1]) if (wl[j] >= AREATILE) tile = wl[j];
      wl[i] = tile; this.w.area[i] = ob.area = tile - AREATILE; ob.flags |= FL.AMBUSH;
    }
    ob.cls = k; ob.hitpoints = HP[this.difficulty][kind]; ob.dir = dir * 2; ob.flags |= FL.SHOOTABLE;
  }
  spawnBoss(x, y) {                                                  // SpawnBoss: Hans Grosse, facing south, waits in ambush mode
    const ob = this.newObj(x, y, "s_bossstand"); ob.speed = SPDPATROL; ob.cls = "boss"; ob.hitpoints = HP[this.difficulty][5]; ob.dir = S; ob.flags |= FL.SHOOTABLE | FL.AMBUSH; this.killtotal++;
  }
  spawnBig(x, y, cls, dir) {                                         // SpawnGretel / Schabbs / Gift / Fat / FakeHitler / Hitler (Hitler starts as the mecha suit)
    const ob = this.newObj(x, y, `s_${PFX[cls]}stand`); ob.speed = SPDPATROL; ob.cls = cls; ob.hitpoints = BOSSHP[cls][this.difficulty]; ob.dir = dir; ob.flags |= FL.SHOOTABLE | FL.AMBUSH; this.killtotal++;
  }
  // GetNewActor: projectiles and smoke do not consume random numbers; they have no tile spot of their own unless NONMARK allows it
  newActor(state, o) {
    const ob = { state, ticcount: 1, dir: NODIR, flags: 0, distance: 0, speed: 0, hitpoints: 0, temp2: 0, active: true, cls: null, viewx: 0, transx: 0, viewheight: 0, angle: 0, ...o }; this.list.push(ob); this.log.push(["s", ob]); return ob;
  }
  throwAt(ob, state, cls, speed, flags, snd) {                       // T_SchabbThrow / T_GiftThrow / T_FakeFire: a projectile aimed at the player
    const p = this.w.pl; let ang = Math.fround(Math.atan2(ob.y - p.y, p.x - ob.x)); if (ang < 0) ang = Math.fround(Math.PI * 2 + ang);   // `float angle` of the original: rounded to 32 bits
    const n = this.newActor(state, { tilex: ob.tilex, tiley: ob.tiley, x: ob.x, y: ob.y, cls, angle: Math.trunc(ang / (Math.PI * 2) * 360), speed, flags, area: 0 });   // GetNewActor zeroes the object: area number 0
    this.w.sound(snd, n.x, n.y); return n;
  }
  // T_Projectile: moves along its angle, stops at walls (rockets explode), hurts the player on contact
  tProjectile(ob) {
    const w = this.w, p = w.pl, speed = ob.speed * this.tics;
    let dx = fixedByFrac(speed, cosOf(ob.angle)), dy = -fixedByFrac(speed, sinOf(ob.angle)); if (dx > 0x10000) dx = 0x10000; if (dy > 0x10000) dy = 0x10000;
    ob.x += dx; ob.y += dy; const ax = Math.abs(ob.x - p.x), ay = Math.abs(ob.y - p.y);
    const xl = (ob.x - 0x2000) >> 16, yl = (ob.y - 0x2000) >> 16, xh = (ob.x + 0x2000) >> 16, yh = (ob.y + 0x2000) >> 16; let blocked = false;
    for (let y = yl; y <= yh; y++) for (let x = xl; x <= xh; x++) if (w.solidAt(x, y)) blocked = true;
    if (blocked) { if (ob.cls === "rocket") { w.sound("MISSILEHITSND", ob.x, ob.y); ob.state = "s_boom1"; } else ob.state = null; return; }
    if (ax < 0xc000 && ay < 0xc000) {
      const dmg = ob.cls === "needle" ? (this.rnd() >> 3) + 20 : ob.cls === "rocket" ? (this.rnd() >> 3) + 30 : this.rnd() >> 3;
      w.takeDamage(dmg, ob); ob.state = null; return;
    }
    ob.tilex = ob.x >> 16; ob.tiley = ob.y >> 16;
  }
  aSmoke(ob) { this.newActor("s_smoke1", { dir: 0, ticcount: 6, tilex: ob.tilex, tiley: ob.tiley, x: ob.x, y: ob.y, cls: "inert", flags: FL.NEVERMARK, area: 0 }); }
  // A_HitlerMorph: the mecha suit opens and the real Hitler appears in its place
  aHitlerMorph(ob) {
    const n = this.newObj(ob.tilex, ob.tiley, "s_hitlerchase1"); n.speed = SPDPATROL * 5; n.x = ob.x; n.y = ob.y; n.distance = ob.distance; n.dir = ob.dir;
    n.flags = ob.flags | FL.SHOOTABLE; n.cls = "hitler"; n.hitpoints = BOSSHP.hitler[this.difficulty]; n.area = ob.area;
  }
  // A_StartDeathCam: the first call shows the kill again from a position near the boss, the second ends the episode
  aStartDeathCam(ob) {
    const w = this.w, p = w.pl;
    if (w.victory) { w.playstate = "victorious"; return; }
    w.victory = w.deathcam = true; p.x = w.killx; p.y = w.killy;
    let a = Math.fround(Math.atan2(p.y - ob.y, ob.x - p.x)); if (a < 0) a = Math.fround(Math.PI * 2 + a); p.angle = Math.trunc(a / (Math.PI * 2) * 360);
    for (let d = 0x14000, ok = false; !ok; d += 0x1000) {              // back off from the boss until the player is not inside a wall
      p.x = ob.x - fixedByFrac(d, cosOf(p.angle)); p.y = ob.y + fixedByFrac(d, sinOf(p.angle)); ok = true;
      for (let y = (p.y - 0x2000) >> 16; y <= (p.y + 0x2000) >> 16; y++) for (let x = (p.x - 0x2000) >> 16; x <= (p.x + 0x2000) >> 16; x++) if (w.solidAt(x, y)) ok = false;
      if (d > 0x400000) break;
    }
    ob.state = `s_${PFX[ob.cls]}deathcam`; ob.ticcount = STATES[ob.state][2]; w.connectAreas();
  }
  // SpawnBJVictory: BJ appears at the player's position and runs north 6 tiles, then jumps
  spawnBJ(pl) {
    const ob = this.newObj(pl.x >> 16, (pl.y >> 16) + 1, "s_bjrun1"); ob.cls = "bj"; ob.x = pl.x; ob.y = pl.y; ob.dir = N; ob.temp1 = 6; ob.active = true; return ob;
  }
  spawnPatrol(kind, x, y, dir) {
    const k = KIND[kind], ob = this.newObj(x, y, `s_${PFX[k]}path1`);
    ob.speed = k === "dog" ? SPDDOG : SPDPATROL; this.killtotal++;
    ob.cls = k; ob.dir = dir * 2; ob.hitpoints = HP[this.difficulty][kind]; ob.distance = TILEGLOBAL; ob.flags |= FL.SHOOTABLE; ob.active = true;
    this.grid[y * this.w.w + x] = null;                              // don't use the original spot
    ob.tilex += DX[ob.dir]; ob.tiley += DY[ob.dir]; this.grid[ob.tiley * this.w.w + ob.tilex] = ob;
  }
  // ---- state machine ----
  newState(ob, name) { ob.state = name; ob.ticcount = STATES[name][2]; }
  think(name, ob) {
    switch (name) {
      case "T_Stand": return this.sightPlayer(ob);
      case "T_Path": return this.tPath(ob);
      case "T_Chase": return this.tChase(ob);
      case "T_DogChase": return this.tDogChase(ob);
      case "T_Shoot": return this.tShoot(ob);
      case "T_Bite": return this.tBite(ob);
      case "T_BJRun": return this.tBJRun(ob);
      case "A_DeathScream": return this.deathScream(ob);
      case "T_Schabb": return this.tBossRun(ob, "s_schabbshoot1");
      case "T_Gift": return this.tBossRun(ob, "s_giftshoot1");
      case "T_Fat": return this.tBossRun(ob, "s_fatshoot1");
      case "T_Fake": return this.tFake(ob);
      case "T_SchabbThrow": this.throwAt(ob, "s_needle1", "needle", 0x2000, FL.NONMARK, "SCHABBSTHROWSND"); return;
      case "T_GiftThrow": this.throwAt(ob, "s_rocket", "rocket", 0x2000, FL.NONMARK, "MISSILEFIRESND"); return;
      case "T_FakeFire": this.throwAt(ob, "s_fire1", "fire", 0x1200, FL.NEVERMARK, "FLAMETHROWERSND"); return;
      case "T_Projectile": return this.tProjectile(ob);
      case "A_Smoke": return this.aSmoke(ob);
      case "A_HitlerMorph": return this.aHitlerMorph(ob);
      case "A_MechaSound": if (this.w.areabyplayer[ob.area]) this.w.sound("MECHSTEPSND", ob.x, ob.y); return;
      case "A_Slurpie": this.w.sound("SLURPIESND"); return;
      case "A_StartDeathCam": return this.aStartDeathCam(ob);
      case "T_BJJump": return this.moveObj(ob, 680 * this.tics);
      case "T_BJDone": this.w.playstate = "victorious"; return;
      default: return;                                               // A_DeathScream: sound only
    }
  }
  at(ob) { return this.grid[ob.tiley * this.w.w + ob.tilex]; }
  setAt(ob, v) { this.grid[ob.tiley * this.w.w + ob.tilex] = v; }
  // DoActor [source WL_PLAY.C]
  doActor(ob) {
    const tics = this.tics, w = this.w;
    if (!ob.active && !w.areabyplayer[ob.area]) return;
    if (!(ob.flags & (FL.NONMARK | FL.NEVERMARK))) this.setAt(ob, null);
    const finish = () => {
      if (ob.flags & FL.NEVERMARK) return;
      if ((ob.flags & FL.NONMARK) && this.at(ob)) return;
      this.setAt(ob, ob);
    };
    if (!ob.ticcount) {
      const th = STATES[ob.state][3]; if (th) { this.think(th, ob); if (!ob.state) { this.remove(ob); return; } }
      return finish();
    }
    ob.ticcount -= tics;
    while (ob.ticcount <= 0) {
      const ac = STATES[ob.state][4]; if (ac) { this.think(ac, ob); if (!ob.state) { this.remove(ob); return; } }
      ob.state = STATES[ob.state][5];
      if (!ob.state) { this.remove(ob); return; }
      if (!STATES[ob.state][2]) { ob.ticcount = 0; break; }
      ob.ticcount += STATES[ob.state][2];
    }
    const th = STATES[ob.state][3]; if (th) { this.think(th, ob); if (!ob.state) { this.remove(ob); return; } }
    finish();
  }
  remove(ob) { ob.removed = true;   /* RemoveObj only unlinks: actorat is not touched (DoActor already cleared it for marked actors) */  this.log.push(["r", ob]); }
  // ---- tile movement ----
  // actorat classification of a tile: 0 free, 1 wall (value < 128), a door number+128, or an actor object
  tileObj(x, y) {
    const w = this.w; if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 1;
    if (w.solid[y * w.w + x]) { const tv = w.tilemap[y * w.w + x]; return tv & 0x80 && !(tv & 0x4000) ? 0x80 | (tv & 0x3f) : 1; }
    return this.grid[y * w.w + x] || 0;
  }
  tryWalk(ob) {
    const dir = ob.dir; let doornum = -1, tx = ob.tilex, ty = ob.tiley;
    const checkdiag = (x, y) => { const t = this.tileObj(x, y); if (t) { if (typeof t === "number") return false; if (t.flags & FL.SHOOTABLE) return false; } return true; };
    const checkside = (x, y) => { const t = this.tileObj(x, y); if (t) { if (typeof t === "number") { if (t < 128) return false; doornum = t & 63; } else if (t.flags & FL.SHOOTABLE) return false; } return true; };
    if (ob.cls === "inert") { tx += DX[dir]; ty += DY[dir]; }
    else switch (dir) {
      case N: case E: case S: case W: if (!(ob.cls === "dog" ? checkdiag : checkside)(tx + DX[dir], ty + DY[dir])) return false; tx += DX[dir]; ty += DY[dir]; break;
      case NE: case SE: case SW: case NW:
        if (!checkdiag(tx + DX[dir], ty + DY[dir]) || !checkdiag(tx + DX[dir], ty) || !checkdiag(tx, ty + DY[dir])) return false;
        tx += DX[dir]; ty += DY[dir]; break;
      default: return false;
    }
    ob.tilex = tx; ob.tiley = ty;
    if (doornum !== -1) { this.w.openDoor(doornum); ob.distance = -doornum - 1; return true; }
    ob.area = this.w.areaAt(tx, ty); ob.distance = TILEGLOBAL; return true;
  }
  selectDodgeDir(ob) {
    let turnaround;
    if (ob.flags & FL.FIRSTATTACK) { turnaround = NODIR; ob.flags &= ~FL.FIRSTATTACK; } else turnaround = OPP[ob.dir];
    const p = this.w.pl, dx = (p.x >> 16) - ob.tilex, dy = (p.y >> 16) - ob.tiley, d = [0, 0, 0, 0, 0];
    if (dx > 0) { d[1] = E; d[3] = W; } else { d[1] = W; d[3] = E; }
    if (dy > 0) { d[2] = S; d[4] = N; } else { d[2] = N; d[4] = S; }
    const sw = () => { let t = d[1]; d[1] = d[2]; d[2] = t; t = d[3]; d[3] = d[4]; d[4] = t; };
    if (Math.abs(dx) > Math.abs(dy)) sw();
    if (this.rnd() < 128) sw();
    d[0] = DIAG[d[1]][d[2]];
    for (let i = 0; i < 5; i++) { if (d[i] === NODIR || d[i] === turnaround) continue; ob.dir = d[i]; if (this.tryWalk(ob)) return; }
    if (turnaround !== NODIR) { ob.dir = turnaround; if (this.tryWalk(ob)) return; }
    ob.dir = NODIR;
  }
  selectChaseDir(ob) {
    const olddir = ob.dir, turnaround = OPP[olddir], p = this.w.pl, dx = (p.x >> 16) - ob.tilex, dy = (p.y >> 16) - ob.tiley, d = [0, NODIR, NODIR];
    if (dx > 0) d[1] = E; else if (dx < 0) d[1] = W;
    if (dy > 0) d[2] = S; else if (dy < 0) d[2] = N;
    if (Math.abs(dy) > Math.abs(dx)) { const t = d[1]; d[1] = d[2]; d[2] = t; }
    if (d[1] === turnaround) d[1] = NODIR; if (d[2] === turnaround) d[2] = NODIR;
    if (d[1] !== NODIR) { ob.dir = d[1]; if (this.tryWalk(ob)) return; }
    if (d[2] !== NODIR) { ob.dir = d[2]; if (this.tryWalk(ob)) return; }
    if (olddir !== NODIR) { ob.dir = olddir; if (this.tryWalk(ob)) return; }
    if (this.rnd() > 128) { for (let t = N; t <= W; t++) if (t !== turnaround) { ob.dir = t; if (this.tryWalk(ob)) return; } }
    else for (let t = W; t >= N; t--) if (t !== turnaround) { ob.dir = t; if (this.tryWalk(ob)) return; }
    if (turnaround !== NODIR) { ob.dir = turnaround; if (this.tryWalk(ob)) return; }
    ob.dir = NODIR;
  }
  moveObj(ob, move) {
    const p = this.w.pl, dir = ob.dir; if (dir === NODIR) return;
    ob.x += DX[dir] * move; ob.y += DY[dir] * move;
    if (this.w.areabyplayer[ob.area]) {                              // not on top of the player
      const dx = ob.x - p.x, dy = ob.y - p.y;
      if (!(dx < -MINACTORDIST || dx > MINACTORDIST) && !(dy < -MINACTORDIST || dy > MINACTORDIST)) { ob.x -= DX[dir] * move; ob.y -= DY[dir] * move; return; }
    }
    ob.distance -= move;
  }
  // ---- sight ----
  // CheckLine: literal port (1/256 tile precision, tilemap values 128..256 are doors)
  checkLine(ob) {
    const w = this.w, p = w.pl, tm = (x, y) => w.tilemap[y * w.w + x];
    const x1 = ob.x >> 8, y1 = ob.y >> 8, xt1 = x1 >> 8, yt1 = y1 >> 8, x2 = p.x >> 8, y2 = p.y >> 8; let xt2 = p.x >> 16, yt2 = p.y >> 16;
    const xdist = Math.abs(xt2 - xt1);
    if (xdist > 0) {
      let partial, xstep; if (xt2 > xt1) { partial = 256 - (x1 & 0xff); xstep = 1; } else { partial = x1 & 0xff; xstep = -1; }
      const deltafrac = Math.abs(x2 - x1), delta = y2 - y1;
      const lt = Math.trunc((delta * 256) / deltafrac), ystep = lt > 0x7fff ? 0x7fff : lt < -0x7fff ? -0x7fff : lt;
      let yfrac = y1 + ((ystep * partial) >> 8), x = xt1 + xstep; xt2 += xstep;
      do {
        const y = yfrac >> 8; yfrac += ystep; const v = tm(x, y); x += xstep; if (!v) continue;
        if (v < 128 || v > 256) return false;
        const intercept = (yfrac - Math.trunc(ystep / 2)) & 0xffff; if (intercept > w.doors[v & 0x7f].pos) return false;
      } while (x !== xt2);
    }
    const ydist = Math.abs(yt2 - yt1);
    if (ydist > 0) {
      let partial, ystep; if (yt2 > yt1) { partial = 256 - (y1 & 0xff); ystep = 1; } else { partial = y1 & 0xff; ystep = -1; }
      const deltafrac = Math.abs(y2 - y1), delta = x2 - x1;
      const lt = Math.trunc((delta * 256) / deltafrac), xstep = lt > 0x7fff ? 0x7fff : lt < -0x7fff ? -0x7fff : lt;
      let xfrac = x1 + ((xstep * partial) >> 8), y = yt1 + ystep; yt2 += ystep;
      do {
        const x = xfrac >> 8; xfrac += xstep; const v = tm(x, y); y += ystep; if (!v) continue;
        if (v < 128 || v > 256) return false;
        const intercept = (xfrac - Math.trunc(xstep / 2)) & 0xffff; if (intercept > w.doors[v & 0x7f].pos) return false;
      } while (y !== yt2);
    }
    return true;
  }
  checkSight(ob) {
    const p = this.w.pl; if (!this.w.areabyplayer[ob.area]) return false;
    const dx = p.x - ob.x, dy = p.y - ob.y, MS = 0x18000;
    if (dx > -MS && dx < MS && dy > -MS && dy < MS) return true;
    switch (ob.dir) { case N: if (dy > 0) return false; break; case E: if (dx < 0) return false; break; case S: if (dy < 0) return false; break; case W: if (dx > 0) return false; break; }
    return this.checkLine(ob);
  }
  firstSighting(ob) {
    this.newState(ob, `s_${PFX[ob.cls]}chase1`); ob.speed *= SPEEDUP[ob.cls];
    const at = n => this.w.sound(n, ob.x, ob.y), sight = { guard: "HALTSND", officer: "SPIONSND", ss: "SCHUTZADSND", dog: "DOGBARKSND" }[ob.cls];
    if (sight) at(sight); else if (SIGHT[ob.cls]) this.w.sound(SIGHT[ob.cls]);
    if (ob.distance < 0) ob.distance = 0;                            // ignore the door opening command
    ob.flags |= FL.ATTACKMODE | FL.FIRSTATTACK;
  }
  sightPlayer(ob) {
    if (ob.temp2) { ob.temp2 -= this.tics; if (ob.temp2 > 0) return false; ob.temp2 = 0; }
    else {
      if (!this.w.areabyplayer[ob.area]) return false;
      if (ob.flags & FL.AMBUSH) { if (!this.checkSight(ob)) return false; ob.flags &= ~FL.AMBUSH; }
      else if (!this.madenoise && !this.checkSight(ob)) return false;
      ob.temp2 = ISBOSS.has(ob.cls) ? 1 : ob.cls === "guard" ? 1 + (this.rnd() >> 2) : ob.cls === "officer" ? 2 : ob.cls === "dog" ? 1 + (this.rnd() >> 3) : 1 + Math.trunc(this.rnd() / 6);   // reaction delay
      return false;
    }
    this.firstSighting(ob); return true;
  }
  // ---- think functions ----
  advance(ob, selectDir, dodge, onOpen) {   // shared movement loop of T_Chase / T_Path
    let move = ob.speed * this.tics;
    while (move) {
      if (ob.distance < 0) {
        const n = -ob.distance - 1; this.w.openDoor(n); if (this.w.doors[n].action !== 2) return;
        ob.distance = TILEGLOBAL;
      }
      if (move < ob.distance) { this.moveObj(ob, move); break; }
      ob.x = ob.tilex * TILEGLOBAL + TILEGLOBAL / 2; ob.y = ob.tiley * TILEGLOBAL + TILEGLOBAL / 2; move -= ob.distance;
      selectDir(ob); if (ob.dir === NODIR) return;
    }
  }
  tChase(ob) {
    if (this.w.victory) return;
    let dodge = false; const p = this.w.pl;
    if (this.checkLine(ob)) {
      const dx = Math.abs(ob.tilex - (p.x >> 16)), dy = Math.abs(ob.tiley - (p.y >> 16)), dist = dx > dy ? dx : dy;
      const chance = !dist || (dist === 1 && ob.distance < 0x4000) ? 300 : Math.trunc((this.tics << 4) / dist);
      if (this.rnd() < chance) { this.newState(ob, `s_${PFX[ob.cls]}shoot1`); return; }
      dodge = true;
    }
    const sel = dodge ? o => this.selectDodgeDir(o) : o => this.selectChaseDir(o);
    if (ob.dir === NODIR) { sel(ob); if (ob.dir === NODIR) return; }
    this.advance(ob, sel);
  }
  // SelectRunDir: away from the player (Schabbs, Gift and Fat run when closer than 4 tiles)
  selectRunDir(ob) {
    const p = this.w.pl, dx = (p.x >> 16) - ob.tilex, dy = (p.y >> 16) - ob.tiley, d = [0, dx < 0 ? E : W, dy < 0 ? S : N];
    if (Math.abs(dy) > Math.abs(dx)) { const t = d[1]; d[1] = d[2]; d[2] = t; }
    ob.dir = d[1]; if (this.tryWalk(ob)) return; ob.dir = d[2]; if (this.tryWalk(ob)) return;
    if (this.rnd() > 128) { for (let t = N; t <= W; t++) { ob.dir = t; if (this.tryWalk(ob)) return; } } else for (let t = W; t >= N; t--) { ob.dir = t; if (this.tryWalk(ob)) return; }
    ob.dir = NODIR;
  }
  // T_Schabb / T_Gift / T_Fat: like T_Chase with a 1/32 per tic shot chance (tics << 3 of 256) and running away at close range
  tBossRun(ob, shoot) {
    const p = this.w.pl; let dodge = false; const dx = Math.abs(ob.tilex - (p.x >> 16)), dy = Math.abs(ob.tiley - (p.y >> 16)), dist = dx > dy ? dx : dy;
    if (this.checkLine(ob)) { if (this.rnd() < (this.tics << 3)) { this.newState(ob, shoot); return; } dodge = true; }
    if (ob.dir === NODIR) { dodge ? this.selectDodgeDir(ob) : this.selectChaseDir(ob); if (ob.dir === NODIR) return; }
    this.advance(ob, o => dist < 4 ? this.selectRunDir(o) : dodge ? this.selectDodgeDir(o) : this.selectChaseDir(o));
  }
  // T_Fake: always dodges, never opens doors, shoots flames in bursts
  tFake(ob) {
    if (this.checkLine(ob) && this.rnd() < (this.tics << 1)) { this.newState(ob, "s_fakeshoot1"); return; }
    if (ob.dir === NODIR) { this.selectDodgeDir(ob); if (ob.dir === NODIR) return; }
    let move = ob.speed * this.tics;
    while (move) {
      if (move < ob.distance) { this.moveObj(ob, move); break; }
      ob.x = ob.tilex * TILEGLOBAL + TILEGLOBAL / 2; ob.y = ob.tiley * TILEGLOBAL + TILEGLOBAL / 2; move -= ob.distance;
      this.selectDodgeDir(ob); if (ob.dir === NODIR) return;
    }
  }
  tDogChase(ob) {
    const p = this.w.pl;
    if (ob.dir === NODIR) { this.selectDodgeDir(ob); if (ob.dir === NODIR) return; }
    let move = ob.speed * this.tics;
    while (move) {
      let dx = Math.abs(p.x - ob.x) - move;
      if (dx <= MINACTORDIST) { const dy = Math.abs(p.y - ob.y) - move; if (dy <= MINACTORDIST) { this.newState(ob, "s_dogjump1"); return; } }
      if (move < ob.distance) { this.moveObj(ob, move); break; }
      ob.x = ob.tilex * TILEGLOBAL + TILEGLOBAL / 2; ob.y = ob.tiley * TILEGLOBAL + TILEGLOBAL / 2; move -= ob.distance;
      this.selectDodgeDir(ob); if (ob.dir === NODIR) return;
    }
  }
  selectPathDir(ob) {
    const spot = this.w.lvl.things[ob.tiley * this.w.w + ob.tilex] - ICONARROWS;
    if (spot >= 0 && spot < 8) ob.dir = spot;
    ob.distance = TILEGLOBAL; if (!this.tryWalk(ob)) ob.dir = NODIR;
  }
  tPath(ob) {
    if (this.sightPlayer(ob)) return;
    if (ob.dir === NODIR) { this.selectPathDir(ob); if (ob.dir === NODIR) return; }
    this.advance(ob, o => this.selectPathDir(o));
  }
  tShoot(ob) {
    const w = this.w, p = w.pl; if (!w.areabyplayer[ob.area] || !this.checkLine(ob)) return;
    const dx = Math.abs(ob.tilex - (p.x >> 16)), dy = Math.abs(ob.tiley - (p.y >> 16)); let dist = dx > dy ? dx : dy;
    if (ob.cls === "ss" || ob.cls === "boss") dist = Math.trunc(dist * 2 / 3);
    const running = w.thrustspeed >= RUNSPEED, vis = ob.flags & FL.VISABLE;
    const hit = running ? (vis ? 160 - dist * 16 : 160 - dist * 8) : (vis ? 256 - dist * 16 : 256 - dist * 8);
    this.w.sound({ ss: "SSFIRESND", boss: "BOSSFIRESND", mecha: "BOSSFIRESND", hitler: "BOSSFIRESND", gift: "MISSILEFIRESND", fat: "MISSILEFIRESND", schabb: "SCHABBSTHROWSND", fake: "FLAMETHROWERSND" }[ob.cls] || "NAZIFIRESND", ob.x, ob.y);
    if (this.rnd() < hit) { const dmg = dist < 2 ? this.rnd() >> 2 : dist < 4 ? this.rnd() >> 3 : this.rnd() >> 4; w.takeDamage(dmg, ob); }
  }
  // A_DeathScream: the sound choice consumes random numbers like the original (guards: US_RndT()%8; on the secret floor a 1 in 256 chance of the fart scream)
  deathScream(ob) {
    const at = n => this.w.sound(n, ob.x, ob.y), cls = ob.cls;
    if (this.w.mapon === 9 && !this.rnd() && ["mutant", "guard", "officer", "ss", "dog"].includes(cls)) return at("DEATHSCREAM6SND");
    if (cls === "mutant") at("AHHHGSND");
    else if (cls === "guard") at(["DEATHSCREAM1SND", "DEATHSCREAM2SND", "DEATHSCREAM3SND", "DEATHSCREAM4SND", "DEATHSCREAM5SND", "DEATHSCREAM7SND", "DEATHSCREAM8SND", "DEATHSCREAM9SND"][this.rnd() % 8]);
    else if (cls === "officer") at("NEINSOVASSND"); else if (cls === "ss") at("LEBENSND"); else if (cls === "dog") at("DOGDEATHSND"); else if (DEATHSND[cls]) this.w.sound(DEATHSND[cls]);
  }
  tBJRun(ob) {
    let move = 2048 * this.tics;
    while (move) {
      if (move < ob.distance) { this.moveObj(ob, move); break; }
      ob.x = ob.tilex * TILEGLOBAL + TILEGLOBAL / 2; ob.y = ob.tiley * TILEGLOBAL + TILEGLOBAL / 2; move -= ob.distance;
      this.selectPathDir(ob);
      if (!--ob.temp1) { this.newState(ob, "s_bjjump1"); return; }
    }
  }
  tBite(ob) {
    this.w.sound("DOGATTACKSND", ob.x, ob.y);
    const p = this.w.pl; let dx = Math.abs(p.x - ob.x) - TILEGLOBAL;
    if (dx <= MINACTORDIST) { const dy = Math.abs(p.y - ob.y) - TILEGLOBAL; if (dy <= MINACTORDIST && this.rnd() < 180) this.w.takeDamage(this.rnd() >> 4, ob); }
  }
  // ---- damage ----
  killActor(ob) {
    const w = this.w; ob.tilex = ob.x >> 16; ob.tiley = ob.y >> 16;
    w.givePoints(POINTS[ob.cls]); this.newState(ob, `s_${PFX[ob.cls]}die1`);
    if (["gift", "fat", "schabb", "hitler"].includes(ob.cls)) { w.killx = w.pl.x; w.killy = w.pl.y; if (ob.cls === "schabb" || ob.cls === "hitler") this.deathScream(ob); }   // the death cam replays the kill from here
    if (ob.cls === "boss" || ob.cls === "gretel") w.placeItem("key1", ob.tilex, ob.tiley);
    else if (ob.cls === "ss") w.placeItem(w.gs.bestweapon < 2 ? "machinegun" : "clip2", ob.tilex, ob.tiley);
    else if (ob.cls !== "dog") w.placeItem("clip2", ob.tilex, ob.tiley);
    this.kills++; ob.flags &= ~FL.SHOOTABLE; this.setAt(ob, null); ob.flags |= FL.NONMARK;
  }
  damageActor(ob, damage) {
    this.madenoise = true;
    if (!(ob.flags & FL.ATTACKMODE)) damage <<= 1;
    ob.hitpoints -= damage;
    if (ob.hitpoints <= 0) this.killActor(ob);
    else {
      if (!(ob.flags & FL.ATTACKMODE)) this.firstSighting(ob);
      const pain = `s_${PFX[ob.cls]}${ob.hitpoints & 1 ? "pain" : "pain1"}`; if (STATES[pain]) this.newState(ob, pain);   // dogs and Hans have no pain state
    }
  }
  // actors in spawn order, like objlist (the player is thought by the caller first)
  tick(tics) { this.tics = tics; this.madenoise = false; }
  thinkAll() { for (const ob of this.list.slice()) if (!ob.removed) this.doActor(ob); }
}
