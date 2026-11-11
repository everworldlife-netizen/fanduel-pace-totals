#!/usr/bin/env bash
# Shipping lessons (protocol P3): the same recipe with this season added. NOT a test: these lessons have seen every game.
#   tools/p3.sh <name> <engine dir>     then   node tools/mkengine.js --engine cs/build/engine.js --lessons data/lessons/H4-<name>.json
# About 25 minutes on 4 cores.
cd "$(dirname "$0")/.."
N=$1; E=$2/engine.js
[ -f data/lessons/P3M-$N.json ] || LAB_DIRTY=1 node tools/fit2.js --engine $E --seasons 2024,2025,2026,2027 --no-playoffs --jobs 4 --out data/lessons/P3M-$N.json > data/lessons/P3M-$N.log 2>&1
[ -f data/lessons/P3K-$N.json ] || node tools/fit2.js --engine $E --seasons 2026,2027 --no-playoffs --jobs 4 --out data/lessons/P3K-$N.json > data/lessons/P3K-$N.log 2>&1
node tools/mklessons.js --base data/lessons/P3M-$N.json --mid data/lessons/P3K-$N.json --out data/lessons/H4-$N.json
echo "P3 $N done"
