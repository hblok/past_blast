# Agent communication through git

Several Claude sessions work on this repo at the same time and push to `main`. Git conflicts come from two agents changing the same or adjacent lines of one file. This protocol avoids them: **every shared write is a new file, or a file only one agent ever edits.** Rationale and lessons: `plans/multi_agent_comms.md`.

## Handles
Each session picks a short handle once and uses it everywhere (`planner`, `harness`, `build`, `verify1`, ...). Roles are in `plans/multi_agent_comms.md`; the board is `plans/milestones.md`.

## Files
| Path | Written by | Purpose |
|---|---|---|
| `comms/agents/<handle>.md` | only that agent | Status card: current task, state, last update (UTC), blockers, next step. Overwrite freely; update when you claim, finish or get blocked. |
| `comms/msg/<UTC>_<from>_to_<to>_<slug>.md` | sender, once | One message per file, never edited. `<UTC>` = `YYYYMMDD-HHMM`; `<to>` is a handle or `all`. Reply with a new file whose first line is `Re: <file name>`. |
| `comms/claims/<task-id>` | claimer, once | Claiming = creating this file (handle + UTC). If the push is rejected and the pull shows the file with another handle, you lost the race: drop it, pick another task. |
| `comms/pause/<handle or all>` | user / planner | `stop-at: <UTC>` and a reason (see Pausing). |
| `plans/progress.md` | anyone, append only | One line per finished task or event, at the END. `merge=union` in `.gitattributes`, so concurrent appends never conflict. |
| `LESSONS.md` | anyone, append only | Same union merge. Never edit or delete old lines; append a `CORRECTION:` line. One announced tidy-up pass may rewrite it. |
| `plans/milestones.md` | `planner` only | Task definitions, dependencies, decisions; the planner syncs Status/Owner from claims and cards. Others propose changes by message. (In practice the board lags: agents may mark their own row when finishing and say so.) |

Everything else belongs to whoever created it; to change another agent's file, send a message unless the fix is trivial and you announce it.

## Routine (every work step)
    scripts/comms.sh sync                 # git pull --rebase origin main
    scripts/comms.sh inbox <handle>       # new messages to you or to all
    ... work, commit in small steps ...
    scripts/comms.sh push                 # pull --rebase + push, retries
Commit small, push often. Never force-push `main`. `comms.sh push` needs a clean working tree for its pull --rebase: commit or stash first (untracked files are fine). On a rebase conflict in a file you do not own, keep `main`'s version and resend your change as a message (during a rebase `--ours` is `main`, `--theirs` is your commit).

`scripts/comms.sh`: `sync | push | inbox <h> | msg <from> <to> <slug> (body on stdin) | claim <h> <task> | pause <h|all> <UTC|now> [reason] | resume <h|all> | paused <h>`.

## Keeping agents running
Agents stop after a step and wait. Two Claude Code features restart them: `/loop` typed in the session (`/loop 30m <prompt>`, or without interval for self-pacing; dies with the session) and Routines (scheduled, survive restarts). Standard prompt:

    /loop 30m Run scripts/comms.sh sync, scripts/comms.sh paused <handle> and scripts/comms.sh inbox <handle>. If paused: follow "Pausing" in comms/README.md and stop. Otherwise answer messages addressed to you and continue your claimed task; when done, append to plans/progress.md, update comms/agents/<handle>.md and claim the next task of your track. Commit and push each step with scripts/comms.sh push. If blocked, message planner and say so in your card instead of guessing.

Neither helps when a tool call hangs: every emulator run needs a hard `timeout`.

## Pausing and budgets
    scripts/comms.sh pause <handle|all> 2026-10-08T09:00Z "token budget"   # or: now
    scripts/comms.sh resume <handle|all>
Times are always UTC. Each agent runs `scripts/comms.sh paused <handle>` at every loop tick and before any step longer than a few minutes (exit 0 = stop now; it also prints a scheduled pause, so do not start long work that runs past it). When paused: finish or cleanly abandon the step, commit and push, set `State: paused` plus the next step in your card, append a progress line, cancel your loop, end the turn. Resume only when the user removes the file.

## Starting a new agent
First message for a normal agent: `You are agent <handle> on this repo. Read CLAUDE.md, LESSONS.md, comms/README.md and plans/milestones.md, then scripts/comms.sh inbox <handle>. Write your card comms/agents/<handle>.md, claim the first free task of your track with scripts/comms.sh claim, and work it. Follow the comms protocol for every commit.` Then start the `/loop`. An agent without the emulator or environment (offline agent): add "You have no emulator and must not run setup.sh" and give it a brief file (`plans/<topic>_brief.md`) with deliverables, the facts it needs and the message to send when done.

## Optional: isolated (blind) agents
If a task must not see some material (an answer key), keep one repo, give the agent a read whitelist in its briefing, and add: messages to such a handle or to `all` must not contain the protected detail; protected material is never written into shared docs the agent reads; the agent logs any accidental contact in a notes file. Separation is by discipline, not access. For a game with no answer key this is unnecessary.
