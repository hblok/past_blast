#!/usr/bin/env bash
# Idempotent environment setup (generic part of the kit). Downloads go to vendor/ (gitignored). Add your game data section where marked.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
V=$ROOT/vendor; mkdir -p "$V"
SUDO=""; [ "$(id -u)" != 0 ] && SUDO=sudo

# 1. apt packages (skip if everything is already there)
PKGS="xvfb xdotool imagemagick openjdk-21-jdk-headless nasm p7zip-full wget unzip curl git build-essential autoconf automake libtool pkg-config libsdl2-dev libsdl2-net-dev libpng-dev libfreetype-dev libpcap-dev libslirp-dev libfluidsynth-dev libncurses-dev libxkbfile-dev libxrandr-dev libavcodec-dev libavformat-dev libswscale-dev"
MISSING=""; for p in $PKGS; do dpkg -s "$p" >/dev/null 2>&1 || MISSING="$MISSING $p"; done
if [ -n "$MISSING" ]; then $SUDO apt-get update -qq && $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $MISSING; fi

# 2. Ghidra (latest release zip from GitHub)
if [ ! -d "$V/ghidra" ]; then
  URL=$(curl -fsS https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/latest | python3 -c "import sys,json;print([a['browser_download_url'] for a in json.load(sys.stdin)['assets'] if a['name'].endswith('.zip')][0])")
  curl -fsSL "$URL" -o "$V/ghidra.zip" && unzip -q "$V/ghidra.zip" -d "$V/ghidra.tmp" && mv "$V"/ghidra.tmp/* "$V/ghidra" && rm -rf "$V/ghidra.tmp" "$V/ghidra.zip"
fi

# 5. DOSBox-X with the debugger (apt build has none). ~5 min on 16 cores, cached in vendor/dosbox-x-dbg
# try the prebuilt release asset first (needs `gh auth login`; same OS/libs only), else build
[ -x "$V/dosbox-x-dbg" ] || { gh release download tools-dosbox-x-dbg --repo hblok/keen -p dosbox-x-dbg-linux-x86_64 -O "$V/dosbox-x-dbg" 2>/dev/null && chmod +x "$V/dosbox-x-dbg" && { "$V/dosbox-x-dbg" -version >/dev/null 2>&1 || rm -f "$V/dosbox-x-dbg"; }; } || true
if [ ! -x "$V/dosbox-x-dbg" ]; then
  [ -d "$V/dosbox-x-src/.git" ] || git clone -q --depth 1 https://github.com/joncampbell123/dosbox-x.git "$V/dosbox-x-src"
  (cd "$V/dosbox-x-src" && ./configure --enable-debug=heavy --enable-sdl2 >"$V/dbx-configure.log" 2>&1 && make -j"$(nproc)" >"$V/dbx-make.log" 2>&1 && strip -o "$V/dosbox-x-dbg" src/dosbox-x && rm -rf "$V/dosbox-x-src")   # M0.4: the build tree is ~1.3 GB; keep only the binary
fi


# 3./4. GAME DATA: download or copy your own copy of the game into vendor/ here (LZEXE/PKLITE: run scripts/unlzexe.py). Nothing copyrighted is committed.

# 6. Report
for t in Xvfb xdotool import java nasm 7z; do printf "%-10s %s\n" $t "$(command -v $t || echo MISSING)"; done
ls -d "$V"/dosbox-x-dbg "$V"/ghidra
"$V/dosbox-x-dbg" -version 2>&1 | head -1
