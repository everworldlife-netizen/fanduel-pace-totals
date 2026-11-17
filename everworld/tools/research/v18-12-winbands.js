#!/usr/bin/env node
/* When the app says X% for a team, how often does that team win? Pooled from tip-off to 36:00, favourite's side.
 *   node tools/research/v18-12-winbands.js <before run> <after run> [...pairs]
 */
'use strict';
const path = require('path');
const L = require('../lib');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const games = new Map();
for (const season of [2026, 2027]) for (const it of L.readJSON(path.join(L.DERIVED, `games-${season}.json.gz`))) games.set(it.g.id, it);
const rows = (f) => { const R = L.readJSON(path.resolve(f)); const out = []; for (const [s, A] of Object.entries(R.acc)) { if (s === 'rep' || +s > 36) continue; for (const [id, pg] of Object.entries(A.per || {})) { const it = games.get(+id); if (!it) continue; const w = it.g.visitor_team_score > it.g.home_team_score ? 1 : 0; const p = pg[21]; out.push(p >= 0.5 ? [p, w] : [1 - p, 1 - w]); } } return out; };
const args = process.argv.slice(2);
for (let i = 0; i + 1 < args.length; i += 2) {
  const B = rows(args[i]), A = rows(args[i + 1]);
  console.log(`${path.basename(args[i])} → ${path.basename(args[i + 1])}: the side the app favours, tip-off to 36:00 (${B.length} readings)`);
  for (const [a, b] of [[0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]]) {
    const o = B.filter((r) => r[0] >= a && r[0] < b), n = A.filter((r) => r[0] >= a && r[0] < b);
    console.log(`  said ${Math.round(a * 100)}-${Math.round(Math.min(b, 1) * 100)}%:  before said ${(mean(o.map((r) => r[0])) * 100).toFixed(0)}% → won ${(mean(o.map((r) => r[1])) * 100).toFixed(0)}% (${o.length})   now said ${(mean(n.map((r) => r[0])) * 100).toFixed(0)}% → won ${(mean(n.map((r) => r[1])) * 100).toFixed(0)}% (${n.length})`);
  }
}
