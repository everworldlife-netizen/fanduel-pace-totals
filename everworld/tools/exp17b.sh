#!/usr/bin/env bash
# Version 17 switch tests (run after tools/exp17.sh): each new switch against the same engine with it off, at the game
# minutes it touches, on unseen games. Chosen on the split-season set (P1: lessons before Jan 18 2026, every second game of
# the 592 after), then confirmed on this season's 121 games (P2). Results: data/runs/S17-<set>-<name>.json
#   node tools/cmp.js data/runs/S17-P1-base.json data/runs/S17-P1-<name>.json
cd "$(dirname "$0")/.."
N=${1:-v17a}; E=data/engines/$N/engine.js
ALL=1.5,3,4.5,9,15,18,20.5,21,25,25.5,26,26.5,27,27.5,28,33,39
run() { # set name stages tune
  local set=$1 name=$2 st=$3 tune=$4 out=data/runs/S17-$1-$2.json
  [ -f $out ] && return
  if [ $set = P1 ]; then node tools/bt2.js --engine $E --seasons 2026 --from 2026-01-18 --no-playoffs --every 2 --jobs 4 --nsims 500 --stages $st --lessons data/lessons/P1H-$N.json ${tune:+--tune $tune} --out $out > ${out%.json}.log 2>&1
  else node tools/bt2.js --engine $E --seasons 2027 --no-playoffs --jobs 4 --nsims 500 --stages $st --lessons data/lessons/P2H-$N.json ${tune:+--tune $tune} --out $out > ${out%.json}.log 2>&1; fi
  echo "$set $name done"
}
for S in P1 P2; do
  run $S base $ALL ""
  run $S xold 25,25.5,26,26.5,27,27.5,28 minXa=27,minXb=27
  run $S x25-265 25,25.5,26,26.5,27,27.5,28 minXa=25,minXb=26.5
  run $S x25-27 25,25.5,26,26.5,27,27.5,28 minXa=25,minXb=27
  run $S x245-265 25,25.5,26,26.5,27,27.5,28 minXa=24.5,minXb=26.5
  run $S x26-28 25,25.5,26,26.5,27,27.5,28 minXa=26,minXb=28
  run $S pace0 3,4.5 paceFade=0
  run $S land0 1.5,3,4.5,9,15,18,20.5,21,27,33,39 landInterp=0
  run $S land18 15,18,20.5,21 land18=0.25
  run $S tip150 1.5,3,4.5 tipSims=150
done
# the app as it was before version 15 (the "before" of the in-app report), on its own history, graded against the corrected box scores
[ -f data/runs/H2-baset.json ] || LAB_DERIVED=data/derived-v16 LAB_TRUTH=data/derived node tools/bt2.js --engine data/engines/A2-base/engine.js --seasons 2027 --no-playoffs --jobs 4 --nsims 500 --stages 0,12,24,36,42 --lessons data/lessons/H2-base.json --out data/runs/H2-baset.json > data/runs/H2-baset.log 2>&1
echo "switch tests done"
