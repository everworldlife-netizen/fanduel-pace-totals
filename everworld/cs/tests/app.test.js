/* Courtside app shell test: boots the real index.html + scripts in a simulated phone browser (jsdom) on a real
 * fixture game, with the data feeds replaced by the fixture. Checks the screens render, the product wording rules
 * hold on every screen, and the edge record saves and grades.
 *   node cs/tests/app.test.js        (needs: cd nm && npm install)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const assert = require('assert');
const { JSDOM } = require(path.join(__dirname, '..', '..', 'nm', 'node_modules', 'jsdom'));
const BUILD = process.env.CS_BUILD ? path.resolve(process.env.CS_BUILD) : path.join(__dirname, '..', 'build'); // CS_BUILD=<folder> tests another build
const FX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'games.json.gz'))).toString('utf8'));
const read = (f) => fs.readFileSync(path.join(BUILD, f), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };

async function boot(phase, hook) {
  const html = read('index.html').replace(/<script src="[^"]+"><\/script>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
  const dom = new JSDOM(html, { url: 'https://everworldlife-courtside-arcade.static.hf.space/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
  w.console = { ...console, warn: (...a) => errors.push('warn: ' + a.map(String).join(' ')), error: (...a) => errors.push('error: ' + a.map(String).join(' ')), log: () => {} };
  w.fetch = async () => { throw new Error('network is off in tests'); };
  w.scrollTo = () => {}; // the simulated browser has no scrolling
  w.eval(read('engine.js'));
  w.eval(read('sitprior.js').replace(/^self\./m, 'window.'));
  w.eval(read('data.js'));
  const E = w.Engine, date = FX[0].g.date;
  const state = { phase };
  const rowOf = (fx) => {
    if (state.phase === 'final') return fx.g;
    if (state.phase === 'pre') return { ...fx.g, status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 };
    const ps = fx.plays.filter((p) => p.period <= 2);
    const bx = E.boxFromPlays(ps, 2, '0:00'), v = fx.g.visitor_team.abbreviation, h = fx.g.home_team.abbreviation;
    return { ...fx.g, status_state: 'in', display_status: 'Half', status: 'Half', period: 2, time: 'Half', visitor_team_score: bx.teams[v].pts, home_team_score: bx.teams[h].pts };
  };
  const fxOf = (id) => FX.find((x) => +x.g.id === +id);
  // the data feeds, answered from the fixture
  Object.assign(w.DB, {
    etDate: (o = 0) => w.DB.addDays(date, o),
    slate: async (d) => (d === date ? FX.map(rowOf) : []),
    lastSeasonPriors: async () => Object.assign({}, ...FX.map((x) => x.base.priors.last)),
    currentSeasonPriors: async () => Object.assign({}, ...FX.map((x) => x.base.priors.cur)),
    injuries: async () => [], teamStats: async () => FX[0].base.teams, gameLines: async () => [],
    linesFor: (g) => fxOf(g.id).base.market,
    teamLogs: async () => { const seen = new Set(), out = []; for (const x of FX) for (const l of x.base.logs) if (!seen.has(l.id)) { seen.add(l.id); out.push(l); } return out; },
    livePlays: async (g) => { const fx = fxOf(g.id); return state.phase === 'final' ? fx.plays : fx.plays.filter((p) => p.period <= 2); },
    plays: async (id) => fxOf(id).plays,
    availability: async (g) => fxOf(g.id).base.avail,
    lineupFor: async (g) => fxOf(g.id).base.avail,
    playersLogs: async () => ({}), espnInjuries: async () => ({}),
    // book lines two points under each current projection: these become plus edges
    props: async (gid) => {
      const fx = fxOf(gid), out = [];
      const m = { game: rowOf(fx), plays: state.phase === 'pre' ? [] : fx.plays.filter((p) => p.period <= 2) };
      const P = E.projectGame({ ...fx.base, game: m.game, plays: m.plays, nsims: 300, seed: fx.g.id, patterns: E.patBeta(null) });
      for (const p of P.players.slice(0, 8)) out.push({ player_id: p.pid, prop_type: 'points', line_value: String(Math.max(0.5, Math.floor(p.proj.pts - 3) + 0.5)), vendor: 'testbook', market: { type: 'over_under', over_odds: -110, under_odds: -110 } });
      return out;
    },
  });
  // the projection worker, run in place
  const workerSrc = read('worker.js');
  w.Worker = class {
    constructor() { const self = { postMessage: (m) => setTimeout(() => this.onmessage && this.onmessage({ data: m }), 0) }; this.self = self; new w.Function('self', 'importScripts', 'Engine', workerSrc)(self, () => {}, E); if (w.SIT_PRIOR_TXT) self.SIT_PRIOR_TXT = w.SIT_PRIOR_TXT; }
    postMessage(m) { setTimeout(() => this.self.onmessage({ data: m }), 0); }
  };
  if (hook) hook(w, state, fxOf); // a test can swap feeds or saved data before the app starts
  w.eval(read('app.js'));
  return { w, dom, errors, state, go: async (hash, ms = 250) => { w.location.hash = hash; w.dispatchEvent(new w.HashChangeEvent('hashchange')); await sleep(ms); return w.document.getElementById('view'); } };
}
const visibleText = (w) => w.document.body.textContent.replace(/\s+/g, ' ');
const banned = (t) => (t.match(/\b(over|under)\b/gi) || []);

(async () => {
  console.log('Courtside app shell (simulated phone browser)');
  let A;
  await test('boots before tip-off and projects the fixture games', async () => {
    A = await boot('pre');
    await sleep(2500);
    const v = await A.go('#/games', 400);
    assert.ok(/[A-Z]{3}/.test(v.textContent), 'no games on the board');
    const hard = A.errors.filter((e) => !/network is off|learn|game logs/i.test(e));
    assert.strictEqual(hard.length, 0, `page errors: ${hard.slice(0, 3).join(' | ')}`);
  });
  await test('every screen renders and never shows the words "over" or "under"', async () => {
    for (const h of ['#/edges', '#/games', '#/scorers', '#/combos', '#/settings', `#/game/${FX[0].g.id}`]) {
      const v = await A.go(h, 350);
      assert.ok(v.textContent.trim().length > 40, `${h} is empty`);
      const bad = banned(visibleText(A.w));
      assert.strictEqual(bad.length, 0, `${h} shows "${bad[0]}": ${(visibleText(A.w).match(/.{30}\b(over|under)\b.{30}/i) || [''])[0]}`);
    }
  });
  await test('settings shows the accuracy report and the edge record', async () => {
    const v = await A.go('#/settings', 300);
    assert.ok(/ACCURACY REPORT/.test(v.textContent), 'no accuracy report');
    assert.ok(/EDGE RECORD/.test(v.textContent), 'no edge record');
  });
  await test('plus edges shown before the game are saved in the edge record', async () => {
    const rows = JSON.parse(A.w.localStorage.getItem('ledger:v1') || '[]');
    assert.ok(rows.length >= 3, `only ${rows.length} edges saved`);
    for (const r of rows) { assert.ok(r[6] >= 0.55 && r[7] > 0 && r[7] < 1, 'bad chances in a saved edge'); assert.strictEqual(r[8], 0); assert.strictEqual(r[10], null); }
  });
  await test('live at halftime: new projections, live edges saved once, wording rules hold', async () => {
    A.state.phase = 'live';
    A.w.document.getElementById('refreshBtn').click();
    await sleep(3000);
    for (const h of ['#/edges', `#/game/${FX[0].g.id}`, '#/scorers']) { await A.go(h, 350); const bad = banned(visibleText(A.w)); assert.strictEqual(bad.length, 0, `${h} shows "${bad[0]}"`); }
    const rows = JSON.parse(A.w.localStorage.getItem('ledger:v1') || '[]');
    assert.ok(rows.some((r) => r[8] === 1), 'no live edge saved');
    assert.strictEqual(new Set(rows.map((r) => r[0])).size, rows.length, 'an edge was saved twice');
  });
  await test('when the game ends the saved edges are graded from the final box', async () => {
    A.state.phase = 'final';
    A.w.document.getElementById('refreshBtn').click();
    await sleep(3000);
    const rows = JSON.parse(A.w.localStorage.getItem('ledger:v1') || '[]');
    const graded = rows.filter((r) => r[10] != null);
    assert.ok(graded.length >= 3, `only ${graded.length} of ${rows.length} graded`);
    for (const r of graded) if (r[10] >= 0) { const [gid, pid] = r[0].split(':'); const a = FX.find((x) => +x.g.id === +gid).rows[pid]; assert.strictEqual(r[11], a.pts); assert.strictEqual(r[10], a.pts > r[5] ? 1 : a.pts < r[5] ? 0 : -1); }
    const v = await A.go('#/settings', 300);
    assert.ok(/Edges graded/.test(v.textContent));
    assert.strictEqual(banned(visibleText(A.w)).length, 0);
  });
  await test('no page errors across the whole run', async () => {
    const hard = A.errors.filter((e) => !/network is off|learn|game logs/i.test(e));
    assert.strictEqual(hard.length, 0, hard.slice(0, 3).join(' | '));
  });
  A.w.close();
  await test('a final box that is a few plays short of the final score is not graded; a damaged saved row does not break the edge record', async () => {
    let short = false;
    const B = await boot('pre', (w, state, fxOf) => {
      w.localStorage.setItem('ledger:v1', JSON.stringify([[null], 'junk', ['9:9:pts:0', '2026-01-01', 'Old Row', 'AAA', 'pts', 10.5, 0.7, 0.6, 0, Date.now() - 8 * 86400000, null, null]]));
      const cut = (fx) => { let i = fx.plays.length - 1, made = 0; while (i > 0 && made < 2) { if (fx.plays[i].home_score !== fx.plays[i - 1].home_score || fx.plays[i].away_score !== fx.plays[i - 1].away_score) made++; i--; } return fx.plays.slice(0, i + 1); };
      w.DB.livePlays = async (g) => { const fx = fxOf(g.id); return state.phase === 'final' ? (short ? cut(fx) : fx.plays) : fx.plays.filter((p) => p.period <= 2); };
      w.DB.plays = async (id) => (short ? cut(fxOf(id)) : fxOf(id).plays);
    });
    await sleep(2500);
    let v = await B.go('#/settings', 300);
    assert.ok(/EDGE RECORD/.test(v.textContent), 'settings did not render with a damaged saved row');
    let rows = JSON.parse(B.w.localStorage.getItem('ledger:v1') || '[]');
    assert.ok(rows.length >= 3 && rows.every((r) => Array.isArray(r) && r.length >= 12), 'damaged rows were kept');
    const old = rows.find((r) => r[0] === '9:9:pts:0');
    assert.ok(old && old[10] === -1, 'a row waiting for more than 6 days was not closed as no action');
    short = true; B.state.phase = 'final';
    B.w.document.getElementById('refreshBtn').click();
    await sleep(3000);
    rows = JSON.parse(B.w.localStorage.getItem('ledger:v1') || '[]');
    const fresh = rows.filter((r) => r[0] !== '9:9:pts:0');
    assert.ok(fresh.length >= 3 && fresh.every((r) => r[10] == null), `graded ${fresh.filter((r) => r[10] != null).length} edges from a box that does not add up`);
    short = false;
    B.w.document.getElementById('refreshBtn').click();
    await sleep(3000);
    rows = JSON.parse(B.w.localStorage.getItem('ledger:v1') || '[]');
    assert.ok(rows.filter((r) => r[0] !== '9:9:pts:0' && r[10] != null).length >= 3, 'edges were not graded once the full box arrived');
    B.w.close();
  });
  await test('when the scores cannot be reached at start, the board says so instead of loading forever', async () => {
    let down = true;
    const C = await boot('pre', (w) => { const real = w.DB.slate; w.DB.slate = async (...a) => { if (down) throw new Error('DataBallr 503'); return real(...a); }; });
    await sleep(1500);
    let v = await C.go('#/games', 300);
    assert.ok(/reach the scores/i.test(v.textContent), `board shows: ${v.textContent.trim().slice(0, 80)}`);
    down = false;
    C.w.document.getElementById('refreshBtn').click();
    await sleep(2500);
    v = await C.go('#/games', 300);
    assert.ok(/[A-Z]{3}/.test(v.textContent) && !/reach the scores/i.test(v.textContent), 'the board did not recover');
    C.w.close();
  });
  console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
  process.exit(process.exitCode || 0);
})();
