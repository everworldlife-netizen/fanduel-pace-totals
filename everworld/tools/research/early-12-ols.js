#!/usr/bin/env node
/* early-12: how much is there to get at 6 / 12 minutes with everything the phone knows? A free linear model per class
 * (starters / bench in / bench not in) on the tip-off number, the live plain number, minutes so far, usual minutes, the
 * rotation-timing features of early-03 and the game state. Taught on players who played (first half of 2026), tested on
 * the second half and on 2026-27. Compared with the re-taught 49-input layer (same rule). An upper-ish bound, not a design.
 *   node tools/research/early-12-ols.js [s6|s12] */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const ST = process.argv[2] || 's6'; const EL = ST === 's6' ? 6 : 12;
const a26 = C.load('2026'), a27 = C.load('2027');
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const nz = (v, d = 0) => (v == null || isNaN(v) ? d : v);
const cls = (o) => (o.pre.sT === 1 ? 0 : o[ST].dnp === 0 ? 1 : 2);
function feats(o, full) {
  const r = o[ST], f = o.f, tip = o.pre.mn[0], live = r.mp, now = r.now[0];
  const base = [1, tip, live, now, o.pre.mpg, r.x[5] /* blowout */, r.mg / 10, Math.abs(r.mg) / 10, r.pf, r.on];
  if (!full) return base;
  const hasB = f.nB >= 2 ? 1 : 0, hasP = f.nP >= 2 ? 1 : 0;
  return base.concat([
    hasP, hasP ? nz(f.minP) : o.pre.mpg, hasP ? nz(f['rem' + EL]) : 0, hasP ? nz(f['exp' + EL]) : 0, hasP ? nz(f.startShare) : 0,
    f.nT ? f.nP / f.nT : 0.5, f.nT && f.lastPlayed[0] === '0' ? 1 : 0, f.nT >= 2 && f.lastPlayed.slice(0, 2) === '00' ? 1 : 0,
    hasB, hasB ? nz(f.ciBMed) / 12 : 0, hasB ? nz(f['pInB' + EL]) : 0, f['nBenchIn' + EL], nz(f['passed' + EL]), f['stPf2_' + EL], f['stOff' + EL],
    hasB && f['tIn' + EL] != null ? Math.max(0, Math.min(12, f.ciBMed - f['tIn' + EL])) / 6 : 0,
    hasB && f['tIn' + EL] != null && f['pInB' + EL] === 0 ? 1 : 0,
    nz(f['pOnS' + EL], 0.5), r.on - nz(f['pOnS' + EL], 0.5), r.pf >= 2 ? 1 : 0, r.pf >= 2 && !r.on ? 1 : 0,
    nz(f['remOn' + EL], nz(f['rem' + EL], 0)) * r.on, nz(f['remOff' + EL], nz(f['rem' + EL], 0)) * (1 - r.on) * (r.dnp ? 0 : 1), nz(f['remNotIn' + EL], nz(f['rem' + EL], 0)) * r.dnp,
    Math.max(0, 24 - o.pre.mpg) / 6, r.x[42], r.x[43], r.x[41], r.x[37], r.x[36], r.x[34], r.x[35], r.x[15], r.x[11],
  ]);
}
function run(tr, te, full, label) {
  const preds = new Map();
  for (const c of [0, 1, 2]) {
    const T = tr.filter((o) => cls(o) === c && o.ac > 0);
    const X = T.map((o) => feats(o, full)), y = T.map((o) => o.ac);
    const r = C.ols(X, y, T.map((o) => o.tg), 1e-3 * T.length);
    for (const o of te) if (cls(o) === c) { const x = feats(o, full); let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * r.beta[i]; preds.set(o.k, Math.max(o[ST].now[0], Math.min(48, p))); }
  }
  return preds;
}
const H1 = a26.filter((o) => o.d < mid), H2 = a26.filter((o) => o.d >= mid);
function report(title, tr, te) {
  const R = Fx.prep(tr, ST), Rt = Fx.prep(te, ST); const b = Fx.fit(R, 'played', 8); const layer = new Map(Rt.map((q) => [q.o.k, Fx.predict(q, b.beta)]));
  const small = run(tr, te, false), big = run(tr, te, true);
  console.log(`\n== ${title} (10+ miss; z = paired vs the re-taught layer, by team-game) ==`);
  const names = ['all', 'starters', 'bench in', 'bench not in'];
  for (let ci = -1; ci < 3; ci++) {
    const li = te.filter((o) => o.ac >= 10 && (ci < 0 || cls(o) === ci));
    const m = (p) => li.reduce((a, o) => a + Math.abs(p(o) - o.ac), 0) / li.length;
    const zz = (p) => { const mp = new Map(); for (const o of li) mp.set(o.tg, (mp.get(o.tg) || 0) + Math.abs(p(o) - o.ac) - Math.abs(layer.get(o.k) - o.ac)); const arr = [...mp.values()]; const mu = arr.reduce((a, b2) => a + b2, 0) / arr.length; const v = arr.reduce((a, b2) => a + (b2 - mu) * (b2 - mu), 0) / (arr.length - 1); return mu / Math.sqrt(v / arr.length); };
    console.log(`${names[ci + 1].padEnd(13)} n=${String(li.length).padStart(5)} tip-off ${m((o) => o.pre.mn[0]).toFixed(3)} | engine ${m((o) => o[ST].mn[0]).toFixed(3)} | re-taught layer ${m((o) => layer.get(o.k)).toFixed(3)} | free model, basic inputs ${m((o) => small.get(o.k)).toFixed(3)} (z ${zz((o) => small.get(o.k)).toFixed(1)}) | free model, + timing inputs ${m((o) => big.get(o.k)).toFixed(3)} (z ${zz((o) => big.get(o.k)).toFixed(1)})`);
  }
}
report(`stage ${ST}: taught first half 2026 -> second half 2026`, H1, H2);
report(`stage ${ST}: taught 2026 -> 2026-27`, a26, a27);
