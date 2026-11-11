#!/usr/bin/env bash
# Split-season test (protocol P1): lessons from every game before 2026-01-18 (mid-game stages from complete 2025-26
# games only), tested on the 592 complete games after. Both engines under comparison are taught the same way.
#   tools/p1.sh <name> <engine dir>         e.g.  tools/p1.sh anch1 data/engines/anch1
#   node tools/cmp.js data/runs/P1-<before>.json data/runs/P1-<after>.json
# About 22 minutes on 4 cores. Writes data/lessons/P1{M,K,H}-<name>.json and data/runs/P1-<name>.json.
cd "$(dirname "$0")/.."
N=$1; E=$2/engine.js; ST=rep,0,6,9,12,18,21,24,30,33,36,42,45
[ -f data/lessons/P1M-$N.json ] || LAB_DIRTY=1 node tools/fit2.js --engine $E --seasons 2024,2025,2026 --to 2026-01-17 --no-playoffs --jobs 4 --out data/lessons/P1M-$N.json > data/lessons/P1M-$N.log 2>&1
[ -f data/lessons/P1K-$N.json ] || node tools/fit2.js --engine $E --seasons 2026 --to 2026-01-17 --no-playoffs --jobs 4 --out data/lessons/P1K-$N.json > data/lessons/P1K-$N.log 2>&1
node tools/mklessons.js --base data/lessons/P1M-$N.json --mid data/lessons/P1K-$N.json --out data/lessons/P1H-$N.json
node tools/bt2.js --engine $E --seasons 2026 --from 2026-01-18 --no-playoffs --jobs 4 --nsims 500 --stages $ST --lessons data/lessons/P1H-$N.json ${DUMP:+--dump data/runs/P1-$N.rows.json.gz} --out data/runs/P1-$N.json > data/runs/P1-$N.log 2>&1
echo "P1 $N done"
