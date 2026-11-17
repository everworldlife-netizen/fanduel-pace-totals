#!/usr/bin/env node
/* late-01-build: one feature row per player per late stage (s30 light, s36, s42) from the slim dump + derived game files.
 * Point-in-time everywhere:
 *   - tonight: stints, foul times and the score are cut at the stage minute;
 *   - history: the team's previous games of the SAME season before tonight's date. Two windows:
 *       A (what the phone has today): the team's last 8 games inside 21 days;
 *       X (if the phone kept more): the team's last 25 games inside 75 days.
 * Usage: node tools/research/late-01-build.js 2026   (writes data/research/late-feat-2026.json.gz)
 */
'use strict';
const C = require('./late-common');
const L = C.L, R = require('../replay');
const season = +process.argv[2] || 2026;
const games = L.readJSON(`${L.ROOT}/data/derived/games-${season}.json.gz`).filter((it) => R.boxOk(it));
games.sort((a, b) => String(a.g.date).localeCompare(String(b.g.date)) || a.g.id - b.g.id);
const byId = new Map(games.map((it) => [it.g.id, it]));
/** home margin at game minute t (scores at or before t) */
function marginFn(it) {
  const sc = it.log.sc || [];
  const ts = sc.map((e) => e[0]), cum = []; let m = 0;
  for (const e of sc) { m += e[1] === 1 ? e[2] : -e[2]; cum.push(m); }
  return (t) => { let lo = 0, hi = ts.length; while (lo < hi) { const md = (lo + hi) >> 1; if (ts[md] <= t + 1e-9) lo = md + 1; else hi = md; } return lo ? cum[lo - 1] : 0; };
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
// per game: margins at fixed minutes (home view), per team list of games
const GM = new Map(); // id -> { mAt: {t: homeMargin}, fm, len, h, v }
const teamHist = new Map(); // team -> [{d, id}]
const TS = [24, 30, 33, 36, 39, 42, 45];
for (const it of games) {
  const g = it.g, h = g.home_team.abbreviation, v = g.visitor_team.abbreviation, mf = marginFn(it);
  const mAt = {}; for (const t of TS) mAt[t] = mf(t);
  GM.set(g.id, { mAt, mf, fm: (g.home_team_score || 0) - (g.visitor_team_score || 0), m48: mf(48), len: it.log.len, h, v, d: g.date });
  for (const t of [h, v]) { let a = teamHist.get(t); if (!a) teamHist.set(t, (a = [])); a.push({ d: g.date, id: g.id }); }
}
const band = (m) => { const a = Math.abs(m); return a <= 8 ? 0 : a <= 15 ? (m > 0 ? 1 : -1) : m > 0 ? 2 : -2; };
const rowsIn = L.readJSON(`${L.ROOT}/data/research/late-rows-${season}.json.gz`).filter((r) => !r.un);
// team-level floor picture from the dump rows themselves (what the engine saw)
const TG = new Map(); // id:tm:g -> rows
for (const r of rowsIn) { const k = `${r.id}:${r.tm}:${r.g}`; let a = TG.get(k); if (!a) TG.set(k, (a = [])); a.push(r); }
const floorOf = (k) => {
  const a = TG.get(k) || [];
  const on = a.filter((x) => x.on);
  const top = a.slice().sort((x, y) => y.mpg - x.mpg);
  const top5 = new Set(top.slice(0, 5).map((x) => x.pid));
  return {
    nOn: on.length, stOn: on.filter((x) => x.st === 1).length, sTOn: on.filter((x) => x.sT === 1).length, top5On: on.filter((x) => top5.has(x.pid)).length,
    mpgOn: +(on.reduce((s, x) => s + x.mpg, 0) / 5).toFixed(2), nSt: a.filter((x) => x.st === 1).length,
    top5, stAvail: a.filter((x) => x.st === 1 && x.pf < 6).length,
  };
};
const out = []; let miss = 0;
for (const r of rowsIn) {
  const el = r.el;
  const it = byId.get(r.id); if (!it) { miss++; continue; }
  const G = GM.get(r.id), isHome = r.tm === G.h, sgn = isHome ? 1 : -1;
  const lr = it.log.rows[r.pid] || null;
  const stAll = lr && Array.isArray(lr.st) ? lr.st : [];
  const st = []; for (const [a, b] of stAll) { if (a >= el) break; st.push([a, Math.min(b, el)]); }
  const pfAt = (lr && lr.pfAt ? lr.pfAt : []).filter((t) => t <= el + 1e-9);
  const last = st.length ? st[st.length - 1] : null;
  const sitFor = r.on ? 0 : last ? el - last[1] : el;
  const stintNow = r.on && last ? el - last[0] : 0;
  const me = floorOf(`${r.id}:${r.tm}:${r.g}`), op = floorOf(`${r.id}:${r.opp}:${r.g}`);
  const o = {
    id: r.id, d: r.d, g: r.g, el, pid: r.pid, nm: r.nm, tm: r.tm, opp: r.opp, hm: r.hm, st: r.st, sT: r.sT, mpg: r.mpg, gms: r.gms, usg: r.usg, fr: r.fr, dp: r.dp,
    now0: r.now[0], pf: r.pf, on: r.on, dnp: r.dnp, mg: r.mg, pB: r.pB, mn0: r.mn[0], pr0: r.pr[0], mp: r.mp, ac0: r.ac ? r.ac[0] : null, x: r.x,
    now: r.now, mn: r.mn, pr: r.pr, ac: r.ac, rpm: r.rpm,
    // tonight
    nSt: st.length, sitFor: +sitFor.toFixed(2), stintNow: +stintNow.toFixed(2),
    q3: +C.onBetween(st, 24, 36).toFixed(2), q4sf: +C.onBetween(st, 36, 48).toFixed(2), h1: +C.onBetween(st, 0, 24).toFixed(2),
    stG: st.length && st[0][0] < 0.02 ? 1 : 0, stH2: C.onAt(st, 24.005) ? 1 : 0, stQ4: el > 36 ? (C.onAt(st, 36.005) ? 1 : 0) : null,
    pfAt: pfAt.map((t) => +t.toFixed(2)),
    top5: me.top5.has(r.pid) ? 1 : 0,
    // margins tonight (his team's view), all at or before el
    m24: sgn * G.mAt[24], m30: sgn * G.mAt[30], m33: sgn * G.mAt[33], m36: el >= 36 ? sgn * G.mAt[36] : null, m39: el >= 42 ? sgn * G.mAt[39] : null, mEl: sgn * G.mAt[el],
    // floor picture: his team and the other team
    stOn: me.stOn, sTOn: me.sTOn, top5On: me.top5On, mpgOn: me.mpgOn, nOnT: me.nOn, oStOn: op.stOn, oSTOn: op.sTOn, oTop5On: op.top5On, oMpgOn: op.mpgOn,
    // outcomes (NOT features; for targets and diagnostics)
    ot: G.len > 48.5 ? 1 : 0, len: G.len, fm: sgn * G.fm, m48: sgn * G.m48,
    remReg: lr ? +C.onBetween(stAll, el, 48).toFixed(2) : 0, remOT: lr ? +C.onBetween(stAll, 48, 99).toFixed(2) : 0,
    next3: lr ? +C.onBetween(stAll, el, el + 3).toFixed(2) : 0, last3: lr ? +C.onBetween(stAll, 45, 48).toFixed(2) : 0, last6: lr ? +C.onBetween(stAll, 42, 48).toFixed(2) : 0,
  };
  const mk = it.market || {};
  o.fav = mk.spreadHome != null ? (isHome ? -mk.spreadHome : mk.spreadHome) : null; // + = his team favoured by that many
  o.tot = mk.total != null ? mk.total : null;
  // max lead / deficit so far tonight and the swing over the last 3 / 6 minutes
  { let mx = -99, mnn = 99; for (let t = 0; t <= el + 1e-9; t += 0.5) { const m = sgn * G.mf(t); if (m > mx) mx = m; if (m < mnn) mnn = m; } o.mMax = mx; o.mMin = mnn; o.d3 = o.mEl - sgn * G.mf(el - 3); o.d6 = o.mEl - sgn * G.mf(el - 6); }
  // ---- history, point in time: the TEAM's earlier games this season
  const th = (teamHist.get(r.tm) || []).filter((x) => x.d < r.d);
  const winA = th.filter((x) => days(x.d, r.d) <= 21).slice(-8), winX = th.filter((x) => days(x.d, r.d) <= 75).slice(-25);
  const bT = band(r.mg);
  for (const [tag, win] of [['A', winA], ['X', winX]]) {
    const H = [];
    for (const x of win) {
      const it2 = byId.get(x.id), G2 = GM.get(x.id), lr2 = it2.log.rows[r.pid];
      if (!lr2 || lr2.team !== r.tm || !(lr2.min > 0) || !Array.isArray(lr2.st)) continue;
      const s2 = G2.h === r.tm ? 1 : -1;
      H.push({ st: lr2.st, mEl: s2 * G2.mAt[el], m42: s2 * G2.mAt[42], m45: s2 * G2.mAt[45], m36: s2 * G2.mAt[36], fm: s2 * G2.fm, onEl: C.onAt(lr2.st, el - 0.011) ? 1 : 0, rem: C.onBetween(lr2.st, el, 48), min: lr2.min });
    }
    o['n' + tag] = H.length; o['tn' + tag] = win.length;
    if (!H.length) continue;
    const same = H.filter((x) => x.onEl === (r.on ? 1 : 0));
    const inBand = H.filter((x) => band(x.mEl) === bT), inBandS = inBand.filter((x) => x.onEl === (r.on ? 1 : 0));
    const closeEl = H.filter((x) => Math.abs(x.mEl) <= 8), close42 = H.filter((x) => Math.abs(x.m42) <= 8), crunch = H.filter((x) => Math.abs(x.m45) <= 6);
    const lop = H.filter((x) => Math.abs(x.mEl) >= 16), lopLead = H.filter((x) => x.mEl >= 16), lopTrail = H.filter((x) => x.mEl <= -16);
    const f2 = (v) => +v.toFixed(2);
    o['rem' + tag] = f2(mean(H.map((x) => x.rem)));
    o['nS' + tag] = same.length; if (same.length) o['remS' + tag] = f2(mean(same.map((x) => x.rem)));
    o['nB' + tag] = inBand.length; if (inBand.length) o['remB' + tag] = f2(mean(inBand.map((x) => x.rem)));
    o['nBS' + tag] = inBandS.length; if (inBandS.length) o['remBS' + tag] = f2(mean(inBandS.map((x) => x.rem)));
    o['nC' + tag] = closeEl.length; if (closeEl.length) { o['remC' + tag] = f2(mean(closeEl.map((x) => x.rem))); const cs = closeEl.filter((x) => x.onEl === (r.on ? 1 : 0)); o['nCS' + tag] = cs.length; if (cs.length) o['remCS' + tag] = f2(mean(cs.map((x) => x.rem))); }
    o['nC42' + tag] = close42.length; if (close42.length) o['l6C' + tag] = f2(mean(close42.map((x) => C.onBetween(x.st, 42, 48))));
    o['nCr' + tag] = crunch.length; if (crunch.length) o['l3Cr' + tag] = f2(mean(crunch.map((x) => C.onBetween(x.st, 45, 48))));
    o['nL' + tag] = lop.length; if (lop.length) o['remL' + tag] = f2(mean(lop.map((x) => x.rem)));
    o['nLL' + tag] = lopLead.length; if (lopLead.length) o['remLL' + tag] = f2(mean(lopLead.map((x) => x.rem)));
    o['nLT' + tag] = lopTrail.length; if (lopTrail.length) o['remLT' + tag] = f2(mean(lopTrail.map((x) => x.rem)));
    o['mpgH' + tag] = f2(mean(H.map((x) => x.min)));
    // team closing group: total minutes in the last 6 of the team's close-at-42 games in the window (all players of the team), then his rank
  }
  out.push(o);
}
// team closing group (window A and X): rank of each player by minutes in the last 6 of his team's games that were within 8 at 42:00
{
  const cache = new Map();
  const closers = (tm, d, tag) => {
    const k = `${tm}:${d}:${tag}`; if (cache.has(k)) return cache.get(k);
    const th = (teamHist.get(tm) || []).filter((x) => x.d < d);
    const win = tag === 'A' ? th.filter((x) => days(x.d, d) <= 21).slice(-8) : th.filter((x) => days(x.d, d) <= 75).slice(-25);
    const tot = new Map(); let n = 0;
    for (const x of win) {
      const it2 = byId.get(x.id), G2 = GM.get(x.id); const s2 = G2.h === tm ? 1 : -1;
      if (Math.abs(G2.mAt[42]) > 8) continue; n++;
      for (const [pid, lr2] of Object.entries(it2.log.rows)) { if (lr2.team !== tm || !Array.isArray(lr2.st)) continue; tot.set(+pid, (tot.get(+pid) || 0) + C.onBetween(lr2.st, 42, 48)); }
    }
    const res = { n, tot }; cache.set(k, res); return res;
  };
  for (const o of out) for (const tag of ['A', 'X']) {
    const c = closers(o.tm, o.d, tag);
    o['cgN' + tag] = c.n;
    if (c.n) {
      const mine = c.tot.get(o.pid) || 0;
      // rank among tonight's projected teammates only (those who are available tonight)
      const mates = (TG.get(`${o.id}:${o.tm}:${o.g}`) || []).filter((x) => x.pf < 6);
      let rk = 1; for (const x of mates) if ((c.tot.get(x.pid) || 0) > mine + 1e-9) rk++;
      o['cgSh' + tag] = +(mine / (6 * c.n)).toFixed(3); o['cgRk' + tag] = rk;
    }
  }
}
L.writeJSON(C.FEAT(season), out);
console.log(`season ${season}: ${out.length} rows written (${miss} rows without a game file), games ${games.length}`);
// sanity: margin from the scoring list vs the dump's mg
let bad = 0; for (const o of out) if (o.mEl !== o.mg) bad++;
console.log(`margin check: ${bad} rows where the scoring-list margin differs from the dump's mg`);
