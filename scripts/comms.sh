#!/usr/bin/env bash
# Agent-to-agent communication through git (protocol: comms/README.md).
# scripts/comms.sh sync | push | inbox <handle> | msg <from> <to> <slug> (body on stdin) | claim <handle> <task-id>
#   | pause <handle|all> <stop-at UTC, e.g. 2026-10-08T09:00Z or now> [reason] | resume <handle|all> | paused <handle> (exit 0 = stop now)
set -euo pipefail
cd "$(dirname "$0")/.."
sync() { git pull -q --rebase origin main; }
# a rebase conflict stops at once (resolve it, `git rebase --continue`, push again); only network/race failures are retried
push() { for i in 1 2 3 4; do sync || { echo "rebase conflict: resolve, git rebase --continue, then push again" >&2; return 1; }
  git push -q origin HEAD:main && return 0; sleep $((2 ** i)); done; echo "push failed" >&2; return 1; }
case ${1:-} in
  sync) sync ;;
  push) push ;;
  inbox) # messages to <handle> or all, newer than the last time this clone looked
    seen=.git/comms_seen_$2; touch -a "$seen"
    for f in $(ls comms/msg 2>/dev/null | grep -E "_to_($2|all)_" | sort); do grep -qxF "$f" "$seen" || { echo "== $f"; cat "comms/msg/$f"; echo "$f" >> "$seen"; }; done ;;
  msg) f=comms/msg/$(date -u +%Y%m%d-%H%M)_$2_to_$3_$4.md; cat > "$f"; git add "$f"; git commit -qm "msg $2 -> $3: $4"; push; echo "$f" ;;
  claim) f=comms/claims/$3; sync
    [ -e "$f" ] && { echo "already claimed: $(cat "$f")"; exit 1; }
    echo "$2 $(date -u +%Y-%m-%dT%H:%MZ)" > "$f"; git add "$f"; git commit -qm "claim $3 ($2)"
    if ! push 2>/dev/null; then git rebase --abort 2>/dev/null || true; git reset -q --keep HEAD~1; echo "lost the race for $3: $(cat "$f" 2>/dev/null)"; exit 1; fi
    echo "claimed $3" ;;
  pause) mkdir -p comms/pause; at=$3; [ "$at" = now ] && at=$(date -u +%Y-%m-%dT%H:%MZ)
    printf 'stop-at: %s\nreason: %s\n' "$at" "${4:-requested by user}" > "comms/pause/$2"; git add "comms/pause/$2"; git commit -qm "pause $2 at $at"; push ;;
  resume) git rm -q "comms/pause/$2"; git commit -qm "resume $2"; push ;;
  paused) # exit 0 (and print why) if comms/pause/<handle> or comms/pause/all has a stop-at time that has passed
    now=$(date -u +%Y-%m-%dT%H:%MZ)
    for f in "comms/pause/$2" comms/pause/all; do [ -f "$f" ] || continue
      at=$(sed -n 's/^stop-at: //p' "$f"); [[ ! "$now" < "$at" ]] && { echo "PAUSED ($f): $(cat "$f" | tr '\n' ' ')"; exit 0; }
      echo "pause scheduled ($f): stop at $at"; done; exit 1 ;;
  *) sed -n 2,4p "$0"; exit 2 ;;
esac
