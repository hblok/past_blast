# Workflow: AI-driven reverse engineering of a DOS game (M7.1)

2026-10-09, verify1. Distilled from `LESSONS.md`, `plans/progress.md`, `verify/m6_report.md`, `grading/report.md`, `grading/taxonomy.md`, `analysis/*`. Written for whoever starts the second game (M8). The Keen Dreams run is a rehearsal: it has the source, so every step could be graded. The steps marked **[source]** below need that answer key and have no equivalent on a game without source; everything else transfers.

Status of the evidence when this was written (honest limits): M0-M3, M5.1-M5.2, M6 done; M4 (blind decompile) is one session by one agent; M5 has one graded pass (341 functions); M6 verified 11 functions, not a module. Numbers are from that single run.

## 0. The idea in one paragraph
The AI does not need to play the game. It needs an **oracle**: the original binary running deterministically under automation, so every claim ("this function does X", "this C is equivalent") is checked against recorded behaviour instead of opinion. Understanding lives in the harness and in the verified C, not in anyone's head. Correct means *behaves and looks the same* (D4), not byte-identical (D5).

## 1. Pipeline and what each stage cost

| # | Stage | Output | Transfers? | Cost / result here |
|---|---|---|---|---|
| 1 | Environment: one idempotent `scripts/setup.sh` (emulator with debugger, decompiler, compiler if available, data) | fresh container reproduces everything | yes | ~2 GB `vendor/`; web containers may block archive.org / api.github.com (check the allowlist first) |
| 2 | Reference exe that runs **[source]** | build from source, `build_kd.sh` | no (game 2: use the shipped exe) | the hard part was not code but pairing exe with data version, a wrong `-ml` tool that silently corrupted data, DGROUP overflow |
| 3 | Characterise the binary: packer, compiler, memory model | unpacked exe, notes | yes | LZEXE found in minutes; own `unlzexe.py` (~100 lines), validate by running, not by size |
| 4 | Oracle harness (M3) | deterministic runs, frame hook, scripted input, state recording, screenshots | yes, the most reusable part | ~2 agent-days; see section 3 |
| 5 | Static analysis: Ghidra headless import, function table, library identification | `blind/functions.csv`, `modules.md` | yes | Ghidra recall 92% / precision 86% vs truth; Reko 63-73% recall, only a second opinion |
| 6 | Blind decompile: name, type, clean C, structs, asset formats | `blind/decomp/*.c`, `structs.h`, extractor | yes | one Opus session; game+asm recall 99.5%, 5 modules hand-cleaned, rest typed Ghidra output |
| 7 | Grading **[source]** | scorecard A-F, error taxonomy | partly: B-style grading needs an answer key, A/B-like checks on game 2 = M6 | 341 functions, Sonnet graders per module |
| 8 | Behavioural verification (M6) | per-function PASS/FAIL against captured memory images | yes, replaces grading when no source exists | ~5 min and 10-25k tokens per function; found 6 bugs in 11 functions |
| 9 | Whole-program host build (M6.4) | not done | yes, the end goal | dropped for this run |

## 2. Principles that held up
1. **Verify intermediates before debugging the thing built from them.** Generated OBJs vs source (M2.1), captured images vs source tables, state-map addresses vs the displayed value. A wrong tool memory model corrupted all data without a warning and cost a day.
2. **Recover the frame hook blind**, then hang everything on it: sample `CS:IP` ~300 times in gameplay; the hot spots are the retrace and tick waits; the page-flip routine's return is the hook (LESSONS M3.4). One hook = one frame = a deterministic clock for input, state and captures.
3. **Determinism is manufactured, not found.** Fixed cycles + dummy audio + all input written to the game's own key table at the hook + clock lock + frame-0 alignment (canonical clock, timers, page parity). Any clock-derived word can leak into game logic.
4. **No wall-clock input inside a compared run.** Start-up is the only wall-clock part, and it is aligned away at frame 0.
5. **A PASS is meaningless without three companions:** gcov branch coverage, at least one mutant that must flip it to FAIL, and an injected or perturbed input for anything the harness itself flattens (clock lock hides timecount/last_time; plain gameplay never leaves 16-bit arithmetic).
6. **Callees decide testability.** Link passed callees bottom-up, record the rest (`--callees`), otherwise whole functions are UNTESTABLE and look fine.
7. **Events that last one frame need every call captured.** Subsampling hid the exact bug it was meant to find.
8. **Diagnose FAILs from memory plus 16-bit disassembly of the captured code bytes**, not from source. 100-400 byte functions make this cheap and it is what transfers.
9. **Every fact goes into LESSONS.md the moment it is learned**, newest wins, commit each step. Nothing may live only in chat. Agents communicate only through git (`comms/`, one file per message, append-only logs).
10. **Hard limits on everything that can hang:** `timeout` on every emulator run, `ulimit -f/-c`, a private tmux socket (`tmux -L`), `kill -9` for the emulator, never `kill $(pgrep -f ...)` from your own shell.

## 3. Harness: what to rebuild for game 2
Game-specific (per-game config `games/<game>/game.json` + state map): frame-hook address and signature, key table address/stride/scancodes, last-scan word, start-up recipe, canonical-clock writes (`align.write`), state fields (player x/y, score, level, lives), load segment. All were **found blind** with the methods in LESSONS (diff DGROUP before/after an action, search for a displayed value).
Generic: `dbx.py` (debugger client; the stale-read race after `RUN` is handled in `step()`), `run.py` (recorder), `script.py` (`frame: +Key -Key shot set:OFF=HEX end`), `compare.py`, `ega.py` (read planes through the debugger), `capture.py`, `shim.h` + `replay.py`. Costs: 150-200 ms per frame, 7.4 s per screenshot, ~0.4 MB per capture, start-up 25-45 s per run, max ~4 parallel emulators.
Known holes: no port I/O log (hardware code out of scope for capture-replay), video planes not in the images, protocol requests are ~50 ms each.

## 4. Roles and how the work was organised
- `planner` (Opus): plan, board (`plans/milestones.md`, single writer), decisions D1-D6, designs. `build`, `harness` (Sonnet): environment, oracle. `blind1` (Opus xhigh): the decompile, in `blind/` under a read whitelist so the answer is never seen (D6: one repo, separation by discipline, enough for a game with public source; a game with no source needs no isolation machinery). `grader` (Sonnet, then Opus double check): must not be a blind agent. `verify1` (Opus): M6. `scen1` (Sonnet, offline): scenario drafting.
- **Offline drafting + local validation worked**: an agent without the emulator drafted 12 scenarios from the blind C; 4 of 4 that were run hit their targets first time. Use it for any text-only deliverable.
- Agents stop after a step: `/loop` or a Routine keeps them going; a pause file with a UTC stop time beats killing sessions. Limited-budget agents get pause times.
- Model split that worked: Opus for design, decompile reasoning and FAIL diagnosis; Sonnet for harness code, grading and bulk per-module work; Haiku for chores.

## 5. What the blind pass got wrong (and so what to check first on game 2)
From the graded pass (`grading/taxonomy.md`): 83% of bodies correct, purposes good (2.7/3), but
- **segment overrides dropped** (ES/SS/CS access shown as DS): the single biggest class, confirmed by M6 (tile flag tables live in another segment; every function using them was wrong, graders missed it once). Sweep all decompiled C for far-segment tables as soon as one is found.
- **32-bit helpers and huge-pointer arithmetic** (register-convention helpers Ghidra cannot type), hardware/DMA code, assembler modules.
- **hand-cleaning loses statements**: cleaned modules were not better than typed Ghidra output. Prefer typed output plus verification over rewriting.
- **ISR-written globals read once** (needs `volatile`).
- **Confidence labels are not calibrated**: "high = it ran" was the least reliable bucket (61.5% vs 86.8% for medium). Make "high" mean "replay PASS with coverage".
- Where it is reliable: plain 16-bit logic, control flow, constants, struct offsets, state machines. Names and summaries are more trustworthy than code details.

## 6. Verification result (M6) in numbers
11 functions replayed, 6 real bugs (4 already in grader notes before replay, 2 new), all fixed in copies and re-verified, `blind/decomp` untouched. ~5 min wall and 10-25k tokens per function once the harness exists; ~25% of functions need a fix. Branch coverage 33-81% on the best scenarios, 6-41% on a plain walk-and-jump: coverage, not tooling, is the binding limit. Details and open follow-ups: `verify/m6_report.md`.

## 7. Recipe for game 2 (no source) - updated after game 2 (Wolfenstein 3D), see `plans/transferable_lessons.md`
1. Copy the kit (`scripts/`, `harness/`, `CLAUDE.md` skeleton); write `games/<game>/game.json` empty; start `LESSONS.md` at once.
2. Unpack (check LZEXE/PKLITE first), run headless, find the frame hook by sampling, add the clock lock, prove determinism with two runs **and a full-memory diff of two runs** (RNG seed from the clock, first-hook phase, code-side data segments; `boot_patches`, `hook_from_start`, `seg` fields). Record the RNG index per frame.
3. Find input (key table) and 3-5 state fields blind. **Decode the level/map format, write the mechanics down and build a route planner with state injection (level warp, snaps) before writing scenarios**: blind key sequences never reached door or fight code.
4. Ghidra headless import, function table, library identification, name from the binary's own error strings; module clustering by call graph (segment = module in Borland medium model).
5. Decompile per module (typed output first; clean only what a reader needs); record purposes with confidence tied to replay, not to "it ran".
6. Replay verification bottom-up from leaves: check the return kind first, capture with `--callees`, dump the whole 1 MB, every call for short events, coverage and a mutant per verdict, injections for arithmetic and for states gameplay does not reach. **Budget a hand-patch step for the Ghidra dialect (lost far-pointer segments, 16-bit arithmetic, wrong callees) and expect 25-30% UNTESTABLE (hardware) and ~10% typing blocks; report them in the tally.**
7. Whenever a bug class appears, grep everything for it.
8. Without an answer key, "graded" becomes "replay PASS with coverage and a mutant"; call anything else a hypothesis.
9. **Optional, strongest evidence: reimplement the game (HTML/JS) against the oracle** and diff the object list and RNG index per frame (`plans/port_method.md`, `port_kit/`). It needs steps 2-3, not the decompile; it found more behaviour than replay verification did and leaves a playable artifact.

## 8. Not yet shown (do not claim)
- Whole-program host build of the DECOMPILE (M6.4). (A host reimplementation from behaviour, checked against the oracle, was shown on game 2: `plans/port_method.md`.)
- Verification of a whole module; scenarios for poles, ceilings, walls, death, enemy contact.
- Independence of blind pass 2 from pass 1 (the advice in `blind/BRIEFING.md` §7 came from grading pass 1).
- A protected-mode / DOS-extender exe, or a game whose engine is not a real-mode Borland build. (A game without source and a different engine were shown on game 2.) Setup in a fresh web container was never run end to end (M0.3).
- Remaining M4/M5 items: C/D/E metrics, Opus double grade, library naming 61.7% (target 70%).

## 9. Inputs for M7.2 and M7.3
- M7.2: the generic/per-game split in section 3 is the layout; the per-game parts are already in `harness/games/keen_dreams/`; the capture-replay shim assumes the Borland medium model, which is a per-compiler config.
- M7.3: candidates are Commander Keen 4-6 (same engine family, Omnispeak as behavioural reference) and Dune II (OpenDUNE). The workflow above needs only the exe, the data and a behavioural reference to cross-check function purposes. Cheapest first test: do steps 2-3 of section 7 on the next game before committing to the full pipeline.

## 10. Second game results (Wolfenstein 3D, 2026-10-09..11)
Summary of what changed; details in `plans/transferable_lessons.md` (lessons), `plans/port_method.md` (reimplementation method), `port_kit/` (code), and the Wolf repo's `LESSONS.md`.
- P0-P3 gates passed in a day (oracle in 4 h with the kit); P4: 34 functions attempted, 22 replay PASS (10 strong, 12 weak), 8 UNTESTABLE (port I/O), the two FAILs were Ghidra segment loss and were patched; P5 against id's source matched 22 of 22.
- The reimplementation (about 4,000 lines of JS including checks) was playable end to end (menu, 6 episodes of enemies and bosses, original graphics, sound, music) and matched 17 recordings frame by frame; the work found the generic traps listed in `transferable_lessons.md` section 7 and `port_method.md` section 5.
- Corrections to earlier sections: scenario authoring needs a mechanics doc and a planner (3); Ghidra typing and segment defects, not harness defects, dominate failures (5/6); hidden state of the oracle includes the sound configuration (PC speaker mode) and the RNG seed policy.
