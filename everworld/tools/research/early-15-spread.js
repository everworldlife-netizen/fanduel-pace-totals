#!/usr/bin/env node
/* early-15: is the engine's minutes number too spread out, by class and stage? gap (real - engine average) regressed on
 * the engine number (centred), clustered by team-game. Classes: starters tonight; bench players who have checked in;
 * bench players not yet in (played>0 view and everyone-listed view). All stages of the dump, both seasons.
 *   node tools/research/early-15-spread.js */
'use strict';
const C = require('./early-common');
for (const season of ['2026', '2027']) {
  const rows = C.L.readJSON(`${C.L.ROOT}/data/runs/research-${season}.rows.json.gz`).filter((r) => !r.un && r.mn);
  // need sT at live stages: carried in the row (sT)
  console.log(`\n=== season ${season} ===`);
  for (const g of ['pre', 's6', 's12', 's18', 's24', 's30', 's36']) {
    const R = rows.filter((r) => r.g === g);
    const classes = { starters: (r) => r.sT === 1 && r.ac && r.ac[0] > 0, 'bench in': (r) => r.sT === 0 && (g === 'pre' ? false : r.dnp === 0) && r.ac && r.ac[0] > 0, 'bench not in (played)': (r) => r.sT === 0 && (g === 'pre' || r.dnp === 1) && r.ac && r.ac[0] > 0, 'bench not in (listed)': (r) => r.sT === 0 && (g === 'pre' || r.dnp === 1) };
    let line = g.padEnd(4);
    for (const [cn, cf] of Object.entries(classes)) {
      const li = R.filter(cf); if (li.length < 100) { line += ` | ${cn}: n=${li.length}`; continue; }
      const mu = li.reduce((a, r) => a + r.mn[0], 0) / li.length;
      const res = C.ols(li.map((r) => [1, r.mn[0] - mu]), li.map((r) => (r.ac ? r.ac[0] : r.now[0]) - r.mn[0]), li.map((r) => r.id + ':' + r.tm));
      // remaining-minutes version: gap vs remaining projected
      line += ` | ${cn}: n=${li.length} mean# ${mu.toFixed(1)} a ${res.beta[0] >= 0 ? '+' : ''}${res.beta[0].toFixed(2)} b ${res.beta[1].toFixed(3)} (z ${res.z[1].toFixed(1)})`;
    }
    console.log(line);
  }
}
// bins for bench in at s6 / s12 (2026 and 2027)
for (const season of ['2026', '2027']) {
  const all = C.load(season);
  for (const ST of ['s6', 's12']) {
    console.log(`\n-- ${season} ${ST}: bench players who have checked in, by engine number --`);
    for (const [lo, hi] of [[0, 10], [10, 14], [14, 18], [18, 22], [22, 26], [26, 30], [30, 50]]) {
      const li = all.filter((o) => o.pre.sT === 0 && o[ST].dnp === 0 && o[ST].mn[0] >= lo && o[ST].mn[0] < hi); if (li.length < 15) continue;
      const g = C.cl(li, (o) => o.ac - o[ST].mn[0]);
      console.log(`  number ${String(lo).padStart(2)}-${String(hi).padEnd(2)} n=${String(li.length).padStart(5)} engine ${(li.reduce((a, o) => a + o[ST].mn[0], 0) / li.length).toFixed(1)} tip-off# ${(li.reduce((a, o) => a + o.pre.mn[0], 0) / li.length).toFixed(1)} usual ${(li.reduce((a, o) => a + o.pre.mpg, 0) / li.length).toFixed(1)} real ${(li.reduce((a, o) => a + o.ac, 0) / li.length).toFixed(1)} gap ${g.mean >= 0 ? '+' : ''}${g.mean.toFixed(2)} (z ${g.z.toFixed(1)}) miss(10+) ${(li.filter((o) => o.ac >= 10).reduce((a, o) => a + Math.abs(o[ST].pr[0] - o.ac), 0) / Math.max(1, li.filter((o) => o.ac >= 10).length)).toFixed(2)}`);
    }
  }
}
