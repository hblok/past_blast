# Generic kit: AI-driven reverse engineering of DOS games

Exported from the Keen Dreams repo by `scripts/export_generic.sh` (see `MANIFEST.txt` for the commit and file list). Contains only the game-independent parts: the workflow (`plans/workflow.md`), the multi-agent protocol (`comms/`, `plans/multi_agent_comms.md`, `scripts/comms.sh`), the oracle harness and replay verification (`harness/`), environment and emulator scripts (`scripts/`), and templates (`harness/games/mygame/`, `plans/milestones.md`, `CLAUDE.md`, `LESSONS.md`). Since the second game it also carries `plans/transferable_lessons.md` (what two games taught: read first), `plans/port_method.md` and `port_kit/` (reimplementing the game in HTML/JS against the oracle: generic oracle runner, PNG/format/OPL helpers, mutation runner, and the complete Wolfenstein 3D port as a worked example).

Start:
1. `git init`, unpack the kit, rename `harness/games/mygame` and the `mygame`/`ref`/`GAME.EXE` placeholders for your game.
2. Edit `scripts/setup.sh` (game data section), run it in a fresh container (needs github.com; the DOSBox-X debugger comes from a prebuilt release asset or is built, ~5 min).
3. Follow `plans/workflow.md` section 7 and `plans/milestones.md`; start sessions per `comms/README.md`.

Not included on purpose: the Keen Dreams source-level material (decompiled code, ground truth, grading, run data), game files, and Keen-specific state maps. The Borland medium-model assumptions of `harness/shim.h` and `harness/replay.py` are documented in `harness/README.md`; another compiler/model needs changes there.
