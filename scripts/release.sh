#!/usr/bin/env bash
# Build the kit tarball from the tracked files of this repo.
# Usage: scripts/release.sh [VERSION] [--publish]    e.g. scripts/release.sh v3
#   Without --publish only vendor/past_blast-<ver>-<date>-<sha>.tar.gz is written.
#   --publish creates GitHub release <ver> on hblok/past_blast (needs gh auth; only on the user's go-ahead).
set -euo pipefail
cd "$(dirname "$0")/.."
VER=${1:-}; [ -z "$VER" ] || [ "$VER" = --publish ] && { echo "usage: $0 vN [--publish]"; exit 2; }
git diff --quiet && git diff --cached --quiet || { echo "working tree not clean"; exit 1; }
scripts/smoke.sh
SHA=$(git rev-parse --short HEAD); NAME=past_blast-$VER-$(date -u +%Y%m%d)-$SHA
mkdir -p vendor; OUT=vendor/$NAME.tar.gz
git archive --format=tar.gz --prefix="$NAME/" -o "$OUT" HEAD
echo "kit: $OUT ($(du -h "$OUT" | cut -f1), $(tar -tzf "$OUT" | wc -l) entries)"
if [ "${2:-}" = --publish ]; then
  gh release create "$VER" "$OUT" --repo hblok/past_blast --title "past_blast $VER" --notes "Kit built from $(git rev-parse HEAD). See CHANGELOG.md."
fi
