const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isVirtualGame } = require('../src/model/virtual');

describe('virtual filter', () => {
  it('drops eBasketball names', () => {
    assert.equal(isVirtualGame({ name: 'eBasketball Game 12' }), true);
    assert.equal(isVirtualGame({ home: { name: 'Virtual Lakers' }, away: { name: 'Celtics' } }), true);
    assert.equal(isVirtualGame({ away: { name: 'NBA 2K Heat' } }), true);
  });

  it('drops FanDuel sim / GG / ACE / JUDGEMENT boards', () => {
    assert.equal(isVirtualGame({ leagueName: 'eBasketball 12 mins' }), true);
    assert.equal(isVirtualGame({ leagueName: 'GG League Basketball' }), true);
    assert.equal(isVirtualGame({ name: 'H2H GG Celtics vs Lakers' }), true);
    assert.equal(isVirtualGame({ leagueName: 'ACE Basketball Sims' }), true);
    assert.equal(isVirtualGame({ name: 'JUDGEMENT Heat vs Knicks' }), true);
    assert.equal(isVirtualGame({ leagueName: 'Judgment 5 Min' }), true);
  });

  it('keeps real teams and real G League', () => {
    assert.equal(isVirtualGame({
      name: 'Miami Heat at Toronto Raptors',
      home: { name: 'Toronto Raptors', abbrev: 'TOR' },
      away: { name: 'Miami Heat', abbrev: 'MIA' },
    }), false);
    assert.equal(isVirtualGame({
      leagueName: 'NBA G League',
      name: 'Maine Celtics at Westchester Knicks',
    }), false);
    assert.equal(isVirtualGame({
      leagueName: 'German BBL',
      name: 'Baskets Oldenburg v MBC',
    }), false);
  });
});
