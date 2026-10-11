#!/usr/bin/env bash
# Interactive play session: one persistent DOSBox-X, you send keys and look at cropped screenshots.
# scripts/sess.sh start <rundir> <outdir> [dos cmd=GAME.EXE]   # launches, waits 10 s
# scripts/sess.sh key <key..>        # tap keys (xdotool names: space Return ctrl alt Left ...), then shot
# scripts/sess.sh hold <key[+key]> <secs>   # hold, then shot
# scripts/sess.sh shot [name]        # crop of the 640x400 game area -> <outdir>/NNN_name.png, prints path
# scripts/sess.sh cheat g|i|j|p|s    # F10+key debug cheats (see analysis/gameplay/REFERENCE.md)
# scripts/sess.sh warp <0-16> [wait]  # F10+W level warp
# scripts/sess.sh stop
S=/tmp/game_sess; export DISPLAY=:99; here=$(cd "$(dirname "$0")" && pwd)
shot(){ n=$(cat $S/n 2>/dev/null || echo 0); f="$(cat $S/out)/$(printf %03d $n)_${1:-shot}.png"; import -window root -crop 640x400+192+200 +repage "$f"; echo $((n+1)) > $S/n; echo "$f"; }
case $1 in
 start) mkdir -p $S "$3"; D=$(cd "$2" && pwd); echo "$(cd "$3" && pwd)" > $S/out; echo 0 > $S/n; ulimit -c 0 -f 100000
  pgrep -x Xvfb >/dev/null || { Xvfb :99 -screen 0 1024x768x24 >/dev/null 2>&1 & sleep 1; }
  printf '[sdl]\noutput=surface\n[mixer]\nnosound=true\n[midi]\nmididevice=none\n[sblaster]\nsbtype=none\n[cpu]\ncycles=max\n[autoexec]\nmount c "%s"\nc:\n%s\n' "$D" "${4:-GAME.EXE}" > "$D/dbx.conf"
  SDL_AUDIODRIVER=dummy "$here/../vendor/dosbox-x-dbg" -conf "$D/dbx.conf" >"$D/dosbox.log" 2>&1 & echo $! > $S/pid; disown; sleep 10; shot start;;
 key) shift; for k in "$@"; do xdotool key --delay 150 $k; sleep 0.4; done; sleep 0.6; shot "key_${*// /_}";;
 hold) for kk in ${2//+/ }; do xdotool keydown $kk; done; sleep $3; for kk in ${2//+/ }; do xdotool keyup $kk; done; sleep 0.4; shot "hold_${2//+/_}";;
 cheat) xdotool keydown F10; sleep 0.3; xdotool keydown $2; sleep 0.15; xdotool keyup $2; sleep 0.3; xdotool keyup F10; sleep 0.5; shot "cheat_$2";;  # F10+<key>: g god, i items, j fly, p pause, s slow
 warp) xdotool keydown F10; sleep 0.3; xdotool keydown w; sleep 0.15; xdotool keyup w; sleep 0.3; xdotool keyup F10; sleep 0.5; for _ in 1 2 3 4; do xdotool key BackSpace; done; for c in $(echo $2 | sed 's/./& /g'); do xdotool key $c; sleep 0.2; done; xdotool key Return; sleep ${3:-8}; shot "warp_$2";;  # level 0-16
 shot) shot "$2";;
 stop) kill -9 "$(cat $S/pid)" 2>/dev/null; echo stopped;;
esac
