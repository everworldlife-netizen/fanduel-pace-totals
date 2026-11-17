#!/usr/bin/env node
/* early-10: what should the early live number be built on? The learned layer corrects a "plain" number. Three plain
 * numbers are compared, each with the same 49 inputs re-taught on the first half of 2026 and tested on the second half
 * (and taught on 2026, tested on 2026-27):
 *   live   the engine's live plain number (rotation map, as now)
 *   tip    the tip-off number (the app can recompute it at any time: it needs nothing from the game)
 *   mix    the average of the two
 * and two teaching rules (all = everyone listed, played = players who played).
 *   node tools/research/early-10-base.js [s6|s12] [lam] */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const ST = process.argv[2] || 's6'; const lam = +(process.argv[3] || 8);
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
function rowsFor(all, base) {
  const rows = Fx.prep(all, ST);
  for (const q of rows) {
    const live = q.now + q.rem, tip = Math.max(q.o.pre.mn[0], q.now + 0.01);
    const b = base === 'live' ? live : base === 'tip' ? tip : base === 'mix' ? 0.5 * live + 0.5 * tip : base === 'mixN' ? (q.o.pre.sT === 0 && q.o[ST].dnp === 1 ? tip : 0.5 * live + 0.5 * tip) : live;
    q.rem = b - q.now;
  }
  return rows;
}
const classes = { all: () => true, starters: (q) => q.o.pre.sT === 1, 'bench in': (q) => q.o.pre.sT === 0 && q.o[ST].dnp === 0, 'bench not in': (q) => q.o.pre.sT === 0 && q.o[ST].dnp === 1 };
const mae = (rows, p, pop) => { let s = 0, n = 0; for (const q of rows) if (pop(q)) { s += Math.abs(p(q) - q.ac); n++; } return s / n; };
function table(title, tr, te) {
  console.log(`\n== ${title} ==`);
  const ref = Fx.prep(te === 'H2' ? a26 : a27, ST).filter((q) => (te === 'H2' ? q.d >= mid : true));
  let s = 'reference'.padEnd(26);
  for (const [cn, cf] of Object.entries(classes)) s += ` | ${cn}: 10+ tip ${mae(ref, (q) => q.o.pre.mn[0], (q) => cf(q) && q.ac >= 10).toFixed(3)} eng ${mae(ref, (q) => q.eng, (q) => cf(q) && q.ac >= 10).toFixed(3)}`;
  console.log(s);
  console.log(`  listed: tip ${mae(ref, (q) => q.o.pre.mn[0], () => true).toFixed(3)} eng ${mae(ref, (q) => q.eng, () => true).toFixed(3)}`);
  const keep = {};
  for (const base of ['live', 'tip', 'mix', 'mixN']) for (const rule of ['all', 'played']) {
    const R26 = rowsFor(a26, base); const TR = tr === 'H1' ? R26.filter((q) => q.d < mid) : R26; const TE = te === 'H2' ? R26.filter((q) => q.d >= mid) : rowsFor(a27, base);
    const b = Fx.fit(TR, rule, lam); const p = (q) => Fx.predict(q, b.beta);
    let line = `${base}/${rule}`.padEnd(26);
    for (const [cn, cf] of Object.entries(classes)) line += ` | ${cn}: ${mae(TE, p, (q) => cf(q) && q.ac >= 10).toFixed(3)}`;
    line += ` || listed ${mae(TE, p, () => true).toFixed(3)} played ${mae(TE, p, (q) => q.ac > 0).toFixed(3)}`;
    console.log(line);
    keep[base + '/' + rule] = { TE, p };
  }
  // paired z: mix/played vs engine and vs tip-off number, 10+
  for (const k of ['live/played', 'mix/played', 'mixN/played', 'mix/all', 'mixN/all']) {
    const { TE, p } = keep[k];
    const c1 = Fx.compare(TE, (q) => q.eng, p, Fx.POPS['10+']), c2 = Fx.compare(TE, (q) => q.o.pre.mn[0], p, Fx.POPS['10+']), c3 = Fx.compare(TE, (q) => q.eng, p, Fx.POPS.listed);
    console.log(`  ${k}: 10+ vs engine ${c1.pct.toFixed(2)}% (z ${c1.z.toFixed(1)}), 10+ vs tip-off number ${c2.pct.toFixed(2)}% (z ${c2.z.toFixed(1)}), listed vs engine ${c3.pct >= 0 ? '+' : ''}${c3.pct.toFixed(2)}% (z ${c3.z.toFixed(1)})`);
  }
}
table(`stage ${ST}: taught first half 2026, tested second half 2026 (10+ miss by class)`, 'H1', 'H2');
table(`stage ${ST}: taught all 2026, tested 2026-27`, 'ALL', '2027');
