const cache = require('../cache');
const { LEAGUES, getLeague } = require('../leagues');
const { isVirtualGame } = require('../model/virtual');
const { periodLabel } = require('../model/clock');

const ROOT = 'https://v1.basketball.api-sports.io';
const SCOREBOARD_TTL = 5 * 60 * 1000; // 5 min — not a 15s poller
const STATS_TTL = 60 * 1000;
const LEAGUE_ID_TTL = 24 * 60 * 60 * 1000;

function apiKey() {
  return process.env.API_BASKETBALL_KEY || process.env.APISPORTS_KEY || '';
}

function enabled() {
  return Boolean(apiKey());
}

async function apiGet(path, cacheKey, ttl) {
  const key = apiKey();
  if (!key) throw new Error('API_BASKETBALL_KEY not set');
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const url = `${ROOT}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'x-apisports-key': key,
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`API-Basketball HTTP ${res.status}`);
    const data = await res.json();
    if (data.errors && Object.keys(data.errors).length) {
      throw new Error(`API-Basketball: ${JSON.stringify(data.errors)}`);
    }
    cache.set(cacheKey, data, ttl);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLeagueId(leagueId) {
  const league = getLeague(leagueId);
  if (!league?.apiBasketball) return null;
  const cacheKey = `apib:id:${leagueId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const names = league.apiBasketball.names || [];
  try {
    const data = await apiGet('/leagues', 'apib:leagues', LEAGUE_ID_TTL);
    const rows = data.response || [];
    const wanted = names.map((n) => n.toLowerCase());
    const country = (league.apiBasketball.country || '').toLowerCase();
    const match = rows.find((row) => {
      const nm = (row.name || row.league?.name || '').toLowerCase();
      const ctry = (row.country?.name || row.country || '').toLowerCase();
      const nameHit = wanted.some((w) => nm === w || nm.includes(w));
      if (!nameHit) return false;
      if (country && ctry && ctry !== country) return false;
      return true;
    });
    const id = match?.id || match?.league?.id || league.apiBasketball.fallbackId;
    cache.set(cacheKey, id, LEAGUE_ID_TTL);
    return id;
  } catch (err) {
    console.log(`[apib] league resolve ${leagueId}: ${err.message}`);
    const fallback = league.apiBasketball.fallbackId;
    cache.set(cacheKey, fallback, 30 * 60 * 1000);
    return fallback;
  }
}

function mapStatus(row) {
  const short = (row.status?.short || '').toUpperCase();
  const long = (row.status?.long || '').toLowerCase();
  if (short === 'FT' || short === 'AOT' || long.includes('finished')) return 'final';
  if (short === 'NS' || long.includes('not started')) return 'scheduled';
  if (short === 'HT' || long.includes('half')) return 'halftime';
  if (['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'LIVE'].includes(short)) return 'in_progress';
  if (long.includes('live') || long.includes('quarter') || long.includes('overtime')) return 'in_progress';
  return 'scheduled';
}

function periodFromStatus(row) {
  const short = (row.status?.short || '').toUpperCase();
  const m = short.match(/^Q(\d)$/);
  if (m) return Number(m[1]);
  if (short === 'HT') return 2;
  if (short === 'OT' || short === 'AOT') return 5;
  if (short === 'FT') return 4;
  return 0;
}

function team(t, scores, side) {
  const sc = scores?.[side] || {};
  return {
    id: String(t?.id || ''),
    abbrev: (t?.name || '').slice(0, 3).toUpperCase(),
    name: t?.name || '',
    shortName: t?.name || '',
    logo: t?.logo || '',
    score: sc.total || 0,
    record: '',
    qScores: [sc.quarter_1, sc.quarter_2, sc.quarter_3, sc.quarter_4, sc.overtime].map((n) => n || 0),
  };
}

function normalize(row, league) {
  const status = mapStatus(row);
  const period = periodFromStatus(row);
  const clock = row.status?.timer || (status === 'in_progress' ? '' : '0:00');
  const game = {
    id: `apib:${league.id}:${row.id}`,
    sourceId: String(row.id),
    source: 'api-basketball',
    leagueId: league.id,
    leagueName: league.name,
    leagueAbbrev: league.abbrev,
    name: `${row.teams?.away?.name} at ${row.teams?.home?.name}`,
    shortName: `${row.teams?.away?.name} @ ${row.teams?.home?.name}`,
    status,
    statusDetail: row.status?.long || row.status?.short || '',
    period,
    clock,
    isHalftime: status === 'halftime',
    date: row.date,
    home: team(row.teams?.home, row.scores, 'home'),
    away: team(row.teams?.away, row.scores, 'away'),
    isVirtual: false,
  };
  game.periodText = periodLabel(period, league, { isHalftime: game.isHalftime, status });
  if (isVirtualGame(game)) return null;
  return game;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function listLeagueGames(leagueId) {
  if (!enabled()) return { games: [], skipped: true, reason: 'no_key' };
  const league = getLeague(leagueId);
  if (!league?.apiBasketball) return { games: [], skipped: true };
  const numericId = await resolveLeagueId(leagueId);
  if (!numericId) return { games: [], skipped: true };
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const dates = [ymd(yesterday), ymd(now)];
  const games = [];
  for (const date of dates) {
    try {
      const data = await apiGet(
        `/games?league=${numericId}&date=${date}`,
        `apib:games:${numericId}:${date}`,
        SCOREBOARD_TTL
      );
      for (const row of data.response || []) {
        const g = normalize(row, league);
        if (g) games.push(g);
      }
    } catch (err) {
      console.log(`[apib] games ${leagueId} ${date}: ${err.message}`);
    }
  }
  const seen = new Set();
  return { games: games.filter((g) => (seen.has(g.id) ? false : seen.add(g.id))) };
}

function parseStatBag(stats) {
  if (!stats) return null;
  const fg = stats.field_goals || stats.fieldGoals || {};
  const ft = stats.freethrows || stats.free_throws || {};
  const reb = stats.rebounds || {};
  const fga = Number(fg.total || fg.attempted || 0);
  const fgm = Number(fg.success || fg.made || 0);
  return {
    fgm,
    fga: fga || Number(String(fg.total || '').split('-')[1]) || 0,
    fta: Number(ft.total || ft.attempted || 0),
    ftm: Number(ft.success || ft.made || 0),
    orb: Number(reb.offensive || 0),
    drb: Number(reb.defensive || 0),
    reb: Number(reb.total || 0),
    to: Number(stats.turnovers?.total || stats.turnovers || 0),
    ast: Number(stats.assists || 0),
    pts: Number(stats.points || 0),
    tpa: Number((stats.threepoint_goals || stats.threepoints || {}).total || 0),
    tpm: Number((stats.threepoint_goals || stats.threepoints || {}).success || 0),
  };
}

async function getGameStatistics(leagueId, gameId) {
  if (!enabled()) return { home: null, away: null };
  try {
    const data = await apiGet(`/statistics?id=${gameId}`, `apib:stat:${gameId}`, STATS_TTL);
    const rows = data.response || [];
    const out = { home: null, away: null };
    for (const row of rows) {
      const bag = parseStatBag(row.statistics || row);
      const teamId = String(row.team?.id || '');
      if (!out.home) out.home = bag;
      else out.away = bag;
      row._teamId = teamId;
    }
    return out;
  } catch (err) {
    console.log(`[apib] stats ${gameId}: ${err.message}`);
    return { home: null, away: null };
  }
}

function missingPriorityLeagues() {
  return Object.values(LEAGUES).filter((l) => l.fanduelPriority && l.apiBasketball && !l.espnSlug && !l.euroCode);
}

module.exports = {
  enabled,
  listLeagueGames,
  getGameStatistics,
  resolveLeagueId,
  missingPriorityLeagues,
};
