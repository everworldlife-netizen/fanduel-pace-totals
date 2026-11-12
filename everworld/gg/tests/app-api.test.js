// The app's data calls: when the league's results source turns the app away, the app waits longer and longer before asking again.
// Run: node gg/tests/app-api.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
const from = src.indexOf('const LEAGUE = {'), to = src.indexOf('const qparams');
assert.ok(from > 0 && to > from, 'the data-call code was not found in app.js');
let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };
function make(answer) {
  const calls = [];
  const clock = { now: 1700000000000 };
  class D extends Date { static now() { return clock.now; } }
  const ctx = { Date: D, Math, Error, calls, plusOnly: (x) => x, fetch: async (url) => { calls.push(url); const a = answer(url, calls.length); if (a === 'down') throw new Error('Failed to fetch'); return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body || {} }; } };
  vm.runInNewContext(`${src.slice(from, to)}; this.api = api; this.LEAGUE = LEAGUE;`, ctx);
  return { api: ctx.api, calls, clock, LEAGUE: ctx.LEAGUE };
}
(async () => {
  console.log('GG Winner data calls');
  await test('a blocked league source is asked again only after a growing wait, and the board is not held back', async () => {
    const A = make((url) => (/\/h2h\//.test(url) ? { status: 403 } : { status: 200, body: { live: [] } }));
    const tries = async (n) => { let failed = 0; for (let i = 0; i < n; i++) { try { await A.api('/h2h/v1/schedule/nba?date=x'); } catch (e) { failed++; assert.strictEqual(e.status, 403); } } return failed; };
    assert.strictEqual(await tries(40), 40);
    assert.strictEqual(A.calls.length, 1, `the blocked source was asked ${A.calls.length} times in a row`);
    A.clock.now += 29000; await tries(5); assert.strictEqual(A.calls.length, 1, 'asked again before 30 seconds had passed');
    A.clock.now += 2000; await tries(5); assert.strictEqual(A.calls.length, 2, 'not asked again after 30 seconds');
    A.clock.now += 59000; await tries(5); assert.strictEqual(A.calls.length, 2, 'the second wait was shorter than a minute');
    A.clock.now += 2000; await tries(5); assert.strictEqual(A.calls.length, 3);
    // an hour of refreshes every 8 seconds: a handful of requests, never more often than every ten minutes at the end
    const before = A.calls.length;
    for (let i = 0; i < 450; i++) { A.clock.now += 8000; await tries(1); }
    assert.ok(A.calls.length - before <= 9, `${A.calls.length - before} requests in an hour to a source that keeps saying no`);
    // the board's own feed is asked every time
    const b0 = A.calls.length;
    for (let i = 0; i < 5; i++) await A.api('/api/eb/board?edge=2');
    assert.strictEqual(A.calls.length - b0, 5);
  });
  await test('once the league source answers again the waits are forgotten; a missing game (404) never starts a wait', async () => {
    let ok = false;
    const A = make((url) => (/timeline/.test(url) ? { status: 404 } : ok ? { status: 200, body: [] } : { status: 429 }));
    for (let i = 0; i < 3; i++) { try { await A.api('/h2h/v1/timeline/?external_id=1'); } catch (e) { assert.strictEqual(e.status, 404); } }
    assert.strictEqual(A.calls.length, 3, 'a game with no timeline blocked the next request');
    try { await A.api('/h2h/v1/schedule/nba?date=x'); } catch (e) { assert.strictEqual(e.status, 429); }
    ok = true;
    try { await A.api('/h2h/v1/schedule/nba?date=x'); assert.fail('asked again at once'); } catch (e) { assert.ok(e.waiting); }
    A.clock.now += 31000;
    assert.deepStrictEqual(await A.api('/h2h/v1/schedule/nba?date=x'), []);
    assert.strictEqual(A.LEAGUE.fails, 0);
    assert.deepStrictEqual(await A.api('/h2h/v1/schedule/nba?date=y'), []);
  });
  await test('with no connection the league source is not hammered either', async () => {
    const A = make(() => 'down');
    for (let i = 0; i < 20; i++) { try { await A.api('/h2h/v1/schedule/nba?date=x'); } catch { /* expected */ } }
    assert.strictEqual(A.calls.length, 1);
  });
  console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
})();
