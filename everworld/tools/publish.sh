#!/usr/bin/env bash
# Publish a built release folder to the two Spaces and prove it is live.
#   tools/publish.sh release-2026-11-11
# One commit per Space (never file by file: a phone that updates between two uploads could save a mix of old and
# new files under the new cache name). Only the two Spaces named here are ever touched.
set -euo pipefail
cd "$(dirname "$0")/.."
REL=${1:?usage: tools/publish.sh release-<date>}
[ -f "$REL/manifest.json" ] || { echo "No such release folder: $REL"; exit 1; }
command -v hf >/dev/null || { echo "The Hugging Face CLI is not installed (pip install -U huggingface_hub)."; exit 1; }
hf auth whoami >/dev/null 2>&1 || { echo "Not signed in to Hugging Face (run: hf auth login)."; exit 1; }
# every suite must pass before anything is uploaded; the full output of each is kept, and a failed check is named
LOGS=$(mktemp -d)
for T in cs/tests/engine.test.js cs/tests/app.test.js gg/tests/league-live.test.js gg/tests/app-api.test.js gg/tests/gg-live.test.js; do
  L="$LOGS/$(echo "$T" | tr / _).log"
  if node "$T" > "$L" 2>&1; then tail -1 "$L"; else echo "FAILED: $T (full output: $L)"; grep -A4 '^FAIL' "$L" | cut -c1-400; exit 1; fi
done
for SP in courtside-arcade gg-winner; do
  [ -d "$REL/$SP" ] || continue
  hf upload "everworldlife/$SP" "$REL/$SP" . --repo-type space --commit-message "Release ${REL#release-}"
done
# a static Space needs a little while to serve the new commit
n=0; until node tools/mkrelease.js --verify "$REL" >/dev/null 2>&1 || [ $n -ge 30 ]; do n=$((n + 1)); sleep 10; done
node tools/mkrelease.js --verify "$REL"
node tools/livecheck.js
