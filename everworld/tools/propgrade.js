#!/usr/bin/env node
/* Our number against the books' player lines, on finished games (lines recorded by tools/proprec.js before each tip).
 *   node tools/propgrade.js <rows.json.gz> [<rows.json.gz> ...] [--stage 0|rep] [--snap closing|first] [--min 10]
 * rows = `bt2 --dump` of the same games (stages rep and 0). For every player and stat with a line: our number, the consensus
 * line (the app's own rule: the middle line of all books), the result. Reports the average miss of each, of mixes of the two,
 * how much of our gap to the line really shows up in the result, and how the plus edges did.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const files = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const E = require(path.join(L.ROOT, 'cs/build/engine.js'));
const STAGE = arg('--stage', '0'), SNAP = arg('--snap', 'closing'), MINP = +arg('--min', 10);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const STATS = [['pts', 1, 'PTS'], ['reb', 2, 'REB'], ['ast', 3, 'AST'], ['fg3m', 4, '3PM']];
// every recorded snapshot of a game, oldest first
const snapsOf = new Map();
const pdir = path.join(L.DATA, 'props');
if (fs.existsSync(pdir)) for (const d of fs.readdirSync(pdir)) { const dd = path.join(pdir, d); if (!fs.statSync(dd).isDirectory()) continue; for (const f of fs.readdirSync(dd)) { const m = /^(\d+)-(\d{4})\.json\.gz$/.exec(f); if (!m) continue; if (!snapsOf.has(+m[1])) snapsOf.set(+m[1], []); snapsOf.get(+m[1]).push(path.join(dd, f)); } }
const linesFor = (gid) => {
  const list = (snapsOf.get(+gid) || []).map((f) => L.readJSON(f)).filter((s) => s && Array.isArray(s.rows) && s.rows.length && !(s.game && s.game.started)).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (!list.length) return null;
  const tip = list[0].game && list[0].game.datetime ? Date.parse(list[0].game.datetime) : Infinity;
  const before = list.filter((s) => Date.parse(s.at) < tip);
  const pick = SNAP === 'first' ? list[0] : (before.length ? before[before.length - 1] : list[list.length - 1]);
  return { at: pick.at, minsBefore: Math.round((tip - Date.parse(pick.at)) / 60000), lines: E.consensusLines(pick.rows), snaps: list.length };
};
const rows = files.flatMap((f) => L.readJSON(path.resolve(f))).filter((r) => (STAGE === 'rep' ? r.g === 'rep' : r.el === 0 && r.g !== 'rep'));
const games = [...new Set(rows.map((r) => r.id))];
const LN = new Map(games.map((g) => [g, linesFor(g)]));
const withLines = games.filter((g) => LN.get(g));
console.log(`${games.length} games in the rows, ${withLines.length} with recorded lines (${SNAP} snapshot; minutes before the tip: ${withLines.map((g) => LN.get(g).minsBefore).join(', ')}); stage ${STAGE === 'rep' ? 'before lineups' : 'tip-off'}`);
if (!withLines.length) process.exit(0);
const S = []; // one entry per player and stat with a line
const played = [];
for (const r of rows) {
  const G = LN.get(r.id); if (!G) continue;
  const has = STATS.some(([k]) => G.lines[`${r.pid}:${k}`]);
  if (!r.un && r.pr) played.push({ nm: r.nm, tm: r.tm, projMin: r.pr[0], realMin: r.ac ? r.ac[0] : 0, has });
  if (r.un || !r.pr || !r.ac) continue;
  for (const [k, ix, lab] of STATS) { const c = G.lines[`${r.pid}:${k}`]; if (!c) continue; S.push({ k: lab, nm: r.nm, tm: r.tm, ours: r.pr[ix], avg: r.mn ? r.mn[ix] : r.pr[ix], line: c.line, fair: c.fairOver, books: c.books, act: r.ac[ix], min: r.ac[0], projMin: r.pr[0] }); }
}
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
console.log(`\nAverage miss, players who really played ${MINP}+ minutes (a line is a half-point number: its miss is never 0)`);
console.log('stat | lines | ours   | book   | 25% book | 50% book | 75% book | bias ours / book | of our gap to the line, the share that showed up');
for (const [, , lab] of STATS) {
  const R = S.filter((x) => x.k === lab && x.min >= MINP); if (R.length < 5) { console.log(`${lab}: ${R.length} lines`); continue; }
  const m = (f) => mean(R.map((x) => Math.abs(f(x) - x.act)));
  let sxy = 0, sxx = 0; for (const x of R) { sxy += (x.ours - x.line) * (x.act - x.line); sxx += (x.ours - x.line) ** 2; }
  console.log(`${lab.padEnd(4)} | ${String(R.length).padStart(5)} | ${fmt(m((x) => x.ours), 3)}  | ${fmt(m((x) => x.line), 3)}  | ${fmt(m((x) => 0.75 * x.ours + 0.25 * x.line), 3)}    | ${fmt(m((x) => 0.5 * x.ours + 0.5 * x.line), 3)}    | ${fmt(m((x) => 0.25 * x.ours + 0.75 * x.line), 3)}    | ${fmt(mean(R.map((x) => x.ours - x.act)))} / ${fmt(mean(R.map((x) => x.line - x.act)))}     | ${fmt(sxx > 0 ? sxy / sxx : NaN)} (1 = our gap was all real, 0 = the book was right)`);
}
console.log('\nHow far our number sits from the line, and who was closer when the two disagreed');
for (const [, , lab] of STATS) {
  const R = S.filter((x) => x.k === lab && x.min >= MINP); if (R.length < 5) continue;
  const gap = R.map((x) => x.ours - x.line), sd = Math.sqrt(mean(gap.map((g) => (g - mean(gap)) ** 2)));
  const big = R.filter((x) => Math.abs(x.ours - x.line) >= 1.5 * sd);
  console.log(`${lab}: our number is ${fmt(mean(gap))} from the line on average (spread ${fmt(sd)}); in the ${big.length} widest disagreements we were closer ${big.filter((x) => Math.abs(x.ours - x.act) < Math.abs(x.line - x.act)).length} times, the book ${big.filter((x) => Math.abs(x.ours - x.act) > Math.abs(x.line - x.act)).length}`);
}
console.log('\nPlus edges (our number ahead of the line): how often the result beat the line (a push counts as half)');
const hit = (R) => (R.length ? mean(R.map((x) => (x.act > x.line ? 1 : x.act === x.line ? 0.5 : 0))) : NaN);
for (const [, , lab] of STATS) {
  const R = S.filter((x) => x.k === lab && x.min > 0); if (R.length < 5) continue;
  const row = [[0, 0.5], [0.5, 1.5], [1.5, 3], [3, 99]].map(([a, b]) => { const B = R.filter((x) => x.ours - x.line >= a && x.ours - x.line < b); return `ahead by ${a} to ${b === 99 ? 'more' : b}: ${B.length ? Math.round(100 * hit(B)) + '%' : '—'} (${B.length})`; });
  const below = R.filter((x) => x.ours < x.line);
  console.log(`${lab}: ${row.join(' | ')} || our number below the line: result beat the line ${below.length ? Math.round(100 * hit(below)) + '%' : '—'} (${below.length})`);
}
// players we gave real minutes to: did the books have a line, and did they play?
console.log('\nPlayers we projected for 15+ minutes: with and without any book line');
for (const has of [true, false]) { const P = played.filter((p) => p.projMin >= 15 && p.has === has); console.log(`  ${has ? 'with a line' : 'no line at any book'}: ${P.length} players; did not play ${P.filter((p) => !(p.realMin > 0)).length}; played under 10 minutes ${P.filter((p) => p.realMin > 0 && p.realMin < 10).length}; minutes miss ${fmt(mean(P.map((p) => Math.abs(p.projMin - p.realMin))))}${has ? '' : ' → ' + P.filter((p) => !(p.realMin > 0)).map((p) => p.nm).slice(0, 8).join(', ')}`); }
if (arg('--out')) L.writeJSON(path.resolve(arg('--out')), S);
