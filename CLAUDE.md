# <game>: AI-driven reverse engineering (seeded from the generic kit)

Goal: apply the workflow in `plans/workflow.md` (read it first) to this game, with no source. Nothing is "correct" unless replay-verified with coverage and a mutant, or matched against an external reference with evidence; everything else is a hypothesis.

- Multi-agent work goes through git: `comms/README.md`, `plans/multi_agent_comms.md`, `scripts/comms.sh`. Board: `plans/milestones.md` (planner only).
- `LESSONS.md` is mandatory: write every fact the moment you learn it, commit each step.
- Per-game data lives only in `harness/games/<game>/`; generic code (`harness/*.py`, `shim.h`, `scripts/`) changes only through a message to its owner.
- Copyrighted game files live in `vendor/` (gitignored). Never commit them.
- Environment: run `scripts/setup.sh` in a fresh container. Debugger: DOSBox-X built with `--enable-debug=heavy` (the apt package has none). Every emulator run needs a hard `timeout`; never `tmux kill-server` (use `tmux -L <name>`); never `kill $(pgrep -f ...)` from your own shell.
- Do not import facts from any other game's repo; the methods transfer, the addresses do not.
- Do not commit, push or publish anything outward-facing without the user's say-so.
- Read `plans/transferable_lessons.md` (what two games taught) and, for a reimplementation, `plans/port_method.md` + `port_kit/`.
- Process rules (from the user, learned the hard way): whatever the running game or page reads is part of the repo (commit the data in a private repo; only machine-local symlinks are ignored); when work is done commit AND push everything without waiting to be asked; verify the clone, not the working tree (`git ls-files`); never `git add -A` in a repo that holds other untracked work (add named paths); keep a TODO file current; report status in a few words during long jobs, run long recordings in the background and wait for their completion notice instead of polling with `sleep`.
