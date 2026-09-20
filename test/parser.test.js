const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractTeamStats } = require('../src/espn/boxscore');
const { parseId } = require('../src/games');

describe('espn box parser', () => {
  it('splits hyphenated FGA fields used by NBL', () => {
    const raw = {
      boxscore: {
        teams: [{
          team: { abbreviation: 'SYD', displayName: 'Sydney' },
          statistics: [
            { name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: '29-72' },
            { name: 'freeThrowsMade-freeThrowsAttempted', displayValue: '16-25' },
            { name: 'offensiveRebounds', displayValue: '12' },
            { name: 'turnovers', displayValue: '11' },
          ],
        }],
      },
    };
    const stats = extractTeamStats(raw);
    assert.equal(stats.SYD.fga, 72);
    assert.equal(stats.SYD.fgm, 29);
    assert.equal(stats.SYD.fta, 25);
    assert.equal(stats.SYD.orb, 12);
    assert.equal(stats.SYD.to, 11);
  });
});

describe('game ids', () => {
  it('parses espn / euro / apib composite ids', () => {
    assert.deepEqual(parseId('espn:nba:4018'), { source: 'espn', leagueId: 'nba', eventId: '4018' });
    assert.deepEqual(parseId('euro:euroleague:E2026:12'), {
      source: 'euro', leagueId: 'euroleague', seasonCode: 'E2026', gameCode: '12',
    });
    assert.deepEqual(parseId('apib:bbl:99'), { source: 'apib', leagueId: 'bbl', gameId: '99' });
  });
});
