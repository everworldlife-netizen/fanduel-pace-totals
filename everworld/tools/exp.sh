#!/usr/bin/env bash
# One experiment: learn lessons on some seasons, test on others (unseen), with one engine and one set of switches.
#   tools/exp.sh <name> <engine.js> <tune or -> <train seasons> <test seasons> [extra fit2 flags...]
# Writes data/lessons/<name>.json and data/runs/<name>.json (+ .log). Compare two with tools/cmp.js.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=$1; ENGINE=$2; TUNE=$3; TRAIN=$4; TEST=$5; shift 5
T=(); [ "$TUNE" != "-" ] && T=(--tune "$TUNE")
STAGES=${STAGES:-rep,0,6,9,12,21,24,33,36,42,45}
NS=${NSIMS:-500}
mkdir -p data/lessons data/runs
if [ ! -f "data/lessons/$NAME.json" ]; then
  node tools/fit2.js --engine "$ENGINE" --seasons "$TRAIN" --no-playoffs --jobs 4 --out "data/lessons/$NAME.json" "${T[@]}" "$@" 2>&1 | tee "data/lessons/$NAME.log"
fi
node tools/bt2.js --engine "$ENGINE" --seasons "$TEST" --no-playoffs --jobs 4 --nsims "$NS" --stages "$STAGES" --lessons "data/lessons/$NAME.json" --out "data/runs/$NAME.json" "${T[@]}" 2>&1 | tee "data/runs/$NAME.log"
