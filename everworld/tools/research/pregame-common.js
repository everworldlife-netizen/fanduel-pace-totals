/* Pregame research (stages rep and pre): shared loader, point-in-time history features and clustered statistics.
 *
 * Everything a feature uses for a game on date D comes from games of the same season dated before D (the team's and
 * the player's own game logs with stints and quarter minutes), from tonight's posted list (stage pre only, unless
 * said otherwise) and from the books' line. Nothing from the game itself.
 *
 *   const C = require('./pregame-common');
 *   const S = C.prepare(2026);        // { rows: [dump rows of rep/pre with .f = features], un: [...], hist }
 *   C.ols(y, X, cluster)              // least squares with cluster-robust standard errors
 */
'use strict';
const path = require('path');
const L = require('../lib');
const R = require('../replay');

let _E = null;
const engine = () => (_E = _E || R.loadEngine('data/engines/final/engine.js'));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); };
const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); const n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const posGrp = (p) => (!p ? null : /C/.test(p) ? 'C' : /F/.test(p) ? 'F' : 'G');

/** Every team's and player's games of a season, oldest first. */
function loadHist(season) {
  const norm = engine().norm;
  const games = L.readJSON(path.join(L.DATA, 'derived', `games-${season}.json.gz`));
  games.sort((a, b) => (a.g.date < b.g.date ? -1 : a.g.date > b.g.date ? 1 : a.g.id - b.g.id));
  const team = {}, byKey = {}, player = {};
  for (const it of games) {
    if (!it.log || !it.log.rows) continue;
    const g = it.g, v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
    const ok = R.boxOk(it);
    for (const tm of [v, h]) {
      const tg = { id: g.id, date: g.date, tm, opp: tm === h ? v : h, home: tm === h ? 1 : 0, margin: (tm === h ? 1 : -1) * (g.home_team_score - g.visitor_team_score),
        ot: Math.max(0, (g.period || 4) - 4), ok, post: !!g.postseason, rows: {}, list: (it.lists && it.lists[tm]) || null, market: it.market || null, n: 0 };
      for (const [pid, a] of Object.entries(it.log.rows)) if (a.team === tm && a.min > 0) { tg.rows[pid] = a; }
      // the list as the phone sees it at tip-off: ruled-out players are not on it
      tg.active = tg.list ? tg.list.filter((x) => !(x.dnp && x.reason && !/COACH/i.test(x.reason))) : null;
      tg.activeN = tg.active ? new Map(tg.active.map((x) => [norm(x.name), x])) : null;
      tg.i = (team[tm] = team[tm] || []).length;
      team[tm].push(tg);
      byKey[g.id + ':' + tm] = tg;
      for (const [pid, a] of Object.entries(tg.rows)) {
        const reg = [1, 2, 3, 4].reduce((s, q) => s + ((a.qmin && a.qmin[q]) || 0), 0);
        (player[pid] = player[pid] || []).push({ tg, date: g.date, tm, min: a.min, reg, pf: a.pf || 0, started: Array.isArray(a.st) && a.st[0] && a.st[0][0] < 0.05 ? 1 : 0, a });
      }
    }
  }
  const byName = {};
  for (const [pid, a] of Object.entries(player)) byName[norm(a[a.length - 1].a.name)] = pid;
  // last season's finished stat lines (the app has this table): minutes a game and games, by normalized name
  const lastTab = {};
  try { const P = require('../pit'); for (const [k, v] of Object.entries(P.lastPriors(engine(), season))) lastTab[k] = { mpg: v.mpg, gp: v.gp, team: v.team, age: v.age }; } catch (e) { /* no table */ }
  return { season, team, byKey, player, norm, byName, lastTab };
}

/** Point-in-time features for one dump row (player r.pid of team r.tm in game r.id). */
function features(H, r) {
  const f = {};
  const tg = H.byKey[r.id + ':' + r.tm];
  if (!tg) return null;
  const prior = H.team[r.tm].slice(0, tg.i).filter((x) => x.date < r.d);
  // the app's recent window: the team's last 8 games inside 21 days
  const W = prior.filter((x) => days(x.date, r.d) <= 21).slice(-8);
  // players back from a layoff carry a made-up id in the dump: find their real one by name
  const pid = String(r.pid < 0 || !H.player[r.pid] ? (H.byName[H.norm(r.nm)] != null ? H.byName[H.norm(r.nm)] : r.pid) : r.pid);
  const mine = (H.player[pid] || []).filter((x) => x.date < r.d);       // all his games this season, any team
  const here = mine.filter((x) => x.tm === r.tm);
  const w = W.filter((x) => x.rows[pid]).map((x) => ({ tg: x, a: x.rows[pid] }));  // his games in the window
  const n = w.length;
  const mins = w.map((x) => x.a.min);
  f.n = n; f.teamN = W.length; f.seasonN = mine.length;
  // the engine's usual minutes, rebuilt (check against r.mpg)
  { let s = 0, ws = 0; mins.forEach((m, i) => { const ww = Math.pow(0.85, n - 1 - i); s += ww * m; ws += ww; }); f.mpgRe = ws ? s / ws : null; }
  const mpg = r.mpg;
  { const lt = H.lastTab[H.norm(r.nm)]; f.lastMpg = lt && lt.gp >= 10 ? lt.mpg : null; f.lastGp = lt ? lt.gp : 0; f.lastTeam = lt ? lt.team : null; f.age = lt ? lt.age : null; }
  // ---- A. volatility of his own minutes
  f.sd8 = n >= 3 ? sd(mins) : null;
  f.rng8 = n >= 3 ? Math.max(...mins) - Math.min(...mins) : null;
  const sAll = mine.slice(-20).map((x) => x.min);
  f.sdS = sAll.length >= 5 ? sd(sAll) : null;
  f.seasonMpg = mine.length >= 3 ? mean(mine.map((x) => x.min)) : null;
  f.l10Mpg = mine.length >= 3 ? mean(mine.slice(-10).map((x) => x.min)) : null;
  f.med8 = n >= 3 ? median(mins) : null;
  f.max8 = n >= 3 ? Math.max(...mins) : null;
  f.min8 = n >= 3 ? Math.min(...mins) : null;
  // ---- C. last games against his usual
  f.l1 = n >= 2 ? mins[n - 1] - mpg : null;
  f.l2 = n >= 3 ? mean(mins.slice(-2)) - mpg : null;
  f.l3 = n >= 4 ? mean(mins.slice(-3)) - mean(mins) : null;
  f.prev1 = n >= 3 ? mins[n - 2] - mpg : null;      // the game before last
  const lastG = n ? w[n - 1] : null;
  if (lastG) {
    const a = lastG.a, g = lastG.tg;
    f.lastBlow = Math.abs(g.margin) >= 15 ? 1 : 0;
    f.lastBlow20 = Math.abs(g.margin) >= 20 ? 1 : 0;
    f.lastMargin = g.margin;
    f.lastOT = g.ot > 0 ? 1 : 0;
    f.lastPf5 = (a.pf || 0) >= 5 ? 1 : 0;
    const st = a.st || [];
    const lastOut = st.length ? st[st.length - 1][1] : 0;
    f.lastLeftEarly = lastOut < 36 && Math.abs(g.margin) < 20 && a.min < 0.7 * mpg && mpg >= 15 ? 1 : 0;   // gone before the 4th quarter of a game that was not a rout
    f.lastOutAt = lastOut;
    f.lastWasTeamLast = W.length && W[W.length - 1] === g ? 1 : 0;
    f.daysSince = days(g.date, r.d);
    f.lastStarted = Array.isArray(a.st) && a.st[0] && a.st[0][0] < 0.05 ? 1 : 0;
    f.lastQ4 = (a.qmin && a.qmin[4]) || 0;
  }
  // how much of his recent sample came from routs, overtime and foul trouble
  if (n) {
    f.blowShare = mean(w.map((x) => (Math.abs(x.tg.margin) >= 20 ? 1 : 0)));
    f.blow15Share = mean(w.map((x) => (Math.abs(x.tg.margin) >= 15 ? 1 : 0)));
    f.blowWinShare = mean(w.map((x) => (x.tg.margin >= 15 ? 1 : 0)));
    f.blowLossShare = mean(w.map((x) => (x.tg.margin <= -15 ? 1 : 0)));
    f.otMin = mean(w.map((x) => [5, 6, 7, 8].reduce((s, q) => s + ((x.a.qmin && x.a.qmin[q]) || 0), 0)));
    f.pf5Share = mean(w.map((x) => ((x.a.pf || 0) >= 5 ? 1 : 0)));
    f.absMargin8 = mean(w.map((x) => Math.abs(x.tg.margin)));
    f.q4avg = mean(w.map((x) => (x.a.qmin && x.a.qmin[4]) || 0));
    // usual minutes from "clean" games only: regulation minutes of games decided by fewer than 15 with fewer than 5 fouls
    const clean = w.filter((x) => Math.abs(x.tg.margin) < 15 && (x.a.pf || 0) < 5);
    if (clean.length >= 2) {
      let s = 0, ws = 0; clean.forEach((x) => { const i = w.indexOf(x); const ww = Math.pow(0.85, n - 1 - i); const reg = [1, 2, 3, 4].reduce((q, k) => q + ((x.a.qmin && x.a.qmin[k]) || 0), 0); s += ww * reg; ws += ww; });
      f.cleanMpg = s / ws;
    }
    // the engine's own base, rebuilt: quarter averages (regulation) with the 0.85 recency weights, from games decided by
    // fewer than 15 when there are 2 or more of them (closeAvg), and from every game (regAvg)
    { const reg = (x) => [1, 2, 3, 4].reduce((q, k) => q + ((x.a.qmin && x.a.qmin[k]) || 0), 0);
      const wm = (arr) => { let s = 0, ws = 0; for (const x of arr) { const ww = Math.pow(0.85, n - 1 - w.indexOf(x)); s += ww * reg(x); ws += ww; } return ws ? s / ws : 0; };
      const cl = w.filter((x) => Math.abs(x.tg.margin) < 15);
      f.nClose = cl.length; f.regAvg = wm(w); f.closeAvg = cl.length >= 2 ? wm(cl) : f.regAvg;
      const bl = w.filter((x) => Math.abs(x.tg.margin) >= 15); f.blowAvg = bl.length ? wm(bl) : null; f.nBlow = bl.length; }
    f.startShare = mean(w.map((x) => (Array.isArray(x.a.st) && x.a.st[0] && x.a.st[0][0] < 0.05 ? 1 : 0)));
    f.started3 = mean(w.slice(-3).map((x) => (Array.isArray(x.a.st) && x.a.st[0] && x.a.st[0][0] < 0.05 ? 1 : 0)));
    // slope of minutes over his last 5 games (minutes per game)
    if (n >= 4) { const m5 = mins.slice(-5); const k = m5.length, xb = (k - 1) / 2, yb = mean(m5); let sxy = 0, sxx = 0; m5.forEach((y, i) => { sxy += (i - xb) * (y - yb); sxx += (i - xb) * (i - xb); }); f.slope5 = sxy / sxx; }
  }
  // ---- D. fouls
  { const tm = mine.reduce((s, x) => s + x.min, 0), tp = mine.reduce((s, x) => s + x.pf, 0); f.pf36 = tm >= 100 ? (36 * tp) / tm : null;
    const tm8 = w.reduce((s, x) => s + x.a.min, 0), tp8 = w.reduce((s, x) => s + (x.a.pf || 0), 0); f.pf36w = tm8 >= 40 ? (36 * tp8) / tm8 : null; }
  // ---- B. absences and returns (team games since he first played for this team this season)
  {
    const firstHere = here.length ? here[0].tg.i : null;
    if (firstHere != null) {
      const seq = prior.filter((x) => x.i >= firstHere).map((x) => (x.rows[pid] ? 1 : 0));
      let k = seq.length - 1, curAbs = 0;
      while (k >= 0 && !seq[k]) { curAbs++; k--; }
      let streak = 0; while (k >= 0 && seq[k]) { streak++; k--; }
      let absLen = 0; while (k >= 0 && !seq[k]) { absLen++; k--; }
      f.curAbs = curAbs;            // team games he missed right before tonight
      f.streak = streak;            // games played in a row before that (or before tonight)
      f.absBefore = absLen;         // games missed before that streak (0 = none: the streak reaches his first game here)
      f.gamesHere = here.length;
      // his level before the absence that precedes the current streak / before the current absence
      if (curAbs > 0 && streak > 0) f.preAbsMpg = mean(here.slice(-Math.min(5, streak)).map((x) => x.min));
      if (curAbs === 0 && absLen > 0) { const before = here.slice(0, here.length - streak).slice(-5); if (before.length) f.preAbsMpg = mean(before.map((x) => x.min)); f.sinceBackMpg = mean(here.slice(-streak).map((x) => x.min)); }
    } else { f.curAbs = null; f.gamesHere = 0; }
    // days since his own last game
    f.ownRest = mine.length ? days(mine[mine.length - 1].date, r.d) : null;
    // ---- H. new team
    const lastTeam = mine.length ? mine[mine.length - 1].tm : null;
    f.otherTeamGames = mine.filter((x) => x.tm !== r.tm).length;
    f.newTeam = f.otherTeamGames > 0 && mine[0].tm !== r.tm ? 1 : 0;     // came here during the season
    f.prevTeamOther = lastTeam && lastTeam !== r.tm ? 1 : 0;
  }
  // ---- E. how tight the coach's rotation is (team, recent window)
  if (W.length >= 3) {
    const per = W.map((x) => { const ms = Object.values(x.rows).map((a) => a.min).sort((p, q) => q - p); const len = 48 + 5 * x.ot; return { n10: ms.filter((m) => m >= 10).length, n5: ms.filter((m) => m >= 5).length, used: ms.length, top5: (ms.slice(0, 5).reduce((s, m) => s + m, 0) * 48) / len, top7: (ms.slice(0, 7).reduce((s, m) => s + m, 0) * 48) / len, close: Math.abs(x.margin) < 15 }; });
    f.rotN10 = mean(per.map((x) => x.n10)); f.rotUsed = mean(per.map((x) => x.used)); f.rotTop5 = mean(per.map((x) => x.top5)); f.rotTop7 = mean(per.map((x) => x.top7));
    const cl = per.filter((x) => x.close); f.rotN10c = cl.length >= 2 ? mean(cl.map((x) => x.n10)) : f.rotN10; f.rotTop7c = cl.length >= 2 ? mean(cl.map((x) => x.top7)) : f.rotTop7;
    // stability: how many different starting fives, and how much the regulars' minutes move from game to game
    const fives = new Set(W.map((x) => Object.entries(x.rows).filter(([, a]) => Array.isArray(a.st) && a.st[0] && a.st[0][0] < 0.05).map(([p]) => p).sort().join(',')));
    f.rotFives = fives.size / W.length;
    const reg = {}; for (const x of W) for (const [p, a] of Object.entries(x.rows)) (reg[p] = reg[p] || []).push(a.min);
    const sds = Object.values(reg).filter((a) => a.length >= 3 && mean(a) >= 15).map((a) => sd(a));
    f.rotSd = sds.length ? mean(sds) : null;
    f.teamBlow8 = mean(W.map((x) => (Math.abs(x.margin) >= 15 ? 1 : 0)));
    f.teamMargin8 = mean(W.map((x) => x.margin));
    f.teamAbsMargin8 = mean(W.map((x) => Math.abs(x.margin)));
  }
  // team record so far (season to date)
  { const reg = prior.filter((x) => !x.post); f.teamG = reg.length; f.teamWin = reg.length ? mean(reg.map((x) => (x.margin > 0 ? 1 : 0))) : null; f.teamNet = reg.length ? mean(reg.map((x) => x.margin)) : null; }
  { const opp = (H.team[r.opp] || []).filter((x) => x.date < r.d && !x.post); f.oppWin = opp.length ? mean(opp.map((x) => (x.margin > 0 ? 1 : 0))) : null; f.oppNet = opp.length ? mean(opp.map((x) => x.margin)) : null; }
  // ---- G. the books
  const mk = tg.market;
  if (mk && mk.spreadHome != null) { f.fav = (tg.home ? -1 : 1) * mk.spreadHome; f.total = mk.total || null; }
  f.home = tg.home;
  // ---- F. who else is available tonight, by position (posted list: stage pre; before lineups the injury report gives the same absences)
  if (tg.activeN) {
    const norm = H.norm;
    // usual minutes and position of everyone in the team's recent window
    const usual = {};
    for (const x of W) for (const [p, a] of Object.entries(x.rows)) { const u = usual[p] = usual[p] || { name: a.name, ms: [], pos: null }; u.ms.push(a.min); }
    // position: from the latest list (tonight's, or an earlier one) that names him
    const posOf = (name) => { const k = norm(name); const t = tg.activeN.get(k); if (t && t.pos) return posGrp(t.pos); for (let i = prior.length - 1; i >= 0 && i >= prior.length - 12; i--) { const l = prior[i].list; if (!l) continue; const y = l.find((z) => norm(z.name) === k); if (y && y.pos) return posGrp(y.pos); } return null; };
    const me = tg.activeN.get(norm(r.nm));
    const myPos = me && me.pos ? posGrp(me.pos) : posOf(r.nm);
    f.pos = myPos;
    let outSame = 0, outOther = 0, inSame = 0, inOther = 0, cntSame = 0, outStarters = 0, outTot = 0, inTot = 0;
    for (const [p, u] of Object.entries(usual)) {
      if (p === pid) continue;
      const m = mean(u.ms.slice(-3));    // like the engine: average of his last 3
      const share = u.ms.length / W.length;
      const active = tg.activeN.has(norm(u.name));
      const g = posOf(u.name);
      if (!active) { outTot += m; if (g && g === myPos) outSame += m; else outOther += m; if (m >= 24) outStarters++; }
      else { inTot += m * share; if (g && g === myPos) { inSame += m * share; if (m >= 10) cntSame++; } else inOther += m * share; }
    }
    f.outSame = outSame; f.outOther = outOther; f.inSame = inSame; f.inOther = inOther; f.cntSame = cntSame; f.outStarters = outStarters; f.outTot = outTot; f.inTot = inTot;
    f.activeCount = tg.active.length;
    // computable before lineups too: players of the recent window who are not out tonight (all, and those with 10+ a game)
    { let a = 0, b = 0; for (const [p, u] of Object.entries(usual)) { if (!tg.activeN.has(norm(u.name))) continue; a++; if (mean(u.ms) >= 10) b++; } f.availN = a; f.availN10 = b; }
    f.sT = me ? (me.starter ? 1 : 0) : null;
    // the men who usually start at his position: are they here?
  }
  return f;
}

/** Dump rows of the two pregame stages with features attached. */
function prepare(season, opts = {}) {
  const H = loadHist(season);
  const les = L.readJSON(path.join(L.DATA, 'lessons', opts.lessons || (season === 2027 ? 'H2-final.json' : 'A4-final.json'))).PAT_PRIOR;
  const LES = { rep: les.rep.min.b, pre: les.pre.min.b };
  const all = L.readJSON(path.join(L.DATA, 'research', `pregame-rows-${season}.json.gz`));
  const rows = [], un = [];
  for (const r of all) {
    if (r.un) { un.push(r); continue; }
    r.f = features(H, r) || {};
    r.gap = r.ac && r.ac[0] > 0 ? r.ac[0] - r.mn[0] : null;
    // the learned layer's own factor on the plain minutes (lessons the dump was made with), and what was added after it
    // (refill of cut minutes to teammates, team scaling, overtime)
    { const b = LES[r.g]; let z = 0; for (let j = 0; j < b.length; j++) z += b[j] * r.x[j]; r.lin = r.mp * clamp(z, -0.6, 1.5); r.rest = r.mn[0] - r.mp - r.lin; }
    r.tgk = r.id + ':' + r.tm;
    rows.push(r);
  }
  return { rows, un, hist: H };
}

// ---------------------------------------------------------------- statistics
/** Solve A x = b for symmetric positive definite A (Cholesky, small ridge already added by the caller). Returns inverse of A. */
function inv(A) {
  const n = A.length; const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('singular');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let i = 0; i < n; i++) if (i !== c) { const k = M[i][c]; if (k) for (let j = 0; j < 2 * n; j++) M[i][j] -= k * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}
/** Least squares y ~ X with cluster-robust (sandwich) standard errors. X: array of rows (include the 1 yourself). */
function ols(y, X, cl, ridge = 1e-6) {
  const n = y.length, k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  for (let i = 0; i < n; i++) { const x = X[i]; for (let p = 0; p < k; p++) { const xp = x[p]; if (!xp) continue; b[p] += xp * y[i]; for (let q = p; q < k; q++) A[p][q] += xp * x[q]; } }
  for (let p = 0; p < k; p++) { for (let q = 0; q < p; q++) A[p][q] = A[q][p]; A[p][p] += ridge; }
  const Ai = inv(A);
  const beta = Ai.map((r) => r.reduce((s, v, j) => s + v * b[j], 0));
  // cluster sums of x * e
  const G = new Map();
  for (let i = 0; i < n; i++) { const x = X[i]; let e = y[i]; for (let p = 0; p < k; p++) e -= x[p] * beta[p]; let g = G.get(cl[i]); if (!g) { g = new Array(k).fill(0); G.set(cl[i], g); } for (let p = 0; p < k; p++) g[p] += x[p] * e; }
  const B = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const g of G.values()) for (let p = 0; p < k; p++) { const gp = g[p]; if (!gp) continue; for (let q = 0; q < k; q++) B[p][q] += gp * g[q]; }
  const nc = G.size, adj = nc / (nc - 1);
  const se = new Array(k);
  for (let p = 0; p < k; p++) { let s = 0; for (let i = 0; i < k; i++) { const a = Ai[p][i]; if (!a) continue; for (let j = 0; j < k; j++) s += a * B[i][j] * Ai[j][p]; } se[p] = Math.sqrt(Math.max(s * adj, 0)); }
  return { beta, se, z: beta.map((v, i) => (se[i] > 0 ? v / se[i] : 0)), n, nc };
}
/** Mean of v with a cluster-robust standard error. */
function cmean(v, cl) {
  const G = new Map(); let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; const g = G.get(cl[i]) || [0, 0]; g[0] += v[i]; g[1]++; G.set(cl[i], g); }
  const n = v.length, m = n ? s / n : 0; let ss = 0;
  for (const g of G.values()) ss += (g[0] - g[1] * m) ** 2;
  const nc = G.size; const se = n && nc > 1 ? Math.sqrt((ss * nc) / (nc - 1)) / n : 0;
  return { n, nc, m, se, z: se > 0 ? m / se : 0 };
}

module.exports = { engine, loadHist, features, prepare, ols, cmean, inv, mean, sd, median, clamp, days, posGrp };
