#!/usr/bin/env python3
"""Write a Reko project (.dcproject) that lists Ghidra's function starts as user procedures. Generic, blind-safe.
Usage: make_project.py <ghidra target_info.txt> <exe name> <out.dcproject> [ghidra_seg_base=0x1000] [reko_seg_base=0x800]
Run: cd <dir with the exe and the project> && dotnet decompile.dll <out.dcproject>   (see scripts/reko/run.sh for the runtime setup)"""
import re, sys
gi, exe, out = sys.argv[1:4]; gs = int(sys.argv[4], 0) if len(sys.argv) > 4 else 0x1000; rs = int(sys.argv[5], 0) if len(sys.argv) > 5 else 0x800
p = []
for l in open(gi):
    m = re.match(r'([0-9a-f]{4}):([0-9a-f]{4})\s+(\d+)', l)
    if m:
        seg = int(m.group(1), 16) - gs + rs; off = int(m.group(2), 16)
        p.append(f'      <procedure name="fn{seg:04X}_{off:04X}"><address>{seg:04X}:{off:04X}</address></procedure>')
open(out, 'w').write(f'<?xml version="1.0" encoding="utf-8"?>\n<project xmlns="http://schemata.jklnet.org/Reko/v5">\n  <arch>x86-real-16</arch>\n  <platform>ms-dos</platform>\n  <input>\n    <filename>{exe}</filename>\n    <user>\n' + '\n'.join(p) + '\n    </user>\n  </input>\n</project>\n')
print(len(p), 'procedures ->', out)
