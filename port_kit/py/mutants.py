#!/usr/bin/env python3
"""Mutation check of a port against its oracle recordings. A mutant is one deliberate bug (a string replacement in the port's source); it is KILLED when at least one recording no longer
matches, SURVIVED when all still match (= the recordings do not exercise that code or only touch it at a boundary value). Restores the file afterwards. Config: JSON file
{"src": "port/src", "cmd": ["node", "port/oracle.mjs", "port/adapter.mjs", "{ref}", "{scenario}"], "oracles": [{"ref": "...", "scenario": "..."}],
 "mutants": [{"name": "...", "file": "game.js", "old": "...", "new": "..."}]}.    usage: mutants.py config.json [name-filter]
Write mutants for every rule that has a number in it (damage shifts, hit chances, thresholds, speeds), plus each `<` -> `<=`; a survivor names a scenario you still need to record."""
import json, os, shutil, subprocess, sys
cfg = json.load(open(sys.argv[1])); flt = sys.argv[2] if len(sys.argv) > 2 else ""
def run():
    for o in cfg["oracles"]:
        cmd = [c.replace("{ref}", o["ref"]).replace("{scenario}", o["scenario"]) for c in cfg["cmd"]]
        if subprocess.run(cmd, capture_output=True, text=True).returncode: return o["ref"]
    return None
assert run() is None, "baseline does not match: fix the port first"
killed = 0; total = 0
for m in cfg["mutants"]:
    if flt not in m["name"]: continue
    path = os.path.join(cfg["src"], m["file"]); src = open(path).read()
    if m["old"] not in src: print(f"{m['name']}: PATTERN NOT FOUND"); continue
    shutil.copy(path, "/tmp/_mut_backup"); open(path, "w").write(src.replace(m["old"], m["new"], 1)); total += 1
    try: k = run()
    finally: shutil.copy("/tmp/_mut_backup", path)
    killed += bool(k); print(f"{m['name']}: " + (f"KILLED by {k}" if k else "SURVIVED"), flush=True)
print(f"{killed} of {total} mutants killed")
