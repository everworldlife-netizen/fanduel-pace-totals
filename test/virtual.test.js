const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isVirtualGame } = require('../src/model/virtual');

describe('virtual filter', () => {
  it('drops eBasketball names', () => {
    assert.equal(isVirtualGame({ name: 'eBasketball Game 12' }), true);
    assert.equal(isVirtualGame({ home: { name: 'Virtual Lakers' }, away: { name: 'Celtics' } }), true);
    assert.equal(isVirtualGame({ away: { name: 'NBA 2K Heat' } }), true);
  });

  it('keeps real teams', () => {
    assert.equal(isVirtualGame({
      name: 'Miami Heat at Toronto Raptors',
      home: { name: 'Toronto Raptors', abbrev: 'TOR' },
      away: { name: 'Miami Heat', abbrev: 'MIA' },
    }), false);
  });
});
