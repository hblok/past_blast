# Transferable lessons from two games (Keen Dreams, Wolfenstein 3D) and one reimplementation

Read this before starting game N+1. Facts about a game (addresses, tables) do not transfer; the methods, the traps and the order of work do. Sources: `LESSONS.md` of both repos (hundreds of dated entries), `plans/workflow.md`, `verify/bug_classes.md` and `verify/p6_writeup.md` of the Wolfenstein repo, and the HTML/JS port (`port_kit/`, `plans/port_method.md`). One agent per game, so treat the numbers as single samples.

## 0. The five things that mattered most
1. **A deterministic oracle first.** The real game under a debugger-enabled DOSBox-X, a frame hook, a key table you can write, and a state map. Everything else (verification, mechanics, even a reimplementation) is a comparison against recordings from it. Without determinism nothing else is checkable.
2. **Nothing is "correct" without evidence**: replay PASS with coverage and a mutant, or a frame-by-frame match against the oracle, or a documented external reference. Everything else is a hypothesis; say so in the tally.
3. **Scenarios need game knowledge.** Blind key sequences never reach door, fight or boss code. Decode the level format, write the mechanics down, build a route planner that writes scenarios, and inject state (level warp, position snaps, weapons) instead of playing.
4. **The random number generator is the sharpest instrument.** Record its index every frame. A desync shows up there frames before anything visible differs, and every bug in the port that mattered was first an RNG-count difference.
5. **Keep the process boring and complete.** Write each lesson the moment you learn it, commit each step, push when done, include in the repo everything the running thing reads. (Section 9.)

## 1. Environment and the original
- Use the DOSBox-X build with the heavy debugger (`--enable-debug=heavy`); the apt package has none. Run headless under Xvfb with a hard `timeout` on every emulator run. Never `tmux kill-server`; never `pkill -f '<pattern>'` from a shell whose own command line contains the pattern (it kills that shell, exit 144: use a pid file).
- Check LZEXE/PKLITE first (`unlzexe.py` from the kit handled both games). The retail data of a "shareware" archive may not be shareware: look at the files and the game's own text.
- Installers (De-ICE, PKSFX self-extractors) are scriptable with xdotool; a kill-after-3-seconds harness can interrupt an extraction midway (data present, exe missing): check that the exe exists.
- **The harness runs without a sound card, so the original is in PC speaker mode.** That changes sound durations and priorities, and through them RNG consumption (a face-animation routine returned early while a sound played). A real player's configuration differs: sound configuration is hidden state of the oracle.
- Cost reference: runnable exe 40 min; deterministic oracle 4 h (game 2, with the kit); ~250 ms per recorded frame (recording a 1000-frame scenario = 4-5 min including a 60 s start-up); up to ~4 emulators in parallel are fine; each recording is deterministic so parallelism does not change results.

## 2. Finding the hooks (blind, ~1 day)
- **Frame hook**: sample CS:IP ~300 times in a level; one tight loop that takes most samples is the tick-wait. Hook = its return. Verify: hits 1 per frame, counter +1, tics field sane. "Retrace wait" is the fallback.
- **Key table**: diff DGROUP dumps taken AT THE HOOK (idle vs held key, ignoring words that differ between two idle dumps). Dumps at arbitrary moments are noise. The table may be word-sized (a Borland bool is int-sized) and odd-based; `LastScan` is a separate byte.
- **State fields by content**: search the dump for what you know from the screen (lives 3, health 100, ammo 8; the player start tile as 16.16 fixed point 0x001D8000). Object lists: stride search for the "centred in a tile" pattern (low word 0x8000, high word < 64).
- **Start-up** by scripted menu keys with generous waits; verify with a screenshot (the intro screens are timing sensitive). Level jump by poking the "map number" and "play state" words works; the debug-key route opens modal screens whose wait loops never reach the frame hook (any modal screen needs its own hook, or poke the result).
- Screenshots: read the VGA planes through the debugger (`vga.py`), palette once per scenario; ~3.5 s per shot.

## 3. Determinism (the part that bites)
- A player-state compare passing in two runs does not prove the world is deterministic: guard positions and timers differed from frame 0 on. **After the first compare passes, diff FULL memory dumps of two runs at the same frame.** Causes found: the RNG seed taken from the clock (menu timing changed it), the first hook being a different game frame per run, data in a code-side segment that DGROUP dumps never show (found through the relocation table: the only relocations holding that segment value are in the RNG routines).
- Fixes (generic, in `run.py`): `boot_patches` (NOP the clock-seeded branch), `hook_from_start` (breakpoint on the frame hook before the program starts: frame 0 is then the first frame of the level), `seg` state fields, polling with a known breakpoint set.
- Watch `tics != 1` as the taint signal; the clock lock of game 1 was a no-op on game 2.
- Level setup re-seeds the generator (the boot patch makes the seed always 0): after any level load or restart the index restarts at 0. Find this early: it decides how a port must start each level.
- **Record the RNG index every frame** (`seg` field). Also record the whole object list as raw words (60 objects x 30 words is fine), the player, the game-state struct, the door/timer tables.

## 4. Static analysis (Ghidra)
- The binary names itself: debug/error strings with a `Name:` prefix give function and module names for free (name a function only when exactly one function references the string).
- Borland medium model: one code segment per source module, so segments are modules; label a module from its strings and hardware use, and **re-label it when a verified function lands in it** (a "VGA" segment turned out to be the renderer + CalcTics).
- Library identification by OMF signature found few exact matches because the game used another compiler revision than the one available; do not expect it.
- `int 34h-3Dh` are the 8087 emulator, not DOS; `int 33h` mouse; ports 3C4/3CE/3D4 mark VGA modules.
- Structs are recovered from memory, not from reading code: object stride, linked-list links, state records (think/action as far pointers, next near), then confirm with a checker (`check_structs.py`) and relax it only with evidence.
- Typed mechanical rewriting (parameters dereferenced at 3+ offsets become struct pointers) is safe; hand cleaning loses statements.

## 5. Scenarios, mechanics and planners
- Before scripting anything: decode the level/map format (id games: Carmack + RLEW planes), write the mechanics down (movement speeds, door timing, thing codes), cross-check against screenshots (a "dead officer" tile was a dead guard).
- A route planner (BFS over the decoded tile map through doors, measured speeds, a state snap of position/tile/angle at every segment so open-loop keys cannot drift off a one-tile doorway) turned 6 hand-tuned attempts into 1 run. Targets: tile, nearest enemy of a kind, elevator, boss. Injection: level warp, ammo/health/weapon (`set:` lines; the header says the scenario is injected). Difficulty filters matter (spawn codes +36 medium, +72 hard).
- Limits met: key doors, pushwalls, far routes (~3000 frames). Plan for them; use warps instead.
- Hard `--deadline` per run (1.5x the expected time: frames x 0.27 s + 60 s start-up + 4-25 s per screenshot); the default frame count of `run.py` is 300 and a longer scenario silently stops there: always pass `--frames`.

## 6. Capture and replay verification (decompile side)
- Check the return kind (last byte C3 near / CB far) before any capture: a wrong kind looks like a hang. A hot function (called thousands of times per frame) also looks like a hang: use `--every`, `--from-frame` or capture the caller.
- Dump the whole 1 MB, not 640 KB: EMS/XMS page frames (E000..EFFF) hold page-cache data the decompile reads.
- **Ghidra defects dominate, not harness defects** (nine classes, `verify/bug_classes.md` in the Wolf repo): lost segments of far and `_seg` pointers (the segment lives in a separate DS variable: read through a far-pointer macro), 16-bit arithmetic compiled as 32-bit host ints (mul/neg/sbb chains), wrong callee segment or arity (ndisasm the call bytes, compute the callee image offset from the function table instead of guessing), register inputs (`in_BX`), `_DAT_` 4-byte overlays, ES vs DS confusion. Budget a hand-patch step (`replay/<off>_ghidra.patch`, as `diff -U0` because mutation text is applied before the patch).
- CS in the register dump is decimal (9553 = 0x2551): misreading it cost two wrong disassemblies. Physical = CS*16 + IP; the first bytes should be `55 8B EC`.
- Verdict hygiene: strong PASS (the original changed memory and the host matched), weak PASS (return value or no-op only), UNTESTABLE (port I/O, interrupts: 8 of 34 here), BLOCKED. A weak PASS with no mutant says almost nothing. Every strong PASS needs a mutant; a survivor names the missing scenario (a boundary value, a never-taken branch). Forced inputs (`--entry-set`) make a verdict valid for that input only; label them.
- A source check late (id's source, P5) confirmed names and every PASS and showed both FAILs were decompile segment loss. Reading 22 functions took 25 minutes; it cannot replace coverage.
- Orphan emulators: SIGKILL leaks them (14 found); send SIGTERM first (`capture.py` unwinds on it).

## 7. Reimplementing the game (HTML/JS), the method that worked
Full recipe in `plans/port_method.md`. The lessons that generalise:
- **Decide exactness early: go bit-exact.** The plan said "floats, compare with a tolerance". Reality: the oracle makes exact integer models (16.16 positions, the original's tables including their quirks) achievable and tolerance hides bugs. Bit-exact movement took one afternoon; every later "close enough" shortcut cost more.
- Build in the order the oracle can judge: data decoders, renderer (by eye against a screenshot), movement (frame-exact against a recording), doors/timers, then actors, then everything cosmetic. Each phase ends with a check script.
- **The oracle comparison is a diff of the object list per frame plus the RNG index.** The first differing record names the bug. Eleven of the fixes found this way: UpdateFace (cosmetic code) consumes random numbers; a sound-effect call can consume random numbers (a death scream picks one of 8); the face routine returns early while a sound plays (RNG depends on the sound card); level setup resets the generator; new objects take the most recently freed list slot; objects spawned during a tic are thought in the same tic; "remove" must not clear the tile map entry of another actor; `float` angle rounding of atan2; keys are cleared on death; the per-frame `tics` value semantic (record f's tics drive step f to f+1); the first recorded frame is after one logic step. Expect this kind of list for any game.
- Alignment conventions are worth writing down once (`port_kit/js/oracle.mjs` header).
- Warps and restarts are scenario features: the oracle must re-synchronise (new game object, RNG 0, carried state, slots reset).
- State injection in the original must be mirrored in the port (`set:` lines for health, ammo, weapon, position, level).
- Mutation-check the port against the recordings (`port_kit/py/mutants.py`): 12 of 18 mutants were killed; survivors were boundary comparisons (`<` vs `<=`), things no recording compares (pain-state choice) and scenarios not yet recorded (knife). Boundary mutants need luck; say so.
- Data formats: verify each by an independent decoder or by looking at it. Chunk numbers in the original source header can be off by a constant for the data version you have (144 pictures in the data vs 132 in the header: every number after the point of divergence shifted by 12); the fix was a contact sheet of all pictures and recognising them. Palette, tables (rndtable, per-level song numbers) can be read straight from the exe by searching for known prefixes.
- Sound: formats decode in an afternoon (digitized samples as 8-bit PCM, AdLib effects as register streams, IMF music through an OPL2 model); the timbre is approximate until checked by ear. The audible check is the user's.
- Browsers: `AudioContext.createBuffer` rejects sample rates below 8 kHz (Firefox); an exception in the frame loop stops the game, so every audio call is wrapped; a stub AudioContext in node accepts anything and cannot find platform limits. Do not swallow F-keys (F11 full screen) or Ctrl combinations unnecessarily; if a key is also the fire key, do not exclude it. Serve the repo root (the page fetches the data by relative path) and commit that data.
- A single page, ES modules, no build step, no dependencies; the renderer is a pure function over an RGBA buffer so it runs in node (headless PNG for verification) and the browser (`port_kit/js/png.mjs`). You cannot see a browser from the sandbox: the user's report is the browser test; give them a debug panel (map overlay, warp, cheats, "last hit" line) to report precisely.

## 8. Mistakes that cost time (avoid)
- Calibrating a constant from a screenshot that contains something you have not modelled yet (an 80 degree FOV estimate; the engine computes it from projection constants, 72.4).
- Trusting a header's enumeration over the data (picture numbers).
- Comparing only the player in the oracle (the world was non-deterministic for days).
- Test scripts that run out of ammo or die and look like "the boss is immune": refill/heal every tic in boss tests.
- An inline `//` comment at the end of a line that continues in generated or one-line code swallows the rest of the line (three times): put comments on their own line or use `/* */`.
- A mutation test where the mutated line is inside a patched region; a coverage claim from one scenario.
- Treating a timeout as a hang before checking the return kind and the hot path.
- Polling loops with `sleep`: use a foreground command with a long timeout or a background job and its completion notice.

## 9. Process rules (the user's, learned the hard way)
- **Whatever the running game reads is part of the repo.** `vendor/` was gitignored out of IP caution, then the page 404ed on the user's laptop. In a private experimental repo commit the data the program loads (ignore only machine-local symlinks); before ignoring anything ask "can the user clone this elsewhere and run it?"
- **Finish the delivery**: commit and push everything when work is done, without waiting to be told. Verify the clone, not the working tree: every file the page fetches must be in `git ls-files`.
- Commit each step; lessons in `LESSONS.md` at once; a TODO file kept current (what is open, why).
- `git add -A` in a repo that holds someone else's untracked work commits it (3904 files of recordings): add named paths.
- Report status in a few words during long work; long recordings run in the background with a notification, parallel where independent.
- Hypotheses are labelled; "it ran" is not evidence.
