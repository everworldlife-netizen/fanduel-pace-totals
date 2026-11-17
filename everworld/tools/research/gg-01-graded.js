#!/usr/bin/env node
/* GG League: how the server's numbers did on its own graded games (study of Nov 13, 2026).
 *   node tools/research/gg-01-graded.js data/eb/probe2/api_eb_graded_days_14.json [older graded file ...]
 * For every graded game: the pregame number, FanDuel's line and our live number at each checkpoint, against the final.
 */
'use strict';
const fs = require('fs');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const seen = new Map();
for (const f of process.argv.slice(2)) for (const g of JSON.parse(fs.readFileSync(f, 'utf8')).graded) if (!seen.has(g.eventId) || (g.gradedAt || 0) > (seen.get(g.eventId).gradedAt || 0)) seen.set(g.eventId, g);
const G = [...seen.values()].filter((g) => g.final && Number.isFinite(g.final.total)).sort((a, b) => a.scheduledMs - b.scheduledMs);
const day = (g) => new Date(g.scheduledMs).toISOString().slice(0, 10);
console.log(`${G.length} graded games, ${day(G[0])} to ${day(G[G.length - 1])}`);
const src = {}; for (const g of G) { const k = `${day(g)} ${g.finalSource}`; src[k] = (src[k] || 0) + 1; } console.log('final score from:', JSON.stringify(src));
const tot = G.map((g) => g.final.total); console.log(`final totals: average ${mean(tot).toFixed(1)}, spread (sd) ${Math.sqrt(mean(tot.map((x) => (x - mean(tot)) ** 2))).toFixed(1)}`);
const line = (name, rows, f) => { const r = rows.filter((x) => Number.isFinite(f(x))); const e = r.map((x) => f(x) - x.final); console.log(`  ${name.padEnd(46)} n ${String(r.length).padStart(3)}  miss ${mean(e.map(Math.abs)).toFixed(2)}  bias ${mean(e) >= 0 ? '+' : ''}${mean(e).toFixed(2)}`); };
// before the game
const pre = G.map((g) => ({ final: g.final.total, model: g.pregame && g.pregame.model, exp: g.pregame && g.pregame.expected, close: g.close && g.close.game && !g.close.late ? g.close.game.line : NaN, closeAny: g.close && g.close.game ? g.close.game.line : NaN, c0line: g.checkpoints && g.checkpoints[0] && g.checkpoints[0].game ? g.checkpoints[0].game.line : NaN, c0mean: g.checkpoints && g.checkpoints[0] && g.checkpoints[0].game ? g.checkpoints[0].game.mean : NaN, d: day(g) }));
console.log('\nBEFORE THE GAME');
line('our pregame number (expected), all games', pre, (x) => x.exp);
line('ratings alone (model), all games', pre, (x) => x.model);
line('league average of these games', pre, () => mean(tot));
const withLine = pre.filter((x) => Number.isFinite(x.c0line));
console.log(` games with a FanDuel line seen before the tip: ${withLine.length}`);
line('our pregame number, those games', withLine, (x) => x.exp);
line("FanDuel's pregame line, those games", withLine, (x) => x.c0line);
for (const w of [0.25, 0.5, 0.75]) line(`mix: ${w} ours + ${1 - w} FanDuel`, withLine, (x) => w * x.exp + (1 - w) * x.c0line);
for (const d of [...new Set(pre.map((x) => x.d))]) line(`our pregame number on ${d}`, pre.filter((x) => x.d === d), (x) => x.exp);
// during the game
console.log('\nDURING THE GAME (checkpoint = share of the game played)');
for (const cp of ['25', '50', '75']) {
  const rows = G.filter((g) => g.checkpoints && g.checkpoints[cp] && g.checkpoints[cp].game && Number.isFinite(g.checkpoints[cp].game.line) && Number.isFinite(g.checkpoints[cp].game.mean)).map((g) => ({ final: g.final.total, line: g.checkpoints[cp].game.line, mean: g.checkpoints[cp].game.mean, f: g.checkpoints[cp].f, exp: g.pregame && g.pregame.expected, call: g.checkpoints[cp].game.call }));
  console.log(` checkpoint ${cp}%: ${rows.length} games, real share played ${mean(rows.map((r) => r.f)).toFixed(2)} (from ${Math.min(...rows.map((r) => r.f)).toFixed(2)} to ${Math.max(...rows.map((r) => r.f)).toFixed(2)})`);
  line('our raw number (player history + score)', rows, (x) => x.mean);
  line("FanDuel's live line", rows, (x) => x.line);
  let best = [0, 1e9]; for (let w = 0; w <= 1.0001; w += 0.05) { const m = mean(rows.map((x) => Math.abs(w * x.mean + (1 - w) * x.line - x.final))); if (m < best[1]) best = [w, m]; }
  for (const w of [0.15, 0.3, 0.45, 0.6]) line(`shown number if the mix were ${w} ours`, rows, (x) => w * x.mean + (1 - w) * x.line);
  console.log(`   best mix on these games: ${best[0].toFixed(2)} ours → miss ${best[1].toFixed(2)}`);
}
