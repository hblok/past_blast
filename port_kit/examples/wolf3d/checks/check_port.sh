#!/bin/sh
# runs every check of the HTML/JS port (needs node and vendor/ref data); exits non-zero on the first failure
set -e
cd "$(dirname "$0")/.."
python3 scripts/check_port_map.py
for t in check_move check_door check_world check_items check_enemy check_boss check_door_los check_bosses check_menu check_sound check_session; do echo "== $t"; node port/$t.mjs | tail -1; done
echo "== enemy oracle"; node port/check_enemy_oracle.mjs port/ref/door_wait_objs.jsonl port/ref/door_wait.txt
node port/check_enemy_oracle.mjs port/ref/route_l1_guard_objs.jsonl port/ref/route_l1_guard.txt
for f in port/ref/oracle_*_objs.jsonl.gz; do n=$(basename $f _objs.jsonl.gz); echo "== oracle $n"; node port/check_enemy_oracle.mjs $f harness/games/wolf3d/scenarios/$n.txt; done
