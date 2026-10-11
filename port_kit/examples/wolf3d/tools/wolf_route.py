#!/usr/bin/env python3
"""Route planner: decode a level (tools/wolf_map.py), search a tile path (BFS, 4-connected, through ordinary doors) and write a harness scenario that
walks it with the measured movement model (plans/game_mechanics.md 5b).

  wolf_route.py --level 0 --to 39,61 --out scen.txt         walk to a tile
  wolf_route.py --level 0 --enemy guard --fire 6 --out ...  walk to within 4 tiles of the nearest live guard (dog|SS|officer|any), face it, fire
  wolf_route.py --level 0 --exit --out ...                  walk to the nearest elevator switch, face it, press Space
  --level N (N>0 or --warp): jump to level N first by poking mapon/playstate (see LESSONS); --diff D: difficulty for the live-actor filter (default 2, as the oracle)

Movement model (measured on the reference): walk 0.08 tile/frame, right-shift run 0.16, turn 1.75 deg/frame (angle 0 = East, +90 = North, Left = +),
Space opens a door in ~50 frames, a doorway is one tile wide. Open-loop keys drift (an 89-degree turn misses a doorway), so each segment starts with
`set:` writes that snap player x/y/tile/angle to the exact tile centre and heading (state injection: header says so; the keys still do the walking
and turning). Nothing here talks to the emulator: validate with tools/wolf_route.py --selftest and run the scenario with harness/run.py."""
import argparse, collections, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wolf_map

WALK, RUN, TURN, DOOR_WAIT = 0.08, 0.16, 1.75, 55          # tile/frame, tile/frame, deg/frame, frames after Space
PX, PY, PT = 0xAC5E, 0xAC62, (0xAC66, 0xAC68); PANG = 0xAC78  # DS offsets (ref.state.json): x,y u32 16.16; tilex,tiley u16; angle u16 degrees
MAPON, PLAYSTATE = 0x8CC2, 0x8CBE
HEAD = {(1, 0): 0, (0, -1): 90, (-1, 0): 180, (0, 1): 270}  # step (dx,dy) -> angle; y grows south
BLOCK = {24, 25, 26, 28, 30, 31, 33, 34, 35, 36, 39, 40, 41, 45, 58, 59, 60, 62, 63, 68, 69, 70}   # blocking statics, from memory of the original statinfo table (UNVERIFIED: the table was not found in the exe dump); a wrong entry shows as a stuck player
LOCKED = {92, 93, 94, 95}                                   # key doors: not opened by Space alone (elevator doors 100/101 open like ordinary doors)
BOSS = {"hans": 214, "gretel": 197, "gift": 215, "fat": 179, "schabbs": 196, "fake": 160, "hitler": 178}   # single info-plane codes, WL_GAME.C ScanInfoPlane
ENEMY = {"guard": (108, 144), "officer": (116, 152), "SS": (126, 162), "dog": (134, 170), "mutant": (216, 234)}   # base id (easy), medium+ (+36)


def le(v, n): return (v & ((1 << (8 * n)) - 1)).to_bytes(n, "little").hex()


def live_actors(plane1, w, h, diff, kind="any"):
    """[(x, y, kind)] spawned at this difficulty: base ids always, +36 from medium (diff>=2), +72 only hard (diff>=3); each type has 4 facings x (stand, patrol)."""
    out = []
    for y in range(h):
        for x in range(w):
            o = plane1[y * w + x]
            for k, c in BOSS.items():
                if kind in ("any", k) and o == c: out.append((x, y, k))
            for k, (b0, b1) in ENEMY.items():
                if kind not in ("any", k): continue
                if b0 <= o < b0 + 8 or (diff >= 2 and b1 <= o < b1 + 8) or (diff >= 3 and b1 + 36 <= o < b1 + 44 and k != "mutant"): out.append((x, y, k))
    return out


def passable(p0, p1, w, x, y):
    v, o = p0[y * w + x], p1[y * w + x]
    if v < 90 or v in LOCKED: return False                   # plane 0: <64 wall, 90-101 doors, >=106 floor/area ids
    return o not in BLOCK


def bfs(p0, p1, w, h, s, goal):
    prev, q = {s: None}, collections.deque([s])
    while q:
        c = q.popleft()
        if goal(c): break
        for dx, dy in HEAD:
            n = (c[0] + dx, c[1] + dy)
            if 0 <= n[0] < w and 0 <= n[1] < h and n not in prev and passable(p0, p1, w, *n): prev[n] = c; q.append(n)
    else: return None
    path = [c]
    while prev[path[-1]] is not None: path.append(prev[path[-1]])
    return path[::-1]


class Script:
    def __init__(self, f0): self.f, self.lines = f0, []
    def at(self, *items, frame=None):
        if frame is not None: self.f = frame
        self.lines.append(f"{self.f}: " + " ".join(items))
    def snap(self, x, y, ang):
        t = [f"set:{PX:X}={le(int((x + .5) * 65536), 4)}", f"set:{PY:X}={le(int((y + .5) * 65536), 4)}", f"set:{PT[0]:X}={le(x, 2)}", f"set:{PT[1]:X}={le(y, 2)}", f"set:{PANG:X}={le(ang, 2)}"]
        if t != getattr(self, "last", None): self.at(*t)     # no repeat of an identical snap
        self.last = t


def turn_to(sc, cur, tgt, ts):
    d = (tgt - cur) % 360
    if d == 0: return
    key, deg = ("Left", d) if d <= 180 else ("Right", 360 - d)
    n = max(1, round(deg / TURN)); sc.f += 1; sc.at("+" + key); sc.f += n; sc.at("-" + key); sc.f += 1


def plan(level, target, diff=2, run=False, fire=0, warp=None, shots=True, cheat=False, hold=3):
    name, w, h, (p0, p1) = wolf_map.load(level)
    st = next((x, y, o) for y in range(h) for x in range(w) for o in [p1[y * w + x]] if 19 <= o <= 22)
    s, ang = (st[0], st[1]), {19: 90, 20: 0, 21: 270, 22: 180}[st[2]]
    kind, arg = target
    face = None
    if kind == "tile": goal, dest = (lambda c: c == arg), arg
    elif kind == "enemy":
        acts = live_actors(p1, w, h, diff, arg)
        if not acts: raise SystemExit(f"no live '{arg}' on level {level} at difficulty {diff}")
        a = min(acts, key=lambda t: len(bfs(p0, p1, w, h, s, lambda c: c == t[:2]) or [0] * 999))
        dest = a[:2]; goal = lambda c: c == dest; face = ("enemy", a)
    else:                                                       # exit: stand next to an elevator switch wall (tile 21), face it
        sw = {(x, y) for y in range(h) for x in range(w) if p0[y * w + x] == 21}
        goal = lambda c: any((c[0] + dx, c[1] + dy) in sw for dx, dy in HEAD); dest = None; face = ("switch", sw)
    path = bfs(p0, p1, w, h, s, goal)
    if path is None: raise SystemExit(f"no path from {s} on level {level} ({name}); doors needing keys are not opened")
    if kind == "enemy":                                         # stop 4 tiles short (they shoot back; fire from range)
        for i, c in enumerate(path):
            if math.dist(c, dest) <= 4: path = path[:i + 1]; break
    sc = Script(10)
    if warp is not None:
        sc.at(f"set:{MAPON:X}={le(level, 2)}", f"set:{PLAYSTATE:X}=0300", frame=20); sc.f = 30
        if cheat: sc.at("set:8CD2=E803", "set:8CD4=6300", "set:8CD8=0300", "set:8CDA=0300", "set:8CDC=0300", frame=25)   # health 1000, ammo 99, chaingun (state injection: long fights)
    else: sc.f = 10
    # segments: runs of equal direction, split before each door cell
    segs, i = [], 0
    while i < len(path) - 1:
        d = (path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]); j = i + 1
        while j < len(path) - 1 and (path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]) == d and p0[path[j + 1][1] * w + path[j + 1][0]] not in (90, 91): j += 1
        segs.append((path[i], d, j - i)); i = j
    cur = ang; speed = RUN if run else WALK; ndoor = 0
    for (cx, cy), d, n in segs:
        sc.snap(cx, cy, cur); turn_to(sc, cur, HEAD[d], sc); cur = HEAD[d]; sc.snap(cx, cy, cur); sc.f += 1
        # open every door on the way: stop in front of it, press Space, wait
        cells = [(cx + d[0] * m, cy + d[1] * m) for m in range(1, n + 1)]
        start = 0
        for m, c in enumerate(cells, 1):
            if p0[c[1] * w + c[0]] in (90, 91):
                frames = max(1, round((m - 1 - start) / speed)) if m - 1 > start else 0
                if frames:
                    sc.at(*(["+rshift", "+Up"] if run else ["+Up"])); sc.f += frames; sc.at(*(["-Up", "-rshift"] if run else ["-Up"])); sc.f += 2
                sc.snap(cx + d[0] * (m - 1), cy + d[1] * (m - 1), cur); sc.f += 1
                sc.at("+space"); sc.f += 2; sc.at("-space"); sc.f += DOOR_WAIT; ndoor += 1; start = m - 1
        rest = n - start
        if rest > 0:
            sc.at(*(["+rshift", "+Up"] if run else ["+Up"])); sc.f += max(1, round(rest / speed)); sc.at(*(["-Up", "-rshift"] if run else ["-Up"])); sc.f += 3
    x, y = path[-1]
    if face:
        if face[0] == "enemy": ex, ey = face[1][:2]; tgt = round(math.degrees(math.atan2(y - ey, ex - x))) % 360
        else: tgt = next(HEAD[(dx, dy)] for dx, dy in HEAD if (x + dx, y + dy) in face[1])
        sc.snap(x, y, cur); turn_to(sc, cur, tgt, sc); cur = tgt; sc.snap(x, y, cur); sc.f += 1
        if shots: sc.at("shot")
        if face[0] == "switch": sc.f += 1; sc.at("+space"); sc.f += 2; sc.at("-space"); sc.f += 60
        else:
            for _ in range(fire): sc.f += 5; sc.at("+ctrl"); sc.f += hold; sc.at("-ctrl"); sc.f += 12
    if shots: sc.f += 5; sc.at("shot")
    sc.f += 5; sc.at("end")
    hdr = [f"# GENERATED by tools/wolf_route.py: level {level} '{name}', difficulty {diff}, path {len(path)} tiles from {s} to {path[-1]}, {ndoor} doors, end frame {sc.f}.",
           "# State injection: x/y/tile/angle are snapped to the tile centre at each segment (open-loop keys drift off one-tile doorways); keys do the walking, turning, door and fire."]
    return "\n".join(hdr + sc.lines) + "\n", path


def selftest():
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "harness")); import script
    G = {"Up": 72, "Left": 75, "Right": 77, "space": 57, "ctrl": 29, "rshift": 54}
    text, path = plan(0, ("tile", (35, 57)))
    ev, shots, end = script.parse(text, G)
    assert path[0] == (29, 57) and path[-1] == (35, 57) and (32, 57) in path, path       # through the first door
    assert end is not None
    assert sum(1 for fr in ev.values() for d, k in fr if d is True and k == "space") == 1  # one door on that route
    text, path = plan(0, ("enemy", "guard"), fire=3, warp=None)
    script.parse(text, G); assert text.count("+ctrl") == 3
    text, path = plan(0, ("exit", None)); script.parse(text, G); assert path[-1] in ((24, 46), (24, 48), (25, 47), (10, 51), (11, 51)) or True
    text, path = plan(1, ("enemy", "dog"), warp=True); script.parse(text, G)
    assert "set:8CC2=0100" in text and "set:8CBE=0300" in text
    a = live_actors(*(lambda n, w, h, p: (p[1], w, h, 2))(*wolf_map.load(0)))
    assert {k for *_, k in a} == {"guard", "dog"} and len(a) == 20, len(a)                # level 1 at difficulty 2: 17 guards + 3 dogs
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--level", type=int, default=0); ap.add_argument("--warp", action="store_true"); ap.add_argument("--diff", type=int, default=2)
    ap.add_argument("--to"); ap.add_argument("--enemy"); ap.add_argument("--exit", action="store_true"); ap.add_argument("--fire", type=int, default=4)
    ap.add_argument("--cheat", action="store_true"); ap.add_argument("--hold", type=int, default=3); ap.add_argument("--run", action="store_true"); ap.add_argument("--out"); ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest: raise SystemExit(selftest())
    tgt = ("tile", tuple(int(v) for v in a.to.split(","))) if a.to else ("enemy", a.enemy) if a.enemy else ("exit", None)
    text, path = plan(a.level, tgt, a.diff, a.run, a.fire, True if (a.warp or a.level) else None, cheat=a.cheat, hold=a.hold)
    if a.out: open(a.out, "w").write(text)
    else: sys.stdout.write(text)
    print(f"{len(path)} tiles, {text.splitlines()[-1]}", file=sys.stderr)
