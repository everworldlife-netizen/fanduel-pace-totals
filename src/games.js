const { DEFAULT_SCOREBOARD, getLeague, leagueList } = require('./leagues');
const espnBoard = require('./espn/scoreboard');
const espnBox = require('./espn/boxscore');
const euro = require('./feeds/euroleague');
const apib = require('./feeds/apiBasketball');
const fanduelLive = require('./feeds/fanduelLive');
const { buildSnapshot } = require('./model/totals');
const { evaluate } = require('./model/advice');
const { isVirtualGame } = require('./model/virtual');

function skipNcaab() {
  return process.env.SKIP_NCAAB === '1' || process.env.SKIP_NCAAB === 'true';
}

function scoreboardIds() {
  return DEFAULT_SCOREBOARD.filter((id) => {
    if (skipNcaab() && (id === 'ncaam' || id === 'ncaaw')) return false;
    return true;
  });
}

function statusRank(g) {
  if (g.status === 'in_progress' || g.status === 'halftime') return 0;
  if (g.status === 'scheduled') return 1;
  return 2;
}

function sortGames(games) {
  return games.slice().sort((a, b) => {
    const r = statusRank(a) - statusRank(b);
    if (r !== 0) return r;
    return String(a.date || '').localeCompare(String(b.date || ''));
  });
}

function parseId(id) {
  const parts = String(id).split(':');
  const source = parts[0];
  if (source === 'espn') return { source, leagueId: parts[1], eventId: parts.slice(2).join(':') };
  if (source === 'euro') return { source, leagueId: parts[1], seasonCode: parts[2], gameCode: parts[3] };
  if (source === 'apib') return { source, leagueId: parts[1], gameId: parts[2] };
  if (source === 'fd') return { source, leagueId: parts[1], eventId: parts[2] };
  throw new Error(`Unknown game id ${id}`);
}

async function listGames() {
  const ids = scoreboardIds();
  const espnIds = ids.filter((id) => getLeague(id)?.espnSlug);
  const euroIds = ids.filter((id) => getLeague(id)?.euroCode);
  const apibIds = ids.filter((id) => {
    const l = getLeague(id);
    return l?.apiBasketball && !l.espnSlug && !l.euroCode;
  });

  const espnP = espnBoard.getAllEspnScoreboards(espnIds);
  const euroP = Promise.all(euroIds.map((id) => euro.listSeasonGames(id).catch(() => [])));
  const apibP = apib.enabled()
    ? Promise.all(apibIds.map((id) => apib.listLeagueGames(id)))
    : Promise.resolve(apibIds.map((id) => ({ games: [], skipped: true, leagueId: id })));

  const fdP = fanduelLive.listLiveGames();
  const [espnRes, euroLists, apibLists, fdRes] = await Promise.all([espnP, euroP, apibP, fdP]);

  let games = [...(fdRes.games || [])];
  games.push(...espnRes.games);
  for (const list of euroLists) games.push(...list);
  const apibMeta = [];
  apibLists.forEach((res, i) => {
    games.push(...(res.games || []));
    if (res.skipped) apibMeta.push({ league: apibIds[i], reason: res.reason || 'skipped' });
  });

  games = games.filter((g) => !isVirtualGame(g));

  // Prefer EuroLeague official feed over empty ESPN euroleague rows of the same matchup/date
  const euroKeys = new Set(
    games.filter((g) => g.source === 'euroleague').map((g) => `${g.leagueId}|${g.shortName}|${String(g.date).slice(0, 10)}`)
  );
  games = games.filter((g) => {
    if (g.source === 'espn' && g.leagueId === 'euroleague') {
      const k = `${g.leagueId}|${g.shortName}|${String(g.date).slice(0, 10)}`;
      if (euroKeys.size) return false;
    }
    return true;
  });

  return {
    games: sortGames(games),
    errors: [...(espnRes.errors || []), *(fdRes.error ? [`fanduel: ${fdRes.error}`] : [])],
    fanduelLive: { count: (fdRes.games || []).length, error: fdRes.error },
    apiBasketball: {
      enabled: apib.enabled(),
      skipped: apibMeta,
    },
  };
}

async function getGame(id) {
  const parsed = parseId(id);
  const league = getLeague(parsed.leagueId);
  if (!league) throw new Error(`Unknown league ${parsed.leagueId}`);
  let game;
  if (parsed.source === 'espn') {
    game = await espnBox.getBoxscore(parsed.leagueId, parsed.eventId);
  } else if (parsed.source === 'euro') {
    game = await euro.getGameDetail(parsed.leagueId, parsed.seasonCode, parsed.gameCode);
  } else if (parsed.source === 'fd') {
    const board = await fanduelLive.listLiveGames();
    game = (board.games || []).find((g) => g.sourceId === parsed.eventId || g.id === id);
    if (!game) throw new Error('FanDuel live event not found (may have ended)');
    game.box = null;
  } else if (parsed.source === 'apib') {
    const boards = await apib.listLeagueGames(parsed.leagueId);
    game = (boards.games || []).find((g) => g.sourceId === parsed.gameId);
    if (!game) {
      game = {
        id,
        source: 'api-basketball',
        sourceId: parsed.gameId,
        leagueId: parsed.leagueId,
        leagueName: league.name,
        leagueAbbrev: league.abbrev,
        home: { abbrev: 'HOME', name: 'Home', score: 0, qScores: [] },
        away: { abbrev: 'AWAY', name: 'Away', score: 0, qScores: [] },
        status: 'scheduled',
        period: 0,
        clock: '0:00',
      };
    }
    const stats = await apib.getGameStatistics(parsed.leagueId, parsed.gameId);
    game.box = stats;
  } else {
    throw new Error('Unknown source');
  }
  if (isVirtualGame(game)) {
    const err = new Error('eBasketball/virtual games are ignored');
    err.code = 'VIRTUAL';
    throw err;
  }
  const snapshot = buildSnapshot(game, league);
  return { game, snapshot, league: { id: league.id, name: league.name, abbrev: league.abbrev, clock: league.clock } };
}

async function evaluateGame(id, lines) {
  const { game, snapshot, league } = await getGame(id);
  const advice = evaluate(game, getLeague(league.id), lines || {});
  return { game, snapshot, league, advice };
}

function coverage() {
  return leagueList().map((l) => ({
    id: l.id,
    name: l.name,
    fanduelPriority: l.fanduelPriority,
    espn: Boolean(l.espnSlug) ? l.espnSlug : null,
    euroleagueApi: l.euroCode || null,
    apiBasketball: l.apiBasketball
      ? { names: l.apiBasketball.names, needsKey: !l.espnSlug && !l.euroCode }
      : null,
  }));
}

module.exports = { listGames, getGame, evaluateGame, coverage, parseId };
