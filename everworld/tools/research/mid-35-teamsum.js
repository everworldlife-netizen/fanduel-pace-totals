#!/usr/bin/env node
/* mid-35: team totals. Sum of remaining minutes over the players the app projects, engine vs real, by margin now;
 * and the same after the final stage model (fit on first half of 2026 -> second half; all 2026 -> 2027). Regulation games only. */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE, C, F } = K;
const R = require('../replay');
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const onB = (r) => (r.sT === 0 && r.on ? 1 : 0), offS = (r) => (r.sT === 1 && !r.on ? 1 : 0), lopTier = (r) => K.lop(r) * clamp((r.mpg - 24) / 8, -2, 1.5);
const flatOn = (r) => (r.on ? BASE.flat(r) : 0);
const gen = { s18: [BASE.flat, BASE.flatLop, flatOn], s24: [BASE.flat, BASE.flatLop, paceT, lopTier], s30: [BASE.flat, onB, offS, lopTier] };
const { R26, R27 } = K.data();
for (const g of ['s18', 's24', 's30']) {
  const Rg = R26.filter((r) => r.g === g), R7 = R27.filter((r) => r.g === g);
  const { A, B } = F.splitByDate(Rg);
  const a = F.fit(A, gen[g]), f = F.fit(Rg, gen[g]);
  for (const [label, rows, beta] of [['2026 second half', B, a.beta], ['2027', R7, f.beta]]) {
    const tg = new Map();
    for (const r of rows) { let t = tg.get(r.tg); if (!t) tg.set(r.tg, (t = { mg: r.mg, ot: r.ot, e: 0, m: 0, a: 0 })); t.e += r.mn0 - r.now0; t.m += F.predict(r, beta, gen[g]) - r.now0; t.a += (r.ac0 != null ? r.ac0 : r.now0) - r.now0; }
    const L = [...tg.values()].filter((t) => !t.ot);
    console.log(`\n${g} ${label}: team sums of remaining minutes over projected players (regulation), possible ${5 * (48 - Rg[0].el)}`);
    for (const [nm, lo, hi] of [['|margin| 0-5', 0, 5], ['6-11', 6, 11], ['12-19', 12, 19], ['20+', 20, 99]]) {
      const S = L.filter((t) => Math.abs(t.mg) >= lo && Math.abs(t.mg) <= hi); if (S.length < 8) continue;
      const m = (k) => S.reduce((x, t) => x + t[k], 0) / S.length;
      const d = S.map((t) => t.a - t.e), md = d.reduce((x, y) => x + y, 0) / d.length, sd = Math.sqrt(d.reduce((x, y) => x + (y - md) * (y - md), 0) / (d.length - 1));
      const d2 = S.map((t) => t.a - t.m), md2 = d2.reduce((x, y) => x + y, 0) / d2.length, sd2 = Math.sqrt(d2.reduce((x, y) => x + (y - md2) * (y - md2), 0) / (d2.length - 1));
      console.log(`   ${nm.padEnd(13)} tg=${String(S.length).padStart(4)} engine ${m('e').toFixed(1)}  real ${m('a').toFixed(1)}  (real-engine ${C.fmt(md, 1)}, z ${C.fmt(md / (sd / Math.sqrt(d.length)), 1)})  final model ${m('m').toFixed(1)} (real-model ${C.fmt(md2, 1)}, z ${C.fmt(md2 / (sd2 / Math.sqrt(d2.length)), 1)})`);
    }
  }
}
