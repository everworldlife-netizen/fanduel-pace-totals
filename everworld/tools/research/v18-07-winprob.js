#!/usr/bin/env node
/* Is the win chance well calibrated? (study of Nov 13, 2026)   node tools/research/v18-07-winprob.js <fit run> <check run> [...]
 * From each game's projected final margin m and stated chance p: the spread of margins the simulations imply (m / z(p)),
 * the spread that would have made the chances right (best Brier with p = Phi(m / sd)), and how the stated chances did by band.
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const invPhi = (p) => { let lo = -6, hi = 6; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const name = (s) => (s === 'rep' ? 'pre-lineup' : s === '0' ? 'tip-off' : `${s} min`);
const load = (f) => { const run = L.readJSON(path.resolve(f)); const out = {}; for (const [s, A] of Object.entries(run.acc)) { const G = []; for (const [id, pg] of Object.entries(A.per || {})) { const it = games.get(+id); if (!it || pg[20] == null) continue; const fv = it.g.visitor_team_score, fh = it.g.home_team_score; G.push({ m: pg[20], p: pg[21], w: fv > fh ? 1 : 0, rm: fv - fh, pb: it.market ? it.market.pAway : null }); } out[s] = G; } return out; };
const sets = process.argv.slice(2).map((f) => ({ name: path.basename(f, '.json'), by: load(f) }));
const brier = (G, f) => mean(G.map((g) => (f(g) - g.w) ** 2));
const fitSd = (G) => { let best = [0, 1]; for (let sd = 2; sd <= 24; sd += 0.25) { const b = brier(G, (g) => Phi(g.m / sd)); if (b < best[1]) best = [sd, b]; } return best; };
console.log('stage       | set: games | spread the simulations imply | real spread of (final margin - projected) | spread that makes the chances right | Brier: stated → with that spread (book before the game)');
const fitted = {};
for (const s of Object.keys(sets[0].by)) for (const S of sets) {
  const G = S.by[s]; if (!G || !G.length) continue;
  const imp = med(G.filter((g) => g.p > 0.03 && g.p < 0.97 && Math.abs(g.m) > 1).map((g) => g.m / invPhi(g.p)));
  const resid = Math.sqrt(mean(G.map((g) => (g.rm - g.m) ** 2)));
  const [sd, b] = fitSd(G);
  if (S === sets[0]) fitted[s] = sd;
  const Gb = G.filter((g) => g.pb != null);
  console.log(name(s).padEnd(11), '|', `${S.name}: ${G.length}`.padEnd(14), '|', imp.toFixed(1).padStart(6), '                      |', resid.toFixed(1).padStart(6), '                                    |', sd.toFixed(2).padStart(6), S === sets[0] ? '(fit)' : `(fit set's ${fitted[s].toFixed(2)}: ${brier(G, (g) => Phi(g.m / fitted[s])).toFixed(4)})`, '          |', brier(G, (g) => g.p).toFixed(4), '→', b.toFixed(4), `(${Gb.length ? brier(Gb, (g) => g.pb).toFixed(4) : '-'})`);
}
console.log('\nSTATED CHANCE AGAINST WHAT HAPPENED (first file, the side we favoured), by band');
for (const s of ['0', '12', '24', '36']) { const G = sets[0].by[s]; if (!G) continue; const B = {}; for (const g of G) { const p = Math.max(g.p, 1 - g.p), w = g.p >= 0.5 ? g.w : 1 - g.w; const k = Math.min(9, Math.floor(p * 10)); (B[k] = B[k] || []).push([p, w]); } console.log(name(s).padEnd(10), Object.entries(B).map(([k, a]) => `said ${(100 * mean(a.map((x) => x[0]))).toFixed(0)}% → ${(100 * mean(a.map((x) => x[1]))).toFixed(0)}% (${a.length})`).join(' | ')); }
