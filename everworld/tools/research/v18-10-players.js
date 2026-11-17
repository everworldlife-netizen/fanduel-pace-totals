#!/usr/bin/env node
/* Does the book's line say anything about the PLAYERS that their numbers do not already carry? (study of Nov 13, 2026)
 * For every game and stage: the team's points still to come as we have them, and as the book-anchored final score has them.
 * factor = anchored / ours. If a player's points still to come moved by a share of that factor, would the miss shrink?
 *   node tools/research/v18-10-players.js <rows>:<run> [<rows>:<run> ...]     (first pair = where the share is fitted)
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const keep = (el) => (el <= 0 ? 1 : Math.min(1, 0.8 + 0.2 * (el / 48) ** 2));
const load = (spec) => {
  const [rf, runf] = spec.split(':');
  const run = L.readJSON(path.resolve(runf));
  const fac = new Map();
  for (const [s, A] of Object.entries(run.acc)) for (const [id, pg] of Object.entries(A.per || {})) {
    const it = games.get(+id); if (!it || !it.market || pg[22] == null) continue;
    const el = s === 'rep' ? 0 : +s, pre = el === 0;
    const fv = it.g.visitor_team_score, fh = it.g.home_team_score;
    const ownT = fv + fh + pg[17], ownM = pg[20], nowM = pg[22], nowT = pg[23];
    const vs = (nowT + nowM) / 2, hs = (nowT - nowM) / 2;
    const tv = (ownT + ownM) / 2 - vs, th = (ownT - ownM) / 2 - hs;
    const wT = it.market.total ? 0.9 * (pre ? 1 : clamp((9 - el) / 6, 0, 1)) : 0;
    const T2 = (1 - wT) * ownT + wT * (it.market.total || ownT);
    const M2 = it.market.spreadHome != null ? keep(el) * nowM + it.market.spreadHome * (48 - el) / 48 : ownM;
    const av = (T2 + M2) / 2 - vs, ah = (T2 - M2) / 2 - hs, aTv = (T2 + ownM) / 2 - vs, aTh = (T2 - ownM) / 2 - hs, aMv = (ownT + M2) / 2 - vs, aMh = (ownT - M2) / 2 - hs;
    const f = (a, b) => (b > 5 ? clamp(a / b, 0.7, 1.4) : 1);
    fac.set(`${id}:${s}`, { v: it.g.visitor_team.abbreviation, both: [f(av, tv), f(ah, th)], total: [f(aTv, tv), f(aTh, th)], margin: [f(aMv, tv), f(aMh, th)] });
  }
  const rows = L.readJSON(path.resolve(rf)).filter((r) => !r.un && r.ac && r.ac[0] >= 10);
  for (const r of rows) { const s = r.g === 'rep' ? 'rep' : String(r.el); const F = fac.get(`${r.id}:${s}`); r.s = s; r.F = F ? { both: F.both[r.tm === F.v ? 0 : 1], total: F.total[r.tm === F.v ? 0 : 1], margin: F.margin[r.tm === F.v ? 0 : 1] } : null; }
  return { name: path.basename(rf).replace('.rows.json.gz', ''), rows: rows.filter((r) => r.F) };
};
const sets = process.argv.slice(2).map(load);
const STAGES = ['rep', '0', '3', '6', '9', '12', '18', '24', '30', '36', '42'];
const STATS = [['PTS', 1], ['REB', 2], ['AST', 3]];
for (const kind of ['total', 'margin', 'both']) {
  console.log(`\n=== factor from the book's ${kind === 'both' ? 'total and spread' : kind} ===`);
  for (const [nm, ix] of STATS) {
    console.log(`${nm}: stage | share fitted on ${sets[0].name} | ` + sets.map((S) => `${S.name}: miss published → with the fitted share (with the full factor)`).join(' | '));
    for (const s of STAGES) {
      const R0 = sets[0].rows.filter((r) => r.s === s); if (!R0.length) continue;
      let sxy = 0, sxx = 0; for (const r of R0) { const x = (r.pr[ix] - r.now[ix]) * (r.F[kind] - 1), y = r.ac[ix] - r.pr[ix]; sxy += x * y; sxx += x * x; }
      const lam = sxx > 0 ? sxy / sxx : 0;
      const cells = sets.map((S) => { const R = S.rows.filter((r) => r.s === s); if (!R.length) return '-'; const m = (l) => mean(R.map((r) => Math.abs(r.now[ix] + (r.pr[ix] - r.now[ix]) * (1 + l * (r.F[kind] - 1)) - r.ac[ix]))); const a = m(0), b = m(lam), c = m(1); return `${a.toFixed(3)} → ${b.toFixed(3)} (${((b / a - 1) * 100).toFixed(2)}%)  (full ${((c / a - 1) * 100).toFixed(2)}%)`; });
      console.log(`  ${s.padEnd(4)} | ${lam.toFixed(2).padStart(6)} | ${cells.join(' | ')}`);
    }
  }
}
