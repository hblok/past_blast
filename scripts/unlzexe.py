#!/usr/bin/env python3
"""Unpack an LZEXE 0.90/0.91 packed DOS EXE (the shipped Keen Dreams v1.13 GAME.EXE is LZ91).
Usage: unlzexe.py packed.exe unpacked.exe
Format (pushbx.org/ecm/doc/lzexe.htm section 8.2 + unlzexe.c): LZ info words at (cs+hdr)*16, compressed data at
(cs - inf[4] + hdr)*16, relocation table (0.91 coding) at +0x158 of the stub; output image is the unrelocated image.
The rebuilt MZ header gets the original ss:sp/cs:ip and a fresh relocation table; min/max alloc are recomputed like unlzexe."""
import struct, sys
d = open(sys.argv[1], 'rb').read()
h = list(struct.unpack_from('<16H', d, 0))
assert h[0] in (0x5A4D, 0x4D5A) and d[0x1C:0x20] in (b'LZ91', b'LZ09'), 'not LZEXE'
ver = 91 if d[0x1C:0x20] == b'LZ91' else 90
stub = (h[0x0B] + h[4]) << 4
inf = struct.unpack_from("<7H", d, stub)          # ip0, cs0, sp0, ss0, compressed paras, increase paras, ?, (code from word 7)
ip0, cs0, sp0, ss0 = inf[0], inf[1], inf[2], inf[3]
pos = (h[0x0B] - inf[4] + h[4]) << 4              # start of compressed data
# --- decompress (linear; the "normalise pointers" marker needs no action on a flat buffer)
out = bytearray(); bits = struct.unpack_from('<H', d, pos)[0]; pos += 2; cnt = 16
def getbit():
    global bits, cnt, pos
    b = bits & 1; bits >>= 1; cnt -= 1
    if cnt == 0:                                      # 16th bit consumed: the NEXT tag word is loaded at once (before that command's bytes)
        bits = struct.unpack_from('<H', d, pos)[0]; pos += 2; cnt = 16
    return b
while True:
    if getbit(): out.append(d[pos]); pos += 1; continue
    if not getbit():
        n = (getbit() << 1) | getbit(); n += 2; span = d[pos] - 256; pos += 1
    else:
        lo = d[pos]; hi = d[pos + 1]; pos += 2
        span = ((hi & 0xF8) << 5 | lo) - 8192; n = (hi & 7) + 2
        if n == 2:
            n = d[pos]; pos += 1
            if n == 0: break                      # end of stream
            if n == 1: continue                   # segment change marker
            n += 1
    for _ in range(n): out.append(out[len(out) + span])
# --- relocations (0.91 coding)
rp = stub + (0x158 if ver == 91 else 0x19D); rel = []; off = seg = 0
while True:
    s = d[rp]; rp += 1
    if s == 0:
        s = struct.unpack_from('<H', d, rp)[0]; rp += 2
        if s == 0: seg += 0x0FFF; continue
        if s == 1: break
    off += s; seg += (off & ~0xF) >> 4; off &= 0xF; rel.append((off, seg & 0xFFFF))
# --- rebuild header
hdr_bytes = (0x1C + 4 * len(rel) + 15) & ~15
tot = hdr_bytes + len(out)
o = h[:14]
o[1] = tot % 512; o[2] = (tot + 511) // 512; o[3] = len(rel); o[4] = hdr_bytes // 16
o[7], o[8], o[10], o[11], o[12], o[9] = ss0, sp0, ip0, cs0, 0x1C, 0
o[5] = max(0, h[5] - inf[5] - ((inf[6] + 15) >> 4) - 9) if ver == 91 else h[5]   # unlzexe's min-alloc fix-up
if h[6] != 0: o[6] = max(o[5], h[6] - (h[5] - o[5]))
hdr = bytearray(struct.pack('<14H', *o)) + b''.join(struct.pack('<HH', a, b) for a, b in rel)
hdr += b'\0' * (hdr_bytes - len(hdr))
open(sys.argv[2], 'wb').write(hdr + out)
print(f"unpacked: image {len(out)} B, {len(rel)} relocs, header {hdr_bytes} B, cs:ip {cs0:04X}:{ip0:04X} ss:sp {ss0:04X}:{sp0:04X}, minalloc {o[5]:#x}")
