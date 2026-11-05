/**
 * eBasketball API logic: live board, game detail, matchup lab, gamer table, performance.
 */

const cache = require('./cache');
const store = require('./store');
const fdEb = require('./feeds/fanduelEb');
const h2h = require('./feeds/h2h');
const { evaluateLive, pregame, pairShares, windowShare, priceMarket, DEFAULT_PARAMS } = require('./model/ebModel');
const { normPlayer, predictGame } = require('./model/ebRatings');
const ctxMod = require('./ebContext');
const tracker = require('./ebTracker');

const MIN = 60000;

async function traceFor(eventId) {
  return cache.wrap(`trace:${eventId}`, 60 * 1000, async () => (await store.getJSON(`track/ev/${eventId}`)) || {});
}

async function finalsCached() {
  return cache.wrap('finals:mem', 5 * MIN, () => ctxMod.loadFinals());
}

function openingFor(trace) {
  const l = trace?.close?.game?.line ?? trace?.pre?.game?.line;
  return Number.isFinite(l) ? l : null;
}

function slimEval(ev) {
  return {
    modelWeight: ev.modelWeight,
    progress: ev.progress,
    pregame: ev.pregame,
    rate: ev.rate,
    confidence: ev.confidence,
    markets: ev.markets,
    best: ev.best,
  };
}

async function upcomingFromSchedule(ctx, onBoard, now) {
  let rows = [];
  try {
    rows = await h2h.schedule(h2h.dayKey(now));
    if (new Date(now).getUTCHours() >= 23) rows = rows.concat(await h2h.schedule(h2h.dayKey(now + 86400000)));
  } catch {
    return [];
  }
  const boardKeys = new Set(onBoard.map((g) => [g.away.player, g.home.player].map(normPlayer).sort().join('|')));
  const out = [];
  for (const m of rows) {
    const t = Date.parse(m.startDate);
    if (!Number.isFinite(t) || m.isCancelled) continue;
    if (m.matchStatus === 'MATCH_ENDED') continue;
    if (t < now - 3 * MIN || t > now + 75 * MIN) continue;
    const key = [m.participantAName, m.participantBName].map(normPlayer).sort().join('|');
    if (boardKeys.has(key)) continue;
    const game = {
      id: `h2h:${m.externalId}`,
      status: 'scheduled',
      scheduledMs: t,
      away: { team: m.teamAName, player: normPlayer(m.participantAName), score: 0 },
      home: { team: m.teamBName, player: normPlayer(m.participantBName), score: 0 },
      stream: m.streamName,
      lines: {},
    };
    const ev = evaluateLive({ ...game, status: 'pre' }, ctx, { now });
    out.push({ ...game, eval: slimEval(ev) });
  }
  return out.sort((a, b) => a.scheduledMs - b.scheduledMs);
}

async function board({ edgeMin, evMin } = {}) {
  const now = Date.now();
  const ctx = await ctxMod.getContext();
  const rows = await fdEb.listBoard();
  // Event pages add 1H / quarter / team-total lines and the current-quarter hint.
  const pages = await Promise.allSettled(rows.map((g) => fdEb.eventLines(g.eventId)));
  pages.forEach((p, i) => {
    if (p.status === 'fulfilled') rows[i].lines = { ...p.value.lines, game: p.value.lines.game || rows[i].lines.game };
  });
  const traces = await Promise.all(rows.map((g) => traceFor(g.eventId).catch(() => ({}))));
  const games = rows.map((g, i) => {
    const opening = g.total === 0 ? null : openingFor(traces[i]);
    const ev = evaluateLive(g, { ...ctx, openingTotal: opening }, { now, edgeMin, evMin });
    return { ...g, opening, eval: slimEval(ev) };
  });
  const upcoming = await upcomingFromSchedule(ctx, rows, now);
  const picks = games
    .filter((g) => g.eval.best)
    .map((g) => ({ id: g.id, eventId: g.eventId, name: g.name, away: g.away, home: g.home, status: g.status, market: g.eval.best }))
    .sort((a, b) => b.market.score - a.market.score)
    .slice(0, 3);
  return {
    updatedAt: new Date(now).toISOString(),
    live: games,
    upcoming,
    picks,
    model: {
      builtAt: ctx.builtAt,
      games: ctx.games,
      quarterGames: ctx.quarterGames,
      players: Object.keys(ctx.ratings?.players || {}).length,
      modelWeight: ctx.params?.modelWeight ?? DEFAULT_PARAMS.modelWeight,
      modelWeightFit: ctx.paramsInfo || null,
    },
    params: { edgeMin: edgeMin ?? DEFAULT_PARAMS.edgeMin, evMin: evMin ?? DEFAULT_PARAMS.evMin },
  };
}

function playerCard(ctx, finals, player) {
  const p = normPlayer(player);
  const r = ctx.ratings?.players?.[p] || null;
  const prof = ctx.profiles?.[p] || null;
  const recent = [];
  for (let i = finals.length - 1; i >= 0 && recent.length < 10; i -= 1) {
    const g = ctxMod.rowToGame(finals[i]);
    if (normPlayer(g.a) === p) recent.push({ t: g.t, opp: normPlayer(g.b), team: g.teamA, oppTeam: g.teamB, for: g.sa, against: g.sb, total: g.sa + g.sb });
    else if (normPlayer(g.b) === p) recent.push({ t: g.t, opp: normPlayer(g.a), team: g.teamB, oppTeam: g.teamA, for: g.sb, against: g.sa, total: g.sa + g.sb });
  }
  const last10Total = recent.length ? Math.round((recent.reduce((s, g) => s + g.total, 0) / recent.length) * 10) / 10 : null;
  return { player: p, rating: r, profile: prof, recent, last10Total };
}

function headToHead(finals, a, b) {
  const A = normPlayer(a);
  const B = normPlayer(b);
  const list = [];
  for (let i = finals.length - 1; i >= 0 && list.length < 8; i -= 1) {
    const g = ctxMod.rowToGame(finals[i]);
    const pa = normPlayer(g.a);
    const pb = normPlayer(g.b);
    if ((pa === A && pb === B) || (pa === B && pb === A)) {
      const aScore = pa === A ? g.sa : g.sb;
      const bScore = pa === A ? g.sb : g.sa;
      list.push({ t: g.t, a: aScore, b: bScore, total: g.sa + g.sb });
    }
  }
  const avg = list.length ? Math.round((list.reduce((s, x) => s + x.total, 0) / list.length) * 10) / 10 : null;
  return { meetings: list.length, avgTotal: avg, games: list };
}

async function game(eventId, { quarterStart, edgeMin, evMin } = {}) {
  const now = Date.now();
  const ctx = await ctxMod.getContext();
  const rows = await fdEb.listBoard();
  const row = rows.find((g) => g.eventId === String(eventId));
  if (!row) {
    const err = new Error('Game is no longer on the FanDuel live board (finished or suspended).');
    err.status = 404;
    throw err;
  }
  let lines = row.lines;
  let linesSource = 'board';
  try {
    const full = await fdEb.eventLines(eventId);
    lines = { ...full.lines, game: full.lines.game || row.lines.game };
    linesSource = 'event-page';
  } catch {
    /* board lines are enough for the game total */
  }
  const g = { ...row, lines };
  const trace = await traceFor(eventId).catch(() => ({}));
  const opening = g.total === 0 ? null : openingFor(trace);
  const ev = evaluateLive(g, { ...ctx, openingTotal: opening }, { now, quarterStart, edgeMin, evMin });
  const finals = await finalsCached();
  return {
    updatedAt: new Date(now).toISOString(),
    game: { ...g, opening, linesSource },
    eval: slimEval(ev),
    shares: ev.shares,
    gamers: { away: playerCard(ctx, finals, g.away.player), home: playerCard(ctx, finals, g.home.player) },
    h2h: headToHead(finals, g.away.player, g.home.player),
    trace: trace && trace.eventId ? { close: trace.close || trace.pre || null, signals: trace.signals || [], checkpoints: Object.keys(trace.checkpoints || {}) } : null,
  };
}

async function matchup({ a, b, teamA, teamB, line, half1, edgeMin } = {}) {
  if (!a || !b) {
    const err = new Error('Pick two gamers');
    err.status = 400;
    throw err;
  }
  const ctx = await ctxMod.getContext();
  const finals = await finalsCached();
  const g = { away: { player: normPlayer(a), team: teamA || '' }, home: { player: normPlayer(b), team: teamB || '' } };
  const pre = pregame(ctx, g, {});
  const shares = pairShares(ctx, g);
  const p = { ...DEFAULT_PARAMS, quarterShare: shares };
  const half = pre.expected * windowShare(0, 0.5, p);
  const quarters = [1, 2, 3, 4].map((q) => Math.round(pre.expected * windowShare((q - 1) / 4, q / 4, p) * 10) / 10);
  const em = Number.isFinite(Number(edgeMin)) ? Number(edgeMin) : DEFAULT_PARAMS.edgeMin;
  const priced = (mean, sd, l) => (Number.isFinite(Number(l)) && Number(l) > 0
    ? priceMarket({ mean, sd, market: { line: Number(l), over: -110, under: -110, open: true }, edgeMin: em, evMin: DEFAULT_PARAMS.evMin })
    : null);
  const cardA = playerCard(ctx, finals, a);
  const cardB = playerCard(ctx, finals, b);
  const l10a = cardA.profile?.last10Half?.avg;
  const l10b = cardB.profile?.last10Half?.avg;
  const last10 = Number.isFinite(l10a) && Number.isFinite(l10b) ? Math.round(((l10a + l10b) / 2) * 10) / 10 : null;
  return {
    pregame: pre,
    half1: Math.round(half * 10) / 10,
    last10Half: last10,
    quarters,
    shares,
    priceGame: priced(pre.expected, DEFAULT_PARAMS.sdStart, line),
    priceHalf: priced(half, DEFAULT_PARAMS.sdStart * Math.sqrt(0.5), half1),
    gamers: { a: cardA, b: cardB },
    h2h: headToHead(finals, a, b),
  };
}

async function players() {
  const ctx = await ctxMod.getContext();
  const list = Object.entries(ctx.ratings?.players || {}).map(([name, r]) => {
    const prof = ctx.profiles?.[name];
    const exp = predictGame(ctx.ratings, { a: name, b: '__avg__' });
    return {
      name,
      n: r.n,
      avgFor: r.avgFor,
      avgAgainst: r.avgAgainst,
      avgTotal: r.avgTotal,
      off: r.off,
      def: r.def,
      paceIndex: Math.round((r.off + r.def) * 10) / 10,
      vsAvgTotal: exp.total,
      last10Half: prof?.last10Half?.avg ?? null,
      bestQuarter: prof?.bestQuarter ?? null,
      qFor: prof?.qFor ?? null,
      last: r.last,
    };
  });
  list.sort((x, y) => y.n - x.n);
  return { builtAt: ctx.builtAt, mu: ctx.ratings?.mu, totalSd: ctx.ratings?.totalSd, players: list };
}

async function performance(opts) {
  return tracker.performance(opts);
}

module.exports = { board, game, matchup, players, performance };
