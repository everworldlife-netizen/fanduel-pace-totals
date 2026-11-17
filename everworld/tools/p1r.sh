#!/usr/bin/env bash
# Mirror of the split-season test (protocol P1r): lessons from 2023-24, 2024-25 and the part of 2025-26 AFTER Jan 17
# (mid-game stages and the team check from complete 2025-26 games after Jan 17), tested on the 585 complete 2025-26
# games BEFORE Jan 18. Used on Nov 11 as a clean test of the live team check, whose strength had been chosen with the
# other two unseen sets in view.
#   tools/p1r.sh <name> <engine dir>      then   node tools/cmp.js data/runs/P1r-<before>.json data/runs/P1r-<after>.json
cd "$(dirname "$0")/.."
N=$1; E=$2/engine.js; ST=rep,0,6,9,12,18,21,24,30,33,36,42,45
[ -f data/lessons/P1rM-$N.json ] || LAB_DIRTY=1 node tools/fit2.js --engine $E --seasons 2024,2025,2026 --xfrom 2025-10-01 --xto 2026-01-17 --no-playoffs --jobs 4 --out data/lessons/P1rM-$N.json > data/lessons/P1rM-$N.log 2>&1
[ -f data/lessons/P1rK-$N.json ] || node tools/fit2.js --engine $E --seasons 2026 --from 2026-01-18 --no-playoffs --jobs 4 --out data/lessons/P1rK-$N.json > data/lessons/P1rK-$N.log 2>&1
node tools/mklessons.js --base data/lessons/P1rM-$N.json --mid data/lessons/P1rK-$N.json --out data/lessons/P1rH-$N.json
node tools/bt2.js --engine $E --seasons 2026 --to 2026-01-17 --no-playoffs --jobs 4 --nsims 500 --stages $ST --lessons data/lessons/P1rH-$N.json --out data/runs/P1r-$N.json > data/runs/P1r-$N.log 2>&1
echo "P1r $N done"
