const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const fdEb = require('../src/feeds/fanduelEb');
const h2h = require('../src/feeds/h2h');
const R = require('../src/model/ebRatings');
const M = require('../src/model/ebModel');
const P = require('../src/model/ebProfiles');
const tracker = require('../src/ebTracker');
const api = require('../src/api');
const store = require('../src/store');
const cache = require('../src/cache');

const TIP = Date.parse('2026-11-04T19:27:23Z');

function market(eventId, type, runners, status = 'OPEN', marketTime = '2026-11-04T19:27:23.000Z') {
  return {
    marketId: `734.${type}`,
    eventId,
    marketType: type,
    marketStatus: status,
    marketTime,
    runners: runners.map(([type2, handicap, odds, name]) => ({
      runnerName: name || type2,
      handicap,
      result: { type: type2 },
      winRunnerOdds: { americanDisplayOdds: { americanOddsInt: odds } },
    })),
  };
}

function fixtureInPlay() {
  const id = 36278574;
  return {
    attachments: {
      competitions: { 12687908: { name: 'eBasketball H2H GG League 4x5 Mins' }, 8347200: { name: 'Euroleague Women' } },
      events: {
        [id]: { eventId: id, eventTypeId: 7522, competitionId: 12687908, name: 'Boston Celtics (BULLSEYE) @ Los Angeles Lakers (TAAPZ)', openDate: '2026-11-04T19:27:00.000Z' },
        99: { eventId: 99, eventTypeId: 7522, competitionId: 8347200, name: 'Basket Schio Women v Galatasaray Women', openDate: '2026-11-04T19:00:00.000Z' },
      },
      markets: {
        a: market(id, 'TOTAL_POINTS_(OVER/UNDER)', [['OVER', 109.5, -120], ['UNDER', 109.5, -110]]),
        b: market(id, 'MONEY_LINE', [['AWAY', 0, -500, 'Boston Celtics (BULLSEYE)'], ['HOME', 0, 350, 'Los Angeles Lakers (TAAPZ)']]),
        c: market(id, '3RD_QUARTER_TOTAL_POINTS', [['OVER', 27.5, -115], ['UNDER', 27.5, -115]]),
      },
    },
  };
}

describe('FanDuel eBasketball feed', () => {
  it('parses "Team (PLAYER) @ Team (PLAYER)" with away first', () => {
    const s = fdEb.parseEventName('Boston Celtics (GENERAL) @ Oklahoma City Thunder (SILVER)');
    assert.deepEqual(s.away, { team: 'Boston Celtics', player: 'GENERAL' });
    assert.deepEqual(s.home, { team: 'Oklahoma City Thunder', player: 'SILVER' });
  });

  it('maps only eBasketball events, with lines and the quarter hint', () => {
    const live = [{ eventId: 36278574, basketballDetails: { home: { score: 24 }, away: { score: 36 }, currentPeriod: 0, period: '' } }];
    const rows = fdEb.mapBoard(fixtureInPlay(), live, TIP + 15 * 60000);
    assert.equal(rows.length, 1);
    const g = rows[0];
    assert.equal(g.id, 'eb:36278574');
    assert.equal(g.away.player, 'BULLSEYE');
    assert.equal(g.away.score, 36);
    assert.equal(g.home.score, 24);
    assert.equal(g.status, 'live');
    assert.equal(g.tipMs, TIP);
    assert.equal(g.lines.game.line, 109.5);
    assert.equal(g.lines.game.over, -120);
    assert.equal(g.lines.quarterHint, 3);
    assert.equal(g.lines.quarters[3].line, 27.5);
  });
});

describe('H2H timeline parsing', () => {
  const tl = {
    incidents: [
      { messageType: 'NBA_GOAL', period: { type: 'QUARTER', id: 1 }, runningScore: { team_a: 15, team_b: 13 } },
      { messageType: 'NBA_PERIOD_CHANGE', payload: { phase: 'ENDED' }, period: { type: 'QUARTER', id: 1 }, runningScore: { team_a: 15, team_b: 13 } },
      { messageType: 'NBA_PERIOD_CHANGE', payload: { phase: 'ENDED' }, period: { type: 'QUARTER', id: 2 }, runningScore: { team_a: 30, team_b: 35 } },
      { messageType: 'NBA_PERIOD_CHANGE', payload: { phase: 'ENDED' }, period: { type: 'QUARTER', id: 3 }, runningScore: { team_a: 41, team_b: 50 } },
      { messageType: 'NBA_PERIOD_CHANGE', payload: { phase: 'ENDED' }, period: { type: 'QUARTER', id: 4 }, runningScore: { team_a: 53, team_b: 66 } },
    ],
  };

  it('returns per-quarter points in schedule A/B order', () => {
    const p = h2h.parseTimeline(tl, { teamAScore: 53, teamBScore: 66 });
    assert.deepEqual(p.q, [[15, 13], [15, 22], [11, 15], [12, 16]]);
    assert.deepEqual(p.half, [30, 35]);
  });

  it('swaps sides when the timeline is inverted', () => {
    const p = h2h.parseTimeline(tl, { teamAScore: 66, teamBScore: 53 });
    assert.deepEqual(p.q[0], [13, 15]);
    assert.deepEqual(p.final, [66, 53]);
  });
});

describe('ratings + profiles', () => {
  const t0 = Date.parse('2026-11-01T00:00:00Z');
  const games = [];
  for (let i = 0; i < 60; i += 1) {
    games.push({ a: 'HIGH', b: `X${i % 5}`, teamA: 'Dallas Mavericks', teamB: 'Orlando Magic', sa: 66, sb: 60, t: t0 + i * 3600000 });
    games.push({ a: 'LOW', b: `X${i % 5}`, teamA: 'Dallas Mavericks', teamB: 'Orlando Magic', sa: 45, sb: 47, t: t0 + i * 3600000 });
  }

  it('separates high- and low-scoring gamers', () => {
    const m = R.fitRatings(games, { now: t0 + 61 * 3600000 });
    const hi = R.predictGame(m, { a: 'HIGH', b: 'X1' }).total;
    const lo = R.predictGame(m, { a: 'LOW', b: 'X1' }).total;
    assert.ok(hi - lo > 15, `expected spread, got ${hi} vs ${lo}`);
    assert.equal(R.predictGame(m, { a: 'NOBODY', b: 'X1' }).known, 1);
  });

  it('builds last-10 first-half profiles and quarter shapes', () => {
    const qGames = games.slice(0, 24).map((g, i) => ({ ...g, id: `g${i}`, q: [[16, 15], [16, 15], [17, 15], [17, 15]] }));
    const prof = P.buildProfiles(qGames);
    assert.equal(prof.HIGH.last10Half.n, 10);
    assert.equal(prof.HIGH.last10Half.avg, 62);
    assert.equal(prof.HIGH.qShare.length, 4);
    assert.ok(Math.abs(prof.HIGH.qShare.reduce((s, x) => s + x, 0) - 1) < 0.01);
  });
});

describe('projection model', () => {
  it('maps tip-relative minutes to game progress with quarter clamp', () => {
    assert.equal(M.progressFromTime(0).f, 0);
    assert.ok(Math.abs(M.progressFromTime(12.5).f - 0.5) < 1e-9);
    assert.equal(M.progressFromTime(40).f, 1);
    const clamped = M.progressFromTime(12, { quarterHint: 3 });
    assert.ok(Math.abs(clamped.f - 0.53) < 1e-9);
    assert.equal(clamped.source, 'quarter-corrected');
  });

  it('uses the FanDuel quarter-market state as a progress window', () => {
    const early = M.quarterBounds({ q: 3, h: 'open', t: 'open', w: 'open' });
    assert.ok(early.lo >= 0.5 && early.hi <= 0.65);
    const late = M.quarterBounds({ q: 3, h: 'susp', t: null, w: null });
    assert.ok(late.lo > 0.65 && late.hi > 0.75);
    assert.equal(M.quarterBounds({ q: 3, h: 'susp', t: 'susp', w: 'susp' }), null);
    // A slow game: the clock says late Q4, the markets say Q4 just opened.
    const p = M.estimateProgress({ minutes: 24, S: 80, expected: 108, quarterState: { q: 4, h: 'open', t: 'open', w: 'open' } });
    assert.equal(p.source, 'market-corrected');
    assert.ok(p.f <= 0.88, `got ${p.f}`);
  });

  it('leans on the score when the tip time is unknown', () => {
    const p = M.estimateProgress({ minutes: 5, tipKnown: false, S: 55, expected: 110 });
    assert.equal(p.source, 'score-estimate');
    assert.ok(p.f > 0.3 && p.f < 0.52, `got ${p.f}`);
  });

  it('window shares sum to one over the full game', () => {
    assert.ok(Math.abs(M.windowShare(0, 1) - 1) < 1e-9);
    assert.ok(Math.abs(M.windowShare(0, 0.5) + M.windowShare(0.5, 1) - 1) < 1e-9);
  });

  it('prices a market: gap rule, suspension, blended probability', () => {
    const base = { mean: 112, sd: 8, edgeMin: 4, evMin: 0.03 };
    const open = M.priceMarket({ ...base, market: { line: 105.5, over: -110, under: -110, open: true } });
    assert.equal(open.call, 'Over');
    assert.equal(open.gap, 6.5);
    assert.ok(open.fair > 105.5 && open.fair < 112);
    const small = M.priceMarket({ ...base, market: { line: 109.5, over: -110, under: -110, open: true } });
    assert.equal(small.call, 'Pass');
    const susp = M.priceMarket({ ...base, market: { line: 105.5, over: -110, under: -110, open: false } });
    assert.equal(susp.call, 'Pass');
    assert.equal(susp.reason, 'Market suspended');
  });

  it('no-vig and EV helpers', () => {
    assert.ok(Math.abs(M.noVigOver(-110, -110) - 0.5) < 1e-9);
    assert.ok(Math.abs(M.evFor(0.5, -110) - (-0.04545)) < 1e-3);
    assert.ok(Math.abs(M.normCdf(0) - 0.5) < 1e-6);
  });

  const ctx = {
    ratings: { mu: 55, players: { BULLSEYE: { off: 2, def: 1, n: 80 }, TAAPZ: { off: 1, def: 0, n: 90 } }, teams: {} },
    profiles: {},
    pairs: {},
  };

  it('pregame expectation uses ratings', () => {
    const g = { status: 'pre', away: { player: 'BULLSEYE', team: '', score: 0 }, home: { player: 'TAAPZ', team: '', score: 0 }, lines: {} };
    const ev = M.evaluateLive(g, ctx, { now: TIP });
    assert.equal(ev.pregame.expected, 114);
    assert.equal(ev.progress.f, 0);
  });

  it('live projection stays between the prior and pure pace', () => {
    const g = {
      status: 'live', tipMs: TIP, scheduledMs: TIP - 23000,
      away: { player: 'BULLSEYE', team: '', score: 36 }, home: { player: 'TAAPZ', team: '', score: 24 },
      lines: { game: { line: 109.5, over: -110, under: -110, open: true } },
    };
    const ev = M.evaluateLive(g, ctx, { now: TIP + 12.5 * 60000 });
    const game = ev.markets.find((m) => m.id === 'game');
    assert.ok(ev.progress.f > 0.45 && ev.progress.f < 0.56, `f ${ev.progress.f}`);
    assert.ok(game.mean > 114 && game.mean < 60 / ev.progress.f, `mean ${game.mean}`);
  });

  it('never calls overtime', () => {
    const g = {
      status: 'live', tipMs: TIP, scheduledMs: TIP - 23000,
      away: { player: 'BULLSEYE', team: '', score: 62 }, home: { player: 'TAAPZ', team: '', score: 62 },
      lines: { game: { line: 135.5, over: -110, under: -110, open: true } },
    };
    const ev = M.evaluateLive(g, ctx, { now: TIP + 29 * 60000 });
    assert.equal(ev.progress.overtime, true);
    assert.ok(ev.markets.every((m) => !m.call || m.call === 'Pass'));
  });
});

describe('tracker grading', () => {
  it('grades sides and profit', () => {
    assert.equal(tracker.gradeSide('Over', 105.5, 107), 'W');
    assert.equal(tracker.gradeSide('Under', 105.5, 107), 'L');
    assert.equal(tracker.gradeSide('Over', 105, 105), 'P');
    assert.ok(Math.abs(tracker.profit('W', -110) - 0.909) < 0.001);
    assert.equal(tracker.profit('L', -110), -1);
  });

  it('matches the official final by gamers + scheduled time and orients sides', () => {
    const tr = { away: { player: 'GENERAL' }, home: { player: 'SILVER' }, scheduledMs: Date.parse('2026-11-04T19:11:00Z') };
    const finals = [['NB166041126', Date.parse('2026-11-04T19:11:00Z'), 'SILVER', 'GENERAL', 'Oklahoma City Thunder', 'Boston Celtics', 58, 49]];
    const fin = tracker.matchFinal(tr, finals);
    assert.equal(fin.id, 'NB166041126');
    assert.equal(fin.away, 49);
    assert.equal(fin.home, 58);
  });

  it('fits the model-vs-market weight', () => {
    const graded = [];
    for (let i = 0; i < 70; i += 1) {
      const L = 110;
      const P = 110 + (i % 2 ? 6 : -6);
      const F = L + 0.5 * (P - L);
      graded.push({ final: { total: F }, checkpoints: { 50: { game: { mean: P, line: L } } } });
    }
    assert.equal(tracker.fitModelWeight(graded).modelWeight, 0.5);
    assert.equal(tracker.fitModelWeight(graded.slice(0, 10)), null);
  });
});

describe('collector end to end (stubbed feeds, memory store)', () => {
  const origBoard = fdEb.listBoard;
  const origLines = fdEb.eventLines;
  const origSched = h2h.schedule;
  const origTl = h2h.timeline;

  beforeEach(() => cache.clear());

  it('tracks, ends and grades a game', async () => {
    const sched = Date.parse('2026-11-04T19:27:00Z');
    const mk = (away, home, status, line) => ({
      id: 'eb:1', eventId: '1', name: 'Boston Celtics (BULLSEYE) @ Los Angeles Lakers (TAAPZ)',
      away: { team: 'Boston Celtics', player: 'BULLSEYE', score: away }, home: { team: 'Los Angeles Lakers', player: 'TAAPZ', score: home },
      total: away + home, scheduledMs: sched, tipMs: status === 'live' ? TIP : sched, status,
      lines: { game: { line, over: -110, under: -110, open: true }, quarters: {}, quarterHint: null },
    });
    let boardRows = [mk(0, 0, 'pre', 110.5)];
    fdEb.listBoard = async () => boardRows;
    fdEb.eventLines = async () => ({ lines: { ...boardRows[0].lines, half1: { line: 54.5, over: -110, under: -110, open: true } } });
    h2h.schedule = async () => [{ externalId: 'NB1', startDate: '2026-11-04T19:27:00Z', matchStatus: 'MATCH_ENDED', participantAName: 'BULLSEYE', participantBName: 'TAAPZ', teamAName: 'Boston Celtics', teamBName: 'Los Angeles Lakers', teamAScore: 62, teamBScore: 45 }];
    h2h.timeline = async () => { throw Object.assign(new Error('rate'), { status: 429 }); };
    try {
      let now = sched;
      await tracker.collect({ now });
      boardRows = [mk(36, 24, 'live', 109.5)];
      now = TIP + 12.5 * 60000;
      await tracker.collect({ now });
      const tr = await store.getJSON('track/ev/1');
      assert.ok(tr.checkpoints[0], 'pregame checkpoint');
      assert.ok(tr.checkpoints[50], 'halftime checkpoint');
      assert.equal(tr.close.half1.line, 54.5);
      boardRows = [];
      now += 2 * 60000;
      await tracker.collect({ now });
      now += 9 * 60 * 60000; // past the give-up window for the missing 1H split
      await tracker.collect({ now });
      const graded = await store.getJSON(`track/graded/${new Date(sched).toISOString().slice(0, 10)}`);
      assert.equal(graded.length, 1);
      assert.equal(graded[0].final.total, 107);
      assert.equal(graded[0].final.away, 62);
      const perf = await tracker.performance({ days: 2, now: sched + 3600000 });
      assert.equal(perf.games, 1);
    } finally {
      fdEb.listBoard = origBoard;
      fdEb.eventLines = origLines;
      h2h.schedule = origSched;
      h2h.timeline = origTl;
    }
  });

  it('grades from FanDuel finals when H2H is down, then back-fills the 1st half', async () => {
    const fd = require('../src/feeds/fdClient');
    const origLive = fd.liveData;
    const sched = Date.parse('2026-11-05T10:00:00Z');
    const tip = sched + 20000;
    const row = (status, away, home) => ({
      id: 'eb:2', eventId: '2', name: 'Boston Celtics (GENERAL) @ Oklahoma City Thunder (SILVER)',
      away: { team: 'Boston Celtics', player: 'GENERAL', score: away }, home: { team: 'Oklahoma City Thunder', player: 'SILVER', score: home },
      total: away + home, scheduledMs: sched, tipMs: status === 'live' ? tip : sched, status,
      lines: { game: { line: 104.5, over: -110, under: -110, open: true }, quarters: {}, quarterHint: null },
    });
    let boardRows = [row('pre', 0, 0)];
    let h2hUp = false;
    fdEb.listBoard = async () => boardRows;
    fdEb.eventLines = async () => ({ lines: { ...boardRows[0].lines, half1: { line: 52.5, over: -110, under: -110, open: true } } });
    fd.liveData = async () => [{ eventId: 2, basketballDetails: { away: { score: 49 }, home: { score: 58 } } }];
    h2h.schedule = async () => {
      if (!h2hUp) throw Object.assign(new Error('H2H HTTP 403'), { status: 403 });
      return [{ externalId: 'NB9', startDate: '2026-11-05T10:00:00Z', matchStatus: 'MATCH_ENDED', participantAName: 'GENERAL', participantBName: 'SILVER', teamAName: 'Boston Celtics', teamBName: 'Oklahoma City Thunder', teamAScore: 49, teamBScore: 58 }];
    };
    h2h.timeline = async () => ({
      incidents: [1, 2, 3, 4].map((q) => ({
        messageType: 'NBA_PERIOD_CHANGE', payload: { phase: 'ENDED' }, period: { type: 'QUARTER', id: q },
        runningScore: { team_a: [12, 25, 37, 49][q - 1], team_b: [14, 29, 44, 58][q - 1] },
      })),
    });
    try {
      let now = sched;
      await tracker.collect({ now });
      boardRows = [row('live', 30, 33)];
      now = tip + 12.5 * 60000;
      await tracker.collect({ now });
      boardRows = [];
      now += 2 * 60000;
      await tracker.collect({ now });
      now += 4 * 60000;
      await tracker.collect({ now });
      const key = `track/graded/${new Date(sched).toISOString().slice(0, 10)}`;
      let graded = await store.getJSON(key);
      assert.equal(graded.length, 1);
      assert.equal(graded[0].finalSource, 'fanduel');
      assert.equal(graded[0].final.total, 107);
      assert.equal(graded[0].pendingHalf, true);
      h2hUp = true;
      now += 10 * 60000;
      await tracker.collect({ now });
      graded = await store.getJSON(key);
      assert.equal(graded[0].pendingHalf, false);
      assert.equal(graded[0].final.half1, 54);
    } finally {
      fdEb.listBoard = origBoard;
      fdEb.eventLines = origLines;
      h2h.schedule = origSched;
      h2h.timeline = origTl;
      fd.liveData = origLive;
    }
  });
});

describe('api router', () => {
  it('404s unknown routes and parses quarter-start params', async () => {
    const out = await api.handle({ method: 'GET', path: '/api/nope' });
    assert.equal(out.status, 404);
    assert.deepEqual(api.parseQuarterStart('3:67'), { q: 3, total: 67 });
    assert.equal(api.parseQuarterStart('bad'), undefined);
  });

  it('health reports the store backend', async () => {
    const out = await api.handle({ method: 'GET', path: '/api/health' });
    assert.equal(out.status, 200);
    assert.equal(out.body.store, 'memory');
  });
});
