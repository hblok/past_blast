#!/usr/bin/env python3
"""Record N frames at the game's frame hook (M3.4). One process, one emulator, one persistent debugger connection.
  harness/run.py --exe ref --startup level1 --frames 400 --shots 100,300 --input "20:+Left 60:-Left 70:+ctrl 80:-ctrl"
Run dir: runs/<scenario>/<exe-id>/<timestamp>/ {manifest.json, input.txt, state.jsonl, shots/f<n>.png (+ .sha256 in manifest), log.txt}
Wall-clock keys (xdotool) are used ONLY for the start-up steps in game.json; recorded frames are driven by the hook (input = memory writes)."""
import sys
sys.dont_write_bytecode = True
import argparse, hashlib, json, os, struct, sys, time, statistics, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbx import Dbx, ROOT, DBX, DbxError
import ega, script, vga

FMT = {"u16": "<H", "u32": "<I", "i16": "<h"}


def md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()


def decode(blob, base, fld):
    t = fld["type"]; off = int(fld["addr"], 16) - base
    if "[" in t:
        t, n = t[:-1].split("["); return list(struct.unpack_from("<" + str(int(n)) + FMT[t][1], blob, off))
    return struct.unpack_from(FMT[t], blob, off)[0]


def main(argv=None, extra=None):
    """extra (capture.py): object with .install(d, f, ds) called at frame 0, .active, .handle(d, regs, f) for stops that are not the frame hook."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", default="mygame"); ap.add_argument("--exe", default="ref")
    ap.add_argument("--startup", default="level1"); ap.add_argument("--scenario")
    ap.add_argument("--frames", type=int, default=300); ap.add_argument("--shots", default="")
    ap.add_argument("--input", default=""); ap.add_argument("--script", help="input script file (harness/script.py format; frames, keys, shot lines)"); ap.add_argument("--cycles"); ap.add_argument("--out", default=os.path.join(ROOT, "runs"))
    ap.add_argument("--no-lock", action="store_true", help="do not pin the game clock at the hook (runs then diverge, see LESSONS)")
    ap.add_argument("--deadline", type=int, default=900); ap.add_argument("--raw", default="", help="frames at which the raw state range (blob) is saved to raw/f<n>.bin, for diffing two runs")
    a = ap.parse_args(argv)
    gdir = os.path.join(ROOT, "harness", "games", a.game)
    G = json.load(open(os.path.join(gdir, "game.json"))); X = G["exes"][a.exe]
    S = json.load(open(os.path.join(gdir, X["state_map"]))); H = X["frame_hook"]
    cycles = a.cycles or G["cycles"]; scen = a.scenario or (os.path.splitext(os.path.basename(a.script))[0] if a.script else a.startup)
    kb = G["keyboard"]; video = vga if G.get("video") == "vga" else ega      # per-game: game.json "video": "ega" (default) | "vga"
    try:
        if a.script:
            text = open(a.script).read(); inp, sshots, end = script.parse(text, kb["scancodes"])
            if a.frames == ap.get_default("frames") and end is not None: a.frames = end + 1
            a.input = text
        else:
            text = a.input; inp, sshots, end = script.parse("\n".join(t.replace(":", ": ", 1) for t in a.input.split()), kb["scancodes"])
    except script.ScriptError as e: raise SystemExit(f"bad input script: {e}")
    if inp and max(inp) >= a.frames: raise SystemExit(f"bad input script: frame {max(inp)} is beyond the last recorded frame {a.frames - 1}")
    run_dir = os.path.join(a.out, scen, a.exe, time.strftime("%Y%m%d-%H%M%S") + f"-{os.getpid()}")
    os.makedirs(os.path.join(run_dir, "shots")); work = os.path.join(run_dir, "emu")
    log = open(os.path.join(run_dir, "log.txt"), "w")
    L = lambda m: (log.write(f"{time.time():.3f} {m}\n"), log.flush())
    open(os.path.join(run_dir, "input.txt"), "w").write(text.rstrip("\n") + "\n")
    shots = sshots | {int(x) for x in a.shots.split(",") if x}
    hook_cs, hook_ip, ds = (int(H[k], 16) for k in ("cs", "ip", "ds"))
    fields = S["fields"]; ds_fields = {n: f for n, f in fields.items() if "seg" not in f}; seg_fields = {n: f for n, f in fields.items() if "seg" in f}   # "seg": absolute runtime segment (data outside DGROUP, e.g. the RNG index)
    lo = min(int(f["addr"], 16) for f in ds_fields.values())
    hi = max(int(f["addr"], 16) + (int(f["type"].split("[")[1][:-1]) * 2 if "[" in f["type"] else int(f["type"][1:]) // 8) for f in ds_fields.values())
    kb_base = int(kb["addr"], 16)
    irq = []

    def key(down, k):                                            # what the game's INT 9 handler does: table[sc] = down; on make also LastScan = sc
        sc = kb["scancodes"][k]; d.write(ds, kb_base + kb["stride"] * sc, 1 if down else 0)
        if down: d.write(ds, int(kb["last_scan"], 16), sc)
    lock = None if a.no_lock else S.get("clock_lock")
    frames, times, shot_info, shot_cost = [], [], {}, {}
    rundir = os.path.join(ROOT, X["rundir"])
    with Dbx(rundir, work, cycles=cycles, deadline=a.deadline, autoexec=X["dos_cmd"]) as d:
        for bp in X.get("boot_patches", []):                       # per-game patches of the running program at its first call (e.g. fix a clock-derived RNG seed), see LESSONS
            seg, off = (int(v, 16) for v in bp["bp"].split(":")); d.cmd("BP %04X:%04X" % (seg, off))
            d.step(known={(seg * 16 + off) & 0xFFFFF}); got = d.read(seg, off, len(bp["expect"]) // 2, "patch.bin").hex()
            if got != bp["expect"]: raise SystemExit(f"boot patch {bp['bp']}: code is {got}, expected {bp['expect']}")
            for at, hexbytes in bp["write"]: d.cmd("SM %s %s" % (at, hexbytes))
            d.cmd("BPDEL *"); L(f"boot patch {bp['bp']} applied")
        if X.get("hook_from_start"):                                # breakpoint on the frame hook from the very start: the first hit is the first game frame after the level loads (not wall-clock dependent)
            d.cmd(f"BP {hook_cs:04X}:{hook_ip:04X}")
        d.run(); L("emulator up")
        for st in G["startups"][a.startup]["steps"]:               # start-up only: wall clock
            if st[0] == "wait": time.sleep(st[1])
            elif st[0] == "key": d.xdo("key", "--delay", "150", st[1])
            elif st[0] == "hold": d.xdo("keydown", st[1]); time.sleep(st[2]); d.xdo("keyup", st[1])
            elif st[0] in ("tkey", "thold"):                       # same, but as writes to the game's key table (no X events); wall-clock duration
                d.req("BREAK"); key(1, st[1]); d.run(); time.sleep(st[2] if st[0] == "thold" else 0.3); d.req("BREAK"); key(0, st[1]); d.run()
        d.req("BREAK"); L("halted after start-up")
        if X.get("hook_from_start"):
            r = d.regs("CS", "IP")
            if r != {"CS": hook_cs, "IP": hook_ip}: raise SystemExit(f"hook_from_start: emulator is not halted at the first frame hook: {r}")
        sig = d.read(hook_cs, hook_ip - len(X["frame_hook"]["signature"]) // 2 + 1, len(H["signature"]) // 2, "sig.bin").hex()
        if sig.upper() != H["signature"]: raise SystemExit(f"hook signature mismatch: {sig} != {H['signature']} (wrong exe or load address)")
        if not X.get("hook_from_start"): d.cmd(f"BP {hook_cs:04X}:{hook_ip:04X}")
        t_start = time.time()
        f, pre, al = -1, 0, S.get("align")
        wr32 = lambda name, v: d.cmd("SM %04X:%04X %s" % (ds, int(fields[name]["addr"], 16), " ".join("%X" % ((v >> (8 * i)) & 255) for i in range(4))))
        def canon():                                                   # canonical start state: game clock + free-running timers (state map "align")
            cl = S["clock_lock"]; wr32(cl["counter"], al["clock_base"]); wr32(cl["saved"], al["clock_base"])
            for w in al.get("write", []): d.write(ds, int(w["addr"], 16), w["value"])
        def step():                                                    # resume until the frame hook; other breakpoints go to `extra`
            hphys = (hook_cs * 16 + hook_ip) & 0xFFFFF
            r = d.step(known=({hphys} | extra.bps) if extra and extra.active else ({hphys} if X.get('hook_from_start') else None))
            while extra and extra.active and (r["CS"] * 16 + r["IP"]) & 0xFFFFF != hphys: extra.handle(d, r, f); r = d.step(known=({hphys} | extra.bps) if extra.active else None)
        while f < a.frames - 1 and not (extra and extra.done):
            t0 = time.perf_counter()
            step(); blob = d.read(ds, lo, hi - lo, "state.bin")
            if f < 0 and al and pre == 0:                              # first hook: put the game clock on a canonical value (its absolute value / parity leaks into the physics)
                canon(); pre = 1; continue
            if f < 0 and al and decode(blob, lo, fields[al["field"]]) != al["value"]:   # frame-0 alignment: skip hooks until the double-buffer parity is canonical
                pre += 1
                if pre > al["max"] + 1: raise SystemExit(f"alignment failed: {al['field']} never became {al['value']}")
                canon()                                                # every skipped hook re-pins clock + timers, so frame 0 always sees base+2
                continue
            f += 1
            if f == 0 and extra: extra.install(d, ds)
            rec = {"f": f}
            if str(f) in a.raw.split(","): os.makedirs(os.path.join(run_dir, "raw"), exist_ok=True); open(os.path.join(run_dir, "raw", f"f{f}.bin"), "wb").write(blob)
            for n, fld in ds_fields.items(): rec[n] = decode(blob, lo, fld)
            for n, fld in seg_fields.items(): rec[n] = decode(d.read(int(fld["seg"], 16), int(fld["addr"], 16), int(fld["type"][1:]) // 8, "seg.bin"), 0, {"type": fld["type"], "addr": "0x0"})
            if f == 0:
                r = d.regs("CS", "IP", "DS"); L(f"first hit {r}")
                if r != {"CS": hook_cs, "IP": hook_ip, "DS": ds}: raise SystemExit(f"first stop is not at the hook: {r}")
                tick0 = rec["tick"]
                bad = {k: (rec[k], v) for k, v in G["startups"][a.startup].get("expect", {}).items() if rec[k] != v}
                if bad: raise SystemExit(f"start-up did not reach the expected frame-0 state (field: got, want): {bad}")
            raw = rec["tick"]
            if lock:                                                  # pin the game clock: next wait loop sees exactly 2 ticks
                sv = rec[lock["saved"]]; d.cmd("SM %04X:%04X %s" % (ds, int(fields[lock["counter"]]["addr"], 16), " ".join("%X" % ((sv >> (8 * i)) & 255) for i in range(4))))
                if f: irq.append(raw - prev_set)
                prev_set = sv
            else:
                if f: irq.append(raw - prev_raw)
                prev_raw = raw
            rec["t"] = 2 * f if lock else raw - tick0; del rec["tick"]; rec.pop("tick_saved", None)
            rec["irq"] = irq[-1] if f else None                       # timer IRQs the game saw since the last hook (2 = normal); != 2 after the first frames = run is tainted by host timing (LESSONS M3.2)
            frames.append(rec)
            for down, k in inp.get(f, []):                            # input for the NEXT frame, written while halted at the hook
                if down == "set": d.cmd("SM %04X:%04X %s" % (ds, k[0], " ".join("%X" % x for x in k[1]))); L(f"f{f} set DS:{k[0]:04X}={k[1].hex()}"); continue
                key(down, k); L(f"f{f} {'+' if down else '-'}{k}")
            times.append(time.perf_counter() - t0)
            if f in shots:
                t1 = time.perf_counter(); img, pal, info = video.capture(d)
                p = os.path.join(run_dir, "shots", f"f{f}.png"); video.to_png(img, pal, p)
                L(f"attr {info.get('attr')} pal {len(pal)} entries"); shot_info[f] = {"sha256": hashlib.sha256(img.tobytes() + bytes(sum(pal, ()))).hexdigest(), **{k: v for k, v in info.items() if k != "attr"}}
                shot_cost[f] = time.perf_counter() - t1; L(f"shot f{f} {shot_info[f]} {shot_cost[f]:.1f}s")
        wall = time.time() - t_start
    with open(os.path.join(run_dir, "state.jsonl"), "w") as fh:
        for r in frames: fh.write(json.dumps(r, separators=(",", ":")) + "\n")
    dts = irq
    pure = [t for i, t in enumerate(times) if i not in shots]
    man = {"exe": a.exe, "exe_md5": md5(os.path.join(ROOT, X["path"])), "data_md5": {n: md5(os.path.join(rundir, n)) for n in G.get("data_files", [])},
           "emulator": {"binary_md5": md5(DBX), "conf": open(os.path.join(work, "dbx.conf")).read()}, "cycles": cycles,
           "input_sha256": hashlib.sha256(a.input.encode()).hexdigest(), "state_map_sha256": hashlib.sha256(open(os.path.join(gdir, X["state_map"]), "rb").read()).hexdigest(),
           "startup": a.startup, "align_skipped_hooks": pre, "clock_lock": bool(lock), "frames": a.frames, "first_tick_abs": tick0, "shots": shot_info,
           "irq_ticks_between_hooks_hist": dict(sorted(collections.Counter(dts).items())),
           "cost": {"wall_total_s": round(wall, 1), "ms_per_frame_mean": round(1000 * statistics.mean(pure), 1), "ms_per_frame_median": round(1000 * statistics.median(pure), 1),
                    "ms_per_frame_p95": round(1000 * sorted(pure)[int(.95 * len(pure))], 1), "s_per_1000_frames": round(1000 * statistics.mean(pure), 0),
                    "s_per_screenshot": {str(k): round(v, 1) for k, v in shot_cost.items()}, "state_bytes_per_frame": hi - lo,
                    "state_jsonl_bytes": os.path.getsize(os.path.join(run_dir, "state.jsonl"))}}
    json.dump(man, open(os.path.join(run_dir, "manifest.json"), "w"), indent=1)
    print(run_dir); print(json.dumps({k: man[k] for k in ("irq_ticks_between_hooks_hist", "cost")}))
    return run_dir, man


if __name__ == "__main__":
    main()
