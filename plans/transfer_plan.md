# Transfer plan: applying the workflow to a second game (M7.3 / M8)

2026-10-09, verify1, DRAFT for the user's decision (M7.3 is human + Opus). Game facts below are from memory and must be checked in prep (flagged `?`). Builds on `plans/workflow.md` (what transfers) and `plans/dos_reverse_engineering_plan.md` §6 (ladder).

## 1. What the second game must prove
1. The harness is really generic: a new frame hook, key table, state map and start-up found blind, with only `games/<game>/` written.
2. The pipeline works with no answer key: grading is replaced by replay verification (M6) plus an external behavioural reference.
3. The lessons shorten the work (compare effort per stage with Keen Dreams).
It does NOT need to be big. A small game that exercises all three beats a large one that stalls in stage 1.

## 2. Candidates (for the decision)
| Game | Genre | Answer key / reference | Engine vs Keen Dreams | Tests | Risk |
|---|---|---|---|---|---|
| Commander Keen 4 (Goodbye Galaxy, shareware ep.1 data ok `?`) | side-scroller | no official source `?`; Omnispeak reimplements 4-6 behaviour (cross-check, not an answer key) | same id library family, same compiler class `?`, EGA | no-key pipeline, generic harness, shim reuse | low; least new ground (same engine family) |
| Prince of Persia (DOS) | platformer, state machines | SDLPoP (port of the DOS version) | different engine, different compiler `?` | real generality, animation/timing state machines | medium: timing, bigger asset formats |
| Wolfenstein 3D | first-person raycaster, NOT a side-scroller | official source (answer key available again) | id library family (shared with Keen Dreams) but VGA + raycaster | video/asset formats; grading possible again | medium: rendering code is the hard part, the shim has no video |
| Dangerous Dave / Crystal Caves / similar | simple platformers | none or fan notes `?` | unknown | smoke test | unknown compiler; check first |
| Dune II | RTS | OpenDUNE | different | scale | high (agreed: too big now) |

Recommendation: **Commander Keen 4** as the M8 game. Reasons: a platform side-scroller as asked, small, the expected differences are in game code not in the toolchain, and Omnispeak gives an independent behavioural reference so "is this function right" has an answer without the source. Honest caveat: it is the least stringent test of generality (same engine family). If gate G1 below passes in under a day, take Prince of Persia or Wolfenstein 3D as M9 to stress the generic parts. Wolfenstein 3D is not a side-scroller; it is useful later because its source gives an answer key for a non-platformer engine.

## 3. Phases and gates
Each gate is a stop-or-go: record result in `LESSONS.md` and the new game's `plans/` card, then continue only if passed.

| Phase | Work (from `workflow.md` §7) | Gate | Time box |
|---|---|---|---|
| P0 Prep | new repo or directory `games/<game>` layout from M7.2; legal data; setup.sh reused; `CLAUDE.md` + `LESSONS.md` started | exe unpacked, runs headless, screenshot of title | 0.5 day |
| P1 Oracle | frame hook by CS:IP sampling, clock lock, determinism proof, key table + last-scan, 3-5 state fields, one start-up recipe, `align.write` | G1: two scripted runs identical over 400 frames in a level | 1-2 days (Keen Dreams: ~2 days with many dead ends) |
| P2 Static | Ghidra headless import, function table, library identification, module clustering | G2: function table with sane count; modules listed | 1 day |
| P3 Decompile | per-module typed C, structs, purposes; confidence tied to replay | G3: structs for object/state/input recovered and checked against memory | several sessions |
| P4 Verify | capture-replay bottom-up from leaves; every verdict has coverage + a mutant | G4: >= 20 functions replayed, bug classes catalogued | as long as budget allows |
| P5 Reference check | compare purposes/behaviour of verified functions with Omnispeak | report | 1 day |
| P6 Write-up | update `workflow.md` with what differed | go/no-go for M9 | 0.5 day |

## 4. What changes vs Keen Dreams (rules for the new run)
- No answer key: nothing may be called "correct" unless replay PASS (with coverage and a mutant) or matches an external reference with evidence. Everything else is a hypothesis.
- Do not import Keen Dreams source-level knowledge: the blind rules stay (the new run gets `workflow.md`, `harness/`, `scripts/` and generic lessons, not Keen Dreams function names, structs or addresses). The engine families overlap, so a model may recall library code; require evidence from the binary for every name.
- Ownership: the generic code (`harness/*.py`, `shim.h`) is changed only through a message to the harness owner; per-game data stays in `games/<game>/`. Anything generic found missing is a numbered M7.2 follow-up, not a local fork.
- Measure what we claim: time and tokens per phase, number of per-game values found blind and how (method + how long), number of generic-code edits needed. These answer "did the lessons transfer".
- Keep the offline/online split: scripts, scenarios and decompile cleanup can be drafted without the emulator; every emulator step has a hard `timeout`.

## 5. Open items before P0 (generic parts known to be weak)
1. Make the replay shim model-configurable (`replay.model`: memory model, calling convention, SS vs DS) before any game with another model or compiler; Keen 4 probably does not need it.
2. Multi-target capture per emulator run (start-up is more than half of capture time).
3. A script that automates "find frame hook" (the CS:IP sampling, loop dump, `ndisasm`) so P1 is mostly a run, not an investigation.
4. Check the legal/data side: shareware data present, nothing copyrighted committed (vendor/ stays ignored).
5. Repo: DECIDED by the user 2026-10-09: the new game gets its own NEW repo (created by the user), not this one. Seed it with a clean copy of the generic parts only: `harness/` (without `games/keen_dreams/`), `scripts/` (setup.sh, run_dosbox.sh, dbx_debug.py, unlzexe.py, ghidra/ and other generic tools; strip Keen Dreams paths), `comms/` + `scripts/comms.sh`, `plans/workflow.md`, a fresh `CLAUDE.md`, an empty `LESSONS.md`. Leave behind `grading/`, `blind/`, `vendor/`, `analysis/`, `verify/` and `plans/milestones.md` (answer material and Keen Dreams specifics). Needed here first: a seed script or checklist (`scripts/export_generic.sh`) so the copy is repeatable and leak-checked; this repo then stays the reference for the generic code until the new repo's changes are merged back by hand.

## 6. Decisions
1. Game for M8: still open (recommendation: Commander Keen 4; alternatives in section 2).
2. Repo: decided, new repo created by the user (section 5 item 5).
3. Open: do open items 1-3 and the export script before P0 (recommendation: export script first, then P0; build item 3 inside the new repo's P1 so it is tested on the new game).
