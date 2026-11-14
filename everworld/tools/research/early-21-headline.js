#!/usr/bin/env node
/* early-21: headline. The 6- and 12-minute number with (a) the role-norm correction for starters and checked-in bench
 * (fitted on the first half of 2026 / on all 2026 for 2026-27) and (b) the tip-off number held for bench players not yet in.
 * Miss for 10+ players and for everyone listed, against the engine's number and the tip-off number. */
'use strict';
const C = require('./early-common');
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const mae = (li, p) => li.reduce((a, o) => a + Math.abs(p(o) - o.ac), 0) / li.length;
for (const ST of ['s6', 's12']) {
  const cls = (o) => (o.pre.sT === 1 ? 'S' : o[ST].dnp === 0 ? 'I' : 'N');
  const fit = (tr) => { const m = {}; for (const [c, piv] of [['S', 29.5], ['I', 21]]) { const li = tr.filter((o) => cls(o) === c && o.ac > 0); m[c] = C.ols(li.map((o) => [1, o[ST].mn[0] - piv]), li.map((o) => o.ac - o[ST].mn[0]), li.map((o) => o.tg)).beta; } return m; };
  for (const [lab, tr, te] of [['2nd half 2026 (fit 1st half)', a26.filter((o) => o.d < mid), a26.filter((o) => o.d >= mid)], ['2026-27 (fit 2026)', a26, a27]]) {
    const m = fit(tr);
    const norm = (o) => { const c = cls(o); return o[ST].pr[0] + (c === 'S' ? m.S[0] + m.S[1] * (o[ST].mn[0] - 29.5) : c === 'I' ? m.I[0] + m.I[1] * (o[ST].mn[0] - 21) : 0); };
    const normHold = (o) => (cls(o) === 'N' ? o.pre.pr[0] : norm(o));
    const t10 = te.filter((o) => o.ac >= 10);
    const z = (p, q, li) => { const mp = new Map(); for (const o of li) mp.set(o.pre.id, (mp.get(o.pre.id) || 0) + Math.abs(p(o) - o.ac) - Math.abs(q(o) - o.ac)); const arr = [...mp.values()]; const mu = arr.reduce((x, y) => x + y, 0) / arr.length; const v = arr.reduce((x, y) => x + (y - mu) * (y - mu), 0) / (arr.length - 1); return (mu / Math.sqrt(v / arr.length)).toFixed(1); };
    console.log(`${ST} ${lab}: 10+ tip-off ${mae(t10, (o) => o.pre.pr[0]).toFixed(3)} | engine ${mae(t10, (o) => o[ST].pr[0]).toFixed(3)} | role norms ${mae(t10, norm).toFixed(3)} (z vs engine ${z(norm, (o) => o[ST].pr[0], t10)}, by game) | role norms + hold ${mae(t10, normHold).toFixed(3)} (z vs engine ${z(normHold, (o) => o[ST].pr[0], t10)}; z vs tip-off ${z(normHold, (o) => o.pre.pr[0], t10)}) || listed: engine ${mae(te, (o) => o[ST].pr[0]).toFixed(3)} | role norms ${mae(te, norm).toFixed(3)} | role norms + hold ${mae(te, normHold).toFixed(3)}`);
  }
}
