# Milestones (planner is the only writer)

Phases and gates from the transfer plan. Status: todo | wip | blocked | done | dropped. Owners are filled from `comms/claims/` and cards.

| ID | Phase | Gate | Status | Owner |
|---|---|---|---|---|
| P0 | Prep: layout, legal data, setup.sh, CLAUDE.md, LESSONS.md | exe unpacked, runs headless, title screenshot | todo | |
| P1 | Oracle: frame hook, clock lock, determinism, key table, 3-5 state fields, start-up, align.write | two scripted runs identical over 400 frames in a level | todo | |
| P2 | Static: Ghidra headless import, function table, library identification, modules | sane function count, modules listed | todo | |
| P3 | Decompile: typed C per module, structs, purposes (confidence tied to replay) | object/state/input structs recovered and checked against memory | todo | |
| P4 | Verify: capture-replay bottom-up, coverage + a mutant per verdict | >= 20 functions replayed, bug classes catalogued | todo | |
| P5 | Reference check against an external reimplementation, if one exists | report | todo | |
| P6 | Write-up: what differed from plans/workflow.md | go/no-go for the next game | todo | |
| W0-W8 | Optional: reimplement the game in HTML/JS against the oracle (`plans/port_method.md`: map decode, raycaster/renderer, movement bit-exact, doors, actors, flow, original graphics, sound/music) | oracle recordings match frame by frame incl. the RNG index; mutation check run | todo | |

## Decisions
| ID | Question | Who | Status |
|---|---|---|---|
