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
const GGLive = require(path.join(__dirname, '..', 'static', 'gg-live.js'));
function make(answer, opts = {}) {
  const calls = [], saved = new Map();
  const clock = { now: 1700000000000 };
  class D extends Date { static now() { return clock.now; } }
  const ctx = { Date: D, Math, Error, Number, calls, plusOnly: (x) => x, window: { GGLive: opts.GGLive === undefined ? GGLive : opts.GGLive }, S: { settings: { edge: opts.edge || 2, ev: 3 } }, store: { get: (k, d) => (saved.has(k) ? saved.get(k) : d), set: (k, v) => { saved.set(k, v); } }, fetch: async (url) => { calls.push(url); const a = answer(url, calls.length); if (a === 'down') throw new Error('Failed to fetch'); return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body || {} }; } };
  vm.runInNewContext(`${src.slice(from, to)}; this.api = api; this.LEAGUE = LEAGUE;`, ctx);
  return { api: ctx.api, calls, clock, LEAGUE: ctx.LEAGUE, saved };
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
  await test('several league requests failing together count as one bad moment: the first wait is 30 seconds, not ten minutes', async () => {
    for (const n of [1, 6, 16]) {
      const A = make(() => ({ status: 502 }));
      await Promise.all(Array.from({ length: n }, (_, i) => A.api(`/h2h/v1/timeline/?external_id=${i}`).catch(() => null)));
      assert.strictEqual(A.LEAGUE.fails, 1, `${n} requests in flight: counted as ${A.LEAGUE.fails} failures`);
      assert.strictEqual(A.LEAGUE.until - A.clock.now, 30000);
    }
    // one step per failed attempt: 30 s, 1, 2, 4, 8, then 10 minutes
    const B = make(() => 'down'), waits = [];
    for (let k = 0; k < 7; k++) { await Promise.all(Array.from({ length: 6 }, (_, i) => B.api(`/h2h/v1/timeline/?external_id=${i}`).catch(() => null))); waits.push((B.LEAGUE.until - B.clock.now) / 1000); B.clock.now = B.LEAGUE.until + 1; }
    assert.deepStrictEqual(waits, [30, 60, 120, 240, 480, 600, 600]);
  });
  await test('GG League board and game answers get the late-game correction; other answers, and a missing module, pass through', async () => {
    const live = (f) => ({ eventId: '7', status: 'live', away: { score: 48 }, home: { score: 52 }, total: 100, eval: { progress: { f }, markets: [{ id: 'game', line: 111.5, overOdds: -115, underOdds: -115, open: true, mean: 121.6, fair: 116.2, sd: 6.4, gap: 4.7, weight: 0.47, call: 'Over', score: 13.5 }], best: null } });
    const body = (url) => (/\/api\/eb\/board/.test(url) ? { live: [live(0.85), live(0.5)], picks: [] } : /\/api\/eb\/game\//.test(url) ? { game: { ...live(0.85), eval: undefined }, eval: live(0.85).eval } : { live: [live(0.85)] });
    const A = make((url) => ({ status: 200, body: body(url) }));
    const b = await A.api('/api/eb/board?edge=2&ev=0.03');
    assert.ok(b.live[0].eval.markets[0].mean === 116.2 && b.live[0].eval.markets[0].lateKeep === 0.75 && b.live[0].eval.markets[0].serverMean === 121.6, JSON.stringify(b.live[0].eval.markets[0]));
    assert.ok(b.live[1].eval.markets[0].mean === 121.6 && b.live[1].eval.markets[0].lateKeep === undefined, 'a game at halftime was changed');
    const g = await A.api('/api/eb/game/7?edge=2');
    assert.strictEqual(g.eval.markets[0].mean, 116.2);
    // the board also tells which share of our number the server uses in each stretch: kept for the report card
    const W = make((url) => ({ status: 200, body: { live: [{ ...live(0.85), eval: { ...live(0.85).eval, modelWeight: 0.47 } }, { ...live(0.5), eval: { ...live(0.5).eval, modelWeight: 0.15 } }], upcoming: [{ status: 'pre', eval: { progress: { f: 0 }, modelWeight: 0.68, markets: [] } }] } }));
    await W.api('/api/eb/board?edge=2');
    assert.deepStrictEqual(W.saved.get('gg-phase-w'), [0.68, null, 0.15, 0.47, null]);
    await W.api('/api/eb/game/7'); assert.deepStrictEqual(W.saved.get('gg-phase-w'), [0.68, null, 0.15, 0.47, null]);
    // the same body from any other path is left as the server sent it
    for (const p of ['/api/eb/performance?days=7', '/api/eb/graded?days=7', '/api/games', '/api/eb/matchup?a=x&b=y']) assert.strictEqual((await A.api(p)).live[0].eval.markets[0].mean, 121.6, p);
    // the phone's own minimum gap decides whether a late call stays
    const strict = make((url) => ({ status: 200, body: body(url) }), { edge: 4 });
    const sb = await strict.api('/api/eb/board?edge=4');
    assert.ok(sb.live[0].eval.markets[0].call === 'Pass' && /Edge under 4 pts/.test(sb.live[0].eval.markets[0].reason));
    // without the module, or with one that throws, the board still loads with the server's numbers
    const none = make((url) => ({ status: 200, body: body(url) }), { GGLive: null });
    assert.strictEqual((await none.api('/api/eb/board?edge=2')).live[0].eval.markets[0].mean, 121.6);
    const broken = make((url) => ({ status: 200, body: body(url) }), { GGLive: { fix() { throw new Error('boom'); } } });
    assert.strictEqual((await broken.api('/api/eb/board?edge=2')).live[0].eval.markets[0].mean, 121.6);
  });
  await test('when the league source starts refusing, the gamer profiles keep today\'s results they already had, and the note is in plain words', async () => {
    const dir = path.join(__dirname, '..', 'static');
    const pfFrom = src.indexOf('const GP = window.GGProfiles;'), pfTo = src.indexOf('// quarter splits for the gamers on the board right now');
    assert.ok(pfFrom > 0 && pfTo > pfFrom, 'the profile loader was not found in app.js');
    const clock = { now: Date.parse('2026-11-12T22:00:00Z') };
    class D extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } }
    const mem = new Map();
    const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] || null, get length() { return mem.size; } };
    let blocked = false;
    const names = ['ACE', 'BOLT', 'CRUSH', 'DYNAMO', 'ECHO', 'FLASH', 'GHOST', 'HAWK'];
    const dayRows = (d) => { // up to 40 finished games on each day
      const rows = [];
      for (let i = 0; i < 40; i++) { const a = names[i % 8], b = names[(i * 3 + 1) % 8 === i % 8 ? (i + 2) % 8 : (i * 3 + 1) % 8]; const t = Date.parse(`${d}T00:00:00Z`) + i * 30 * 60000; if (t > clock.now - 20 * 60000) break; rows.push({ externalId: `NB${String(i).padStart(3, '0')}${d.slice(2).replace(/-/g, '')}`, startDate: new Date(t).toISOString(), isCancelled: false, matchStatus: 'MATCH_ENDED', teamAScore: 50 + (i % 9), teamBScore: 48 + (i % 7), participantAName: a, participantBName: b, teamAName: 'Boston Celtics', teamBName: 'Denver Nuggets' }); }
      return rows;
    };
    const note = { text: '' };
    const ctx = { Date: D, Math, Error, Set, Map, Object, Array, Number, String, JSON, Promise, Boolean, encodeURIComponent, console, localStorage, plusOnly: (x) => x,
      fetch: async (url) => { if (blocked && /\/h2h\//.test(url)) return { ok: false, status: 403, json: async () => ({}) }; const m = /date=(\d{4}-\d\d-\d\d)/.exec(decodeURIComponent(url)); return { ok: true, status: 200, json: async () => dayRows(m[1]) }; },
      S: { view: 'none', board: {} }, renderBoard() {}, renderProfiles() {}, fillQuarters() {}, $: () => note };
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(dir, 'profiles.js'), 'utf8'), ctx);
    vm.runInContext(`const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
${src.slice(from, to)}
${src.slice(pfFrom, pfTo)}
this.loadProfiles = loadProfiles; this.PF = PF;`, ctx);
    await ctx.loadProfiles(true);
    const g0 = ctx.PF.model.games;
    assert.ok(g0 >= 800 && !ctx.PF.stale && !ctx.PF.err, `first build: ${g0} games, stale ${ctx.PF.stale}, error ${ctx.PF.err}`);
    blocked = true; clock.now += 125000; // two minutes later the source answers 403
    await ctx.loadProfiles(false);
    assert.strictEqual(ctx.PF.model.games, g0, `the profiles lost ${g0 - ctx.PF.model.games} games they already had when the source started refusing`);
    assert.strictEqual(ctx.PF.stale, true);
    assert.strictEqual(ctx.PF.err, null);
    // the words a user reads carry no error code
    const noteSrc = src.slice(src.indexOf("$('pfNote').textContent"), src.indexOf("$('pfNote').textContent") + 400);
    assert.ok(/not reaching the app right now, so these numbers use the results already saved on this phone/.test(noteSrc) && !/\$\{PF\.stale\}|\(\$\{/.test(noteSrc.slice(0, 260)), 'the note prints a raw error code');
    assert.ok(!/reaching the app right now \(\$\{/.test(src), 'a league message still prints a raw error code');
    // the footer carries the version being published, in step with the service worker
    const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8'), html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const v = /gg-winner-v([\d.]+)/.exec(sw)[1];
    assert.ok(html.includes(`Version ${v} (`), `the footer does not say Version ${v}`);
  });
  console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
})();
