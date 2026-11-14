#!/usr/bin/env node
/* late-30: do better minutes late carry to points / rebounds / assists? The shown stat is moved by the engine's own
 * per-minute rate (rpm) times the change in minutes: stat' = shown + rate x (minutes' - engine minutes), never below the
 * stat so far. Minutes' = (a) the state anchors (24 states, middle lines, fitted on the first half of 2026), (b) the same
 * with mean lines, (c) the real minutes (the most any minutes fix could give). Second half of 2026 and 2027. */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor');
const am = (r) => Math.abs(r.mg);
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
const mc = (r) => (am(r) <= 10 ? 'c' : am(r) <= 15 ? 'm' : 'd');
const stF = (r) => (r.on ? 'on' : 'off') + mc(r) + (mc(r) === 'd' ? (r.mpgOn < 20 ? 'f' : 'r') : '') + role(r);
const r26 = C.load(2026).filter((r) => r.ac && r.mn && r.rpm), r27 = C.load(2027).filter((r) => r.ac && r.mn && r.rpm);
for (const g of ['s36', 's42']) {
  const A = r26.filter((r) => r.g === g), B = r27.filter((r) => r.g === g), { A: h1, B: h2 } = C.splitByDate(A);
  for (const [tag, train, test] of [['H1->H2', h1, h2], ['2026->2027', A, B]]) {
    const L1 = AN.fit(train, stF, { kind: 'L1' }), L2 = AN.fit(train, stF, { kind: 'L2' });
    const T = test.filter(C.p10);
    const mins = { 'middle anchors': (r) => AN.predict(r, L1, stF), 'mean anchors': (r) => AN.predict(r, L2, stF), 'real minutes': (r) => r.ac0 };
    const line = [];
    for (const [mn, mf] of Object.entries(mins)) {
      const parts = [];
      for (const [k, kn] of [[1, 'PTS'], [2, 'REB'], [3, 'AST']]) {
        const f = (r) => Math.max(r.now[k], r.pr[k] + r.rpm[k - 1] * (mf(r) - r.mn0));
        const m0 = C.cl(T, (r) => Math.abs(r.ac[k] - r.pr[k]), (r) => r.id).mean, d = C.cl(T, (r) => Math.abs(r.ac[k] - f(r)) - Math.abs(r.ac[k] - r.pr[k]), (r) => r.id);
        parts.push(`${kn} ${m0.toFixed(3)} -> ${(m0 + d.mean).toFixed(3)} (${(100 * d.mean / m0).toFixed(2)}%, z ${d.z.toFixed(1)})`);
      }
      line.push(`   with ${mn.padEnd(14)}: ` + parts.join(' | '));
    }
    console.log(`${g} ${tag} (n=${T.length})`); line.forEach((l) => console.log(l));
  }
}
