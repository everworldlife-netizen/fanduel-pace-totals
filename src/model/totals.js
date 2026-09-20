const {
  elapsedGameMinutes,
  remainingInPeriodMinutes,
  remainingScheduledMinutes,
  halfLength,
} = require('./clock');
const {
  teamPossessions,
  hasBoxStats,
  gamePossessions,
  combinedPossessions,
  livePace,
  pointsPerPossession,
} = require('./possessions');
const { isVirtualGame } = require('./virtual');

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function blend(observed, prior, weight) {
  const w = clamp(weight, 0, 1);
  return w * observed + (1 - w) * prior;
}

function remainingPaceFactor(period, clock, league, scoreDiff) {
  const cfg = league.clock || league;
  if (period > cfg.periods) return 1.05;
  let factor = 1;
  const abs = Math.abs(scoreDiff || 0);
  if (abs >= cfg.blowoutMargin) factor *= 0.92;
  else if (abs >= cfg.blowoutMargin * 0.72) factor *= 0.96;
  else if (abs <= 5 && period >= cfg.periods) factor *= 1.03;
  return factor;
}

/**
 * Build a live pace / PPP snapshot from score, clock, and optional box stats.
 */
function buildSnapshot(game, league) {
  const cfg = league.clock || league;
  const homeScore = Number(game.home?.score) || 0;
  const awayScore = Number(game.away?.score) || 0;
  const totalScore = homeScore + awayScore;
  const period = Number(game.period) || 0;
  const clock = game.clock || '0:00';
  const isHalftime = game.status === 'halftime' || game.isHalftime;
  const isFinal = game.status === 'final';
  let elapsed = elapsedGameMinutes(period, clock, league, { isHalftime });
  let remaining = remainingScheduledMinutes(period, clock, league, { isHalftime });
  let remainPeriod = remainingInPeriodMinutes(period, clock, league, { isHalftime });
  if (isFinal) {
    const otPeriods = Math.max(period - cfg.periods, 0);
    elapsed = cfg.regulationMinutes + otPeriods * cfg.otMinutes;
    remaining = 0;
    remainPeriod = 0;
  }
  const virtual = isVirtualGame(game);

  const homeBox = game.box?.home || null;
  const awayBox = game.box?.away || null;
  const boxOk = hasBoxStats(homeBox) && hasBoxStats(awayBox);
  const gp = gamePossessions(homeBox, awayBox);
  const combined = combinedPossessions(homeBox, awayBox);

  let source = 'score_clock';
  let observedPace;
  let observedPPP;

  if (boxOk && gp != null && (elapsed >= 1 || isFinal)) {
    source = 'box';
    observedPace = livePace(gp, Math.max(elapsed, 1), cfg.regulationMinutes);
    observedPPP = pointsPerPossession(totalScore, combined);
  } else if ((elapsed >= 1 || isFinal) && totalScore > 0) {
    source = 'score_clock';
    const ptsPerReg = (totalScore / elapsed) * cfg.regulationMinutes;
    observedPPP = cfg.avgPPP;
    observedPace = ptsPerReg / (2 * cfg.avgPPP);
  } else {
    source = 'prior';
    observedPace = cfg.avgPace;
    observedPPP = cfg.avgPPP;
  }

  const paceWeight = elapsed < 6 ? elapsed / (elapsed + 6) : clamp(elapsed / (elapsed + 4), 0, 1);
  const pppWeight = elapsed < 8 ? elapsed / 8 : clamp((elapsed - 4) / (cfg.regulationMinutes / 2), 0.35, 1);

  const pace = clamp(
    blend(observedPace || cfg.avgPace, cfg.avgPace, source === 'prior' ? 0 : paceWeight),
    cfg.avgPace * 0.7,
    cfg.avgPace * 1.35
  );
  const ppp = clamp(
    blend(observedPPP || cfg.avgPPP, cfg.avgPPP, source === 'score_clock' ? 0 : pppWeight),
    0.75,
    1.45
  );

  const scoreDiff = homeScore - awayScore;
  const paceFactor = remainingPaceFactor(period, clock, league, scoreDiff);
  const projectedGamePoss = pace; // poss per regulation
  const remainingGamePoss = remaining > 0
    ? (pace * remaining) / cfg.regulationMinutes * paceFactor
    : 0;
  const remainingPoints = remainingGamePoss * 2 * ppp;
  const fairGameTotal = isFinal ? totalScore : totalScore + remainingPoints;

  const homeShareRaw = totalScore > 0 ? homeScore / totalScore : 0.5;
  const shareShrink = elapsed < 12 ? elapsed / 12 : 1;
  const homeShare = blend(homeShareRaw, 0.5, shareShrink);

  return {
    source,
    boxOk,
    virtual,
    elapsed: round1(elapsed),
    remaining: round1(remaining),
    remainPeriod: round1(remainPeriod),
    period,
    clock,
    totalScore,
    homeScore,
    awayScore,
    scoreDiff,
    gamePossessions: gp != null ? round1(gp) : null,
    homePossessions: hasBoxStats(homeBox) ? round1(teamPossessions(homeBox)) : null,
    awayPossessions: hasBoxStats(awayBox) ? round1(teamPossessions(awayBox)) : null,
    pace: round1(pace),
    ppp: round2(ppp),
    projectedGamePoss: round1(projectedGamePoss),
    remainingGamePoss: round1(remainingGamePoss),
    remainingPoints: round1(remainingPoints),
    fairGameTotal: round1(fairGameTotal),
    homeShare: round2(homeShare),
    inOt: period > cfg.periods,
    isHalftime,
    leagueId: league.id,
    regulationMinutes: cfg.regulationMinutes,
  };
}

function currentPeriodPoints(game, side) {
  const scores = game[side]?.qScores || [];
  const period = Number(game.period) || 0;
  if (period <= 0) return 0;
  if (scores[period - 1] != null) return Number(scores[period - 1]) || 0;
  return null;
}

function firstHalfPoints(game, league) {
  const cfg = league.clock || league;
  const take = cfg.usesHalves ? 1 : 2;
  const sumSide = (side) => {
    const scores = game[side]?.qScores || [];
    if (!scores.length) return null;
    let s = 0;
    for (let i = 0; i < Math.min(take, scores.length); i += 1) s += Number(scores[i]) || 0;
    return s;
  };
  const h = sumSide('home');
  const a = sumSide('away');
  if (h == null || a == null) return null;
  return h + a;
}

function fairQuarterTotal(snapshot, game, league) {
  const cfg = league.clock || league;
  if (snapshot.isHalftime || snapshot.period <= 0) return null;
  if (game.status === 'final') return null;
  const homeQ = currentPeriodPoints(game, 'home');
  const awayQ = currentPeriodPoints(game, 'away');
  const qSoFar = homeQ == null || awayQ == null ? null : homeQ + awayQ;
  const remain = snapshot.remainPeriod;
  const remainPoss = (snapshot.pace * remain) / cfg.regulationMinutes;
  const remainPts = remainPoss * 2 * snapshot.ppp;
  if (qSoFar == null) {
    return {
      available: false,
      reason: 'No period scores yet — cannot project the current quarter total',
      remaining: round1(remainPts),
      period: snapshot.period,
    };
  }
  return {
    available: true,
    estimatedQuarterPoints: false,
    fair: round1(qSoFar + remainPts),
    soFar: qSoFar,
    remaining: round1(remainPts),
    period: snapshot.period,
  };
}

function fairHalfTotal(snapshot, game, league) {
  const cfg = league.clock || league;
  const half = halfLength(league);
  const hSoFar = firstHalfPoints(game, league);
  if (snapshot.elapsed >= half - 0.05) {
    if (hSoFar == null) return { available: false, settled: true, reason: 'First half over; no period scores' };
    return { available: true, settled: true, fair: hSoFar, soFar: hSoFar, remaining: 0 };
  }
  const remainHalf = Math.max(half - snapshot.elapsed, 0);
  const remainPoss = (snapshot.pace * remainHalf) / cfg.regulationMinutes;
  const remainPts = remainPoss * 2 * snapshot.ppp;
  const soFar = snapshot.totalScore;
  return {
    available: true,
    settled: false,
    fair: round1(soFar + remainPts),
    soFar,
    remaining: round1(remainPts),
  };
}

function confidence(snapshot, league, { endOfPeriod = false } = {}) {
  if (snapshot.virtual) return 'LOW';
  const cfg = league.clock || league;
  if (snapshot.source !== 'box') return 'LOW';
  if (snapshot.elapsed < cfg.lowElapsed) return 'LOW';
  if (endOfPeriod && snapshot.remainPeriod < 0.4 && snapshot.period <= cfg.periods) return 'LOW';
  if (snapshot.elapsed >= cfg.highElapsed && snapshot.boxOk) return 'HIGH';
  if (snapshot.elapsed >= cfg.medElapsed) return 'MED';
  return 'LOW';
}

function garbageTime(snapshot, league) {
  const cfg = league.clock || league;
  return Math.abs(snapshot.scoreDiff) >= cfg.blowoutMargin && snapshot.remaining <= cfg.garbageRemain;
}

function foulUpRisk(snapshot) {
  return snapshot.remaining <= 2 && Math.abs(snapshot.scoreDiff) <= 8 && snapshot.period > 0;
}

module.exports = {
  buildSnapshot,
  fairQuarterTotal,
  fairHalfTotal,
  confidence,
  garbageTime,
  foulUpRisk,
  remainingPaceFactor,
  clamp,
  round1,
  round2,
  blend,
};
