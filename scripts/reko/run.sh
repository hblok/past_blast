#!/usr/bin/env bash
# M4.3: decompile a DOS exe with Reko (needs a .NET 8 runtime; both are installed under vendor/ if missing). Generic, blind-safe.
# Usage: scripts/reko/run.sh <exe> [outdir=./reko_out] [extra reko options, default: --heuristic shingle]
# Output: <outdir>/<EXE>.reko/*.c (C per segment), *.asm, *.dis, <EXE>.h (types, huge). ~10 s.
set -euo pipefail
EXE=$(readlink -f "$1"); OUT=${2:-./reko_out}; shift 2 2>/dev/null || shift $#; OPTS=${*:---heuristic shingle}
HERE=$(cd "$(dirname "$0")" && pwd); V=$(cd "$HERE/../../vendor" 2>/dev/null && pwd || echo "$HERE/..")   # repo: vendor/; bundle: tools/
DN=$V/dotnet; RK=$V/reko/cmd
if [ ! -x "$DN/dotnet" ]; then mkdir -p "$DN"; curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$DN/install.sh"; bash "$DN/install.sh" --runtime dotnet --channel 8.0 --install-dir "$DN" >/dev/null; fi
if [ ! -f "$RK/decompile.dll" ]; then mkdir -p "$V/reko"; curl -fsSL "https://github.com/uxmal/reko/releases/download/version-0.12.5/CmdLine-0.12.5-x64-418d3538ee.zip" -o "$V/reko/cmd.zip"; unzip -q -o "$V/reko/cmd.zip" -d "$RK"; fi
mkdir -p "$OUT"; cp "$EXE" "$OUT/"; cd "$OUT"
DOTNET_ROOT=$DN DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 "$DN/dotnet" "$RK/decompile.dll" $OPTS "$(basename "$EXE")" 2>&1 | grep -v "warning: Expected sizes of arrays" | tail -5
ls -d "$OUT"/*.reko
