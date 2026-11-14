#!/usr/bin/env node
/* late-00: cut the big research dump down to the late stages (s30 kept for cross-checks, s36, s42) so later scripts load fast.
 * Usage: node tools/research/late-00-slim.js 2026 */
'use strict';
const L = require('../lib');
const season = +process.argv[2] || 2026;
const rows = L.readJSON(`${L.ROOT}/data/runs/research-${season}.rows.json.gz`);
const keep = rows.filter((r) => r.g === 's30' || r.g === 's36' || r.g === 's42' || (r.un && (r.el === 30 || r.el === 36 || r.el === 42)));
console.log(`season ${season}: ${rows.length} rows, kept ${keep.length}; un rows ${keep.filter((r) => r.un).length}`);
const by = {}; for (const r of keep) by[r.g || 'un' + r.el] = (by[r.g || 'un' + r.el] || 0) + 1; console.log(by);
console.log(JSON.stringify(keep.find((r) => r.g === 's42' && r.ac && r.ac[0] > 25)));
console.log(JSON.stringify(keep.find((r) => r.un)));
L.writeJSON(`${L.ROOT}/data/research/late-rows-${season}.json.gz`, keep);
