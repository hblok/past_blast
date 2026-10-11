#!/usr/bin/env python3
"""Mutation check of the port against the oracle recordings: apply one deliberate bug to port/src, run every oracle recording, report KILLED (some recording differs) or SURVIVED
(all still match = the recordings do not exercise that code). Restores the file afterwards. usage: port_mutants.py [name-filter]"""
import glob, os, shutil, subprocess, sys
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); P = f"{R}/port"
M = [  # (name, file, old, new)
 ("unaware double damage", "actors.js", "if (!(ob.flags & FL.ATTACKMODE)) damage <<= 1;", "if (!(ob.flags & FL.ATTACKMODE)) damage <<= 0;"),
 ("hit chance boundary", "actors.js", "if (this.rnd() < hit) {", "if (this.rnd() <= hit) {"),
 ("close range damage", "actors.js", "dist < 2 ? this.rnd() >> 2 : dist < 4 ? this.rnd() >> 3", "dist < 2 ? this.rnd() >> 3 : dist < 4 ? this.rnd() >> 3"),
 ("mid range damage", "actors.js", "dist < 4 ? this.rnd() >> 3 : this.rnd() >> 4", "dist < 4 ? this.rnd() >> 4 : this.rnd() >> 4"),
 ("dodge swap threshold", "actors.js", "if (this.rnd() < 128) sw();", "if (this.rnd() <= 128) sw();"),
 ("pain parity", "actors.js", 'ob.hitpoints & 1 ? "pain" : "pain1"', 'ob.hitpoints & 1 ? "pain1" : "pain"'),
 ("gun damage near", "game.js", "if (dist < 2) dmg = Math.trunc(this.rnd() / 4);", "if (dist < 2) dmg = Math.trunc(this.rnd() / 6);"),
 ("gun damage mid", "game.js", "else if (dist < 4) dmg = Math.trunc(this.rnd() / 6);", "else if (dist < 4) dmg = Math.trunc(this.rnd() / 4);"),
 ("gun hit chance far", "game.js", "if (Math.trunc(this.rnd() / 12) < dist) return;", "if (Math.trunc(this.rnd() / 12) <= dist) return;"),
 ("knife range", "game.js", "if (!best || dist > 0x18000) return;", "if (!best || dist > 0x10000) return;"),
 ("shoot chance of T_Chase", "actors.js", "Math.trunc((this.tics << 4) / dist)", "Math.trunc((this.tics << 3) / dist)"),
 ("boss shoot chance", "actors.js", "if (this.rnd() < (this.tics << 3)) { this.newState(ob, shoot);", "if (this.rnd() < (this.tics << 2)) { this.newState(ob, shoot);"),
 ("needle damage", "actors.js", "(this.rnd() >> 3) + 20", "(this.rnd() >> 3) + 21"),
 ("rocket speed", "actors.js", '"s_rocket", "rocket", 0x2000', '"s_rocket", "rocket", 0x2001'),
 ("SS accuracy", "actors.js", 'if (ob.cls === "ss" || ob.cls === "boss") dist = Math.trunc(dist * 2 / 3);', 'if (ob.cls === "boss") dist = Math.trunc(dist * 2 / 3);'),
 ("run speed hit chance", "actors.js", "const running = w.thrustspeed >= RUNSPEED", "const running = w.thrustspeed > RUNSPEED"),
 ("dog bite chance", "actors.js", "this.rnd() < 180) this.w.takeDamage(this.rnd() >> 4", "this.rnd() < 181) this.w.takeDamage(this.rnd() >> 4"),
 ("reaction delay guard", "actors.js", "1 + (this.rnd() >> 2) : ob.cls === \"officer\"", "1 + (this.rnd() >> 3) : ob.cls === \"officer\""),
]
oracles = sorted(glob.glob(f"{R}/port/ref/oracle_*_objs.jsonl.gz"))
def run():
    for f in oracles:
        n = os.path.basename(f)[:-len("_objs.jsonl.gz")]
        r = subprocess.run(["node", f"{P}/check_enemy_oracle.mjs", f, f"{R}/harness/games/wolf3d/scenarios/{n}.txt"], capture_output=True, text=True)
        if r.returncode: return n
    return None
flt = sys.argv[1] if len(sys.argv) > 1 else ""
assert run() is None, "baseline does not match"
for name, fn, old, new in M:
    if flt not in name: continue
    path = f"{P}/src/{fn}"; src = open(path).read()
    if old not in src: print(f"{name}: PATTERN NOT FOUND"); continue
    shutil.copy(path, "/tmp/_mut_backup"); open(path, "w").write(src.replace(old, new, 1))
    try: k = run()
    finally: shutil.copy("/tmp/_mut_backup", path)
    print(f"{name}: " + (f"KILLED by {k}" if k else "SURVIVED"), flush=True)
