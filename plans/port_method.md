# Reimplementing a DOS game in HTML/JS against the oracle (method, from the Wolfenstein 3D port)

Goal of the phase: a playable port (here: plain HTML + ES modules + one canvas, no build, no dependencies) whose behaviour is checked against recordings of the original, frame by frame. It is the strongest verification this workflow has produced: 17 recorded scenarios (SS, dog, mutant, officer, six bosses, plus variants; ~15,000 frames) match the port on every actor field and the player's state, the random index included. Start it once the oracle (workflow steps 2-3) and a mechanics document exist; it does not need the decompile. Worked example: `port_kit/examples/wolf3d/`. Generic code: `port_kit/` (`js/oracle.mjs`, `js/png.mjs`, `js/id_formats.mjs`, `js/opl.js`, `js/imf.js`, `py/mutants.py`).

## 1. Ground rules
- **Exact, not approximate.** Integer fixed point as the original (16.16 positions, angle units, lookup tables built the way the original builds them, quirks included: a cosine table entry of 65535 instead of 65536 gave 5249 instead of 5250 per tic and was visible within 20 frames). Floats only where the original uses them (`float` angle in a projectile aim, rounded to 32 bits).
- **Every rule has a provenance comment**: `[verified]` (matched an oracle recording or replay), `[measured]` (oracle experiment), `[source]` (read from a reference source: behaviour only, write the code fresh; check the licence before copying anything), `[guess]`. Promote guesses by recordings.
- **Fixed logic tic** (70 Hz here); render as often as the browser allows; one `tick(input, tics)` function advances the game by `tics`.
- **Headless first**: logic and renderer run in node. The renderer is a pure function over an RGBA buffer; `png.mjs` writes PNGs; every check is a `node check_*.mjs` that exits non-zero on failure; `check_port.sh` runs all.
- **Data from the original files** in `vendor/` (committed, private repo); tables found in the exe (palette, RNG table, per-level music numbers) are extracted by scripts (`extract_palette.py`, `gen_states.py` pattern) so provenance is a command, not a copy-paste. Generated tables are committed.

## 2. Phases (each ends with a runnable gate)
| # | Phase | Gate (what judges it) |
|---|---|---|
| W0 | Loader + level/map decode in JS | ASCII/md5 dump of every level equals an independent decoder (python), all levels |
| W1 | Palette, texture/sprite readers, raycaster | looks like a screenshot of the original from the same position (by eye, headless PNG, side by side) |
| W2 | Player movement/collision, fixed tic | positions per frame equal a recorded run (bit-exact); mutants of the constants fail |
| W3 | Doors, pushwalls, keys, level exit | door timeline equals the recorded timer (assert both sides of every boundary) |
| W4 | Static sprites, pickups, HUD numbers | values from the source/mechanics doc; recording if available |
| W5 | Enemies and weapons | object list per frame equals recordings (section 4) |
| W6 | Episode flow: level end, lives, death, difficulty, secret levels | session check; deaths/restarts in recordings |
| W7 | Original graphics: HUD, menu, fonts | contact sheet to identify chunks; screenshots of each screen |
| W8 | Sound effects, music, debug panel, polish | decode checks (finite, non-silent, right length); the user listens |
Do W5 in the order guard -> other types -> bosses, recording a scenario after each; projectiles, free lists and death handling appear with the later ones.

## 3. Recording the oracle for a port
Extend the state map (`harness/games/<game>/<exe>.state.json`) with:
- the player (position, tile, angle) and the game-state struct (health, ammo, score, lives, weapon, keys, map number);
- **the raw object list** (`u16[N*words]`, N covering the actors you compare; 60 objects x 30 words = 3.6 KB per frame is fine) decoded on the host;
- **the RNG index** (`"seg"` field if it lives outside DGROUP) and the `tics` of every frame;
- door/timer tables if the game has them.
Scenarios come from a planner (`port_kit/examples/wolf3d/tools/wolf_route.py` pattern): level warp by poking the map-number and play-state words, BFS route to the target (enemy of a kind, boss, tile), snaps, fire bursts; `--cheat` injects health/ammo/weapon so long fights do not end with the player dead. Record with an explicit `--frames`. Run independent recordings in parallel in the background.

## 4. The oracle comparison
`port_kit/js/oracle.mjs <adapter> <recording> <scenario>`: for each frame apply the scenario's events to the port, step it with the recorded tics, compare the adapter's fields with the next record. Conventions (write them in the adapter, they cost hours each time):
- Recorded state of frame f = after the logic of frame f; record f's `tics` drive step f -> f+1; events at frame f act in that step. The first record is after one logic step with the minimum tic count.
- A warp shows the new level BEFORE its first logic step; a death restart does too, after N dying frames. The adapter re-creates the game (RNG index 0, carried state) and jumps.
- **Object slots**: the original's object list is a linked list over a fixed array with a free list. New objects take the most recently freed slot, so index = spawn order is wrong as soon as projectiles exist. Emulate slots from the port's spawn/remove log (`check_enemy_oracle.mjs`).
- Compare per actor: position, tile, direction, area, distance, hit points, (speed, flags), the state pointer if you can map it to names; per player: position, angle, health, ammo, score; and the RNG index. Skip what the original animates but you do not model (the death swing of the view) and say so.
- When the first difference is an actor field, compare the RNG index first: a one-draw offset means a missing/extra random call somewhere earlier. Print the port's draws per frame next to the recorded index; the first frame where they differ is the bug site.
- Debug aids that paid off: an env var printing one actor per frame, the sound events per frame, the player and the tile-map entry of nearby actors.

## 5. Checklist of things in the original that were NOT in any document
Look for these in game 3 before blaming the port:
1. Cosmetic code (face animation, screen flash) consumes random numbers and may depend on sound state.
2. Sound calls choose among sounds with random numbers; the sound system has a single voice with priorities and lengths; the sound card changes lengths.
3. Level setup re-seeds the generator.
4. Per-frame tic count `tics` is a variable (1 at the oracle's fixed cycles; 2+ on a real machine): do not hard-code 1 anywhere.
5. Actors spawned in a tic are processed in the same tic; removal does not clear the tile-occupancy map; spawned objects are zeroed (area 0, direction 0).
6. Projectiles are actors with their own states; a think function that clears the state removes the actor.
7. Occupancy of a tile by a dead/pass-through actor differs from a living one (NONMARK/NEVERMARK flags).
8. Enemy accuracy depends on the player's speed and on visibility; "run" is the player's thrust speed this frame.
9. Doors: line-of-sight and movement use the door position, not a boolean; shots must not pass a closed door (check: sweep 180,000 placements).
10. Death: input cleared, view swings to the killer, level restarts with a reset inventory and the score of the level start.
11. Boss death sequences (replay camera) end the episode; some bosses drop keys, others nothing.
12. Enumerations in a source header can be off for your data version; check against the data (picture sizes).

## 6. Checks to leave behind (one runnable check per subsystem)
`check_map` (decoder vs independent decoder), `check_move` (recorded run), `check_door` (timeline both sides of boundaries), `check_world`/`check_items` (rules from the source), `check_enemy`/`check_boss(es)` (behaviour with injected situations), `check_menu`, `check_sound` (every sound decodes, non-silent, right length; stub audio context), `check_session`, `check_door_los` (geometry sweep), the oracle runs over every recording, and the mutation check. `scripts/check_port.sh` runs them all in about 20 s; run it before every commit.

## 7. Mutation check of the port
`port_kit/py/mutants.py config.json`: a table of deliberate bugs (every number in a rule, every `<` vs `<=`); KILLED when some recording differs. 12 of 18 killed on Wolf3D. Survivors tell you which scenario is missing (knife, needle hit, pain state) or that the value is a boundary one. Record the survivors in the TODO.

## 8. Platform notes for the browser page
- Serve the repo root (`python3 -m http.server`), page at `/port/index.html`, data fetched by relative path from `vendor/`; commit the data.
- Keep a fixed-step loop: accumulate time, run whole tics, render once per animation frame.
- Audio: create the context on the first key press; resample anything below 8 kHz (Firefox); wrap every playback call; render music in slices (about a second per song) and loop the second pass.
- Input: leave F-keys and browser shortcuts alone; Ctrl may be the fire key.
- A debug panel (toggle with a key that no game uses): map overlay, level warp, give ammo/health/lives/keys/weapons, god mode, kill all, sound/music toggles, a line describing the last shot (target, doors on the line). It turns the user's observation into a report you can act on.
- You cannot see the browser from the sandbox. Verify by headless PNGs, tell the user plainly that the page itself is untested by you, and ask for console output when something breaks (that is how three real bugs were found: 404s from an uncommitted `vendor/`, a 7 kHz audio buffer, a swallowed F11).
