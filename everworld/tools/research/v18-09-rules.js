#!/usr/bin/env node
/* Candidate rules for the projected final margin and the win chance, by stage, on unseen sets (study of Nov 13, 2026).
 *   node tools/research/v18-09-rules.js <fit run, no anchor> <check run> [...]
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const load = (f) => { const run = L.readJSON(path.resolve(f)); const out = {}; for (const [s, A] of Object.entries(run.acc)) { const G = []; for (const [id, pg] of Object.entries(A.per || {})) { const it = games.get(+id); if (!it || !it.market || it.market.spreadHome == null || pg[22] == null) continue; const fv = it.g.visitor_team_score, fh = it.g.home_team_score; const el = s === 'rep' ? 0 : +s; G.push({ el, now: pg[22], S: it.market.spreadHome, sp: it.market.spreadHome * Math.max(48 - el, 0) / 48, own: pg[20] - pg[22], rm: fv - fh, w: fv > fh ? 1 : 0, p: pg[21], pb: it.market.pAway }); } out[s] = G; } return out; };
const sets = process.argv.slice(2).map((f) => ({ name: path.basename(f, '.json'), by: load(f) }));
const keep = (el, a0) => (el <= 0 ? 1 : Math.min(1, a0 + (1 - a0) * (el / 48) ** 2));
const RULES = {
  'published (ours)': (g) => g.now + g.own,
  'now + 0.8 book + 0.2 ours': (g) => g.now + 0.8 * g.sp + 0.2 * g.own,
  'now + book': (g) => g.now + g.sp,
  'keep(0.8) now + book': (g) => keep(g.el, 0.8) * g.now + g.sp,
  'keep(0.8) now + 1.15 book': (g) => keep(g.el, 0.8) * g.now + 1.15 * g.sp,
  'keep(0.85) now + 1.1 book': (g) => keep(g.el, 0.85) * g.now + 1.1 * g.sp,
};
const stages = Object.keys(sets[0].by);
for (const S of sets) {
  console.log(`\n${S.name}: miss of the final margin by rule`);
  console.log('rule'.padEnd(28) + stages.map((s) => String(s).padStart(7)).join('') + '    mean');
  for (const [nm, f] of Object.entries(RULES)) { const m = stages.map((s) => mean((S.by[s] || []).map((g) => Math.abs(f(g) - g.rm)))); console.log(nm.padEnd(28) + m.map((x) => x.toFixed(2).padStart(7)).join('') + '   ' + mean(m).toFixed(3)); }
}
// win chance with the chosen rule: the spread that makes the chances right, by stage, fitted on the first set
const R = RULES[process.env.RULE || 'keep(0.8) now + 1.15 book'];
console.log(`\nWIN CHANCE with the rule "${process.env.RULE || 'keep(0.8) now + 1.15 book'}": chance = Phi(projected final margin / sd)`);
const brier = (G, f) => mean(G.map((g) => (f(g) - g.w) ** 2));
const sdFit = {};
console.log('stage  | sd fitted on ' + sets[0].name + ' | ' + sets.map((S) => `${S.name}: published → new (book before the game)`).join(' | '));
for (const s of stages) {
  const G = sets[0].by[s]; let best = [0, 1];
  for (let sd = 2; sd <= 20; sd += 0.25) { const b = brier(G, (g) => Phi(R(g) / sd)); if (b < best[1]) best = [sd, b]; }
  sdFit[s] = best[0];
  console.log(String(s).padEnd(6), '|', best[0].toFixed(2).padStart(6), '            |', sets.map((S) => { const H = S.by[s] || []; const Hb = H.filter((g) => g.pb != null); return H.length ? `${brier(H, (g) => g.p).toFixed(4)} → ${brier(H, (g) => Phi(R(g) / best[0])).toFixed(4)} (${Hb.length ? brier(Hb, (g) => g.pb).toFixed(4) : '-'})` : '-'; }).join(' | '));
}
// a smooth curve for the spread: sd(el) = s0 x sqrt(left / 48) + s1
let bestC = null;
for (let s0 = 6; s0 <= 14; s0 += 0.5) for (let s1 = 0; s1 <= 6; s1 += 0.5) { let tot = 0; for (const s of stages) { const G = sets[0].by[s]; const el = s === 'rep' ? 0 : +s; const sd = s0 * Math.sqrt(Math.max(48 - el, 0) / 48) + s1; tot += brier(G, (g) => Phi(R(g) / sd)); } if (!bestC || tot < bestC[2]) bestC = [s0, s1, tot]; }
console.log(`\nsmooth curve fitted on ${sets[0].name}: sd = ${bestC[0]} x sqrt(time left / 48) + ${bestC[1]}`);
console.log('stage  | ' + sets.map((S) => `${S.name}: Brier with the curve`).join(' | '));
for (const s of stages) { const el = s === 'rep' ? 0 : +s; const sd = bestC[0] * Math.sqrt(Math.max(48 - el, 0) / 48) + bestC[1]; console.log(String(s).padEnd(6), '|', sets.map((S) => { const H = S.by[s] || []; return H.length ? `${brier(H, (g) => Phi(R(g) / sd)).toFixed(4)} (sd ${sd.toFixed(1)})` : '-'; }).join(' | ')); }
