#!/usr/bin/env python3
"""Function capture for host differential testing (M6.2a, design: plans/verification_design.md).
  harness/capture.py --fn 0x01400 --script harness/games/mygame/scenarios/walk_jump.txt -n 20 --out captures
Runs the scenario through run.py (same start-up, frame-0 alignment, clock lock, input at the frame hook), puts an execution breakpoint on the
function entry and, at every hit, stores registers + the 640 KB conventional memory (0000:0000..9FFFF, gzip), reads the return address from the
stack, breaks there (SP must equal entry SP + 4 far / + 2 near, so recursion and nested calls pair up correctly) and stores registers + memory again.
Output: <out>/<image_offset 5 hex>/{<n>.before.bin.gz, <n>.after.bin.gz, <n>.regs.json, meta.json}, <out>/index.json (see harness/README.md).
--fn: image_offset (0x01400) or runtime seg:off (1c08:0a3c); conversion = game.json "load_segment". TODO (documented, not done): port IN/OUT and INT
log between entry and return: the debugger has no port breakpoints, LOG n is far too slow per call; use captures only for functions without I/O or
check the function bytes for IN/OUT/INT by hand."""
import sys
sys.dont_write_bytecode = True
import argparse, csv, glob, gzip, hashlib, json, os, signal, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run
from dbx import ROOT

REGS = ("AX", "BX", "CX", "DX", "SI", "DI", "BP", "SP", "IP", "CS", "DS", "ES", "SS", "FLAGS")
MEMLEN = 0xA0000


def parse_fn(s, ls):
    if ":" in s:
        seg, off = (int(x, 16) for x in s.split(":")); return (seg - ls) * 16 + off
    return int(s, 16)


FUNCS_CSV = os.path.join(ROOT, 'blind', 'functions.csv')   # default; main() takes it from game.json replay.functions_csv

class Capture:
    def __init__(self, img, ls, n, every, ret, out, gcfg, callees=(), entry_set=()):
        self.entry_set = entry_set; self.from_frame = 0
        self.img, self.ls, self.n, self.every, self.ret = img, ls, n, every, ret
        self.seg, self.off = ls + (img >> 4), img & 15
        self.phys = (self.seg * 16 + self.off) & 0xFFFFF
        self.dir = os.path.join(out, f"{img:05x}"); os.makedirs(self.dir, exist_ok=True)
        self.active = False; self.done = False
        self.frame_calls = [-1, 0]; self.pending = []; self.bps = {self.phys}; self.calls = 0; self.stored = 0; self.dups = 0; self.nested = 0; self.seen = set(); self.t_entry = []; self.t_ret = []
        self.logf = open(os.path.join(self.dir, "capture.log"), "w")
        self.frames = []; self.gcfg = gcfg; self.first_seg = {}
        # recorded-effect callees: entry phys -> (image offset, ret kind); open callee calls of the current target call
        self.cnear = {c for c in callees if isinstance(c, tuple)}; callees = [c[0] if isinstance(c, tuple) else c for c in callees]   # (off, 'n') = near callee
        self.cent = {((ls + (c >> 4)) * 16 + (c & 15)) & 0xFFFFF: c for c in callees}; self.cpend = []

    def install(self, d, ds):
        self.ds = ds; self.active = True
        d.cmd(f"BP {self.seg:04X}:{self.off:04X}")
        for ph, c in self.cent.items(): d.cmd(f"BP {self.ls + (c >> 4):04X}:{c & 15:04X}"); self.bps.add(ph)
        if self.ret == "auto":                                   # last byte of the function from functions.csv: C3 = near ret, CB = retf
            self.ret = "far"
            try:
                for row in csv.DictReader(open(FUNCS_CSV)):
                    if int(row["image_offset"], 16) == self.img:
                        last = d.read(self.seg, self.off + int(row["size"]) - 1, 1, "rd.bin")[0]
                        self.ret = "near" if last == 0xC3 else "far"; break
            except Exception: pass

    def mem(self, d):
        d.cmd(f"MEMDUMPBIN 0000:0000 {MEMLEN:X} MEM.BIN")
        return open(os.path.join(d.workdir, "MEM.BIN"), "rb").read()

    MAX_PENDING, MAX_CALLS_PER_FRAME = 12, 400

    def handle(self, d, r, f):
        phys = (r["CS"] * 16 + r["IP"]) & 0xFFFFF
        if len(self.pending) > self.MAX_PENDING:                  # guards against hangs: each stop costs ~50 ms, a stuck return pending grows without bound
            raise SystemExit(f"ABORT: {len(self.pending)} calls pending at frame {f} (calls={self.calls}, stored={self.stored}): the return never matches; try --ret near|far (was {self.ret}) or the function is recursive/never returns")
        if self.frame_calls[0] != f: self.frame_calls[:] = [f, 0]
        self.frame_calls[1] += phys == self.phys
        if self.frame_calls[1] > self.MAX_CALLS_PER_FRAME and not self.stored:
            raise SystemExit(f"ABORT: {self.frame_calls[1]} entries within frame {f} and nothing stored: too hot for breakpoint capture (use --every, or pick the caller)")
        self.logf.write(f"f{f} stop {r['CS']:04x}:{r['IP']:04x} calls={self.calls} stored={self.stored} pending={len(self.pending)}\n"); self.logf.flush()
        t0 = time.perf_counter()
        if phys in self.cent or any(c["rlin"] == phys for c in self.cpend):
            if self.callee(d, phys): return
        if phys == self.phys:                                      # ---- entry
            if f < self.from_frame: return                         # --from-frame: skip entries before the window (not counted, so --every counts from the window start)
            self.calls += 1
            if (self.calls - 1) % self.every: return
            for o, h in self.entry_set: d.cmd("SM %04X:%04X %s" % (self.ds, o, " ".join("%X" % x for x in h)))   # input perturbation (--entry-set)
            regs = d.regs(*REGS); mem = self.mem(d)
            sp, ss = regs["SP"], regs["SS"]; a = ss * 16 + sp
            rip = mem[a] | mem[a + 1] << 8; rcs = (mem[a + 2] | mem[a + 3] << 8) if self.ret == "far" else regs["CS"]
            sha = hashlib.sha256(mem).hexdigest()
            if sha in self.seen: self.dups += 1; return
            self.seen.add(sha)
            if self.pending: self.nested += 1
            p = dict(call=self.calls, frame=f, depth=len(self.pending), regs=regs, mem=mem, sp=sp, ret=(rcs, rip), rlin=(rcs * 16 + rip) & 0xFFFFF, callees=[])
            self.pending.append(p)
            if p["rlin"] not in self.bps: d.cmd(f"BP {rcs:04X}:{rip:04X}"); self.bps.add(p["rlin"])
            self.t_entry.append(time.perf_counter() - t0)
        else:                                                      # ---- some return breakpoint
            regs = d.regs(*REGS); back = 4 if self.ret == "far" else 2
            for p in reversed(self.pending):
                if p["rlin"] == phys and regs["SP"] == p["sp"] + back and regs["SS"] == p["regs"]["SS"]: break
            else: return                                           # inner/other return to the same site: not ours
            mem = self.mem(d); self.pending.remove(p)
            i = self.stored; base = os.path.join(self.dir, str(i))
            for tag, m in (("before", p["mem"]), ("after", mem)):
                with open(f"{base}.{tag}.bin.gz", "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=6, mtime=0) as g: g.write(m)   # no name/mtime in the header: identical content = identical file
            json.dump({"n": i, "call": p["call"], "frame": p["frame"], "depth": p["depth"], "ret_kind": self.ret, "ret": {"cs": p["ret"][0], "ip": p["ret"][1]},
                       "entry": p["regs"], "exit": regs, "mem_before_sha256": hashlib.sha256(p["mem"]).hexdigest(), "mem_after_sha256": hashlib.sha256(mem).hexdigest()},
                      open(base + ".regs.json", "w"), indent=1)
            if self.cent: json.dump(p["callees"], open(base + ".callees.json", "w"), indent=0)
            self.stored += 1; self.frames.append(p["frame"]); self.t_ret.append(time.perf_counter() - t0)
            if self.stored >= self.n: self.finish(d)

    def callee(self, d, phys):
        """Recorded-effect callee stubs (--callees): inside a pending target call, record each listed callee's arguments (stack words), its
        memory effect (sparse delta, the callee's own dead stack below its entry SP excluded) and AX/DX. True = this stop was a callee stop."""
        regs = d.regs(*REGS)
        if phys in self.cent and self.pending:                    # callee entry (far: ret ip, cs, then args)
            mem = self.mem(d); a = regs["SS"] * 16 + regs["SP"]
            near = any(c[0] == self.cent[phys] for c in self.cnear); k = 2 if near else 4   # near: ret ip only, CS unchanged
            rip, rcs = mem[a] | mem[a + 1] << 8, regs["CS"] if near else mem[a + 2] | mem[a + 3] << 8
            words = [mem[a + k + 2 * i] | mem[a + k + 1 + 2 * i] << 8 for i in range(8)]
            c = dict(fn=f"0x{self.cent[phys]:05x}", args=words, sp=regs["SP"], ss=regs["SS"], k=k, mem=mem, rlin=(rcs * 16 + rip) & 0xFFFFF, owner=self.pending[-1])
            self.cpend.append(c)
            if c["rlin"] not in self.bps: d.cmd(f"BP {rcs:04X}:{rip:04X}"); self.bps.add(c["rlin"])
            return True
        for c in reversed(self.cpend):                            # callee return: SP back to entry + 4 (retf)
            if c["rlin"] == phys and regs["SP"] == c["sp"] + c["k"] and regs["SS"] == c["ss"]:
                mem = self.mem(d); self.cpend.remove(c); b = c.pop("mem"); lo = c["ss"] * 16 + c["sp"] - 0x200; hi = c["ss"] * 16 + c["sp"] + c["k"]
                delta, i = [], 0
                while i < len(mem):
                    if mem[i] != b[i] and not lo <= i < hi:
                        j = i
                        while j < len(mem) and mem[j] != b[j]: j += 1
                        delta.append([i, mem[i:j].hex()]); i = j
                    else: i += 1
                c.pop("owner")["callees"].append(dict(fn=c["fn"], args=c["args"], delta=delta, ax=regs["AX"], dx=regs["DX"]))
                return True
        return phys in self.cent                                  # entry outside a target call: ignore; else fall through (target ret)

    def finish(self, d):
        self.done = True; self.active = False
        for line in reversed(d.cmd("BPLIST")):                     # delete our breakpoints (entry + returns), keep the frame hook (the run finishes this frame)
            parts = line.split()
            if len(parts) >= 3 and parts[1] == "BP" and parts[0][:-1].isdigit():
                seg, off = (int(x, 16) for x in parts[2].split(":"))
                if (seg * 16 + off) & 0xFFFFF == self.phys or (seg * 16 + off) & 0xFFFFF in self.bps: d.cmd(f"BPDEL {int(parts[0][:-1])}")


def reindex(out):
    idx = {}
    for m in sorted(glob.glob(os.path.join(out, "*", "meta.json"))):
        j = json.load(open(m)); idx[j["image_offset"]] = {k: j[k] for k in ("name", "count", "scenario", "ret_kind", "exe_md5", "bytes_per_capture") if k in j}
    json.dump(idx, open(os.path.join(out, "index.json"), "w"), indent=1)
    return idx


def diff_dirs(a, b):
    """Determinism check: python3 harness/capture.py --diff captures/<fn> /tmp/other/<fn>. Compares every n.before/n.after image of two capture runs of the
    same function and prints the differing DS offsets (merged, with how many images each hits). Bytes just below SP are stack residue (ignorable)."""
    ds = None; hits = {}; same = tot = 0
    for f in sorted(glob.glob(os.path.join(a, "*.regs.json"))):
        r = json.load(open(f)); ds = r["entry"]["DS"]; sp = r["entry"]["SP"]; n = r["n"]
        for tag in ("before", "after"):
            x = gzip.open(os.path.join(a, f"{n}.{tag}.bin.gz")).read(); y = gzip.open(os.path.join(b, f"{n}.{tag}.bin.gz")).read(); tot += 1
            d = [i for i in range(len(x)) if x[i] != y[i]]; same += not d
            for i in d:
                o = i - ds * 16
                k = "BIOS 0040:%04x" % i if i < 0x500 else ("stack residue (below SP)" if sp - 0x400 <= o < sp else "DS:%04x" % o)
                hits.setdefault(k, set()).add((n, tag))
    print(f"{same}/{tot} images identical; differing locations (image count):")
    for k in sorted(hits): print(f"  {k}  {len(hits[k])}")


def main():
    global FUNCS_CSV
    if len(sys.argv) == 4 and sys.argv[1] == "--diff": return diff_dirs(sys.argv[2], sys.argv[3])
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fn", required=True, help="image_offset (0x01400) or runtime seg:off (1c08:0a3c)")
    ap.add_argument("--script", required=True, help="scenario script (harness/script.py format)")
    ap.add_argument("-n", type=int, default=20, help="max captures stored")
    ap.add_argument("--every", type=int, default=1, help="capture every K-th call (spread captures over the scenario)")
    ap.add_argument("--ret", default="auto", choices=("auto", "near", "far"), help="return kind; auto = last byte of the function per blind/functions.csv, else far")
    ap.add_argument("--out", default=os.path.join(ROOT, "captures")); ap.add_argument("--game", default="mygame"); ap.add_argument("--exe", default="ref")
    ap.add_argument("--callees", default="", help="comma list of image offsets: record their effects inside each target call (<n>.callees.json, replay.py recorded-effect stubs)")
    ap.add_argument("--entry-set", default="", help="comma list OFF=HEX: write DGROUP bytes at each captured entry BEFORE the dump (input perturbation: "
                    "makes inputs the game never produces by itself, e.g. timecount != lasttimecount; the capture stays self-consistent, the run after it is perturbed)")
    ap.add_argument("--from-frame", type=int, default=0, help="ignore target entries before this frame (reach a late event without storing every call)")
    ap.add_argument("--startup", default="level1"); ap.add_argument("--deadline", type=int, default=900)
    a = ap.parse_args()
    for sig in (signal.SIGTERM, signal.SIGHUP): signal.signal(sig, lambda *_: sys.exit(128 + 15))   # `timeout` / closed terminal: unwind through Dbx.__exit__ so the emulator and Xvfb die with us (SIGKILL cannot be caught)
    G = json.load(open(os.path.join(ROOT, "harness", "games", a.game, "game.json"))); ls = int(G["load_segment"], 16)
    FUNCS_CSV = os.path.join(ROOT, G["replay"]["functions_csv"])
    img = parse_fn(a.fn, ls); scen = os.path.splitext(os.path.basename(a.script))[0]
    cap = Capture(img, ls, a.n, a.every, a.ret, a.out, G, [(parse_fn(c[:-2], ls), "n") if c.endswith(":n") else parse_fn(c, ls) for c in a.callees.split(",") if c],
                  [(int(x.split("=")[0], 16), bytes.fromhex(x.split("=")[1])) for x in a.entry_set.split(",") if x])
    cap.from_frame = a.from_frame
    t0 = time.time()
    run_dir, man = run.main(["--game", a.game, "--exe", a.exe, "--startup", a.startup, "--script", a.script, "--deadline", str(a.deadline),
                             "--out", os.path.join(a.out, f"{img:05x}", "_run")], extra=cap)
    wall = time.time() - t0
    name = ""
    try: name = next(r["name"] for r in csv.DictReader(open(FUNCS_CSV)) if int(r["image_offset"], 16) == img)
    except StopIteration: pass
    sizes = [os.path.getsize(f) for f in glob.glob(os.path.join(cap.dir, "*.bin.gz"))]
    meta = {"image_offset": f"0x{img:05x}", "name": name, "exe": a.exe, "exe_md5": man["exe_md5"], "load_segment": ls, "entry_seg_off": f"{cap.seg:04x}:{cap.off:04x}",
            "runtime": {"CS": cap.seg, "DS": cap.ds, "SS": cap.ds, "note": "SS==DS==DGROUP (medium model); CS = function's code segment; per-capture values in <n>.regs.json"},
            "ret_kind": cap.ret, "scenario": scen, "scenario_text": open(a.script).read(), "startup": a.startup, "cycles": man["cycles"], "run_dir": os.path.relpath(run_dir, ROOT),
            "count": cap.stored, "calls_seen": cap.calls, "every": a.every, "skipped_identical_before": cap.dups, "nested_captures": cap.nested, "unreturned": len(cap.pending), "frames": cap.frames,
            "memory": "0000:0000..9FFFF (655360 bytes), gzip", "wall_s_total": round(wall, 1),
            "s_per_capture_entry": round(sum(cap.t_entry) / max(1, len(cap.t_entry)), 2), "s_per_capture_return": round(sum(cap.t_ret) / max(1, len(cap.t_ret)), 2),
            "bytes_per_capture": round(sum(sizes) / max(1, cap.stored)), "dir_bytes": sum(sizes),
            "callees_recorded": [f"0x{c:05x}" for c in cap.cent.values()]}
    json.dump(meta, open(os.path.join(cap.dir, "meta.json"), "w"), indent=1)
    reindex(a.out)
    print(json.dumps({k: meta[k] for k in ("image_offset", "name", "ret_kind", "count", "calls_seen", "skipped_identical_before", "nested_captures", "unreturned", "s_per_capture_entry", "s_per_capture_return", "bytes_per_capture", "wall_s_total")}))


if __name__ == "__main__":
    main()
