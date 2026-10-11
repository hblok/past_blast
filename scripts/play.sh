#!/usr/bin/env bash
# Drive the game with keystrokes and screenshot after each step.
# Usage: scripts/play.sh <rundir-with-game-files> <outdir> "<dos cmd>" step...   step = "key[,key..]:wait_s" or "hold:key:secs"
# e.g. scripts/play.sh vendor/run113 runs/x GAME.EXE 15 "space:3" "Return:2" "hold:Right:1.5"
# Output: <outdir>/NN_<step>.png (first shot after the initial wait). Needs Xvfb :99 (started if missing).
set -u
D=$(cd "$1" && pwd); OUT=$2; CMD=$3; W=$4; shift 4; mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
export DISPLAY=:99; ulimit -c 0 -f 100000
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1024x768x24 >/dev/null 2>&1 & sleep 1; }
cat > "$D/dbx.conf" <<EOC
[sdl]
output=surface
[mixer]
nosound=true
[midi]
mididevice=none
[sblaster]
sbtype=none
[cpu]
cycles=max
[autoexec]
mount c "$D"
c:
$CMD
EOC
SDL_AUDIODRIVER=dummy "$(dirname "$0")/../vendor/dosbox-x-dbg" -conf "$D/dbx.conf" >"$D/dosbox.log" 2>&1 & PID=$!; disown
sleep "$W"; n=0; shot(){ import -window root "$OUT/$(printf %02d $n)_$1.png"; n=$((n+1)); }
shot start
for s in "$@"; do
  if [[ $s == hold:* ]]; then IFS=: read -r _ k t <<<"$s"; for kk in ${k//+/ }; do xdotool keydown "$kk"; done; sleep "$t"; for kk in ${k//+/ }; do xdotool keyup "$kk"; done; sleep 0.5; shot "hold_${k//+/_}"
  else k=${s%%:*}; t=${s##*:}; xdotool key --delay 150 ${k//,/ }; sleep "$t"; shot "${k//,/_}"; fi
done
kill -9 $PID 2>/dev/null
