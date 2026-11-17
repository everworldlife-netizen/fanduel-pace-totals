#!/usr/bin/env node
/* mid-20: is the engine's own blowout chance (pB) right? Per game and stage: mean pB vs how often the margin after three
 * quarters / at the end was really 15+ or 20+. (Game level; outcome columns are for diagnosis only.) */
'use strict';
const C = require('./mid-common');
const R = require('../replay');
for (const season of [2026, 2027]) {
  const G = C.L.readJSON(`${C.L.ROOT}/data/derived/games-${season}.json.gz`);
  const info = new Map();
  for (const it of G) {
    const g = it.g; const q = (k) => (g[`home_q${k}`] || 0) - (g[`visitor_q${k}`] || 0);
    info.set(g.id, { q3: Math.abs(q(1) + q(2) + q(3)), fin: Math.abs((g.home_team_score || 0) - (g.visitor_team_score || 0)) });
  }
  const rows = C.load(season);
  console.log(`\n== ${season}`);
  for (const g of ['s18', 's24', 's30']) {
    const seen = new Map();
    for (const r of rows) if (r.g === g && !seen.has(r.id)) seen.set(r.id, { pB: r.pB, mg: Math.abs(r.mg), ...info.get(r.id) });
    const L = [...seen.values()].filter((x) => x.fin != null);
    const m = (f, S = L) => S.reduce((a, x) => a + f(x), 0) / S.length;
    console.log(`  ${g}: games ${L.length}; mean pB ${m((x) => x.pB).toFixed(3)}; real: after Q3 15+ ${m((x) => +(x.q3 >= 15)).toFixed(3)}, after Q3 20+ ${m((x) => +(x.q3 >= 20)).toFixed(3)}, final 15+ ${m((x) => +(x.fin >= 15)).toFixed(3)}, final 20+ ${m((x) => +(x.fin >= 20)).toFixed(3)}`);
    for (const [a, b] of [[0, 0.05], [0.05, 0.15], [0.15, 0.3], [0.3, 0.5], [0.5, 0.75], [0.75, 1.01]]) {
      const S = L.filter((x) => x.pB >= a && x.pB < b); if (S.length < 15) continue;
      console.log(`      pB ${a}-${b}: games ${String(S.length).padStart(4)} mean pB ${m((x) => x.pB, S).toFixed(3)} | Q3 margin 20+ ${m((x) => +(x.q3 >= 20), S).toFixed(3)} | 15+ ${m((x) => +(x.q3 >= 15), S).toFixed(3)} | final 20+ ${m((x) => +(x.fin >= 20), S).toFixed(3)}`);
    }
  }
}
