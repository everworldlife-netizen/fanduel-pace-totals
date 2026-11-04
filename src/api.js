/**
 * Framework-agnostic API router shared by the Express server (local / Docker)
 * and the Netlify function. handle() returns { status, body }.
 */

const games = require('./games');
const apib = require('./feeds/apiBasketball');
const fdLive = require('./feeds/fanduelLive');
const eb = require('./ebasketball');
const store = require('./store');

function num(v) {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseQuarterStart(q) {
  // "3:67" => { q: 3, total: 67 }
  if (!q) return undefined;
  const [qq, tt] = String(q).split(':');
  const out = { q: Number(qq), total: Number(tt) };
  return Number.isFinite(out.q) && Number.isFinite(out.total) ? out : undefined;
}

const routes = [
  ['GET', /^\/health$/, async () => ({
    ok: true,
    app: 'gg-winner',
    store: store.backend(),
    apiBasketball: apib.enabled(),
    fanduelLive: fdLive.enabled(),
    time: new Date().toISOString(),
  })],
  ['GET', /^\/eb\/board$/, async ({ query }) => eb.board({ edgeMin: num(query.edge), evMin: num(query.ev) })],
  ['GET', /^\/eb\/game\/(\d+)$/, async ({ query }, m) => eb.game(m[1], {
    quarterStart: parseQuarterStart(query.qs),
    edgeMin: num(query.edge),
    evMin: num(query.ev),
  })],
  ['GET', /^\/eb\/matchup$/, async ({ query }) => eb.matchup({
    a: query.a,
    b: query.b,
    teamA: query.teamA,
    teamB: query.teamB,
    line: query.line,
    half1: query.half1,
    edgeMin: query.edge,
  })],
  ['GET', /^\/eb\/players$/, async () => eb.players()],
  ['GET', /^\/eb\/performance$/, async ({ query }) => eb.performance({ days: Math.min(Math.max(num(query.days) || 7, 1), 30) })],
  ['GET', /^\/leagues$/, async () => ({ leagues: games.coverage(), apiBasketballEnabled: apib.enabled() })],
  ['GET', /^\/games$/, async () => ({ ...(await games.listGames()), fetchedAt: new Date().toISOString() })],
  ['GET', /^\/games\/(.+)$/, async (_req, m) => ({ ...(await games.getGame(decodeURIComponent(m[1]))), fetchedAt: new Date().toISOString() })],
  ['POST', /^\/evaluate$/, async ({ body }) => {
    const { gameId, lines } = body || {};
    if (!gameId) {
      const err = new Error('gameId is required');
      err.status = 400;
      throw err;
    }
    if (!lines || lines.gameTotal == null || lines.gameTotal === '') {
      const err = new Error('Add a FanDuel game total.');
      err.status = 400;
      throw err;
    }
    return { ...(await games.evaluateGame(gameId, lines)), fetchedAt: new Date().toISOString() };
  }],
];

async function handle({ method = 'GET', path = '/', query = {}, body = null }) {
  const p = path.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  for (const [m, re, fn] of routes) {
    if (m !== method) continue;
    const match = p.match(re);
    if (!match) continue;
    try {
      const data = await fn({ query, body }, match);
      return { status: 200, body: data };
    } catch (err) {
      const status = err.status || (err.code === 'VIRTUAL' ? 400 : 502);
      if (status >= 500) console.error(`[api] ${method} ${p}`, err);
      return { status, body: { error: err.message } };
    }
  }
  return { status: 404, body: { error: `No route ${method} ${p}` } };
}

module.exports = { handle, parseQuarterStart };
