const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildSnapshot } = require('../src/model/totals');
const { evaluate, parseLine, PASS_EDGE } = require('../src/model/advice');
const { isVirtualGame } = require('../src/model/virtual');
const { LEAGUES } = require('../src/leagues');

function liveNba(overrides = {}) {
  return {
    status: 'in_progress',
    period: 3,
    clock: '6:00',
    home: { abbrev: 'TOR', name: 'Raptors', score: 60, qScores: [22, 20, 18] },
    away: { abbrev: 'MIA', name: 'Heat', score: 55, qScores: [20, 18, 17] },
    box: {
      home: { fga: 50, fta: 10, orb: 6, to: 8, pts: 60 },
      away: { fga: 48, fta: 12, orb: 5, to: 9, pts: 55 },
    },
    ...overrides,
  };
}

describe('fair total + edge', () => {
  it('does not invent a FanDuel line', () => {
    const out = evaluate(liveNba(), LEAGUES.nba, {});
    assert.equal(out.markets[0].line, null);
    assert.equal(out.markets[0].call, null);
    assert.match(out.markets[0].reason, /No FanDuel line/);
  });

  it('fair total is score plus remaining points from pace/PPP', () => {
    const snap = buildSnapshot(liveNba(), LEAGUES.nba);
    assert.ok(snap.boxOk);
    assert.equal(snap.elapsed, 30);
    assert.equal(snap.remaining, 18);
    assert.ok(snap.fairGameTotal > snap.totalScore);
    assert.equal(snap.totalScore, 115);
  });

  it('Over when fair is well above the pasted line', () => {
    const snap = buildSnapshot(liveNba(), LEAGUES.nba);
    const out = evaluate(liveNba(), LEAGUES.nba, { gameTotal: snap.fairGameTotal - 4 });
    const m = out.markets[0];
    assert.equal(m.call, 'Over');
    assert.ok(m.edge >= PASS_EDGE);
  });

  it('Under when fair is well below the pasted line', () => {
    const snap = buildSnapshot(liveNba(), LEAGUES.nba);
    const out = evaluate(liveNba(), LEAGUES.nba, { gameTotal: snap.fairGameTotal + 4 });
    assert.equal(out.markets[0].call, 'Under');
    assert.ok(out.markets[0].edge <= -PASS_EDGE);
  });

  it('Pass when |edge| < 1.5', () => {
    const snap = buildSnapshot(liveNba(), LEAGUES.nba);
    const out = evaluate(liveNba(), LEAGUES.nba, { gameTotal: snap.fairGameTotal + 0.4 });
    assert.equal(out.markets[0].call, 'Pass');
  });

  it('Pass and LOW when only score+clock (no box)', () => {
    const g = liveNba({ box: null, period: 1, clock: '8:00', home: { score: 12, qScores: [12] }, away: { score: 10, qScores: [10] } });
    const out = evaluate(g, LEAGUES.nba, { gameTotal: 220 });
    assert.equal(out.confidence, 'LOW');
    assert.equal(out.markets[0].call, 'Pass');
    assert.equal(out.snapshot.source, 'score_clock');
  });

  it('Pass on eBasketball even with a fat edge', () => {
    const g = liveNba({ away: { abbrev: 'eMIA', name: 'eBasketball Heat', score: 70 }, home: { abbrev: 'eTOR', name: 'Virtual Raptors', score: 80 } });
    assert.equal(isVirtualGame(g), true);
    const snap = buildSnapshot(g, LEAGUES.nba);
    const out = evaluate(g, LEAGUES.nba, { gameTotal: snap.fairGameTotal - 10 });
    assert.equal(out.markets[0].call, 'Pass');
    assert.equal(out.confidence, 'LOW');
  });

  it('Pass in garbage time', () => {
    const g = liveNba({
      period: 4,
      clock: '3:00',
      home: { abbrev: 'TOR', score: 110, qScores: [30, 28, 30, 22] },
      away: { abbrev: 'MIA', score: 80, qScores: [20, 22, 20, 18] },
    });
    const out = evaluate(g, LEAGUES.nba, { gameTotal: 200 });
    assert.equal(out.flags.garbage, true);
    assert.equal(out.markets[0].call, 'Pass');
  });

  it('parseLine strips junk and rejects empty', () => {
    assert.equal(parseLine('o 218.5'), 218.5);
    assert.equal(parseLine(''), null);
    assert.equal(parseLine('abc'), null);
  });

  it('early sample shrinks PPP toward league average', () => {
    const early = liveNba({
      period: 1,
      clock: '8:00',
      home: { abbrev: 'TOR', score: 28, qScores: [28] },
      away: { abbrev: 'MIA', score: 24, qScores: [24] },
      box: {
        home: { fga: 12, fta: 2, orb: 1, to: 1, pts: 28 },
        away: { fga: 11, fta: 2, orb: 1, to: 2, pts: 24 },
      },
    });
    const snap = buildSnapshot(early, LEAGUES.nba);
    assert.equal(snap.source, 'box');
    assert.ok(snap.elapsed < 8);
    const homeP = 12 + 0.44 * 2 - 1 + 1;
    const awayP = 11 + 0.44 * 2 - 1 + 2;
    const observed = 52 / (homeP + awayP);
    assert.ok(snap.ppp < observed);
    assert.ok(snap.ppp > LEAGUES.nba.clock.avgPPP);
  });

  it('HIGH confidence on a complete box after 24 NBA minutes', () => {
    const out = evaluate(liveNba(), LEAGUES.nba, { gameTotal: 220 });
    assert.equal(out.confidence, 'HIGH');
  });

  it('final games use the actual score as fair total', () => {
    const g = liveNba({
      status: 'final',
      period: 4,
      clock: '0:00',
      home: { abbrev: 'TOR', score: 110, qScores: [28, 26, 30, 26] },
      away: { abbrev: 'MIA', score: 102, qScores: [24, 28, 22, 28] },
    });
    const snap = buildSnapshot(g, LEAGUES.nba);
    assert.equal(snap.fairGameTotal, 212);
    assert.equal(snap.remaining, 0);
    assert.equal(snap.source, 'box');
    const out = evaluate(g, LEAGUES.nba, { gameTotal: 220 });
    assert.equal(out.markets[0].call, 'Under');
    assert.equal(out.markets[0].fair, 212);
  });

  it('team totals split remaining points with share shrink', () => {
    const snap = buildSnapshot(liveNba(), LEAGUES.nba);
    const out = evaluate(liveNba(), LEAGUES.nba, {
      gameTotal: snap.fairGameTotal,
      awayTotal: 90,
      homeTotal: 100,
    });
    const away = out.markets.find((m) => m.id === 'away');
    const home = out.markets.find((m) => m.id === 'home');
    assert.ok(away.fair > 55);
    assert.ok(home.fair > 60);
    assert.ok(Math.abs(away.fair + home.fair - snap.fairGameTotal) < 0.3);
  });
});
