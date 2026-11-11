#!/usr/bin/env node
/* GG Winner real-league test: replay finished NBA games minute by minute and grade the live totals model
 * (gg/static/league-live.js) against the real final total, with the closing line as the starting total (PRIOR=line).
 *
 *   node tools/ggbt.js [--model gg/static/league-live.js] [--seasons 2026,2027] [--from D --to D] [--out data/ll/x.json]
 *        [--prior line|none|live:<minute>]   live:<minute> = the first line this phone saw was a LIVE line at that game minute
 *   node tools/ggbt.js --cmp data/ll/A.json data/ll/B.json       paired comparison (B is the candidate)
 *
 * The model gets only what one /api/games row holds at that moment: both scores, quarter scores, period and clock.
 * Final = regulation plus overtime, as the books settle it. Nothing after the moment reaches the model.
 */
'use strict';
const path = require('path');
const L = require('./lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MOMENTS = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 46.5, 47.5];
const label = (m) => (m === 12 ? 'end Q1' : m === 24 ? 'half' : m === 36 ? 'end Q3' : m === 42 ? '6:00 left' : m === 45 ? '3:00 left' : `${m} min`);

if (argv.includes('--cmp')) {
  const i = argv.indexOf('--cmp');
  const A = L.readJSON(path.resolve(argv[i + 1])), B = L.readJSON(path.resolve(argv[i + 2]));
  console.log(`A = ${argv[i + 1]}\nB = ${argv[i + 2]}   (negative change = B lands closer)`);
  for (const m of MOMENTS) {
    const a = A.rows[m], b = B.rows[m]; if (!a || !b) continue;
    const ids = Object.keys(a).filter((id) => b[id] != null);
    const d = ids.map((id) => Math.abs(b[id]) - Math.abs(a[id]));
    const ma = ids.reduce((s, id) => s + Math.abs(a[id]), 0) / ids.length, mb = ids.reduce((s, id) => s + Math.abs(b[id]), 0) / ids.length;
    const mean = d.reduce((s, x) => s + x, 0) / d.length, sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(d.length - 1, 1));
    const ba = ids.reduce((s, id) => s + a[id], 0) / ids.length, bb = ids.reduce((s, id) => s + b[id], 0) / ids.length;
    console.log(`${label(m).padEnd(10)} games ${ids.length} | miss ${ma.toFixed(2)} → ${mb.toFixed(2)} (${(100 * (mb / ma - 1)).toFixed(1)}%, z ${(sd > 0 ? mean / (sd / Math.sqrt(d.length)) : 0).toFixed(1)}) | bias ${ba.toFixed(2)} → ${bb.toFixed(2)}`);
  }
  process.exit(0);
}

const modelPath = path.resolve(L.ROOT, arg('--model', 'gg/static/league-live.js'));
const LL = require(modelPath);
const seasons = String(arg('--seasons', '2026,2027')).split(',').map(Number);
const from = arg('--from', '0000'), to = arg('--to', '9999');
const priorMode = arg('--prior', 'line');
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** One /api/games row as it stood `t` game minutes in, built from the scoring timeline. */
function rowAt(it, t) {
  const q = [[0, 0, 0, 0], [0, 0, 0, 0]]; // [visitor, home] by quarter
  let v = 0, h = 0;
  // a basket at the buzzer (exactly 12.0, 24.0 ... minutes) belongs to the quarter that just ended
  for (const e of it.log.sc) { if (e[0] > t + 1e-9) break; const per = Math.min(3, Math.max(0, Math.ceil(e[0] / 12 - 1e-9) - 1)); q[e[1]][per] += e[2]; if (e[1] === 0) v += e[2]; else h += e[2]; }
  const per = Math.min(4, Math.floor(Math.min(t, 47.999) / 12) + 1);
  const atBreak = t > 0 && t % 12 === 0 && t < 48;
  const period = atBreak ? t / 12 : per;
  const left = period * 12 - t;
  const row = { leagueId: 'nba', leagueName: 'NBA', status: t === 24 ? 'halftime' : 'in_progress', period, clock: fmt(left * 60), statusDetail: t === 24 ? 'Halftime' : `Q${period}`,
    home: { score: h, qScores: q[1].slice(0, period) }, away: { score: v, qScores: q[0].slice(0, period) } };
  return { row, pts: v + h };
}

const rows = Object.fromEntries(MOMENTS.map((m) => [m, {}]));
const ref = Object.fromEntries(MOMENTS.map((m) => [m, { n: 0, line: 0, rate: 0, lineBias: 0 }]));
let games = 0;
for (const s of seasons) {
  for (const it of L.readJSON(path.join(L.DATA, 'derived', `games-${s}.json.gz`))) {
    const g = it.g;
    if (g.date < from || g.date > to || !it.market || !it.market.total || !it.log.sc || it.log.sc.length < 50) continue;
    const final = g.home_team_score + g.visitor_team_score;
    const T0 = it.market.total;
    games++;
    let firstSeen = null;
    for (const m of MOMENTS) {
      const { row, pts } = rowAt(it, m);
      let opts;
      if (priorMode === 'line') opts = { prior: T0 };
      else if (priorMode === 'none') opts = {};
      else {
        // the phone first opened the tab at game minute M and saw a LIVE line there: a sharp live line is modelled as the
        // score at M plus the closing-line rate for the minutes left (what a book would hang with no view on pace)
        const M = +priorMode.split(':')[1];
        if (m < M) continue;
        if (!firstSeen) { const r0 = rowAt(it, M); const p0 = LL.progress(r0.row, { prior: T0 }); firstSeen = { line: Math.round((r0.pts + (T0 / 48) * (48 - M)) * 2) / 2, pts: r0.pts, elapsed: p0.elapsed, at: 0 }; }
        opts = { prior: firstSeen.line, priorSeen: firstSeen };
      }
      const r = LL.project(row, opts);
      rows[m][g.id] = +(r.full - final).toFixed(2);
      ref[m].n++; ref[m].line += Math.abs(T0 - final); ref[m].lineBias += T0 - final; ref[m].rate += Math.abs(pts + (T0 / 48) * (48 - m) - final);
    }
  }
}
console.log(`model ${path.relative(L.ROOT, modelPath)} | seasons ${seasons.join(',')} | starting total: ${priorMode} | games ${games}`);
{ const r0 = ref[MOMENTS[0]]; console.log(`closing line alone: miss ${(r0.line / r0.n).toFixed(2)}, bias ${(r0.lineBias / r0.n).toFixed(2)}`); }
console.log('moment     |  miss   bias | score + line rate');
for (const m of MOMENTS) {
  const xs = Object.values(rows[m]); if (!xs.length) continue;
  const mae = xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length, bias = xs.reduce((s, x) => s + x, 0) / xs.length;
  console.log(`${label(m).padEnd(10)} | ${mae.toFixed(2).padStart(5)} ${bias.toFixed(2).padStart(6)} | ${(ref[m].rate / ref[m].n).toFixed(2).padStart(17)}`);
}
if (arg('--out')) L.writeJSON(path.resolve(L.ROOT, arg('--out')), { model: modelPath, seasons, priorMode, games, rows });
