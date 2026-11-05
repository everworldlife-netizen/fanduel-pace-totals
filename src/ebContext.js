/**
 * Model context for eBasketball: ratings + gamer profiles + head-to-head pairs.
 * Built from official H2H GG League finals and quarter splits. The collector
 * keeps the rolling data fresh in the store; the API reads the built context.
 */

const store = require('./store');
const { fitRatings, gamesFromSchedule } = require('./model/ebRatings');
const { buildProfiles, buildPairs } = require('./model/ebProfiles');

const KEEP_DAYS = 28;
const DAY_MS = 86400000;
const RATING_OPTS = { halfLifeDays: 10, ridgePlayer: 3, ridgeTeam: 20, useTeams: true };

let memCtx = null;
let memAt = 0;

// Static requires so the Netlify bundler packs the seed JSON into the function.
const SEEDS = {
  'seed-finals': () => require('../data/seed-finals.json'),
  'seed-quarters': () => require('../data/seed-quarters.json'),
  'seed-context': () => require('../data/seed-context.json'),
};

function loadSeed(name) {
  try {
    return SEEDS[name] ? SEEDS[name]() : null;
  } catch {
    return null;
  }
}

function rowToGame(r) {
  return { id: r[0], t: r[1], a: r[2], b: r[3], teamA: r[4], teamB: r[5], sa: r[6], sb: r[7] };
}

function gameToRow(g) {
  return [g.id, g.t, g.a, g.b, g.teamA, g.teamB, g.sa, g.sb];
}

async function loadFinals() {
  const stored = await store.getJSON('data/finals');
  if (Array.isArray(stored) && stored.length) return stored;
  return loadSeed('seed-finals') || [];
}

async function loadQuarters() {
  const stored = await store.getJSON('data/quarters');
  if (stored && typeof stored === 'object' && Object.keys(stored).length) return stored;
  return loadSeed('seed-quarters') || {};
}

/** Merge H2H schedule rows into the compact finals list (dedupe by id, rolling window). */
function mergeFinals(rows, scheduleRows, now = Date.now()) {
  const byId = new Map((rows || []).map((r) => [r[0], r]));
  for (const g of gamesFromSchedule(scheduleRows)) byId.set(g.id, gameToRow(g));
  const cutoff = now - KEEP_DAYS * DAY_MS;
  return [...byId.values()].filter((r) => r[1] >= cutoff).sort((x, y) => x[1] - y[1]);
}

function buildContext(finalRows, quarters, now = Date.now()) {
  const games = (finalRows || []).map(rowToGame);
  const ratings = fitRatings(games, { ...RATING_OPTS, now });
  const qGames = [];
  for (const g of games) {
    const q = quarters?.[g.id];
    if (Array.isArray(q) && q.length === 8) {
      qGames.push({ ...g, q: [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]] });
    }
  }
  const profiles = buildProfiles(qGames);
  const pairs = buildPairs(games.filter((g) => g.t >= now - 21 * DAY_MS), ratings);
  return {
    builtAt: new Date(now).toISOString(),
    games: games.length,
    quarterGames: qGames.length,
    lastGameAt: games.length ? new Date(games[games.length - 1].t).toISOString() : null,
    ratings,
    profiles,
    pairs,
  };
}

async function getContext({ maxAgeMs = 5 * 60 * 1000 } = {}) {
  if (memCtx && Date.now() - memAt < maxAgeMs) return memCtx;
  let ctx = await store.getJSON('model/context');
  if (!ctx || !ctx.ratings) {
    ctx = loadSeed('seed-context');
    if (!ctx) {
      const [finals, quarters] = await Promise.all([loadFinals(), loadQuarters()]);
      ctx = buildContext(finals, quarters);
    }
  }
  const params = await store.getJSON('model/params');
  if (params && Array.isArray(params.phaseWeights)) {
    ctx = { ...ctx, params: { ...(ctx.params || {}), phaseWeights: params.phaseWeights }, paramsInfo: params };
  }
  memCtx = ctx;
  memAt = Date.now();
  return ctx;
}

function setMemoryContext(ctx) {
  memCtx = ctx;
  memAt = Date.now();
}

module.exports = {
  loadFinals,
  loadQuarters,
  mergeFinals,
  buildContext,
  getContext,
  setMemoryContext,
  rowToGame,
  gameToRow,
  RATING_OPTS,
  KEEP_DAYS,
};
