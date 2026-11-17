#!/usr/bin/env node
/* GG League: how close can a pregame number get? (study of Nov 13, 2026)
 * The same two gamers meet again and again. Two meetings a few days apart share everything a projection can know (who plays,
 * their form, their head-to-head), so half the squared difference of their totals is the part no pregame number can reach.
 *   node tools/research/gg-02-floor.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../lib');
const P = require(path.join(L.ROOT, 'gg/static/profiles.js'));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const seen = new Map();
const add = (r) => { const g = { id: r[0], t: r[1], a: P.norm(r[2]), b: P.norm(r[3]), ta: P.normTeam(r[4]), tb: P.normTeam(r[5]), sa: r[6], sb: r[7] }; if (g.sa + g.sb >= 30) seen.set(g.id, g); };
for (const r of JSON.parse(fs.readFileSync(path.join(L.ROOT, 'gg/static/seed/seed-finals.json'), 'utf8'))) add(r);
const dir = path.join(L.DATA, 'eb');
for (const f of fs.readdirSync(dir).filter((x) => /^finals-.*\.json$/.test(x))) for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) add(r);
const G = [...seen.values()].sort((x, y) => x.t - y.t);
const tot = G.map((g) => g.sa + g.sb), m = mean(tot), sd = Math.sqrt(mean(tot.map((x) => (x - m) ** 2)));
console.log(`${G.length} games, ${new Date(G[0].t).toISOString().slice(0, 10)} to ${new Date(G[G.length - 1].t).toISOString().slice(0, 10)}: average total ${m.toFixed(1)}, spread (sd) ${sd.toFixed(2)}, miss of the plain average ${mean(tot.map((x) => Math.abs(x - m))).toFixed(2)}`);
const key = (g, teams) => [g.a, g.b].sort().join('|') + (teams ? '#' + [`${g.a}:${g.ta}`, `${g.b}:${g.tb}`].sort().join('|') : '');
for (const [label, teams, days] of [['same two gamers, within 3 days', false, 3], ['same two gamers, within 7 days', false, 7], ['same two gamers with the same teams, within 7 days', true, 7], ['same two gamers, same day (within 12 hours)', false, 0.5]]) {
  const by = new Map(); for (const g of G) { const k = key(g, teams); if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
  const d2 = [], ad = [];
  for (const list of by.values()) for (let i = 1; i < list.length; i++) { const a = list[i - 1], b = list[i]; if (b.t - a.t <= days * 86400000) { const d = (b.sa + b.sb) - (a.sa + a.sb); d2.push(d * d); ad.push(Math.abs(d)); } }
  const noiseSd = Math.sqrt(mean(d2) / 2);
  console.log(`${label.padEnd(52)} ${String(d2.length).padStart(5)} pairs of meetings: the part no pregame number can reach has a spread of ${noiseSd.toFixed(2)} points → best possible average miss about ${(noiseSd * 0.798).toFixed(2)}; the two totals are ${mean(ad).toFixed(1)} points apart on average`);
}
// the same for one gamer's own points (each side)
{
  const by = new Map(); for (const g of G) { const k = key(g, false); if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
  const d2 = [];
  for (const list of by.values()) for (let i = 1; i < list.length; i++) { const a = list[i - 1], b = list[i]; if (b.t - a.t <= 7 * 86400000) { const pa = (g, who) => (g.a === who ? g.sa : g.sb); d2.push((pa(b, a.a) - pa(a, a.a)) ** 2, (pa(b, a.b) - pa(a, a.b)) ** 2); } }
  console.log(`one gamer's own points, same opponent within 7 days: spread no number can reach ${Math.sqrt(mean(d2) / 2).toFixed(2)} points`);
}
