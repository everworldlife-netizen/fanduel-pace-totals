#!/usr/bin/env bash
# Build the Courtside release from tested pieces and check it end to end.
#   tools/ship.sh <lessons.json> <before run.json> "<switches>" <train games> <findings.json> <date>
# 1. writes the lessons and switch settings into cs/build/engine.js
# 2. replays this season's games with the finished file (built-in lessons) and saves the run
# 3. writes the in-app accuracy report from the two runs
# 4. rebuilds the test fixture and runs every test suite
set -euo pipefail
cd "$(dirname "$0")/.."
LESSONS=$1; BEFORE=$2; TUNE=$3; TRAIN=$4; FINDINGS=$5; DATE=$6
node tools/mkengine.js --engine cs/build/engine.js --lessons "$LESSONS" --tune "$TUNE"
node tools/bt2.js --engine cs/build/engine.js --seasons 2027 --no-playoffs --jobs 4 --nsims 500 --stages rep,0,6,9,12,21,24,33,36,42,45 --out data/runs/ship.json | tee data/runs/ship.log
node tools/mkaccuracy.js --before "$BEFORE" --after data/runs/ship.json --train "$TRAIN" --findings "$FINDINGS" --note "$(cat cs/accuracy-note.txt)"
node tools/mkfixture.js
node cs/tests/engine.test.js | tail -2
node cs/tests/app.test.js | tail -2
node gg/tests/league-live.test.js | tail -1
node tools/mkrelease.js --date "$DATE"
