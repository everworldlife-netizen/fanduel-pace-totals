#!/usr/bin/env node
/* early-19: does the season-to-date minutes average (all his games before tonight, this season) add to the recent-games
 * average the engine uses? Point-in-time: only games dated before tonight. gap = real - engine number regressed on
 * (number - role pivot) and (season average - usual minutes in the dump), starters tonight and bench checked in.
 *   node tools/research/early-19-season.js */
'use strict';
const C = require('./early-common');
const R = require('../replay');
for (const season of ['2026', '2027']) {
  const G = C.L.readJSON(`${C.L.ROOT}/data/derived/games-${season}.json.gz`).filter((it) => it.log && it.log.rows && R.boxOk(it) && !it.g.postseason);
  G.sort((a, b) => String(a.g.date).localeCompare(String(b.g.date)));
  // per player: list of [date, min, started]
  const hist = new Map();
  for (const it of G) for (const [pid, a] of Object.entries(it.log.rows)) { if (!(a.min > 0)) continue; let h = hist.get(+pid); if (!h) hist.set(+pid, (h = [])); h.push([it.g.date, a.min, Array.isArray(a.st) && a.st[0] && a.st[0][0] < 0.05 ? 1 : 0, a.team]); }
  const all = C.load(season);
  for (const o of all) {
    const h = hist.get(o.pre.pid) || []; let n = 0, s = 0, ns = 0, ss = 0, nb = 0, sb = 0;
    for (const [d, m, st, tm] of h) { if (!(d < o.d)) break; if (tm !== o.pre.tm) continue; n++; s += m; if (st) { ns++; ss += m; } else { nb++; sb += m; } }
    o.sea = { n, mpg: n ? s / n : null, nS: ns, mpgS: ns ? ss / ns : null, nB: nb, mpgB: nb ? sb / nb : null };
  }
  console.log(`\n=== season ${season} ===`);
  for (const ST of ['pre', 's6', 's12']) {
    for (const [cn, cf, piv, role] of [['starters', (o) => o.pre.sT === 1, 29.5, 'mpgS'], ['bench in', (o) => o.pre.sT === 0 && ST !== 'pre' && o[ST].dnp === 0, 21, 'mpgB']]) {
      const li = all.filter((o) => cf(o) && o.ac > 0 && o.sea.n >= 10);
      if (li.length < 200) continue;
      const y = li.map((o) => o.ac - o[ST].mn[0]), k = li.map((o) => o.tg);
      const r1 = C.ols(li.map((o) => [1, o[ST].mn[0] - piv]), y, k);
      const r2 = C.ols(li.map((o) => [1, o[ST].mn[0] - piv, o.sea.mpg - o.pre.mpg]), y, k);
      const li3 = li.filter((o) => o.sea[role === 'mpgS' ? 'nS' : 'nB'] >= 5);
      const r3 = C.ols(li3.map((o) => [1, o[ST].mn[0] - piv, o.sea[role] - o.pre.mpg]), li3.map((o) => o.ac - o[ST].mn[0]), li3.map((o) => o.tg));
      console.log(`${ST.padEnd(4)} ${cn.padEnd(9)} n=${li.length} (10+ season games) | pull alone b ${r1.beta[1].toFixed(3)} (z ${r1.z[1].toFixed(1)}) | with season avg - usual: pull ${r2.beta[1].toFixed(3)} (z ${r2.z[1].toFixed(1)}), season ${r2.beta[2].toFixed(3)} (z ${r2.z[2].toFixed(1)}) | same-role season avg (n=${li3.length}): pull ${r3.beta[1].toFixed(3)} (z ${r3.z[1].toFixed(1)}), season-role ${r3.beta[2].toFixed(3)} (z ${r3.z[2].toFixed(1)})`);
    }
  }
  if (season === '2026') {
    // gain: starters at s6/s12, fit first half -> second half: pull alone vs pull + season
    const dates = [...new Set(all.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
    for (const ST of ['s6', 's12']) for (const [cn, cf, piv] of [['starters', (o) => o.pre.sT === 1, 29.5], ['bench in', (o) => o.pre.sT === 0 && o[ST].dnp === 0, 21]]) {
      const li = all.filter((o) => cf(o) && o.ac > 0); const f = (o) => [1, o[ST].mn[0] - piv, o.sea.n >= 10 ? 1 : 0, o.sea.n >= 10 ? o.sea.mpg - o.pre.mpg : 0];
      const tr = li.filter((o) => o.d < mid), te = li.filter((o) => o.d >= mid && o.ac >= 10);
      const rA = C.ols(tr.map((o) => f(o).slice(0, 2)), tr.map((o) => o.ac - o[ST].mn[0]), tr.map((o) => o.tg)), rB = C.ols(tr.map(f), tr.map((o) => o.ac - o[ST].mn[0]), tr.map((o) => o.tg));
      const m = (r, d) => te.reduce((a, o) => { const x = f(o); let c = 0; for (let i = 0; i < d; i++) c += r.beta[i] * x[i]; return a + Math.abs(o[ST].pr[0] + c - o.ac); }, 0) / te.length;
      console.log(`gain ${ST} ${cn}: engine ${(te.reduce((a, o) => a + Math.abs(o[ST].pr[0] - o.ac), 0) / te.length).toFixed(3)} | pull ${m(rA, 2).toFixed(3)} | pull + season avg ${m(rB, 4).toFixed(3)}`);
    }
  }
}
