#!/usr/bin/env node
/* Final margin from the margin now, the book's spread over the time left, and our own rest-of-game margin (study of Nov 13).
 *   node tools/research/v18-08-margin.js <fit run (no anchor)> <check run> [...]
 * Least squares by stage: real final margin = a x margin now + b x (spread x left / 48) + c x (our rest-of-game margin).
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const load = (f) => { const run = L.readJSON(path.resolve(f)); const out = {}; for (const [s, A] of Object.entries(run.acc)) { const G = []; for (const [id, pg] of Object.entries(A.per || {})) { const it = games.get(+id); if (!it || !it.market || it.market.spreadHome == null || pg[22] == null) continue; const fv = it.g.visitor_team_score, fh = it.g.home_team_score; const el = s === 'rep' ? 0 : +s; G.push({ now: pg[22], sp: it.market.spreadHome * Math.max(48 - el, 0) / 48, own: pg[20] - pg[22], rm: fv - fh, w: fv > fh ? 1 : 0 }); } out[s] = G; } return out; };
function solve(A, b) { const n = b.length; const M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; if (Math.abs(M[i][i]) < 1e-12) continue; for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } } return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i])); }
const fit = (G, keys) => { const A = keys.map(() => keys.map(() => 0)), b = keys.map(() => 0); for (const g of G) for (let i = 0; i < keys.length; i++) { b[i] += g[keys[i]] * g.rm; for (let j = 0; j < keys.length; j++) A[i][j] += g[keys[i]] * g[keys[j]]; } return solve(A, b); };
const sets = process.argv.slice(2).map((f) => ({ name: path.basename(f, '.json'), by: load(f) }));
const miss = (G, f) => mean(G.map((g) => Math.abs(f(g) - g.rm)));
console.log('stage  | fit on ' + sets[0].name + ': a (margin now)  b (book spread, time left)  c (our rest) | miss: ours as published → now + 0.8 book + 0.2 ours → fitted line | on the check sets: published → 0.8/0.2 rule → fitted line');
for (const s of Object.keys(sets[0].by)) {
  const G = sets[0].by[s]; if (!G.length) continue;
  const live = s !== 'rep' && s !== '0';
  const keys = live ? ['now', 'sp', 'own'] : ['sp', 'own'];
  const c = fit(G, keys);
  const f = (g) => keys.reduce((a, k, i) => a + c[i] * g[k], 0);
  const rule = (g) => g.now + 0.8 * g.sp + 0.2 * g.own;
  const pub = (g) => g.now + g.own;
  console.log(String(s).padEnd(6), '|', keys.map((k, i) => `${k} ${c[i].toFixed(2)}`).join('  ').padEnd(34), '|', miss(G, pub).toFixed(2), '→', miss(G, rule).toFixed(2), '→', miss(G, f).toFixed(2), '|', sets.slice(1).map((S) => { const H = S.by[s] || []; return H.length ? `${S.name}: ${miss(H, pub).toFixed(2)} → ${miss(H, rule).toFixed(2)} → ${miss(H, f).toFixed(2)}` : ''; }).join(' | '));
}
