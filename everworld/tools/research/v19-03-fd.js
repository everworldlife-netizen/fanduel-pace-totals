#!/usr/bin/env node
/* FanDuel's own menu against the results, on recorded nights: every FanDuel line of a game's last snapshot before the tip
 * (the main lines and the "20+ points" style milestones), the chance the engine gives it, FanDuel's price, what happened,
 * and the money: one unit on every play the engine likes, at FanDuel's price.
 *   node tools/research/v19-03-fd.js [--from 2026-11-13] [--to] [--stage 0|rep] [--book fanduel] [--engine cs/build/engine.js] [--nsims 2000] [--out file]
 * A player who does not play is no action. A main line landed on exactly is a push (stake back).
 */
'use strict';
const path = require('path');
const L = require('../lib');
const R = require('../replay');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const opt = { engine: arg('--engine', 'cs/build/engine.js'), from: arg('--from', '2026-11-13'), to: arg('--to', '9999'), stage: arg('--stage', '0'), book: arg('--book', 'fanduel'), nsims: +arg('--nsims', 2000), out: arg('--out', null), snap: arg('--snap', 'closing') };
const E = R.loadEngine(opt.engine);
const S = R.loadSeasons([2027]);
const patterns = E.patBeta(null), sit = R.sitPriorShipped(E, opt.engine);
const MAP = { points: 'pts', rebounds: 'reb', assists: 'ast', threes: 'fg3m', points_rebounds_assists: 'pra' };
const be = (a) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100)); // the chance a price needs to break even
const win = (a) => (a < 0 ? 100 / -a : a / 100); // profit on one unit when it comes in
const statOf = (r, k) => (k === 'pra' ? (r.pts || 0) + (r.reb || 0) + (r.ast || 0) : r[k] || 0);
const rows = [];
let games = 0;
for (const it of S.games.filter((x) => x.g.date >= opt.from && x.g.date <= opt.to && !x.g.postseason)) {
  const lines = R.recordedLines(it.g, opt.snap); if (!lines) continue;
  const ctx = R.contextFor(E, S, it, { avail: 'tip' }); if (!ctx.ok) continue;
  const plays = L.readJSON(path.join(L.DATA, 'plays', `${it.g.id}.json.gz`));
  const m = R.momentAt(E, it.g, plays, 0);
  const P = E.projectGame({ ...ctx.base, ...(opt.stage === 'rep' ? { avail: ctx.availReport } : {}), game: m.game, plays: m.plays, nsims: opt.nsims, seed: it.g.id, patterns, sitPrior: sit });
  const truth = it.truth || it.log.rows;
  games++;
  // the same line at the other books: the chance their prices need, to see where this book pays more than the market does
  const others = new Map();
  for (const x of lines) { if (x.vendor === opt.book || !x.market) continue; const o = x.market.type === 'milestone' ? +x.market.odds : +x.market.over_odds; if (!Number.isFinite(o)) continue; const key = `${x.player_id}:${x.prop_type}:${x.market.type}:${parseFloat(x.line_value)}`; if (!others.has(key)) others.set(key, []); others.get(key).push(be(o)); }
  const mktOf = (x) => { const a = (others.get(`${x.player_id}:${x.prop_type}:${x.market.type}:${parseFloat(x.line_value)}`) || []).slice().sort((u, v) => u - v); return a.length >= 2 ? a[Math.floor(a.length / 2)] : null; };
  for (const x of lines) {
    if (x.vendor !== opt.book || !MAP[x.prop_type] || !x.market) continue;
    const k = MAP[x.prop_type], p = P.players.find((q) => +q.pid === +x.player_id); if (!p || !p._sims) continue;
    const a = truth[x.player_id]; if (!a || !(a.min > 0)) continue; // did not play: no action
    const got = statOf(a, k), line = parseFloat(x.line_value);
    if (x.market.type === 'milestone' && Number.isFinite(+x.market.odds)) {
      const pr = E.calProb(p, k, E.probAtLeast ? E.probAtLeast(p._sims[k], line) : Array.from(p._sims[k]).filter((v) => v >= line).length / p._sims[k].length);
      rows.push({ mkt: mktOf(x), d: it.g.date, g: it.g.id, nm: p.name, k, kind: 'mile', t: line, odds: +x.market.odds, be: be(+x.market.odds), p: pr, y: got >= line ? 1 : 0, push: 0, proj: k === 'pra' ? p.proj.pts + p.proj.reb + p.proj.ast : p.proj[k], sure: p.sure ? p.sure[k] : null, got, min: p.proj.min });
    } else if (x.market.type === 'over_under' && Number.isFinite(+x.market.over_odds)) {
      const need = Math.floor(line) + 1, a2 = Array.from(p._sims[k]);
      const pr = E.calProb(p, k, a2.filter((v) => v >= need).length / a2.length);
      rows.push({ mkt: mktOf(x), d: it.g.date, g: it.g.id, nm: p.name, k, kind: 'main', t: line, odds: +x.market.over_odds, be: be(+x.market.over_odds), p: pr, y: got > line ? 1 : 0, push: got === line ? 1 : 0, proj: k === 'pra' ? p.proj.pts + p.proj.reb + p.proj.ast : p.proj[k], sure: p.sure ? p.sure[k] : null, got, min: p.proj.min });
    }
  }
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const money = (R0) => R0.reduce((s, r) => s + (r.push ? 0 : r.y ? win(r.odds) : -1), 0);
const line = (label, R0) => { if (!R0.length) return `${label.padEnd(34)} —`; const u = money(R0), n = R0.length; const sd = Math.sqrt(R0.reduce((s, r) => { const v = r.push ? 0 : r.y ? win(r.odds) : -1; return s + (v - u / n) ** 2; }, 0) / Math.max(n - 1, 1)); return `${label.padEnd(34)} ${String(n).padStart(5)} plays | came in ${(100 * mean(R0.map((r) => r.y))).toFixed(1)}% | we said ${(100 * mean(R0.map((r) => r.p))).toFixed(1)}% | price needs ${(100 * mean(R0.map((r) => r.be))).toFixed(1)}% | units ${u >= 0 ? '+' : ''}${u.toFixed(1)} (${(100 * u / n).toFixed(1)}% per play, ± ${(100 * sd / Math.sqrt(n)).toFixed(1)})`; };
console.log(`${opt.book} lines, ${games} games ${opt.from}..${opt.to === '9999' ? 'now' : opt.to}, ${opt.snap} snapshot, stage ${opt.stage === 'rep' ? 'before lineups' : 'tip-off'}: ${rows.length} lines (${rows.filter((r) => r.kind === 'mile').length} milestones, ${rows.filter((r) => r.kind === 'main').length} main lines, plus side)`);
for (const kind of ['mile', 'main']) {
  const K = rows.filter((r) => r.kind === kind && r.k !== 'pra');
  console.log(`\n== ${kind === 'mile' ? 'Milestones ("N+ points")' : 'Main lines, the plus side'} (points, rebounds, assists, threes)`);
  console.log(line('every line, played blind', K));
  console.log('by the chance the engine gives:');
  for (const [lo, hi] of [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.75], [0.75, 0.9], [0.9, 1.01]]) console.log(line(`  ${Math.round(lo * 100)} to ${Math.round(Math.min(hi, 1) * 100)}%`, K.filter((r) => r.p >= lo && r.p < hi)));
  console.log('by the engine\'s edge on the price (our chance minus the chance the price needs):');
  for (const [lo, hi] of [[-1, -0.05], [-0.05, 0], [0, 0.03], [0.03, 0.06], [0.06, 0.1], [0.1, 1]]) console.log(line(`  ${lo <= -1 ? 'worse than -5' : Math.round(lo * 100)} to ${hi >= 1 ? 'more' : Math.round(hi * 100)} points`, K.filter((r) => r.p - r.be >= lo && r.p - r.be < hi)));
  console.log(`against the other books (the same line at 2+ other books: the chance their middle price needs, minus the chance ${opt.book}'s price needs):`);
  for (const [lo, hi] of [[-1, -0.03], [-0.03, 0.03], [0.03, 0.06], [0.06, 1]]) console.log(line(`  ${opt.book} pays ${lo <= -1 ? 'less by 3+' : hi >= 1 ? 'more by 6+' : lo < 0 ? 'about the same' : 'more by 3 to 6'}`, K.filter((r) => r.mkt != null && r.mkt - r.be >= lo && r.mkt - r.be < hi)));
  console.log('by stat, plays the engine likes by 3 points or more:');
  for (const k of ['pts', 'reb', 'ast', 'fg3m']) console.log(line(`  ${k}`, K.filter((r) => r.k === k && r.p - r.be >= 0.03)));
  if (kind === 'mile') {
    console.log('safe plays (the engine says 85% or more):');
    console.log(line('  all of them', K.filter((r) => r.p >= 0.85)));
    console.log(line('  and the price needs under 85%', K.filter((r) => r.p >= 0.85 && r.be < 0.85)));
    console.log(line('  at or below the 9-in-10 number', K.filter((r) => r.sure != null && r.t <= r.sure)));
  }
}
if (opt.out) L.writeJSON(path.resolve(L.ROOT, opt.out), { opt, games, rows, at: new Date().toISOString() });
