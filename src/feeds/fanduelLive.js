/**
 * FanDuel Sportsbook public sbapi — live basketball events (no key).
 * Lists the same in-play basketball board FanDuel shows; filters eBasketball.
 * Scores/clock are often not in this payload — client can paste them; totals line
 * is taken from FanDuel markets when present.
 */
const cache = require('../cache');

const AK = process.env.FANDUEL_AK || 'FhMFpcPWXMeyZxOx';
const REGION = process.env.FANDUEL_REGION || 'NJ';
const EVENT_TYPE_BASKETBALL = 7522;
const TTL = 20 * 1000;

const COMP_TO_LEAGUE = [
  { match: /german\s*bbl|basketball\s*bundesliga|^bbl$/i, id: 'bbl' },
  { match: /lithuania|lkl/i, id: 'lkl' },
  { match: /fiba\s*champions|basketball\s*champions|^bcl$/i, id: 'bcl' },
  { match: /lnbp|mexico/i, id: 'lnbp' },
  { match: /australian\s*nbl|^nbl$/i, id: 'nbl' },
  { match: /euroleague/i, id: 'euroleague' },
  { match: /eurocup/i, id: 'eurocup' },
  { match: /^nba$/i, id: 'nba' },
  { match: /wnba/i, id: 'wnba' },
  { match: /ncaa|college/i, id: 'ncaam' },
];

function isVirtualCompetition(name = '') {
  const n = String(name).toLowerCase();
  return (
    n.includes('ebasketball') ||
    n.includes('e-basketball') ||
    n.includes('gg league') ||
    n.includes('h2h gg') ||
    n.includes('virtual')
  );
}

function isVirtualEventName(name = '') {
  // FanDuel sims often use parenthetical codenames on NBA team names
  return /\([A-Z]{3,}\)\s*@/.test(name) || /\([A-Z]{3,}\)$/.test(name);
}

function mapCompetition(compName) {
  for (const row of COMP_TO_LEAGUE) {
    if (row.match.test(compName || '')) return row.id;
  }
  return 'bbl'; // generic international FIBA-clock fallback for unknown FanDuel comps
}

function splitName(name) {
  const parts = String(name).split(/\s+v(?:s)?\.?\s+/i);
  if (parts.length === 2) return { home: parts[0].trim(), away: parts[1].trim() };
  const at = String(name).split(/\s+@\s+/);
  if (at.length === 2) return { home: at[1].trim(), away: at[0].trim() };
  return { home: name, away: '' };
}

function abbrev(name) {
  const words = String(name).replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '???';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return (words[0][0] + words[words.length - 1].slice(0, 2)).toUpperCase();
}

function extractTotal(markets, eventId) {
  const list = Object.values(markets || {}).filter((m) => String(m.eventId) === String(eventId));
  const total = list.find((m) => /total points/i.test(m.marketName || '') && !/team|1st|2nd|quarter|half/i.test(m.marketName || ''));
  if (!total) return null;
  const over = (total.runners || []).find((r) => /over/i.test(r.runnerName || ''));
  const under = (total.runners || []).find((r) => /under/i.test(r.runnerName || ''));
  const line = over?.handicap ?? under?.handicap;
  if (line == null) return null;
  return {
    line: Number(line),
    overOdds: over?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
    underOdds: under?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
    marketName: total.marketName,
  };
}

async function fetchInPlay() {
  const cacheKey = `fd:inplay:${EVENT_TYPE_BASKETBALL}:${REGION}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const url = `https://api.sportsbook.fanduel.com/sbapi/in-play?eventTypeId=${EVENT_TYPE_BASKETBALL}&_ak=${AK}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 PaceTotals/1.0',
      'x-sportsbook-region': REGION,
      Origin: 'https://sportsbook.fanduel.com',
      Referer: 'https://sportsbook.fanduel.com/live?tab=basketball',
    },
  });
  if (!res.ok) throw new Error(`FanDuel in-play HTTP ${res.status}`);
  const data = await res.json();
  cache.set(cacheKey, data, TTL);
  return data;
}

function normalize(data) {
  const att = data.attachments || {};
  const events = att.events || {};
  const comps = att.competitions || {};
  const markets = att.markets || {};
  const games = [];
  for (const ev of Object.values(events)) {
    const comp = comps[String(ev.competitionId)] || comps[ev.competitionId] || {};
    const compName = comp.name || '';
    if (isVirtualCompetition(compName) || isVirtualEventName(ev.name || '')) continue;
    const leagueId = mapCompetition(compName);
    const { home, away } = splitName(ev.name || '');
    const total = extractTotal(markets, ev.eventId);
    games.push({
      id: `fd:${leagueId}:${ev.eventId}`,
      sourceId: String(ev.eventId),
      source: 'fanduel',
      leagueId,
      leagueName: compName || leagueId.toUpperCase(),
      leagueAbbrev: (compName || leagueId).slice(0, 6).toUpperCase(),
      name: ev.name,
      shortName: `${abbrev(away)} @ ${abbrev(home)}`,
      status: 'in_progress',
      statusDetail: 'FanDuel live board',
      period: 0,
      clock: '',
      isHalftime: false,
      date: ev.openDate || null,
      home: { id: '', abbrev: abbrev(home), name: home, shortName: home, logo: '', score: 0, record: '', qScores: [] },
      away: { id: '', abbrev: abbrev(away), name: away, shortName: away, logo: '', score: 0, record: '', qScores: [] },
      fanduel: total,
      box: null,
      needsManualScore: true,
    });
  }
  return games;
}

async function listLiveGames() {
  try {
    const data = await fetchInPlay();
    return { games: normalize(data), error: null };
  } catch (err) {
    console.log(`[fanduel] ${err.message}`);
    return { games: [], error: err.message };
  }
}

module.exports = { listLiveGames, fetchInPlay, isVirtualCompetition };
