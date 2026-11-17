#!/usr/bin/env node
/* late-22: does a longer memory help? The phone keeps each team's last 8 games inside 21 days (window A). Window X = the last
 * 25 games inside 75 days. Point-in-time averages of the player's own remaining minutes from this moment in earlier games:
 *   remS = games where he was in the same on/off state at this minute; remBS = same state AND same margin band (within 8 /
 *   9-15 / 16+ with the same sign); rem = all his games. Added to a line on the engine's number, per on/off.
 * First half of 2026 -> second half; all 2026 -> 2027. */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
for (const stage of ['s36', 's42']) {
  const left = stage === 's36' ? 12 : 6;
  const rows = C.load(2026).filter((r) => r.ac0 != null && r.g === stage), rows27 = C.load(2027).filter((r) => r.ac0 != null && r.g === stage);
  const { A: h1, B: h2 } = C.splitByDate(rows);
  const has = (r, k) => (r[k] != null ? 1 : 0), val = (r, k) => (r[k] != null ? r[k] : 0);
  const base = [['1', () => 1], ['erem', (r) => r.erem], ['on', (r) => r.on], ['on*erem', (r) => r.on * r.erem]];
  const mk = (k, minN, nk) => [[`has ${k}`, (r) => (r[nk] >= minN ? 1 : 0)], [k, (r) => (r[nk] >= minN ? r[k] : 0)], [`${k}*on`, (r) => (r[nk] >= minN ? r[k] * r.on : 0)]];
  const variants = {
    'engine line only': base,
    '+ remSA (same state, 8 games)': [...base, ...mk('remSA', 2, 'nSA')],
    '+ remBSA (same state+band, 8 games)': [...base, ...mk('remBSA', 2, 'nBSA')],
    '+ remSX (same state, 25 games)': [...base, ...mk('remSX', 3, 'nSX')],
    '+ remBSX (same state+band, 25 games)': [...base, ...mk('remBSX', 3, 'nBSX')],
    '+ remX (all his games, 25)': [...base, ...mk('remX', 3, 'nX')],
    '+ remSX + remBSX': [...base, ...mk('remSX', 3, 'nSX'), ...mk('remBSX', 3, 'nBSX')],
    '+ closing share X (last 6 of close games)': [...base, ...mk('cgShX', 2, 'cgNX')],
  };
  console.log(`\n== ${stage}`);
  for (const [nm, cols] of Object.entries(variants)) {
    const X = (S2) => S2.map((r) => cols.map((c) => c[1](r)));
    const o1 = C.ols(X(h1), h1.map((r) => r.rem), h1.map((r) => r.tg), 1e-6), o2 = C.ols(X(rows), rows.map((r) => r.rem), rows.map((r) => r.tg), 1e-6);
    const pr = (o) => (r) => r.now0 + clamp(cols.reduce((s, c, j) => s + o.beta[j] * c[1](r), 0), 0, left + 1);
    const c = AN.compare(h2, (r) => r.mn0, pr(o1)), d = AN.compare(rows27, (r) => r.mn0, pr(o2));
    console.log(`  ${nm.padEnd(44)} H1->H2 ${c.b.toFixed(3)} (${c.pct.toFixed(2)}%) | 2027 ${d.b.toFixed(3)} (${d.pct.toFixed(2)}%) | ` + cols.slice(4).map((cdef, j) => `${cdef[0]} ${C.fmt(o2.beta[4 + j], 2)} (z ${o2.z[4 + j].toFixed(1)})`).join(', '));
  }
}
