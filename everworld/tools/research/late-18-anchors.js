#!/usr/bin/env node
/* late-18: how much of the tree ceiling do simple state anchors get? Several state definitions, L2 and L1 lines,
 * first half of 2026 -> second half and all 2026 -> 2027. */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor');
const rows = C.load(2026).filter((r) => r.ac0 != null), rows27 = C.load(2027).filter((r) => r.ac0 != null);
const am = (r) => Math.abs(r.mg);
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
const mc = (r) => (am(r) <= 10 ? 'c' : am(r) <= 15 ? 'm' : 'd');
const unit = (r) => (r.mpgOn < 20 ? 'f' : 'r');
const DEFS = {
  'one line per stage': (r) => 'all',
  'on/off': (r) => (r.on ? 'on' : 'off'),
  'on/off x margin class': (r) => (r.on ? 'on' : 'off') + mc(r),
  'on/off x margin class x unit(16+)': (r) => (r.on ? 'on' : 'off') + mc(r) + (mc(r) === 'd' ? unit(r) : ''),
  'on/off x margin class x unit(16+) x role': (r) => (r.on ? 'on' : 'off') + mc(r) + (mc(r) === 'd' ? unit(r) : '') + role(r),
  'on/off x margin(5 bands signed) x unit x role': (r) => (r.on ? 'on' : 'off') + (am(r) <= 10 ? 'c' : am(r) <= 15 ? 'm' + Math.sign(r.mg) : am(r) <= 20 ? 'd' + Math.sign(r.mg) + unit(r) : 'b' + Math.sign(r.mg) + unit(r)) + role(r),
};
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g), B27 = rows27.filter((r) => r.g === g), { A: h1, B: h2 } = C.splitByDate(A);
  console.log(`\n== ${g}`);
  for (const [nm, f] of Object.entries(DEFS)) for (const kind of ['L2', 'L1']) {
    const l1 = AN.fit(h1, f, { kind }), l2 = AN.fit(A, f, { kind });
    const c = AN.compare(h2, (r) => r.mn0, (r) => AN.predict(r, l1, f)), d = AN.compare(B27, (r) => r.mn0, (r) => AN.predict(r, l2, f));
    console.log(`  ${nm.padEnd(46)} ${kind} states ${String(l1.size).padStart(3)}: H1->H2 ${c.a.toFixed(3)} -> ${c.b.toFixed(3)} (${c.pct.toFixed(2)}%, z ${c.z.toFixed(1)}) | 2026->2027 ${d.a.toFixed(3)} -> ${d.b.toFixed(3)} (${d.pct.toFixed(2)}%, z ${d.z.toFixed(1)})`);
  }
}
