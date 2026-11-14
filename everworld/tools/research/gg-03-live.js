#!/usr/bin/env node
/* GG League, during the game: what the server's raw number, FanDuel's live line and the number shown did at each checkpoint,
 * with the score at that moment worked back out of the server's own formula (study of Nov 13, 2026).
 *   node tools/research/gg-03-live.js <graded file> [<graded file> ...]
 */
'use strict';
const fs = require('fs');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const QS = [0.2546, 0.2467, 0.2425, 0.2486], QSUM = QS.reduce((a, b) => a + b, 0), N0 = 6;
const K = (a, b) => { let r = 0; for (let q = 0; q < 4; q++) { const lo = q / 4, hi = (q + 1) / 4, u = Math.max(0, Math.min(b, hi) - Math.max(a, lo)); r += QS[q] * (u / 0.25); } return r / QSUM; };
const seen = new Map();
for (const f of process.argv.slice(2)) for (const g of JSON.parse(fs.readFileSync(f, 'utf8')).graded) if (!seen.has(g.eventId) || (g.gradedAt || 0) > (seen.get(g.eventId).gradedAt || 0)) seen.set(g.eventId, g);
const rows = [];
for (const g of seen.values()) {
  if (!g.final || !Number.isFinite(g.final.total) || !g.pregame) continue;
  for (const [cp, c] of Object.entries(g.checkpoints || {})) {
    if (cp === '0' || !c.game || !Number.isFinite(c.game.mean) || !Number.isFinite(c.game.line)) continue;
    const E = g.pregame.expected, f = c.f, k0 = K(0, f), kr = K(f, 1);
    const S = (c.game.mean - N0 * E * kr / (N0 + k0)) / (1 + kr / (N0 + k0));
    rows.push({ id: g.eventId, t: g.scheduledMs, cp, f, E, S, L: c.game.line, M: c.game.mean, fin: g.final.total, close: g.close && g.close.game ? g.close.game.line : NaN });
  }
}
console.log(`${rows.length} checkpoint readings from ${seen.size} graded games`);
console.log(`score worked back out: ${Math.round(100 * mean(rows.map((r) => (Math.abs(r.S - Math.round(r.S)) < 0.26 ? 1 : 0))))}% within a quarter point of a whole number; ${rows.filter((r) => r.S > r.fin + 0.6).length} readings above the final score`);
const PW = [0.68, 0.45, 0.15, 0.47, 0.9];
const wOf = (f) => (f < 0.25 ? PW[1] : f < 0.75 ? PW[2] : f < 0.9 ? PW[3] : PW[4]);
const bands = [[0.2, 0.35], [0.35, 0.5], [0.5, 0.62], [0.62, 0.75], [0.75, 0.9], [0.9, 1.01]];
console.log('\nshare played | readings | points still to come: real / our raw number / FanDuel | miss: raw, FanDuel, SHOWN now | bias: raw, FanDuel, shown');
for (const [a, b] of bands) {
  const R = rows.filter((r) => r.f >= a && r.f < b); if (R.length < 8) continue;
  const shown = (r) => wOf(r.f) * r.M + (1 - wOf(r.f)) * r.L;
  const m = (fn) => mean(R.map((r) => Math.abs(fn(r) - r.fin))), bi = (fn) => mean(R.map((r) => fn(r) - r.fin));
  console.log(`${a.toFixed(2)}-${Math.min(b, 1).toFixed(2)}`.padEnd(12), '|', String(R.length).padStart(4), '    |', mean(R.map((r) => r.fin - r.S)).toFixed(1).padStart(5), '/', mean(R.map((r) => r.M - r.S)).toFixed(1).padStart(5), '/', mean(R.map((r) => r.L - r.S)).toFixed(1).padStart(5), '              |', m((r) => r.M).toFixed(2), m((r) => r.L).toFixed(2), m(shown).toFixed(2), '      |', bi((r) => r.M).toFixed(2), bi((r) => r.L).toFixed(2), bi(shown).toFixed(2));
}
const all = (fn, R = rows) => mean(R.map((r) => Math.abs(fn(r) - r.fin)));
console.log(`\nall readings: raw ${all((r) => r.M).toFixed(3)}, FanDuel ${all((r) => r.L).toFixed(3)}, shown now ${all((r) => wOf(r.f) * r.M + (1 - wOf(r.f)) * r.L).toFixed(3)}`);
fs.writeFileSync(process.env.OUT || '/tmp/gg-rows.json', JSON.stringify(rows));
