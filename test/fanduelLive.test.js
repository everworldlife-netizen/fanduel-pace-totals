const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  msToClock,
  competitionToLeagueId,
  mapLiveBasketball,
} = require('../src/feeds/fanduelLive');
const { parseId, mergePreferFanDuelLive } = require('../src/games');

const IN_PLAY = {
  attachments: {
    eventTypes: { 7522: { name: 'Basketball', eventTypeId: 7522 } },
    competitions: {
      9989214: { name: 'German BBL', competitionId: 9989214 },
      10532469: { name: 'Lithuania - LKL', competitionId: 10532469 },
      9990001: { name: 'eBasketball 12 mins', competitionId: 9990001 },
      9990002: { name: 'GG League Basketball', competitionId: 9990002 },
      10662499: { name: 'Denmark - Dameligaen', competitionId: 10662499 },
    },
    events: {
      36086255: {
        eventId: 36086255,
        name: 'Baskets Oldenburg v MBC',
        eventTypeId: 7522,
        competitionId: 9989214,
        openDate: '2026-09-20T13:00:00.000Z',
      },
      36086783: {
        eventId: 36086783,
        name: 'BC Neptunas Klaipeda v BC Zalgiris Kaunas',
        eventTypeId: 7522,
        competitionId: 10532469,
        openDate: '2026-09-20T13:50:00.000Z',
      },
      36086249: {
        eventId: 36086249,
        name: 'Hrsholm 79ers Women v Aabyhoj IF Women',
        eventTypeId: 7522,
        competitionId: 10662499,
        openDate: '2026-09-20T13:30:00.000Z',
      },
      111: {
        eventId: 111,
        name: 'Sim Heat v Sim Celtics',
        eventTypeId: 7522,
        competitionId: 9990001,
        openDate: '2026-09-20T13:00:00.000Z',
      },
      222: {
        eventId: 222,
        name: 'H2H GG Lakers v Knicks',
        eventTypeId: 7522,
        competitionId: 9990002,
        openDate: '2026-09-20T13:00:00.000Z',
      },
      333: {
        eventId: 333,
        name: 'ACE Wolves v JUDGEMENT Foxes',
        eventTypeId: 7522,
        competitionId: 9989214,
        openDate: '2026-09-20T13:00:00.000Z',
      },
    },
    markets: {
      '717.1': {
        marketId: '717.1',
        eventId: 36086255,
        marketType: 'MONEY_LINE',
        marketName: 'Moneyline',
        runners: [
          { runnerName: 'Baskets Oldenburg', result: { type: 'HOME' }, handicap: -8.5 },
          { runnerName: 'MBC', result: { type: 'AWAY' }, handicap: 8.5 },
        ],
      },
      '717.tot': {
        marketId: '717.tot',
        eventId: 36086255,
        marketType: 'TOTAL_POINTS_(OVER/UNDER)',
        marketName: 'Total Points inc Overtime',
        runners: [
          { runnerName: 'Over', result: { type: 'OVER' }, handicap: 182.5 },
          { runnerName: 'Under', result: { type: 'UNDER' }, handicap: 182.5 },
        ],
      },
    },
  },
};

const LIVE_DATA = [
  {
    eventId: 36086255,
    modelType: 'Basketball',
    basketballDetails: {
      home: { score: 63, pointsPerPeriod: [27, 27, 9] },
      away: { score: 55, pointsPerPeriod: [25, 16, 14] },
      periodRemainingTimeMilliseconds: 249000,
      currentPeriod: 3,
      period: 'Q3',
    },
  },
  {
    eventId: 36086783,
    modelType: 'Basketball',
    basketballDetails: {
      home: { score: 26, pointsPerPeriod: [18, 8] },
      away: { score: 31, pointsPerPeriod: [20, 11] },
      periodRemainingTimeMilliseconds: 289000,
      currentPeriod: 2,
      period: 'Q2',
    },
  },
  {
    eventId: 36086249,
    modelType: 'Basketball',
    basketballDetails: {
      home: { score: 27, pointsPerPeriod: [17, 10] },
      away: { score: 41, pointsPerPeriod: [23, 18] },
      currentPeriod: 2,
      period: 'Q2',
    },
  },
  {
    eventId: 111,
    modelType: 'Basketball',
    basketballDetails: { home: { score: 40 }, away: { score: 42 }, currentPeriod: 1, period: 'Q1' },
  },
  {
    eventId: 222,
    modelType: 'Basketball',
    basketballDetails: { home: { score: 10 }, away: { score: 12 }, currentPeriod: 1, period: 'Q1' },
  },
  {
    eventId: 333,
    modelType: 'Basketball',
    basketballDetails: { home: { score: 8 }, away: { score: 9 }, currentPeriod: 1, period: 'Q1' },
  },
];

describe('FanDuel live mapper', () => {
  it('converts remaining milliseconds to mm:ss', () => {
    assert.equal(msToClock(249000), '4:09');
    assert.equal(msToClock(0), '0:00');
    assert.equal(msToClock(61000), '1:01');
  });

  it('maps FanDuel competition labels onto known league ids', () => {
    assert.equal(competitionToLeagueId('German BBL'), 'bbl');
    assert.equal(competitionToLeagueId('Lithuania - LKL'), 'lkl');
    assert.equal(competitionToLeagueId('NBA'), 'nba');
    assert.equal(competitionToLeagueId('Denmark - Dameligaen'), 'other');
  });

  it('maps live BBL/LKL score, period, and clock from the public board', () => {
    const games = mapLiveBasketball(IN_PLAY, LIVE_DATA);
    const bbl = games.find((g) => g.sourceId === '36086255');
    assert.ok(bbl);
    assert.equal(bbl.id, 'fd:bbl:36086255');
    assert.equal(bbl.source, 'fanduel');
    assert.equal(bbl.leagueId, 'bbl');
    assert.equal(bbl.leagueName, 'German BBL');
    assert.equal(bbl.status, 'in_progress');
    assert.equal(bbl.period, 3);
    assert.equal(bbl.clock, '4:09');
    assert.equal(bbl.home.name, 'Baskets Oldenburg');
    assert.equal(bbl.home.score, 63);
    assert.equal(bbl.away.name, 'MBC');
    assert.equal(bbl.away.score, 55);
    assert.deepEqual(bbl.home.qScores, [27, 27, 9]);
    assert.equal(bbl.periodText, 'Q3');

    const lkl = games.find((g) => g.sourceId === '36086783');
    assert.equal(lkl.leagueId, 'lkl');
    assert.equal(lkl.home.name, 'BC Neptunas Klaipeda');
    assert.equal(lkl.away.name, 'BC Zalgiris Kaunas');
    assert.equal(lkl.home.score, 26);
    assert.equal(lkl.away.score, 31);
    assert.equal(lkl.clock, '4:49');
  });

  it('keeps unmapped real basketball leagues and never copies FanDuel totals/odds', () => {
    const games = mapLiveBasketball(IN_PLAY, LIVE_DATA);
    const den = games.find((g) => g.sourceId === '36086249');
    assert.ok(den);
    assert.equal(den.leagueId, 'other');
    assert.equal(den.leagueName, 'Denmark - Dameligaen');
    const blob = JSON.stringify(games);
    assert.equal(blob.includes('182.5'), false);
    assert.equal(blob.includes('handicap'), false);
    for (const g of games) {
      assert.equal(g.line, undefined);
      assert.equal(g.odds, undefined);
      assert.equal(g.total, undefined);
    }
  });

  it('drops eBasketball, GG League, H2H GG, and ACE/JUDGEMENT sims', () => {
    const games = mapLiveBasketball(IN_PLAY, LIVE_DATA);
    const ids = games.map((g) => g.sourceId);
    assert.equal(ids.includes('111'), false);
    assert.equal(ids.includes('222'), false);
    assert.equal(ids.includes('333'), false);
    assert.ok(ids.includes('36086255'));
  });

  it('skips in-play events that have no basketball scoreboard payload', () => {
    const extra = JSON.parse(JSON.stringify(IN_PLAY));
    extra.attachments.events['36089999'] = {
      eventId: 36089999,
      name: 'Ulm Baskets v Riesen Ludwigsburg',
      eventTypeId: 7522,
      competitionId: 9989214,
      openDate: '2026-09-20T15:00:00.000Z',
    };
    const games = mapLiveBasketball(extra, LIVE_DATA);
    assert.equal(games.some((g) => g.sourceId === '36089999'), false);
  });
});

describe('FanDuel live merge', () => {
  it('parses fd composite ids', () => {
    assert.deepEqual(parseId('fd:bbl:36086255'), { source: 'fd', leagueId: 'bbl', eventId: '36086255' });
  });

  it('prefers FanDuel live rows over ESPN/Euro of the same matchup', () => {
    const espn = {
      id: 'espn:bbl:1',
      source: 'espn',
      leagueId: 'bbl',
      status: 'scheduled',
      date: '2026-09-20T13:00:00.000Z',
      home: { name: 'Baskets Oldenburg', score: 0 },
      away: { name: 'MBC', score: 0 },
    };
    const fd = {
      id: 'fd:bbl:36086255',
      source: 'fanduel',
      leagueId: 'bbl',
      status: 'in_progress',
      date: '2026-09-20T13:00:00.000Z',
      home: { name: 'Baskets Oldenburg', score: 63 },
      away: { name: 'MBC', score: 55 },
    };
    const other = {
      id: 'espn:nba:9',
      source: 'espn',
      leagueId: 'nba',
      status: 'final',
      date: '2026-09-20T00:00:00.000Z',
      home: { name: 'Raptors', score: 100 },
      away: { name: 'Heat', score: 90 },
    };
    const merged = mergePreferFanDuelLive([espn, other], [fd]);
    assert.equal(merged.some((g) => g.id === 'espn:bbl:1'), false);
    assert.equal(merged[0].id, 'fd:bbl:36086255');
    assert.ok(merged.some((g) => g.id === 'espn:nba:9'));
  });
});
