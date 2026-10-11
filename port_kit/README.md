# port_kit: code for reimplementing a game against the oracle

Method: `plans/port_method.md` (read it first); lessons: `plans/transferable_lessons.md`. Plain ES modules for node and the browser, no dependencies, no build.

| Path | Use |
|---|---|
| `js/oracle.mjs` | generic frame-by-frame comparison of a port with a harness recording (`state.jsonl[.gz]`) through a small adapter; conventions in its header |
| `examples/adapter_template.mjs` | the adapter skeleton (init, start, event, step, compare) |
| `js/png.mjs` | headless PNG writer, indexed pictures, contact sheet of numbered chunks (the way to identify graphics) |
| `js/id_formats.mjs` | id Software formats: Carmack, RLEW, Huffman graphics chunks, planar pictures, proportional fonts (verify against your game's data) |
| `js/opl.js`, `js/imf.js` | OPL2 model; AdLib effect chunks and IMF music rendered to Float32Array (timbre approximate: listen) |
| `py/mutants.py` | mutation check of the port against its recordings (JSON table of mutants) |
| `examples/wolf3d/` | the complete Wolfenstein 3D port, its checks, planner and tools as a worked example (names/addresses do not transfer; the structure and the traps do) |

Typical start for game N: (1) harness state map with player, game state, raw object list and the RNG index (`seg` field); (2) a planner that writes scenarios; (3) copy `js/oracle.mjs` + write the adapter as soon as the player moves in your port (W2), extend it with each subsystem; (4) after each enemy type, record a scenario and run the oracle; (5) mutants when the recordings match.
