/* Replay core: rebuild what the live app knew at a moment of a finished game, run an engine on it, grade it.
 *
 * A moment is "elapsed game minutes": 0 = tip-off (pregame phase with confirmed lineups), 12 = end of Q1,
 * 24 = halftime, 36 = end of Q3, 42 = 6:00 left in Q4, and any other minute in between.
 * Inputs mirror cs/build/app.js projectGame(): recent team logs (8 per team inside 21 days), last season's and
 * this season's-to-date stat lines, season-to-date team stats, the closing game line, ESPN's active lists,
 * tracking game logs, learned lessons and the situational prior. Nothing from the game itself or later leaks in.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const P = require('./pit');

const STATS = ['pts', 'reb', 'ast', 'fg3m'];

function loadEngine(enginePath) {
  const p = path.resolve(L.ROOT, enginePath);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** All prepared games of the given seasons, with lookups by date. */
function loadSeasons(seasons) {
  const games = [];
  for (const s of seasons) {
    const f = path.join(L.DATA, 'derived', `games-${s}.json.gz`);
    if (!L.exists(f)) throw new Error(`missing ${f}: run tools/prep.js`);
    for (const it of L.readJSON(f)) { it.season = +s; games.push(it); }
  }
  games.sort((a, b) => String(a.g.date).localeCompare(String(b.g.date)) || a.g.id - b.g.id);
  const byDate = new Map();
  for (const it of games) { const d = it.g.date; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(it); }
  return { games, byDate, logsCache: new Map() };
}

/** The same recent-game selection as DB.teamLogs in the app: walk back day by day until each team on tonight's slate has 8 games (21 days at most). */
function recentLogs(S, date, { perTeam = 8, lookback = 21 } = {}) {
  if (S.logsCache.has(date)) return S.logsCache.get(date);
  const today = S.byDate.get(date) || [];
  const teams = [...new Set(today.flatMap((it) => [it.g.visitor_team.abbreviation, it.g.home_team.abbreviation]))];
  const want = new Set(teams), count = Object.fromEntries(teams.map((t) => [t, 0]));
  const out = [];
  for (let i = 1; i <= lookback; i++) {
    const day = L.addDays(date, -i);
    for (const it of S.byDate.get(day) || []) {
      const ab = [it.g.visitor_team.abbreviation, it.g.home_team.abbreviation];
      if (!ab.some((t) => want.has(t) && count[t] < perTeam)) continue;
      out.push(it.log);
      ab.forEach((t) => { if (t in count) count[t]++; });
    }
    if (teams.every((t) => count[t] >= perTeam)) break;
  }
  S.logsCache.set(date, out);
  return out;
}

const ord = (k) => (k === 1 ? '1st' : k === 2 ? '2nd' : k === 3 ? '3rd' : `${k}th`);
/** The slate row and the plays as they stood `el` game minutes in (same construction as gameAt() in the app's nightly learning). */
function momentAt(E, g, plays, el) {
  const blank = { home_q1: null, home_q2: null, home_q3: null, home_q4: null, visitor_q1: null, visitor_q2: null, visitor_q3: null, visitor_q4: null, status: '', display_status: '' };
  if (!el) return { game: { ...g, ...blank, status_state: 'scheduled', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 }, plays: [] };
  const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
  let per, clock, time, ps;
  if (el % 12 === 0) {
    per = el / 12; clock = '0:00';
    time = per === 2 ? 'Half' : `End of ${ord(per)}`;
    ps = plays.filter((p) => p.period <= per);
  } else {
    per = Math.floor(el / 12) + 1;
    const left = (per * 12 - el) * 60;
    clock = `${Math.floor(left / 60)}:${String(Math.round(left % 60)).padStart(2, '0')}`;
    time = `Q${per} ${clock}`;
    ps = plays.filter((p) => p.period < per || (p.period === per && E.clockSec(p.clock) >= left));
  }
  const bx = E.boxFromPlays(ps, per, clock);
  return { game: { ...g, ...blank, status_state: 'in', period: per, time, visitor_team_score: (bx.teams[v] || {}).pts || 0, home_team_score: (bx.teams[h] || {}).pts || 0 }, plays: ps };
}

/** ESPN's game box lists in the shape DB.availability() hands the engine once lineups are posted (tip-off). */
function availOf(it, mode = 'tip', hist = null) {
  const v = it.g.visitor_team.abbreviation, h = it.g.home_team.abbreviation, lists = it.lists;
  if (!lists || ![v, h].every((tm) => lists[tm] && lists[tm].filter((x) => x.starter).length >= 5)) return null;
  if (mode === 'none') return null;
  if (mode === 'report') {
    // before lineups post: a perfect injury report (every recent-rotation player who is inactive tonight is listed out), no starters
    const res = { confirmed: false, complete: false, report: true, source: 'injury report', in: [], out: [], doubt: [], starters: {} };
    const norm = hist.norm;
    for (const tm of [v, h]) {
      const active = new Set(lists[tm].map((x) => norm(x.name)));
      for (const nm of hist.names[tm] || []) if (!active.has(norm(nm))) res.out.push({ name: nm, why: 'out', team: tm });
    }
    return res;
  }
  const res = { confirmed: true, complete: true, report: true, source: 'confirmed lineups', in: [], out: [], doubt: [], starters: {} };
  for (const tm of [v, h]) {
    res.starters[tm] = lists[tm].filter((x) => x.starter).map((x) => x.name);
    for (const x of lists[tm]) res.in.push({ name: x.name, starter: x.starter, team: tm });
  }
  return res;
}

/** Everything projectGame needs for one game, apart from the moment itself. */
function contextFor(E, S, it, opts = {}) {
  const g = it.g, date = g.date, season = it.season;
  const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
  const logs = recentLogs(S, date).filter((l) => l.v === v || l.h === v || l.v === h || l.h === h);
  const nV = logs.filter((l) => l.v === v || l.h === v).length, nH = logs.filter((l) => l.v === h || l.h === h).length;
  const last = P.lastPriors(E, season), cur = P.curPriors(E, season, date);
  const teams = P.teamsAt(season, date);
  const gameLogs = {}, names = { [v]: new Set(), [h]: new Set() };
  for (const l of logs) for (const r of Object.values(l.rows)) {
    if (r.team !== v && r.team !== h) continue;
    names[r.team].add(r.name);
    const k = E.norm(r.name);
    if (k in gameLogs || opts.noGameLogs) continue;
    const lp = last[k] || cur[k];
    const x = lp && lp.nba_id ? P.gameLogsAt(E, season, date, lp.nba_id) : null;
    gameLogs[k] = x && x.games && x.games[0] && (x.games[0].team === v || x.games[0].team === h) ? x : null;
  }
  for (const k of Object.keys(gameLogs)) if (!gameLogs[k]) delete gameLogs[k];
  const hist = { norm: E.norm, names: { [v]: [...names[v]], [h]: [...names[h]] } };
  const avail = availOf(it, opts.avail || 'tip', hist);
  // the same game as the app saw it before lineups were posted (injury report only)
  const availReport = availOf(it, 'report', hist);
  return { ok: nV >= 2 && nH >= 2 && !!it.lists, nV, nH, availReport, base: { logs, priors: { last, cur }, injuries: [], overrides: { in: [], out: [] }, market: it.market && it.market.total ? it.market : null, teams, gameLogs, avail } };
}

/** Last season's situational prior for a season's games, built from the previous season's logs with the engine's own builder (cached on disk). */
function sitPriorFor(E, season) {
  // (the builder changes with the engine's sitPre switch, so each variant keeps its own cached file)
  const f = path.join(L.DATA, 'derived', `sitprior-${season}${E.TUNE.sitPre > 0 ? '-pre' : ''}.json.gz`);
  if (L.exists(f)) return L.readJSON(f);
  const src = path.join(L.DATA, 'derived', `games-${season - 1}.json.gz`);
  if (!L.exists(src)) return {};
  const logs = L.readJSON(src).filter((it) => !it.g.postseason).map((it) => it.log);
  const stars = {};
  const starOf = (tm) => { if (!(tm in stars)) { const s = E.teamStar(logs, tm); stars[tm] = s ? s.pid : null; } return stars[tm]; };
  const pids = new Set();
  for (const lg of logs) for (const pid of Object.keys(lg.rows)) pids.add(pid);
  const out = {};
  for (const pid of pids) {
    const r = E.sitPriorOf(logs, +pid, starOf);
    // same content as the shipped text: the first ten situations and the streak sums
    if (r) out[pid] = { s: r.s, P: r.P, M: r.M, c: r.c.map((x, i) => (i < 10 ? x : [0, 0])), cv: [0, 0, r.cv[2], r.cv[3]] };
  }
  L.writeJSON(f, out);
  return out;
}
/** The situational prior shipped with an app build (sitprior.js next to the engine). */
function sitPriorShipped(E, enginePath) {
  const f = path.join(path.dirname(path.resolve(L.ROOT, enginePath)), 'sitprior.js');
  if (!fs.existsSync(f)) return {};
  const m = /SIT_PRIOR_TXT\s*=\s*"([^"]*)"/.exec(fs.readFileSync(f, 'utf8'));
  return m ? E.sitPriorParse(m[1]) : {};
}

/** Lessons file ({ PAT_PRIOR, CAL_PRIOR }) → the patterns object projectGame reads (what Engine.patBeta(null) returns for built-in lessons). */
function patternsFrom(E, lessons, { minOnly = false, noCal = false } = {}) {
  if (!lessons) return null;
  const out = { n: 0, graded: 0 };
  for (const g of E.PAT_GROUPS) {
    out[g] = {};
    for (const s of E.PAT_LEARN) {
      if (minOnly && s !== 'min') continue;
      const P0 = lessons.PAT_PRIOR && lessons.PAT_PRIOR[g] && lessons.PAT_PRIOR[g][s];
      out[g][s] = P0 && P0.b ? P0.b.slice() : null;
      if (P0) out.n = Math.max(out.n, P0.n || 0);
    }
  }
  if (!noCal && !minOnly && lessons.CAL_PRIOR) out.cal = E.calTableFrom(null, lessons.CAL_PRIOR);
  if (!noCal && !minOnly && lessons.TEAM_PRIOR && E.teamTableFrom) out.team = E.teamTableFrom(null, lessons.TEAM_PRIOR);
  return out;
}

const emptyStage = () => ({
  games: 0, n: 0, abs: { pts: 0, reb: 0, ast: 0, fg3m: 0, min: 0 }, absMean: { pts: 0, reb: 0, ast: 0, fg3m: 0, min: 0 }, bias: { pts: 0, reb: 0, ast: 0, fg3m: 0, min: 0 }, sq: { pts: 0, reb: 0, ast: 0, fg3m: 0, min: 0 },
  nU: 0, absU: { pts: 0, reb: 0, ast: 0, fg3m: 0, min: 0 }, unproj: 0, ghost: 0,
  top3: 0, tot: { n: 0, abs: 0, bias: 0, mktN: 0, mktAbs: 0, absWithMkt: 0 }, team: { n: 0, abs: 0, bias: 0 },
  cal: Object.fromEntries(STATS.map((s) => [s, Array.from({ length: 10 }, () => [0, 0, 0])])), calRaw: Object.fromEntries(STATS.map((s) => [s, Array.from({ length: 10 }, () => [0, 0, 0])])),
  brier: { n: 0, cal: 0, raw: 0 },
  // per game: [players, |pts|, |reb|, |ast|, |3pm|, |min|, all-in players, all-in |pts|, all-in |min|, |total|, |pts| by the plain average]
  per: {},
});
function addStage(a, b) {
  const rec = (x, y) => { for (const k of Object.keys(y)) { if (typeof y[k] === 'number') x[k] = (x[k] || 0) + y[k]; else if (Array.isArray(y[k])) { x[k] = x[k] || []; for (let i = 0; i < y[k].length; i++) { if (typeof y[k][i] === 'number') x[k][i] = (x[k][i] || 0) + y[k][i]; else { x[k][i] = x[k][i] || []; rec(x[k][i], y[k][i]); } } } else { x[k] = x[k] || {}; rec(x[k], y[k]); } } };
  rec(a, b);
  return a;
}

/** Grade one projection against the final box (rows = logEntry(...).rows). The headline uses the app's own rule: players with 10+ real minutes. */
function score(E, proj, it, A, dump) {
  const rows = it.log.rows, g = it.g;
  const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
  A.games++;
  // [11..13]: everyone who really played 10+ minutes, projected or not (a missing projection counts as zero): players, |pts|, |min|
  const pg = (A.per[g.id] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // [14..16]: the same fixed population, |reb|, |ast|, |3pm|
  let top = -1;
  for (const r of Object.values(rows)) if (r.pts > top) top = r.pts;
  const topIds = new Set(Object.entries(rows).filter(([, r]) => r.pts === top).map(([id]) => +id));
  const best = proj.players.slice().sort((x, y) => y.proj.pts - x.proj.pts).slice(0, 3);
  if (best.some((p) => topIds.has(+p.pid))) A.top3++;
  const seen = new Set();
  const byName = {};
  for (const [pid, r] of Object.entries(rows)) byName[`${r.team}:${E.norm(r.name)}`] = +pid;
  for (const p of proj.players) {
    // a player projected from tonight's posted list has no play-by-play id yet: match him to the box by name
    const rid = rows[p.pid] ? +p.pid : (+p.pid < 0 ? byName[`${p.team}:${E.norm(p.name)}`] : undefined);
    seen.add(rid != null ? rid : +p.pid);
    const a = rid != null ? rows[rid] : undefined;
    const act = a && a.min > 0 ? a : null;
    if (act && act.min >= 10) {
      A.n++;
      for (const s of [...STATS, 'min']) { const e = p.proj[s] - act[s]; A.abs[s] += Math.abs(e); A.bias[s] += e; A.sq[s] += e * e; A.absMean[s] += Math.abs(p.mean[s] - act[s]); }
      pg[11]++; pg[12] += Math.abs(p.proj.pts - act.pts); pg[13] += Math.abs(p.proj.min - act.min);
      pg[14] += Math.abs(p.proj.reb - act.reb); pg[15] += Math.abs(p.proj.ast - act.ast); pg[16] += Math.abs(p.proj.fg3m - act.fg3m);
      pg[0]++; pg[1] += Math.abs(p.proj.pts - act.pts); pg[2] += Math.abs(p.proj.reb - act.reb); pg[3] += Math.abs(p.proj.ast - act.ast); pg[4] += Math.abs(p.proj.fg3m - act.fg3m); pg[5] += Math.abs(p.proj.min - act.min); pg[10] += Math.abs(p.mean.pts - act.pts);
    }
    // the all-in view: anyone who really played 10+ or whom we expected to play 10+
    if ((act && act.min >= 10) || p.proj.min >= 10) {
      A.nU++;
      if (!act) A.ghost++;
      for (const s of [...STATS, 'min']) A.absU[s] += Math.abs(p.proj[s] - (act ? act[s] : (p.now[s] || 0)));
      pg[6]++; pg[7] += Math.abs(p.proj.pts - (act ? act.pts : (p.now.pts || 0))); pg[8] += Math.abs(p.proj.min - (act ? act.min : (p.now.min || 0)));
    }
    // were the stated chances right? every ladder rung still ahead of him
    if (p.ladders && p.laddersRaw) {
      const fin = act || { pts: p.now.pts, reb: p.now.reb, ast: p.now.ast, fg3m: p.now.fg3m };
      for (const s of STATS) for (let i = 0; i < p.ladders[s].length; i++) {
        const Lc = p.ladders[s][i], Lr = p.laddersRaw[s][i];
        if (Lc.t <= p.now[s]) continue;
        const y = fin[s] >= Lc.t ? 1 : 0;
        const b = A.cal[s][Math.min(9, Math.floor(Lc.p * 10))]; b[0]++; b[1] += Lc.p; b[2] += y;
        const b2 = A.calRaw[s][Math.min(9, Math.floor(Lr.p * 10))]; b2[0]++; b2[1] += Lr.p; b2[2] += y;
        A.brier.n++; A.brier.cal += (Lc.p - y) * (Lc.p - y); A.brier.raw += (Lr.p - y) * (Lr.p - y);
      }
    }
    if (dump) dump.push({ id: g.id, d: g.date, el: proj.state.elapsed, pid: +p.pid, nm: p.name, tm: p.team, st: p.starter ? 1 : 0, now: [p.now.min, p.now.pts, p.now.reb, p.now.ast, p.now.fg3m].map((x) => +(+x).toFixed(2)),
      pr: [p.proj.min, p.proj.pts, p.proj.reb, p.proj.ast, p.proj.fg3m].map((x) => +(+x).toFixed(2)), mn: [p.mean.min, p.mean.pts, p.mean.reb, p.mean.ast, p.mean.fg3m].map((x) => +(+x).toFixed(2)),
      md: p.mid ? [p.mid.pts, p.mid.reb, p.mid.ast, p.mid.fg3m].map((x) => +(+x).toFixed(2)) : null, g: proj.patG || null,
      mp: +(+p.minPlain).toFixed(2), mpg: +(+p.mpg).toFixed(2), gms: p.games, ac: act ? [act.min, act.pts, act.reb, act.ast, act.fg3m] : null });
  }
  for (const [pid, a] of Object.entries(rows)) {
    if (seen.has(+pid) || !(a.min >= 10)) continue;
    A.nU++; A.unproj++;
    for (const s of [...STATS, 'min']) A.absU[s] += Math.abs(a[s]);
    pg[6]++; pg[7] += Math.abs(a.pts); pg[8] += Math.abs(a.min);
    pg[11]++; pg[12] += Math.abs(a.pts); pg[13] += Math.abs(a.min); pg[14] += Math.abs(a.reb); pg[15] += Math.abs(a.ast); pg[16] += Math.abs(a.fg3m);
    if (dump) dump.push({ id: g.id, d: g.date, el: proj.state.elapsed, pid: +pid, nm: a.name, tm: a.team, un: 1, ac: [a.min, a.pts, a.reb, a.ast, a.fg3m] });
  }
  // game total and each team's points (always from the plain averages)
  const fv = g.visitor_team_score, fh = g.home_team_score;
  const pt = proj.projScore[v] + proj.projScore[h];
  A.tot.n++; A.tot.abs += Math.abs(pt - (fv + fh)); A.tot.bias += pt - (fv + fh);
  pg[9] = Math.abs(pt - (fv + fh));
  if (it.market && it.market.total) { A.tot.mktN++; A.tot.mktAbs += Math.abs(it.market.total - (fv + fh)); A.tot.absWithMkt += Math.abs(pt - (fv + fh)); }
  A.team.n += 2; A.team.abs += Math.abs(proj.projScore[v] - fv) + Math.abs(proj.projScore[h] - fh); A.team.bias += proj.projScore[v] - fv + proj.projScore[h] - fh;
}

/** Plain-number summary of one stage's sums. */
function summarize(A) {
  const r = (x, d = 3) => +(+x).toFixed(d);
  const out = { games: A.games, n: A.n, top3: r(A.top3 / Math.max(A.games, 1)), nAll: A.nU, unprojected: A.unproj, ghosts: A.ghost };
  for (const s of [...STATS, 'min']) { out[s] = r(A.abs[s] / Math.max(A.n, 1)); out[s + 'Mean'] = r(A.absMean[s] / Math.max(A.n, 1)); out[s + 'Bias'] = r(A.bias[s] / Math.max(A.n, 1)); out[s + 'All'] = r(A.absU[s] / Math.max(A.nU, 1)); out[s + 'Rmse'] = r(Math.sqrt(A.sq[s] / Math.max(A.n, 1))); }
  out.total = r(A.tot.abs / Math.max(A.tot.n, 1), 2); out.totalBias = r(A.tot.bias / Math.max(A.tot.n, 1), 2);
  out.totalWithLine = r(A.tot.absWithMkt / Math.max(A.tot.mktN, 1), 2); out.lineMiss = r(A.tot.mktAbs / Math.max(A.tot.mktN, 1), 2); out.lineGames = A.tot.mktN;
  out.team = r(A.team.abs / Math.max(A.team.n, 1), 2); out.teamBias = r(A.team.bias / Math.max(A.team.n, 1), 2);
  out.brier = r(A.brier.cal / Math.max(A.brier.n, 1), 4); out.brierRaw = r(A.brier.raw / Math.max(A.brier.n, 1), 4);
  // calibration gap: average distance between stated and real frequency, weighted by how often each band is used
  const gap = (C) => { let n = 0, s = 0; for (const st of STATS) for (const b of C[st]) if (b[0] > 0) { n += b[0]; s += Math.abs(b[1] - b[2]); } return n ? s / n : 0; };
  out.calGap = r(gap(A.cal), 4); out.calGapRaw = r(gap(A.calRaw), 4);
  return out;
}

module.exports = { STATS, loadEngine, loadSeasons, recentLogs, momentAt, availOf, contextFor, sitPriorFor, sitPriorShipped, patternsFrom, emptyStage, addStage, score, summarize };
