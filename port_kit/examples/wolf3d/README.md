# Worked example: the Wolfenstein 3D port (reference, not a template to copy blindly)

Everything here is from `hblok/wolf` (commit dd408e8, 2026-10-11): a complete HTML/JS port that matches the original frame by frame on 17 recorded scenarios. Game-specific on purpose
(Wolf3D names, addresses, tables); read it for STRUCTURE and for the traps it documents. The generated tables (`states_data.js`, `sound_data.js`, `gfx_names.js`) are not included: `checks/gen_states.py`
shows how they are produced from the source/binary.

| Path | What to learn from it |
|---|---|
| `port_src/game.js` | one tic = the original's PlayLoop order (doors, actors, player, then the view-dependent part); input as a plain object; UpdateFace-style "cosmetic" code that consumes random numbers |
| `port_src/actors.js` | state-machine tables driven by think/action functions, linked-list semantics (spawn during a tic, free list), projectiles, bosses |
| `port_src/player.js` | exact integer fixed-point movement (16.16, table quirks), the pattern for "bit-exact against the original" |
| `port_src/world.js` | doors/pushwalls/pickups, the single sound voice that makes RNG config-dependent |
| `port_src/render.js` | software raycaster as a pure function over an RGBA buffer (runs in node and the browser) |
| `port_src/session.js` | episode flow, level start resets the random index, death/restart |
| `port_src/{hud,menu,vgagraph,vswap,map}.js` | original graphics and data formats at the original positions, headless-checkable |
| `port_src/audio.js`, `../../js/opl.js`, `../../js/imf.js` | digitized + AdLib effects, IMF music through an OPL2 model |
| `port_src/index.html` | the whole page: fixed 70 Hz logic, canvas, menu, debug panel (map overlay, warp, cheats) |
| `checks/check_enemy_oracle.mjs` | the full oracle adapter: warps, death restarts, objlist slot emulation, random-index check, state injection mirrored in the port |
| `checks/check_move.mjs`, `check_door.mjs`, `check_door_los.mjs`, `check_bosses.mjs`, `check_sound.mjs` | one small self-checking script per subsystem; `check_port.sh` runs them all |
| `checks/port_mutants.py` | the mutation table the oracle recordings were judged with (12 of 18 killed) |
| `tools/wolf_map.py`, `tools/wolf_route.py` | level decoder and the route planner that writes harness scenarios (BFS through doors, state snaps, enemy/boss targets, cheat injection) |
| `tools/sheet_png.mjs`, `frame_png.mjs` | contact sheet of numbered graphics chunks / headless frames |
