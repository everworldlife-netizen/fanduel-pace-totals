/*
 * Courtside Arcade — live NBA projection engine (runs in the browser and in Node tests).
 *
 * Input is DataBallr data only: live games, play-by-play, season player stats, injuries, props.
 *
 * Model (per player, rest of game):
 *   minutes  = season quarter-minute pattern + tonight's share, foul trouble, and the coach's
 *              blowout habit learned from this season's logs (simulated margin path)
 *   usage    = (FGA + .44 FTA + TOV) share of team plays on court: this season blended with last
 *              season and tonight (80/20), renormalized so each team's floor usage sums to 100%
 *   shots    = remaining team possessions x on-court share x usage, split by shot mix
 *   makes    = shooting %s shrunk toward last season / league, adjusted for opponent defense,
 *              with hot/cold night variance
 *   reb/ast  = per-minute rates (season + last season + tonight)
 * Every team's minutes are forced to fill 5 x time left so team totals stay coherent.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEAGUE = { p2: 0.545, p3: 0.36, ft: 0.78, ortg: 114.5, pace: 99, usg: 0.2 };
  // Tunables (chosen by scripts/backtest.js; see README "Accuracy").
  const TUNE = {
    tonightW: 0.2,      // weight on tonight's rates (the 80/20 blend)
    tonightRamp: 15,    // minutes played before tonight's weight is fully on
    usgPriorK: 250,     // on-court team plays before season usage outweighs last season
    p3K: 120, p2K: 70, ftK: 60, // shooting % shrink (attempts of prior)
    paceK: 30,          // minutes before live pace outweighs season pace
    qShareTonight: 0.4, // weight of tonight's share inside the current quarter
    minShock: 0.24,     // per-sim minutes noise (backtest: best calibration)
    usgTarget: 0.2,     // average on-floor usage after renormalization
    absentMinMpg: 20,   // a 20+ mpg player who missed the last game is presumed out (backtest)
    b2bRestAge: 0,      // on a back-to-back 2nd night, presume starters this old sit (0 = flag only)
    liveOutMin: 10,     // live: a 24+ mpg player not checked in by this game minute is out
    closeQ4: true,      // quarter-minute pattern from close games (blowouts are simulated separately)
    drift: 2,           // weight of team-strength drift in the margin path (backtest)
    homeAdv: 2.5,       // home-court points per 48
    marginK: 2.8,       // live margin random walk: sd per sqrt(minute) (20+ leads into Q4 hit 25%, as observed)
    preQ3Sd: 16,        // pregame sd of the margin at the end of Q3
    q4Pace: 0.94,       // 4th quarters run ~6% fewer possessions per minute (backtest)
    shotEff: 0.975,     // early-season makes run ~2.5% below last season's rates (backtest)
    closerQ4: 0,        // when the simulated game stays within 8, starters play at least this many Q4 minutes
  };
  const addDaysStr = (s, n) => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const BENCH_RATE = { pts: 0.4, reb: 0.17, ast: 0.09, fg3m: 0.04 };
  const VAR_K = { reb: 1.5, ast: 1.6 };

  // ---------------------------------------------------------------- RNG + samplers
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeSampler(seed) {
    const u = mulberry32(seed || 1);
    let spare = null;
    function normal(mu = 0, sd = 1) {
      if (spare !== null) { const s = spare; spare = null; return mu + sd * s; }
      let x, y, r;
      do { x = u() * 2 - 1; y = u() * 2 - 1; r = x * x + y * y; } while (r === 0 || r >= 1);
      const f = Math.sqrt((-2 * Math.log(r)) / r);
      spare = y * f;
      return mu + sd * x * f;
    }
    function poisson(lam) {
      if (!(lam > 0)) return 0;
      if (lam > 30) return Math.max(0, Math.round(normal(lam, Math.sqrt(lam))));
      const L = Math.exp(-lam);
      let k = 0, p = 1;
      do { k++; p *= u(); } while (p > L);
      return k - 1;
    }
    function binomial(n, p) {
      if (n <= 0 || p <= 0) return 0;
      if (p >= 1) return n;
      if (n > 60) return Math.min(n, Math.max(0, Math.round(normal(n * p, Math.sqrt(n * p * (1 - p))))));
      let k = 0;
      for (let i = 0; i < n; i++) if (u() < p) k++;
      return k;
    }
    function gamma(shape, scale) {
      if (shape < 1) return gamma(shape + 1, scale) * Math.pow(u(), 1 / shape);
      const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x, v;
        do { x = normal(); v = 1 + c * x; } while (v <= 0);
        v = v * v * v;
        const uu = u();
        if (uu < 1 - 0.0331 * x * x * x * x || Math.log(uu) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
      }
    }
    // negative binomial with given mean and variance = k * mean (gamma-Poisson mixture)
    function negbin(mean, k) {
      if (!(mean > 0)) return 0;
      return poisson(gamma(mean / (k - 1), k - 1));
    }
    return { u, normal, poisson, binomial, gamma, negbin };
  }

  // ---------------------------------------------------------------- helpers
  function clockSec(clock) {
    if (clock == null) return 0;
    const s = String(clock).trim();
    if (!s) return 0;
    if (s.includes(':')) {
      const [m, sec] = s.split(':');
      return (m ? parseFloat(m) : 0) * 60 + (parseFloat(sec) || 0);
    }
    const f = parseFloat(s);
    return Number.isFinite(f) ? f : 0;
  }
  const periodLen = (p) => (p <= 4 ? 720 : 300);
  function elapsedSec(period, clock) {
    let base = 0;
    for (let q = 1; q < period; q++) base += periodLen(q);
    return base + periodLen(period) - clockSec(clock);
  }
  function norm(name) {
    return String(name || '')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[.'\-]/g, '')
      .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  /** Parse a DataBallr live-games row into a clean game state. */
  function gameState(g) {
    const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
    const vs = g.visitor_team_score || 0, hs = g.home_team_score || 0;
    const state = String(g.status_state || g.display_status || '').toLowerCase();
    let period = g.period || 0;
    const t = String(g.time || '').trim();
    let clock = '12:00';
    let phase = 'pre';
    if (state === 'final' || (!g.status_state && (/final/i.test(t) || /final/i.test(g.display_status || '')))) { phase = 'final'; clock = '0:00'; period = Math.max(period, 4); }
    else if (period > 0) {
      phase = 'live';
      if (/half/i.test(t)) { period = 2; clock = '0:00'; }
      else if (/^end/i.test(t)) clock = '0:00';
      else if (t) clock = t.split(/\s+/).pop();
    }
    const el = phase === 'pre' ? 0 : elapsedSec(period, clock) / 60;
    const regLeft = Math.max(48 - el, 0);
    const left = phase === 'final' ? 0 : period > 4 ? clockSec(clock) / 60 : regLeft;
    const label = phase === 'pre' ? (g.display_status || '') : phase === 'final' ? 'FINAL' : (/half/i.test(t) ? 'HALF' : t);
    return {
      id: g.id, v, h, vs, hs, period, clock, phase, elapsed: el, left, label,
      margin: Math.abs(vs - hs), isClutch: !!g.is_clutch, tip: g.datetime,
      vName: g.visitor_team.full_name, hName: g.home_team.full_name,
      lines: {
        v: [g.visitor_q1, g.visitor_q2, g.visitor_q3, g.visitor_q4],
        h: [g.home_q1, g.home_q2, g.home_q3, g.home_q4],
      },
    };
  }

  /** Blowout rule the user bets by: 15+ any time, or 12+ in the second half. */
  function isBlowout(st, any = 15, second = 12) {
    if (st.phase === 'pre') return false;
    return st.margin >= any || (st.period >= 3 && st.margin >= second);
  }

  // ---------------------------------------------------------------- box score from play-by-play
  const SHOT = /^(.*?) (makes|misses) /;
  const BLOCK = /^.*? blocks (.*?)'s /;
  const REB = /^(.*?) (offensive|defensive) rebound/;
  const SUB = /^(.*?) enters the game for (.*)$/;

  function boxFromPlays(plays, curPeriod, curClock) {
    const P = new Map();
    const T = {};
    const team = (abbr) => (T[abbr] = T[abbr] || { fga: 0, fta: 0, oreb: 0, dreb: 0, tov: 0, pts: 0, fg3a: 0, fg3m: 0 });
    const pl = (id) => {
      if (!P.has(id)) P.set(id, { pid: id, name: '', teams: {}, pts: 0, reb: 0, oreb: 0, ast: 0, fg3m: 0, fg3a: 0, fga: 0, fgm: 0, fta: 0, ftm: 0, tov: 0, pf: 0, tech: 0, ejected: false, q: {} });
      return P.get(id);
    };
    const tag = (rec, abbr) => { if (abbr) rec.teams[abbr] = (rec.teams[abbr] || 0) + 1; };
    const byPer = new Map();
    for (const p of plays || []) {
      if (!byPer.has(p.period)) byPer.set(p.period, []);
      byPer.get(p.period).push(p);
      const txt = String(p.text || '').trim();
      const parts = p.participants || [];
      const typ = p.type || '';
      const abbr = p.team && p.team.abbreviation;
      if (typ === 'Substitution') {
        const m = SUB.exec(txt);
        if (m && parts.length >= 2) {
          const a = pl(parts[0]), b = pl(parts[1]);
          a.name = m[1]; b.name = m[2]; tag(a, abbr); tag(b, abbr);
        }
        continue;
      }
      if (/ejected/i.test(txt) && parts.length) pl(parts[0]).ejected = true;
      if (p.shooting_play && parts.length) {
        const a = pl(parts[0]);
        const m = SHOT.exec(txt);
        if (m) a.name = a.name || m[1];
        else { const mb = BLOCK.exec(txt); if (mb) a.name = a.name || mb[1]; }
        tag(a, abbr);
        const made = (' ' + txt + ' ').includes(' makes ');
        const three = txt.includes('three point');
        if (txt.includes('free throw')) {
          a.fta++; if (made) a.ftm++;
          if (abbr) team(abbr).fta++;
        } else {
          a.fga++; if (made) a.fgm++;
          if (abbr) team(abbr).fga++;
          if (three) { a.fg3a++; if (abbr) team(abbr).fg3a++; }
        }
        if (made) {
          const sv = p.score_value || 0;
          a.pts += sv;
          if (abbr) team(abbr).pts += sv;
          if (three) { a.fg3m++; if (abbr) team(abbr).fg3m++; }
          const am = /\((.*?) assists\)/.exec(txt);
          if (am && parts.length >= 2) { const b = pl(parts[1]); b.ast++; b.name = b.name || am[1]; tag(b, abbr); }
        }
        continue;
      }
      if (typ.includes('Rebound')) {
        if (abbr) team(abbr)[typ.includes('Offensive') ? 'oreb' : 'dreb']++;
        if (parts.length) {
          const m = REB.exec(txt);
          if (m) { const a = pl(parts[0]); a.reb++; if (typ.includes('Offensive')) a.oreb++; a.name = a.name || m[1]; tag(a, abbr); }
        }
        continue;
      }
      if (typ.includes('Turnover')) {
        if (abbr) team(abbr).tov++;
        if (parts.length) pl(parts[0]).tov++;
        continue;
      }
      if (typ.includes('Foul') && parts.length) {
        if (typ.includes('Technical') || /technical/i.test(txt)) { if (!/3-seconds/i.test(txt)) pl(parts[0]).tech++; }
        else pl(parts[0]).pf++;
      }
    }
    const teamOf = (rec) => {
      let best = null, n = -1;
      for (const [k, c] of Object.entries(rec.teams)) if (c > n) { best = k; n = c; }
      return best;
    };
    // minutes by quarter: rebuild lineups from substitutions + activity
    let prevEnd = new Set();
    const onNow = new Set();
    const pers = [...byPer.keys()].sort((a, b) => a - b);
    for (const per of pers) {
      const evs = byPer.get(per);
      const entered = new Set();
      const seen = [];
      for (const p of evs) {
        const parts = p.participants || [];
        if (p.type === 'Substitution' && parts.length >= 2) {
          if (!entered.has(parts[1]) && !seen.includes(parts[1])) seen.push(parts[1]);
          entered.add(parts[0]);
        } else {
          for (const id of parts.slice(0, 2)) if (!entered.has(id) && !seen.includes(id)) seen.push(id);
        }
      }
      const byTeam = {};
      for (const id of seen) {
        const rec = P.get(id); if (!rec) continue;
        const t = teamOf(rec); if (!t) continue;
        byTeam[t] = byTeam[t] || [];
        if (byTeam[t].length < 5) byTeam[t].push(id);
      }
      for (const id of prevEnd) {
        const rec = P.get(id); if (!rec) continue;
        const t = teamOf(rec); if (!t) continue;
        byTeam[t] = byTeam[t] || [];
        if (byTeam[t].length < 5 && !entered.has(id) && !byTeam[t].includes(id)) byTeam[t].push(id);
      }
      const on = new Map();
      for (const ids of Object.values(byTeam)) for (const id of ids) on.set(id, periodLen(per));
      for (const p of evs) {
        const parts = p.participants || [];
        if (p.type === 'Substitution' && parts.length >= 2) {
          const c = clockSec(p.clock);
          if (on.has(parts[1])) { const rec = pl(parts[1]); rec.q[per] = (rec.q[per] || 0) + on.get(parts[1]) - c; on.delete(parts[1]); }
          on.set(parts[0], c);
        }
      }
      const endC = per === curPeriod ? clockSec(curClock) : 0;
      for (const [id, c] of on) { const rec = pl(id); rec.q[per] = (rec.q[per] || 0) + Math.max(c - endC, 0); }
      prevEnd = new Set(on.keys());
      if (per === curPeriod) for (const id of on.keys()) onNow.add(id);
    }
    const players = {};
    for (const rec of P.values()) {
      const t = teamOf(rec);
      if (!rec.name || !t) continue;
      const qmin = {};
      let sec = 0;
      for (const [q, s] of Object.entries(rec.q)) { qmin[q] = s / 60; sec += s; }
      players[rec.pid] = { ...rec, team: t, min: sec / 60, qmin, on: onNow.has(rec.pid) };
      delete players[rec.pid].teams;
      delete players[rec.pid].q;
    }
    for (const abbr of Object.keys(T)) { const t = T[abbr]; t.poss = t.fga + 0.44 * t.fta - t.oreb + t.tov; }
    return { players, teams: T };
  }

  /** Turn a finished game's plays into a compact log entry (what we cache on the phone). */
  function logEntry(game, plays) {
    const st = gameState(game);
    const { players, teams } = boxFromPlays(plays, st.period, '0:00');
    const rows = {};
    for (const [pid, r] of Object.entries(players)) {
      if (r.min <= 0) continue;
      rows[pid] = { name: r.name, team: r.team, min: +r.min.toFixed(2), qmin: Object.fromEntries(Object.entries(r.qmin).map(([k, v]) => [k, +v.toFixed(2)])),
        pts: r.pts, reb: r.reb, ast: r.ast, fg3m: r.fg3m, fg3a: r.fg3a, fga: r.fga, fta: r.fta, ftm: r.ftm, tov: r.tov, pf: r.pf };
    }
    return {
      id: st.id, date: game.date, v: st.v, h: st.h, len: 48 + 5 * Math.max(0, st.period - 4),
      margin: { [st.v]: st.vs - st.hs, [st.h]: st.hs - st.vs },
      teams, rows,
    };
  }

  // ---------------------------------------------------------------- priors (DataBallr season stats)
  /** Keep only what the model needs from /v1/nba/players/stats (≈5 MB → ≈100 KB). */
  function slimStats(rows) {
    const out = {};
    for (const r of rows || []) {
      const gp = r.GamesPlayed || 0, mpg = r.MPG || 0;
      if (!gp || !mpg || !r.Name) continue;
      const offPoss = r.OffPoss || 0;
      const fg3a = ((r['3PA_100'] || 0) * offPoss) / 100;
      out[norm(r.Name)] = {
        name: r.Name, team: r.TeamAbbreviation, gp, mpg,
        pts: (r.basic_PPG || 0) / mpg, reb: (r.basic_REB || 0) / mpg, ast: (r.basic_APG || 0) / mpg,
        fg3m: (fg3a * (r['3P_PERC'] || 0)) / gp / mpg,
        fg3a: fg3a, p3: r['3P_PERC'], p2: r['2P_PERC'], ft: r.FT_PERC,
        tsa100: r.TSA100, tovpg: r.basic_TOVPG, offPoss, r3: r['3PR'], ftr: r.FTR, age: r.Age,
      };
    }
    return out;
  }

  /** Blend this season's DataBallr line (once it has games) with last season's. */
  function mergePrior(last, cur) {
    if (!cur || cur.gp < 3) return last || null;
    if (!last) return cur;
    const w = cur.gp / (cur.gp + 12);
    const mix = (k) => (cur[k] == null ? last[k] : last[k] == null ? cur[k] : w * cur[k] + (1 - w) * last[k]);
    const out = { ...last };
    for (const k of ['pts', 'reb', 'ast', 'fg3m', 'mpg', 'p3', 'p2', 'ft', 'tsa100', 'r3', 'ftr']) out[k] = mix(k);
    out.fg3a = (cur.fg3a || 0) + (last.fg3a || 0);
    // turnovers per own possession, blended, then re-expressed on last season's scale
    const tovRate = (x) => (x && x.offPoss && x.gp ? (x.tovpg || 0) / (x.offPoss / x.gp) : null);
    const tr = tovRate(cur) != null && tovRate(last) != null ? w * tovRate(cur) + (1 - w) * tovRate(last) : tovRate(last);
    if (tr != null && last.offPoss && last.gp) out.tovpg = tr * (last.offPoss / last.gp);
    return out;
  }

  // ---------------------------------------------------------------- team context from season logs
  function teamContext(logs, abbr) {
    const c = { g: 0, poss: 0, oppPts: 0, oppPoss: 0, o3a: 0, o3m: 0, oFga: 0, plays: 0, ownPoss: 0, ownPts: 0, mins: 0 };
    for (const lg of logs) {
      if (!lg.teams[abbr]) continue;
      const opp = Object.keys(lg.teams).find((x) => x !== abbr);
      if (!opp) continue;
      const O = lg.teams[opp], M = lg.teams[abbr];
      c.g++; c.poss += (M.poss + O.poss) / 2; c.oppPts += O.pts; c.oppPoss += O.poss; c.mins += lg.len || 48;
      c.o3a += O.fg3a; c.o3m += O.fg3m; c.oFga += O.fga;
      c.plays += M.fga + 0.44 * M.fta + M.tov; c.ownPoss += M.poss; c.ownPts += M.pts;
    }
    const k = c.g / (c.g + 8);
    const drtg = c.oppPoss ? (100 * c.oppPts) / c.oppPoss : LEAGUE.ortg;
    const o3p = c.o3a ? c.o3m / c.o3a : LEAGUE.p3;
    return {
      games: c.g,
      pace: c.g ? (c.poss / c.mins) * 48 : LEAGUE.pace, // per 48 minutes (OT games don't inflate it)
      drtg, opp3p: o3p,
      p3f: 1 + k * 0.5 * (o3p / LEAGUE.p3 - 1),
      p2f: 1 + k * 0.5 * (drtg / LEAGUE.ortg - 1),
      // offensive rebounds give extra shots: plays (FGA + .44 FTA + TOV) per possession
      playsPerPoss: c.ownPoss > 0 ? clamp(c.plays / c.ownPoss, 1.03, 1.2) : 1.1,
      // net rating per 100 possessions, shrunk toward 0 for small samples
      net: c.g ? (c.g / (c.g + 10)) * ((100 * (c.ownPts - c.oppPts)) / Math.max((c.ownPoss + c.oppPoss) / 2, 1)) : 0,
    };
  }

  /** How this coach treats starters' 4th-quarter minutes in blowouts (learned, with defaults). */
  function coachHabits(logs, abbr) {
    const mins = {};
    for (const lg of logs) for (const r of Object.values(lg.rows)) if (r.team === abbr) {
      (mins[r.name] = mins[r.name] || []).push(r.min);
    }
    const starters = new Set(Object.entries(mins).filter(([, a]) => mean(a) >= 24).map(([n]) => n));
    const q4 = { close: [], lead: [], trail: [] };
    for (const lg of logs) {
      if (!(abbr in lg.margin)) continue;
      const m = lg.margin[abbr];
      const s = Object.values(lg.rows).filter((r) => r.team === abbr && starters.has(r.name)).map((r) => r.qmin[4] || 0);
      if (!s.length) continue;
      const bucket = Math.abs(m) <= 10 ? 'close' : m >= 18 ? 'lead' : m <= -18 ? 'trail' : null;
      if (bucket) q4[bucket].push(mean(s));
    }
    const close = q4.close.length ? mean(q4.close) : 8;
    const lead = q4.lead.length ? clamp(mean(q4.lead) / Math.max(close, 1), 0.02, 1.1) : 0.3;
    const trail = q4.trail.length ? clamp(mean(q4.trail) / Math.max(close, 1), 0.1, 1.2) : 0.75;
    return { lead, trail, samples: { close: q4.close.length, lead: q4.lead.length, trail: q4.trail.length } };
  }

  // ---------------------------------------------------------------- the projection
  const LADDERS = {
    pts: [5, 10, 15, 20, 25, 30, 35, 40, 45],
    reb: [2, 4, 6, 8, 10, 12, 14, 16],
    ast: [2, 4, 6, 8, 10, 12],
    fg3m: [1, 2, 3, 4, 5, 6],
    pra: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  };

  /**
   * @param {object} o
   *   game     DataBallr live-games row
   *   plays    play-by-play rows for this game ([] pregame)
   *   logs     logEntry[] of both teams' recent finished games
   *   priors   { last: slimStats(prev season), cur: slimStats(this season) }
   *   injuries DataBallr injury rows for the date
   *   nsims    simulations (default 2000)
   */
  function projectGame(o) {
    const st = gameState(o.game);
    const { v, h } = st;
    const N = o.nsims || 2000;
    const R = makeSampler(o.seed || st.id || 7);
    const logs = (o.logs || []).filter((l) => l.v === v || l.h === v || l.v === h || l.h === h);
    const last = (o.priors && o.priors.last) || {};
    const cur = (o.priors && o.priors.cur) || {};
    const out = (o.injuries || []).filter((x) => /^(out|doubtful)/i.test(x.status || ''));
    const outIds = new Set(out.map((x) => x.player && x.player.id));
    const shaky = new Map((o.injuries || []).filter((x) => /^(questionable|day|gtd|game.?time)/i.test(x.status || '')).map((x) => [x.player && x.player.id, x.status]));
    const gameDate = String(o.game.date || o.game.datetime || '').slice(0, 10);
    const ctx = { [v]: teamContext(logs, v), [h]: teamContext(logs, h) };
    const habits = { [v]: coachHabits(logs, v), [h]: coachHabits(logs, h) };
    const now = boxFromPlays(o.plays || [], st.period, st.clock);
    const left = st.left;
    const el = st.elapsed;

    // roster: tonight's box + (pregame / not yet checked in) recent rotation minus injured
    const hist = {};
    for (const lg of logs.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      for (const [pid, r] of Object.entries(lg.rows)) if (r.team === v || r.team === h) (hist[pid] = hist[pid] || []).push({ ...r, margin: lg.margin[r.team], date: lg.date });
    }
    const roster = {};
    for (const [pid, r] of Object.entries(now.players)) if (r.team === v || r.team === h) roster[pid] = r;
    // who played in each team's most recent game: a player who missed it is presumed out until he checks in
    const ov = o.overrides || {};
    const forceIn = new Set((ov.in || []).map(Number)), forceOut = new Set((ov.out || []).map(Number));
    const lastPlayed = {};
    for (const tm of [v, h]) {
      const lg = logs.filter((l) => tm in l.margin).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      lastPlayed[tm] = lg ? new Set(Object.entries(lg.rows).filter(([, r]) => r.team === tm && r.min > 0).map(([id]) => +id)) : null;
    }
    const absent = [];
    const doubt = {}; // pid -> reason (still projected, but availability is shaky)
    const b2b = {};
    for (const tm of [v, h]) b2b[tm] = !!gameDate && logs.some((l) => tm in l.margin && String(l.date).slice(0, 10) === addDaysStr(gameDate, -1));
    if (st.phase !== 'final') {
      for (const [pid, hs] of Object.entries(hist)) {
        const lastRow = hs[hs.length - 1];
        const lpA = last[norm(lastRow.name)] || cur[norm(lastRow.name)] || {};
        const avgMin = hs.slice(-3).reduce((a, r) => a + r.min, 0) / Math.min(3, hs.length);
        if (shaky.has(+pid)) doubt[pid] = `${shaky.get(+pid)} on injury report`;
        if (b2b[lastRow.team] && lpA.age >= 31 && avgMin >= 24) doubt[pid] = doubt[pid] || 'back-to-back rest risk';
        if (roster[pid]) continue;
        if (st.phase === 'pre' && TUNE.b2bRestAge > 0 && b2b[lastRow.team] && lpA.age >= TUNE.b2bRestAge && avgMin >= 24 && !forceIn.has(+pid)) {
          absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: 'back-to-back rest' });
          continue;
        }
        if (outIds.has(+pid) || forceOut.has(+pid)) {
          absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: forceOut.has(+pid) ? 'you marked out' : 'injury report' });
          continue;
        }
        const lp0 = lastPlayed[lastRow.team];
        if (lp0 && !lp0.has(+pid) && !forceIn.has(+pid) && avgMin >= 20) {
          if (TUNE.absentMinMpg > 0 && avgMin >= TUNE.absentMinMpg) {
            absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: 'missed last game' });
            continue;
          }
          doubt[pid] = doubt[pid] || 'missed last game';
        }
        const recent = hs.slice(-3);
        const tm = hs[hs.length - 1].team;
        if (tm !== v && tm !== h) continue;
        if (recent.reduce((a, r) => a + r.min, 0) / 3 < 6) continue;
        // a game in progress: starters who haven't checked in early, and anyone by halftime, are out
        if (st.phase === 'live') {
          if (el >= 24) continue;
          if ((el >= TUNE.liveOutMin && avgMin >= 24) || (el >= 18 && avgMin >= 14)) {
            absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: "hasn't checked in" });
            continue;
          }
        }
        roster[pid] = { pid: +pid, name: hs[hs.length - 1].name, team: tm, pts: 0, reb: 0, oreb: 0, ast: 0, fg3m: 0, fg3a: 0, fga: 0, fgm: 0, fta: 0, ftm: 0, tov: 0, pf: 0, tech: 0, ejected: false, min: 0, qmin: {}, on: false, dnpYet: true };
      }
    }

    // live pace / possessions left
    const tNow = now.teams;
    const possNow = ((tNow[v] ? tNow[v].poss : 0) + (tNow[h] ? tNow[h].poss : 0)) / 2;
    const seasonPace = (ctx[v].pace + ctx[h].pace) / 2;
    const livePace = el > 0 ? (possNow * 48) / Math.max(el, 1) : seasonPace;
    const w = el / (el + TUNE.paceK);
    const q4Left = st.phase === 'final' ? 0 : st.period > 4 ? left : Math.min(left, 12);
    const possLeft = (((1 - w) * seasonPace + w * livePace) * (left - q4Left + q4Left * TUNE.q4Pace)) / 48;

    // margin path to the end of Q3 → blowout scenarios
    const toQ3 = Math.max(36 - el, 0);
    const marginNow = st.vs - st.hs;
    const mQ3 = new Float64Array(N);
    // team strength drift (visitor perspective): net-rating gap minus home court, over the minutes to Q3
    const drift = TUNE.drift * (((ctx[v].net - ctx[h].net) / 100) * seasonPace - TUNE.homeAdv) * (toQ3 / 48);
    for (let i = 0; i < N; i++) mQ3[i] = marginNow + drift + R.normal(0, st.phase === 'pre' ? TUNE.preQ3Sd : TUNE.marginK * Math.sqrt(Math.max(toQ3, 0.01)));
    let pBlow = 0, pBig = 0;
    for (let i = 0; i < N; i++) { const a = Math.abs(mQ3[i]); if (a >= 20) pBlow++; if (a >= 15) pBig++; }
    pBlow /= N; pBig /= N;

    const tPlaysNow = {}, tMinNow = {};
    for (const tm of [v, h]) {
      const T = tNow[tm] || { fga: 0, fta: 0, tov: 0 };
      tPlaysNow[tm] = T.fga + 0.44 * T.fta + T.tov;
      tMinNow[tm] = Object.values(now.players).filter((r) => r.team === tm).reduce((a, r) => a + r.min, 0);
    }

    const players = [];
    for (const r of Object.values(roster)) {
      const tm = r.team, opp = tm === v ? h : v;
      const hs = hist[r.pid] || [];
      const n = hs.length;
      const lp = mergePrior(last[norm(r.name)], cur[norm(r.name)]);
      // --- season aggregates from logs
      const a = { plays: 0, on: 0, fga: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, tov: 0, pts: 0, min: 0, reb: 0, ast: 0 };
      for (const lg of logs) {
        const row = lg.rows[r.pid];
        if (!row || row.team !== tm) continue;
        const T = lg.teams[tm]; if (!T) continue;
        const tPlays = T.fga + 0.44 * T.fta + T.tov;
        const tMin = Object.values(lg.rows).filter((x) => x.team === tm).reduce((s, x) => s + x.min, 0);
        if (tMin <= 0) continue;
        a.plays += row.fga + 0.44 * row.fta + row.tov;
        a.on += (tPlays * row.min) / (tMin / 5);
        for (const k of ['fga', 'fg3a', 'fg3m', 'fta', 'ftm', 'tov', 'pts', 'min', 'reb', 'ast']) a[k] += row[k];
      }
      // --- usage
      const usgCur = a.on > 0 ? a.plays / a.on : null;
      let usgPrior = null;
      if (lp && lp.offPoss && lp.gp && lp.tsa100 != null) {
        const tov100 = ((lp.tovpg || 0) / (lp.offPoss / lp.gp)) * 100;
        usgPrior = (lp.tsa100 + tov100) / 100;
      }
      let usg;
      if (usgCur != null && usgPrior) { const wc = a.on / (a.on + TUNE.usgPriorK); usg = wc * usgCur + (1 - wc) * usgPrior; }
      else usg = usgCur != null ? usgCur : usgPrior || 0.16;
      const playsT = r.fga + 0.44 * r.fta + r.tov;
      const onPlaysT = tMinNow[tm] > 0 ? (tPlaysNow[tm] * r.min) / (tMinNow[tm] / 5) : 0;
      const usgT = onPlaysT > 0 ? playsT / onPlaysT : usg;
      const wt = TUNE.tonightW * Math.min(1, r.min / TUNE.tonightRamp);
      const usgB = (1 - wt) * usg + wt * usgT;
      // --- shot mix
      const tot = a.fga + 0.44 * a.fta + a.tov;
      let mix, r3;
      if (tot >= 8) { mix = { fga: a.fga / tot, ft: (0.44 * a.fta) / tot }; r3 = a.fg3a / Math.max(a.fga, 1); }
      else if (lp) { const ftr = lp.ftr || 0.25; mix = { fga: 0.82, ft: 0.44 * ftr * 0.82 }; r3 = lp.r3 != null ? lp.r3 : 0.35; }
      else { mix = { fga: 0.8, ft: 0.08 }; r3 = 0.35; }
      // --- shooting %
      let p3prior = LEAGUE.p3;
      if (lp && lp.p3 != null) { const att = lp.fg3a || 0; p3prior = (lp.p3 * att + LEAGUE.p3 * 60) / (att + 60); }
      const p2prior = lp && lp.p2 != null ? lp.p2 : LEAGUE.p2;
      const ftprior = lp && lp.ft != null ? lp.ft : LEAGUE.ft;
      const f2a = a.fga - a.fg3a, f2m = Math.max((a.pts - 3 * a.fg3m - a.ftm) / 2, 0);
      const d = ctx[opp];
      const p3 = clamp(((a.fg3m + p3prior * TUNE.p3K) / (a.fg3a + TUNE.p3K)) * d.p3f * TUNE.shotEff, 0.15, 0.6);
      const p2 = clamp(((f2m + p2prior * TUNE.p2K) / (f2a + TUNE.p2K)) * d.p2f * TUNE.shotEff, 0.3, 0.75);
      const ft = clamp((a.ftm + ftprior * TUNE.ftK) / (a.fta + TUNE.ftK), 0.4, 0.97);
      // --- reb / ast per minute
      const rate = {};
      for (const k of ['reb', 'ast']) {
        const cur = a.min > 0 ? a[k] / a.min : null;
        const pr = lp ? lp[k] : null;
        let base;
        if (cur != null && pr != null) { const wc = n / (n + 6); base = wc * cur + (1 - wc) * pr; }
        else base = cur != null ? cur : pr != null ? pr : BENCH_RATE[k];
        const tn = r.min > 0 ? r[k] / r.min : base;
        rate[k] = (1 - wt) * base + wt * tn;
      }
      // --- minutes
      const mpg = n ? mean(hs.map((x) => x.min)) : lp ? lp.mpg : 14;
      const qavg = {};
      const closeG = TUNE.closeQ4 ? hs.filter((x) => Math.abs(x.margin) < 15) : hs;
      const qBase = closeG.length >= 2 ? closeG : hs;
      for (const q of [1, 2, 3, 4]) qavg[q] = n ? mean(qBase.map((x) => x.qmin[q] || 0)) : mpg / 4;
      let remCur = 0, remMid = 0, q4 = 0;
      if (st.phase === 'pre') { remMid = qavg[1] + qavg[2] + qavg[3]; q4 = qavg[4]; }
      else if (st.period <= 4) {
        const curLeft = clockSec(st.clock) / 60;
        const playedQ = r.qmin[st.period] || 0;
        const fracQ = Math.min(qavg[st.period] / 12, 1);
        const tf = 12 - curLeft > 1 ? playedQ / (12 - curLeft) : fracQ;
        remCur = curLeft * ((1 - TUNE.qShareTonight) * fracQ + TUNE.qShareTonight * Math.min(tf, 1));
        for (let q = st.period + 1; q <= 3; q++) remMid += qavg[q];
        q4 = st.period < 4 ? qavg[4] : 0;

      } else {
        remCur = (clockSec(st.clock) / 60) * Math.min(mpg / 40, 0.95);
      }
      const starter = mpg >= 24;
      const hab = habits[tm];
      const foul = r.ejected || r.pf >= 6 || forceOut.has(+r.pid) ? 0 : r.pf >= 5 ? 0.65 : r.pf === 4 && st.period <= 3 ? 0.82 : r.pf === 3 && st.period <= 2 ? 0.93 : 1;
      const mins = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const lead = (tm === v ? 1 : -1) * Math.sign(mQ3[i]);
        const am = Math.abs(mQ3[i]);
        let q4i = q4;
        if (am >= 20) q4i = starter ? q4 * (lead > 0 ? hab.lead : hab.trail) : q4 * (lead > 0 ? 1.9 : 1.3);
        else if (am >= 15) q4i = starter ? q4 * (lead > 0 ? (1 + hab.lead) / 2 : 0.9) : q4 * 1.15;
        else if (am < 8 && starter && TUNE.closerQ4 > 0) q4i = Math.max(q4, Math.min(TUNE.closerQ4, 12));
        const shock = clamp(R.normal(1, TUNE.minShock), 0.4, 1.5);
        mins[i] = Math.min((remCur + remMid + q4i) * foul * shock, left);
      }
      players.push({ r, tm, opp, usg: usgB, usgSeason: usgCur, usgTonight: r.min > 0 ? usgT : null, mix, r3, p3, p2, ft, rate, mins, mpg, qavg, starter, n });
    }

    // fill each team's minutes to 5 x time left (bench first, then starters)
    for (const tm of [v, h]) {
      const ps = players.filter((p) => p.tm === tm);
      if (!ps.length) continue;
      const bench = ps.filter((p) => !p.starter), sts = ps.filter((p) => p.starter);
      for (let i = 0; i < N; i++) {
        let tot = 0;
        for (const p of ps) tot += p.mins[i];
        let excess = Math.max(tot - 5 * left, 0);
        // too many minutes (deep rotation / inactive guys): trim bench first, then starters
        for (const group of [bench, sts]) {
          if (excess <= 0) break;
          let have = 0;
          for (const p of group) have += p.mins[i];
          if (have <= 0) continue;
          const take = Math.min(excess, have * 0.95);
          for (const p of group) p.mins[i] -= (take * p.mins[i]) / have;
          excess -= take;
        }
        let deficit = Math.max(5 * left - tot, 0);
        for (const group of [bench, sts]) {
          if (deficit <= 0) break;
          let cap = 0;
          for (const p of group) cap += Math.max(left - p.mins[i], 0);
          if (cap <= 0) continue;
          const give = Math.min(deficit, cap);
          for (const p of group) p.mins[i] += (give * Math.max(left - p.mins[i], 0)) / cap;
          deficit -= give;
        }
      }
    }
    // usage renormalization: each team's on-floor usage averages 20%
    const scale = {};
    for (const tm of [v, h]) {
      const ps = players.filter((p) => p.tm === tm);
      let wm = 0, mm = 0;
      for (const p of ps) { const m = mean(p.mins); wm += p.usg * m; mm += m; }
      scale[tm] = mm > 0 ? clamp(TUNE.usgTarget / (wm / mm), 0.85, 1.2) : 1;
    }

    // simulate
    const results = [];
    const teamPts = { [v]: new Float64Array(N), [h]: new Float64Array(N) };
    for (const p of players) {
      const r = p.r;
      const usg = p.usg * scale[p.tm];
      const sims = { pts: new Int16Array(N), reb: new Int16Array(N), ast: new Int16Array(N), fg3m: new Int16Array(N), fga: new Int16Array(N), fg3a: new Int16Array(N), fta: new Int16Array(N) };
      let minSum = 0;
      for (let i = 0; i < N; i++) {
        const m = p.mins[i];
        minSum += m;
        const lam = left > 0 ? ((possLeft * ctx[p.tm].playsPerPoss * m) / left) * usg : 0;
        const plays = R.poisson(lam);
        const fga = R.binomial(plays, p.mix.fga);
        const fta = R.poisson((lam * p.mix.ft) / 0.44);
        const f3a = R.binomial(fga, Math.min(p.r3, 0.95));
        const f2a = fga - f3a;
        const n3 = clamp(R.normal(p.p3, 0.07), 0.05, 0.75), n2 = clamp(R.normal(p.p2, 0.06), 0.2, 0.85);
        const m3 = R.binomial(f3a, n3), m2 = R.binomial(f2a, n2), mft = R.binomial(fta, p.ft);
        const add = 3 * m3 + 2 * m2 + mft;
        sims.pts[i] = r.pts + add;
        sims.fg3m[i] = r.fg3m + m3;
        sims.fga[i] = r.fga + fga;
        sims.fg3a[i] = r.fg3a + f3a;
        sims.fta[i] = r.fta + fta;
        sims.reb[i] = r.reb + R.negbin(p.rate.reb * m, VAR_K.reb);
        sims.ast[i] = r.ast + R.negbin(p.rate.ast * m, VAR_K.ast);
        teamPts[p.tm][i] += add;
      }
      const pra = new Int16Array(N);
      for (let i = 0; i < N; i++) pra[i] = sims.pts[i] + sims.reb[i] + sims.ast[i];
      sims.pra = pra;
      const avg = {};
      for (const k of Object.keys(sims)) { let s = 0; const a = sims[k]; for (let i = 0; i < N; i++) s += a[i]; avg[k] = s / N; }
      const ladders = {};
      for (const [k, steps] of Object.entries(LADDERS)) ladders[k] = steps.map((t) => ({ t, p: probAtLeast(sims[k], t) }));
      const flags = [];
      if (r.pf >= 5) flags.push('foul5');
      else if (r.pf >= 4 && st.period <= 3) flags.push('foul4');
      else if (r.pf >= 3 && st.period <= 2) flags.push('foul3');
      if (r.ejected || forceOut.has(+r.pid)) flags.push('out');
      if (r.min >= 8 && p.n) {
        const seasonRate = p.n ? mean((hist[r.pid] || []).map((x) => x.pts / Math.max(x.min, 1))) : 0;
        if (seasonRate > 0 && r.pts / r.min > seasonRate * 1.4) flags.push('hot');
        else if (seasonRate > 0 && r.min >= 12 && r.pts / r.min < seasonRate * 0.5) flags.push('cold');
      }
      if (p.starter && pBlow >= 0.3 && st.phase === 'live') flags.push('sitrisk');
      if (doubt[r.pid] && st.phase === 'pre') flags.push('doubt');
      results.push({
        pid: r.pid, name: r.name, team: p.tm, opp: p.opp, on: r.on, starter: p.starter, dnpYet: !!r.dnpYet,
        now: { pts: r.pts, reb: r.reb, ast: r.ast, fg3m: r.fg3m, fg3a: r.fg3a, fga: r.fga, fgm: r.fgm, fta: r.fta, ftm: r.ftm, tov: r.tov, pf: r.pf, min: r.min },
        proj: { ...avg, min: r.min + minSum / N },
        usage: { season: p.usgSeason, tonight: p.usgTonight, proj: usg },
        shooting: { p2: p.p2, p3: p.p3, ft: p.ft, r3: p.r3 },
        mpg: p.mpg, qavg: p.qavg, games: p.n, flags, ladders, doubt: st.phase === 'pre' ? doubt[r.pid] || null : null,
        _sims: sims,
      });
    }
    results.sort((x, y) => y.proj.pts - x.proj.pts);
    let vWin = 0;
    for (let i = 0; i < N; i++) if (st.vs + teamPts[v][i] > st.hs + teamPts[h][i]) vWin++;
    const projScore = { [v]: st.vs + mean(Array.from(teamPts[v])), [h]: st.hs + mean(Array.from(teamPts[h])) };
    return {
      state: st, players: results, projScore, winProb: { [v]: vWin / N, [h]: 1 - vWin / N },
      blowout: { now: isBlowout(st), pBlow, pBig }, possLeft, pace: { season: seasonPace, live: livePace },
      context: ctx, habits, injuries: out, absent, b2b, sims: N,
    };
  }

  function probAtLeast(arr, t) {
    let c = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] >= t) c++;
    return c / arr.length;
  }
  /** P(over a posted line): half-point lines need floor(line)+1. */
  function probOver(arr, line) {
    const t = Number.isInteger(line) ? line + 1 : Math.floor(line) + 1;
    return probAtLeast(arr, t);
  }

  // ---------------------------------------------------------------- market lines (DataBallr props)
  const PROP_MAP = { points: 'pts', rebounds: 'reb', assists: 'ast', threes: 'fg3m', points_rebounds_assists: 'pra' };
  const implied = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
  function consensusLines(props) {
    const by = {};
    for (const x of props || []) {
      const stat = PROP_MAP[x.prop_type];
      if (!stat || !x.market || x.market.type !== 'over_under') continue;
      const key = x.player_id + ':' + stat;
      (by[key] = by[key] || []).push(x);
    }
    const out = {};
    for (const [key, xs] of Object.entries(by)) {
      const lines = xs.map((x) => parseFloat(x.line_value)).filter(Number.isFinite).sort((a, b) => a - b);
      if (!lines.length) continue;
      const med = lines[Math.floor(lines.length / 2)];
      const at = xs.filter((x) => parseFloat(x.line_value) === med);
      const fair = mean(at.map((x) => { const io = implied(x.market.over_odds), iu = implied(x.market.under_odds); return io / (io + iu); }));
      const [pid, stat] = key.split(':');
      out[key] = { pid: +pid, stat, line: med, fairOver: fair, books: at.length };
    }
    return out;
  }

  // ---------------------------------------------------------------- picks + combos
  const STAT_LABEL = { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', pra: 'PRA' };

  /** Overs only. With a market line: model % vs no-vig market %. Without: the highest safe ladder rung. */
  function picksForGame(proj, lines, opts = {}) {
    const minP = opts.minP != null ? opts.minP : 0.6;
    const picks = [];
    if (proj.state.phase === 'final') return picks;
    for (const p of proj.players) {
      if (p.flags.includes('out')) continue;
      let used = false;
      for (const stat of ['pts', 'reb', 'ast', 'fg3m', 'pra']) {
        const L = lines && lines[p.pid + ':' + stat];
        if (L) {
          const prob = probOver(p._sims[stat], L.line);
          const edge = prob - L.fairOver;
          if (prob >= minP && edge >= 0.03) {
            picks.push({ gameId: proj.state.id, game: `${proj.state.v} @ ${proj.state.h}`, pid: p.pid, name: p.name, team: p.team, stat, label: `${L.line} ${STAT_LABEL[stat]}`, line: L.line, kind: 'line', prob, market: L.fairOver, edge, proj: p.proj[stat], now: p.now[stat] ?? (p.now.pts + p.now.reb + p.now.ast) });
            used = true;
          }
        }
      }
      if (!used && (p.proj.min >= 20 || p.now.min >= 12)) {
        // safest meaningful rung: highest threshold still >= 75%, above what he already has
        for (const stat of ['pts', 'reb', 'ast', 'fg3m']) {
          const nowV = p.now[stat];
          const rungs = p.ladders[stat].filter((x) => x.p >= 0.75 && x.t > nowV);
          if (!rungs.length) continue;
          const best = rungs[rungs.length - 1];
          const minRung = { pts: 10, reb: 4, ast: 4, fg3m: 2 }[stat];
          if (best.t < minRung) continue;
          picks.push({ gameId: proj.state.id, game: `${proj.state.v} @ ${proj.state.h}`, pid: p.pid, name: p.name, team: p.team, stat, label: `${best.t}+ ${STAT_LABEL[stat]}`, line: best.t - 0.5, kind: 'rung', prob: best.p, market: null, edge: null, proj: p.proj[stat], now: nowV });
        }
      }
    }
    return picks.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0) || b.prob - a.prob);
  }

  /** 2-leg overs tickets at a payout multiple (default 3x ≈ +200). */
  function buildCombos(picks, opts = {}) {
    const payout = opts.payout || 3;
    const be = 1 / payout;
    const legs = picks.slice().sort((a, b) => b.prob - a.prob).slice(0, 40);
    const pairs = [];
    for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i], b = legs[j];
      if (a.pid === b.pid) continue;
      const same = a.gameId === b.gameId;
      const joint = a.prob * b.prob * (same ? 0.97 : 1);
      if (joint < be) continue;
      pairs.push({ legs: [a, b], joint, ev: joint * payout - 1, sameGame: same });
    }
    pairs.sort((x, y) => (x.sameGame - y.sameGame) || y.ev - x.ev);
    const max = opts.max || 6;
    const repeats = pairs.slice(0, max);
    const once = [];
    const used = new Set();
    for (const c of pairs) {
      if (c.legs.some((l) => used.has(l.pid))) continue;
      once.push(c);
      c.legs.forEach((l) => used.add(l.pid));
      if (once.length >= max) break;
    }
    return { once, repeats, breakEven: be, payout };
  }

  return {
    LEAGUE, TUNE, LADDERS, STAT_LABEL, makeSampler, clockSec, elapsedSec, norm, gameState, isBlowout,
    boxFromPlays, logEntry, slimStats, mergePrior, teamContext, coachHabits, projectGame, probAtLeast, probOver,
    consensusLines, picksForGame, buildCombos,
  };
});
