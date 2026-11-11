#!/usr/bin/env node
/* mid-34: minutes that go to players who had not checked in by the stage minute (the dump has no number for them from the
 * half on). Per team-game: how many minutes such players end up with, by the margin at that moment. If a lopsided half
 * hands them 15-25 team-minutes, the players the app does project must lose exactly those minutes. */
'use strict';
const C = require('./mid-common');
const R = require('../replay');
for (const season of [2026, 2027]) {
  const rows = C.load(season);
  const G = C.L.readJSON(`${C.L.ROOT}/data/derived/games-${season}.json.gz`).filter((it) => R.boxOk(it));
  const byId = new Map(G.map((it) => [it.g.id, it]));
  console.log(`\n== ${season}`);
  for (const [g, el] of [['s24', 24], ['s30', 30]]) {
    const tg = new Map();
    for (const r of rows) if (r.g === g) { let t = tg.get(r.tg); if (!t) tg.set(r.tg, (t = { id: r.id, tm: r.tm, mg: r.mg, eng: 0, real: 0, n: 0 })); t.eng += r.mn0 - r.now0; t.real += (r.ac0 || 0) - r.now0; t.n++; }
    for (const t of tg.values()) {
      const it = byId.get(t.id); t.late = 0; t.lateN = 0; t.late10 = 0; t.ot = it.log.len > 48.5;
      for (const p of Object.values(it.log.rows)) { if (p.team !== t.tm || !(p.min > 0) || !Array.isArray(p.st) || !p.st.length) continue; if (p.st[0][0] >= el - 0.01) { t.late += p.min; t.lateN++; if (p.min >= 10) t.late10++; } }
    }
    const L = [...tg.values()].filter((t) => !t.ot);
    console.log(`  ${g}: regulation team-games ${L.length}`);
    for (const [nm, a, b] of [['trail 20+', -99, -20], ['trail 12-19', -19, -12], ['trail 6-11', -11, -6], ['within 5', -5, 5], ['lead 6-11', 6, 11], ['lead 12-19', 12, 19], ['lead 20+', 20, 99]]) {
      const S = L.filter((t) => t.mg >= a && t.mg <= b); if (!S.length) continue;
      const m = (f) => S.reduce((x, t) => x + f(t), 0) / S.length;
      console.log(`     ${nm.padEnd(12)} tg=${String(S.length).padStart(4)} | minutes to players not yet checked in: ${m((t) => t.late).toFixed(1).padStart(5)} (${m((t) => t.lateN).toFixed(2)} players, ${m((t) => t.late10).toFixed(2)} with 10+) | projected players: engine remaining ${m((t) => t.eng).toFixed(1)} vs real ${m((t) => t.real).toFixed(1)} of ${5 * (48 - el)}`);
    }
  }
}
