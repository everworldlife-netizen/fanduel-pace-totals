#!/usr/bin/env node
/* late-21: end of Q3. What do the trees see that the state anchors miss? Linear models for the real remaining minutes
 * (fit first half -> second half; all 2026 -> 2027), adding groups of facts one at a time:
 *   base  = engine remaining (one line for on, one for off)
 *   +lop  = margin terms by role
 *   +ton  = tonight: minutes so far, Q3 minutes, stint so far / sat for
 *   +usual= usual minutes
 * Prints the gain and the coefficients (cluster z) of the full model. */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor');
const stage = process.argv[2] || 's36', left = stage === 's36' ? 12 : 6;
const rows = C.load(2026).filter((r) => r.ac0 != null && r.g === stage), rows27 = C.load(2027).filter((r) => r.ac0 != null && r.g === stage);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const am = (r) => Math.abs(r.mg), S = (r) => (r.st === 1 ? 1 : 0), D = (r) => (r.st !== 1 && r.mpg < 14 ? 1 : 0), B = (r) => (r.st !== 1 && r.mpg >= 14 ? 1 : 0);
const lop = (r) => clamp((am(r) - 10) / 10, 0, 2);
const G = {
  base: [['1', () => 1], ['erem', (r) => r.erem], ['on', (r) => r.on], ['on*erem', (r) => r.on * r.erem]],
  lop: [['S*lop', (r) => S(r) * lop(r)], ['B*lop', (r) => B(r) * lop(r)], ['D*lop', (r) => D(r) * lop(r)], ['S*lop*on', (r) => S(r) * lop(r) * r.on], ['D*lop*on', (r) => D(r) * lop(r) * r.on], ['lop*erem', (r) => lop(r) * r.erem], ['lead', (r) => (r.mg > 10 ? 1 : 0) * lop(r)]],
  ton: [['now0', (r) => r.now0], ['q3', (r) => r.q3], ['stint(on)', (r) => (r.on ? r.stintNow : 0)], ['fullQ3', (r) => (r.on && r.stintNow >= 11.9 ? 1 : 0)], ['sat(off)', (r) => (!r.on ? Math.min(r.sitFor, 24) : 0)], ['noQ3', (r) => (r.q3 < 0.01 ? 1 : 0)]],
  usual: [['mpg', (r) => r.mpg], ['S', (r) => S(r)], ['D', (r) => D(r)], ['mpg*on', (r) => r.mpg * r.on]],
  unit: [['mpgOn*lop*on', (r) => r.on * lop(r) * (r.mpgOn - 22) / 6], ['mpgOn*lop*off', (r) => (1 - r.on) * lop(r) * (r.mpgOn - 22) / 6], ['fouls', (r) => r.pf], ['fouls5', (r) => (r.pf >= 5 ? 1 : 0)]],
};
const { A: h1, B: h2 } = C.splitByDate(rows);
let cols = [];
for (const gname of Object.keys(G)) {
  cols = cols.concat(G[gname]);
  const X = (S2) => S2.map((r) => cols.map((c) => c[1](r)));
  const o1 = C.ols(X(h1), h1.map((r) => r.rem), h1.map((r) => r.tg), 1e-6), o2 = C.ols(X(rows), rows.map((r) => r.rem), rows.map((r) => r.tg), 1e-6);
  const pr = (o) => (r) => r.now0 + clamp(cols.reduce((s, c, j) => s + o.beta[j] * c[1](r), 0), 0, left + 1);
  const c = AN.compare(h2, (r) => r.mn0, pr(o1)), d = AN.compare(rows27, (r) => r.mn0, pr(o2));
  console.log(`${stage} + ${gname.padEnd(6)} (${cols.length} terms): H1->H2 ${c.a.toFixed(3)} -> ${c.b.toFixed(3)} (${c.pct.toFixed(2)}%, z ${c.z.toFixed(1)}) | 2026->2027 ${d.a.toFixed(3)} -> ${d.b.toFixed(3)} (${d.pct.toFixed(2)}%, z ${d.z.toFixed(1)})`);
  if (gname === 'unit') console.log('  full model, all 2026: ' + cols.map((cdef, j) => `${cdef[0]} ${C.fmt(o2.beta[j], 3)} (z ${o2.z[j].toFixed(1)})`).join(', '));
}
