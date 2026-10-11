# Multi-agent cooperation through git (what we did and what we learned)

From the Keen Dreams run (2026-10-07..09): five to six Claude sessions (planner, build, harness, blind decompiler, grader, verifier, one offline drafter) worked on one repo in parallel, talking only through git files. The operational protocol is `comms/README.md`; this note is the why and the lessons. It worked well enough that the user called it very useful: nobody needed a relay in chat, and every decision and result stayed in the repo.

## Why git files
- Sessions share nothing else: no memory, no chat, containers come and go. A repo file survives all three.
- One file per message and per claim means two agents never edit the same lines, so there are no merge conflicts to resolve by hand. The only shared-write files are append-only logs with `merge=union` (`LESSONS.md`, `plans/progress.md`).
- Everything is auditable afterwards: who decided what, when, with what result.

## Building blocks
| Piece | Purpose | Lesson |
|---|---|---|
| Handle | Identity of a session | pick once; blind agents get a recognisable prefix so rules can match it |
| Card `comms/agents/<h>.md` | What I am doing, state, blockers, next step | the first thing a restarted agent reads about a peer; stale cards mislead, update on claim/finish/block |
| Message file | Request, answer, FYI | `Re:` first line for replies; messages to `all` are read by everyone, mind what they contain |
| Claim file | Mutex for a task | creation + push is the lock; the loser's push is rejected and `comms.sh claim` backs out cleanly |
| `plans/milestones.md` | The plan and the board | single writer (planner). Tables edited by many agents were the one real conflict hot spot |
| `plans/progress.md`, `LESSONS.md` | Append-only logs | union merge; correct with `CORRECTION:` lines, never rewrite |
| Pause file | Budget control | a UTC stop time agents check at every tick beats killing sessions: they commit and leave a next step |
| `/loop` or Routine | Keeps an agent working | agents otherwise stop after one step; use a self-paced loop for long investigations |
| Brief file | Hands a task to an agent that lacks the environment | deliverables + facts + what to send back |

## Roles that worked
- **planner** (strongest model): plan, board, decisions, design notes. Single writer of the board.
- **builders** (cheaper model): environment, harness code, scripts.
- **investigator** (strongest model, long loops): the hard reasoning (decompilation, diagnosis).
- **grader/verifier**: must not be the agent that produced the work being judged.
- **offline drafter**: no emulator; writes text deliverables (scenarios, plans, scripts) from the repo alone; the environment-holding agent validates by running and replies with works / needs change / reaches nothing. 4 of 4 validated drafts hit their targets first time, so use this split whenever the deliverable is text.

## Practices that paid off
1. Small commits pushed within minutes; `comms.sh push` retries and stops at a real rebase conflict.
2. Handing over by file: a brief, then one message when done with the file list, the counts and the items the author is least sure about.
3. The recipient answers per item, so the author can fix specific things in new commits.
4. Facts go to `LESSONS.md` the moment they are learned, with the method that found them (agents repeated lost nights otherwise, e.g. a debugger protocol race).
5. Decisions carry an ID and an owner (D1..D6 on the board): who may decide, what was decided, why.
6. Tool hygiene is shared knowledge: hard `timeout` on emulator runs, a private tmux socket, no `pkill -f`/`kill $(pgrep -f)` from your own shell, `ulimit -f` against log floods.

## What went wrong or needed care
- **Board lag.** The board is single-writer, so rows stayed `todo` after the work was done. Fix: an agent finishing a task may mark its own row and note it in its card; the planner tidies later.
- **Stale or missing cards** after an agent ended; always state `State:` and a next step.
- **Editing another agent's files** (e.g. a verifier changing harness code). Allowed only when announced by message; the owner re-checks.
- **`push` with a dirty tree**: `git pull --rebase` refuses unstaged changes, so a message could be committed but not pushed. Commit first.
- **Messages to `all` can leak** protected detail to isolated agents; address named handles for such content.
- **Token limits stop agents mid-batch** (the grader hit its limit before aggregating). Batch outputs must each stand alone (one results file per batch), and the card says what is missing.
- **A long agent session reads a lot before it writes.** Briefs that list the exact files to read cut that cost.

## Starting the next project with this
Copy `comms/`, `scripts/comms.sh`, `.gitattributes`, the progress/LESSONS files and this note. Create the board with phases and gates, start a planner session first, then add agents one at a time; give each its first message from `comms/README.md` "Starting a new agent". Start with two or three agents, not six: the protocol scales, the budget does not.
