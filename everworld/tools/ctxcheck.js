#!/usr/bin/env node
/* Is there context the engine is still missing? Takes a per-player dump from `bt2 --dump` (tip-off stage, unseen
 * games) and asks, for a list of schedule and travel situations, whether players in that situation finished above or
 * below our number more than luck allows. A situation only earns a place as a learned input if it shows up here.
 *
 *   node tools/bt2.js --engine <engine> --seasons 2026 --no-playoffs --stages 0 --lessons <unseen lessons> --dump data/runs/ctx.rows.json.gz --out data/runs/ctx.json
 *   node tools/ctxcheck.js --dump data/runs/ctx.rows.json.gz --seasons 2026
 *
 * Unit of evidence: one team in one game (players of a team share their night, so they are not counted as
 * separate proof). z beyond about ±3 is worth building (many situations are tried at once, so ±2 is not enough).
 */
'use strict';
const path = require('path');
const L = require('./lib');
const R = require('./replay');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const dumpFile = path.resolve(L.ROOT, arg('--dump', 'data/runs/ctx.rows.json.gz'));
const seasons = String(arg('--seasons', '2026')).split(',').map(Number);

const TZ = {}; // hours behind Eastern
for (const t of 'ATL BOS BKN CHA CLE DET IND MIA NYK ORL PHI TOR WAS'.split(' ')) TZ[t] = 0;
for (const t of 'CHI DAL HOU MEM MIL MIN NOP OKC SAS'.split(' ')) TZ[t] = 1;
for (const t of 'DEN UTA PHX'.split(' ')) TZ[t] = 2;
for (const t of 'GSW LAC LAL POR SAC'.split(' ')) TZ[t] = 3;
const HIGH = new Set(['DEN', 'UTA']);

// every team's schedule, in order
const S = R.loadSeasons(seasons);
const sched = {}; // team → [{ id, date, home, opp, city }]
for (const it of S.games) {
  const g = it.g, h = g.home_team.abbreviation, v = g.visitor_team.abbreviation;
  (sched[`${it.season}:${h}`] = sched[`${it.season}:${h}`] || []).push({ id: g.id, date: g.date, home: 1, opp: v, city: h, dt: g.datetime, market: it.market });
  (sched[`${it.season}:${v}`] = sched[`${it.season}:${v}`] || []).push({ id: g.id, date: g.date, home: 0, opp: h, city: h, dt: g.datetime, market: it.market });
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const ctxOf = {}; // `${id}:${team}` → situation flags
for (const [key, list] of Object.entries(sched)) {
  const tm = key.split(':')[1];
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  list.forEach((x, i) => {
    const prev = list[i - 1], gap = prev ? days(prev.date, x.date) : 9;
    const in4 = list.filter((y, j) => j <= i && days(y.date, x.date) <= 3).length; // games in the last 4 nights incl. tonight
    const in6 = list.filter((y, j) => j <= i && days(y.date, x.date) <= 5).length;
    const in7 = list.filter((y, j) => j <= i && days(y.date, x.date) <= 6).length;
    let trip = 0; for (let j = i; j >= 0 && !list[j].home; j--) trip++; // which game of a road trip
    let stand = 0; for (let j = i; j >= 0 && list[j].home; j--) stand++;
    const tzMove = prev ? Math.abs((TZ[x.city] || 0) - (TZ[prev.city] || 0)) : 0;
    const hourET = x.dt ? (new Date(x.dt).getUTCHours() + 24 - 5) % 24 : null; // tip time, Eastern (winter offset is close enough)
    const bodyHour = hourET != null ? hourET - (TZ[tm] || 0) : null; // what time it feels like for a team living in its home zone
    ctxOf[`${x.id}:${tm}`] = {
      b2b: gap === 1 ? 1 : 0, b2bRoad: gap === 1 && !x.home ? 1 : 0, b2bHome: gap === 1 && x.home ? 1 : 0,
      b2bTravel: gap === 1 && prev && prev.city !== x.city ? 1 : 0,
      threeIn4: in4 >= 3 ? 1 : 0, fourIn6: in6 >= 4 ? 1 : 0, fiveIn7: in7 >= 5 ? 1 : 0,
      rest2plus: gap >= 3 ? 1 : 0, rest4plus: gap >= 5 ? 1 : 0,
      altitudeRoad: !x.home && HIGH.has(x.city) ? 1 : 0, altitudeHome: x.home && HIGH.has(x.city) ? 1 : 0,
      tz2: tzMove >= 2 && gap <= 2 ? 1 : 0, eastToWestBody: !x.home && bodyHour != null && bodyHour >= 22 ? 1 : 0, westEarly: !x.home && bodyHour != null && bodyHour <= 16 ? 1 : 0,
      earlyTip: hourET != null && hourET <= 17 ? 1 : 0,
      roadTrip3: trip >= 3 ? 1 : 0, roadTrip5: trip >= 5 ? 1 : 0, homeStand4: stand >= 4 ? 1 : 0, firstHomeAfterTrip: x.home && stand === 1 && prev && !prev.home && (() => { let t = 0; for (let j = i - 1; j >= 0 && !list[j].home; j--) t++; return t >= 3; })() ? 1 : 0,
      first10: i < 10 ? 1 : 0, last10: i >= list.length - 10 && list.length >= 70 ? 1 : 0,
      bigFav: x.market && x.market.spreadHome != null && (x.home ? -x.market.spreadHome : x.market.spreadHome) >= 10 ? 1 : 0,
      bigDog: x.market && x.market.spreadHome != null && (x.home ? -x.market.spreadHome : x.market.spreadHome) <= -10 ? 1 : 0,
      highTotal: x.market && x.market.total >= 238 ? 1 : 0, lowTotal: x.market && x.market.total && x.market.total <= 222 ? 1 : 0,
      _opp: x.opp, _id: x.id,
    };
  });
}
// the other team's night matters too
for (const [k, c] of Object.entries(ctxOf)) {
  const o = ctxOf[`${c._id}:${c._opp}`];
  c.oppB2b = o && o.b2b ? 1 : 0;
  c.restEdge = o && !c.b2b && o.b2b ? 1 : 0;
  c.restDown = o && c.b2b && !o.b2b ? 1 : 0;
  c.opp3in4 = o && o.threeIn4 ? 1 : 0;
}

const rows = L.readJSON(dumpFile).filter((r) => !r.un && r.ac && r.ac[0] > 0 && r.mn);
// per team-game sums of (actual − our plain average), for a few groups of players
const GROUPS = { all: (r) => r.mpg >= 10, starters: (r) => r.st === 1, bench: (r) => r.st !== 1 && r.mpg >= 10, stars: (r) => r.mpg >= 30 };
const tg = {}; // `${id}:${tm}` → { grp: [n, dMin, dPts, dReb, dAst] }
for (const r of rows) {
  const k = `${r.id}:${r.tm}`;
  const t = tg[k] = tg[k] || {};
  for (const [gn, f] of Object.entries(GROUPS)) {
    if (!f(r)) continue;
    const a = t[gn] = t[gn] || [0, 0, 0, 0, 0];
    a[0]++; a[1] += r.ac[0] - r.mn[0]; a[2] += r.ac[1] - r.mn[1]; a[3] += r.ac[2] - r.mn[2]; a[4] += r.ac[3] - r.mn[3];
  }
}
const keys = Object.keys(tg).filter((k) => ctxOf[k]);
console.log(`${rows.length} player rows, ${keys.length} team-games, seasons ${seasons.join(',')}`);
const stat = (list) => { const n = list.length; if (!n) return { n: 0, m: 0, se: 0 }; const m = list.reduce((a, b) => a + b, 0) / n; const v = list.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, n - 1); return { n, m, se: Math.sqrt(v / n) }; };
const FLAGS = Object.keys(ctxOf[keys[0]]).filter((f) => f[0] !== '_');
const out = [];
for (const f of FLAGS) for (const gn of Object.keys(GROUPS)) for (const [ti, tn] of [[1, 'MIN'], [2, 'PTS']]) {
  // per-player average gap for each team-game, then compare the situation with every other night
  const on = [], off = [];
  for (const k of keys) { const a = tg[k][gn]; if (!a || !a[0]) continue; (ctxOf[k][f] ? on : off).push(a[ti] / a[0]); }
  const A = stat(on), B = stat(off);
  if (A.n < 40) continue;
  const z = (A.m - B.m) / Math.sqrt(A.se * A.se + B.se * B.se);
  out.push({ f, gn, tn, n: A.n, on: A.m, off: B.m, diff: A.m - B.m, z });
}
out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
const show = arg('--all') !== undefined || process.argv.includes('--all') ? out : out.slice(0, 30);
console.log('situation            players   stat  team-games   gap in it   gap otherwise   difference      z');
for (const o of show) console.log(`${o.f.padEnd(20)} ${o.gn.padEnd(9)} ${o.tn}  ${String(o.n).padStart(9)}   ${o.on.toFixed(3).padStart(8)}   ${o.off.toFixed(3).padStart(12)}   ${o.diff.toFixed(3).padStart(9)}   ${o.z.toFixed(1).padStart(5)}`);
console.log(`\n${out.length} checks in all; with that many, expect about ${Math.round(out.length * 0.0027)} beyond ±3 and ${Math.round(out.length * 0.0455)} beyond ±2 from luck alone.`);
