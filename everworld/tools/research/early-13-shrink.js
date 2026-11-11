#!/usr/bin/env node
/* early-13: is the early-game number too spread out? A free linear model per class on only [1, tip-off number, live plain
 * number, minutes so far, usual minutes] against the re-taught layer, on three populations (10+, played, listed), plus the
 * same check at tip-off itself. Shows the coefficients (taught on the first half of 2026, players who played).
 *   node tools/research/early-13-shrink.js [s6|s12|pre] */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const ST = process.argv[2] || 's6';
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const cls = (o) => (o.pre.sT === 1 ? 0 : ST === 'pre' ? 2 : o[ST].dnp === 0 ? 1 : 2);
const CN = ['starters', 'bench in', ST === 'pre' ? 'bench' : 'bench not in'];
const feats = (o) => (ST === 'pre' ? [1, o.pre.mn[0], o.pre.mpg] : [1, o.pre.mn[0], o[ST].mp, o[ST].now[0], o.pre.mpg]);
const FN = ST === 'pre' ? ['const', 'tip number', 'usual min'] : ['const', 'tip number', 'live plain', 'min so far', 'usual min'];
function fitc(tr, rule) { const out = {}; for (const c of [0, 1, 2]) { const T = tr.filter((o) => cls(o) === c && (rule === 'all' || o.ac > 0)); if (T.length < 50) continue; out[c] = C.ols(T.map(feats), T.map((o) => (o.ac > 0 ? o.ac : o[ST].now[0])), T.map((o) => o.tg), 1e-6); } return out; }
function pred(m, o) { const r = m[cls(o)]; if (!r) return o[ST].mn[0]; const x = feats(o); let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * r.beta[i]; return Math.max(o[ST].now[0], Math.min(48, p)); }
function rep(title, tr, te) {
  const mP = fitc(tr, 'played'), mA = fitc(tr, 'all');
  let layer = null; if (ST !== 'pre') { const R = Fx.prep(tr, ST), Rt = Fx.prep(te, ST); const bP = Fx.fit(R, 'played', 8), bA = Fx.fit(R, 'all', 8); layer = { P: new Map(Rt.map((q) => [q.o.k, Fx.predict(q, bP.beta)])), A: new Map(Rt.map((q) => [q.o.k, Fx.predict(q, bA.beta)])) }; }
  console.log(`\n== ${title} ==`);
  for (const [pn, pop] of [['10+', (o) => o.ac >= 10], ['played', (o) => o.ac > 0], ['listed', () => true]]) {
    for (let ci = -1; ci < 3; ci++) {
      const li = te.filter((o) => pop(o) && (ci < 0 || cls(o) === ci)); if (li.length < 30) continue;
      const m = (p) => (li.reduce((a, o) => a + Math.abs(p(o) - o.ac), 0) / li.length).toFixed(3);
      const z = (p, q) => { const mp = new Map(); for (const o of li) mp.set(o.tg, (mp.get(o.tg) || 0) + Math.abs(p(o) - o.ac) - Math.abs(q(o) - o.ac)); const arr = [...mp.values()]; const mu = arr.reduce((a, b) => a + b, 0) / arr.length; const v = arr.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (arr.length - 1); return (mu / Math.sqrt(v / arr.length)).toFixed(1); };
      console.log(`${pn.padEnd(7)} ${(ci < 0 ? 'all' : CN[ci]).padEnd(13)} n=${String(li.length).padStart(5)} | tip-off ${m((o) => o.pre.mn[0])} | engine ${m((o) => o[ST].mn[0])}${layer ? ` | layer taught played ${m((o) => layer.P.get(o.k))} all ${m((o) => layer.A.get(o.k))}` : ''} | free taught played ${m((o) => pred(mP, o))} (z vs engine ${z((o) => pred(mP, o), (o) => o[ST].mn[0])}) | free taught all ${m((o) => pred(mA, o))} (z vs engine ${z((o) => pred(mA, o), (o) => o[ST].mn[0])})`);
    }
  }
  console.log('coefficients (taught on players who played): ' + FN.join(', '));
  for (const c of [0, 1, 2]) if (mP[c]) console.log(`  ${CN[c].padEnd(13)} ${mP[c].beta.map((b, i) => `${b.toFixed(3)} (z ${mP[c].z[i].toFixed(1)})`).join('  ')}`);
  console.log('coefficients (taught on everyone listed):');
  for (const c of [0, 1, 2]) if (mA[c]) console.log(`  ${CN[c].padEnd(13)} ${mA[c].beta.map((b, i) => `${b.toFixed(3)} (z ${mA[c].z[i].toFixed(1)})`).join('  ')}`);
}
rep(`stage ${ST}: taught first half 2026 -> second half 2026`, a26.filter((o) => o.d < mid), a26.filter((o) => o.d >= mid));
rep(`stage ${ST}: taught 2026 -> 2026-27`, a26, a27);
