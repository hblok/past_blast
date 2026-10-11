#!/usr/bin/env python3
"""Merge the function lists of Ghidra and Reko for one exe into a single table (generic, blind-safe: no ground truth needed).
Usage: merge_functions.py <ghidra target_info.txt> <reko .reko dir> <out.csv> [ghidra_base=0x10000] [reko_base=0x8000]
Coordinates: both tools load the MZ image at a pretend base; subtracting it gives the common 'image offset' (linear offset in the image).
Columns: image_offset, ghidra_name, ghidra_size, reko_name, tools (both|ghidra|reko), confidence note.
`both` = two independent tools agree this is a function start: high confidence. `reko`-only starts are candidates to add to Ghidra
(scripts/ghidra/AddFunctions.java reads the 'reko' rows); `ghidra`-only starts are kept (Ghidra is the more complete tool)."""
import re, glob, csv, sys
gi, rd, out = sys.argv[1:4]; gb = int(sys.argv[4], 0) if len(sys.argv) > 4 else 0x10000; rb = int(sys.argv[5], 0) if len(sys.argv) > 5 else 0x8000
G = {}
for l in open(gi):
    m = re.match(r'([0-9a-f]{4}):([0-9a-f]{4})\s+(\d+)\s+(\S+)', l)
    if m: G[int(m.group(1), 16) * 16 + int(m.group(2), 16) - gb] = (m.group(4), int(m.group(3)))
R = {}
for f in glob.glob(rd + '/*.c'):
    for l in open(f, errors='replace'):
        m = re.match(r'^(?:[A-Za-z_][^;{=]*?\b)?(?:define\s+)?(fn([0-9A-F]{4})_([0-9A-F]{4}))(?:\(|\s*$)', l)
        if m and not l.startswith(('//', '\t', ' ')): R[int(m.group(2), 16) * 16 + int(m.group(3), 16) - rb] = m.group(1)
rows = []
for a in sorted(set(G) | set(R)):
    t = 'both' if a in G and a in R else 'ghidra' if a in G else 'reko'
    rows.append([f"{a:#x}", G.get(a, ('', ''))[0], G.get(a, ('', ''))[1], R.get(a, ''), t])
with open(out, 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['image_offset', 'ghidra_name', 'ghidra_size', 'reko_name', 'tools']); w.writerows(rows)
c = {k: sum(1 for r in rows if r[4] == k) for k in ('both', 'ghidra', 'reko')}
print(f"merged {len(rows)} function starts: both {c['both']}, ghidra only {c['ghidra']}, reko only {c['reko']} -> {out}")
