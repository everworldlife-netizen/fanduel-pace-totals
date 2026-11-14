#!/usr/bin/env bash
# Final exam (protocol P2): lessons from every game through 2025-26 (mid-game stages from complete 2025-26 games only),
# tested on this season's complete games, which no lesson has seen. These are the numbers the in-app report shows.
#   tools/p2.sh <name> <engine dir> [lessons file to use instead of fitting]
#   node tools/cmp.js data/runs/P2-<before>.json data/runs/P2-<after>.json
# About 25 minutes on 4 cores. Writes data/lessons/P2{M,K,H}-<name>.json, data/runs/P2-<name>.json and the row dump.
cd "$(dirname "$0")/.."
N=$1; E=$2/engine.js; ST=rep,0,6,9,12,18,21,24,30,33,36,42,45
if [ -n "$3" ]; then LES=$3; else
[ -f data/lessons/P2M-$N.json ] || LAB_DIRTY=1 node tools/fit2.js --engine $E --seasons 2024,2025,2026 --no-playoffs --jobs 4 --out data/lessons/P2M-$N.json > data/lessons/P2M-$N.log 2>&1
[ -f data/lessons/P2K-$N.json ] || node tools/fit2.js --engine $E --seasons 2026 --no-playoffs --jobs 4 --out data/lessons/P2K-$N.json > data/lessons/P2K-$N.log 2>&1
node tools/mklessons.js --base data/lessons/P2M-$N.json --mid data/lessons/P2K-$N.json --out data/lessons/P2H-$N.json
LES=data/lessons/P2H-$N.json; fi
node tools/bt2.js --engine $E --seasons 2027 --no-playoffs --jobs 4 --nsims 500 --stages $ST --lessons $LES --dump data/runs/P2-$N.rows.json.gz --out data/runs/P2-$N.json > data/runs/P2-$N.log 2>&1
echo "P2 $N done"
