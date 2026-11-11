'use strict';
/* Shared loader for the scenario audit (topic "audit"): reads a research dump once, attaches to every row the
 * team-game context that the live rows no longer carry (back-to-back, team load, books' spread and total, layoff and
 * deep-bench flags from the tip-off row) and the gaps the audit measures.
 * Everything attached is point-in-time: it comes from the row itself, the tip-off row of the same game, or the closing line. */
const path = require('path');
const L = require('../lib');
const R = require('../replay');

const STAGES = ['rep', 'pre', 's6', 's12', 's18', 's24', 's30', 's36', 's42'];
const F = ['base', 'starter', 'bench', 'b2b', 'pace', 'blowout', 'roleTrend', 'matesOut', 'proof', 'home', 'softD', 'track', 'fouls', 'livePace', 'margin', 'minTrack', 'shooting',
  'uReal', 'luck', 'leadS', 'trailS', 'lopB', 'on', 'sitLong', 'dnp', 'usgHi', 'closeStar', 'pfX', 'recent', 'mpgC', 'fadeHist', 'leadProof', 'tdMkt', 'tdLive',
  'startUp', 'startDown', 'fresh', 'deep', 'vacPos', 'lastMin', 'rest3', 'missShare', 'loadS', 'loadB', 'loadBd', 'loadBq', 'favS', 'dogS', 'dogB'];
const IX = Object.fromEntries(F.map((k, i) => [k, i]));

function load(season, opts = {}) {
  const all = L.readJSON(path.join(L.DATA, 'runs', `research-${season}.rows.json.gz`));
  const games = L.readJSON(path.join(L.DATA, 'derived', `games-${season}.json.gz`));
  const G = {};
  for (const it of games) { if (R.boxOk(it)) G[it.g.id] = it; }
  const un = all.filter((r) => r.un);
  const rows = all.filter((r) => !r.un && r.mn);
  // tip-off rows: per player and per team-game
  const preOf = new Map(), repOf = new Map(), tg = new Map();
  for (const r of rows) {
    if (r.g === 'pre') preOf.set(r.id + ':' + r.pid, r);
    if (r.g === 'rep') repOf.set(r.id + ':' + r.pid, r);
    if (r.g === 'pre' || r.g === 'rep') {
      const k = r.id + ':' + r.tm;
      let t = tg.get(k);
      if (!t) { t = { b2b: 0, ld: null, n: 0 }; tg.set(k, t); }
      if (r.x[IX.b2b]) t.b2b = 1;
      if (t.ld == null && r.g === 'pre') t.ld = r.x[IX.starter] ? r.x[IX.loadS] : r.x[IX.loadB];
    }
  }
  // dates: first half / second half of the season by game date (median game)
  const ids = [...new Set(rows.map((r) => r.id))];
  const dateOf = {}; for (const r of rows) dateOf[r.id] = r.d;
  ids.sort((a, b) => (dateOf[a] < dateOf[b] ? -1 : dateOf[a] > dateOf[b] ? 1 : a - b));
  const half = {}; ids.forEach((id, i) => { half[id] = i < ids.length / 2 ? 0 : 1; });
  const gix = {}; ids.forEach((id, i) => { gix[id] = i; });
  for (const r of rows) {
    r._s = STAGES.indexOf(r.g);
    r._gi = gix[r.id];
    r._half = half[r.id];
    const t = tg.get(r.id + ':' + r.tm) || { b2b: 0, ld: null };
    r._b2b = t.b2b; r._ld = t.ld;
    const it = G[r.id];
    const mk = it && it.market;
    r._fav = null; r._tot = null;
    if (mk && mk.spreadHome != null) r._fav = r.hm ? -mk.spreadHome : mk.spreadHome;
    if (mk && mk.total) r._tot = mk.total;
    const p = preOf.get(r.id + ':' + r.pid);
    r._fr = p ? p.fr : r.fr; r._dp = p ? p.dp : r.dp;
    r._pre = p || null;
    // gaps
    const ac = r.ac;
    r._played = ac && ac[0] > 0 ? 1 : 0;
    r._p10 = ac && ac[0] >= 10 ? 1 : 0;
    const a = ac || [0, 0, 0, 0, 0];
    r._a = a;
    r._d = [a[0] - r.mn[0], a[1] - r.mn[1], a[2] - r.mn[2], a[3] - r.mn[3]]; // real minus the engine's plain average
    r._e = [Math.abs(a[0] - r.pr[0]), Math.abs(a[1] - r.pr[1]), Math.abs(a[2] - r.pr[2]), Math.abs(a[3] - r.pr[3])]; // miss of the number shown
    // the same with real minutes plugged in: what he has now + the engine's remaining production scaled to the minutes he really had left
    const remE = r.mn[0] - r.now[0], remR = Math.max(a[0] - r.now[0], 0);
    r._remE = remE; r._remR = remR;
    r._rm = [a[0], 0, 0, 0]; r._rmp = [a[0], 0, 0, 0];
    for (let k = 1; k <= 3; k++) {
      const remOur = Math.max(r.mn[k] - r.now[k], 0), remShown = Math.max(r.pr[k] - r.now[k], 0);
      // if the engine thinks he is done (under half a minute left) the ratio is meaningless: use his per-minute rate for the real minutes left
      const rate = remE >= 0.5 ? remOur / remE : r.rpm[k - 1];
      const rateS = remE >= 0.5 ? remShown / remE : r.rpm[k - 1];
      r._rm[k] = r.now[k] + rate * remR;
      r._rmp[k] = r.now[k] + rateS * remR;
    }
    r._dr = [0, a[1] - r._rm[1], a[2] - r._rm[2], a[3] - r._rm[3]]; // per-minute bias (real minus engine with real minutes)
    r._er = [0, Math.abs(a[1] - r._rmp[1]), Math.abs(a[2] - r._rmp[2]), Math.abs(a[3] - r._rmp[3])]; // miss with real minutes (shown rate)
    // scoring pace so far against his own rate
    const exp = r.rpm[0] * r.now[0];
    r._hot = r.now[0] >= 4 && exp > 0.3 ? (r.now[1] - exp) / Math.sqrt(exp + 1) : null;
  }
  return { rows, un, G, ids, nGames: ids.length, tg, preOf, repOf };
}

/* cluster-robust mean and z: clusters = games. vals: array of [clusterIndex, value] pairs given as two typed arrays */
function clusterMean(sumByC, nByC) {
  let S = 0, N = 0, C = 0;
  for (let c = 0; c < sumByC.length; c++) { if (nByC[c] > 0) { S += sumByC[c]; N += nByC[c]; C++; } }
  if (!N) return { n: 0, c: 0, m: 0, se: 0, z: 0 };
  const m = S / N;
  let v = 0;
  for (let c = 0; c < sumByC.length; c++) { if (nByC[c] > 0) { const e = sumByC[c] - m * nByC[c]; v += e * e; } }
  const se = Math.sqrt(v * (C / Math.max(C - 1, 1))) / N;
  return { n: N, c: C, m, se, z: se > 0 ? m / se : 0 };
}
/* difference of two means (scenario vs the rest) with game clusters, the two groups may share games */
function clusterDiff(s1, n1, s0, n0) {
  let S1 = 0, N1 = 0, S0 = 0, N0 = 0, C = 0;
  for (let c = 0; c < s1.length; c++) { S1 += s1[c]; N1 += n1[c]; S0 += s0[c]; N0 += n0[c]; if (n1[c] > 0 || n0[c] > 0) C++; }
  if (!N1 || !N0) return { d: 0, se: 0, z: 0 };
  const m1 = S1 / N1, m0 = S0 / N0;
  let v = 0;
  for (let c = 0; c < s1.length; c++) { const e = (s1[c] - m1 * n1[c]) / N1 - (s0[c] - m0 * n0[c]) / N0; v += e * e; }
  const se = Math.sqrt(v * (C / Math.max(C - 1, 1)));
  return { d: m1 - m0, se, z: se > 0 ? (m1 - m0) / se : 0 };
}
const f2 = (x, w = 6) => (x == null || !isFinite(x) ? '-' : x.toFixed(2)).padStart(w);
const f1 = (x, w = 5) => (x == null || !isFinite(x) ? '-' : x.toFixed(1)).padStart(w);
const f3 = (x, w = 7) => (x == null || !isFinite(x) ? '-' : x.toFixed(3)).padStart(w);

module.exports = { load, STAGES, F, IX, clusterMean, clusterDiff, f1, f2, f3, L };
