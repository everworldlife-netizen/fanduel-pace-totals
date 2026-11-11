#!/usr/bin/env node
/* early-18: the two role-norm inputs as columns of the learned layer, one at a time and together, at 6 and 12 minutes.
 *   roleNormS = starts tonight      * clamp((29.5 - plain final) / max(plain remaining, 2), -1, 1.5)
 *   roleNormB = bench, checked in   * clamp((21   - plain final) / max(plain remaining, 2), -1, 2)
 * Baseline = the same 49 inputs re-taught on the same games. Taught 1st half 2026 -> tested 2nd half; taught 2026 -> 2026-27.
 *   node tools/research/early-18-spread-layer.js */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
for (const ST of ['s6', 's12']) {
  const extra = (o, st) => { const r = o[st]; const rem = Math.max(r.mp - r.now[0], 2); return [o.pre.sT === 1 ? clamp((29.5 - r.mp) / rem, -1, 1.5) : 0, o.pre.sT === 0 && r.dnp === 0 ? clamp((21 - r.mp) / rem, -1, 2) : 0]; };
  const r26 = Fx.prep(a26, ST, extra), r27 = Fx.prep(a27, ST, extra); const R1 = r26.filter((q) => q.d < mid), R2 = r26.filter((q) => q.d >= mid);
  const base = Array.from({ length: 49 }, (_, i) => i);
  console.log(`\n===== ${ST} =====`);
  for (const rule of ['all', 'played']) for (const [nm, cols] of [['roleNormS', [49]], ['roleNormB', [50]], ['both', [49, 50]]]) {
    const b0 = Fx.fit(R1, rule, 8, base), b1 = Fx.fit(R1, rule, 8, base.concat(cols)), b0f = Fx.fit(r26, rule, 8, base), b1f = Fx.fit(r26, rule, 8, base.concat(cols));
    const c = ['10+', 'listed'].map((pn) => Fx.compare(R2, (q) => Fx.predict(q, b0.beta), (q) => Fx.predict(q, b1.beta), Fx.POPS[pn]));
    const c7 = ['10+', 'listed'].map((pn) => Fx.compare(r27, (q) => Fx.predict(q, b0f.beta), (q) => Fx.predict(q, b1f.beta), Fx.POPS[pn]));
    const cls = nm === 'roleNormS' ? (q) => q.o.pre.sT === 1 && q.ac >= 10 : nm === 'roleNormB' ? (q) => q.o.pre.sT === 0 && q.o[ST].dnp === 0 && q.ac >= 10 : (q) => q.ac >= 10;
    const ci = Fx.compare(R2, (q) => Fx.predict(q, b0.beta), (q) => Fx.predict(q, b1.beta), cls), ci7 = Fx.compare(r27, (q) => Fx.predict(q, b0f.beta), (q) => Fx.predict(q, b1f.beta), cls);
    console.log(`rule ${rule.padEnd(6)} ${nm.padEnd(9)} | 2nd half 2026: 10+ ${c[0].a.toFixed(3)} -> ${c[0].b.toFixed(3)} (${c[0].pct.toFixed(2)}%, z ${c[0].z.toFixed(1)}), listed ${c[1].pct.toFixed(2)}% (z ${c[1].z.toFixed(1)}), own class 10+ ${ci.pct.toFixed(2)}% (z ${ci.z.toFixed(1)}) | 2026-27: 10+ ${c7[0].a.toFixed(3)} -> ${c7[0].b.toFixed(3)} (${c7[0].pct.toFixed(2)}%, z ${c7[0].z.toFixed(1)}), listed ${c7[1].pct.toFixed(2)}% (z ${c7[1].z.toFixed(1)}), own class 10+ ${ci7.pct.toFixed(2)}% (z ${ci7.z.toFixed(1)}) | coef ${cols.map((k) => b1f.beta[k].toFixed(3)).join(' ')}`);
  }
}
