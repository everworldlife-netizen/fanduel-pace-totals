/**
 * Live projection engine for FanDuel eBasketball (H2H GG League, 4 x 5-minute quarters).
 *
 * Calibration (Nov 2026, 5,246 official H2H finals + 122 play-by-play timelines):
 *   - Player+team ratings predict the final total with RMSE 12.2 (league-average baseline 15.2).
 *   - Live pace is weak information in eBasketball: the best live projection treats the
 *     pregame number as worth ~1.5 games of observed scoring (n0 = 1.5).
 *     Pure pace at 25% played misses by 17 pts; this blend misses by 10.5.
 *   - Quarter scoring shares: Q1 25.5%, Q2 24.7%, Q3 24.3%, Q4 24.9%.
 *   - Real time vs the official game clock (FanDuel live scores aligned to H2H play-by-play,
 *     806 points / 8 games): 25% played at ~6.3 min after tip, 50% ~12.5, 75% ~19.5,
 *     final ~25.5-26. FanDuel opens each quarter's markets ~1.5 min after it starts.
 *   - Recalibrated Nov 5 on replayed live games vs official finals: FanDuel's live line
 *     over-reacts to early pace, while the gamers' pregame scoring level holds. A strong
 *     prior (n0 = 6 games) beats the pace-heavy setting at every stage of the game.
 *   - The number we show ("GG projection") blends our model with FanDuel's line, weighted
 *     by how accurate each is at that stage (phaseWeights). It beats both on its own.
 *   - Calls: GG projection 2+ points off the line, price still pays, not after ~85% played,
 *     and never on a 10+ point disagreement (that usually means the ratings are off).
 */

const DEFAULT_PARAMS = {
  n0: 6,
  sdStart: 12.2,
  sdEnd: 4.5,
  quarterShare: [0.2546, 0.2467, 0.2425, 0.2486],
  // [minutes after tip, game fraction]
  knots: [[0, 0], [0.5, 0.032], [2.5, 0.119], [5.5, 0.241], [8.5, 0.35], [12.5, 0.5], [15.5, 0.617],
    [18.5, 0.729], [20.5, 0.775], [23.5, 0.905], [25.5, 0.981], [26.3, 1]],
  regulationMinutes: 26.3,
  modelWeight: 0.5,
  // Trust in our model vs FanDuel's line by stage: [pregame, Q1, Q2-Q3 (25-75%), Q4 (75-90%), final minutes]
  phaseWeights: [0.85, 0.45, 0.6, 0.35, 0.9],
  lineWeight: 1,
  pairShrink: 15,
  edgeMin: 2,
  maxRawGap: 10,
  evMin: 0.03,
  maxProgressForSignal: 0.85,
  defaultMu: 54.9,
};

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function americanToDecimal(a) {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

function impliedProb(a) {
  const d = americanToDecimal(a);
  return d ? 1 / d : null;
}

/** No-vig probability of the Over from a two-way price. */
function noVigOver(overOdds, underOdds) {
  const po = impliedProb(overOdds);
  const pu = impliedProb(underOdds);
  if (po == null || pu == null) return null;
  return po / (po + pu);
}

/**
 * Game fraction played (0..1) from minutes since tip, using calibrated knots,
 * then clamped to the quarter FanDuel is currently offering markets for.
 */
function progressFromTime(minutes, { quarterHint = null, params = DEFAULT_PARAMS } = {}) {
  const k = params.knots;
  let f;
  if (!Number.isFinite(minutes) || minutes <= k[0][0]) f = 0;
  else if (minutes >= k[k.length - 1][0]) f = 1;
  else {
    f = 1;
    for (let i = 1; i < k.length; i += 1) {
      if (minutes <= k[i][0]) {
        const [x0, y0] = k[i - 1];
        const [x1, y1] = k[i];
        f = y0 + ((minutes - x0) / (x1 - x0)) * (y1 - y0);
        break;
      }
    }
  }
  let source = 'clock-estimate';
  if (quarterHint && quarterHint >= 1 && quarterHint <= 4) {
    // Quarter-q markets open ~0.05 into the quarter and can linger (suspended) ~0.07 into the next.
    const lo = (quarterHint - 1) / 4 + 0.03;
    const hi = quarterHint / 4 + 0.08;
    const clamped = clamp(f, lo, hi);
    if (clamped !== f) source = 'quarter-corrected';
    else source = 'quarter-confirmed';
    f = clamped;
  }
  return { f: clamp(f, 0, 1), source };
}

/**
 * Game-progress window implied by FanDuel's quarter markets (calibrated against the
 * official play-by-play clock). Quarter-q markets open ~0.05 into the quarter, the
 * spread suspends first, then the winner, then the total; a lone suspended spread
 * lingers through the break into the next quarter.
 */
function quarterBounds(state) {
  if (!state || !state.q) return null;
  const b = (state.q - 1) / 4;
  const { h, t, w } = state;
  const open = [h, t, w].filter((x) => x === 'open').length;
  // Only the leftover suspended spread = end of quarter / break. Everything listed but
  // suspended at once is a temporary pause (timeout, review) and says nothing.
  if (open === 0) return h && !t && !w ? { lo: b + 0.17, hi: b + 0.33, med: b + 0.25, label: 'late quarter / break' } : null;
  if (h === 'open') return { lo: b + 0.03, hi: b + 0.13, med: b + 0.095, label: 'early quarter' };
  if (t === 'open' && w === 'open') return { lo: b + 0.09, hi: b + 0.165, med: b + 0.13, label: 'mid quarter' };
  if (t === 'open') return { lo: b + 0.13, hi: b + 0.225, med: b + 0.175, label: 'late quarter' };
  if (w === 'open') return { lo: b + 0.04, hi: b + 0.2, med: b + 0.12, label: 'mid quarter' };
  return null;
}

/**
 * Combine the wall-clock estimate with the score-implied progress (S / expected),
 * precision-weighted. Time dominates when the tip is known; the score takes over
 * when FanDuel has not published the real tip time yet.
 */
function estimateProgress({ minutes, tipKnown = true, S = 0, expected = 110, quarterHint = null, quarterState = null, params = DEFAULT_PARAMS }) {
  const t = progressFromTime(minutes, { params });
  const exp = Math.max(expected || 110, 60);
  const fs = clamp(S / exp, 0, 1.05);
  const sdT = tipKnown ? 0.025 + 0.0015 * Math.max(minutes, 0) : 0.2;
  const sdS = Math.sqrt(Math.max(S, 1) * 2.4) / exp + 0.1 * fs;
  const wt = 1 / (sdT * sdT);
  const ws = 1 / (sdS * sdS);
  let f = (t.f * wt + fs * ws) / (wt + ws);
  let source = tipKnown ? 'clock-estimate' : 'score-estimate';
  const qb = quarterBounds(quarterState);
  if (qb) {
    const clamped = clamp(f, qb.lo, qb.hi);
    source = clamped !== f ? 'market-corrected' : 'market-confirmed';
    f = clamped;
    return { f: clamp(f, 0, 1), source, timeF: round3(t.f), scoreF: round3(fs), window: qb.label };
  }
  if (quarterHint && quarterHint >= 1 && quarterHint <= 4) {
    // Quarter-q markets open ~0.05 into the quarter and can linger (suspended) ~0.07 into the next.
    const lo = (quarterHint - 1) / 4 + 0.03;
    const hi = quarterHint / 4 + 0.08;
    const clamped = clamp(f, lo, hi);
    source = clamped !== f ? 'quarter-corrected' : 'quarter-confirmed';
    f = clamped;
  }
  return { f: clamp(f, 0, 1), source, timeF: round3(t.f), scoreF: round3(fs) };
}

/** Share of expected game points between game fractions a and b (quarter-weighted). */
function windowShare(a, b, params = DEFAULT_PARAMS) {
  const lo = clamp(Math.min(a, b), 0, 1);
  const hi = clamp(Math.max(a, b), 0, 1);
  let w = 0;
  for (let q = 0; q < 4; q += 1) {
    const qs = q / 4;
    const qe = (q + 1) / 4;
    const overlap = Math.max(0, Math.min(hi, qe) - Math.max(lo, qs));
    w += params.quarterShare[q] * (overlap / 0.25);
  }
  const total = params.quarterShare.reduce((s, x) => s + x, 0);
  return w / total;
}

/** Bayesian rate: prior worth n0 games, observed points over fraction f. */
function posteriorRate(prior, observed, f, params = DEFAULT_PARAMS) {
  const n0 = params.n0;
  const share = windowShare(0, f, params);
  return (n0 * prior + observed) / (n0 + share);
}

function sdAt(f, { segment = 1, wallClock = true, params = DEFAULT_PARAMS } = {}) {
  const remaining = clamp(1 - f, 0, 1);
  const s0 = params.sdStart * Math.sqrt(segment);
  const s1 = params.sdEnd * Math.sqrt(segment);
  let sd = Math.sqrt(s1 * s1 * Math.min(1, remaining * 4) + (s0 * s0 - s1 * s1) * remaining);
  if (wallClock) sd *= 1.08;
  return Math.max(sd, 1.2);
}

/** Probability the final lands over `line` given projection mean and sd. */
function probOver(mean, sd, line) {
  if (!Number.isFinite(mean) || !Number.isFinite(line)) return null;
  return 1 - normCdf((line - mean) / sd);
}

function evFor(p, americanOdds) {
  const d = americanToDecimal(americanOdds);
  if (p == null || !d) return null;
  return p * (d - 1) - (1 - p);
}

/**
 * Price one over/under market.
 * @returns call Over/Under/Pass with gap, model probability, FanDuel no-vig, EV.
 */
function priceMarket({ mean, sd, market, edgeMin, evMin, allowSignal = true, modelWeight = DEFAULT_PARAMS.modelWeight, maxRawGap = DEFAULT_PARAMS.maxRawGap }) {
  if (!market || !Number.isFinite(market.line)) {
    return { line: null, mean: round1(mean), fair: round1(mean), call: null, gap: null };
  }
  // Our model and FanDuel's line are two estimates of the same final. The GG projection
  // blends them by how accurate each is at this stage; the edge is GG projection - line.
  const w = clamp(modelWeight, 0.05, 0.95);
  const fairMean = w * mean + (1 - w) * market.line;
  const pOver = probOver(fairMean, sd * 0.92, market.line);
  const fair = noVigOver(market.over, market.under);
  const evOver = evFor(pOver, market.over);
  const evUnder = evFor(pOver == null ? null : 1 - pOver, market.under);
  const rawGap = round1(mean - market.line);
  const gap = round1(fairMean - market.line);
  const side = gap > 0 ? 'Over' : 'Under';
  const ev = side === 'Over' ? evOver : evUnder;
  let call = 'Pass';
  let reason = null;
  if (!market.open) reason = 'Market suspended';
  else if (!allowSignal) reason = 'Too early/late for a reliable call';
  else if (Math.abs(rawGap) > maxRawGap) reason = 'Unusually big disagreement — ratings may be off for this pair';
  else if (Math.abs(gap) < edgeMin) reason = `Edge under ${edgeMin} pts`;
  else if (ev == null || ev < evMin) reason = 'Price eats the edge';
  else call = side;
  return {
    line: market.line,
    overOdds: market.over,
    underOdds: market.under,
    open: market.open,
    mean: round1(mean),
    fair: round1(fairMean),
    sd: round1(sd),
    gap,
    rawGap,
    weight: round3(w),
    pOver: pOver == null ? null : round3(pOver),
    fdOver: fair == null ? null : round3(fair),
    evOver: evOver == null ? null : round3(evOver),
    evUnder: evUnder == null ? null : round3(evUnder),
    side,
    ev: ev == null ? null : round3(ev),
    call,
    reason,
  };
}

/** Trust in our model vs FanDuel's line at this stage of the game. */
function phaseWeight(f, started, params = DEFAULT_PARAMS) {
  const w = params.phaseWeights || DEFAULT_PARAMS.phaseWeights;
  if (!started) return w[0];
  if (f < 0.25) return w[1];
  if (f < 0.75) return w[2];
  if (f < 0.9) return w[3];
  return w[4];
}

/**
 * Pregame expectation for a matchup.
 * @param {object} ctx { ratings, profiles, pairs }
 * @param {{away:{player,team}, home:{player,team}}} game
 * @param {object} openLines optional FanDuel opening lines { game }
 */
function pregame(ctx, game, { openingTotal = null, params = DEFAULT_PARAMS } = {}) {
  const { predictGame } = require('./ebRatings');
  const pred = predictGame(ctx?.ratings, {
    a: game.away.player,
    b: game.home.player,
    teamA: game.away.team,
    teamB: game.home.team,
  });
  let away = pred.a;
  let home = pred.b;
  let model = away + home;
  // Head-to-head adjustment, heavily shrunk (raw H2H averages overfit).
  const pairKey = [game.away.player, game.home.player].map((s) => String(s || '').toUpperCase()).sort().join('|');
  const pair = ctx?.pairs?.[pairKey] || null;
  let pairAdj = 0;
  if (pair && pair.n >= 3) {
    pairAdj = pair.resSum / (pair.n + params.pairShrink);
    model += pairAdj;
    away += pairAdj / 2;
    home += pairAdj / 2;
  }
  if (!pred.known) {
    model = (ctx?.ratings?.mu || params.defaultMu) * 2;
    away = model / 2;
    home = model / 2;
  }
  let expected = model;
  let blendNote = 'player ratings';
  if (Number.isFinite(openingTotal) && openingTotal > 50) {
    const w = pred.known === 2 && pred.minGames >= 15 ? params.lineWeight : 0.25;
    expected = w * model + (1 - w) * openingTotal;
    const scale = expected / model;
    away *= scale;
    home *= scale;
    blendNote = `ratings ${Math.round(w * 100)}% / FanDuel opener ${Math.round((1 - w) * 100)}%`;
  }
  return {
    model: round1(model),
    expected: round1(expected),
    away: round1(away),
    home: round1(home),
    known: pred.known,
    minGames: pred.minGames,
    pair: pair ? { n: pair.n, avgTotal: round1(pair.totalSum / pair.n), adj: round1(pairAdj) } : null,
    blendNote,
  };
}

/** Half / quarter shape adjustments from each gamer's profile (shrunk to league shares). */
function pairShares(ctx, game, params = DEFAULT_PARAMS) {
  const base = params.quarterShare;
  const profs = [game.away.player, game.home.player].map((p) => ctx?.profiles?.[String(p || '').toUpperCase()] || null);
  const out = base.slice();
  for (let q = 0; q < 4; q += 1) {
    let num = base[q] * 20;
    let den = 20;
    for (const pr of profs) {
      if (pr && pr.qShare && pr.n) {
        num += pr.qShare[q] * pr.n;
        den += pr.n;
      }
    }
    out[q] = num / den;
  }
  const sum = out.reduce((s, x) => s + x, 0);
  return out.map((x) => x / sum);
}

/**
 * Full live evaluation for one eBasketball game.
 * @param {object} game board row (scores, tipMs, lines)
 * @param {object} ctx { ratings, profiles, pairs, params, openingTotal }
 * @param {object} opts { now, quarterStart: {q, total, away, home} }
 */
function evaluateLive(game, ctx = {}, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(ctx.params || {}) };
  const now = opts.now || Date.now();
  const edgeMin = Number.isFinite(opts.edgeMin) ? opts.edgeMin : params.edgeMin;
  const evMin = Number.isFinite(opts.evMin) ? opts.evMin : params.evMin;
  const lines = game.lines || {};
  const started = game.status === 'live';
  const minutes = started && game.tipMs ? (now - game.tipMs) / 60000 : 0;
  const qHint = started ? lines.quarterHint : null;
  const S = (game.away?.score || 0) + (game.home?.score || 0);
  const shares = pairShares(ctx, game, params);
  const p = { ...params, quarterShare: shares };
  const pre = pregame(ctx, game, { openingTotal: ctx.openingTotal, params });
  // FanDuel moves marketTime to the real tip once the game goes in-play; if it has not
  // moved yet (tip unknown) lean on the score instead of the schedule.
  const tipKnown = !game.scheduledMs || !game.tipMs || game.tipMs !== game.scheduledMs;
  const prog = started
    ? estimateProgress({ minutes, tipKnown, S, expected: pre.expected, quarterHint: qHint, quarterState: lines.quarterState, params })
    : { f: 0, source: 'pregame' };
  let f = prog.f;
  if (started && S > 0 && f < 0.01) f = 0.01;
  const lambda = started ? posteriorRate(pre.expected, S, f, p) : pre.expected;
  const lamAway = started ? posteriorRate(pre.away, game.away.score || 0, f, p) : pre.away;
  const lamHome = started ? posteriorRate(pre.home, game.home.score || 0, f, p) : pre.home;

  const wallClock = prog.source === 'clock-estimate' || prog.source === 'score-estimate';
  const overtime = started && minutes > params.regulationMinutes + 0.6 && Math.abs((game.away?.score || 0) - (game.home?.score || 0)) <= 12
    && Number.isFinite(lines.game?.line) && lines.game.line > S + 1.5;
  const allowSignal = !overtime && f <= params.maxProgressForSignal && (!started || minutes >= 0);
  const modelWeight = phaseWeight(f, started, params);
  const markets = [];

  // Full game
  const gameMean = S + lambda * windowShare(f, 1, p);
  markets.push({
    id: 'game',
    label: 'Game total',
    ...priceMarket({ mean: gameMean, sd: sdAt(f, { wallClock, params }), market: lines.game, edgeMin, evMin, allowSignal, modelWeight }),
  });

  // 1st half (only before halftime)
  if (f < 0.5) {
    const h1Mean = S + lambda * windowShare(f, 0.5, p);
    const segment = windowShare(0, 0.5, p);
    const remainShare = windowShare(f, 0.5, p) / Math.max(segment, 1e-6);
    const sd = Math.max(params.sdStart * Math.sqrt(segment) * Math.sqrt(Math.max(remainShare, 0.04)) * (wallClock ? 1.08 : 1), 1.5);
    const last10 = last10Half(ctx, game);
    markets.push({
      id: 'half1',
      label: '1st half total',
      last10,
      ...priceMarket({ mean: h1Mean, sd, market: lines.half1, edgeMin, evMin, allowSignal: allowSignal && f < 0.42, modelWeight }),
    });
  }

  // Current / next quarter
  const q = started ? Math.min(4, Math.floor(f * 4) + 1) : 1;
  const qStart = (q - 1) / 4;
  const qEnd = q / 4;
  const qShare = windowShare(qStart, qEnd, p);
  const qFull = lambda * qShare;
  let qMean = null;
  let qSoFar = null;
  let qNote = 'Full-quarter expectation (bet right as the quarter opens)';
  const qs = opts.quarterStart;
  if (!started) {
    qMean = qFull;
    qSoFar = 0;
    qNote = 'Pregame Q1 expectation';
  } else if (qs && Number(qs.q) === q && Number.isFinite(Number(qs.total))) {
    qSoFar = Math.max(0, S - Number(qs.total));
    qMean = qSoFar + lambda * windowShare(f, qEnd, p);
    qNote = `Tracked from Q${q} start (${qs.total})`;
  } else if (f - qStart < 0.01) {
    qSoFar = 0;
    qMean = qFull;
  }
  const qMarket = lines.quarters?.[q] || null;
  const qRemain = qShare > 0 ? windowShare(Math.max(f, qStart), qEnd, p) / qShare : 1;
  const qSd = Math.max(params.sdStart * Math.sqrt(qShare) * Math.sqrt(Math.max(qRemain, 0.05)) * 1.1, 1.5);
  markets.push({
    id: `q${q}`,
    label: `Q${q} total`,
    quarter: q,
    full: round1(qFull),
    soFar: qSoFar,
    note: qNote,
    ...(qMean == null
      ? { line: qMarket?.line ?? null, mean: null, call: 'Pass', reason: 'Need quarter start score (keep the game open from the quarter break)', overOdds: qMarket?.over ?? null, underOdds: qMarket?.under ?? null, open: qMarket?.open ?? false }
      : priceMarket({ mean: qMean, sd: qSd, market: qMarket, edgeMin: Math.max(1.5, edgeMin * 0.75), evMin, allowSignal: allowSignal && qRemain > 0.15, modelWeight })),
  });

  // Team totals
  for (const side of ['away', 'home']) {
    const lam = side === 'away' ? lamAway : lamHome;
    const sc = game[side]?.score || 0;
    const mean = sc + lam * windowShare(f, 1, p);
    markets.push({
      id: `${side}Total`,
      label: `${game[side]?.player || side} team total`,
      ...priceMarket({ mean, sd: sdAt(f, { segment: 0.5, wallClock, params }) * 1.05, market: lines[`${side}Total`], edgeMin: edgeMin * 0.75, evMin, allowSignal, modelWeight }),
    });
  }

  const conf = confidence({ f, started, pre, prog, minutes, overtime, margin: (game.away?.score || 0) - (game.home?.score || 0) });
  for (const m of markets) {
    if (m.call && m.call !== 'Pass' && conf.level === 'LOW') {
      m.call = 'Pass';
      m.reason = 'Low confidence';
    }
    m.score = m.call && m.call !== 'Pass' ? round1(Math.abs(m.gap) * (1 + (m.ev || 0) * 4)) : 0;
  }

  return {
    id: game.id,
    progress: { f: round3(f), minutes: round1(minutes), source: overtime ? 'overtime' : prog.source, window: prog.window || null, quarter: started ? q : 0, overtime },
    modelWeight,
    pregame: pre,
    rate: { total: round1(lambda), away: round1(lamAway), home: round1(lamHome), pacePer20: f > 0.05 ? round1(S / windowShare(0, f, p)) : null },
    shares: shares.map(round3),
    markets,
    confidence: conf,
    best: markets.filter((m) => m.call && m.call !== 'Pass').sort((a, b) => b.score - a.score)[0] || null,
  };
}

function last10Half(ctx, game) {
  const vals = [game.away.player, game.home.player].map((pl) => ctx?.profiles?.[String(pl || '').toUpperCase()]?.last10Half);
  if (vals.some((v) => !v || !Number.isFinite(v.avg))) return null;
  return {
    away: round1(vals[0].avg),
    home: round1(vals[1].avg),
    avg: round1((vals[0].avg + vals[1].avg) / 2),
    n: Math.min(vals[0].n, vals[1].n),
  };
}

function confidence({ f, started, pre, prog, minutes, overtime = false, margin = 0 }) {
  let score = 50;
  const notes = [];
  if (pre.known === 2) score += 12;
  else notes.push('New gamer — league average used');
  if (pre.minGames >= 40) score += 10;
  else if (pre.minGames >= 15) score += 5;
  else notes.push('Thin history');
  if (started) {
    if (/^(quarter|market)-/.test(prog.source)) score += 8;
    else if (prog.source === 'score-estimate') {
      score -= 6;
      notes.push('FanDuel has not posted the real tip time yet — progress estimated from the score');
    } else notes.push('Game clock estimated from tip time');
    if (f > 0.92) {
      score -= 20;
      notes.push('Final minutes — fouls/heaves swing totals');
    }
    if (overtime) {
      score -= 40;
      notes.push('Overtime — no calls (the model does not price extra periods)');
    } else if (f > 0.85 && Math.abs(margin) <= 4) {
      score -= 8;
      notes.push('Close game late — overtime risk pushes totals up');
    }
  }
  score = clamp(score, 20, 92);
  const level = score >= 70 ? 'HIGH' : score >= 55 ? 'MED' : 'LOW';
  return { score, level, notes };
}

module.exports = {
  DEFAULT_PARAMS,
  progressFromTime,
  estimateProgress,
  phaseWeight,
  quarterBounds,
  windowShare,
  posteriorRate,
  sdAt,
  probOver,
  priceMarket,
  pregame,
  pairShares,
  evaluateLive,
  noVigOver,
  americanToDecimal,
  impliedProb,
  evFor,
  normCdf,
};
