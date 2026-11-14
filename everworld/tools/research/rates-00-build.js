#!/usr/bin/env node
/* rates-00-build: one feature row per projected player per stage, for the "rates inside special situations" study.
 * Everything attached to a row is point-in-time: the engine's own numbers at that stage (dump), and team / player
 * season-to-date aggregates from games on EARLIER dates only (games file). Hindsight is kept apart and only used to
 * (a) plug the real minutes in, (b) label overtime games.
 *   node tools/research/rates-00-build.js 2026      -> data/research/rates-feat-2026.json.gz
 */
'use strict';
const path = require('path');
const L = require('../lib');
const R = require('../replay');
const season = +process.argv[2] || 2026;
const E = R.loadEngine(path.join(L.DATA, 'engines', 'final', 'engine.js'));
const norm = E.norm;
const ruledOut = (x) => x.dnp && x.reason && !/COACH/i.test(x.reason);

const games = L.readJSON(path.join(L.DATA, 'derived', `games-${season}.json.gz`)).filter((it) => !it.g.postseason && R.boxOk(it));
games.sort((a, b) => (a.g.date < b.g.date ? -1 : a.g.date > b.g.date ? 1 : a.g.id - b.g.id));
const byId = new Map(games.map((it) => [it.g.id, it]));

// static position map (G/F/C) from every posted list of the season (a position is not an outcome)
const posOf = {};
for (const it of games) for (const [tm, a] of Object.entries(it.lists || {})) for (const x of a) if (x.pos) posOf[`${tm}:${norm(x.name)}`] = x.pos;

// ---- point-in-time aggregates, updated after each date
const T = {}; // team -> { g, pts, reb, ast, fga, fta, tov, pf, poss, oreb, fgm, aPts, aReb, aAst, aFta, aFga, aFgm, aOreb, hist: [ {date, players:Set(key)} ] }
const P = {}; // `${tm}:${normname}` -> { g, min, pts, reb, ast, fga, fta, tov, oreb, fg3a, pf, dates: [] }
const LG = { g: 0, pts: 0, reb: 0, ast: 0, fta: 0, pf: 0, poss: 0, fga: 0, fgm: 0, oreb: 0 };
const LG0 = { pts: 115, reb: 44, ast: 26.5, fta: 22.5, pf: 20, poss: 99.5, fga: 89, fgm: 42, oreb: 10.8 }; // prior (previous seasons' level), worth 30 team-games
const lgAvg = (k) => (LG[k] + 30 * LG0[k]) / (LG.g + 30);
const teamOf = (tm) => (T[tm] = T[tm] || { g: 0, pts: 0, reb: 0, ast: 0, fga: 0, fta: 0, tov: 0, pf: 0, poss: 0, oreb: 0, fgm: 0, aPts: 0, aReb: 0, aAst: 0, aFta: 0, aFga: 0, aFgm: 0, aOreb: 0, aPf: 0, hist: [] });

function teamTot(it, tm) {
  const t = { pts: 0, reb: 0, ast: 0, fga: 0, fta: 0, tov: 0, pf: 0, oreb: 0, fgm: 0, min: 0 };
  for (const r of Object.values(it.log.rows)) if (r.team === tm) { for (const k of Object.keys(t)) t[k] += r[k] || 0; }
  t.poss = (it.log.teams && it.log.teams[tm] && it.log.teams[tm].poss) || (t.fga + 0.44 * t.fta + t.tov - t.oreb);
  return t;
}
function absorb(it) {
  const v = it.g.visitor_team.abbreviation, h = it.g.home_team.abbreviation;
  const len = 48 + 5 * Math.max(0, (it.g.period || 4) - 4);
  const sc = 48 / len; // per 48 minutes
  const tv = teamTot(it, v), th = teamTot(it, h);
  for (const [tm, a, o] of [[v, tv, th], [h, th, tv]]) {
    const t = teamOf(tm);
    t.g++; for (const k of ['pts', 'reb', 'ast', 'fga', 'fta', 'tov', 'pf', 'poss', 'oreb', 'fgm']) t[k] += a[k] * sc;
    t.aPts += o.pts * sc; t.aReb += o.reb * sc; t.aAst += o.ast * sc; t.aFta += o.fta * sc; t.aFga += o.fga * sc; t.aFgm += o.fgm * sc; t.aOreb += o.oreb * sc; t.aPf += o.pf * sc;
    LG.g++; for (const k of ['pts', 'reb', 'ast', 'fta', 'pf', 'poss', 'fga', 'fgm', 'oreb']) LG[k] += a[k] * sc;
    const played = new Set();
    for (const r of Object.values(it.log.rows)) {
      if (r.team !== tm || !(r.min > 0)) continue;
      const k = `${tm}:${norm(r.name)}`; played.add(k);
      const p = (P[k] = P[k] || { g: 0, min: 0, pts: 0, reb: 0, ast: 0, fga: 0, fta: 0, tov: 0, oreb: 0, fg3a: 0, pf: 0, name: r.name });
      p.g++; for (const s of ['min', 'pts', 'reb', 'ast', 'fga', 'fta', 'tov', 'oreb', 'fg3a', 'pf']) p[s] += r[s] || 0;
    }
    t.hist.push(played);
  }
}

// ---- dump rows grouped by game
const dump = L.readJSON(path.join(L.DATA, 'runs', `research-${season}.rows.json.gz`));
const byGame = new Map();
for (const r of dump) { let a = byGame.get(r.id); if (!a) byGame.set(r.id, (a = [])); a.push(r); }

const out = [];
const r2 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(3));
let i = 0;
while (i < games.length) {
  let j = i; while (j < games.length && games[j].g.date === games[i].g.date) j++;
  for (let q = i; q < j; q++) {
    const it = games[q], g = it.g, rows = byGame.get(g.id);
    if (!rows) continue;
    const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
    // team context before tonight
    const ctx = {};
    for (const tm of [v, h]) {
      const t = teamOf(tm), n = t.g;
      const sh = (k, lg, K = 6) => (t[k] + K * lg) / (n + K); // shrunk per-game level
      const c = { n, reb: sh('reb', lgAvg('reb')), ast: sh('ast', lgAvg('ast')), pts: sh('pts', lgAvg('pts')), fta: sh('fta', lgAvg('fta')), pf: sh('pf', lgAvg('pf')), poss: sh('poss', lgAvg('poss')),
        aReb: sh('aReb', lgAvg('reb')), aAst: sh('aAst', lgAvg('ast')), aPts: sh('aPts', lgAvg('pts')), aFta: sh('aFta', lgAvg('fta')), aPf: sh('aPf', lgAvg('pf')),
        fgMiss: sh('fga', lgAvg('fga')) - sh('fgm', lgAvg('fgm')), aFgMiss: sh('aFga', lgAvg('fga')) - sh('aFgm', lgAvg('fgm')) };
      // who is missing from tonight's posted list among the recent rotation (last 10 team games)
      const last = t.hist.slice(-10), nl = last.length;
      const active = new Set(((it.lists && it.lists[tm]) || []).filter((x) => !ruledOut(x)).map((x) => `${tm}:${norm(x.name)}`));
      const rot = new Map();
      for (const s of last) for (const k of s) rot.set(k, (rot.get(k) || 0) + 1);
      const last3 = t.hist.slice(-3);
      let missReb = 0, missAst = 0, missPts = 0, missPlays = 0, missMin = 0, nAbs = 0, missRebBig = 0, missAstG = 0, retReb = 0, retAst = 0, retPts = 0, retMin = 0;
      let mainReb = null, mainAst = null, mainPts = null;
      const absent = [];
      for (const [k, cnt] of rot) {
        const p = P[k]; if (!p || p.g < 2) continue;
        const share = cnt / nl, pg = (s) => p[s] / p.g;
        const cand = p.g >= 3 && share >= 0.5 && pg('min') >= 15;
        if (cand && (!mainReb || pg('reb') > mainReb.v)) mainReb = { k, v: pg('reb') };
        if (cand && (!mainAst || pg('ast') > mainAst.v)) mainAst = { k, v: pg('ast') };
        if (cand && (!mainPts || pg('pts') > mainPts.v)) mainPts = { k, v: pg('pts') };
        const in3 = last3.some((s) => s.has(k));
        if (!active.has(k)) {
          if (!in3) continue; // gone for 3+ games: his absence is already in everybody's recent numbers
          nAbs++; missReb += pg('reb') * share; missAst += pg('ast') * share; missPts += pg('pts') * share; missMin += pg('min') * share;
          missPlays += (pg('fga') + 0.44 * pg('fta') + pg('tov')) * share;
          const pos = posOf[k] || '';
          if (/C/.test(pos)) missRebBig += pg('reb') * share;
          if (/G/.test(pos)) missAstG += pg('ast') * share;
          absent.push(k);
        } else if (share < 1 && nl >= 3 && p.g >= 3) {
          // on tonight's list but missed some of the last games: teammates' recent numbers were made partly without him
          const w = 1 - share; retReb += pg('reb') * w; retAst += pg('ast') * w; retPts += pg('pts') * w; retMin += pg('min') * w;
        }
      }
      const isOut = (m) => (m && !active.has(m.k) ? 1 : 0);
      Object.assign(c, { nl, nAbs, missReb, missAst, missPts, missPlays, missMin, missRebBig, missAstG, retReb, retAst, retPts, retMin,
        mainRebOut: nl >= 3 ? isOut(mainReb) : 0, mainAstOut: nl >= 3 ? isOut(mainAst) : 0, mainPtsOut: nl >= 3 ? isOut(mainPts) : 0,
        mainRebK: mainReb && mainReb.k, mainAstK: mainAst && mainAst.k, mainPtsK: mainPts && mainPts.k, mainRebV: mainReb ? mainReb.v : 0, mainAstV: mainAst ? mainAst.v : 0, mainPtsV: mainPts ? mainPts.v : 0, hasList: active.size >= 8 ? 1 : 0 });
      ctx[tm] = c;
    }
    const lg = { reb: lgAvg('reb'), ast: lgAvg('ast'), pts: lgAvg('pts'), fta: lgAvg('fta'), pf: lgAvg('pf'), poss: lgAvg('poss') };
    const nOT = Math.max(0, (g.period || 4) - 4);
    const fin = { [v]: g.visitor_team_score - g.home_team_score, [h]: g.home_team_score - g.visitor_team_score };
    const mkt = it.market && it.market.total ? it.market : null;
    // group by stage and team
    const grp = new Map();
    for (const r of rows) { if (r.un) continue; const k = `${r.g}|${r.tm}`; let a = grp.get(k); if (!a) grp.set(k, (a = [])); a.push(r); }
    const teamAgg = new Map();
    for (const [k, a] of grp) {
      const s = { remE: 0, usgW: 0, rebW: 0, astW: 0, ptsW: 0, rebRem: 0, astRem: 0, ptsRem: 0, nowReb: 0, nowAst: 0, nowPts: 0, nowMin: 0, pf: 0, nowXReb: 0, nowXAst: 0, nowXPts: 0, mnMin: 0, mnReb: 0, mnAst: 0, mnPts: 0, n: 0 };
      for (const r of a) {
        if (!r.mn) continue;
        const rem = Math.max(r.mn[0] - r.now[0], 0);
        s.n++; s.remE += rem; s.usgW += (r.usg || 0.2) * rem;
        if (r.rpm) { s.rebW += (r.rpm[1] || 0) * rem; s.astW += (r.rpm[2] || 0) * rem; s.ptsW += (r.rpm[0] || 0) * rem; s.nowXReb += (r.rpm[1] || 0) * r.now[0]; s.nowXAst += (r.rpm[2] || 0) * r.now[0]; s.nowXPts += (r.rpm[0] || 0) * r.now[0]; }
        s.rebRem += Math.max(r.mn[2] - r.now[2], 0); s.astRem += Math.max(r.mn[3] - r.now[3], 0); s.ptsRem += Math.max(r.mn[1] - r.now[1], 0);
        s.nowReb += r.now[2]; s.nowAst += r.now[3]; s.nowPts += r.now[1]; s.nowMin += r.now[0]; s.pf += r.pf || 0;
        s.mnMin += r.mn[0]; s.mnReb += r.mn[2]; s.mnAst += r.mn[3]; s.mnPts += r.mn[1];
      }
      teamAgg.set(k, s);
    }
    for (const r of rows) {
      if (r.un || !r.mn || !r.ac || !(r.ac[0] > 0)) continue;
      const tm = r.tm, opp = tm === v ? h : v;
      const A = teamAgg.get(`${r.g}|${tm}`), O = teamAgg.get(`${r.g}|${opp}`) || {};
      const c = ctx[tm], o = ctx[opp];
      const key = `${tm}:${norm(r.nm)}`, p = P[key];
      out.push({
        id: r.id, d: r.d, g: r.g, el: r.el, pid: r.pid, nm: r.nm, tm, opp, hm: r.hm, st: r.st, sT: r.sT, dp: r.dp, fr: r.fr, mpg: r.mpg, gms: r.gms, usg: r.usg, rpm: r.rpm, now: r.now, mn: r.mn, pr: r.pr, ac: r.ac,
        pf: r.pf, on: r.on, dnp: r.dnp, mg: r.mg, per: r.per, pB: r.pB, x: r.x,
        pos: posOf[key] || null,
        // own season-to-date line with this team (games before tonight)
        own: p ? [p.g, r2(p.min / p.g), r2(p.pts / p.g), r2(p.reb / p.g), r2(p.ast / p.g), r2(p.fga / p.g), r2(p.fta / p.g), r2(p.tov / p.g), r2(p.oreb / p.g), r2(p.fg3a / p.g), r2(p.pf / p.g)] : null,
        // team at this stage, from the engine's own numbers for everybody on the team
        tA: [r2(A.remE), r2(A.usgW), r2(A.rebW), r2(A.astW), r2(A.ptsW), r2(A.rebRem), r2(A.astRem), r2(A.ptsRem), r2(A.nowReb), r2(A.nowAst), r2(A.nowPts), A.pf, r2(A.nowXReb), r2(A.nowXAst), r2(A.nowXPts), r2(A.mnMin), r2(A.mnReb), r2(A.mnAst), r2(A.mnPts), A.n, r2(A.nowMin)],
        oA: O.n ? [r2(O.remE), r2(O.usgW), r2(O.rebW), r2(O.astW), r2(O.ptsW), r2(O.rebRem), r2(O.astRem), r2(O.ptsRem), r2(O.nowReb), r2(O.nowAst), r2(O.nowPts), O.pf, r2(O.nowXReb), r2(O.nowXAst), r2(O.nowXPts), r2(O.mnMin), r2(O.mnReb), r2(O.mnAst), r2(O.mnPts), O.n, r2(O.nowMin)] : null,
        // team and opponent season-to-date (per 48), shrunk toward the league with 6 games
        tc: [c.n, r2(c.reb), r2(c.ast), r2(c.pts), r2(c.fta), r2(c.pf), r2(c.poss), r2(c.aReb), r2(c.aAst), r2(c.aPts), r2(c.aFta), r2(c.aPf), r2(c.fgMiss), r2(c.aFgMiss)],
        oc: [o.n, r2(o.reb), r2(o.ast), r2(o.pts), r2(o.fta), r2(o.pf), r2(o.poss), r2(o.aReb), r2(o.aAst), r2(o.aPts), r2(o.aFta), r2(o.aPf), r2(o.fgMiss), r2(o.aFgMiss)],
        lg: [r2(lg.reb), r2(lg.ast), r2(lg.pts), r2(lg.fta), r2(lg.pf), r2(lg.poss)],
        // tonight's absences (posted list vs the last 10 games' rotation), own team then opponent
        ab: [c.nAbs, r2(c.missReb), r2(c.missAst), r2(c.missPts), r2(c.missPlays), r2(c.missMin), r2(c.missRebBig), r2(c.missAstG), r2(c.retReb), r2(c.retAst), r2(c.retPts), r2(c.retMin), c.mainRebOut, c.mainAstOut, c.mainPtsOut, c.nl, c.hasList, r2(c.mainRebV), r2(c.mainAstV), r2(c.mainPtsV)],
        oab: [o.nAbs, r2(o.missReb), r2(o.missAst), r2(o.missPts), r2(o.missPlays), r2(o.missMin), r2(o.missRebBig), r2(o.missAstG), r2(o.retReb), r2(o.retAst), r2(o.retPts), r2(o.retMin), o.mainRebOut, o.mainAstOut, o.mainPtsOut, o.nl, o.hasList],
        isMain: [c.mainRebK === key ? 1 : 0, c.mainAstK === key ? 1 : 0, c.mainPtsK === key ? 1 : 0],
        mk: mkt ? [mkt.total, tm === h ? -mkt.spreadHome : mkt.spreadHome] : null, // [total, team expected margin (+ = favourite)]
        // hindsight labels (never used as a signal)
        hs: [nOT, fin[tm]],
      });
    }
  }
  for (let q = i; q < j; q++) absorb(games[q]);
  i = j;
}
const file = path.join(L.DATA, 'research', `rates-feat-${season}.json.gz`);
L.writeJSON(file, out);
console.log(`${season}: ${games.length} complete games, ${out.length} rows -> ${file}`);
