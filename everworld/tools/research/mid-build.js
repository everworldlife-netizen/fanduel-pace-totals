#!/usr/bin/env node
/* mid-build: one feature row per player per mid-game stage (s18, s24, s30; plus s12 and s36 kept light for cross-checks)
 * from the research dump + the derived game files. Everything is point-in-time:
 *   - tonight: stints and foul times are cut at the stage minute;
 *   - history: the player's own previous games of the SAME season before tonight's date (last 10 he played, 60 days back).
 * Usage: node tools/research/mid-build.js 2026   (writes data/research/mid-feat-2026.json.gz)
 */
'use strict';
const C = require('./mid-common');
const L = C.L, R = require('../replay');
const season = +process.argv[2] || 2026;
const STAGES = { s12: 12, s18: 18, s24: 24, s30: 30, s36: 36 };
const games = L.readJSON(`${L.ROOT}/data/derived/games-${season}.json.gz`).filter((it) => R.boxOk(it));
games.sort((a, b) => String(a.g.date).localeCompare(String(b.g.date)) || a.g.id - b.g.id);
const byId = new Map(games.map((it) => [it.g.id, it]));
// history per player: list of previous games in date order
const hist = new Map(); // pid -> [{d, tm, min, st, pfAt, margin}]
const teamHist = new Map(); // team -> [{d, id}]
for (const it of games) {
  const g = it.g, h = g.home_team.abbreviation, v = g.visitor_team.abbreviation;
  const fm = (g.home_team_score || 0) - (g.visitor_team_score || 0);
  for (const [pid, r] of Object.entries(it.log.rows)) {
    if (!(r.min > 0) || !Array.isArray(r.st) || !r.st.length) continue;
    let a = hist.get(+pid); if (!a) hist.set(+pid, (a = []));
    a.push({ d: g.date, id: g.id, tm: r.team, min: r.min, st: r.st, pfAt: r.pfAt || [], margin: r.team === h ? fm : -fm });
  }
  for (const t of [h, v]) { let a = teamHist.get(t); if (!a) teamHist.set(t, (a = [])); a.push({ d: g.date, id: g.id }); }
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const rows = L.readJSON(`${L.ROOT}/data/runs/research-${season}.rows.json.gz`);
const out = [];
let miss = 0;
for (const r of rows) {
  if (r.un || !(r.g in STAGES)) continue;
  const el = STAGES[r.g];
  const it = byId.get(r.id); if (!it) { miss++; continue; }
  const lr = it.log.rows[r.pid] || null;
  const stAll = lr && Array.isArray(lr.st) ? lr.st : [];
  // tonight, cut at el
  const st = []; for (const [a, b] of stAll) { if (a >= el) break; st.push([a, Math.min(b, el)]); }
  const pfAt = (lr && lr.pfAt ? lr.pfAt : []).filter((t) => t < el);
  const onNow = st.length ? st[st.length - 1][1] >= el - 0.011 && stAll.some(([a, b]) => a < el && b >= el - 0.011) : false;
  const last = st.length ? st[st.length - 1] : null;
  const sitFor = r.on ? 0 : last ? el - last[1] : el;
  const stintNow = r.on && last ? el - last[0] : 0;
  const o = {
    id: r.id, d: r.d, g: r.g, el, pid: r.pid, nm: r.nm, tm: r.tm, opp: r.opp, hm: r.hm, st: r.st, sT: r.sT, mpg: r.mpg, gms: r.gms, fr: r.fr, dp: r.dp,
    now0: r.now[0], pf: r.pf, on: r.on, dnp: r.dnp, mg: r.mg, pB: r.pB, mn0: r.mn[0], pr0: r.pr[0], mp: r.mp, ac0: r.ac ? r.ac[0] : null, x: r.x,
    // tonight
    nSt: st.length, sitFor: +sitFor.toFixed(2), stintNow: +stintNow.toFixed(2), lastLen: last ? +(last[1] - last[0]).toFixed(2) : 0,
    q1: +C.onBetween(st, 0, 12).toFixed(2), q2: +C.onBetween(st, 12, 24).toFixed(2), q3: +C.onBetween(st, 24, 36).toFixed(2),
    stG: st.length && st[0][0] < 0.02 ? 1 : 0, // started the game (from the plays)
    stH2: el > 24 ? (C.onAt(st, 24.005) ? 1 : 0) : null, // started the second half
    onE1: C.onAt(st, 11.99) ? 1 : 0, onE2: el >= 24 ? (C.onAt(st, 23.99) ? 1 : 0) : null, // on the floor when Q1 / Q2 ended
    pfAt: pfAt.map((t) => +t.toFixed(2)), onChk: onNow ? 1 : 0,
    fm: null,
  };
  // market
  const mk = it.market || {}; const g = it.g;
  o.fav = mk.spreadHome != null ? (r.tm === g.home_team.abbreviation ? -mk.spreadHome : mk.spreadHome) : null; // + = his team favoured by that many
  o.tot = mk.total != null ? mk.total : null;
  o.ot = it.log.len > 48.5 ? 1 : 0; // the game went to overtime (NOT a feature: outcome, for diagnostics only)
  // history (point in time): his previous games this season
  const H = (hist.get(+r.pid) || []).filter((x) => x.d < r.d && days(x.d, r.d) <= 60).slice(-10);
  o.hN = H.length;
  if (H.length) {
    o.hMin = +mean(H.map((x) => x.min)).toFixed(2);
    o.hSoFar = +mean(H.map((x) => C.onBetween(x.st, 0, el))).toFixed(2);
    o.hRem = +mean(H.map((x) => C.onBetween(x.st, el, 48))).toFixed(2);
    o.hH1 = +mean(H.map((x) => C.onBetween(x.st, 0, 24))).toFixed(2);
    o.hQ3 = +mean(H.map((x) => C.onBetween(x.st, 24, 36))).toFixed(2);
    o.hQ4 = +mean(H.map((x) => C.onBetween(x.st, 36, 48))).toFixed(2);
    o.hNext6 = +mean(H.map((x) => C.onBetween(x.st, el, el + 6))).toFixed(2);
    o.hOnAt = +mean(H.map((x) => (C.onAt(x.st, el + 0.005) ? 1 : 0))).toFixed(3); // share of games on the floor just after this minute
    o.hOnBefore = +mean(H.map((x) => (C.onAt(x.st, el - 0.01) ? 1 : 0))).toFixed(3); // share of games on the floor just before this minute
    o.hStG = +mean(H.map((x) => (x.st[0][0] < 0.02 ? 1 : 0))).toFixed(3);
    o.hStH2 = +mean(H.map((x) => (C.onAt(x.st, 24.005) ? 1 : 0))).toFixed(3);
    o.hMissed = r.on ? 0 : +mean(H.map((x) => C.onBetween(x.st, el - sitFor, el))).toFixed(2); // usual minutes in the stretch he has sat
    // rotation conditioned on the right state: games where he was / was not on just after this minute
    const mOn = H.filter((x) => C.onAt(x.st, el + 0.005)), mOff = H.filter((x) => !C.onAt(x.st, el + 0.005));
    o.hRemOn = mOn.length ? +mean(mOn.map((x) => C.onBetween(x.st, el, 48))).toFixed(2) : null; o.hNOn = mOn.length;
    o.hRemOff = mOff.length ? +mean(mOff.map((x) => C.onBetween(x.st, el, 48))).toFixed(2) : null;
    const cg = H.filter((x) => Math.abs(x.margin) < 15);
    o.hRemClose = cg.length ? +mean(cg.map((x) => C.onBetween(x.st, el, 48))).toFixed(2) : null;
  }
  out.push(o);
}
L.writeJSON(C.FEAT(season), out);
console.log(`season ${season}: ${out.length} rows written (${miss} rows without a game file), games ${games.length}`);
