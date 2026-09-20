const { fetchJSON } = require('../espn/client');
const { getLeague } = require('../leagues');
const { isVirtualGame } = require('../model/virtual');
const { periodLabel } = require('../model/clock');

const ROOT = 'https://api-live.euroleague.net/v2';
const LIVE_BOX = 'https://live.euroleague.net/api/Boxscore';

function seasonCode(competitionCode, year) {
  return `${competitionCode}${year}`;
}

function currentSeasonYear(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  // EuroLeague season codes are the start year; season runs Jul–Jun.
  return m >= 6 ? y : y - 1;
}

function windowFilter(utcDate, now = Date.now()) {
  const t = Date.parse(utcDate);
  if (!Number.isFinite(t)) return false;
  const ahead = 14 * 24 * 3600 * 1000;
  const behind = 14 * 3600 * 1000;
  return t >= now - behind && t <= now + ahead;
}

function inferStatus(g, now = Date.now()) {
  if (g.played) return 'final';
  const t = Date.parse(g.utcDate);
  const home = g.local?.score || 0;
  const away = g.road?.score || 0;
  if (home + away > 0 && !g.played) return 'in_progress';
  if (Number.isFinite(t) && now >= t && now <= t + 2.5 * 3600 * 1000) return 'in_progress';
  return 'scheduled';
}

function periodFromPartials(local, road) {
  const keys = ['partials1', 'partials2', 'partials3', 'partials4'];
  let last = 0;
  keys.forEach((k, i) => {
    if ((local?.partials?.[k] || 0) + (road?.partials?.[k] || 0) > 0) last = i + 1;
  });
  const extras = Object.keys(local?.partials?.extraPeriods || {});
  if (extras.length) return 4 + extras.length;
  return last;
}

function qScores(side) {
  const p = side?.partials || {};
  const qs = [p.partials1, p.partials2, p.partials3, p.partials4].map((n) => n || 0);
  const extras = p.extraPeriods || {};
  Object.keys(extras).sort().forEach((k) => qs.push(extras[k] || 0));
  return qs;
}

function teamFrom(side) {
  const club = side.club || {};
  return {
    id: club.code || '',
    abbrev: club.tvCode || club.code || '',
    name: club.name || club.abbreviatedName || '',
    shortName: club.abbreviatedName || club.editorialName || club.code || '',
    logo: club.images?.crest || '',
    score: side.score || 0,
    record: '',
    qScores: qScores(side),
    isVirtual: club.isVirtual === true,
  };
}

function normalizeGame(g, league) {
  const home = teamFrom(g.local || {});
  const away = teamFrom(g.road || {});
  const status = inferStatus(g);
  const period = status === 'scheduled' ? 0 : periodFromPartials(g.local, g.road) || (status === 'final' ? 4 : 1);
  const game = {
    id: `euro:${league.id}:${g.season?.code || ''}:${g.gameCode}`,
    sourceId: String(g.gameCode),
    seasonCode: g.season?.code,
    competitionCode: g.season?.competitionCode || league.euroCode,
    source: 'euroleague',
    leagueId: league.id,
    leagueName: league.name,
    leagueAbbrev: league.abbrev,
    name: `${away.name} at ${home.name}`,
    shortName: `${away.abbrev} @ ${home.abbrev}`,
    status,
    statusDetail: g.roundName || g.gameStatus || '',
    period,
    clock: status === 'in_progress' ? '' : '0:00',
    isHalftime: false,
    date: g.utcDate,
    home,
    away,
    isVirtual: home.isVirtual || away.isVirtual,
    played: g.played,
  };
  game.periodText = periodLabel(period, league, { status });
  if (isVirtualGame(game)) return null;
  return game;
}

async function listSeasonGames(leagueId) {
  const league = getLeague(leagueId);
  if (!league?.euroCode) return [];
  const year = currentSeasonYear();
  const code = seasonCode(league.euroCode, year);
  const url = `${ROOT}/competitions/${league.euroCode}/seasons/${code}/games`;
  try {
    const raw = await fetchJSON(url, `euro:season:${leagueId}:${code}`, 15 * 60 * 1000);
    const games = (raw.data || []).map((g) => normalizeGame(g, league)).filter(Boolean);
    return games.filter((g) => windowFilter(g.date) || g.status === 'in_progress');
  } catch (err) {
    console.log(`[euro] ${leagueId} ${err.message}`);
    return [];
  }
}

function boxFromTotals(total) {
  if (!total) return null;
  return {
    fgm: total.fieldGoalsMadeTotal || 0,
    fga: total.fieldGoalsAttemptedTotal || 0,
    tpm: total.fieldGoalsMade3 || 0,
    tpa: total.fieldGoalsAttempted3 || 0,
    ftm: total.freeThrowsMade || 0,
    fta: total.freeThrowsAttempted || 0,
    reb: total.totalRebounds || 0,
    orb: total.offensiveRebounds || 0,
    drb: total.defensiveRebounds || 0,
    ast: total.assistances || 0,
    to: total.turnovers || 0,
    pf: total.foulsCommited || 0,
    pts: total.points || 0,
    timePlayedSec: total.timePlayed || 0,
  };
}

function clockFromBox(box, league, status) {
  if (status === 'final') return { period: league.clock.periods, clock: '0:00', elapsedSec: league.clock.regulationMinutes * 60 };
  const sec = box?.home?.timePlayedSec || box?.away?.timePlayedSec || 0;
  if (!sec) return null;
  const elapsedMin = sec / 60;
  const { periodMinutes, periods, otMinutes } = league.clock;
  let remaining = elapsedMin;
  let period = 1;
  for (let p = 1; p <= periods; p += 1) {
    if (remaining > periodMinutes + 0.02) {
      remaining -= periodMinutes;
      period = p + 1;
    } else {
      period = p;
      const left = Math.max(periodMinutes - remaining, 0);
      const m = Math.floor(left);
      const s = Math.round((left - m) * 60);
      return { period, clock: `${m}:${String(s).padStart(2, '0')}`, elapsedSec: sec };
    }
  }
  const otIndex = Math.floor((elapsedMin - league.clock.regulationMinutes) / otMinutes) + 1;
  period = periods + Math.max(otIndex, 1);
  const intoOt = elapsedMin - league.clock.regulationMinutes - (Math.max(otIndex, 1) - 1) * otMinutes;
  const left = Math.max(otMinutes - intoOt, 0);
  const m = Math.floor(left);
  const s = Math.round((left - m) * 60);
  return { period, clock: `${m}:${String(s).padStart(2, '0')}`, elapsedSec: sec };
}

async function getGameDetail(leagueId, seasonCodeStr, gameCode) {
  const league = getLeague(leagueId);
  const code = seasonCodeStr || seasonCode(league.euroCode, currentSeasonYear());
  const statsUrl = `${ROOT}/competitions/${league.euroCode}/seasons/${code}/games/${gameCode}/stats`;
  const gameUrl = `${ROOT}/competitions/${league.euroCode}/seasons/${code}/games/${gameCode}`;
  const [stats, meta] = await Promise.all([
    fetchJSON(statsUrl, `euro:stats:${code}:${gameCode}`, 20000).catch(() => null),
    fetchJSON(gameUrl, `euro:game:${code}:${gameCode}`, 20000),
  ]);
  const game = normalizeGame(meta, league);
  if (!game) throw new Error('Virtual or missing EuroLeague game');
  const box = stats
    ? { home: boxFromTotals(stats.local?.total), away: boxFromTotals(stats.road?.total) }
    : { home: null, away: null };
  const clockInfo = clockFromBox(box, league, game.status);
  if (clockInfo && game.status !== 'scheduled') {
    game.period = clockInfo.period;
    game.clock = clockInfo.clock;
    game.periodText = periodLabel(clockInfo.period, league, { status: game.status });
  }
  game.box = box;

  try {
    const liveBox = await fetchJSON(
      `${LIVE_BOX}?gamecode=${gameCode}&seasoncode=${code}`,
      `euro:livebox:${code}:${gameCode}`,
      20000
    );
    if (liveBox?.Live) {
      game.status = 'in_progress';
    }
    if (Array.isArray(liveBox?.ByQuarter) && liveBox.ByQuarter.length >= 2) {
      // API lists home (local) first typically matching team names
      const byName = {};
      for (const row of liveBox.ByQuarter) {
        byName[row.Team] = [row.Quarter1, row.Quarter2, row.Quarter3, row.Quarter4];
      }
      const homeQ = byName[game.home.name] || byName[String(game.home.name).toUpperCase()];
      const awayQ = byName[game.away.name] || byName[String(game.away.name).toUpperCase()];
      if (homeQ) game.home.qScores = homeQ;
      if (awayQ) game.away.qScores = awayQ;
    }
  } catch {
    // live boxscore host is optional
  }
  return game;
}

module.exports = { listSeasonGames, getGameDetail, currentSeasonYear, windowFilter };
