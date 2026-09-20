const { isVirtualGame } = require('./virtual');
const {
  buildSnapshot,
  fairQuarterTotal,
  fairHalfTotal,
  confidence,
  garbageTime,
  foulUpRisk,
  round1,
} = require('./totals');

const PASS_EDGE = 1.5;

function parseLine(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function callFor(fair, line, { conf, forcePass, settled }) {
  if (line == null) {
    return { call: null, edge: null, reason: 'No FanDuel line pasted' };
  }
  if (settled) {
    const edge = round1(fair - line);
    let call = 'Pass';
    if (Math.abs(edge) >= 0.5) call = edge > 0 ? 'Over' : 'Under';
    return { call, edge, reason: 'Market settled (actual vs pasted line)' };
  }
  const edge = round1(fair - line);
  if (forcePass || conf === 'LOW' || Math.abs(edge) < PASS_EDGE) {
    return { call: 'Pass', edge, reason: forcePass || conf === 'LOW' ? 'Pass: low confidence or risk flag' : 'Pass: |edge| < 1.5' };
  }
  return { call: edge > 0 ? 'Over' : 'Under', edge, reason: null };
}

function stakeHint(call, conf) {
  if (!call || call === 'Pass') return 'skip';
  if (conf === 'HIGH') return 'standard';
  if (conf === 'MED') return 'small';
  return 'skip';
}

function whyText(snapshot, league, market) {
  const paceUnit = snapshot.regulationMinutes;
  const bits = [];
  if (snapshot.source === 'box') {
    bits.push(`Box possessions ≈ ${snapshot.gamePossessions} so far (${snapshot.pace} poss/${paceUnit}, PPP ${snapshot.ppp}).`);
  } else {
    bits.push(`No usable box yet — score+clock only, pace blended toward ${league.name} average (${league.clock.avgPace} poss/${paceUnit}).`);
  }
  bits.push(`${snapshot.elapsed} min gone, ${snapshot.remaining} min of schedule left; projected remaining ${snapshot.remainingPoints} pts.`);
  if (market) bits.push(market);
  return bits.join(' ');
}

function risksText(snapshot, league, flags) {
  const risks = [];
  if (snapshot.virtual) risks.push('eBasketball/virtual — always Pass');
  if (snapshot.inOt) risks.push('Already in OT; totals include extra period variance');
  if (garbageTime(snapshot, league)) risks.push('Garbage time — benches / clock milking');
  if (foulUpRisk(snapshot)) risks.push('Foul-up / bonus free throws in last 2 min');
  if (snapshot.remainPeriod < 0.5 && snapshot.period > 0 && snapshot.remaining > 0.5) {
    risks.push('End-of-period heaves');
  }
  if (snapshot.source !== 'box') risks.push('Missing FGA/FTA/ORB/TO — LOW confidence');
  if (snapshot.elapsed < (league.clock.lowElapsed || 8)) risks.push('Tiny sample; shrinkage toward league PPP');
  if (!risks.length) risks.push('Normal variance; not a lock');
  return risks;
}

/**
 * @param {object} game live game + optional box
 * @param {object} league
 * @param {object} lines pasted FanDuel numbers only — never invented
 */
function evaluate(game, league, lines = {}) {
  const snapshot = buildSnapshot(game, league);
  const conf = confidence(snapshot, league, {
    endOfPeriod: snapshot.remainPeriod < 0.4 && snapshot.remaining > 0.5,
  });
  const virtual = snapshot.virtual || isVirtualGame(game);
  const garbage = garbageTime(snapshot, league);
  const fouls = foulUpRisk(snapshot);
  const settled = game.status === 'final';
  const forcePass = virtual || (!settled && (garbage || snapshot.inOt));

  const gameLine = parseLine(lines.gameTotal);
  const qLine = parseLine(lines.quarterTotal);
  const hLine = parseLine(lines.halfTotal);
  const awayLine = parseLine(lines.awayTotal);
  const homeLine = parseLine(lines.homeTotal);

  const flags = { virtual, garbage, fouls, ot: snapshot.inOt };

  const gameCall = callFor(snapshot.fairGameTotal, gameLine, { conf, forcePass, settled });
  const markets = [];

  markets.push({
    id: 'game',
    label: 'Game total',
    required: true,
    line: gameLine,
    fair: snapshot.fairGameTotal,
    ...gameCall,
    confidence: virtual ? 'LOW' : conf,
    stake: stakeHint(gameCall.call, conf),
    projectedFinal: snapshot.fairGameTotal,
  });

  if (qLine != null || lines.quarterTotal === 0) {
    const q = fairQuarterTotal(snapshot, game, league);
    if (q && q.available) {
      const qCall = callFor(q.fair, qLine, { conf, forcePass: forcePass || snapshot.remainPeriod < 0.35 });
      markets.push({
        id: 'quarter',
        label: `Current period total (${league.clock.usesHalves ? 'H' : 'Q'}${snapshot.period})`,
        line: qLine,
        fair: q.fair,
        ...qCall,
        confidence: conf === 'HIGH' ? 'MED' : conf,
        stake: stakeHint(qCall.call, 'MED'),
        soFar: q.soFar,
      });
    } else {
      markets.push({
        id: 'quarter',
        label: 'Current period total',
        line: qLine,
        fair: null,
        call: 'Pass',
        edge: null,
        confidence: 'LOW',
        stake: 'skip',
        reason: 'Clock/period unclear for a quarter market',
      });
    }
  }

  if (hLine != null) {
    const h = fairHalfTotal(snapshot, game, league);
    if (h.available) {
      const hCall = callFor(h.fair, hLine, { conf, forcePass: forcePass && !h.settled, settled: h.settled });
      markets.push({
        id: 'half',
        label: h.settled ? '1st half (settled)' : '1st half total',
        line: hLine,
        fair: h.fair,
        ...hCall,
        confidence: h.settled ? 'HIGH' : conf,
        stake: stakeHint(hCall.call, h.settled ? 'HIGH' : conf),
        settled: h.settled,
      });
    }
  }

  if (awayLine != null) {
    const remainAway = snapshot.remainingPoints * (1 - snapshot.homeShare);
    const fair = round1(snapshot.awayScore + remainAway);
    const c = callFor(fair, awayLine, { conf, forcePass });
    markets.push({
      id: 'away',
      label: `${game.away?.abbrev || 'Away'} team total`,
      line: awayLine,
      fair,
      ...c,
      confidence: conf,
      stake: stakeHint(c.call, conf),
    });
  }

  if (homeLine != null) {
    const remainHome = snapshot.remainingPoints * snapshot.homeShare;
    const fair = round1(snapshot.homeScore + remainHome);
    const c = callFor(fair, homeLine, { conf, forcePass });
    markets.push({
      id: 'home',
      label: `${game.home?.abbrev || 'Home'} team total`,
      line: homeLine,
      fair,
      ...c,
      confidence: conf,
      stake: stakeHint(c.call, conf),
    });
  }

  return {
    snapshot,
    confidence: virtual ? 'LOW' : conf,
    flags,
    markets,
    why: whyText(snapshot, league),
    risks: risksText(snapshot, league, flags),
    disclaimer: 'Companion analysis only. Not betting advice. Never a lock. Lines are whatever you pasted — this app does not scrape FanDuel.',
  };
}

module.exports = { evaluate, parseLine, callFor, PASS_EDGE, stakeHint };
