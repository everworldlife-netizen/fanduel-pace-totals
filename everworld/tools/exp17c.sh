#!/usr/bin/env bash
# Version 17, cross-fade window (after tools/exp17b.sh): the first round said the earlier the 30-minute lessons come in the
# better, so four more windows, chosen on P1 (every second game after Jan 18, 2026) and confirmed on P2 (this season).
cd "$(dirname "$0")/.."
N=${1:-v17a}; E=data/engines/$N/engine.js; ST=24.5,25,25.5,26,26.5,27,27.5
run() { local set=$1 name=$2 tune=$3 out=data/runs/S17-$1-$2.json; [ -f $out ] && return
  if [ $set = P1 ]; then node tools/bt2.js --engine $E --seasons 2026 --from 2026-01-18 --no-playoffs --every 2 --jobs 4 --nsims 500 --stages $ST --lessons data/lessons/P1H-$N.json --tune $tune --out $out > ${out%.json}.log 2>&1
  else node tools/bt2.js --engine $E --seasons 2027 --no-playoffs --jobs 4 --nsims 500 --stages $ST --lessons data/lessons/P2H-$N.json --tune $tune --out $out > ${out%.json}.log 2>&1; fi
  echo "$set $name done"; }
for S in P1 P2; do
  run $S w-old minXa=27,minXb=27
  run $S w255-275 minXa=25.5,minXb=27.5
  run $S w245-265 minXa=24.5,minXb=26.5
  run $S w24-265 minXa=24,minXb=26.5
  run $S w24-26 minXa=24,minXb=26
  run $S w245-26 minXa=24.5,minXb=26
  run $S w24-27 minXa=24,minXb=27
  run $S w24-255 minXa=24,minXb=25.5
done
echo "window tests done"
