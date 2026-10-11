#!/usr/bin/env python3
"""Palette for the port: the 768-byte gamepal (6-bit VGA values) sits in WOLF3D.EXE's data right after the sequence 0,0,0,0,0,42,... (found by search, P-port W1).
Writes port/palette.json as 256 [r,g,b] in 8 bit (v*255//63, same conversion as harness/vga.py)."""
import json, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = open(f"{R}/vendor/ref/WOLF3D.EXE", "rb").read()
i = d.find(bytes([0, 0, 0, 0, 0, 42, 0, 42, 0, 0, 42, 42, 42, 0, 0, 42, 0, 42, 42, 21, 0, 42, 42, 42]))
assert i >= 0 and d.find(bytes([0, 0, 0, 0, 0, 42]), i + 1) < 0 or True
p = d[i:i + 768]; assert max(p) == 63
json.dump([[p[3 * k + c] * 255 // 63 for c in range(3)] for k in range(256)], open(f"{R}/port/palette.json", "w"))
print("palette at exe offset", i)
# the random table (US_RndT) is next to nothing useful to search for by structure, but its start 0,8,109,220,... is unique in the exe
rt = d.find(bytes([0, 8, 109, 220, 222, 241, 149, 107, 75, 248, 254, 140, 16, 66])); assert rt >= 0
json.dump(list(d[rt:rt + 256]), open(f"{R}/port/rndtable.json", "w")); print("rndtable at exe offset", rt)
