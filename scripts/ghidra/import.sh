#!/usr/bin/env bash
# M4.2: headless Ghidra import + auto-analysis of a 16-bit DOS MZ executable, then a generic report.
# Usage: scripts/ghidra/import.sh <exe> [projectdir=./ghidra_proj] [name=target] [ghidra=vendor/ghidra or tools/ghidra]
# Output: <projectdir>/<name>.gpr (open later with analyzeHeadless -process or the GUI) and <projectdir>/<name>_info.txt
# Knows nothing about the program being analysed (usable by blind agents). Language: x86:LE:16:Real Mode (segmented, MZ loader applies relocations).
set -euo pipefail
EXE=$(readlink -f "$1"); P=${2:-./ghidra_proj}; N=${3:-target}
HERE=$(cd "$(dirname "$0")" && pwd)
G=${4:-}; for c in "$G" "$HERE/../../vendor/ghidra" "$HERE/../../tools/ghidra" "$HERE/../tools/ghidra"; do [ -n "$c" ] && [ -x "$c/support/analyzeHeadless" ] && G=$c && break; done
[ -x "$G/support/analyzeHeadless" ] || { echo "ghidra not found (pass it as 4th arg)"; exit 1; }
mkdir -p "$P"; rm -rf "$P/$N.rep" "$P/$N.gpr"
"$G/support/analyzeHeadless" "$P" "$N" -import "$EXE" -processor "x86:LE:16:Real Mode" -overwrite \
   -scriptPath "$HERE" -postScript ExportInfo.java "$P/${N}_info.txt" 2>&1 | grep -v "^INFO  (HeadlessAnalyzer)\|^$" | tail -25
echo "report: $P/${N}_info.txt"; tail -3 "$P/${N}_info.txt"
