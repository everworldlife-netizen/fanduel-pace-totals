#!/usr/bin/env node
/* Pregame research: the players who really played 10+ minutes and had NO number before the game (rows with un:1 at
 * elapsed 0). Who are they, and what rule would have given them a number? Point-in-time: only games before the date.
 *   node tools/research/pregame-un.js [season]
 */
'use strict';
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
const H = S.hist;
const key = (r) => r.id + ':' + r.pid, nkey = (r) => r.id + ':' + H.norm(r.nm);
const has = { rep: new Set(), pre: new Set() };
for (const r of S.rows) { has[r.g].add(key(r)); has[r.g].add(nkey(r)); }
// one un row per stage that missed him: a player with a pre row but no rep row appears once (rep); with neither, twice
const seen = new Map();
for (const u of S.un) { const k = key(u); seen.set(k, (seen.get(k) || 0) + 1); }
const list = [];
for (const u of S.un) {
  const k = key(u); if (list.find((x) => x.k === k)) continue;
  const inPre = has.pre.has(k) || has.pre.has(nkey(u)), inRep = has.rep.has(k) || has.rep.has(nkey(u));
  list.push({ k, u, missRep: !inRep, missPre: !inPre, mult: seen.get(k) });
}
console.log(`${season}: ${S.un.length} un rows at tip-off = ${list.length} player-games; no number before lineups ${list.filter((x) => x.missRep).length}, no number at tip-off either ${list.filter((x) => x.missPre).length}`);
const games = new Set(S.rows.map((r) => r.id)).size;
console.log(`  per game: ${(list.filter((x) => x.missRep).length / games).toFixed(2)} before lineups, ${(list.filter((x) => x.missPre).length / games).toFixed(2)} at tip-off; their real minutes: ${C.mean(list.filter((x) => x.missRep).map((x) => x.u.ac[0])).toFixed(1)} (rep), ${C.mean(list.filter((x) => x.missPre).map((x) => x.u.ac[0])).toFixed(1)} (pre)`);
// classify each by what the app knew
const cls = (x) => {
  const u = x.u, tg = H.byKey[u.id + ':' + u.tm]; if (!tg) return { c: 'no team-game' };
  const prior = H.team[u.tm].slice(0, tg.i).filter((g) => g.date < u.d);
  const W = prior.filter((g) => C.days(g.date, u.d) <= 21).slice(-8);
  const pid = String(H.player[u.pid] ? u.pid : (H.byName[H.norm(u.nm)] != null ? H.byName[H.norm(u.nm)] : u.pid));
  const mine = (H.player[pid] || []).filter((g) => g.date < u.d), here = mine.filter((g) => g.tm === u.tm);
  const w = W.filter((g) => g.rows[pid]).map((g) => g.rows[pid].min);
  const last3 = w.slice(-3), avg3 = last3.reduce((a, b) => a + b, 0) / 3;   // the engine divides by 3 even with fewer games
  const lt = H.lastTab[H.norm(u.nm)];
  const onList = tg.activeN && tg.activeN.get(H.norm(u.nm)); const starter = onList && onList.starter;
  const seasonMpg = mine.length ? C.mean(mine.map((g) => g.min)) : null;
  const o = { w: w.length, avg3, lastMpg: lt ? lt.mpg : null, lastGp: lt ? lt.gp : 0, seasonN: mine.length, seasonMpg, hereN: here.length, otherTeam: mine.length - here.length, starter: !!starter, onList: !!onList, teamW: W.length, wMean: w.length ? C.mean(w) : null, wLast: w.length ? w[w.length - 1] : null,
    daysOut: mine.length ? C.days(mine[mine.length - 1].date, u.d) : null };
  if (W.length < 2) o.c = 'team has fewer than 2 recent games';
  else if (w.length && avg3 < 6) o.c = 'A deep bench: played in the recent window but under 6 a game over his last 3 (sum/3)';
  else if (w.length) o.c = 'B in the recent window with 6+ a game (dropped for another reason)';
  else if (mine.length && here.length === 0) o.c = 'C new team: games this season only for another team';
  else if (mine.length) o.c = 'D back from a layoff: games here this season, none in the last 21 days / 8 team games';
  else if (lt && lt.gp >= 5) o.c = 'E first game of his season, has a line from last season';
  else o.c = 'F no line at all (rookie, two-way, call-up)';
  return o;
};
for (const [stage, flt] of [['before lineups (rep)', (x) => x.missRep], ['tip-off (pre)', (x) => x.missPre]]) {
  const q = list.filter(flt).map((x) => ({ ...x, ...cls(x) }));
  const by = {}; for (const x of q) (by[x.c] = by[x.c] || []).push(x);
  console.log(`\n${stage}: ${q.length} player-games with no number`);
  for (const [c, a] of Object.entries(by).sort((p, r) => r[1].length - p[1].length)) {
    const tg = new Set(a.map((x) => x.u.id + ':' + x.u.tm)).size;
    console.log(`  ${String(a.length).padStart(4)} (${(100 * a.length / q.length).toFixed(0)}%, ${tg} team-games)  real min ${C.mean(a.map((x) => x.u.ac[0])).toFixed(1)}  started tonight ${(100 * C.mean(a.map((x) => (x.starter ? 1 : 0)))).toFixed(0)}%  | ${c}`);
    const num = (f) => { const v = a.map(f).filter((z) => z != null && isFinite(z)); return v.length ? C.mean(v).toFixed(1) + ` (n${v.length})` : '-'; };
    console.log(`        window games ${num((x) => x.w)}  mean min in window ${num((x) => x.wMean)}  last game min ${num((x) => x.wLast)}  season games ${num((x) => x.seasonN)}  season mpg ${num((x) => x.seasonMpg)}  last-season mpg ${num((x) => x.lastMpg)}  days since own last game ${num((x) => x.daysOut)}`);
  }
  // candidate rules and how they would have done on these players (miss vs real minutes), with point-in-time inputs
  const rules = {
    'season mpg (this season to date)': (x) => x.seasonMpg,
    'last-season mpg': (x) => (x.lastGp >= 5 ? x.lastMpg : null),
    'mean of his recent-window games (not sum/3)': (x) => x.wMean,
    'blend: window mean, else season mpg, else last-season mpg, else 12': (x) => (x.wMean != null ? x.wMean : x.seasonMpg != null ? x.seasonMpg : x.lastGp >= 5 ? x.lastMpg : 12),
    '0.75 x that blend + 5': (x) => 5 + 0.75 * (x.wMean != null ? x.wMean : x.seasonMpg != null ? x.seasonMpg : x.lastGp >= 5 ? x.lastMpg : 12),
    'flat 16': () => 16,
  };
  for (const [nm, f] of Object.entries(rules)) { const v = q.map((x) => [f(x), x.u.ac[0]]).filter(([p]) => p != null && isFinite(p)); console.log(`    rule "${nm}": covers ${v.length}/${q.length}, miss ${C.mean(v.map(([p, a]) => Math.abs(p - a))).toFixed(2)}, bias (real - rule) ${C.mean(v.map(([p, a]) => a - p)).toFixed(2)}`); }
  if (stage.startsWith('before')) out(q);
}
function out(q) {
  // examples
  const ex = q.filter((x) => x.c.startsWith('A')).slice(0, 5).concat(q.filter((x) => x.c.startsWith('D')).slice(0, 4), q.filter((x) => x.c.startsWith('C')).slice(0, 3), q.filter((x) => x.c.startsWith('B')).slice(0, 6), q.filter((x) => x.c.startsWith('F')).slice(0, 3));
  for (const x of ex) console.log(`      e.g. ${x.u.d} ${x.u.nm} ${x.u.tm}: real ${x.u.ac[0]} | window games ${x.w} mean ${x.wMean != null ? x.wMean.toFixed(1) : '-'} avg3 ${x.avg3.toFixed(1)} | season ${x.seasonN} g ${x.seasonMpg != null ? x.seasonMpg.toFixed(1) : '-'} | last season ${x.lastMpg != null ? x.lastMpg.toFixed(1) : '-'} | on list ${x.onList} starter ${x.starter} | ${x.c.slice(0, 1)}`);
}
