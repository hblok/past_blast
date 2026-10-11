# harness

Library `dbx.py` (debugger driver), recorder `run.py`, input scripts `script.py`, diff `compare.py`, screen capture `ega.py`, function capture `capture.py`. Per-game data in `games/<game>/`. History and numbers: `LESSONS.md` (M3.x, M6.2a).

## Layout and adding a game (M7.2)

Generic (no game names in the code): `dbx.py`, `run.py`, `script.py`, `compare.py`, `ega.py`, `capture.py`, `replay.py`, `shim.h`. Every script takes `--game <name>` (default `mygame`; `HARNESS_GAME` sets the default for `replay.py`). Everything per game lives in `harness/games/<game>/`:

    game.json            cycles, load_segment, exes (path, rundir, dos_cmd, frame_hook cs/ip/ds/signature, state_map), keyboard (table addr, stride,
                         scancodes, last_scan), startups (recipes), replay (below)
    <exe>.state.json     state map: fields to record, compare_mask, align.write, clock_lock, expect checks
    scenarios/*.txt      input scripts (frame: +Key -Key shot set:OFF=HEX end)
    replay/              per-function tweaks: <off>.h, <off>[_ghidra].patch, <off>.poison, linked.txt (bottom-up callees)

`game.json` "replay" section (read by replay.py and capture.py): `functions_csv` (columns image_offset,size,name,...), `globals_csv`, `structs_h`, `decomp_dir`, `ghidra_dir`, `tweaks_dir`, `ghidra_ds` (Ghidra's data segment, for `DAT_xxxx_yyyy` names), `struct_sizes` (static_assert per struct), `struct_guard` (include guard of structs_h), `csv_types` / `label_types` (game struct names for globals.csv types and for labelling diffs), `async_mask` (bytes that change asynchronously: BIOS tick, timer words).

Per-compiler assumption that is NOT yet configurable: `shim.h`/`replay.py` assume the Borland medium memory model, cdecl with the caller popping, SS == DS, far game functions with near data pointers (see `capture.py` `runtime` note). A game built with another model/compiler needs those changed (a `replay.model` section is the obvious next step; not done, no second game yet).

To start a new game: copy `games/mygame/game.json` and `<exe>.state.json` as templates, empty the exe/state values, then find them in this order (LESSONS "Finding the frame point without source"): load segment, frame hook, key table + last-scan word, 3-5 state fields, start-up recipe, `align.write`. Verified only on Keen Dreams.

## capture.py: per-function memory/register captures (M6.2a)

    python3 harness/capture.py --fn 0x01400 --script harness/games/mygame/scenarios/walk_jump.txt -n 20 --out captures [--every K] [--ret auto|near|far]

`--fn` is an image_offset (as in `blind/functions.csv`) or a runtime `seg:off` (`1c08:0a3c`); runtime = image + `load_segment` (0x822, `game.json`). The scenario runs exactly like `run.py` (start-up, frame-0 alignment, clock lock, input at the frame hook). Breakpoint at the entry; per hit: registers + 640 KB memory (0000:0000..9FFFF, whole conventional memory, no sub-setting needed: a dump is one request, ~50 ms), return address from the stack, temp breakpoint there (SP must equal entry SP + 4 far / + 2 near, so recursion and nested calls pair up), registers + memory again. Calls whose before-image equals an earlier one are skipped; `--every K` takes every K-th call (spread over the scenario); the run stops when `-n` captures are stored (or the script ends). `--ret auto` reads the last byte of the function (size from `blind/functions.csv`): C3 = near, else far (the exe is medium model: game functions are far, retf).

Output (`captures/` is not in .gitignore; ~0.4 MB per capture, do not commit):

    captures/<image_offset, 5 hex>/<n>.before.bin.gz   memory at entry (SS:SP -> return address, then the arguments)
                                  <n>.after.bin.gz    memory right after the return (SP = entry SP + 4)
                                  <n>.regs.json       call (call number in scenario), frame (hook frame running), depth (nesting), ret {cs,ip}, entry/exit regs
                                                      (AX BX CX DX SI DI BP SP IP CS DS ES SS FLAGS, ints), sha256 of both images
                                  meta.json           exe md5, scenario text, startup, runtime CS/DS/SS, load segment, counts, timings, sizes, run dir
                                  capture.log, _run/  debugger stop log and the underlying run.py run directory (manifest, state.jsonl)
    captures/index.json                               image_offset -> name, count, scenario, ret kind, exe md5, bytes per capture

Images are raw bytes; address = seg*16+off. gzip with mtime 0, so equal images are equal files. Not done (TODO): port IN/OUT and INT log between entry and return (no port breakpoints in the debugger; `LOG n` per call is far too slow); captures are therefore only for functions without hardware access, or judged by their memory effect. Image size could drop ~100x with one base image plus sparse deltas (consecutive images differ in tens of bytes); not needed yet.

## shim.h + replay.py: host replay of decompiled functions (M6.2b)

    python3 harness/replay.py 0x01000 [0x01200 ...] [--src blind|ghidra] [-v]     # needs captures/<fn>/ from capture.py
    REPLAY_MUTATE='old=>new' python3 harness/replay.py 0x01600                    # self-test: a deliberate bug must give FAIL

What it does per function (image_offset from `blind/functions.csv`):
1. Finds the function in `blind/decomp/*.c` (`--src blind`, default) or `blind/decomp/ghidra_typed/*.c` and cuts out its text.
2. Converts mechanically (visible result: `runs/replay_build/<off>_<src>.cpp`, plus `structs16.h`): `int/long/unsigned` to `s16/s32/u16/u32`; struct pointers to `NP<T>` (16-bit near offset, so `obj_t` stays 0x4c bytes; `static_assert`ed) and far code pointers to `FARP`; each global the body uses becomes `#define name (*(T*)DSMEM(0xOFF))` (offset from the `/* DS:0x.. */` comment of the file's `extern` line, else from `blind/globals.csv` by name; Ghidra style `DAT_33f5_xxxx` and `*(int *)(expr)` DS-offset derefs handled); calling-convention keywords (`__cdecl16far far near`) are empty macros; arguments are read from the captured stack (`SS:SP+4...`, cdecl; sizes from the C signature); every other callee becomes a stub that throws `Untestable`.
3. `g++ -shared`, loaded with ctypes. Per capture: before image into `mem[]` (the 640 KB, DS/SS/ES from the capture), call, compare all of `mem` with the after image and AX (DX:AX for long) with the exit registers.
4. Masks (not compared): dead stack `[SP-0x200, SP+4+args)`, BIOS tick `0040:006C`, its DS copy `DS:0096`, timer words `DS:E76C`, `DS:E782`. The cross-run list from LESSONS (rnd index, top of stack, scroll words) is NOT needed: replay starts from the capture's own before image, so only bytes the original really changed can differ.
5. Output: per capture PASS / FAIL (first differing bytes, labelled from `globals.csv` + `structs.h` field layout, e.g. `DS:7006 object_array[0].y: exp 0f got 4f`) / `untestable: calls X` (a callee or a far-pointer call such as `state->think` was reached on that capture; X is resolved through `functions.csv`), and a VERDICT line. A function that is called by no capture, or never changes any unmasked byte, is flagged WEAK.

Manual tweaks stay visible and are counted in the report (`tweaks(h/patch lines)`): `harness/games/<game>/replay/<off>.h` (extra includes/macros, put before the globals), `harness/games/<game>/replay/<off>.patch` (unified diff applied to the generated .cpp), `harness/games/<game>/replay/<off>.poison` (lines `0xDSOFF len`: bytes overwritten with 0xA5 in the HOST copy of the before image only, so a function whose result is already in the before image cannot pass by doing nothing). `<off>` = 5 hex digits.

Limits (all reported as failure or `untestable`, never hidden): callees are not run (no recorded-effect stubs yet; bottom-up means leaves and functions whose callee is not reached in a capture); Borland `LXMUL@`-style register helpers appear in Ghidra output as `LXMUL_at()` without arguments and are not implementable (the shim has the explicit-argument forms `LXMUL LDIV LUDIV LXLSH LXURSH` for hand tweaks; blind C uses plain C `long`, which is native); 16-bit `int` promotion: expressions are evaluated in 32 bit and wrap only when stored to an `s16`/`u16`, as in C on the original compiler for stored results but NOT for comparisons of an unstored 16-bit sum (see LESSONS M6.2b); no port I/O, `int86`, or EGA planes (capture.py has no I/O log yet).

## M6.2c additions (verify1; details LESSONS "Verification pilot (M6.2c)")

- Callee policies in replay.py, in this order: (1) **bottom-up**: a callee listed in `harness/games/<game>/replay/linked.txt` (`name src [dir]`, only after it passed itself) is compiled into the unit and runs; (2) **recorded effect**: if the captures were made with `capture.py --callees 0x047d4,...`, each listed callee's calls inside the target call are stored in `<n>.callees.json` (8 argument words, sparse memory delta, DX:AX) and the stub checks the arguments, applies the delta and returns DX:AX; a different or missing call sequence is a FAIL (the host calling a callee the original did not call is a mismatch); (3) otherwise `untestable`.
- `REPLAY_COV=1` adds gcov line/branch coverage of the function under test; `--src-dir DIR` replays a fixed copy; tweak patches can be source-specific (`<off>_ghidra.patch`); poison lines may be relative to a near-pointer argument (`arg0+0x38 2`).
- Inputs that gameplay never produces: script item `set:OFF=HEX` (DGROUP write at a frame, state injection, e.g. score near a threshold) and `capture.py --entry-set OFF=HEX` (write at each captured entry before the dump, input perturbation). Both keep each capture self-consistent; say so in the scenario header.
- Converter: file-level `#define`s used by a body are carried along; `far *` data pointers in bodies are host pointers (`MK_FP` = `FP`); comments are stripped before the callee scan.

## Added on the second game (Wolfenstein 3D, 2026-10): what a new game config can now use
- `vga.py` (video): `game.json` `"video": "vga"` selects it; mode 13h and unchained "mode X" (4 planes, CRTC start/stride), palette from the DAC with caching. `ega.py` stays the default.
- `run.py` determinism levers: per-exe `hook_from_start` (the frame-hook breakpoint is set before the program starts, so frame 0 is the first frame of the level, not a wall-clock-dependent hook) and `boot_patches` (patch the running program at the first hit of a breakpoint after checking the expected bytes; used to NOP the clock-derived RNG seed). `data_files` lists files md5'd into the manifest.
- State map fields may carry `"seg": "0xSEG"`: read from an absolute runtime segment instead of DGROUP (the RNG index lives in a code-side data segment, invisible to DGROUP dumps). Record the RNG index per frame: it is the earliest sign of a desync.
- Large per-frame fields are fine (a 60-object actor list = 3.6 KB per frame): record raw object lists, decode on the host.
- `capture.py`: `--ret near` / near callees as `--callees 0x1234:n`, `--from-frame N`, pending-depth and per-frame hot-path guards that abort with a diagnosis, SIGTERM unwinding so `timeout` kills the emulator. Check the function's last byte (C3 near, CB far) before any capture: a wrong return kind looks like a hang.
- `replay.py`: `g_BX` register inputs, Ghidra `_DAT_` (4-byte overlays), `undefined2` derefs, string symbols, `other_segments` for data outside DGROUP, call-site argument-count check for callee stubs, port I/O / interrupt functions reported UNTESTABLE instead of a build failure.
- Scenarios are `frame: +Key -Key shot set:OFF=HEX` lines; several lines with the same frame number are merged. `set:` lines inject state (level warp, snap the player to a tile centre, give weapon/ammo): label such scenarios as injected.
- Do not poll with `sleep` loops: run foreground commands with a hard `timeout`, or background jobs and wait for the completion notification.
