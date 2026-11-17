#!/usr/bin/env node
/* What would a final correction of the minutes be worth? (study of Nov 13, 2026)
 * Fit, on games the lessons saw (IN dump), a line real = a + b x number for the minutes still to come, by stage and role
 * (starts tonight / bench / lineup not known), then apply it to unseen games and compare the average miss.
 *   node tools/research/v18-03-calib.js <fit rows> <test rows> [<test rows> ...]
 */
'use strict';
const path = require('path');
const L = require('../lib');
const load = (f) => L.readJSON(path.resolve(f)).filter((r) => !r.un && r.ac && r.ac[0] > 0);
const st = (r) => `${r.g === 'rep' ? 'rep' : r.el}`;
const role = (r) => (r.sT === 1 ? 'S' : r.sT === 0 ? 'B' : 'U');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fitRows = load(process.argv[2]);
const fits = {};
for (const s of [...new Set(fitRows.map(st))]) for (const ro of ['S', 'B', 'U']) {
  const R = fitRows.filter((r) => st(r) === s && role(r) === ro); if (R.length < 200) continue;
  const xs = R.map((r) => r.mn[0] - r.now[0]), ys = R.map((r) => r.ac[0] - r.now[0]);
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx;
  fits[`${s}:${ro}`] = { a, b, n: R.length, shift: my - mx };
}
console.log('fitted on games the lessons saw:'); for (const [k, f] of Object.entries(fits)) console.log(`  stage ${k.padEnd(6)} real = ${f.a.toFixed(2)} + ${f.b.toFixed(3)} x number   (plain shift ${f.shift.toFixed(2)}, ${f.n} rows)`);
for (const f of process.argv.slice(3)) {
  const T = load(f);
  console.log(`\n${path.basename(f)}: minutes miss for players who played (10+ real minutes in brackets); points miss if points follow the minutes`);
  console.log('stage     rows |  as published |  shifted by role | line by role  | change (line) | PTS as published → with the line');
  for (const s of [...new Set(T.map(st))]) {
    const R = T.filter((r) => st(r) === s); if (!R.length || !['S', 'B', 'U'].some((ro) => fits[`${s}:${ro}`])) continue;
    const adj = (r, kind) => { const fk = fits[`${s}:${role(r)}`]; if (!fk) return r.mn[0]; const rem = r.mn[0] - r.now[0]; return r.now[0] + Math.max(0, kind === 'shift' ? rem + fk.shift : fk.a + fk.b * rem); };
    const mae = (g, R2) => mean(R2.map((r) => Math.abs(g(r) - r.ac[0])));
    const R10 = R.filter((r) => r.ac[0] >= 10);
    const ptsAdj = (r) => { const rem = r.mn[0] - r.now[0]; const k = rem > 0.5 ? (adj(r, 'line') - r.now[0]) / rem : 1; return r.now[1] + (r.pr[1] - r.now[1]) * k; };
    console.log(String(s).padEnd(6), String(R.length).padStart(6), '|', mae((r) => r.mn[0], R).toFixed(3), `(${mae((r) => r.mn[0], R10).toFixed(3)})`, '|', mae((r) => adj(r, 'shift'), R).toFixed(3), `(${mae((r) => adj(r, 'shift'), R10).toFixed(3)})`, '|', mae((r) => adj(r, 'line'), R).toFixed(3), `(${mae((r) => adj(r, 'line'), R10).toFixed(3)})`, '|', ((mae((r) => adj(r, 'line'), R10) / mae((r) => r.mn[0], R10) - 1) * 100).toFixed(2) + '%', '      |', mean(R10.map((r) => Math.abs(r.pr[1] - r.ac[1]))).toFixed(3), '→', mean(R10.map((r) => Math.abs(ptsAdj(r) - r.ac[1]))).toFixed(3), `(${((mean(R10.map((r) => Math.abs(ptsAdj(r) - r.ac[1]))) / mean(R10.map((r) => Math.abs(r.pr[1] - r.ac[1]))) - 1) * 100).toFixed(2)}%)`);
  }
}
