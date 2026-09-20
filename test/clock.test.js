const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { elapsedGameMinutes, parseClockToMinutes, remainingScheduledMinutes } = require('../src/model/clock');
const { NBA_48, FIBA_40, LEAGUES } = require('../src/leagues');

describe('clock', () => {
  it('parses MM:SS countdown', () => {
    assert.equal(parseClockToMinutes('6:00'), 6);
    assert.equal(parseClockToMinutes('0:30'), 0.5);
  });

  it('NBA Q1 12:00 is 0 elapsed', () => {
    assert.equal(elapsedGameMinutes(1, '12:00', { clock: NBA_48 }), 0);
  });

  it('NBA Q1 6:00 is 6 elapsed', () => {
    assert.equal(elapsedGameMinutes(1, '6:00', { clock: NBA_48 }), 6);
  });

  it('NBA Q2 6:00 is 18 elapsed', () => {
    assert.equal(elapsedGameMinutes(2, '6:00', { clock: NBA_48 }), 18);
  });

  it('NBA end of Q4 is 48 elapsed', () => {
    assert.equal(elapsedGameMinutes(4, '0:00', { clock: NBA_48 }), 48);
    assert.equal(remainingScheduledMinutes(4, '0:00', { clock: NBA_48 }), 0);
  });

  it('WNBA Q3 5:00 is 25 elapsed', () => {
    assert.equal(elapsedGameMinutes(3, '5:00', { clock: FIBA_40 }), 25);
  });

  it('NCAAM H2 10:00 is 30 elapsed', () => {
    assert.equal(elapsedGameMinutes(2, '10:00', LEAGUES.ncaam), 30);
  });

  it('NBA OT 2:30 remaining is 50.5 elapsed', () => {
    assert.equal(elapsedGameMinutes(5, '2:30', { clock: NBA_48 }), 50.5);
  });

  it('halftime is half of regulation', () => {
    assert.equal(elapsedGameMinutes(2, '0:00', { clock: NBA_48 }, { isHalftime: true }), 24);
  });
});
