/* GG Winner: gamer scoring profiles and fast-scorer alerts for the H2H GG League (4 x 5-min quarters).
 *
 * Works in the phone's browser from the league's own results (the /h2h/ schedule finals and, for
 * quarter splits, the play-by-play), so it needs no server change. For each gamer it builds:
 *   - points per game, points allowed, game totals, recent form (newer games count more)
 *   - scoring speed (points per minute) and a rank against every active gamer
 *   - quarter and half splits when play-by-play is available
 *   - head-to-head history against each opponent
 * Then, for any two gamers, a projection for the game, both halves and every quarter, and a
 * "fast scorers" alert when both are among the quickest scorers or the pair projects a high total.
 * During a game, live factors compare what each gamer has scored so far against their usual rate
 * and update the quarter, half and game numbers.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GGProfiles = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const GAME_SEC = 1200;
  const Q_SEC = 300;
  const HALF_LIFE = 15; // games: a gamer's 15th-newest game counts half as much as the newest
  const SHRINK = 6; // games of "league average" mixed into every gamer's numbers
  const PAIR_SHRINK = 6; // meetings needed before head-to-head counts for half
  const MIN_GAMES = 6; // games before a gamer is ranked
  // Ratings (v3.9): each gamer's scoring and defense measured against who they played and which NBA team they used,
  // plus how each gamer does with a given team and against a given opponent. Fitted on 15,000 league games
  // (walk-forward, Oct 8 - Nov 10 2026): average miss on the game total 10.17 -> 9.31, winner picked 54% -> 59%.
  const RATE = { halfLifeDays: 14, player: 3, team: 20, gamerTeam: 8, pair: 8, iterations: 30 };
  const normTeam = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  // How far past FanDuel's line our number has to be before we call a plus edge (from the app's own record,
  // Nov 7: 4-6 pt gaps on the full game won about 6 in 10, smaller gaps were close to a coin flip).
  const CUSHION = { game: 5, h1: 3, h2: 3, q: 2 };
  const DEFAULT_QSHARE = [0.25, 0.25, 0.25, 0.25];

  const round1 = (n) => Math.round(n * 10) / 10;
  const half5 = (n) => Math.floor(n) + 0.5 > n ? Math.floor(n) - 0.5 : Math.floor(n) + 0.5; // the .5 line at or below n
  const up5 = (n) => Math.ceil(n - 0.5) + 0.5; // the .5 line at or above n (v3.6.3: under thresholds)
  const norm = (s) => String(s || '').trim().toUpperCase();
  const pairKey = (a, b) => [norm(a), norm(b)].sort().join('|');

  /** League schedule rows -> finished games { id, t, a, b, sa, sb }. */
  function fromSchedule(rows) {
    const out = [];
    for (const r of rows || []) {
      if (!r || r.isCancelled || r.matchStatus !== 'MATCH_ENDED') continue;
      const sa = Number(r.teamAScore);
      const sb = Number(r.teamBScore);
      const t = Date.parse(r.startDate);
      if (!Number.isFinite(sa) || !Number.isFinite(sb) || !Number.isFinite(t) || sa + sb < 30) continue;
      out.push({ id: r.externalId, t, a: norm(r.participantAName), b: norm(r.participantBName), sa, sb, ta: normTeam(r.teamAName), tb: normTeam(r.teamBName) });
    }
    return out;
  }

  /** Play-by-play -> [q1a,q1b,q2a,q2b,q3a,q3b,q4a,q4b] for participant A/B (runningScore team_a is A). */
  function quartersFromTimeline(tl) {
    const inc = Array.isArray(tl?.incidents) ? tl.incidents : [];
    const ends = {};
    let last = null;
    for (const i of inc) {
      const rs = i.runningScore;
      if (rs && Number.isFinite(Number(rs.team_a)) && Number.isFinite(Number(rs.team_b))) last = [Number(rs.team_a), Number(rs.team_b)];
      if (i.messageType === 'NBA_PERIOD_CHANGE' && i.payload?.phase === 'ENDED' && i.period?.type === 'QUARTER' && last) ends[Number(i.period.id)] = last.slice();
    }
    if (![1, 2, 3, 4].every((q) => ends[q])) return null;
    const out = [];
    let prev = [0, 0];
    for (let q = 1; q <= 4; q += 1) {
      out.push(ends[q][0] - prev[0], ends[q][1] - prev[1]);
      prev = ends[q];
    }
    return out.some((v) => v < 0) ? null : out;
  }

  /**
   * Opponent-adjusted ratings by ridge regression (alternating least squares); newer games count more.
   * points(A with team X vs B with team Y) = mu + off[A] + def[B] + teamOff[X] + teamDef[Y] + gamerTeam[A,X] + pair[A vs B]
   */
  function fitRatings(games, now) {
    const idx = (map, k) => { let i = map.get(k); if (i == null) { i = map.size; map.set(k, i); } return i; };
    const P = new Map(); const T = new Map(); const GT = new Map(); const PR = new Map();
    const n = games.length * 2;
    const ip = new Int32Array(n); const iq = new Int32Array(n); const itp = new Int32Array(n); const itq = new Int32Array(n); const igt = new Int32Array(n); const ipr = new Int32Array(n);
    const y = new Float64Array(n); const w = new Float64Array(n);
    let r = 0;
    for (const g of games) {
      const wt = Math.pow(0.5, Math.max(0, (now - g.t) / 86400000) / RATE.halfLifeDays);
      for (const [me, op, tm, to, pts] of [[g.a, g.b, g.ta || '', g.tb || '', g.sa], [g.b, g.a, g.tb || '', g.ta || '', g.sb]]) {
        ip[r] = idx(P, me); iq[r] = idx(P, op); itp[r] = idx(T, tm); itq[r] = idx(T, to); igt[r] = idx(GT, `${me}|${tm}`); ipr[r] = idx(PR, `${me}>${op}`);
        y[r] = pts; w[r] = wt; r += 1;
      }
    }
    const blocks = [
      { ix: ip, v: new Float64Array(P.size), lam: RATE.player },
      { ix: iq, v: new Float64Array(P.size), lam: RATE.player },
      { ix: itp, v: new Float64Array(T.size), lam: RATE.team, skip: T.get('') },
      { ix: itq, v: new Float64Array(T.size), lam: RATE.team, skip: T.get('') },
      { ix: igt, v: new Float64Array(GT.size), lam: RATE.gamerTeam },
      { ix: ipr, v: new Float64Array(PR.size), lam: RATE.pair },
    ];
    let sw = 0; let sy = 0;
    for (let i = 0; i < n; i += 1) { sw += w[i]; sy += w[i] * y[i]; }
    let mu = sw ? sy / sw : 55;
    const fit = new Float64Array(n); // sum of all block values per row
    for (let it = 0; it < RATE.iterations && n; it += 1) {
      let num = 0;
      for (let i = 0; i < n; i += 1) num += w[i] * (y[i] - fit[i]);
      mu = num / sw;
      for (const b of blocks) {
        const sn = new Float64Array(b.v.length); const sd2 = new Float64Array(b.v.length);
        for (let i = 0; i < n; i += 1) { const k = b.ix[i]; sn[k] += w[i] * (y[i] - mu - fit[i] + b.v[k]); sd2[k] += w[i]; }
        const next = new Float64Array(b.v.length);
        for (let k = 0; k < next.length; k += 1) next[k] = k === b.skip ? 0 : sn[k] / (sd2[k] + b.lam);
        for (let i = 0; i < n; i += 1) { const k = b.ix[i]; fit[i] += next[k] - b.v[k]; }
        b.v = next;
      }
    }
    const toObj = (map, v, min = 0) => { const o = {}; for (const [k, i] of map) if (Math.abs(v[i]) >= min) o[k] = Math.round(v[i] * 100) / 100; return o; };
    return { mu, off: toObj(P, blocks[0].v), def: toObj(P, blocks[1].v), tOff: toObj(T, blocks[2].v), tDef: toObj(T, blocks[3].v), gt: toObj(GT, blocks[4].v, 0.05), pair: toObj(PR, blocks[5].v, 0.05), games: games.length };
  }
  /** Each side's expected points from the ratings (teams optional). */
  function ratedPoints(R, a, b, ta, tb) {
    const x = normTeam(ta); const yv = normTeam(tb);
    const g = (o, k) => (o && o[k]) || 0;
    return [
      R.mu + g(R.off, a) + g(R.def, b) + g(R.tOff, x) + g(R.tDef, yv) + (x ? g(R.gt, `${a}|${x}`) : 0) + g(R.pair, `${a}>${b}`),
      R.mu + g(R.off, b) + g(R.def, a) + g(R.tOff, yv) + g(R.tDef, x) + (yv ? g(R.gt, `${b}|${yv}`) : 0) + g(R.pair, `${b}>${a}`),
    ];
  }

  function wavg(list, f) {
    let s = 0; let w = 0;
    list.forEach((g, i) => { const k = Math.pow(0.5, i / HALF_LIFE); s += f(g) * k; w += k; });
    return w ? s / w : null;
  }
  const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
  function sd(xs) {
    const m = avg(xs);
    return xs.length > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - m) * (v - m), 0) / (xs.length - 1)) : null;
  }

  /**
   * @param games finished games { id, t, a, b, sa, sb } (any order)
   * @param quarters { id: [q1a,q1b,...,q4a,q4b] } optional quarter splits
   * @returns model { players: {NAME: profile}, league, pairs, games }
   */
  function build(games, quarters = {}, opts = {}) {
    const list = (games || []).filter((g) => g && g.a && g.b && Number.isFinite(g.sa) && Number.isFinite(g.sb)).slice().sort((x, y) => y.t - x.t);
    const seen = new Set();
    const uniq = list.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
    const totals = uniq.map((g) => g.sa + g.sb);
    const leagueTotal = avg(totals) || 104;
    const mu = leagueTotal / 2;
    // league quarter shape
    const qs = [0, 0, 0, 0]; let qn = 0;
    for (const g of uniq) {
      const q = quarters[g.id];
      if (!q || q.length !== 8) continue;
      const tot = q.reduce((s, v) => s + v, 0);
      if (tot < 30) continue;
      for (let k = 0; k < 4; k += 1) qs[k] += (q[2 * k] + q[2 * k + 1]) / tot;
      qn += 1;
    }
    const qShare = qn >= 20 ? qs.map((s) => s / qn) : DEFAULT_QSHARE.slice();

    const by = new Map();
    const pairs = new Map();
    for (const g of uniq) {
      const q = quarters[g.id];
      for (const [me, op, f, a, side] of [[g.a, g.b, g.sa, g.sb, 0], [g.b, g.a, g.sb, g.sa, 1]]) {
        if (!by.has(me)) by.set(me, []);
        const row = { id: g.id, t: g.t, opp: op, for: f, against: a, total: f + a };
        if (q && q.length === 8) row.q = [0, 1, 2, 3].map((k) => [q[2 * k + side], q[2 * k + 1 - side]]);
        by.get(me).push(row);
      }
      const k = pairKey(g.a, g.b);
      if (!pairs.has(k)) pairs.set(k, []);
      pairs.get(k).push({ id: g.id, t: g.t, a: g.a, b: g.b, sa: g.sa, sb: g.sb, total: g.sa + g.sb, q: q && q.length === 8 ? q : null });
    }

    const R = uniq.length >= 60 ? fitRatings(uniq, opts.now || Date.now()) : null;
    const players = {};
    for (const [name, gs] of by) {
      const n = gs.length;
      const k = n / (n + SHRINK);
      const ppgRaw = wavg(gs, (g) => g.for);
      const oppRaw = wavg(gs, (g) => g.against);
      const last10 = gs.slice(0, 10);
      const withQ = gs.filter((g) => g.q).slice(0, 30);
      const q = withQ.length ? {
        n: withQ.length,
        for: [0, 1, 2, 3].map((i) => round1(avg(withQ.map((g) => g.q[i][0])))),
        against: [0, 1, 2, 3].map((i) => round1(avg(withQ.map((g) => g.q[i][1])))),
        total: [0, 1, 2, 3].map((i) => round1(avg(withQ.map((g) => g.q[i][0] + g.q[i][1])))),
      } : null;
      if (q) {
        q.h1 = round1(q.total[0] + q.total[1]);
        q.h2 = round1(q.total[2] + q.total[3]);
        q.h1For = round1(q.for[0] + q.for[1]);
        q.best = q.for.indexOf(Math.max(...q.for)) + 1;
        const tot = q.total.reduce((s, v) => s + v, 0);
        q.share = tot ? q.total.map((v) => v / tot) : null;
      }
      players[name] = {
        name,
        n,
        ppg: round1(ppgRaw),
        opp: round1(oppRaw),
        off: R && R.off[name] != null ? R.off[name] + (R.mu - mu) : (ppgRaw - mu) * k, // points above league average per game (against an average opponent)
        def: R && R.def[name] != null ? R.def[name] : (oppRaw - mu) * k, // points allowed above league average (against an average opponent)
        total: round1(wavg(gs, (g) => g.total)),
        speed: round1(ppgRaw / 20), // points per game minute
        last10: { n: last10.length, ppg: round1(avg(last10.map((g) => g.for))), total: round1(avg(last10.map((g) => g.total))) },
        form: round1(avg(last10.map((g) => g.for)) - ppgRaw),
        highRate: totals.length ? gs.filter((g) => g.total >= leagueTotal + 8).length / n : 0,
        best: Math.max(...gs.map((g) => g.for)),
        lastAt: gs[0].t,
        recentIds: gs.slice(0, 8).map((g) => g.id),
        recent: gs.slice(0, 10).map((g) => ({ t: g.t, opp: g.opp, for: g.for, against: g.against })),
        q,
      };
    }
    // rank by scoring speed (newest-weighted points per game), only gamers with enough games
    const ranked = Object.values(players).filter((p) => p.n >= MIN_GAMES).sort((x, y) => (mu + y.off) - (mu + x.off));
    const cutFast = Math.max(1, Math.round(ranked.length * 0.3));
    const cutBlaze = Math.max(1, Math.round(ranked.length * 0.12));
    ranked.forEach((p, i) => {
      p.rank = i + 1;
      p.of = ranked.length;
      p.tier = i < cutBlaze ? 'blazing' : i < cutFast ? 'fast' : i >= ranked.length - cutFast ? 'slow' : '';
      p.hot = p.last10.n >= 6 && p.form >= 3;
      p.cold = p.last10.n >= 6 && p.form <= -3;
    });
    const out = { players, pairs, ratings: R, games: uniq.length, league: { total: round1(leagueTotal), ppg: round1(mu), sdTotal: round1(sd(totals) || 12), qShare, qGames: qn, ranked: ranked.length, builtAt: opts.now || Date.now() } };
    // a projected total this far above average counts as "high" (projections spread less than results)
    out.league.highLine = round1(leagueTotal + 0.35 * out.league.sdTotal);
    return out;
  }

  function blankPlayer(name, mu) {
    return { name, n: 0, ppg: round1(mu), opp: round1(mu), off: 0, def: 0, total: round1(2 * mu), speed: round1(mu / 20), last10: { n: 0 }, form: 0, recent: [], q: null, tier: '', rank: null };
  }

  /** Pregame projection for A vs B: game, halves, quarters, alert level and reasons in plain words. */
  function project(model, aName, bName, teamA, teamB) {
    const a = norm(aName); const b = norm(bName);
    const L = model.league;
    const mu = L.ppg;
    const A = model.players[a] || blankPlayer(a, mu);
    const B = model.players[b] || blankPlayer(b, mu);
    let ptsA = mu + A.off + B.def;
    let ptsB = mu + B.off + A.def;
    const R = model.ratings || null;
    if (R) [ptsA, ptsB] = ratedPoints(R, a, b, teamA, teamB);
    const base = ptsA + ptsB;
    const meet = (model.pairs.get ? model.pairs.get(pairKey(a, b)) : model.pairs[pairKey(a, b)]) || [];
    let total = base;
    let pair = null;
    if (meet.length) {
      const pAvg = wavg(meet, (g) => g.total);
      const w = meet.length / (meet.length + PAIR_SHRINK);
      if (!R) total = base * (1 - w) + pAvg * w; // the ratings already carry a (carefully shrunk) head-to-head effect
      const aFor = wavg(meet, (g) => (g.a === a ? g.sa : g.sb));
      pair = {
        n: meet.length,
        avg: round1(avg(meet.map((g) => g.total))),
        last: meet.slice(0, 5).map((g) => ({ t: g.t, a: g.a, sa: g.sa, b: g.b, sb: g.sb, total: g.total })),
        overs: meet.filter((g) => g.total >= L.total + 8).length,
        aShare: aFor / pAvg,
      };
    }
    // split the total between the two gamers: their own projections, nudged toward how meetings went
    let shareA = ptsA / (ptsA + ptsB);
    if (pair && !R) shareA = shareA * 0.7 + pair.aShare * 0.3;
    ptsA = total * shareA;
    ptsB = total - ptsA;
    // quarter shape: average of the two gamers' shapes (when known) and the league's
    const shapes = [A.q?.share, B.q?.share].filter(Boolean);
    const qShape = [0, 1, 2, 3].map((k) => {
      const own = shapes.length ? avg(shapes.map((s) => s[k])) : L.qShare[k];
      const wq = Math.min(1, ((A.q?.n || 0) + (B.q?.n || 0)) / 30) * 0.6;
      return own * wq + L.qShare[k] * (1 - wq);
    });
    const qSum = qShape.reduce((s, v) => s + v, 0);
    const q = qShape.map((s) => round1((total * s) / qSum));
    const h1 = round1(q[0] + q[1]);
    const h2 = round1(q[2] + q[3]);
    const sdGame = Math.max(8, L.sdTotal * 0.85);
    const fastCount = [A, B].filter((p) => p.tier === 'fast' || p.tier === 'blazing').length;
    const blazeCount = [A, B].filter((p) => p.tier === 'blazing').length;
    const high = total >= L.highLine;
    let level = 0;
    if (fastCount === 2) level = blazeCount ? 3 : 2;
    else if (high && fastCount === 1) level = 2;
    else if (high) level = 1;
    if (level && total < L.total + 2) level = 0; // fast gamers who usually play slow games together don't count
    const reasons = [];
    for (const p of [A, B]) {
      if (p.tier === 'blazing' || p.tier === 'fast') reasons.push(`${p.name} is the #${p.rank} fastest scorer of ${p.of} (${p.ppg} points a game, ${p.speed} a minute).`);
      if (p.hot) reasons.push(`${p.name} is hot: ${p.last10.ppg} points a game over the last ${p.last10.n}, up ${p.form} on usual.`);
      if (p.cold) reasons.push(`${p.name} is cold: ${p.last10.ppg} points a game over the last ${p.last10.n}, down ${Math.abs(p.form)} on usual.`);
      if (p.tier === 'slow') reasons.push(`${p.name} plays slow games (${p.total} total on average).`);
    }
    if (pair && pair.n >= 2) reasons.push(`They've met ${pair.n} times lately, averaging ${pair.avg} total${pair.overs ? ` (${pair.overs} went ${Math.round(L.total + 8)}+)` : ''}.`);
    if (!model.players[a] || !model.players[b]) reasons.push('One of them has no recent games, so their side uses the league average.');
    const betBelow = { game: half5(total - CUSHION.game), h1: half5(h1 - CUSHION.h1), h2: half5(h2 - CUSHION.h2), q: q.map((v) => half5(v - CUSHION.q)) };
    const betAbove = { game: up5(total + CUSHION.game), h1: up5(h1 + CUSHION.h1), h2: up5(h2 + CUSHION.h2), q: q.map((v) => up5(v + CUSHION.q)) };
    return {
      a, b,
      A: summary(A), B: summary(B),
      total: round1(total), ptsA: round1(ptsA), ptsB: round1(ptsB),
      h1, h2, q,
      sd: round1(sdGame),
      pair,
      level,
      label: level >= 3 ? 'Blazing scorers' : level === 2 ? 'Fast scorers' : level === 1 ? 'High total' : '',
      reasons,
      betBelow,
      betAbove,
      leagueTotal: L.total,
      vsLeague: round1(total - L.total),
    };
  }
  function summary(p) {
    return { name: p.name, n: p.n, ppg: p.ppg, opp: p.opp, speed: p.speed, rank: p.rank || null, of: p.of || null, tier: p.tier || '', hot: Boolean(p.hot), cold: Boolean(p.cold), form: p.form, last10: p.last10, q: p.q };
  }

  /**
   * In-game factors. sc = { a, b, q, clock, played } (played = game seconds so far, A/B = participant A/B).
   * The pregame numbers carry most of the weight: a hot start moves the projection only a little (see the learned weights below).
   */
  function live(pre, sc) {
    if (!pre || !sc || !Number.isFinite(sc.a) || !Number.isFinite(sc.b)) return null;
    const played = Math.max(0, Math.min(GAME_SEC, Number(sc.played) || 0));
    const left = GAME_SEC - played;
    // Learned from 357 league games replayed in time order, then checked on the next 357 (Nov 9):
    //  - the game's pace as a whole carries a little: about 8% of it after one quarter, 20% at the half, 24% after three
    //  - one gamer running ahead of the other does NOT carry: the gamer who is ahead gives some of it back
    //    (4% of his extra pace after one quarter, 8% at the half, 20% after three) and the other one catches up.
    const f = played / GAME_SEC;
    const wGame = played / (played + 2.4 * GAME_SEC);
    const wOwn = -0.3 * Math.pow(f, 1.5);
    const preA = pre.ptsA / GAME_SEC, preB = pre.ptsB / GAME_SEC;
    const devA = played > 0 ? sc.a / played - preA : 0, devB = played > 0 ? sc.b / played - preB : 0;
    const devT = devA + devB;
    const side = (pts, preRate, dev) => {
      const liveRate = played > 0 ? pts / played : preRate;
      const rate = Math.max(preRate * 0.5, preRate + wGame * (devT / 2) + wOwn * (dev - devT / 2));
      return { soFar: pts, expectedSoFar: round1(preRate * played), diff: round1(pts - preRate * played), pacePerGame: played >= 60 ? round1(liveRate * GAME_SEC) : null, usualPerGame: round1(preRate * GAME_SEC), rest: rate * left, rate, proj: round1(pts + rate * left) };
    };
    const sA = side(sc.a, preA, devA);
    const sB = side(sc.b, preB, devB);
    // Fade warning: a gamer well ahead of his usual pace. Hot starts in this league do not last.
    const fade = [];
    if (played >= 240 && left >= 180) for (const [k, nm, x] of [['a', pre.a, sA], ['b', pre.b, sB]]) {
      if (x.diff >= 5 && x.pacePerGame - x.proj >= 4) fade.push({ side: k, name: nm, ahead: x.diff, pace: x.pacePerGame, proj: x.proj, text: `Fade warning: ${nm} has ${x.soFar}, ${round1(x.diff)} more than usual by now. Hot starts in this league do not last: gamers keep almost none of the extra pace, and the gamer who is ahead usually gives some back. He is on pace for ${Math.round(x.pacePerGame)}, we expect about ${Math.round(x.proj)}.` });
    }
    const total = sc.a + sc.b + sA.rest + sB.rest;
    const rate = sA.rate + sB.rate; // points per game second from here on
    const qNow = Math.min(4, Math.max(1, Number(sc.q) || 1));
    const inOt = Number(sc.q) > 4;
    const qLeft = inOt ? 0 : Math.max(0, Math.min(Q_SEC, Number.isFinite(sc.clock) ? sc.clock : Q_SEC - (played - (qNow - 1) * Q_SEC)));
    const qStart = sc.qStart; // score total when this quarter began, if known
    const qSoFar = Number.isFinite(qStart) ? sc.a + sc.b - qStart : null;
    const quarter = qSoFar != null ? round1(qSoFar + rate * qLeft) : null;
    let h1 = null;
    if (qNow <= 2 && !inOt) {
      const leftH1 = Math.max(0, 2 * Q_SEC - played);
      h1 = round1(sc.a + sc.b + rate * leftH1);
    } else if (Number.isFinite(sc.h1)) h1 = sc.h1;
    const expected = sA.expectedSoFar + sB.expectedSoFar;
    const run = played >= 90 ? (sc.a + sc.b) - expected : 0;
    const temp = run >= 6 ? 'hot' : run <= -6 ? 'cold' : 'normal';
    const pct = played / GAME_SEC;
    const say = [];
    if (played >= 60) {
      say.push(`${pre.a}: ${sc.a} so far vs ${round1(sA.expectedSoFar)} usual by now (${sA.pacePerGame} a game pace).`);
      say.push(`${pre.b}: ${sc.b} so far vs ${round1(sB.expectedSoFar)} usual by now (${sB.pacePerGame} a game pace).`);
      say.push(temp === 'hot' ? `Running hot: ${round1(run)} points ahead of their usual pace together.` : temp === 'cold' ? `Running cold: ${round1(Math.abs(run))} points behind their usual pace together.` : 'Scoring right around their usual pace.');
      for (const x of fade) say.push(x.text);
    } else say.push('Just tipped, so this is still the pregame number.');
    return {
      total: round1(total),
      h1,
      quarter,
      quarterNo: inOt ? null : qNow,
      a: sA, b: sB,
      fade: fade.length ? fade : null,
      run: round1(run),
      temp,
      pct: round1(pct * 100),
      say,
      betBelow: { game: half5(total - CUSHION.game * (1 - pct * 0.6)), h1: h1 != null && qNow <= 2 ? half5(h1 - CUSHION.h1 * (1 - Math.min(1, played / 600) * 0.6)) : null, quarter: quarter != null ? half5(quarter - CUSHION.q * 0.7) : null },
      betAbove: { game: up5(total + CUSHION.game * (1 - pct * 0.6)), h1: h1 != null && qNow <= 2 ? up5(h1 + CUSHION.h1 * (1 - Math.min(1, played / 600) * 0.6)) : null, quarter: quarter != null ? up5(quarter + CUSHION.q * 0.7) : null },
    };
  }

  /**
   * Replay games in time order and check how alerts did: every game is projected only from the games
   * before it, so this is a fair record of what the alert would have said at the time.
   */
  function backtest(games, quarters = {}, { warm = 150, step = 25 } = {}) {
    const list = (games || []).slice().sort((x, y) => x.t - y.t);
    const rows = [];
    let model = null;
    for (let i = warm; i < list.length; i += 1) {
      if (!model || (i - warm) % step === 0) model = build(list.slice(0, i), quarters);
      const g = list[i];
      const p = project(model, g.a, g.b);
      if (!model.players[p.a] || !model.players[p.b]) continue;
      const actual = g.sa + g.sb;
      const q = quarters[g.id];
      rows.push({ level: p.level, proj: p.total, actual, h1p: p.h1, h1: q ? q[0] + q[1] + q[2] + q[3] : null, line: p.betBelow.game, h1Line: p.betBelow.h1 });
    }
    const sum = (rs) => {
      if (!rs.length) return { n: 0 };
      const h1s = rs.filter((r) => r.h1 != null);
      return {
        n: rs.length,
        avgActual: round1(avg(rs.map((r) => r.actual))),
        avgProj: round1(avg(rs.map((r) => r.proj))),
        miss: round1(avg(rs.map((r) => Math.abs(r.actual - r.proj)))),
        overLine: Math.round((rs.filter((r) => r.actual > r.line).length / rs.length) * 100),
        overLeague: Math.round((rs.filter((r) => r.actual > (model ? model.league.total : 104)).length / rs.length) * 100),
        h1n: h1s.length,
        h1OverLine: h1s.length ? Math.round((h1s.filter((r) => r.h1 > r.h1Line).length / h1s.length) * 100) : null,
      };
    };
    return { all: sum(rows), alerts: sum(rows.filter((r) => r.level >= 2)), high: sum(rows.filter((r) => r.level >= 1)), quiet: sum(rows.filter((r) => r.level === 0)) };
  }

  return { build, project, live, backtest, fromSchedule, quartersFromTimeline, pairKey, norm, normTeam, fitRatings, ratedPoints, RATE, CUSHION, half5, up5 };
}));
