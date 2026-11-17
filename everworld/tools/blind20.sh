#!/usr/bin/env bash
# The blind check of the books' line inside the number (version 20): a night the settings never saw, line off and on,
# then every recorded night together. The pass rule is in NOTES.md ("Version 20 candidate"), written before the night.
#   tools/blind20.sh <date of the blind night> [first recorded night, default 2026-11-13]
# Needs the night fetched and prepared first (tools/nightly.sh <date> does it).
set -euo pipefail
cd "$(dirname "$0")/.."
D=${1:?usage: tools/blind20.sh <date of the blind night> [first recorded night]}
FROM=${2:-2026-11-13}
ON="lineWPts=0.75,lineWReb=0.6,lineWAst=0.45,lineW3=0.45,lineFar=300,lineNear=60,lineLive=48"
OFF="lineWPts=0,lineWReb=0,lineWAst=0,lineW3=0,lineLive=0"
ENGINE=${ENGINE:-cs/build/engine.js}
run() { node tools/bt2.js --engine "$ENGINE" --seasons 2027 --from "$1" --to "$2" --no-playoffs --jobs 4 --nsims 500 --lessons builtin --stages rep,0,6,12,24 --lines closing --tune "$3" --out "$4" > "$4.log" 2>&1; }
run "$D" "$D" "$OFF" "data/runs/B20-$D-off.json"
run "$D" "$D" "$ON" "data/runs/B20-$D-on.json"
run "$FROM" "$D" "$OFF" "data/runs/B20-all-off.json"
run "$FROM" "$D" "$ON" "data/runs/B20-all-on.json"
node tools/blind20cmp.js "$D" "$FROM"
