const { fetchJSON } = require('./client');
const { getLeague } = require('../leagues');
const { isVirtualGame } = require('../model/virtual');
const { periodLabel } = require('../model/clock');

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball';

function mapStatus(espnStatus) {
  if (espnStatus === 'STATUS_FINAL') return 'final';
  if (espnStatus === 'STATUS_SCHEDULED') return 'scheduled';
  if (espnStatus === 'STATUS_HALFTIME') return 'halftime';
  if (espnStatus === 'STATUS_END_PERIOD' || espnStatus === 'STATUS_END_QUARTER') return 'in_progress';
  return 'in_progress';
}

function qScores(competitor) {
  const lines = competitor.linescores || [];
  return lines.map((l) => parseInt(l.displayValue ?? l.value, 10) || 0);
}

function normalizeTeam(competitor) {
  return {
    id: competitor.team?.id || '',
    abbrev: competitor.team?.abbreviation || '',
    name: competitor.team?.displayName || competitor.team?.shortDisplayName || '',
    shortName: competitor.team?.shortDisplayName || competitor.team?.abbreviation || '',
    logo: competitor.team?.logo || competitor.team?.logos?.[0]?.href || '',
    score: parseInt(competitor.score, 10) || 0,
    record: competitor.records ? competitor.records[0]?.summary || '' : '',
    qScores: qScores(competitor),
  };
}

function normalizeGame(event, league) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const status = comp.status || {};
  const home = (comp.competitors || []).find((c) => c.homeAway === 'home');
  const away = (comp.competitors || []).find((c) => c.homeAway === 'away');
  if (!home || !away) return null;
  const mapped = mapStatus(status.type?.name);
  const period = status.period || 0;
  const clock = status.displayClock || '0:00';
  const isHalftime = status.type?.name === 'STATUS_HALFTIME' || mapped === 'halftime';
  const game = {
    id: `espn:${league.id}:${event.id}`,
    sourceId: String(event.id),
    source: 'espn',
    leagueId: league.id,
    leagueName: league.name,
    leagueAbbrev: league.abbrev,
    name: event.name,
    shortName: event.shortName,
    status: mapped,
    statusDetail: status.type?.shortDetail || status.type?.detail || '',
    period,
    clock,
    isHalftime,
    date: event.date,
    home: normalizeTeam(home),
    away: normalizeTeam(away),
    isVirtual: false,
  };
  game.periodText = periodLabel(period, league, { isHalftime, status: mapped });
  if (isVirtualGame(game)) return null;
  return game;
}

async function getScoreboard(leagueId) {
  const league = getLeague(leagueId);
  if (!league?.espnSlug) return { games: [], skipped: true };
  const extra = league.espnQuery ? `?${league.espnQuery}` : '';
  const url = `${BASE}/${league.espnSlug}/scoreboard${extra}`;
  try {
    const raw = await fetchJSON(url, `espn:sb:${leagueId}`, 15000);
    const games = (raw.events || []).map((e) => normalizeGame(e, league)).filter(Boolean);
    return { games, league: raw.leagues?.[0]?.name || league.name };
  } catch (err) {
    return { games: [], error: err.message };
  }
}

async function getAllEspnScoreboards(ids) {
  const results = await Promise.all(ids.map((id) => getScoreboard(id)));
  const games = [];
  const errors = [];
  results.forEach((r, i) => {
    games.push(...r.games);
    if (r.error) errors.push({ league: ids[i], error: r.error });
  });
  return { games, errors };
}

module.exports = { getScoreboard, getAllEspnScoreboards, normalizeGame, mapStatus };
