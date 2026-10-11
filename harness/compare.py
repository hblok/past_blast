#!/usr/bin/env python3
"""compare.py A B [--map state.json]: compare two run dirs (design section 7). Exit 0 = identical, 1 = diverged.
Frames are aligned by number. Reports the first divergent frame, the differing fields (old -> new) and the last 10 frames before it.
Fields marked "tolerant" in the state map are skipped; "compare_mask" words of array fields are ignored. Shots: sha256 from manifest.json,
for differing shots the pixel difference ratio (shots/f<n>.png). Only the first divergence is reported in detail (state snowballs)."""
import sys
sys.dont_write_bytecode = True
import argparse, glob, json, os


def load(d):
    return d, [json.loads(l) for l in open(os.path.join(d, "state.jsonl"))], json.load(open(os.path.join(d, "manifest.json")))


def masked(r, mask):
    r = {k: v for k, v in r.items() if k not in mask["skip"]}
    for k, ws in mask["words"].items():
        if k in r: r[k] = [None if i in ws else v for i, v in enumerate(r[k])]
    return r


def fdiff(a, b):
    out = {}
    for k in sorted(set(a) | set(b)):
        if a.get(k) != b.get(k):
            if isinstance(a.get(k), list) and isinstance(b.get(k), list):
                out[k] = {i: (x, y) for i, (x, y) in enumerate(zip(a[k], b[k])) if x != y}
            else: out[k] = (a.get(k), b.get(k))
    return out


def shot_ratio(da, db, f):
    try:
        from PIL import Image; import numpy as np
        x, y = (np.asarray(Image.open(os.path.join(d, "shots", f"f{f}.png")).convert("RGB")) for d in (da, db))
        return float((x != y).any(axis=2).mean()) if x.shape == y.shape else 1.0
    except Exception: return None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("a"); ap.add_argument("b"); ap.add_argument("--game", default="mygame")
    args = ap.parse_args()
    (da, A, ma), (db, B, mb) = load(args.a), load(args.b)
    S = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "games", args.game, ma["exe"] + ".state.json")))
    mask = {"skip": {"t", "irq"} | {k for k, v in S["fields"].items() if v.get("tolerant")}, "words": {k: v["words"] for k, v in S.get("compare_mask", {}).items()}}
    # compare_mask is a start-up artefact (idle timer phase, converges at the first input): applied to the first 40 frames only
    n = min(len(A), len(B)); first = None
    for i in range(n):
        m = mask if i < 40 else {"skip": mask["skip"], "words": {}}
        d = fdiff(masked(A[i], m), masked(B[i], m))
        if d: first = (i, d); break
    lines = [f"A {da}", f"B {db}", f"frames: A {len(A)}  B {len(B)}"]
    ok = first is None and len(A) == len(B)
    if first:
        i, d = first; lines.append(f"DIVERGED at frame {i} in fields: {', '.join(d)}")
        for k, v in d.items(): lines.append(f"  {k}: {v}")
        lines.append("last frames before it (A | B, scalar fields):")
        for j in range(max(0, i - 10), i):
            lines.append("  f%d %s" % (j, " ".join(f"{k}={A[j][k]}" for k in A[j] if not isinstance(A[j][k], list) and k not in mask["skip"] and k != "f")))
        lines.append("  f%d (first divergent) A %s | B %s" % (i, {k: A[i][k] for k in d if k in A[i]}, {k: B[i].get(k) for k in d}))
    elif len(A) != len(B): lines.append(f"states agree for {n} frames, but run lengths differ")
    else: lines.append(f"state: identical over {n} frames (tolerant fields skipped: {sorted(mask['skip'] - {'t', 'irq'})})")
    for tag, R in (("A", A), ("B", B)):                 # frame_tics = tics the game used for the frame; != 2 under the clock lock means the lock failed
        odd = [r["f"] for r in R if r.get("frame_tics", 2) != 2]
        if odd: lines.append(f"WARNING {tag}: {len(odd)} frames ran with frame_tics != 2 (first at frame {odd[0]}): clock lock failed, re-run")
    sa, sb = ma.get("shots", {}), mb.get("shots", {})
    for f in sorted(set(sa) | set(sb), key=int):
        if f not in sa or f not in sb: lines.append(f"shot f{f}: only in {'A' if f in sa else 'B'}"); ok = False
        elif sa[f]["sha256"] == sb[f]["sha256"]: lines.append(f"shot f{f}: identical")
        else:
            r = shot_ratio(da, db, f); ok = False
            lines.append(f"shot f{f}: DIFFERENT" + (f" ({100 * r:.2f}% of pixels)" if r is not None else ""))
    lines.append("VERDICT: " + ("PASS (identical)" if ok else f"FAIL (first divergence frame {first[0]})" if first else "FAIL"))
    print("\n".join(lines)); sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
