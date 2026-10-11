#!/usr/bin/env bash
# Run a DOS command headless in vendor/dosbox-x-dbg and screenshot the result.
# Usage: scripts/run_dosbox.sh <dir-to-mount-as-C> "<dos command>" [seconds=10] [keys-to-send...]
# Output: <dir>/shot.png (and shot_after_keys.png if keys given). Needs Xvfb (setup.sh installs it).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); D=$(cd "$1" && pwd); CMD=$2; SECS=${3:-10}; shift $(( $# > 3 ? 3 : $# ))
export DISPLAY=:99
ulimit -c 0 -f 100000  # a DOSBox-X crash otherwise leaves ~500 MB core files in the cwd
pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1024x768x24 >/dev/null 2>&1 & sleep 1; }
# LESSON: with a real/ALSA audio device the debug build SEGFAULTS at startup. Dummy audio + no MIDI/SB avoids it.
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
SDL_AUDIODRIVER=dummy "$ROOT/vendor/dosbox-x-dbg" -conf "$D/dbx.conf" >"$D/dosbox.log" 2>&1 &
PID=$!; disown; sleep "$SECS"; import -window root "$D/shot.png"
if [ $# -gt 0 ]; then xdotool key "$@"; sleep 3; import -window root "$D/shot_after_keys.png"; fi
# LESSON: plain SIGTERM does not stop DOSBox-X reliably, and `wait` then hangs forever; use -9, no wait.
kill -9 $PID 2>/dev/null || true
