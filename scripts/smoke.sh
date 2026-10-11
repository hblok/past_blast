#!/usr/bin/env bash
# Syntax and self-tests for the kit (same checks the v2 export ran). No emulator or game data needed.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m py_compile harness/*.py scripts/*.py port_kit/py/*.py port_kit/examples/wolf3d/tools/*.py port_kit/examples/wolf3d/checks/*.py
for f in port_kit/js/*.mjs port_kit/js/*.js port_kit/examples/*.mjs port_kit/examples/wolf3d/*/*.mjs port_kit/examples/wolf3d/port_src/*.js; do node --check "$f"; done
for f in scripts/*.sh scripts/*/*.sh; do bash -n "$f"; done
python3 harness/script.py >/dev/null
sh port_kit/selftest.sh >/dev/null
python3 harness/replay.py --help >/dev/null
python3 harness/compare.py --help >/dev/null
find . -name __pycache__ -prune -exec rm -rf {} +
echo "smoke ok"
