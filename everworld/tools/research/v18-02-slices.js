#!/usr/bin/env node
/* Where is the tip-off minutes miss, and how much of the middle should the shown number hold? (study of Nov 13, 2026)
 *   node tools/research/v18-02-slices.js <rows dump> [stage]
 */
'use strict';
const path = require('path');
const L = require('../lib');
const rows = L.readJSON(path.resolve(process.argv[2])).filter((r) => !r.un);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const st = (r) => `${r.g === 'rep' ? 'rep' : r.el}`;
const only = process.argv[3] || '0';
const R0 = rows.filter((r) => st(r) === only);
console.log(`stage ${only}: ${R0.length} rows with a number; ${R0.filter((r) => r.ac && r.ac[0] > 0).length} played`);
const slice = (title, key, R) => {
  console.log(`\n${title} (real minus plain average; + = number too low)`);
  console.log('group                 rows  played% |  MIN: number  real(if played)  miss   miss counting no-shows as 0 |  PTS miss(if played) | REB    AST');
  const by = new Map(); for (const r of R) { const k = key(r); if (k == null) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
  for (const [k, G] of [...by.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))) {
    const P = G.filter((r) => r.ac && r.ac[0] > 0);
    console.log(String(k).padEnd(20), String(G.length).padStart(6), (100 * P.length / G.length).toFixed(0).padStart(6) + '%', '|', mean(P.map((r) => r.mn[0])).toFixed(1).padStart(8), mean(P.map((r) => r.ac[0])).toFixed(1).padStart(12), mean(P.map((r) => r.ac[0] - r.mn[0])).toFixed(2).padStart(10), mean(G.map((r) => (r.ac ? r.ac[0] : 0) - r.mn[0])).toFixed(2).padStart(12), '                 |', mean(P.map((r) => r.ac[1] - r.mn[1])).toFixed(2).padStart(8), '            |', mean(P.map((r) => r.ac[2] - r.mn[2])).toFixed(2), mean(P.map((r) => r.ac[3] - r.mn[3])).toFixed(2));
  }
};
slice('BY ROLE TONIGHT', (r) => (r.sT === 1 ? '1 starts tonight' : r.sT === 0 ? '2 on the bench' : '3 lineup not known'), R0);
slice('BY PROJECTED MINUTES', (r) => { const m = r.mn[0]; return m < 8 ? '00-08' : m < 14 ? '08-14' : m < 20 ? '14-20' : m < 26 ? '20-26' : m < 32 ? '26-32' : '32+'; }, R0);
slice('BENCH ONLY, BY PROJECTED MINUTES', (r) => { if (r.sT !== 0) return null; const m = r.mn[0]; return m < 8 ? '00-08' : m < 14 ? '08-14' : m < 20 ? '14-20' : m < 26 ? '20-26' : '26+'; }, R0);
slice('STARTERS ONLY, BY PROJECTED MINUTES', (r) => { if (r.sT !== 1) return null; const m = r.mn[0]; return m < 26 ? 'under 26' : m < 30 ? '26-30' : m < 34 ? '30-34' : '34+'; }, R0);
slice('HOME / AWAY', (r) => (r.hm ? 'home' : 'away'), R0);
slice('BY BLOWOUT CHANCE', (r) => (r.pB == null ? null : r.pB < 0.2 ? 'under 20%' : r.pB < 0.35 ? '20-35%' : r.pB < 0.5 ? '35-50%' : '50%+'), R0);
