#!/usr/bin/env bash
# The morning after a recorded night: fetch the finished games, then grade our numbers and the books' player lines
# against the results (see NOTES.md, "The books' player lines").
#   tools/nightly.sh <date of the games, YYYY-MM-DD>      SKIP_FETCH=1 to grade again without touching the feeds
# Prints: who played against what was known (last look before each tip, and two hours before), the replay of the night
# with the published engine, and the lines table over EVERY recorded night so far (tip-off, then before lineups).
set -euo pipefail
cd "$(dirname "$0")/.."
D=${1:?usage: tools/nightly.sh <date of the games, YYYY-MM-DD>}
NEXT=$(date -u -d "$D + 1 day" +%F)
SEASON=$(node -e "console.log(require('./tools/lib').seasons('$D').cur)")
ENGINE=${ENGINE:-data/engines/v18c/engine.js}
if [ -z "${SKIP_FETCH:-}" ]; then
  node tools/fetch.js "$D" "$NEXT" 2>&1 | tail -5
  node tools/fetchstats.js "$SEASON" --refresh 2>&1 | tail -1
  node tools/prep.js 2>&1 | tail -2
fi
NIGHTS=$(ls data/props | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' | awk -v d="$D" '$0 <= d' | sed 's/^/--date /' | tr '\n' ' ')
echo; echo "######## who played, every recorded night up to $D (last look before each tip)"
node tools/availgrade.js $NIGHTS --quiet
echo; echo "######## who played (what was known two hours before each tip)"
node tools/availgrade.js $NIGHTS --quiet --lead 120
echo; echo "######## replay of $D with $ENGINE"
node tools/bt2.js --engine "$ENGINE" --seasons "$SEASON" --from "$D" --to "$D" --no-playoffs --jobs 4 --nsims 500 --stages rep,0 --lessons builtin --dump "data/runs/L1-$D.rows.json.gz" --out "data/runs/L1-$D.json"
echo; echo "######## our number against the books' closing lines, every recorded night, tip-off"
node tools/propgrade.js data/runs/L1-*.rows.json.gz
echo; echo "######## the same before lineups"
node tools/propgrade.js data/runs/L1-*.rows.json.gz --stage rep | sed -n 1,16p
