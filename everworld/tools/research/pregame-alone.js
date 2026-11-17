#!/usr/bin/env node
/* Pregame research: each signal block alone, on top of the refit layer + role constants + the three level signals
 * (moveBack, longGap5, q4x): fitted on the first half of 2026, miss of 10+ minute players on the second half.
 *   node tools/research/pregame-alone.js
 */
'use strict';
const C = require('./pregame-common');
const CAND = require('./pregame-cands')(2026);
const S = C.prepare(2026);
const nb = (r) => (r.st === 1 ? 0 : 1), v0 = (x) => (x == null || !isFinite(x) ? 0 : x), c = (k) => (r) => v0(CAND[k](r));
const BL = {
  'reserves on a back-to-back': [(r) => (r.f.ownRest === 1 ? nb(r) : 0)],
  'same-position minutes out (reserves)': [(r) => (v0(r.f.outSame) * nb(r)) / 10],
  'who is available, all five': [(r) => (v0(r.f.outTot) * nb(r)) / 10, (r) => (v0(r.f.outSame) * nb(r)) / 10, (r) => (r.f.availN != null ? (r.f.availN - 12) * nb(r) : 0), (r) => (r.g === 'pre' && r.f.activeCount != null ? Math.max(12 - r.f.activeCount, 0) : 0), (r) => (r.g === 'pre' && r.f.activeCount != null ? Math.max(r.f.activeCount - 13, 0) * nb(r) : 0)],
  'first game back': [c('firstBack'), c('restDays>3')],
  'last game by role': [(r) => v0(r.f.l1) * (1 - nb(r)), (r) => v0(r.f.l1) * nb(r)],
  'starting history': [(r) => (r.g === 'rep' ? v0(CAND.startDrift(r)) : 0), c('lowMinStarter')],
  'team form (reserves)': [(r) => v0(r.f.teamMargin8) * nb(r)],
  'big spreads (starters)': [c('fav>10|S')],
  'volatility': [(r) => v0(r.f.sd8)],
};
const miss = (rs, num) => { let s = 0, n = 0; rs.forEach((r, i) => { if (r.ac[0] >= 10) { s += Math.abs(r.ac[0] - num[i]); n++; } }); return s / n; };
const dot = (x, b) => x.reduce((s, v, i) => s + v * b[i], 0);
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g && r.gap != null);
  const live = []; for (let j = 0; j < 49; j++) { let a = Infinity, b = -Infinity; for (const r of rs) { const v = r.x[j]; if (v < a) a = v; if (v > b) b = v; } if (j === 0 || b - a > 1e-9) live.push(j); }
  const K = (r) => [1, r.st === 1 ? 1 : 0, r.mpg < 18 ? 1 : 0, ...live.map((j) => (r.x[j] * r.mp) / 24), v0(CAND.moveBack(r)), v0(CAND.longGap5(r)), v0(CAND['q4-quarter'](r))];
  const dates = [...new Set(rs.map((r) => r.d))].sort(), cut = dates[Math.floor(dates.length / 2)];
  const tr = rs.filter((r) => r.d < cut), te = rs.filter((r) => r.d >= cut);
  const eng = miss(te, te.map((r) => r.pr[0]));
  const fit = (fs) => { const X = (r) => [...K(r), ...fs.map((f) => f(r))]; const m = C.ols(tr.map((r) => r.ac[0] - r.mp), tr.map(X), tr.map((r) => r.id), 1e-3); return te.map((r) => r.mp + dot(X(r), m.beta)); };
  const base = fit([]); const b0 = miss(te, base);
  console.log(`\n${g}: engine ${eng.toFixed(3)}; refit + constants + level signals ${b0.toFixed(3)}`);
  for (const [nm, fs] of Object.entries(BL)) {
    const num = fit(fs); const mv = miss(te, num);
    const G = new Map(); te.forEach((r, i) => { if (r.ac[0] < 10) return; const q = G.get(r.id) || [0, 0]; q[0] += Math.abs(r.ac[0] - base[i]) - Math.abs(r.ac[0] - num[i]); q[1]++; G.set(r.id, q); }); const d = [...G.values()].map((q) => q[0] / q[1]);
    console.log(`   + ${nm.padEnd(38)} ${mv.toFixed(3)}  = ${(100 * (b0 - mv) / eng).toFixed(2)}% of the engine miss (paired z ${(C.mean(d) / (C.sd(d) / Math.sqrt(d.length))).toFixed(1)})`);
  }
}
