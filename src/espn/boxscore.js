const { fetchJSON } = require('./client');
const { getLeague } = require('../leagues');

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball';

function parseSplit(display) {
  if (display == null) return null;
  const s = String(display);
  if (!s.includes('-')) return null;
  const [a, b] = s.split('-').map(Number);
  return { made: a || 0, att: b || 0 };
}

function extractTeamStats(raw) {
  const byAbbrev = {};
  for (const teamGroup of raw.boxscore?.teams || []) {
    const abbrev = teamGroup.team?.abbreviation || '';
    if (!abbrev) continue;
    const stats = {};
    for (const item of teamGroup.statistics || []) {
      const name = item.name || '';
      const display = item.displayValue;
      if (name.includes('-') && typeof display === 'string' && display.includes('-')) {
        const [left, right] = name.split('-');
        const split = parseSplit(display);
        if (split) {
          stats[left] = split.made;
          stats[right] = split.att;
        }
      } else {
        stats[name] = parseFloat(display != null ? display : item.value) || 0;
      }
    }
    byAbbrev[abbrev] = {
      abbrev,
      name: teamGroup.team?.displayName || abbrev,
      fgm: stats.fieldGoalsMade || 0,
      fga: stats.fieldGoalsAttempted || 0,
      tpm: stats.threePointFieldGoalsMade || 0,
      tpa: stats.threePointFieldGoalsAttempted || 0,
      ftm: stats.freeThrowsMade || 0,
      fta: stats.freeThrowsAttempted || 0,
      reb: stats.totalRebounds || 0,
      orb: stats.offensiveRebounds || 0,
      drb: stats.defensiveRebounds || 0,
      ast: stats.assists || 0,
      to: stats.turnovers || stats.totalTurnovers || 0,
      pf: stats.fouls || stats.totalFouls || 0,
      pts: stats.points || 0,
    };
  }
  return byAbbrev;
}

function pickBox(statsMap, team) {
  if (!team) return null;
  return statsMap[team.abbrev] || Object.values(statsMap).find((s) => s.name === team.name) || null;
}

async function getBoxscore(leagueId, eventId) {
  const league = getLeague(leagueId);
  if (!league?.espnSlug) throw new Error(`No ESPN slug for ${leagueId}`);
  const url = `${BASE}/${league.espnSlug}/summary?event=${eventId}`;
  const raw = await fetchJSON(url, `espn:box:${leagueId}:${eventId}`, 20000);
  const header = raw.header?.competitions?.[0] || {};
  const statusObj = header.status || {};
  const statsMap = extractTeamStats(raw);

  let home = null;
  let away = null;
  for (const comp of header.competitors || []) {
    const team = {
      id: comp.team?.id || '',
      abbrev: comp.team?.abbreviation || '',
      name: comp.team?.displayName || '',
      shortName: comp.team?.shortDisplayName || '',
      logo: comp.team?.logo || '',
      score: parseInt(comp.score, 10) || 0,
      qScores: (comp.linescores || []).map((l) => parseInt(l.displayValue ?? l.value, 10) || 0),
    };
    if (comp.homeAway === 'home') home = team;
    else away = team;
  }

  const mappedStatus = statusObj.type?.name === 'STATUS_FINAL'
    ? 'final'
    : statusObj.type?.name === 'STATUS_HALFTIME'
      ? 'halftime'
      : statusObj.type?.name === 'STATUS_SCHEDULED'
        ? 'scheduled'
        : 'in_progress';

  let period = statusObj.period || 0;
  let clock = statusObj.displayClock || '0:00';
  if (mappedStatus === 'final') {
    const qs = Math.max(home?.qScores?.length || 0, away?.qScores?.length || 0);
    period = Math.max(period, qs, league.clock.periods);
    clock = '0:00';
  }
  if (mappedStatus === 'halftime' && !period) period = Math.ceil(league.clock.periods / 2);

  const homeBox = pickBox(statsMap, home);
  const awayBox = pickBox(statsMap, away);
  if (homeBox && !homeBox.pts) homeBox.pts = home?.score || 0;
  if (awayBox && !awayBox.pts) awayBox.pts = away?.score || 0;

  return {
    id: `espn:${leagueId}:${eventId}`,
    sourceId: String(eventId),
    source: 'espn',
    leagueId,
    leagueName: league.name,
    leagueAbbrev: league.abbrev,
    name: raw.header?.competitions?.[0] ? `${away?.name} at ${home?.name}` : '',
    shortName: `${away?.abbrev} @ ${home?.abbrev}`,
    status: mappedStatus,
    statusDetail: statusObj.type?.shortDetail || statusObj.type?.detail || '',
    period,
    clock,
    isHalftime: mappedStatus === 'halftime',
    date: raw.header?.competitions?.[0]?.date || raw.header?.season?.year,
    home,
    away,
    box: {
      home: homeBox,
      away: awayBox,
    },
  };
}

module.exports = { getBoxscore, extractTeamStats };
