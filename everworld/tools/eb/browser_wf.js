#!/usr/bin/env node
/* GG League walk-forward test of the phone gamer ratings (profiles.js): every game is projected from games that
 * finished before it started (ratings refit every 50 games on the 21 days before), then graded on the game total.
 *
 *   node tools/eb/browser_wf.js [--model gg/static/profiles.js] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--rate k=v,k=v] [--out file]
 *   node tools/eb/browser_wf.js --grid          try rating settings on the middle block, report the last block (unseen)
 * Data: the results bundled with the app (gg/static/seed/seed-finals.json) plus anything in data/eb/finals-*.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const P = require(path.resolve(L.ROOT, arg('--model', 'gg/static/profiles.js')));
const DAY = 86400000, WINDOW_DAYS = 21, STEP = 50;

function loadGames() {
  const seen = new Map();
  const add = (r) => { const g = { id: r[0], t: r[1], a: P.norm(r[2]), b: P.norm(r[3]), ta: P.normTeam(r[4]), tb: P.normTeam(r[5]), sa: r[6], sb: r[7] }; if (g.sa + g.sb >= 30) seen.set(g.id, g); };
  for (const r of JSON.parse(fs.readFileSync(path.join(L.ROOT, 'baseline', 'gg', 'seed', 'seed-finals.json'), 'utf8'))) add(r);
  const dir = path.join(L.DATA, 'eb');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => /^finals-.*\.json$/.test(x))) for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) add(r);
  return [...seen.values()].sort((x, y) => x.t - y.t);
}
function run(games, from, to, rate) {
  const keep = { ...P.RATE };
  Object.assign(P.RATE, rate || {});
  const rows = [];
  let R = null, at = -1;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (g.t < from || g.t >= to) continue;
    if (!R || i - at >= STEP) {
      // only games that had finished (20-minute games: started at least 25 minutes earlier) inside the window
      const past = games.filter((x) => x.t <= g.t - 25 * 60000 && x.t >= g.t - WINDOW_DAYS * DAY);
      R = past.length >= 150 ? P.fitRatings(past, g.t) : null; at = i;
    }
    if (!R) continue;
    const [pa, pb] = P.ratedPoints(R, g.a, g.b, g.ta, g.tb);
    rows.push({ id: g.id, t: g.t, err: pa + pb - (g.sa + g.sb), win: (pa > pb) === (g.sa > g.sb) ? 1 : 0, mu: 2 * R.mu - (g.sa + g.sb) });
  }
  Object.assign(P.RATE, keep);
  const n = rows.length, mae = rows.reduce((s, r) => s + Math.abs(r.err), 0) / Math.max(n, 1);
  return { n, mae, bias: rows.reduce((s, r) => s + r.err, 0) / Math.max(n, 1), win: rows.reduce((s, r) => s + r.win, 0) / Math.max(n, 1), naive: rows.reduce((s, r) => s + Math.abs(r.mu), 0) / Math.max(n, 1), rows };
}
const paired = (A, B) => { const m = new Map(A.rows.map((r) => [r.id, Math.abs(r.err)])); const d = B.rows.filter((r) => m.has(r.id)).map((r) => Math.abs(r.err) - m.get(r.id)); const mean = d.reduce((s, x) => s + x, 0) / d.length; const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(d.length - 1, 1)); return { mean, z: sd > 0 ? mean / (sd / Math.sqrt(d.length)) : 0 }; };

const games = loadGames();
const t0 = games[0].t, t1 = games[games.length - 1].t;
const day = (t) => new Date(t).toISOString().slice(0, 10);
console.log(`${games.length} league games, ${day(t0)} .. ${day(t1)}`);
if (argv.includes('--grid')) {
  // first 8 days warm up the ratings; then the middle block tunes and the last block is the unseen check
  const span = t1 - t0, mid0 = t0 + 8 * DAY, mid1 = mid0 + (span - 8 * DAY) / 2, end = t1 + 1;
  const baseMid = run(games, mid0, mid1), baseEnd = run(games, mid1, end);
  console.log(`live settings ${JSON.stringify(P.RATE)}`);
  console.log(`  middle block (${day(mid0)} .. ${day(mid1)}): ${baseMid.n} games, total miss ${baseMid.mae.toFixed(3)} (league average alone ${baseMid.naive.toFixed(3)}), winner ${Math.round(100 * baseMid.win)}%`);
  console.log(`  last block   (${day(mid1)} .. ${day(end)}): ${baseEnd.n} games, total miss ${baseEnd.mae.toFixed(3)} (league average alone ${baseEnd.naive.toFixed(3)}), winner ${Math.round(100 * baseEnd.win)}%`);
  const grid = [];
  for (const halfLifeDays of [7, 10, 14, 21]) for (const player of [2, 3, 5, 8]) for (const gamerTeam of [4, 8, 16]) for (const pair of [4, 8, 16]) for (const team of [10, 20, 40]) grid.push({ halfLifeDays, player, gamerTeam, pair, team });
  let best = null;
  for (const r of grid) { const x = run(games, mid0, mid1, r); if (!best || x.mae < best.x.mae) best = { r, x }; }
  const p1 = paired(baseMid, best.x);
  console.log(`best on the middle block: ${JSON.stringify(best.r)} → ${best.x.mae.toFixed(3)} (change ${p1.mean.toFixed(3)}, z ${p1.z.toFixed(1)})`);
  const chk = run(games, mid1, end, best.r), p2 = paired(baseEnd, chk);
  console.log(`same settings on the unseen last block: ${baseEnd.mae.toFixed(3)} → ${chk.mae.toFixed(3)} (change ${p2.mean.toFixed(3)}, z ${p2.z.toFixed(1)}), winner ${Math.round(100 * baseEnd.win)}% → ${Math.round(100 * chk.win)}%`);
} else {
  const rate = Object.fromEntries(String(arg('--rate', '')).split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v]; }));
  const from = arg('--from') ? Date.parse(arg('--from')) : t0 + 8 * DAY, to = arg('--to') ? Date.parse(arg('--to')) + DAY : t1 + 1;
  const x = run(games, from, to, rate);
  console.log(`${day(from)} .. ${day(to - 1)}: ${x.n} games | total miss ${x.mae.toFixed(3)} (bias ${x.bias.toFixed(2)}) | league average alone ${x.naive.toFixed(3)} | winner picked ${Math.round(100 * x.win)}%`);
  if (arg('--out')) L.writeJSON(path.resolve(L.ROOT, arg('--out')), { rate, rows: x.rows });
}
