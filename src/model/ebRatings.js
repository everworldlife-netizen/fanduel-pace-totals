/**
 * eBasketball (H2H GG League 4x5) player + team scoring ratings.
 *
 * Model (per side):   pts(A vs B) = mu + off[A] + def[B] + teamOff[teamA] + teamDef[teamB]
 * Game total       :   pts(A vs B) + pts(B vs A)
 *
 * Fitted by recency-weighted ridge regression (alternating least squares).
 * Ridge strength is expressed in "games": a player with few games is pulled
 * toward league average. Inputs are official H2H GG League final scores.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS = {
  halfLifeDays: 10,
  ridgePlayer: 6,
  ridgeTeam: 40,
  iterations: 30,
  useTeams: true,
};

function normPlayer(name) {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normTeam(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {Array<{a:string,b:string,sa:number,sb:number,t:number,teamA?:string,teamB?:string}>} games
 * @param {object} opts
 */
function fitRatings(games, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const now = opts.now || Math.max(...games.map((g) => g.t || 0), Date.now() - 365 * DAY_MS);
  const rows = [];
  for (const g of games) {
    const a = normPlayer(g.a);
    const b = normPlayer(g.b);
    if (!a || !b || !Number.isFinite(g.sa) || !Number.isFinite(g.sb)) continue;
    const age = Math.max(0, (now - (g.t || now)) / DAY_MS);
    const w = Math.pow(0.5, age / cfg.halfLifeDays);
    const ta = cfg.useTeams ? normTeam(g.teamA) : '';
    const tb = cfg.useTeams ? normTeam(g.teamB) : '';
    rows.push({ p: a, q: b, tp: ta, tq: tb, s: g.sa, w });
    rows.push({ p: b, q: a, tp: tb, tq: ta, s: g.sb, w });
  }
  const off = new Map();
  const def = new Map();
  const tOff = new Map();
  const tDef = new Map();
  const get = (m, k) => m.get(k) || 0;
  let sw = 0;
  let ss = 0;
  for (const r of rows) {
    sw += r.w;
    ss += r.w * r.s;
  }
  let mu = sw ? ss / sw : 55;

  for (let it = 0; it < cfg.iterations; it += 1) {
    // mu
    let num = 0;
    for (const r of rows) num += r.w * (r.s - get(off, r.p) - get(def, r.q) - get(tOff, r.tp) - get(tDef, r.tq));
    mu = sw ? num / sw : mu;
    // player offense
    const accO = new Map();
    for (const r of rows) {
      const res = r.s - mu - get(def, r.q) - get(tOff, r.tp) - get(tDef, r.tq);
      const cur = accO.get(r.p) || [0, 0];
      cur[0] += r.w * res;
      cur[1] += r.w;
      accO.set(r.p, cur);
    }
    for (const [k, [n, d]] of accO) off.set(k, n / (d + cfg.ridgePlayer));
    // player defense (points allowed above average)
    const accD = new Map();
    for (const r of rows) {
      const res = r.s - mu - get(off, r.p) - get(tOff, r.tp) - get(tDef, r.tq);
      const cur = accD.get(r.q) || [0, 0];
      cur[0] += r.w * res;
      cur[1] += r.w;
      accD.set(r.q, cur);
    }
    for (const [k, [n, d]] of accD) def.set(k, n / (d + cfg.ridgePlayer));
    if (cfg.useTeams) {
      const accTO = new Map();
      const accTD = new Map();
      for (const r of rows) {
        if (r.tp) {
          const res = r.s - mu - get(off, r.p) - get(def, r.q) - get(tDef, r.tq);
          const cur = accTO.get(r.tp) || [0, 0];
          cur[0] += r.w * res;
          cur[1] += r.w;
          accTO.set(r.tp, cur);
        }
      }
      for (const [k, [n, d]] of accTO) tOff.set(k, n / (d + cfg.ridgeTeam));
      for (const r of rows) {
        if (r.tq) {
          const res = r.s - mu - get(off, r.p) - get(def, r.q) - get(tOff, r.tp);
          const cur = accTD.get(r.tq) || [0, 0];
          cur[0] += r.w * res;
          cur[1] += r.w;
          accTD.set(r.tq, cur);
        }
      }
      for (const [k, [n, d]] of accTD) tDef.set(k, n / (d + cfg.ridgeTeam));
    }
  }

  // residual spread for uncertainty
  let rss = 0;
  let rw = 0;
  const players = {};
  const counts = new Map();
  for (const g of games) {
    for (const [p, f, a] of [[normPlayer(g.a), g.sa, g.sb], [normPlayer(g.b), g.sb, g.sa]]) {
      if (!p) continue;
      const c = counts.get(p) || { n: 0, f: 0, a: 0, last: 0 };
      c.n += 1;
      c.f += f;
      c.a += a;
      c.last = Math.max(c.last, g.t || 0);
      counts.set(p, c);
    }
  }
  for (const [p, c] of counts) {
    players[p] = {
      off: round2(get(off, p)),
      def: round2(get(def, p)),
      n: c.n,
      avgFor: round1(c.f / c.n),
      avgAgainst: round1(c.a / c.n),
      avgTotal: round1((c.f + c.a) / c.n),
      last: c.last,
    };
  }
  const teams = {};
  for (const k of new Set([...tOff.keys(), ...tDef.keys()])) {
    teams[k] = { off: round2(get(tOff, k)), def: round2(get(tDef, k)) };
  }
  const model = { mu: round2(mu), players, teams, cfg: { ...cfg, now: undefined } };
  for (const g of games) {
    const pred = predictGame(model, g);
    const actual = g.sa + g.sb;
    if (!Number.isFinite(actual)) continue;
    rss += (actual - pred.total) ** 2;
    rw += 1;
  }
  model.totalSd = rw ? round2(Math.sqrt(rss / rw)) : 14;
  model.games = rw;
  model.updatedAt = new Date().toISOString();
  return model;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Expected points for both sides and the total.
 * @param {object} model output of fitRatings
 * @param {{a:string,b:string,teamA?:string,teamB?:string}} g
 */
function predictGame(model, g) {
  const mu = model?.mu ?? 55;
  const pa = model?.players?.[normPlayer(g.a)];
  const pb = model?.players?.[normPlayer(g.b)];
  const ta = model?.teams?.[normTeam(g.teamA)];
  const tb = model?.teams?.[normTeam(g.teamB)];
  const ea = mu + (pa?.off || 0) + (pb?.def || 0) + (ta?.off || 0) + (tb?.def || 0);
  const eb = mu + (pb?.off || 0) + (pa?.def || 0) + (tb?.off || 0) + (ta?.def || 0);
  const known = Boolean(pa) + Boolean(pb);
  const minGames = Math.min(pa?.n || 0, pb?.n || 0);
  return {
    a: round1(ea),
    b: round1(eb),
    total: round1(ea + eb),
    margin: round1(ea - eb),
    known,
    minGames,
  };
}

/** Convert raw H2H schedule rows into rating inputs. */
function gamesFromSchedule(rows) {
  const out = [];
  for (const m of rows || []) {
    if (!m || m.isCancelled) continue;
    if (m.matchStatus !== 'MATCH_ENDED') continue;
    const sa = Number(m.teamAScore);
    const sb = Number(m.teamBScore);
    if (!Number.isFinite(sa) || !Number.isFinite(sb)) continue;
    if (sa + sb < 40) continue; // abandoned / partial
    out.push({
      id: m.externalId,
      a: m.participantAName,
      b: m.participantBName,
      teamA: m.teamAName,
      teamB: m.teamBName,
      sa,
      sb,
      t: Date.parse(m.startDate) || 0,
      stream: m.streamName,
    });
  }
  return out;
}

module.exports = {
  fitRatings,
  predictGame,
  gamesFromSchedule,
  normPlayer,
  normTeam,
  DEFAULTS,
};
