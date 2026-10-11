#!/usr/bin/env python3
"""Decode a WL6 level from the data files (vendor/ref/MAPHEAD.WL6, GAMEMAPS.WL6) and print it as ASCII with the player start, doors and actors.
Usage: wolf_map.py [level 0-59]. Format (public, id Software): Carmack + RLEW compressed planes; plane0 = walls/doors, plane1 = things."""
import struct, sys, os
D = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vendor/ref")
def carmack(b, n):
    out = []; i = 0
    while len(out) < n // 2:
        lo, hi = b[i], b[i + 1]; i += 2
        if hi in (0xA7, 0xA8) and lo == 0:        # escaped literal
            out.append(b[i] | hi << 8); i += 1; continue
        if hi == 0xA7:                              # near copy
            for _ in range(lo): out.append(out[-b[i]]); 
            i += 1
        elif hi == 0xA8:                            # far copy
            o = b[i] | b[i + 1] << 8; i += 2
            for k in range(lo): out.append(out[o + k])
        else: out.append(lo | hi << 8)
    return out
def rlew(w, tag):
    out = []; i = 0
    while i < len(w):
        if w[i] == tag: out += [w[i + 2]] * w[i + 1]; i += 3
        else: out.append(w[i]); i += 1
    return out
def load(level):
    mh = open(f"{D}/MAPHEAD.WL6", "rb").read(); tag = struct.unpack_from("<H", mh)[0]
    off = struct.unpack_from("<i", mh, 2 + 4 * level)[0]; g = open(f"{D}/GAMEMAPS.WL6", "rb").read()
    ps = struct.unpack_from("<3i", g, off); pl = struct.unpack_from("<3H", g, off + 12); w, h = struct.unpack_from("<2H", g, off + 18)
    name = g[off + 22:off + 38].split(b"\0")[0].decode()
    planes = []
    for s, l in zip(ps[:2], pl[:2]):
        raw = g[s:s + l]; n = struct.unpack_from("<H", raw)[0]
        c = carmack(raw[2:], n); planes.append(rlew(c[1:], tag))
    return name, w, h, planes
if __name__ == "__main__":
    lv = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    name, w, h, (p0, p1) = load(lv); print(f"level {lv} '{name}' {w}x{h}   #=wall  |,-=door (vertical,horizontal)  G/S=gold/silver key door  E=elevator door  .=floor  a=guard d=dog s=SS o=officer x=dead guard (decoration) m=mutant  T=treasure +=health/ammo  @=player start  P=pushwall")
    for y in range(h):
        row = ""
        for x in range(w):
            t, o = p0[y * w + x], p1[y * w + x]
            c = "#" if t < 64 else "."
            if t in (90, 92, 94, 100): c = {90: "|", 92: "G", 94: "S", 100: "E"}[t]
            if t in (91, 93, 95, 101): c = {91: "-", 93: "G", 95: "S", 101: "E"}[t]
            if 19 <= o <= 22: c = "@"
            elif o == 98: c = "P"
            elif 108 <= o <= 115 or 180 <= o <= 187: c = "a"
            elif 134 <= o <= 141: c = "d"
            elif 126 <= o <= 133: c = "s"
            elif 116 <= o <= 123 or 188 <= o <= 195: c = "o"
            elif o == 124: c = "x"
            elif o in (52, 53, 54, 55, 56, 57): c = "T"
            elif o in (29, 43, 44, 47, 48): c = "+"
            row += c
        print(row)
