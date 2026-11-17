#!/usr/bin/env node
/* GG League, before the game: where the gamer ratings still miss (walk-forward: every game projected from games that finished
 * before it; ratings refit every 50 games on the 21 days before). Study of Nov 13, 2026.
 *   node tools/research/gg-04-pregame.js [--model gg/static/profiles.js] [--dump rows.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const P = require(path.resolve(L.ROOT, arg('--model', 'gg/static/profiles.js')));
const DAY = 86400000, WINDOW_DAYS = 21, STEP = 50;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const seen = new Map();
const add = (r) => { const g = { id: r[0], t: r[1], a: P.norm(r[2]), b: P.norm(r[3]), ta: P.normTeam(r[4]), tb: P.normTeam(r[5]), sa: r[6], sb: r[7] }; if (g.sa + g.sb >= 30) seen.set(g.id, g); };
for (const r of JSON.parse(fs.readFileSync(path.join(L.ROOT, 'gg/static/seed/seed-finals.json'), 'utf8'))) add(r);
const dir = path.join(L.DATA, 'eb');
for (const f of fs.readdirSync(dir).filter((x) => /^finals-.*\.json$/.test(x))) for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) add(r);
const G = [...seen.values()].sort((x, y) => x.t - y.t);
const rows = [];
let R = null, at = -1;
const hist = new Map(); // gamer -> his finished games so far (time order)
const from = G[0].t + 8 * DAY;
for (let i = 0; i < G.length; i++) {
  const g = G[i];
  if (g.t >= from) {
    if (!R || i - at >= STEP) { const past = G.filter((x) => x.t <= g.t - 25 * 60000 && x.t >= g.t - WINDOW_DAYS * DAY); R = past.length >= 150 ? P.fitRatings(past, g.t) : null; at = i; }
    if (R) {
      const [pa, pb] = P.ratedPoints(R, g.a, g.b, g.ta, g.tb);
      const ha = (hist.get(g.a) || []).filter((x) => x.t <= g.t - 25 * 60000), hb = (hist.get(g.b) || []).filter((x) => x.t <= g.t - 25 * 60000);
      const today = (h) => h.filter((x) => g.t - x.t < 12 * 3600000);
      const lastRes = (h, who) => { const x = h[h.length - 1]; return x && g.t - x.t < 3 * 3600000 && x.res != null ? x.res : null; };
      rows.push({ id: g.id, t: g.t, pred: pa + pb, act: g.sa + g.sb, pa, pb, sa: g.sa, sb: g.sb, mu: 2 * R.mu, nA: ha.length, nB: hb.length, todayA: today(ha).length, todayB: today(hb).length, restA: ha.length ? (g.t - ha[ha.length - 1].t) / 60000 : null, restB: hb.length ? (g.t - hb[hb.length - 1].t) / 60000 : null, lastA: lastRes(ha), lastB: lastRes(hb), hour: new Date(g.t).getUTCHours() });
      g.res = (g.sa + g.sb) - (pa + pb);
    }
  }
  for (const who of [g.a, g.b]) { if (!hist.has(who)) hist.set(who, []); hist.get(who).push(g); }
}
if (arg('--dump')) fs.writeFileSync(path.resolve(L.ROOT, arg('--dump')), JSON.stringify(rows));
const err = (r) => r.pred - r.act, mae = (R2, f = err) => mean(R2.map((r) => Math.abs(f(r))));
console.log(`${rows.length} games projected (${new Date(rows[0].t).toISOString().slice(0, 10)} to ${new Date(rows[rows.length - 1].t).toISOString().slice(0, 10)}): miss ${mae(rows).toFixed(3)}, bias ${mean(rows.map(err)).toFixed(2)}, league average alone ${mae(rows, (r) => r.mu - r.act).toFixed(3)}`);
// 1. are the numbers stretched enough? real total against projected total
{ const mx = mean(rows.map((r) => r.pred)), my = mean(rows.map((r) => r.act)); let sxy = 0, sxx = 0; for (const r of rows) { sxy += (r.pred - mx) * (r.act - my); sxx += (r.pred - mx) ** 2; } const b = sxy / sxx;
  console.log(`\n1. real total = ${(my - b * mx).toFixed(1)} + ${b.toFixed(3)} x our number (1.000 = stretched exactly right). spread of our numbers ${Math.sqrt(sxx / rows.length).toFixed(2)}, of real totals ${Math.sqrt(mean(rows.map((r) => (r.act - my) ** 2))).toFixed(2)}`);
  for (const k of [1.05, 1.1, 1.15, 1.2]) console.log(`   stretched ${k}x around the average: miss ${mae(rows, (r) => mx + k * (r.pred - mx) - r.act).toFixed(3)}`);
  const sorted = rows.slice().sort((a, b2) => a.pred - b2.pred), n5 = Math.floor(rows.length / 5);
  for (let q = 0; q < 5; q++) { const S = sorted.slice(q * n5, q === 4 ? rows.length : (q + 1) * n5); console.log(`   our number ${S[0].pred.toFixed(0)} to ${S[S.length - 1].pred.toFixed(0)}: ours ${mean(S.map((r) => r.pred)).toFixed(1)}, real ${mean(S.map((r) => r.act)).toFixed(1)}, miss ${mae(S).toFixed(2)} (${S.length})`); } }
// 2. does the league run hot or cold by day, and can the day's earlier games tell?
{ const byDay = new Map(); for (const r of rows) { const d = new Date(r.t).toISOString().slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
  console.log('\n2. by day: games, real minus our number (first half of the day | second half)');
  let sxy = 0, sxx = 0, n = 0; const xs = [], ys = [];
  for (const [d, S] of byDay) { const h = Math.floor(S.length / 2), a = mean(S.slice(0, h).map((r) => r.act - r.pred)), b = mean(S.slice(h).map((r) => r.act - r.pred)); xs.push(a); ys.push(b); console.log(`   ${d}: ${String(S.length).padStart(3)}  ${a >= 0 ? '+' : ''}${a.toFixed(2)} | ${b >= 0 ? '+' : ''}${b.toFixed(2)}`); }
  const mx = mean(xs), my = mean(ys); for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; n++; }
  console.log(`   second half of a day follows the first half with slope ${(sxy / sxx).toFixed(2)} (${n} days)`);
  // running: the average miss of the last 30 league games before this one (any gamer)
  for (const N of [20, 40, 80]) for (const k of [0.25, 0.5, 0.75]) { const out = []; for (let i = N; i < rows.length; i++) { let s = 0, c = 0; for (let j = i - 1; j >= 0 && c < N; j--) if (rows[j].t <= rows[i].t - 25 * 60000) { s += rows[j].act - rows[j].pred; c++; } if (c === N) out.push([rows[i], k * s / c]); } console.log(`   add ${k} x the average miss of the last ${N} finished league games: ${mae(out.map((x) => x[0])).toFixed(3)} → ${mean(out.map(([r, a]) => Math.abs(r.pred + a - r.act))).toFixed(3)}`); } }
// 3. a gamer's day: how many he has played today, rest since his last game, how his last game went
{ console.log('\n3. real minus our number by situation');
  const grp = (label, f) => { const m = new Map(); for (const r of rows) { const k = f(r); if (k == null) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } console.log(`   ${label}: ` + [...m.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1)).map(([k, S]) => `${k}: ${mean(S.map((r) => r.act - r.pred)) >= 0 ? '+' : ''}${mean(S.map((r) => r.act - r.pred)).toFixed(2)} (${S.length})`).join('  ')); };
  grp('games both have played today (sum)', (r) => { const s = r.todayA + r.todayB; return s === 0 ? 'a:0' : s <= 3 ? 'b:1-3' : s <= 8 ? 'c:4-8' : s <= 14 ? 'd:9-14' : 'e:15+'; });
  grp('shortest rest (minutes)', (r) => { if (r.restA == null || r.restB == null) return null; const m = Math.min(r.restA, r.restB); return m < 35 ? 'a:<35' : m < 70 ? 'b:35-70' : m < 240 ? 'c:70-240' : 'd:240+'; });
  grp('hour of day (UTC)', (r) => `${String(Math.floor(r.hour / 4) * 4).padStart(2, '0')}h`);
  grp('fewer games known (lower of the two)', (r) => { const m = Math.min(r.nA, r.nB); return m < 5 ? 'a:<5' : m < 15 ? 'b:5-14' : m < 40 ? 'c:15-39' : 'd:40+'; });
  const withLast = rows.filter((r) => r.lastA != null || r.lastB != null); const x = withLast.map((r) => mean([r.lastA, r.lastB].filter((v) => v != null))), y = withLast.map((r) => r.act - r.pred); const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0; for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  console.log(`   how the gamers' last game (within 3 hours) ran against our number carries into this one with slope ${(sxy / sxx).toFixed(3)} (${withLast.length} games)`);
  for (const k of [0.05, 0.1, 0.15]) console.log(`      adding ${k} x that: ${mae(withLast).toFixed(3)} → ${mean(withLast.map((r, i) => Math.abs(r.pred + k * x[i] - r.act))).toFixed(3)}`);
  console.log(`   miss when both gamers have 40+ games: ${mae(rows.filter((r) => Math.min(r.nA, r.nB) >= 40)).toFixed(3)}; when one has fewer than 15: ${mae(rows.filter((r) => Math.min(r.nA, r.nB) < 15)).toFixed(3)}`); }
