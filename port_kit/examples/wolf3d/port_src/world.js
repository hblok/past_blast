// Level state for W3: solid tiles, doors, pushable walls, elevator switch (id source WL_ACT1.C SpawnDoor/OpenDoor/CloseDoor/OperateDoor/DoorOpen/DoorOpening/DoorClosing/MoveDoors/PushWall/MovePWalls, WL_AGENT.C Cmd_Use).
// tilemap[y*w+x]: 0 empty, 1..89 wall, 0x80|n door n. solidAt() is Wolf's "actorat < objlist" test (walls and closed/moving doors; actors come with W5).
// statinfo[] of WL_ACT1.C (WL6): [kind] per plane-1 code 23..71; sprite = SPR_STAT_<index> (clip2 reuses 26). dressing = no effect, block = solid, else a pickup.
import { SNDINFO } from "./sound_data.js";
const K = "d,b,b,b,d,b,alpo,b,b,d,b,b,b,b,d,d,b,b,b,d,key1,key2,b,d,food,firstaid,clip,machinegun,chaingun,cross,chalice,bible,crown,fullheal,gibs,b,b,b,gibs,b,b,d,d,d,d,b,b,d,clip2".split(",");
export const EXTRAPOINTS = 40000, SPR_STAT_0 = 2;   // SPR_DEMO, SPR_DEATHCAM precede the static sprites in the enum [source WL_DEF.H]
export const OPENTICS = 300, DR = { closed: 0, opening: 1, open: 2, closing: 3 };
export class World {
  constructor(lvl, keys = 0) {
    this.w = lvl.w; this.h = lvl.h; this.lvl = lvl; this.keys = keys; this.tics = 0;
    this.tilemap = new Int16Array(lvl.w * lvl.h); this.solid = new Uint8Array(lvl.w * lvl.h);
    this.gs = { difficulty: 2, health: 100, ammo: 8, score: 0, lives: 3, nextextra: EXTRAPOINTS, bestweapon: 1, weapon: 1, treasure: 0 };   // start values [P1 probe: 100/3/8], weapon 1 = pistol
    this.secrettotal = 0; for (let i = 0; i < lvl.w * lvl.h; i++) if (lvl.things[i] === 98) this.secrettotal++; this.secrets = 0; this.treasuretotal = 0;
    this.statics = []; this.area = new Int16Array(lvl.w * lvl.h).fill(-1); this.areaconnect = new Uint8Array(37 * 37); this.areabyplayer = new Uint8Array(37);
    this.sounds = []; this.now = 0; this.alUntil = 0; this.alPrio = 0; this.alName = null; this.playstate = null; this.thrustspeed = 0; this.pl = { x: 0, y: 0, angle: 0 };
    this.doors = []; this.pw = { state: 0, pos: 0, x: 0, y: 0, dir: 0 }; this.exit = null;
    for (let i = 0; i < lvl.w * lvl.h; i++) {
      const t = lvl.walls[i];
      if (t > 0 && t < 90) { this.tilemap[i] = t; this.solid[i] = 1; }
      else if (t >= 90 && t <= 101) {   // door n: even = vertical door, lock (t-90)/2: 0 none, 1-4 keys, 5 elevator
        this.tilemap[i] = 0x80 | this.doors.length; this.solid[i] = 1;
        this.doors.push({ x: i % lvl.w, y: i / lvl.w | 0, vertical: !(t & 1), lock: (t - 90) >> 1, action: DR.closed, pos: 0, tic: 0 });
      }
    }
    for (let i = 0; i < lvl.w * lvl.h; i++) if (lvl.walls[i] >= 107) this.area[i] = lvl.walls[i] - 107;    // AREATILE: floor tiles carry their area number
    for (const d of this.doors) { const i = d.y * lvl.w + d.x; this.area[i] = this.area[d.vertical ? i - 1 : i - lvl.w]; }   // SpawnDoor: the door tile takes a neighbour's area
  }
  // statics from plane 1 (codes 23..71); called once after construction
  spawnStatics() {
    this.lvl.things.forEach((o, i) => {
      if (o < 23 || o - 23 >= K.length) return;
      const idx = o - 23, k = K[idx], x = i % this.w, y = i / this.w | 0;
      this.statics.push({ x, y, shape: SPR_STAT_0 + (idx === 48 ? 26 : idx), kind: k, bonus: k !== "d" && k !== "b" });
      if (k === "cross" || k === "chalice" || k === "bible" || k === "crown" || k === "fullheal") this.treasuretotal++;
      if (k === "b") this.solid[i] = 1;   // blocks the player like a wall tile
    });
    return this;
  }
  // event for the page's audio; x, y in 16.16 for positional sounds. Also SD_PlaySound's single voice in PC speaker mode (the mode of the harness' original: no sound card): a sound is
  // refused while a higher-priority one still plays; SD_SoundPlaying (used by UpdateFace for the chaingun pickup) reports it until its last 140 Hz tick
  sound(name, x, y) {
    this.sounds.push({ name, x, y }); const i = SNDINFO[name]; if (!i) return;
    if (this.alUntil > this.now && i[0] < this.alPrio) return;
    this.alName = name; this.alPrio = i[0]; this.alUntil = this.now + Math.ceil(i[1] / 2);
  }
  adlibPlaying() { return this.alUntil > this.now ? this.alName : null; }   // event for the page's audio; x, y in 16.16 for positional sounds
  doorSound(name, d) { this.sound(name, (d.x << 16) + 0x8000, (d.y << 16) + 0x8000); }
  heal(n) { this.gs.health = Math.min(100, this.gs.health + n); }
  giveAmmo(n) { this.gs.ammo = Math.min(99, this.gs.ammo + n); }
  givePoints(n) { const g = this.gs; g.score += n; while (g.score >= g.nextextra) { g.nextextra += EXTRAPOINTS; this.extraMan(); } }
  extraMan() { if (this.gs.lives < 9) this.gs.lives++; this.sound("BONUS1UPSND"); }
  // GetBonus [source WL_AGENT.C]: returns true when picked up (the object is removed)
  getBonus(st) {
    const g = this.gs;
    switch (st.kind) {
      case "firstaid": if (g.health === 100) return false; this.heal(25); break;
      case "key1": this.keys |= 1; break;
      case "key2": this.keys |= 2; break;
      case "cross": this.givePoints(100); g.treasure++; break;
      case "chalice": this.givePoints(500); g.treasure++; break;
      case "bible": this.givePoints(1000); g.treasure++; break;
      case "crown": this.givePoints(5000); g.treasure++; break;
      case "clip": if (g.ammo === 99) return false; this.giveAmmo(8); break;
      case "clip2": if (g.ammo === 99) return false; this.giveAmmo(4); break;
      case "machinegun": this.giveAmmo(6); if (g.bestweapon < 2) g.bestweapon = g.weapon = 2; break;
      case "chaingun": g.facecount = 0; this.giveAmmo(6); if (g.bestweapon < 3) g.bestweapon = g.weapon = 3; break;
      case "fullheal": this.heal(99); this.giveAmmo(25); this.extraMan(); g.treasure++; break;
      case "food": if (g.health === 100) return false; this.heal(10); break;
      case "alpo": if (g.health === 100) return false; this.heal(4); break;
      case "gibs": if (g.health > 10) return false; this.heal(1); break;
      default: return false;
    }
    const snd = { firstaid: "HEALTH2SND", key1: "GETKEYSND", key2: "GETKEYSND", cross: "BONUS1SND", chalice: "BONUS2SND", bible: "BONUS3SND", crown: "BONUS4SND", clip: "GETAMMOSND", clip2: "GETAMMOSND", machinegun: "GETMACHINESND", chaingun: "GETGATLINGSND", food: "HEALTH1SND", alpo: "HEALTH1SND", gibs: "SLURPIESND" }[st.kind];   // fullheal's sound comes from extraMan
    if (snd) this.sound(snd);
    st.shape = -1; return true;
  }
  // grab test of TransformTile [source WL_DRAW.C]: seen from the view point (0.34 tile behind the player), 0x5800 <= depth-0x2000 < 0x10000 and |lateral| < 0x8000
  pickups(pl, spots = null) {
    const a = pl.angle * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
    for (const st of this.statics) {
      if (st.shape < 0 || !st.bonus || (spots && !spots[st.y * this.w + st.x])) continue;
      const gx = (st.x * 65536 + 0x8000) - (pl.x - 0x5700 * c), gy = (st.y * 65536 + 0x8000) - (pl.y + 0x5700 * sn);
      const nx = gx * c - gy * sn - 0x2000, ny = gy * c + gx * sn;   // depth and lateral in the view frame (y grows down, angle counter-clockwise)
      if (nx >= 0x5800 && nx < 0x10000 && ny > -0x8000 && ny < 0x8000) this.getBonus(st);
    }
  }
  actorOn(x, y) { return this.actors ? this.actors.grid[y * this.w + x] : null; }   // set by Game
  areaAt(x, y) { return this.area[y * this.w + x]; }
  recursiveConnect(a) { for (let i = 0; i < 37; i++) if (this.areaconnect[a * 37 + i] && !this.areabyplayer[i]) { this.areabyplayer[i] = 1; this.recursiveConnect(i); } }
  connectAreas() { this.areabyplayer.fill(0); const a = this.areaAt(this.pl.x >> 16, this.pl.y >> 16); if (a < 0) return; this.areabyplayer[a] = 1; this.recursiveConnect(a); }
  doorAreas(d) { const i = d.y * this.w + d.x; return d.vertical ? [this.area[i + 1], this.area[i - 1]] : [this.area[i - this.w], this.area[i + this.w]]; }
  takeDamage(points, attacker) {
    if (this.victory || this.god) return;   // god: debug mode of the page
    const g = this.gs; if (g.difficulty === 0) points >>= 2;
    g.health -= points; this.lastAttacker = attacker; this.damageFlash = (this.damageFlash || 0) + points;
    if (g.health <= 0) { g.health = 0; this.playstate = "died"; }
  }
  placeItem(kind, x, y) { this.statics.push({ x, y, shape: SPR_STAT_0 + (kind === "clip2" ? 26 : kind === "key1" ? K.indexOf("key1") : 27), kind, bonus: true }); }   // PlaceItemType: clip2 reuses sprite 26, machine gun is 27
  at(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 1 : this.tilemap[y * this.w + x]; }
  solidAt(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h || this.solid[y * this.w + x] === 1; }
  setSolid(x, y, v) { this.solid[y * this.w + x] = v; }
  // player: {x, y, angle} in 16.16; one call per tic after the player moved, like PlayLoop: MoveDoors, MovePWalls
  tick(pl, tics = 1) { this.pl = pl; this.tics = tics; this.now += tics; if (this.victory) return; this.moveDoors(pl); this.movePWalls(); }
  moveDoors(pl) {
    this.doors.forEach((d, n) => {
      if (d.action === DR.open) { if ((d.tic += this.tics) >= OPENTICS) this.closeDoor(n, pl); }
      else if (d.action === DR.opening) {
        if (!d.pos) { const [a1, a2] = this.doorAreas(d); this.areaconnect[a1 * 37 + a2]++; this.areaconnect[a2 * 37 + a1]++; this.connectAreas(); this.doorSound("OPENDOORSND", d); }   // door just starting to open: connect the areas
        d.pos += this.tics << 10;
        if (d.pos >= 0xffff) { d.pos = 0xffff; d.tic = 0; d.action = DR.open; this.setSolid(d.x, d.y, 0); }
      } else if (d.action === DR.closing) {
        const ptx = pl.x >> 16, pty = pl.y >> 16;
        if (!this.solid[d.y * this.w + d.x] || this.actorOn(d.x, d.y) || (ptx === d.x && pty === d.y)) { this.openDoor(n); return; }   // something got inside the door
        d.pos -= this.tics << 10;
        if (d.pos <= 0) { d.pos = 0; d.action = DR.closed; const [a1, a2] = this.doorAreas(d); this.areaconnect[a1 * 37 + a2]--; this.areaconnect[a2 * 37 + a1]--; this.connectAreas(); }
      }
    });
  }
  openDoor(n) { const d = this.doors[n]; if (d.action === DR.open) d.tic = 0; else d.action = DR.opening; }
  closeDoor(n, pl) {
    const d = this.doors[n], ptx = pl.x >> 16, pty = pl.y >> 16, M = 0x5800;
    if (this.solid[d.y * this.w + d.x] || this.actorOn(d.x, d.y)) return;   // actorat set: something solid in the doorway
    if (ptx === d.x && pty === d.y) return;
    if (d.vertical) {
      if (pty === d.y && (((pl.x + M) >> 16) === d.x || ((pl.x - M) >> 16) === d.x)) return;
      let c = this.actorOn(d.x - 1, d.y); if (c && ((c.x + M) >> 16) === d.x) return;
      c = this.actorOn(d.x + 1, d.y); if (c && ((c.x - M) >> 16) === d.x) return;
    } else {
      if (ptx === d.x && (((pl.y + M) >> 16) === d.y || ((pl.y - M) >> 16) === d.y)) return;
      let c = this.actorOn(d.x, d.y - 1); if (c && ((c.y + M) >> 16) === d.y) return;
      c = this.actorOn(d.x, d.y + 1); if (c && ((c.y - M) >> 16) === d.y) return;
    }
    d.action = DR.closing; this.setSolid(d.x, d.y, 1); this.doorSound("CLOSEDOORSND", d);
  }
  operateDoor(n) {
    const d = this.doors[n];
    if (d.lock >= 1 && d.lock <= 4 && !(this.keys & (1 << (d.lock - 1)))) { this.sound("NOWAYSND"); return false; }   // locked
    if (d.action === DR.closed || d.action === DR.closing) this.openDoor(n); else this.closeDoor(n, this.pl);
    return true;
  }
  // Cmd_Use: the tile in front of the player (by quarter of the compass, 45 degree sectors)
  use(pl, held = false) {
    this.pl = pl;
    const tx = pl.x >> 16, ty = pl.y >> 16, a = pl.angle;
    let cx = tx, cy = ty, dir, elevOk;
    if (a < 45 || a > 315) { cx++; dir = 0; elevOk = true; } else if (a < 135) { cy--; dir = 1; elevOk = false; }
    else if (a < 225) { cx--; dir = 2; elevOk = true; } else { cy++; dir = 3; elevOk = false; }
    const t = this.at(cx, cy), i = cy * this.w + cx;
    if (this.lvl.things[i] === 98) return this.pushWall(cx, cy, dir);
    if (!held && t === 21 && elevOk) { this.tilemap[i]++; this.exit = this.lvl.walls[ty * this.w + tx] === 107 ? "secret" : "completed"; this.sound("LEVELDONESND"); return true; }  // ELEVATORTILE 21, ALTELEVATORTILE 107
    if (!held && t & 0x80) return this.operateDoor(t & 0x7f);
    if (!held) this.sound("DONOTHINGSND"); return false;
  }
  pushWall(cx, cy, dir) {
    const p = this.pw; if (p.state) return false;
    const i = cy * this.w + cx, old = this.tilemap[i]; if (!old) return false;
    const [dx, dy] = [[1, 0], [0, -1], [-1, 0], [0, 1]][dir], j = (cy + dy) * this.w + cx + dx;
    if (this.solid[j]) { this.sound("NOWAYSND"); return false; }
    this.solid[j] = 1; this.tilemap[j] = old;
    Object.assign(p, { x: cx, y: cy, dir, state: 1, pos: 0 }); this.tilemap[i] |= 0x4000;   // moving marker
    this.lvl.things[i] = 0; this.secrets = (this.secrets || 0) + 1; this.sound("PUSHWALLSND"); return true;
  }
  movePWalls() {
    const p = this.pw; if (!p.state) return;
    const oldBlock = p.state >> 7; p.state += this.tics;
    if (p.state >> 7 !== oldBlock) {
      const i = p.y * this.w + p.x, old = this.tilemap[i] & 63;
      this.tilemap[i] = 0; this.solid[i] = 0;
      if (p.state > 256) { p.state = 0; return; }
      const [dx, dy] = [[1, 0], [0, -1], [-1, 0], [0, 1]][p.dir];
      p.x += dx; p.y += dy;
      const j = (p.y + dy) * this.w + p.x + dx;
      if (this.solid[j]) { p.state = 0; return; }
      this.solid[j] = 1; this.tilemap[j] = old; this.tilemap[p.y * this.w + p.x] = old | 0x4000;
    }
    p.pos = (p.state >> 1) & 63;
  }
}
