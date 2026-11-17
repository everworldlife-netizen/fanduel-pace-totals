#!/usr/bin/env bash
# Version 17 lab chain (Nov 12, 2026): the play-by-play box now counts every made three (one in ten was missing), so the
# prepared games were rebuilt (data/derived; the old ones are kept in data/derived-v16) and every lesson is fitted again.
#   1. final exam (P2) with the new engine, new history, new lessons
#   2. the published engine (anch10) as it runs on phones today: its own history and lessons, graded against the corrected boxes
#   3. the same pair on the split-season set (P1)
#   4. shipping lessons (P3)
cd "$(dirname "$0")/.."
N=${1:-v17a}; ED=data/engines/$N; ST=rep,0,6,9,12,18,21,24,30,33,36,42,45
tools/p2.sh $N $ED
LAB_DERIVED=data/derived-v16 LAB_TRUTH=data/derived node tools/bt2.js --engine data/engines/anch10/engine.js --seasons 2027 --no-playoffs --jobs 4 --nsims 500 --stages $ST --lessons data/lessons/P2H-anch7.json --out data/runs/P2-anch10t.json > data/runs/P2-anch10t.log 2>&1
echo "P2 before (anch10 on corrected truth) done"
tools/p1.sh $N $ED
LAB_DERIVED=data/derived-v16 LAB_TRUTH=data/derived node tools/bt2.js --engine data/engines/anch10/engine.js --seasons 2026 --from 2026-01-18 --no-playoffs --jobs 4 --nsims 500 --stages $ST --lessons data/lessons/P1H-anch1.json --out data/runs/P1-anch10t.json > data/runs/P1-anch10t.log 2>&1
echo "P1 before (anch10 on corrected truth) done"
tools/p3.sh $N $ED
echo "chain done"
