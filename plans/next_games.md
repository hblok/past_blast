# Candidate next games

Written 2026-10-11 from the kit's design; no binary of any candidate has been inspected yet, so every "fit" below is a hypothesis to check with steps 2-3 of `plans/workflow.md` section 7 (the cheap test) before committing.

## What the kit needs from a game
- A DOS binary that runs deterministically in DOSBox-X (see `scripts/determinism.py`).
- A findable frame hook and 3-5 state fields (`harness/README.md`).
- Ideally a reference to cross-check against: an open-source reimplementation, documented formats, save files.
- 16-bit real mode and the Borland medium memory model: `harness/shim.h` and `harness/replay.py` assume it. Other compilers/models need work there first (`plans/transfer_plan.md` section 5, item 1).

## Ranking
| Game | Fit | Notes |
|---|---|---|
| Commander Keen 4-6 | low risk | same engine family as Keen Dreams; Omnispeak is a behavioural reference. Best cheap validation run. |
| Spear of Destiny / Blake Stone | low risk | Wolfenstein 3D engine family; most of `port_kit/examples/wolf3d` is reusable. |
| Dune II | medium | real-time strategy; OpenDUNE as reference. Good step toward a 4X game. |
| Civilization (1991) | medium-high, large | turn-based so deterministic and easy to replay; save files give extra state to verify; rules well documented. Cost: sheer amount of logic, AI and map generation are heavy to verify; compiler and overlay scheme unchecked. |
| Master of Orion (space 4X) | medium-high | turn-based like Civilization; same pros and cons. |
| Pseudo-3D racer (Test Drive, Stunts, Lotus) | medium | road projection and timing are the interesting part; reuses the Wolf3D rendering lessons. |
| OutRun | poor | the original is Sega arcade hardware (68000), outside DOSBox-X and this harness; the DOS port is weak. Use a DOS racer instead. |
| Wing Commander | hard | own overlay and asset system. |
| Descent and other DOS4GW games | blocked | 32-bit protected mode breaks the real-mode assumptions; harness work first. |

## Suggested order
1. Cheap validation run on Keen 4 or Spear of Destiny.
2. One ambitious game: Civilization or Dune II.
3. A pseudo-3D racer if a visual result is wanted.

## Open questions for the user
- Port to HTML/JS, or reverse-engineer and verify the logic only?
- Which game, and is a legally owned copy of its data files available (they go in `vendor/`, never committed)?
Once answered, write a scoping plan for the chosen game in `plans/` (use `plans/transfer_plan.md` as the template) and add its milestones to `plans/milestones.md`.
