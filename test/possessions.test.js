const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { teamPossessions, gamePossessions, livePace, pointsPerPossession, hasBoxStats } = require('../src/model/possessions');

describe('possessions', () => {
  it('uses FGA + 0.44*FTA − ORB + TO', () => {
    assert.equal(teamPossessions({ fga: 80, fta: 20, orb: 10, to: 14 }), 80 + 8.8 - 10 + 14);
  });

  it('averages both teams for game possessions', () => {
    const home = { fga: 90, fta: 10, orb: 8, to: 12 };
    const away = { fga: 88, fta: 20, orb: 12, to: 10 };
    const expected = (teamPossessions(home) + teamPossessions(away)) / 2;
    assert.equal(gamePossessions(home, away), expected);
  });

  it('returns null without a usable box', () => {
    assert.equal(gamePossessions({ fga: 1, fta: 0, orb: 0, to: 0 }, null), null);
  });

  it('scales live pace to regulation minutes', () => {
    // 50 poss in 24 minutes of a 48-minute game => 100 poss/48
    assert.equal(livePace(50, 24, 48), 100);
  });

  it('PPP is points over combined possessions', () => {
    assert.equal(pointsPerPossession(200, 180), 200 / 180);
  });

  it('hasBoxStats requires a real sample', () => {
    assert.equal(hasBoxStats({ fga: 2, fta: 0, to: 1 }), false);
    assert.equal(hasBoxStats({ fga: 20, fta: 4, to: 5 }), true);
  });
});
