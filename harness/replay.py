#!/usr/bin/env python3
"""M6.2b host replay: compile one decompiled function against shim.h and replay it on captured memory images.

  python3 harness/replay.py 0x01000 [--src blind|ghidra] [--captures captures] [-v] [--build runs/replay_build]
  python3 harness/replay.py --all-captured

Pipeline: pick function (blind/functions.csv) -> extract its C from blind/decomp/*.c (or ghidra_typed/*.c) ->
mechanical conversion (types to explicit widths, near pointers to NP<T>, DS globals to memory macros, callees to
`untestable` stubs) -> optional manual tweaks harness/games/<game>/replay/<off>.{h,patch} -> g++ -> ctypes -> per capture:
load before image, call, compare with after image (masks below). See harness/README.md."""
import argparse, csv, ctypes, gzip, json, os, re, signal, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEMSZ = 0xA0000
STACK_BELOW = 0x200   # bytes under the entry SP treated as dead stack
TYPEWORDS = set("byte word dword seg_t u8 u16 s16 u32 s32 uint ushort uchar bool NP FARP DSP NEAR8 NEAR16 NEAR32 FAR8 FAR16 FAR32 FP".split())
def configure(game):
    """Per-game data comes from harness/games/<game>/game.json "replay" (M7.2); nothing game-specific is hard-coded below."""
    global GAME, R, GHIDRA_DS, ASYNC_MASK, STRUCT_SIZES, TWEAKS
    GAME = game; R = json.load(open(ROOT / "harness/games" / game / "game.json"))["replay"]
    GHIDRA_DS = int(R["ghidra_ds"], 0); STRUCT_SIZES = [(n, int(v, 0)) for n, v in R["struct_sizes"].items()]
    # bytes the original changes asynchronously (not by the function): BIOS tick, its DS copy, timer-ISR counters
    ASYNC_MASK = [(int(x[1], 0), int(x[2], 0), x[3]) if x[0] == "abs" else ("DS", int(x[1], 0), int(x[2], 0), x[3]) for x in R["async_mask"]]
    TWEAKS = ROOT / R["tweaks_dir"]
    TYPEWORDS.update(n for n, _ in STRUCT_SIZES)
configure(os.environ.get("HARNESS_GAME", "mygame"))
KEYWORDS = set("if else for while do switch case default return break continue sizeof goto struct union enum typedef static const volatile extern void char short int long unsigned signed float double".split())

# ------------------------------------------------------------------ csv data
def load_functions():
    rows = list(csv.DictReader(open(ROOT / R["functions_csv"])))
    for r in rows: r["off"] = int(r["image_offset"], 16)
    return rows

def load_globals():
    out = []
    for r in csv.DictReader(open(ROOT / R["globals_csv"])):
        m = re.match(r"DS:0x([0-9a-f]+)$", r["location"])
        if not m: continue
        try: size = int(r["size"], 0)
        except ValueError: size = 0
        out.append(dict(off=int(m.group(1), 16), size=size, name=r["name"], type=r["type"], meaning=r["meaning"]))
    return out

def struct_layouts():
    """name -> [(field, offset, size)], computed from blind/structs.h field sizes (pragma pack 1 layout)."""
    text = (ROOT / R["structs_h"]).read_text()
    sizes = {"int": 2, "word": 2, "seg_t": 2, "long": 4, "dword": 4, "byte": 1, "char": 1}
    out = {}
    for m in re.finditer(r"typedef struct \w+ \{(.*?)\}\s*(\w+);", text, re.S):
        off, fields = 0, []
        body = re.sub(r"/\*.*?\*/", "", m.group(1), flags=re.S)
        for stmt in body.split(";"):
            stmt = stmt.strip()
            if not stmt: continue
            if "(far" in stmt:
                fields.append((re.search(r"\*(\w+)\)", stmt).group(1), off, 4)); off += 4; continue
            base = re.match(r"(?:unsigned\s+)?(?:struct\s+)?(\w+)(.*)", stmt, re.S)
            tname, rest = base.group(1), base.group(2)
            if " far" in rest: sz = 4
            elif "*" in rest: sz = 2
            else: sz = sizes.get(tname, 2)
            for d in rest.split(","):
                dm = re.match(r"\s*(\**)\s*(\w+)\s*(?:\[(\d+)\])?", d)
                nm, cnt = dm.group(2), int(dm.group(3) or 1)
                fields.append((nm + ("[]" if dm.group(3) else ""), off, sz * cnt)); off += sz * cnt
        out[m.group(2)] = (off, fields)
    return out

# ------------------------------------------------------------------ source extraction
def find_source(name, which, srcdir=None):
    d = srcdir or ROOT / (R["decomp_dir"] if which == "blind" else R["ghidra_dir"])
    pat = re.compile(r"^[A-Za-z_][^;{}=]*\b%s\s*\([^;]*$" % re.escape(name), re.M)
    for f in sorted(d.glob("*.c")):
        t = f.read_text()
        m = pat.search(t)
        if m: return f, t, m.start()
    return None, None, None

def extract(text, start):
    i = text.index("{", start)
    depth, j = 0, i
    while True:
        c = text[j]
        if c == "{": depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0: break
        j += 1
    return text[start:i].strip(), text[i:j + 1]

# ------------------------------------------------------------------ conversion
def retype(s):
    """16-bit C types -> explicit widths (the exe is Borland medium model: int 16, long 32)."""
    s = re.sub(r"\bunsigned\s+long\b", "u32", s)
    s = re.sub(r"\bunsigned\s+(int|short)\b", "u16", s)
    s = re.sub(r"\bsigned\s+(int|short)\b", "s16", s)
    s = re.sub(r"\bunsigned\b(?!\s+char)", "u16", s)
    s = re.sub(r"\blong\b", "s32", s)
    s = re.sub(r"\b(int|short)\b", "s16", s)
    s = re.sub(r"\b(?:struct\s+\w+\s+|\w+\s+)far\s*\*", "FARP ", s)
    return s

def convert_structs():
    t = (ROOT / R["structs_h"]).read_text()
    t = t.replace("typedef unsigned char  byte;", "typedef u8 byte;").replace("typedef unsigned short word;      /* 16-bit */", "typedef u16 word;")
    t = t.replace("typedef unsigned long  dword;     /* 32-bit */", "typedef u32 dword;")
    out = []
    for line in t.split("\n"):
        code, _, cm = line.partition("/*")
        if re.search(r"\(far\s*\*\w+\)", code):
            line = re.sub(r"[\w ]+\(far\s*\*(\w+)\)\([^)]*\);", r"FARP \1;", code) + (("/*" + cm) if cm else "")
        elif re.search(r"\bfar\s*\*", code):
            line = re.sub(r"[\w ]+?\bfar\s*\*+\s*(\w+);", r"FARP \1;", code) + (("/*" + cm) if cm else "")
        elif "typedef" not in code:
            m = re.match(r"(\s*)((?:struct\s+)?\w+)\s+(\*+)\s*(\w+);(.*)", code)
            if m:  # one pointer field per line in structs.h
                inner = m.group(2)
                for _ in m.group(3): inner = "NP<%s>" % inner
                line = "%s%s %s;%s" % (m.group(1), inner, m.group(4), m.group(5)) + (("/*" + cm) if cm else "")
            else:
                line = retype(code) + (("/*" + cm) if cm else "")
        out.append(line)
    t = "\n".join(out)
    t = t.replace("#ifndef " + R["struct_guard"], "#pragma pack(push,1)\n#ifndef " + R["struct_guard"], 1).replace("#endif", "#endif\n#pragma pack(pop)\n", 1)
    for n, sz in STRUCT_SIZES:
        t += "static_assert(sizeof(%s) == %d, \"%s layout\");\n" % (n, sz, n)
    return t

def split_decl(decl):
    m = re.match(r"^(?P<base>.*?)(?P<stars>\*{0,}) *(?P<name>\w+)(?P<dims>(?:\[[^\]]*\])*)$", decl.strip(), re.S)
    return m.group("base").strip(), m.group("stars"), m.group("name"), m.group("dims")

def cpp_type(base, stars):
    t = retype(base)
    for _ in stars: t = "NP<%s>" % t
    return t

def parse_externs(text):
    """name -> (cpp type, dims, DS offset or None). Handles `extern T a, *b; /* DS:0x1, 0x2 */` and one-comment-per-name lists."""
    res = {}
    for m in re.finditer(r"\bextern\b([^;]*);[ \t]*(/\*[^\n]*?\*/)?", text):
        stmt = m.group(1)
        comments = re.findall(r"/\*.*?\*/", stmt, re.S) + ([m.group(2)] if m.group(2) else [])
        stmt_nc = re.sub(r"/\*.*?\*/", "", stmt, flags=re.S)
        decls = [d for d in stmt_nc.split(",") if d.strip()]
        if "(" in stmt_nc: continue
        offs = [x for c in comments for x in re.findall(r"\b0x[0-9a-fA-F]+", c)][:len(decls)]   # in order, one per name
        try: base, stars, name, dims = split_decl(decls[0])
        except AttributeError: continue
        for k, d in enumerate(decls):
            if k:
                dm = re.match(r"^\s*(\**)\s*(\w+)((?:\[[^\]]*\])*)\s*$", d)
                if not dm: continue
                stars, name, dims = dm.groups()
            off = int(offs[k], 16) if k < len(offs) else None
            res[name] = (cpp_type(base, stars), dims, off)
    return res

CSV_TYPES = {"int": "s16", "uint": "u16", "uint8": "u8", "long": "s32", "seg": "u16", "char": "s8", "uint8*": "NP<u8>", "char*": "NP<s8>", "seg*": "NP<u16>"}
CSV_TYPES.update(R["csv_types"])
def csv_type(g):
    t, size = g["type"], g["size"]
    m = re.match(r"^(\w+\*?)\[(0x[0-9a-f]+|\d+)\]$", t)
    dims = ""
    if m: t, dims = m.group(1), "[%d]" % int(m.group(2), 0)
    if t in CSV_TYPES: return CSV_TYPES[t], dims
    return {1: "u8", 2: "u16", 4: "u32"}.get(size, "u8"), (dims or ("[%d]" % size if size not in (1, 2, 4) else ""))

def macro(name, typ, dims, off):
    if dims == "[]": dims = "[0x4000]"
    ptr = "%s(*)%s" % (typ, dims) if dims else "%s*" % typ
    return "#define %s (*(%s)DSMEM(0x%x))" % (name, ptr, off)

SHIM_HELPERS = {"LXMUL", "LDIV", "LMOD", "LUDIV", "LUMOD", "LXLSH", "LXURSH", "LXRSH", "sizeof"}

def convert_unit(sig, body, filetext, which, name, globs):
    """One C function -> dict(ret_cpp, ret_t, plist, pinfo, body, macros, callees, notes, errors). Shared by the function under test and
    by linked (bottom-up) callees."""
    notes, errors = [], []
    # extern declarations: file level + inside the body (removed from the body)
    ext = parse_externs(filetext)
    ext.update(parse_externs(body))
    body = re.sub(r"\bextern\b[^;]*;[ \t]*(/\*[^\n]*?\*/)?", "", body)
    body = re.sub(r"/\*.*?\*/|//[^\n]*", " ", body, flags=re.S)   # comments: words like "throw (up ...)" are not callees
    sig = re.sub(r"\b(__cdecl16far|__cdecl16near|__cdecl|far|near)\b", "", sig)
    sm = re.match(r"^(?P<ret>.*?)\b%s\s*\((?P<params>.*)\)\s*$" % re.escape(name), sig, re.S)
    ret_t = sm.group("ret").strip() or "void"
    params = [] if sm.group("params").strip() in ("", "void") else [p.strip() for p in sm.group("params").split(",")]
    plist, pinfo = [], []
    for p in params:
        base, stars, pname, dims = split_decl(p)
        t = cpp_type(base, stars)
        plist.append("%s %s" % (t, pname))
        pinfo.append(dict(name=pname, size=4 if re.search(r"\b(long|dword|u32|s32)\b", t) and not stars else 2, type=t))
    # file-level #defines the body uses (e.g. FG(x,y) tile access), transitively; they go out with the unit's macros
    fdefs = dict((m.group(1), m.group(0).strip()) for m in re.finditer(r"^#define\s+(\w+)[^\n]*", filetext, re.M))
    used, scan = [], body
    for _ in range(3):
        for dn, dt in fdefs.items():
            if dn not in [x[0] for x in used] and re.search(r"\b%s\b" % dn, scan): used.append((dn, dt)); scan += "\n" + dt
    # data far pointers in function bodies become host pointers (MK_FP -> FP in shim.h); struct fields keep FARP (structs16.h)
    body = re.sub(r"\bfar\s*\*", "*", body)
    fmacros = [retype(re.sub(r"\bfar\s*\*", "*", dt)) for dn, dt in used]
    # Ghidra: `(int)(undefined2 *)&DAT_seg_off` is the DS OFFSET of the global (address-of cast to int): a host address truncated to 16 bits would be garbage
    body = re.sub(r"\(\s*(?:int|uint|word)\s*\)\s*\(\s*undefined\d\s*\*\s*\)\s*&\s*_?DAT_%04x_([0-9a-f]{4})\b" % GHIDRA_DS, lambda m: "0x" + m.group(1), body)
    body = retype(body)
    body = re.sub(r"\(\s*(s16|u16|s32|u32|u8|s8|ushort|uint|undefined[124]|byte|word|dword)\s*\*\s*\)\s*\(", r"DSP<\1>(", body)       # Ghidra: *(int *)(expr), *(undefined2 *)(expr)
    body = re.sub(r"\(\s*(\w+)\s*\*\s*\)\s*(0x[0-9a-fA-F]+)", r"NPat<\1>(\2)", body)                    # (state_t *)0x1740
    idents = set(re.findall(r"[A-Za-z_]\w*", body + "\n".join(fmacros))) - {dn for dn, dt in used}
    macros = []
    csvmap = {g["name"]: g for g in globs}
    for gname in sorted(idents):
        if gname in ext and ext[gname][2] is not None:
            t, dims, off = ext[gname]
            macros.append(macro(gname, t, dims, off))
        elif gname in csvmap and (which == "ghidra" or gname in ext) and gname != name:
            g = csvmap[gname]; t, dims = csv_type(g)
            if g["size"] == 4 and t == "s32" and ("DAT_%04x_%04x" % (GHIDRA_DS, g["off"] + 2)) in idents:
                t = "u16"; notes.append("%s read as low word (Ghidra uses DAT +2 separately)" % gname)
            macros.append(macro(gname, t, dims, g["off"]))
        elif gname in ext:  # declared but no offset
            csvg = csvmap.get(gname)
            if csvg: t, dims = csv_type(csvg); macros.append(macro(gname, t, dims, csvg["off"]))
            else: errors.append("global %s has no DS offset" % gname)
    for pre, m in sorted(set(re.findall(r"(_?)DAT_([0-9a-f]{4})_([0-9a-f]{4})", body))) if False else sorted({(a, (b, c)) for a, b, c in re.findall(r"(_?)DAT_([0-9a-f]{4})_([0-9a-f]{4})", body)}):
        seg, off = int(m[0], 16), int(m[1], 16)
        ty = "u32" if pre else "u16"                                  # Ghidra's `_DAT_` = a 4-byte overlay of smaller symbols (far pointer / long)
        if seg == GHIDRA_DS: macros.append("#define %sDAT_%s_%s (*(%s*)DSMEM(0x%x))" % (pre, m[0], m[1], ty, off))
        elif m[0] in R.get("other_segments", {}):                      # game.json replay.other_segments: ghidra segment -> runtime segment (data outside DGROUP, e.g. a code-side table)
            macros.append("#define %sDAT_%s_%s (*(%s*)(mem + 0x%x))" % (pre, m[0], m[1], ty, int(R["other_segments"][m[0]], 16) * 16 + off))
        else: errors.append("%sDAT_%s_%s is not in DGROUP" % (pre, m[0], m[1]))
    for sm in sorted({m for m in re.findall(r"\bs_\w+?_%04x_([0-9a-f]{4})\b" % GHIDRA_DS, body)}):      # Ghidra string symbols s_<text>_<seg>_<off>: char arrays in DGROUP
        for full in sorted(set(re.findall(r"\bs_\w+?_%04x_%s\b" % (GHIDRA_DS, sm), body))): macros.append("#define %s ((char*)DSMEM(0x%s))" % (full, sm))
    macros += fmacros
    if used: notes.append("file macros used: " + ", ".join(dn for dn, dt in used))
    defined = {re.match(r"#define\s+(\w+)", m).group(1) for m in macros}
    # callees: identifier followed by '(' that is not a keyword, type, shim helper, macro, parameter or this function
    callees = [c for c in sorted(set(re.findall(r"(?<![>.\w])([A-Za-z_]\w*)\s*\(", body)))
               if c not in KEYWORDS and c not in TYPEWORDS and c not in SHIM_HELPERS and c not in defined and c != name and c not in (p["name"] for p in pinfo)]
    return dict(ret_cpp=retype(ret_t), ret_t=ret_t, plist=plist, pinfo=pinfo, body=body, macros=macros, callees=callees, notes=notes, errors=errors)

def load_linked():
    """Bottom-up callee policy: harness/games/<game>/replay/linked.txt lists functions (`name src [dir]`, src = blind|ghidra) that passed replay themselves.
    A callee listed there is compiled into the test unit from that source and really runs; any other callee is an `untestable` stub."""
    f = TWEAKS / "linked.txt"
    out = {}
    if f.exists():
        for l in f.read_text().splitlines():
            p = l.split("#")[0].split()
            if p: out[p[0]] = (p[1] if len(p) > 1 else "blind", p[2] if len(p) > 2 else None)
    return out

def convert_function(sig, body, filetext, which, fn, globs, funcs, recorded=()):
    """-> (cpp source, wrapper info dict, notes list, callee names, fatal)"""
    u = convert_unit(sig, body, filetext, which, fn["name"], globs)
    notes = u["notes"] + u["errors"]
    pinfo, ret_t, ret_cpp = u["pinfo"], u["ret_t"], u["ret_cpp"]
    ret_size = 0 if re.fullmatch(r"void", ret_t) else (4 if re.search(r"\b(long|dword)\b", ret_t) and "*" not in ret_t else 2)
    # linked callees (transitively), each with its own macros, #undef'd after its definition so names cannot leak into other units
    linked, todo, units, stubs = load_linked(), list(u["callees"]), {}, []
    while todo:
        c = todo.pop(0)
        if c in units or c == fn["name"]: continue
        if c in linked:
            lw, ldir = linked[c]
            f, text, start = find_source(c, lw, ldir and ROOT / ldir)
            if f is None: notes.append("linked callee %s: no source in %s" % (c, lw)); units[c] = None; continue
            csig, cbody = extract(text, start)
            cu = convert_unit(csig, cbody, text, lw, c, globs); cu["src"] = str(f.relative_to(ROOT))
            units[c] = cu; todo += cu["callees"]; notes.append("linked callee %s from %s (bottom-up)" % (c, cu["src"])); notes += cu["errors"]
        else: units[c] = None
    callees = sorted(units)
    for c in callees:
        if units[c] is None and c in recorded:   # recorded-effect stub: runner checks args, applies the callee's captured memory delta
            # typed from the callee's own C signature when there is one (a host `int` literal is 32 bit; the 16-bit param type decides the words)
            cf, ct, cs = find_source(c, which)
            plist = ""
            def callargs(bodytext, cname):                          # most arguments any call of `cname` in the function under test passes
                best = 0
                for m in re.finditer(r"\b%s\s*\(" % re.escape(cname), bodytext):
                    depth, i, n_, seen = 1, m.end(), 0, False
                    while i < len(bodytext) and depth:
                        ch = bodytext[i]
                        if ch == "(": depth += 1
                        elif ch == ")": depth -= 1
                        elif ch == "," and depth == 1: n_ += 1
                        elif not ch.isspace() and depth == 1: seen = True
                        i += 1
                    best = max(best, n_ + 1 if seen else 0)
                return best
            if cf:
                csig = re.sub(r"\b(__cdecl16far|__cdecl16near|__cdecl|far|near)\b", "", extract(ct, cs)[0])
                pm = re.search(r"\b%s\s*\((.*)\)\s*$" % re.escape(c), csig, re.S)
                ps = [] if not pm or pm.group(1).strip() in ("", "void") else [x.strip() for x in pm.group(1).split(",")]
                if callargs(u["body"], c) > len(ps): cf = None; notes.append("callee %s: call site passes more arguments than its recovered signature: untyped stub" % c)   # Ghidra signature recovery differs per call site
            if cf:
                plist = ", ".join("%s a%d" % (cpp_type(*split_decl(x)[:2]), i) for i, x in enumerate(ps))
                head, words = "RetV %s(%s)" % (c, plist), "".join("argwords(p, a%d); " % i for i in range(len(ps)))
            else:
                head, words = "template<class... A> RetV %s(A... a)" % c, "(argwords(p, w16(a)), ...); "
            stubs.append("%s { u16 w[16], *p = w; %su32 r = 0; if (!g_effect || g_effect(\"%s\", p - w, w, &r)) throw Untestable{0, 0, \"%s\"}; return RetV{r}; }"
                         % (head, words, c, c))
            notes.append("callee %s: recorded-effect stub (%s)" % (c, "signature from " + os.path.relpath(cf, ROOT) if cf else "untyped, low words only"))
        elif units[c] is None: stubs.append("template<class... A> Any %s(A...) { throw Untestable{0, 0, \"%s\"}; }" % (c, c))
    linked_src = ["%s %s(%s);" % (cu["ret_cpp"], c, ", ".join(cu["plist"])) for c, cu in units.items() if cu]
    if linked_src: linked_src.insert(0, "%s %s(%s);" % (ret_cpp, fn["name"], ", ".join(u["plist"])))   # a linked callee may call back (recursion)
    for c, cu in units.items():
        if not cu: continue
        linked_src += ["// ---- linked callee %s (%s)" % (c, cu["src"])] + cu["macros"] + ["%s %s(%s)" % (cu["ret_cpp"], c, ", ".join(cu["plist"])), cu["body"]]
        linked_src += ["#undef %s" % re.match(r"#define\s+(\w+)", m).group(1) for m in cu["macros"]]
    # entry wrapper: arguments from the captured stack (cdecl: first arg at SP+4 for far, SP+2 for near)
    args, off = [], 0
    for p in pinfo:
        if p["type"].startswith("NP<"): args.append("NPat<%s>(STACK16(sp, base + %d))" % (p["type"][3:-1], off))
        else: args.append("(%s)STACK16(sp, base + %d)" % (p["type"], off) if p["size"] == 2 else "(%s)(STACK16(sp, base + %d) | ((u32)STACK16(sp, base + %d) << 16))" % (p["type"], off, off + 2))
        off += p["size"]
    wrapper = ['extern "C" int replay_entry(u16 sp, int base, u32 *ret, u16 *untest) {',
               '  try {',
               ('    %s r = %s(%s); *ret = (u32)r;' if ret_size else '    %s(%s); *ret = 0;') % ((ret_cpp, fn["name"], ", ".join(args)) if ret_size else (fn["name"], ", ".join(args))),
               '    return 0;',
               '  } catch (Untestable &u) { untest[0] = u.seg; untest[1] = u.off; strncpy((char*)(untest + 2), u.name ? u.name : "", 60); return 1; }',
               '}']
    wrapper += ['extern "C" void __gcov_dump(void);', 'extern "C" void replay_cov_dump(void) { __gcov_dump(); }'] if COV else []
    src = "\n".join([
        "#define SHIM_IMPL", '#include "%s"' % (ROOT / "harness/shim.h"), '#include "%s"' % "STRUCTS_H_PLACEHOLDER",
        "// ---- callees: untestable stubs"] + stubs + linked_src +
        ["// ---- globals (DS offsets from the source's extern comments / blind/globals.csv)"] + u["macros"] +
        ["// ---- function", "%s %s(%s)" % (ret_cpp, fn["name"], ", ".join(u["plist"])), u["body"], "", "// ---- entry"] + wrapper) + "\n"
    return src, dict(ret_size=ret_size, args_bytes=off, params=pinfo), notes, callees, bool(u["errors"])

def tweak_counts(off, which="blind"):
    h = TWEAKS / ("%05x.h" % off); p = TWEAKS / ("%05x_%s.patch" % (off, which))
    if not p.exists(): p = TWEAKS / ("%05x.patch" % off)
    nh = sum(1 for l in h.read_text().splitlines() if l.strip() and not l.strip().startswith("//")) if h.exists() else 0
    npch = sum(1 for l in p.read_text().splitlines() if l[:1] in "+-" and l[:3] not in ("+++", "---")) if p.exists() else 0
    return nh, npch

COV = os.environ.get("REPLAY_COV")          # 1: build with --coverage and report gcov branch coverage of the function under test
MUTATE = os.environ.get("REPLAY_MUTATE")   # "old=>new": self-test, the verdict must flip to FAIL

def build(fn, which, builddir, globs, funcs, srcdir=None, recorded=()):
    off = fn["off"]; tag = "%05x_%s" % (off, which)
    f, text, start = find_source(fn["name"], which, srcdir)
    if f is None: return None, "no source for %s in %s" % (fn["name"], which)
    sig, body = extract(text, start)
    src, info, notes, callees, fatal = convert_function(sig, body, text, which, fn, globs, funcs, recorded)
    builddir.mkdir(parents=True, exist_ok=True)
    sh = builddir / "structs16.h"; sh.write_text(convert_structs())
    src = src.replace("STRUCTS_H_PLACEHOLDER", str(sh))
    ov = TWEAKS / ("%05x.h" % off)
    if ov.exists(): src = src.replace("// ---- globals", '#include "%s"\n// ---- globals' % ov, 1)
    if MUTATE: a_, b_ = MUTATE.split("=>"); assert a_ in src, "mutation target not found"; src = src.replace(a_, b_, 1); tag += "_mut"
    cpp = builddir / (tag + ".cpp"); cpp.write_text(src)
    pf = TWEAKS / ("%05x_%s.patch" % (off, which))   # source-specific tweak first (a ghidra patch must not hit the blind C)
    if not pf.exists(): pf = TWEAKS / ("%05x.patch" % off)
    if pf.exists():
        r = subprocess.run(["patch", "-s", str(cpp), str(pf)], capture_output=True, text=True)
        if r.returncode: return None, "patch failed: " + r.stdout + r.stderr
    so = builddir / (tag + ".so")
    t0 = time.time()
    if COV:   # branch coverage of the replayed C (gcov), separate compile so the .gcno/.gcda names are predictable
        obj = builddir / (tag + ".o"); (builddir / (tag + ".gcda")).unlink(missing_ok=True)
        r = subprocess.run(["g++", "-std=c++20", "-O0", "--coverage", "-c", "-fPIC", "-fpermissive", "-w", "-o", str(obj), str(cpp)], capture_output=True, text=True)
        if not r.returncode: r = subprocess.run(["g++", "-shared", "--coverage", "-o", str(so), str(obj)], capture_output=True, text=True)
    else:
        r = subprocess.run(["g++", "-std=c++20", "-O1", "-shared", "-fPIC", "-fpermissive", "-w", "-o", str(so), str(cpp)], capture_output=True, text=True)
    if r.returncode:
        miss = sorted(set(re.findall(r"'(\w+)' was not declared", r.stderr)))
        msg = ("unresolved: " + ", ".join(miss)) if miss else r.stderr.strip().splitlines()[0:6]
        return None, "compile failed (%s): %s" % (cpp, msg)
    return dict(so=so, cpp=cpp, src=f, info=info, notes=notes, callees=callees, ctime=time.time() - t0, fatal=fatal), None

# ------------------------------------------------------------------ replay + compare
class Labeler:
    def __init__(self, globs):
        self.globs = sorted(globs, key=lambda g: g["off"]); self.st = struct_layouts()
        self.tmap = dict(R["label_types"])
    def label(self, ds, a):
        if a < 0x500: return "BIOS data 0040:%04x" % (a - 0x400)
        o = a - ds * 16
        if not 0 <= o < 0x10000: return "mem %05x" % a
        best = None
        for g in self.globs:
            sz = g["size"] or 2
            if g["off"] <= o < g["off"] + sz: best = g
        if not best: return "DS:%04x" % o
        rel = o - best["off"]; t = self.tmap.get(best["type"]) or self.tmap.get(re.sub(r"\[\d+\]", "", best["type"]))
        s = "DS:%04x %s" % (o, best["name"])
        if t in self.st:
            size, fields = self.st[t]
            idx, r2 = divmod(rel, size) if best["size"] > size else (None, rel)
            fld = next((f"{n}" for n, fo, fs in fields if fo <= r2 < fo + fs), "?")
            s = "DS:%04x %s%s.%s" % (o, best["name"], "[%d]" % idx if idx is not None else "", fld)
        elif rel: s += "+%d" % rel
        return s

def masked(ds, ss, sp_entry, argbytes):
    # dead stack below the entry SP (callees' frames; the host function pushes nothing), the return address and the argument slots
    m = [(ss * 16 + sp_entry - STACK_BELOW, ss * 16 + sp_entry + 4 + argbytes, "stack below/at args (callee-owned)")]
    for e in ASYNC_MASK:
        if e[0] == "DS": m.append((ds * 16 + e[1], ds * 16 + e[2], e[3]))
        else: m.append((e[0], e[1], e[2]))
    return m

def run_function(fn, which, capdir, builddir, globs, funcs, verbose=False, load_segment=None, srcdir=None):
    out = dict(fn=fn["name"], off=fn["off"], results=[], tweaks=tweak_counts(fn["off"], which))
    t0 = time.time()
    d = capdir / ("%05x" % fn["off"])
    byoff = {f["off"]: f["name"] for f in funcs}
    recorded = {byoff.get(int(c["fn"], 16), c["fn"]) for cf in d.glob("*.callees.json") for c in json.loads(cf.read_text())}
    if (d / "meta.json").exists(): recorded |= {byoff.get(int(c, 16), c) for c in json.loads((d / "meta.json").read_text()).get("callees_recorded", [])}
    sf, stext, sstart = find_source(fn["name"], which, srcdir)
    if stext is not None:                                          # DOS/BIOS interrupts (swi) and port I/O cannot be replayed: say so instead of a compile failure
        body = extract(stext, sstart)[1]
        if re.search(r"\bswi\(|\bin\(|\bout\(|\bIN\(|\bOUT\(", body): out["build_s"] = 0; out["verdict"] = "UNTESTABLE: the function uses a DOS/BIOS interrupt or port I/O (swi/in/out), outside the capture model"; return out
    b, err = build(fn, which, builddir, globs, funcs, srcdir, recorded)
    out["build_s"] = round(time.time() - t0, 2)
    if err: out["verdict"] = "BUILD-FAIL: " + str(err); return out
    out["src"] = os.path.relpath(b["src"], ROOT); out["callees"] = b["callees"]; out["notes"] = b["notes"]
    lib = ctypes.CDLL(str(b["so"]))
    mem = (ctypes.c_uint8 * (1 << 20)).in_dll(lib, "mem")
    gds, gss, ges, gbx = (ctypes.c_uint16.in_dll(lib, n) for n in ("g_DS", "g_SS", "g_ES", "g_BX"))
    lib.replay_entry.argtypes = [ctypes.c_uint16, ctypes.c_int, ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p]
    queue, why, cf_exists = [], [""], [False]
    CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.POINTER(ctypes.c_uint16), ctypes.POINTER(ctypes.c_uint32))
    def effect(name, nw, words, ret):
        name = name.decode(); w = list(words[:nw])
        if not queue: why[0] = ("callee sequence differs: host calls %s, the original made no (more) recorded calls" % name) if cf_exists[0] else "%s called but the capture has no recorded callees" % name; return 1
        rec = queue.pop(0); rn = byoff.get(int(rec["fn"], 16), rec["fn"])
        if rn != name or rec["args"][:nw] != w:
            why[0] = "callee sequence differs: host %s(%s), original %s(%s)" % (name, ",".join("%x" % x for x in w), rn, ",".join("%x" % x for x in rec["args"][:max(nw, 2)])); return 1
        for a_, h in rec["delta"]: bb = bytes.fromhex(h); ctypes.memmove(ctypes.addressof(mem) + a_, bb, len(bb))
        ret[0] = rec["ax"] | rec["dx"] << 16; return 0
    cb = CB(effect)
    if recorded: ctypes.c_void_p.in_dll(lib, "g_effect").value = ctypes.cast(cb, ctypes.c_void_p).value
    if not (d / "meta.json").exists(): out["verdict"] = "NO-CAPTURE: run harness/capture.py --fn 0x%05x first" % fn["off"]; return out
    meta = json.loads((d / "meta.json").read_text()); load_segment = meta.get("load_segment", 0x822)
    lab = Labeler(globs)
    pf = TWEAKS / ("%05x.poison" % fn["off"])   # lines: "0x8e68 2" = DS offset, length; "arg0+0x38 2" = near-pointer arg 0 + offset
    poison = [(l.split()[0], int(l.split()[1], 0)) for l in pf.read_text().splitlines() if l.strip() and l[0] != "#"] if pf.exists() else []
    out["poison"] = poison
    n = 0
    while (d / ("%d.regs.json" % n)).exists():
        regs = json.loads((d / ("%d.regs.json" % n)).read_text())
        before = gzip.open(d / ("%d.before.bin.gz" % n)).read(); after = gzip.open(d / ("%d.after.bin.gz" % n)).read()
        e, x = regs["entry"], regs["exit"]
        ctypes.memset(mem, 0, 1 << 20); ctypes.memmove(mem, before, len(before))
        for po, pn in poison:   # host-only: overwrite what the function must recompute, so a no-op cannot pass
            m_ = re.fullmatch(r"arg(\d+)\+(\w+)", po)
            if m_: k_ = e["SS"] * 16 + e["SP"] + (4 if regs["ret_kind"] == "far" else 2) + 2 * int(m_[1]); o_ = (before[k_] | before[k_ + 1] << 8) + int(m_[2], 0)
            else: o_ = int(po, 0)
            ctypes.memset(ctypes.addressof(mem) + e["DS"] * 16 + o_, 0xA5, pn)
        gds.value, gss.value, ges.value, gbx.value = e["DS"], e["SS"], e["ES"], e["BX"]   # BX: Ghidra `in_BX` register inputs
        ret = ctypes.c_uint32(0); ub = ctypes.create_string_buffer(64)
        base = 4 if regs["ret_kind"] == "far" else 2
        cf = d / ("%d.callees.json" % n); queue[:] = json.loads(cf.read_text()) if cf.exists() else []; why[0] = ""; cf_exists[0] = cf.exists()
        signal.alarm(30)
        st = lib.replay_entry(e["SP"], base, ctypes.byref(ret), ub)
        signal.alarm(0)
        r = dict(n=n, call=regs["call"], frame=regs["frame"])
        if st:
            seg, off = ctypes.cast(ub, ctypes.POINTER(ctypes.c_uint16))[0:2]
            nm = ub.raw[4:].split(b"\0")[0].decode()
            if not nm:
                img = ((seg - load_segment) * 16 + off) & 0xfffff
                f = next((f for f in funcs if f["off"] == img), None)
                nm = f["name"] if f else "image 0x%05x" % img
            r.update(status="untestable", detail="untestable: calls %s" % nm + (" (%s)" % why[0] if why[0] else ""))
            if why[0].startswith("callee sequence differs"): r.update(status="FAIL", detail=why[0])
        else:
            after_mem = bytes(mem[:len(after)]) if False else ctypes.string_at(mem, len(after))
            mk = masked(e["DS"], e["SS"], e["SP"], b["info"]["args_bytes"])
            diffs = [i for i in range(len(after)) if after_mem[i] != after[i] and not any(a <= i < z for a, z, _ in mk)] if after_mem != after else []
            r["changed"] = sum(1 for i in range(len(after)) if before[i] != after[i] and not any(a <= i < z for a, z, _ in mk)) if before != after else 0
            ret_ok = True; rdetail = ""
            rs = b["info"]["ret_size"]
            if rs:
                exp = x["AX"] | ((x["DX"] << 16) if rs == 4 else 0); got = ret.value & (0xffffffff if rs == 4 else 0xffff)
                ret_ok = exp == got
                if not ret_ok: rdetail = "return %s expected 0x%x got 0x%x" % ("DX:AX" if rs == 4 else "AX", exp, got)
            if queue: rdetail += "; %d recorded callee call(s) not made by the host (first %s)" % (len(queue), byoff.get(int(queue[0]["fn"], 16)))
            if diffs or not ret_ok or queue:
                r["status"] = "FAIL"
                parts = []
                shown = 0
                for i in diffs:
                    if shown >= (12 if verbose else 4): break
                    parts.append("%s: exp %02x got %02x" % (lab.label(e["DS"], i), after[i], after_mem[i])); shown += 1
                r["detail"] = "%d byte(s) differ%s%s" % (len(diffs), ("; " + "; ".join(parts)) if parts else "", ("; " + rdetail) if rdetail else "")
                r["ndiff"] = len(diffs)
            else:
                r["status"] = "PASS"; r["detail"] = ""
        out["results"].append(r); n += 1
    c = {k: sum(1 for r in out["results"] if r["status"] == k) for k in ("PASS", "FAIL", "untestable")}
    if COV: out["coverage"] = coverage(lib, b, fn["name"])
    out["counts"] = c; out["total_s"] = round(time.time() - t0, 2)
    tot = len(out["results"])
    out["changed"] = sum(r.get("changed", 0) for r in out["results"])
    if c["FAIL"]: out["verdict"] = "FAIL %d/%d (pass %d, untestable %d)" % (c["FAIL"], tot, c["PASS"], c["untestable"])
    elif c["PASS"] == 0 and c["untestable"]: out["verdict"] = "UNTESTABLE %d/%d" % (c["untestable"], tot)
    elif c["untestable"]:
        out["verdict"] = "PASS on %d/%d, %d untestable (callee reached)" % (c["PASS"], tot, c["untestable"])
        if out["changed"] == 0 and not poison: out["verdict"] += " (WEAK: no unmasked byte changed in the passing captures)"
    else:
        out["verdict"] = "PASS %d/%d" % (c["PASS"], tot)
        if out["changed"] == 0 and not poison: out["verdict"] += " (WEAK: the original changed no unmasked byte in any capture, only the return value/no-op was checked)"
    return out

def coverage(lib, b, name):
    """gcov branch/line coverage of `name` over all replayed captures (only calls that ran on the host, untestable ones stop at the callee)."""
    lib.replay_cov_dump()
    r = subprocess.run(["gcov", "-b", "-f", "-n", "-o", str(b["so"].parent), b["cpp"].name], cwd=b["so"].parent, capture_output=True, text=True)
    m = re.search(r"Function '(?:_Z\d+)?%s[^']*'\n(.*?)\n\n" % re.escape(name), r.stdout, re.S)   # plain or mangled (_Z14name...)
    if not m: return "n/a"
    g = dict(re.findall(r"(Lines executed|Taken at least once):\s*([\d.]+% of \d+)", m.group(1)))
    return "lines %s, branches taken %s" % (g.get("Lines executed", "?"), g.get("Taken at least once", "no branches"))

def report(o):
    print("== %s 0x%05x  src=%s  tweaks(h/patch lines)=%s  callees=%s  build=%.1fs total=%.1fs" % (o["fn"], o["off"], o.get("src", "-"), "%d/%d" % o["tweaks"], ",".join(o.get("callees", [])) or "-", o["build_s"], o.get("total_s", o["build_s"])))
    for n in o.get("notes", []): print("   note:", n)
    if o.get("coverage"): print("   coverage (gcov, host replay):", o["coverage"])
    if o.get("poison"): print("   poisoned before replay (host only):", ", ".join("%s len %d" % p for p in o["poison"]))
    for r in o.get("results", []):
        if r["status"] != "PASS" or r["n"] < 2: print("   cap %02d call %d frame %d: %s %s" % (r["n"], r["call"], r["frame"], r["status"], r["detail"]))
    print("VERDICT %s: %s  [original changed %d unmasked bytes in total across captures]" % (o["fn"], o["verdict"], o.get("changed", 0)))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fn", nargs="*", help="image_offset(s) like 0x01000")
    ap.add_argument("--src", default="blind", choices=["blind", "ghidra"])
    ap.add_argument("--captures", default=str(ROOT / "captures"))
    ap.add_argument("--build", default=str(ROOT / "runs/replay_build"))
    ap.add_argument("--src-dir", help="directory of .c files to use instead of blind/decomp (e.g. a fixed copy); --src still picks the dialect")
    ap.add_argument("-v", action="store_true")
    ap.add_argument("--game", default=GAME)
    a = ap.parse_args(); configure(a.game)
    funcs, globs = load_functions(), load_globals()
    by = {f["off"]: f for f in funcs}
    for s in a.fn:
        fn = by[int(s, 16)]
        report(run_function(fn, a.src, Path(a.captures), Path(a.build), globs, funcs, a.v, srcdir=a.src_dir and Path(a.src_dir).resolve()))

if __name__ == "__main__":
    main()
