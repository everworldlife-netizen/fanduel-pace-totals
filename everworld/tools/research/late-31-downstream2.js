#!/usr/bin/env node
/* late-31: carry-over to the stats, second stand-in: the shown REMAINING stat is scaled by the minutes ratio,
 *   stat' = so far + (shown - so far) x min(3, (minutes' - so far) / (engine minutes - so far))
 * (so "no more minutes" means "no more points"). Minutes' = state anchors (middle / mean lines) or the real minutes.
 * Also by state group at s42, to see where a stat gain exists. */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor');
const am = (r) => Math.abs(r.mg);
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
const mc = (r) => (am(r) <= 10 ? 'c' : am(r) <= 15 ? 'm' : 'd');
const stF = (r) => (r.on ? 'on' : 'off') + mc(r) + (mc(r) === 'd' ? (r.mpgOn < 20 ? 'f' : 'r') : '') + role(r);
const r26 = C.load(2026).filter((r) => r.ac && r.mn), r27 = C.load(2027).filter((r) => r.ac && r.mn);
const scale = (r, k, m2) => { const e = r.mn0 - r.now0; const q = e > 0.05 ? Math.min(3, Math.max(0, m2 - r.now0) / e) : 1; return r.now[k] + Math.max(r.pr[k] - r.now[k], 0) * q; };
for (const g of ['s36', 's42']) {
  const A = r26.filter((r) => r.g === g), B = r27.filter((r) => r.g === g), { A: h1, B: h2 } = C.splitByDate(A);
  for (const [tag, train, test] of [['H1->H2', h1, h2], ['2026->2027', A, B]]) {
    const L1 = AN.fit(train, stF, { kind: 'L1' }), L2 = AN.fit(train, stF, { kind: 'L2' });
    const T = test.filter(C.p10);
    const mins = { 'middle anchors': (r) => AN.predict(r, L1, stF), 'mean anchors': (r) => AN.predict(r, L2, stF), 'real minutes': (r) => r.ac0 };
    console.log(`${g} ${tag} (n=${T.length})`);
    for (const [mn, mf] of Object.entries(mins)) {
      const parts = [];
      for (const [k, kn] of [[1, 'PTS'], [2, 'REB'], [3, 'AST']]) {
        const m0 = C.cl(T, (r) => Math.abs(r.ac[k] - r.pr[k]), (r) => r.id).mean, d = C.cl(T, (r) => Math.abs(r.ac[k] - scale(r, k, mf(r))) - Math.abs(r.ac[k] - r.pr[k]), (r) => r.id);
        parts.push(`${kn} ${m0.toFixed(3)} -> ${(m0 + d.mean).toFixed(3)} (${(100 * d.mean / m0).toFixed(2)}%, z ${d.z.toFixed(1)})`);
      }
      console.log(`   with ${mn.padEnd(14)}: ` + parts.join(' | '));
    }
    if (g === 's42' && tag === 'H1->H2') {
      const groups = { 'off, 16+, garbage unit, usual 14+': (r) => !r.on && am(r) >= 16 && r.mpgOn < 20 && r.mpg >= 14, 'on, 16+, garbage unit, non-starter': (r) => r.on && am(r) >= 16 && r.mpgOn < 20 && r.st !== 1, 'on, 16+, regulars on, starter': (r) => r.on && am(r) >= 16 && r.mpgOn >= 20 && r.st === 1, 'off, within 10, starter': (r) => !r.on && am(r) <= 10 && r.st === 1, 'off, within 10, non-starter': (r) => !r.on && am(r) <= 10 && r.st !== 1, 'on, within 10, starter': (r) => r.on && am(r) <= 10 && r.st === 1 };
      for (const [gn, gf] of Object.entries(groups)) {
        const S = T.filter(gf); const parts = [];
        for (const [k, kn] of [[0, 'MIN'], [1, 'PTS'], [2, 'REB'], [3, 'AST']]) {
          const base = k === 0 ? (r) => r.mn0 : (r) => r.pr[k], nw = k === 0 ? (r) => AN.predict(r, L1, stF) : (r) => scale(r, k, AN.predict(r, L1, stF));
          const m0 = C.cl(S, (r) => Math.abs(r.ac[k] - base(r)), (r) => r.id).mean, d = C.cl(S, (r) => Math.abs(r.ac[k] - nw(r)) - Math.abs(r.ac[k] - base(r)), (r) => r.id);
          parts.push(`${kn} ${m0.toFixed(2)}->${(m0 + d.mean).toFixed(2)} (z ${d.z.toFixed(1)})`);
        }
        console.log(`      ${gn.padEnd(36)} n=${String(S.length).padStart(4)}: ` + parts.join(' | '));
      }
    }
  }
}
