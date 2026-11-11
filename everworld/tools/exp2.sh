#!/usr/bin/env bash
# One experiment on a frozen copy of an engine: learn lessons on some seasons, test on others (unseen).
#   tools/exp2.sh <name> <engine dir (holds engine.js + sitprior.js)> <tune or -> <train seasons> <test seasons> [extra fit2 flags...]
# The engine folder is copied to data/engines/<name>/ first, so later edits cannot change a running experiment.
# Env: STAGES (test moments), NSIMS, LESSONS=<name> to reuse another experiment's lessons (test only).
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=$1; SRC=$2; TUNE=$3; TRAIN=$4; TEST=$5; shift 5
T=(); [ "$TUNE" != "-" ] && T=(--tune "$TUNE")
STAGES=${STAGES:-rep,0,6,9,12,21,24,33,36,42,45}
NS=${NSIMS:-500}
LES=${LESSONS:-$NAME}
mkdir -p data/lessons data/runs "data/engines/$NAME"
cp "$SRC/engine.js" "$SRC/sitprior.js" "data/engines/$NAME/"
ENGINE="data/engines/$NAME/engine.js"
if [ ! -f "data/lessons/$LES.json" ]; then
  node tools/fit2.js --engine "$ENGINE" --seasons "$TRAIN" --no-playoffs --jobs 4 --out "data/lessons/$LES.json" "${T[@]}" "$@" 2>&1 | tee "data/lessons/$LES.log"
fi
node tools/bt2.js --engine "$ENGINE" --seasons "$TEST" --no-playoffs --jobs 4 --nsims "$NS" --stages "$STAGES" --lessons "data/lessons/$LES.json" --out "data/runs/$NAME.json" "${T[@]}" 2>&1 | tee "data/runs/$NAME.log"
