/**
 * FanDuel public sportsbook live scoreboard (scores / clock / period only).
 *
 * Discovery (2026-09-20), from the live basketball tab and known SBTech hosts:
 *   HTML: https://sportsbook.fanduel.com/live?tab=basketball
 *   Events: https://sbapi.{state}.sportsbook.fanduel.com/api/in-play
 *   Scores: https://api.sportsbook.fanduel.com/ips/inplayservice/v1.0/livedata
 *
 * The live game total (line + juice) is attached as `fdTotal` so the UI can
 * pre-fill it; every pasted line still overrides it.
 */

const fdClient = require('./fdClient');
const { getLeague, FIBA_40 } = require('../leagues');
const { isVirtualGame } = require('../model/virtual');
const { periodLabel } = require('../model/clock');

const BASKETBALL_EVENT_TYPE = 7522;

const LEAGUE_MATCHERS = [
  { id: 'wnba', re: /\bwnba\b/i },
  { id: 'nba', re: /\bnba\b/i },
  { id: 'nbl', re: /\bnbl\b|australian\s+nbl/i },
  { id: 'euroleague', re: /euro\s*league/i },
  { id: 'eurocup', re: /euro\s*cup/i },
  { id: 'bbl', re: /\bbbl\b|bundesliga/i },
  { id: 'lkl', re: /\blkl\b/i },
  { id: 'bcl', re: /champions\s+league|\bbcl\b/i },
  { id: 'lnbp', re: /\blnbp\b/i },
  { id: 'ncaam', re: /\bncaa|\bncaab\b|college\s+basketball/i },
];

function competitionToLeagueId(name) {
  const s = String(name || '');
  for (const row of LEAGUE_MATCHERS) {
    if (row.re.test(s)) return row.id;
  }
  return 'other';
}

function msToClock(ms) {
  if (ms == null || ms === '') return '';
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '';
  const total = Math.round(n / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parsePeriod(details = {}) {
  const label = String(details.period || '');
  if (/ht|half/i.test(label)) {
    return { period: 2, isHalftime: true, status: 'halftime' };
  }
  const q = label.match(/^Q(\d+)$/i);
  if (q) return { period: Number(q[1]), isHalftime: false, status: 'in_progress' };
  const h = label.match(/^H(\d+)$/i);
  if (h) return { period: Number(h[1]), isHalftime: false, status: 'in_progress' };
  const ot = label.match(/^OT(\d+)?$/i);
  if (ot) {
    const n = Number(ot[1] || 1);
    return { period: 4 + n, isHalftime: false, status: 'in_progress' };
  }
  const current = Number(details.currentPeriod) || 0;
  return { period: current, isHalftime: false, status: current ? 'in_progress' : 'in_progress' };
}

function abbrev(name) {
  const s = String(name || '').replace(/^(bc|bk|kk|fc)\s+/i, '').trim();
  return (s || name || '???').slice(0, 3).toUpperCase();
}

function splitMatchup(name) {
  const s = String(name || '');
  const parts = s.split(/\s+v(?:s\.?)?\s+/i);
  if (parts.length >= 2) {
    return { home: parts[0].trim(), away: parts.slice(1).join(' v ').trim() };
  }
  return { home: s, away: '' };
}

function teamFromSide(name, details, side) {
  const bag = details?.[side] || {};
  return {
    id: '',
    abbrev: abbrev(name),
    name: name || (side === 'home' ? 'Home' : 'Away'),
    shortName: name || '',
    logo: '',
    score: Number(bag.score) || 0,
    record: '',
    qScores: Array.isArray(bag.pointsPerPeriod) ? bag.pointsPerPeriod.map((n) => Number(n) || 0) : [],
  };
}

function moneylineSides(markets, eventId) {
  const list = Object.values(markets || {});
  const ml = list.find((m) => {
    if (Number(m.eventId) !== Number(eventId)) return false;
    const type = String(m.marketType || '').toUpperCase();
    const nm = String(m.marketName || '').toLowerCase();
    return type === 'MONEY_LINE' || nm === 'moneyline';
  });
  if (!ml) return null;
  let home = '';
  let away = '';
  for (const r of ml.runners || []) {
    const side = String(r.result?.type || '').toUpperCase();
    if (side === 'HOME') home = r.runnerName;
    if (side === 'AWAY') away = r.runnerName;
  }
  if (!home && !away) return null;
  return { home, away };
}

function totalLine(markets, eventId) {
  const m = Object.values(markets || {}).find((x) => Number(x.eventId) === Number(eventId)
    && String(x.marketType || '').toUpperCase() === 'TOTAL_POINTS_(OVER/UNDER)');
  if (!m) return null;
  const over = (m.runners || []).find((r) => String(r.result?.type || '').toUpperCase() === 'OVER');
  const under = (m.runners || []).find((r) => String(r.result?.type || '').toUpperCase() === 'UNDER');
  const line = Number(over?.handicap ?? under?.handicap);
  if (!Number.isFinite(line) || line <= 0) return null;
  const odds = (r) => r?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null;
  return { line, over: odds(over), under: odds(under), status: m.marketStatus || null };
}

function basketballEvents(inPlay) {
  const atts = inPlay?.attachments || {};
  const events = Object.values(atts.events || {});
  return events.filter((e) => Number(e.eventTypeId) === BASKETBALL_EVENT_TYPE);
}

function liveByEventId(liveData) {
  const map = new Map();
  for (const row of liveData || []) {
    if (!row || row.eventId == null) continue;
    map.set(Number(row.eventId), row);
  }
  return map;
}

function mapLiveBasketball(inPlay, liveData) {
  const atts = inPlay?.attachments || {};
  const competitions = atts.competitions || {};
  const markets = atts.markets || {};
  const liveMap = liveByEventId(liveData);
  const games = [];
  for (const event of basketballEvents(inPlay)) {
    const live = liveMap.get(Number(event.eventId));
    if (live && live.modelType && String(live.modelType).toLowerCase() !== 'basketball') continue;
    const details = live?.basketballDetails || null;
    if (!details) continue;
    const comp = competitions[event.competitionId] || competitions[String(event.competitionId)] || {};
    const leagueName = comp.name || 'Basketball';
    const leagueId = competitionToLeagueId(leagueName);
    const league = getLeague(leagueId) || { id: leagueId, name: leagueName, abbrev: 'BK', clock: FIBA_40 };
    const sides = moneylineSides(markets, event.eventId) || splitMatchup(event.name);
    const parsed = details ? parsePeriod(details) : { period: 0, isHalftime: false, status: 'in_progress' };
    const clock = details ? msToClock(details.periodRemainingTimeMilliseconds) : '';
    const game = {
      id: `fd:${leagueId}:${event.eventId}`,
      sourceId: String(event.eventId),
      source: 'fanduel',
      leagueId,
      leagueName: league.id === 'other' ? leagueName : league.name,
      leagueAbbrev: league.id === 'other' ? (leagueName.split(/\s+/).filter(Boolean).pop() || 'BK').slice(0, 4).toUpperCase() : league.abbrev,
      name: event.name,
      shortName: `${sides.away || 'Away'} @ ${sides.home || 'Home'}`,
      status: parsed.status,
      statusDetail: details?.period || 'Live',
      period: parsed.period,
      clock,
      isHalftime: parsed.isHalftime,
      date: event.openDate || new Date().toISOString(),
      home: teamFromSide(sides.home, details, 'home'),
      away: teamFromSide(sides.away, details, 'away'),
      isVirtual: false,
      fdTotal: totalLine(markets, event.eventId),
    };
    game.periodText = periodLabel(game.period, league, { isHalftime: game.isHalftime, status: game.status });
    if (isVirtualGame({ ...game, leagueName })) continue;
    games.push(game);
  }
  return games;
}

async function fetchInPlay() {
  return fdClient.inPlay();
}

async function fetchLiveData(eventIds) {
  return fdClient.liveData(eventIds);
}

async function listLiveGames() {
  try {
    const inPlay = await fetchInPlay();
    const events = basketballEvents(inPlay);
    const live = await fetchLiveData(events.map((e) => e.eventId));
    const games = mapLiveBasketball(inPlay, live);
    return { games, ok: true, liveCount: games.length, error: null };
  } catch (err) {
    console.log(`[fanduelLive] ${err.message}`);
    return { games: [], ok: false, liveCount: 0, error: err.message };
  }
}

async function getLiveGame(leagueId, eventId) {
  const { games, error } = await listLiveGames();
  const hit = games.find((g) => g.sourceId === String(eventId))
    || games.find((g) => g.id === `fd:${leagueId}:${eventId}`);
  if (hit) return hit;
  if (error) {
    const err = new Error(error);
    throw err;
  }
  return null;
}

function enabled() {
  return true;
}

module.exports = {
  enabled,
  listLiveGames,
  getLiveGame,
  mapLiveBasketball,
  msToClock,
  competitionToLeagueId,
  BASKETBALL_EVENT_TYPE,
};
