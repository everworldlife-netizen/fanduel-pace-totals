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
const test = async (name, fn) => { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };

// (windows are never closed during the run: closing one in the middle of the app's own work makes the simulated browser
// throw from that pending work later; the process exit at the end takes them all down)
async function boot(phase, hook, pre) {
  const html = read('index.html').replace(/<script src="[^"]+"><\/script>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
  const dom = new JSDOM(html, { url: 'https://everworldlife-courtside-arcade.static.hf.space/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
  w.console = { ...console, warn: (...a) => errors.push('warn: ' + a.map(String).join(' ')), error: (...a) => errors.push('error: ' + a.map(String).join(' ')), log: () => {} };
  // the network is off in tests, except the server's clock (the Date header of a same-origin file); a test can set w.__serverNow
  w.fetch = async (u, o) => { if (o && o.method === 'HEAD') return { ok: true, headers: { get: (k) => (String(k).toLowerCase() === 'date' ? new Date(w.__serverNow ? w.__serverNow() : Date.now()).toUTCString() : null) } }; throw new Error('network is off in tests'); };
  if (pre) pre(w); // a test can seed saved data before the data module starts
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
  });
  // ---- the phone's own learning and accuracy table: a finished game is replayed with what the app knew BEFORE it
  const SNAP_F = ['gp', 'mpg', 'pts', 'reb', 'ast', 'fg3m', 'fg3a', 'p3', 'p2', 'ft', 'tsa100', 'tovpg', 'offPoss', 'r3', 'ftr'];
  const DAY = FX[0].g.date, TIP = Math.min(...FX.map((x) => Date.parse(x.g.datetime)));
  const CUR = Object.assign({}, ...FX.map((x) => x.base.priors.cur));
  const copyOf = (at) => JSON.stringify({ at, tAt: at, p: Object.fromEntries(Object.entries(CUR).map(([k, c]) => [k, SNAP_F.map((f) => (c[f] == null ? null : +(+c[f]).toPrecision(3)))])), t: { teams: FX[0].base.teams.teams, league: FX[0].base.teams.league } });
  // the morning after the fixture games: they are final, and today's season table is deliberately wrong (a full season of games
  // with every scoring, rebounding and assist rate tripled), so a replay that used today's table would show up as a huge miss in the phone's own table
  const morningAfter = async (seed, offDay, opt = {}) => {
    const graded = []; // the season lines each learning replay was given
    const M = await boot('final', (w) => {
      const post = w.Worker.prototype.postMessage;
      w.Worker.prototype.postMessage = function (m) { if (m && m.payload && m.payload.grade) graded.push(m.payload.priors && m.payload.priors.cur); return post.call(this, m); };
      const next = w.DB.addDays(DAY, 1);
      w.__PAT_FROM = DAY;
      w.DB.etDate = (o = 0) => w.DB.addDays(next, o);
      w.DB.currentSeasonPriors = async () => Object.fromEntries(Object.entries(CUR).map(([k, c]) => [k, { ...c, gp: 82, pts: c.pts * 3, reb: c.reb * 3, ast: c.ast * 3 }]));
      // yesterday's games are final; the same two teams play again tonight (the app only does its background work on a day with games)
      const tonight = (fx) => ({ ...fx.g, date: next, datetime: new Date(Date.parse(fx.g.datetime) + 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
      // (opt.late: one of last night's games is still going until the test says otherwise; opt.reads counts how often last night is read)
      const lastNight = () => FX.map((x, i) => (opt.late && opt.late.on && i === 1 ? { ...x.g, status_state: 'in', period: 4, time: 'Q4 2:00', status: 'Q4 2:00' } : x.g));
      w.DB.slate = async (d) => { if (d === DAY && opt.reads) opt.reads.n++; return d === DAY ? lastNight() : d === next && !offDay ? FX.map(tonight) : []; };
      if (opt.retryMs) w.__LEARN_RETRY_MS = opt.retryMs;
      w.DB.livePlays = async () => [];
      w.DB.props = async () => [];
      if (seed) seed(w);
    });
    const next = M.w.DB.addDays(DAY, 1);
    for (let i = 0; i < (opt.wait || 240); i++) { await sleep(500); const rec = JSON.parse(M.w.localStorage.getItem('pat:v6:dates') || 'null'); if (rec && rec.checked === next) break; }
    const rec = JSON.parse(M.w.localStorage.getItem('pat:v6:dates') || 'null'), sum = JSON.parse(M.w.localStorage.getItem('pat:v6:sum') || 'null');
    return { M, rec, sum, graded };
  };
  await test('a dated copy of the season stats and the team table is saved on the first load of the day', async () => {
    const B = await boot('pre');
    await sleep(2500);
    const sn = JSON.parse(B.w.localStorage.getItem(`psnap:${DAY}`) || 'null');
    assert.ok(sn && sn.p && Object.keys(sn.p).length >= 200, 'no copy of the season lines was saved');
    assert.ok(sn.t && sn.t.teams && Object.keys(sn.t.teams).length >= 20 && sn.at > 0 && sn.tAt > 0, 'the copy has no team table');
    assert.strictEqual(sn.p[Object.keys(CUR)[0]].length, SNAP_F.length);
    assert.ok(JSON.stringify(sn).length < 70000, `the copy takes ${JSON.stringify(sn).length} characters of the phone's storage`);
  });
  await test('the morning after, finished games are replayed with the copy saved before tip-off, not with today\'s table', async () => {
    const { M, rec, sum, graded } = await morningAfter((w) => w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP - 3600000)));
    // every replay got the lines of the saved copy (3 digits), not today's
    assert.ok(graded.length >= 2, `only ${graded.length} learning replays ran`);
    for (const cur of graded) for (const k of Object.keys(CUR).slice(0, 40)) {
      assert.ok(cur && cur[k], `${k} is missing from the lines a replay was given`);
      assert.strictEqual(cur[k].gp, CUR[k].gp, `${k}: the replay was given ${cur[k].gp} games played, the copy from before the game says ${CUR[k].gp}`);
      assert.ok(Math.abs(cur[k].pts - CUR[k].pts) <= 6e-3 * CUR[k].pts + 1e-9, `${k}: the replay was given today's scoring rate`);
    }
    assert.ok(rec && rec.done.includes(DAY), `the night was not closed: ${JSON.stringify(rec)} | ${M.errors.slice(0, 4).join(' | ').slice(0, 400)}`);
    assert.ok(sum && sum.acc && sum.acc.pre && sum.acc.pre.n >= 20, 'the finished games were not learned from');
    const miss = sum.acc.pre.pts / sum.acc.pre.n;
    assert.ok(miss < 7.5, `tip-off points miss in the phone's own table is ${miss.toFixed(2)}: the replay used today's (wrong) table`);
    assert.ok(rec.games >= 2, `only ${rec.games} games counted`);
    // the screen says how the phone's own table is made
    const v = await M.go('#/settings', 400);
    assert.ok(/saved before that game tipped/.test(v.textContent), 'the settings screen does not say how the phone grades itself');
    assert.deepStrictEqual(banned(visibleText(M.w)), []);
    assert.deepStrictEqual(M.errors.filter((e) => !/^warn: learn/.test(e)), []);
  });
  await test('on a day with no games the app still learns from last night and saves its copy of the tables', async () => {
    const { M, rec, sum } = await morningAfter((w) => w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP - 3600000)), true);
    assert.ok(rec && rec.done.includes(DAY), `the night was not closed on an off day: ${JSON.stringify(rec)} | ${M.errors.slice(0, 3).join(' | ').slice(0, 300)}`);
    assert.ok(sum && sum.acc && sum.acc.pre && sum.acc.pre.n >= 20, 'last night was not learned from on an off day');
    const next = M.w.DB.addDays(DAY, 1);
    assert.ok(JSON.parse(M.w.localStorage.getItem(`psnap:${next}`) || 'null'), 'no copy of the tables was saved on the off day');
    const v = await M.go('#/games', 300);
    assert.ok(!/Loading player profiles/.test(v.textContent), 'the empty board is stuck on a loading line');
    assert.deepStrictEqual(M.errors.filter((e) => !/^warn: learn/.test(e)), []);
  });
  await test('a night with no copy from before tip-off is left out of the phone\'s lessons and table (the edge record is still graded)', async () => {
    for (const seed of [null, (w) => w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP + 60000))]) {
      const { M, rec, sum } = await morningAfter(seed);
      assert.ok(rec && rec.done.includes(DAY), 'the night was not closed');
      assert.ok(!sum || !sum.acc || !sum.acc.pre || !(sum.acc.pre.n > 0), `the night was learned from ${seed ? 'with a copy saved after the first tip' : 'with no copy at all'}`);
      assert.strictEqual(rec.games || 0, 0);
    }
  });
  await test('a copy from the day before is enough, and old copies are only removed after the night has been learned', async () => {
    const dayBefore = (n) => { const d = new Date(DAY + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    const { M, rec, sum } = await morningAfter((w) => { w.localStorage.setItem(`psnap:${dayBefore(1)}`, copyOf(TIP - 30 * 3600000)); w.localStorage.setItem(`psnap:${dayBefore(4)}`, copyOf(TIP - 100 * 3600000)); });
    assert.ok(rec && rec.done.includes(DAY) && rec.games >= 2 && sum && sum.acc.pre.n >= 20, `the night was not learned from the day-before copy: ${JSON.stringify(rec)}`);
    const left = Object.keys(M.w.localStorage).filter((k) => k.startsWith('psnap:')).sort();
    assert.ok(!left.includes(`psnap:${dayBefore(4)}`), 'a copy no night can need any more was kept');
    assert.ok(left.includes(`psnap:${dayBefore(1)}`), 'the copy from two days ago was removed although a retry could still need it');
  });
  await test('while one of last night\'s games is still going the day is not called checked; once it is final the night is learned the same day', async () => {
    const late = { on: true };
    const { M, rec: rec1 } = await morningAfter((w) => w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP - 3600000)), false, { late, retryMs: 300, wait: 24 });
    const next = M.w.DB.addDays(DAY, 1);
    assert.ok(!rec1 || (rec1.checked !== next && !rec1.done.includes(DAY)), `the day was called checked with a game still going: ${JSON.stringify(rec1)}`);
    late.on = false;
    M.w.document.getElementById('refreshBtn').click();
    let rec = null;
    for (let i = 0; i < 240; i++) { await sleep(500); rec = JSON.parse(M.w.localStorage.getItem('pat:v6:dates') || 'null'); if (rec && rec.checked === next) break; }
    assert.ok(rec && rec.checked === next && rec.done.includes(DAY) && rec.games >= 2, `the night was not learned once its last game was final: ${JSON.stringify(rec)}`);
  });
  await test('when the phone refuses to store anything the nightly check still runs only once a day', async () => {
    const reads = { n: 0 };
    const M = await boot('final', (w) => {
      const next = w.DB.addDays(DAY, 1);
      w.__PAT_FROM = DAY; w.__LEARN_RETRY_MS = 200;
      w.DB.etDate = (o = 0) => w.DB.addDays(next, o);
      const tonight = (fx) => ({ ...fx.g, date: next, datetime: new Date(Date.parse(fx.g.datetime) + 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
      w.DB.slate = async (d) => { if (d === DAY) reads.n++; return d === DAY ? FX.map((x) => x.g) : d === next ? FX.map(tonight) : []; };
      w.DB.livePlays = async () => []; w.DB.props = async () => [];
    }, (w) => { w.Storage.prototype.setItem = function () { throw new w.DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; });
    // wait until the app has settled (the nightly check and the edge-record sweep each look at last night once, a few seconds after the first load)
    let first = -1;
    for (let k = 0, same = 0; k < 40 && same < 4; k++) { await sleep(2500); same = reads.n === first ? same + 1 : 0; first = reads.n; }
    assert.ok(first >= 1, 'last night was never looked at');
    for (let k = 0; k < 3; k++) { M.w.document.getElementById('refreshBtn').click(); await sleep(6000); }
    assert.strictEqual(reads.n, first, `last night was read ${reads.n} times (once is enough)`);
    assert.deepStrictEqual(M.errors.filter((e) => !/^warn:/.test(e)), []);
  });
  await test('if today\'s season table did not load, last night waits instead of being replayed with no season lines', async () => {
    let jobs = 0;
    const { rec } = await morningAfter((w) => {
      w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP - 3600000));
      w.DB.currentSeasonPriors = async () => ({});
      const post = w.Worker.prototype.postMessage;
      w.Worker.prototype.postMessage = function (m) { if (m && m.payload && m.payload.grade) jobs++; return post.call(this, m); };
    }, false, { wait: 24 });
    assert.strictEqual(jobs, 0, 'a learning replay ran with an empty season table');
    assert.ok(!rec || !rec.done.includes(DAY), 'the night was closed although it could not be replayed properly');
  });
  await test('a phone whose clock runs slow cannot stamp a copy earlier than it was really taken', async () => {
    // the server says it is 12 hours after last night's first tip; the phone believes it is three hours before it
    const B = await boot('pre', (w) => { w.__serverNow = () => TIP + 12 * 3600000; w.Date.now = () => TIP - 3 * 3600000; });
    await sleep(3500);
    const sn = JSON.parse(B.w.localStorage.getItem(`psnap:${DAY}`) || 'null');
    assert.ok(sn && sn.p && sn.t, 'no copy was saved');
    assert.ok(sn.at >= TIP + 11 * 3600000 && sn.tAt >= TIP + 11 * 3600000, `the copy is stamped ${new Date(sn.at).toISOString()} (the phone's clock), the server's time is ${new Date(TIP + 12 * 3600000).toISOString()}`);
  });
  await test('with no server time the app saves no copy at all (a wrong stamp is worse than no copy)', async () => {
    const B = await boot('pre', (w) => { w.fetch = async () => { throw new Error('network is off in tests'); }; });
    await sleep(3500);
    assert.strictEqual(B.w.localStorage.getItem(`psnap:${DAY}`), null);
    assert.deepStrictEqual(B.errors.filter((e) => !/^warn:/.test(e)), []);
  });
  await test('dated keys that nothing reads any more are cleared at start, fresh ones stay', async () => {
    const real = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const back = (n) => { const d = new Date(real + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    const B = await boot('pre', null, (w) => {
      const L = w.localStorage;
      L.setItem(`slate:v6:${back(40)}`, '[]'); L.setItem(`slate:v6:${back(10)}`, '[]'); L.setItem(`slate:v5:${back(4)}`, '[]'); // (v5: saved by the version before)
      L.setItem(`slate:last:${back(3)}`, '[]'); L.setItem(`slate:last:${back(1)}`, '[]');
      L.setItem(`tip:${back(5)}`, '{}'); L.setItem(`tip:${back(1)}`, '{}'); L.setItem(`overrides:${back(9)}`, '{}');
      L.setItem('glines:111', JSON.stringify({ at: Date.now() - 9 * 86400000, c: {} })); L.setItem('glines:222', JSON.stringify({ at: Date.now() - 3600000, c: {} }));
      L.setItem('ledger:v1', '[]'); L.setItem('settings', '{}');
    });
    const has = (k) => B.w.localStorage.getItem(k) != null;
    for (const k of [`slate:v6:${back(40)}`, `slate:v5:${back(4)}`, `slate:last:${back(3)}`, `tip:${back(5)}`, `overrides:${back(9)}`, 'glines:111']) assert.ok(!has(k), `${k} was kept`);
    for (const k of [`slate:v6:${back(10)}`, `slate:last:${back(1)}`, `tip:${back(1)}`, 'glines:222', 'ledger:v1']) assert.ok(has(k), `${k} was removed`);
  });
  await test('a number of calendar days from today is right in the hour around a daylight-saving change', async () => {
    const vm = require('vm');
    const src = read('data.js');
    const fnSrc = src.slice(src.indexOf('function addDays('), src.indexOf('const lastSlate'));
    const at = (iso) => { const FIXED = Date.parse(iso); class D extends Date { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } } const ctx = { Date: D, Intl }; vm.runInNewContext(`${fnSrc}; this.etDate = etDate;`, ctx); return ctx.etDate; };
    let f = at('2027-03-15T04:30:00Z'); // 12:30 AM Eastern, the night after clocks go forward
    assert.strictEqual(f(0), '2027-03-15'); assert.strictEqual(f(-1), '2027-03-14'); assert.strictEqual(f(1), '2027-03-16');
    f = at('2026-11-02T04:30:00Z'); // 11:30 PM Eastern on the day clocks go back
    assert.strictEqual(f(0), '2026-11-01'); assert.strictEqual(f(-1), '2026-10-31'); assert.strictEqual(f(1), '2026-11-02');
  });
  await test('overtime reads as OT on the board, and the player sheet has its points + rebounds + assists section', async () => {
    const B = await boot('live', (w, state, fxOf) => {
      const E = w.Engine;
      const ot = (fx) => { const bx = E.boxFromPlays(fx.plays, 4, '0:00'), v = fx.g.visitor_team.abbreviation, h = fx.g.home_team.abbreviation; return { ...fx.g, status_state: 'in', display_status: 'OT 2:30', status: 'OT 2:30', period: 5, time: 'OT 2:30', visitor_team_score: bx.teams[v].pts, home_team_score: bx.teams[h].pts }; };
      w.DB.slate = async (d) => (d === DAY ? FX.map(ot) : []);
      w.DB.livePlays = async (g) => fxOf(g.id).plays.filter((p) => p.period <= 4);
      w.DB.props = async () => [];
    });
    await sleep(6000);
    let v = await B.go('#/games', 600);
    assert.ok(/OT 2:30/.test(v.textContent), `the board shows: ${v.textContent.replace(/\s+/g, ' ').slice(0, 160)}`);
    assert.ok(!/QOT|Q5/.test(v.textContent), 'overtime is written as a fifth quarter');
    const link = v.querySelector('a[href^="#/game/"]');
    v = await B.go(link.getAttribute('href'), 1500);
    const btn = v.querySelector('[data-act="player"]');
    assert.ok(btn, 'no player rows on the game screen');
    btn.click(); await sleep(800);
    const sheet = B.w.document.getElementById('sheetWrap');
    assert.ok(sheet && /PTS\+REB\+AST/.test(sheet.textContent), 'the player sheet has no points + rebounds + assists section');
    assert.deepStrictEqual(banned(visibleText(B.w)), []);
    assert.deepStrictEqual(B.errors.filter((e) => !/^warn:/.test(e)), []);
  });
  // ---- review pass 3 (after publishing version 16): an app that stays open, a full phone, two copies of the app
  // a movable calendar: the fixture games are final on DAY; the same teams play again on each of the next two days
  const calendar = (cur, count = {}) => (w) => {
    w.DB.etDate = (o = 0) => w.DB.addDays(cur.day, o);
    const later = (fx, n) => ({ ...fx.g, id: fx.g.id + n * 1000000, date: w.DB.addDays(DAY, n), datetime: new Date(Date.parse(fx.g.datetime) + n * 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
    const lastNight = () => FX.map((x, i) => (cur.late && i === 1 ? { ...x.g, status_state: 'in', period: 4, time: 'Q4 2:00', status: 'Q4 2:00', display_status: 'Q4 2:00' } : x.g));
    w.DB.slate = async (d) => (d === DAY ? lastNight() : d === w.DB.addDays(DAY, 1) ? FX.map((x) => later(x, 1)) : d === w.DB.addDays(DAY, 2) ? FX.map((x) => later(x, 2)) : []);
    const realCur = w.DB.currentSeasonPriors, realLogs = w.DB.teamLogs;
    w.DB.currentSeasonPriors = async (...a) => { count.table = (count.table || 0) + 1; return realCur(...a); };
    w.DB.teamLogs = async (teams, date, ...r) => { (count.logs = count.logs || []).push(date); return realLogs(teams, date, ...r); };
    w.DB.props = async () => []; w.DB.linesFor = () => null; w.DB.availability = async () => null;
    w.__PAT_FROM = '2099-01-01'; // (no nightly learning in these tests)
  };
  const label = (v) => (v.querySelector('.datebar .label') || {}).textContent;
  await test('an app left open overnight moves to the new day when it comes back to the front, and reads the season table and the recent games again', async () => {
    const cur = { day: DAY }, count = {};
    const A = await boot('final', calendar(cur, count));
    await sleep(4000);
    let v = await A.go('#/games', 400);
    assert.ok(/^Today/.test(label(v)), `the board says ${label(v)}`);
    assert.strictEqual(count.table, 1);
    const next = A.w.DB.addDays(DAY, 1);
    cur.day = next; // midnight has passed; the page was never reloaded
    A.w.document.dispatchEvent(new A.w.Event('visibilitychange'));
    await sleep(5000);
    v = await A.go('#/games', 400);
    const want = new Date(next + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    assert.strictEqual(label(v).replace(/\s+/g, ''), ('Today' + want).replace(/\s+/g, ''), 'the board did not move to the new day');
    assert.ok(/7:00 PM ET/.test(v.textContent), 'tonight\'s games are not on the board');
    assert.strictEqual(count.table, 2, `the season table was read ${count.table} time(s): tonight's numbers would not know about last night`);
    assert.ok(count.logs.includes(next), `recent games were not read again for the new day (read for: ${count.logs.join(', ')})`);
    // one tap on the next-day arrow is tomorrow, one tap back is today again
    v.querySelector('[data-act="day"][data-d="1"]').click(); await sleep(2500);
    assert.ok(/^Tomorrow/.test(label(A.w.document.getElementById('view'))), `after one tap forward the board says ${label(A.w.document.getElementById('view'))}`);
    A.w.document.getElementById('view').querySelector('[data-act="day"][data-d="-1"]').click(); await sleep(2500);
    assert.ok(/^Today/.test(label(A.w.document.getElementById('view'))));
    assert.ok(A.w.localStorage.getItem(`psnap:${next}`), 'no dated copy was saved for the new day');
    assert.deepStrictEqual(banned(visibleText(A.w)), []);
    assert.deepStrictEqual(A.errors.filter((e) => !/^warn:/.test(e)), []);
  });
  await test('an app that stays on screen past midnight moves by itself; while last night\'s games are still going it stays on them, then moves the next time it is opened', async () => {
    // (a) nothing live: the regular five-second look moves the board without any tap
    let cur = { day: DAY }, count = {};
    const A = await boot('final', calendar(cur, count));
    await sleep(3500);
    cur.day = A.w.DB.addDays(DAY, 1);
    await sleep(9000);
    assert.strictEqual(count.table, 2, 'the open app did not start over on the new day by itself');
    let v = await A.go('#/games', 400);
    assert.ok(/^Today/.test(label(v)) && /7:00 PM ET/.test(v.textContent), `the open app still shows ${label(v)}`);
    // (b) one of last night's games is still being played at midnight: the board stays on it and calls the day yesterday
    cur = { day: DAY, late: true }; count = {};
    const B = await boot('final', calendar(cur, count));
    await sleep(3500);
    cur.day = B.w.DB.addDays(DAY, 1);
    B.w.document.dispatchEvent(new B.w.Event('visibilitychange'));
    await sleep(7000);
    v = await B.go('#/games', 400);
    assert.ok(/^Yesterday/.test(label(v)), `with a late game still going the board says ${label(v)}`);
    assert.ok(/Q4 2:00/.test(v.textContent), 'the late game left the board');
    assert.strictEqual(count.table, 1, 'the season table was swapped in the middle of a game');
    // the late game ends; the app stays where the user is looking until it is next brought to the front
    cur.late = false;
    await sleep(7000);
    assert.ok(/^Yesterday/.test(label(B.w.document.getElementById('view'))), 'the board jumped away from the game that just ended');
    B.w.document.dispatchEvent(new B.w.Event('visibilitychange'));
    await sleep(5000);
    v = await B.go('#/games', 400);
    assert.ok(/^Today/.test(label(v)) && /7:00 PM ET/.test(v.textContent), `after the late game the board says ${label(v)}`);
    assert.strictEqual(count.table, 2);
    assert.deepStrictEqual([...A.errors, ...B.errors].filter((e) => !/^warn:/.test(e)), []);
  });
  await test('a look at tomorrow\'s slate never changes tonight\'s tip-off numbers', async () => {
    const A = await boot('pre', (w, state) => {
      const d1 = w.DB.addDays(DAY, 1), E = w.Engine;
      const rowOf = (fx) => {
        if (state.phase === 'pre') return { ...fx.g, status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 };
        const bx = E.boxFromPlays(fx.plays.filter((p) => p.period <= 2), 2, '0:00'), v = fx.g.visitor_team.abbreviation, h = fx.g.home_team.abbreviation;
        return { ...fx.g, status_state: 'in', display_status: 'Half', status: 'Half', period: 2, time: 'Half', visitor_team_score: bx.teams[v].pts, home_team_score: bx.teams[h].pts };
      };
      const tomorrow = (fx) => ({ ...fx.g, date: d1, datetime: new Date(Date.parse(fx.g.datetime) + 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
      w.DB.slate = async (d) => (d === DAY ? FX.map(rowOf) : d === d1 ? FX.map(tomorrow) : []);
      const realAvail = w.DB.availability;
      // tomorrow the visitors' first listed starter is ruled out, so everybody's number is different
      w.DB.availability = async (g) => {
        const av = await realAvail(g);
        if (g.date !== d1 || !av) return av;
        const tm = g.visitor_team.abbreviation, star = av.in.find((x) => x.team === tm && x.starter);
        return { ...av, in: av.in.filter((x) => x !== star), out: [...av.out, { name: star.name, why: 'out (rest)', team: tm }], starters: { ...av.starters, [tm]: av.starters[tm].filter((n) => n !== star.name) } };
      };
      w.DB.props = async () => [];
    });
    let tip0 = null;
    for (let k = 0, same = 0; k < 40 && same < 3; k++) { await sleep(1500); const t = A.w.localStorage.getItem(`tip:${DAY}`); same = t && t === tip0 ? same + 1 : 0; tip0 = t; }
    assert.ok(tip0 && Object.keys(JSON.parse(tip0)).length >= 40, `tip-off numbers were kept for only ${tip0 ? Object.keys(JSON.parse(tip0)).length : 0} players before the game`);
    A.state.phase = 'live';
    A.w.document.getElementById('refreshBtn').click();
    await sleep(6000);
    const since = async () => { const v = await A.go('#/scorers', 500); return [...v.querySelectorAll('.card.scorer')].map((c) => `${c.querySelector('.nmrow b').textContent}: ${c.querySelector('.big').textContent}${c.querySelector('.mv') ? ' ' + c.querySelector('.mv').textContent : ''}`); };
    const before = await since();
    assert.ok(before.length >= 8 && before.some((x) => /since tip/.test(x)), `the scorers screen shows no moves since tip-off: ${before.slice(0, 3).join(' | ')}`);
    let v = await A.go('#/games', 300);
    v.querySelector('[data-act="day"][data-d="1"]').click(); await sleep(4000);
    A.w.document.getElementById('view').querySelector('[data-act="day"][data-d="-1"]').click(); await sleep(4500);
    const after = await since();
    assert.deepStrictEqual(after, before, 'the moves since tip-off changed after a look at tomorrow');
    assert.strictEqual(A.w.localStorage.getItem(`tip:${DAY}`), tip0, 'tonight\'s saved tip-off numbers were rewritten');
  });
  await test('the six rungs on a player sheet sit around his number, for a star too', async () => {
    const B = await boot('pre', (w) => { w.DB.props = async () => []; });
    await sleep(3000);
    const pr = [...FX].map((x) => x.g.id);
    let best = null;
    for (const gid of pr) {
      const v = await B.go(`#/game/${gid}`, 900);
      for (const btn of v.querySelectorAll('[data-act="player"]')) {
        btn.click(); await sleep(60);
        const sheet = B.w.document.getElementById('sheetWrap');
        if (!sheet) continue;
        for (const h of sheet.querySelectorAll('h3')) {
          const m = /^(POINTS|PTS\+REB\+AST)[^→]*→\s*([\d.]+)/.exec(h.textContent.trim());
          if (!m || !h.nextElementSibling || !h.nextElementSibling.classList.contains('ladder')) continue;
          const rungs = [...h.nextElementSibling.querySelectorAll('.rung span:first-child')].map((x) => parseInt(x.textContent, 10));
          const row = { who: btn.textContent.replace(/\s+/g, ' ').slice(0, 30), stat: m[1], proj: +m[2], rungs };
          if (!best || (row.stat === 'PTS+REB+AST' && row.proj > best.proj)) best = row;
          assert.ok(rungs.length <= 6, 'more than six rungs');
          // the rungs reach his number: the highest one shown is above it, unless the ladder itself ends below it
          const top = row.stat === 'POINTS' ? 45 : 60;
          assert.ok(Math.max(...rungs) > row.proj || Math.max(...rungs) >= top || rungs.length < 6, `${row.who} ${row.stat}: number ${row.proj}, rungs ${rungs.join(', ')} stop short of it`);
        }
        const close = B.w.document.querySelector('#sheetWrap [data-act="close"]'); if (close) close.click();
        await sleep(20);
      }
    }
    assert.ok(best && best.stat === 'PTS+REB+AST' && best.proj >= 36, `the fixture has no player with a big points + rebounds + assists number to test with (best: ${JSON.stringify(best)})`);
    assert.ok(best.rungs.some((t) => t <= best.proj) && best.rungs.some((t) => t > best.proj), `the top player's rungs ${best.rungs.join(', ')} do not sit around his number ${best.proj}`);
  });
  await test('opened again five days after the games, the night is still learned from the copy saved the day before', async () => {
    const n = 5, graded = [];
    const A = await boot('final', (w) => {
      const today = w.DB.addDays(DAY, n);
      w.__PAT_FROM = DAY;
      w.DB.etDate = (o = 0) => w.DB.addDays(today, o);
      const tonight = (fx) => ({ ...fx.g, date: today, datetime: new Date(Date.parse(fx.g.datetime) + n * 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
      w.DB.slate = async (d) => (d === DAY ? FX.map((x) => x.g) : d === today ? FX.map(tonight) : []);
      w.DB.livePlays = async () => []; w.DB.props = async () => [];
      w.localStorage.setItem(`psnap:${w.DB.addDays(DAY, -1)}`, copyOf(TIP - 30 * 3600000)); // saved the day before: good for the night
      w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP + 3600000)); // saved an hour after the first tip: not usable
      const post = w.Worker.prototype.postMessage;
      w.Worker.prototype.postMessage = function (m) { if (m && m.payload && m.payload.grade) graded.push(1); return post.call(this, m); };
    });
    const today = A.w.DB.addDays(DAY, n);
    let rec = null;
    for (let i = 0; i < 240; i++) { await sleep(500); rec = JSON.parse(A.w.localStorage.getItem('pat:v6:dates') || 'null'); if (rec && rec.checked === today) break; }
    assert.ok(graded.length >= 2 && rec && rec.done.includes(DAY) && rec.games >= 2, `the night was closed with nothing learned: ${JSON.stringify(rec)}, ${graded.length} replays`);
    assert.deepStrictEqual(Object.keys(A.w.localStorage).filter((k) => k.startsWith('psnap:')).sort(), [`psnap:${today}`], 'old copies were not cleared after the learning');
  });
  await test('with two copies of the app open on one phone, last night is added to the phone\'s lessons once', async () => {
    const hook = (seed) => (w) => {
      const next = w.DB.addDays(DAY, 1);
      w.__PAT_FROM = DAY;
      w.DB.etDate = (o = 0) => w.DB.addDays(next, o);
      const tonight = (fx) => ({ ...fx.g, date: next, datetime: new Date(Date.parse(fx.g.datetime) + 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
      w.DB.slate = async (d) => (d === DAY ? FX.map((x) => x.g) : d === next ? FX.map(tonight) : []);
      w.DB.livePlays = async () => []; w.DB.props = async () => [];
      if (seed) w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP - 3600000));
    };
    const A = await boot('final', hook(true));
    await sleep(1500);
    const L = A.w.localStorage;
    const B = await boot('final', hook(false), (w) => Object.defineProperty(w, 'localStorage', { configurable: true, get: () => L })); // the same storage, as on one phone
    const next = A.w.DB.addDays(DAY, 1);
    let rec = null;
    for (let i = 0; i < 240; i++) { await sleep(500); rec = JSON.parse(L.getItem('pat:v6:dates') || 'null'); if (rec && rec.checked === next && i > 16) break; }
    await sleep(20000); // the second copy finishes its own replays
    rec = JSON.parse(L.getItem('pat:v6:dates') || 'null');
    const sum = JSON.parse(L.getItem('pat:v6:sum') || 'null');
    assert.ok(rec && rec.games === 2 && sum && sum.acc && sum.acc.pre, `nothing learned: ${JSON.stringify(rec)}`);
    assert.strictEqual(sum.acc.pre.g, 2, `the phone's table holds ${sum.acc.pre.g} games for a two-game night: the night was added twice`);
    void B;
  });
  await test('on a full phone a night whose lessons cannot be stored stays open and is not counted; saving makes room by dropping the oldest game logs', async () => {
    // (a) the app: the large write of the night's sums is refused
    let cap = Infinity; const refused = [];
    const total = (L) => { let n = 0; for (const k of Object.keys(L)) n += k.length + (L.getItem(k) || '').length; return n; };
    const hook = (w) => {
      const next = w.DB.addDays(DAY, 1);
      w.__PAT_FROM = DAY;
      w.DB.etDate = (o = 0) => w.DB.addDays(next, o);
      const tonight = (fx) => ({ ...fx.g, date: next, datetime: new Date(Date.parse(fx.g.datetime) + 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
      w.DB.slate = async (d) => (d === DAY ? FX.map((x) => x.g) : d === next ? FX.map(tonight) : []);
      w.DB.livePlays = async () => []; w.DB.props = async () => [];
      w.localStorage.setItem(`psnap:${DAY}`, copyOf(TIP - 3600000));
    };
    const A = await boot('final', hook, (w) => {
      const real = w.Storage.prototype.setItem;
      w.Storage.prototype.setItem = function (k, v) {
        const old = this.getItem(k); const after = total(this) - (old == null ? 0 : k.length + old.length) + k.length + String(v).length;
        if (after > cap) { refused.push(k); throw new w.DOMException('The quota has been exceeded.', 'QuotaExceededError'); }
        return real.call(this, k, v);
      };
    });
    await sleep(2500);
    const L = A.w.localStorage, next = A.w.DB.addDays(DAY, 1);
    cap = total(L) + 150000; // room for the small records, not for the sums (about 330,000 characters)
    let rec = null;
    for (let i = 0; i < 240; i++) { await sleep(500); rec = JSON.parse(L.getItem('pat:v6:dates') || 'null'); if (rec && rec.checked === next) break; }
    assert.ok(refused.includes('pat:v6:sum'), 'the test did not refuse the write of the sums');
    assert.ok(rec && rec.checked === next, `the day was not checked: ${JSON.stringify(rec)}`);
    assert.ok(!rec.done.includes(DAY) && rec.games === 0, `the night was marked done and counted although its lessons are not stored: ${JSON.stringify(rec)}`);
    assert.strictEqual(L.getItem('pat:v6:sum'), null);
    // (b) the store itself: a value larger than one round of dropped logs frees still lands, and the oldest games go first
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://everworldlife-courtside-arcade.static.hf.space/', runScripts: 'outside-only', storageQuota: 900000 });
    const w = dom.window;
    w.fetch = async () => { throw new Error('network is off in tests'); };
    w.eval(read('data.js'));
    const today = w.DB.etDate(0), body = 'x'.repeat(8000);
    for (let i = 0; i < 100; i++) w.localStorage.setItem(`log:v6:${21700000 + i}`, JSON.stringify({ id: 21700000 + i, date: today, pad: body }));
    assert.ok(total(w.localStorage) > 800000);
    const ok = w.DB.store.set('pat:v6:sum', { big: 'y'.repeat(600000) });
    assert.strictEqual(ok, true, 'a large value did not land although dropping game logs would have made room');
    assert.ok(w.localStorage.getItem('pat:v6:sum').length > 600000);
    const left = Object.keys(w.localStorage).filter((k) => k.startsWith('log:')).map((k) => +k.split(':')[2]).sort((a, b) => a - b);
    assert.ok(left.length > 0 && left.length < 100 && left[0] === 21700000 + (100 - left.length), `the newest logs were dropped first (kept ${left.length}, oldest kept ${left[0]})`);
    assert.strictEqual(w.DB.store.set('too-big', { big: 'z'.repeat(2000000) }), false, 'a value that can never fit was reported as saved');
  });
  await test('a season table that fails to load once is asked for again; game logs older than a month are cleared at start; a table older than six hours is read again', async () => {
    let calls = 0;
    const A = await boot('pre', (w) => {
      const real = w.DB.currentSeasonPriors;
      w.DB.currentSeasonPriors = async (...a) => { calls++; return calls === 1 ? {} : real(...a); };
      w.DB.props = async () => [];
      w.__PRIORS_RETRY_MS = 1;
    });
    await sleep(3000);
    assert.strictEqual(A.w.localStorage.getItem(`psnap:${DAY}`), null, 'a copy was saved from an empty season table');
    A.w.document.getElementById('refreshBtn').click();
    await sleep(3000);
    assert.ok(calls >= 2, `the season table was asked for ${calls} time(s)`);
    const sn = JSON.parse(A.w.localStorage.getItem(`psnap:${DAY}`) || 'null');
    assert.ok(sn && sn.p && Object.keys(sn.p).length >= 200, 'once the table had loaded no dated copy was saved');
    assert.ok(calls <= 3, `the table kept being asked for after it had loaded (${calls} times)`);
    // the data module on its own
    const real = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const back = (n) => { const d = new Date(real + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://everworldlife-courtside-arcade.static.hf.space/', runScripts: 'outside-only' });
    const w = dom.window;
    let asked = 0;
    w.fetch = async (u) => { if (/players\/stats/.test(String(u))) { asked++; return { ok: true, json: async () => [] }; } throw new Error('network is off in tests'); };
    w.localStorage.setItem('log:v6:1', JSON.stringify({ id: 1, date: back(45) + 'T00:00:00.000Z', rows: {} }));
    w.localStorage.setItem('log:v6:2', JSON.stringify({ id: 2, date: back(12), rows: {} }));
    w.eval(read('engine.js'));
    w.eval(read('data.js'));
    assert.strictEqual(w.localStorage.getItem('log:v6:1'), null, 'a game log from 45 days ago was kept');
    assert.ok(w.localStorage.getItem('log:v6:2'), 'a game log from 12 days ago was removed');
    const season = w.DB.seasons(real).cur, key = `priors:p4:cur:${season}`;
    w.localStorage.setItem(key, JSON.stringify({ date: real, at: Date.now() - 3600000, data: { a: 1 } }));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await w.DB.currentSeasonPriors(season, real))), { a: 1 });
    assert.strictEqual(asked, 0, 'a table read an hour ago was read again');
    w.localStorage.setItem(key, JSON.stringify({ date: real, at: Date.now() - 7 * 3600000, data: { a: 1 } }));
    await w.DB.currentSeasonPriors(season, real);
    assert.strictEqual(asked, 1, 'a table read seven hours ago was not read again');
    w.localStorage.setItem(key, JSON.stringify({ date: back(1), at: Date.now() - 600000, data: { a: 1 } }));
    await w.DB.currentSeasonPriors(season, real);
    assert.strictEqual(asked, 2, 'yesterday\'s table was re-used from memory for the new day');
  });
  await test('during a long first load the scores on the board keep moving, and the time on a game screen is never time zero', async () => {
    let release = null; const gate = new Promise((r) => { release = r; });
    const bump = { on: false };
    const A = await boot('live', (w, state, fxOf) => {
      const E = w.Engine;
      const half = (fx) => { const bx = E.boxFromPlays(fx.plays.filter((p) => p.period <= 2), 2, '0:00'), v = fx.g.visitor_team.abbreviation, h = fx.g.home_team.abbreviation; return { ...fx.g, status_state: 'in', display_status: 'Half', status: 'Half', period: 2, time: 'Half', visitor_team_score: bx.teams[v].pts + (bump.on ? 7 : 0), home_team_score: bx.teams[h].pts }; };
      w.DB.slate = async (d) => (d === DAY ? FX.map(half) : []);
      const realLogs = w.DB.teamLogs;
      w.DB.teamLogs = async (...a) => { await gate; return realLogs(...a); }; // "reading three weeks of games" takes as long as the test says
      w.DB.props = async () => [];
    });
    await sleep(1500);
    let v = await A.go('#/games', 300);
    const score0 = v.textContent.replace(/\s+/g, ' ');
    bump.on = true; // the visitors score seven while the phone is still loading
    await sleep(22000);
    v = A.w.document.getElementById('view');
    const E = A.w.Engine, fx = FX[0], bx = E.boxFromPlays(fx.plays.filter((p) => p.period <= 2), 2, '0:00'), want = bx.teams[fx.g.visitor_team.abbreviation].pts + 7;
    assert.ok(v.textContent.replace(/\s+/g, '').includes(`${fx.g.visitor_team.abbreviation}${want}`), `the board still shows the old score during the load (wanted ${want}): ${v.textContent.replace(/\s+/g, ' ').slice(0, 200)}`);
    assert.notStrictEqual(v.textContent.replace(/\s+/g, ' '), score0);
    release();
    await sleep(9000);
    // every "updated" time on the game screens is a real time of day near now, never the stamp of time zero
    const zero = new Date(0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    for (let k = 0; k < 4; k++) {
      for (const x of FX) { v = await A.go(`#/game/${x.g.id}`, 500); const u = v.querySelector('.updated'); assert.ok(u, 'no update line on the game screen'); assert.ok(!u.textContent.includes(`updated ${zero}`), `the game screen says: ${u.textContent}`); }
      await sleep(2500);
    }
    assert.deepStrictEqual(banned(visibleText(A.w)), []);
    assert.deepStrictEqual(A.errors.filter((e) => !/^warn:/.test(e)), []);
  });
  // ---- review of version 17 (Nov 12): the phone was down when things changed
  await test('a late game ends while the phone is down: back at the front the board goes to today, even when the first look at the scores does not get through', async () => {
    for (const firstLookFails of [false, true]) {
      const cur = { day: DAY, late: true }, count = {}, hid = { on: false }, feed = { stuck: false };
      const A = await boot('final', (w) => {
        calendar(cur, count)(w);
        Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => hid.on });
        // (when the scores cannot be reached the data module hands back the slate it kept and says so)
        const realSlate = w.DB.slate, kept = { rows: null };
        w.DB.slate = async (d) => { if (feed.stuck && d === DAY && kept.rows) return kept.rows; const r = await realSlate(d); if (d === DAY) kept.rows = r; return r; };
        w.DB.slateSource = () => (feed.stuck ? 'saved' : 'databallr');
      });
      await sleep(3500);
      let v = await A.go('#/games', 300);
      assert.ok(/^Today/.test(label(v)) && /Q4 2:00/.test(v.textContent), `evening board: ${label(v)}`);
      hid.on = true; A.w.document.dispatchEvent(new A.w.Event('visibilitychange')); // the phone is put down with the game still going
      await sleep(22000);
      cur.day = A.w.DB.addDays(DAY, 1); cur.late = false; // overnight: the game ended, the calendar moved on
      if (firstLookFails) feed.stuck = true;
      hid.on = false; A.w.document.dispatchEvent(new A.w.Event('visibilitychange'));
      if (firstLookFails) { await sleep(2500); v = await A.go('#/games', 300); assert.ok(!/7:00 PM ET/.test(v.textContent), 'the board moved on scores that never came from a feed'); feed.stuck = false; }
      // (waits for the board itself, up to 45 s: the retry after a failed look comes with the next 15-second refresh, and a fixed
      // pause missed it when the machine was busy)
      for (const t0 = Date.now(); Date.now() - t0 < 45000;) { await sleep(1000); v = await A.go('#/games', 300); if (/^Today/.test(label(v)) && /7:00 PM ET/.test(v.textContent)) break; }
      assert.ok(/^Today/.test(label(v)) && /7:00 PM ET/.test(v.textContent), `${firstLookFails ? 'first look failed: ' : ''}next day the board says ${label(v)} and tonight's games are ${/7:00 PM ET/.test(v.textContent) ? '' : 'not '}shown`);
      for (const t0 = Date.now(); Date.now() - t0 < 15000 && count.table < 2;) await sleep(500);
      assert.strictEqual(count.table, 2, 'the season table was not read again for the new day');
      assert.deepStrictEqual(A.errors.filter((e) => !/^warn:/.test(e)), []);
    }
  });
  await test('book lines card: the projected final, the margin and the win chance are explained in plain words, before the tip and at the half', async () => {
    const lines = (w) => { w.DB.linesFor = (g) => (FX.find((x) => +x.g.id === +g.id) || FX[0]).base.market; };
    const fx = FX[0], mk = fx.base.market, vAb = fx.g.visitor_team.abbreviation, hAb = fx.g.home_team.abbreviation;
    const card = async (B) => {
      let v; for (const t0 = Date.now(); Date.now() - t0 < 30000;) { await sleep(700); v = await B.go(`#/game/${fx.g.id}`, 300); if (/BOOK LINES/.test(v.textContent) && /Win chance: we say/.test(v.textContent)) break; }
      const c = [...v.querySelectorAll('.card')].find((x) => /Books win %/.test(x.textContent));
      assert.ok(c, 'no book lines card on the game page');
      return c.textContent.replace(/\s+/g, ' ');
    };
    // before the tip: the total leans on the book's, the margin is the book's spread, the chance comes from that margin
    const B = await boot('pre', lines);
    let t = await card(B);
    const own = /Projected total (\d+): our own count says (\d+), the books have (\d+(?:\.\d+)?)/.exec(t);
    assert.ok(own, `total line: ${t.slice(0, 260)}`);
    assert.ok(Math.abs(+own[1] - (0.9 * mk.total + 0.1 * +own[2])) <= 1.2 && +own[3] === mk.total, `projected total ${own[1]} is not nine tenths the book's ${mk.total} and one tenth ours ${own[2]}`);
    assert.ok(/Before the tip the books' total is the closer of the two/.test(t) && /From nine minutes in, the pace of the game itself decides/.test(t));
    const fav = mk.spreadHome >= 0 ? vAb : hAb;
    assert.ok(new RegExp(`The projected final is ${fav} by ${Math.abs(mk.spreadHome).toFixed(1)}: the books' spread`).test(t), `margin line: ${t}`);
    const win = /Win chance: we say ([A-Z]{3}) (\d+)%, from the projected final margin and how far games really swing from this point\. The books say ([A-Z]{3}) (\d+)%\./.exec(t);
    assert.ok(win && win[1] === fav, `win line: ${t}`);
    assert.ok(Math.abs(+win[2] - 100 * B.w.Engine.normCdf(Math.abs(mk.spreadHome) / 11.5)) <= 1, `pregame chance ${win[2]}% does not come from the spread ${mk.spreadHome}`);
    assert.strictEqual(banned(t).length, 0);
    // at the half: the pace of the game decides the total, the margin is the score plus the book's spread for the time left, with the give-back
    B.state.phase = 'live';
    B.w.document.getElementById('refreshBtn').click();
    for (const t0 = Date.now(); Date.now() - t0 < 30000;) { t = await card(B); if (/from the pace of this game so far/.test(t)) break; }
    assert.ok(/Projected total \d+, from the pace of this game so far\. The books had [\d.]+ before the tip\./.test(t), `live total line: ${t.slice(0, 260)}`);
    assert.ok(/The projected final is (a level game|[A-Z]{3} by [\d.]+): the score now, plus the books' spread for the time left, and a lead usually gives a little back by the end \(we keep 85% of it from here\)/.test(t), `live margin line: ${t}`);
    assert.ok(/Win chance: we say [A-Z]{3} \d+%, from the projected final margin and how far games really swing from this point\. The books said [A-Z]{3} \d+% before the tip\./.test(t), `live win line: ${t}`);
    assert.strictEqual(banned(t).length, 0);
    assert.deepStrictEqual(B.errors.filter((e) => !/^warn:|network is off|learn|game logs/i.test(e)), []);
  });
  await test('after the day changes in an open app each player\'s own game logs are read again too', async () => {
    const cur = { day: DAY }, count = {}, asked = {};
    const A = await boot('final', (w) => {
      calendar(cur, count)(w);
      w.DB.playersLogs = async (want) => { (asked[cur.day] = asked[cur.day] || new Set()); for (const x of want) asked[cur.day].add(x.name); return {}; };
    });
    await sleep(5000);
    const first = asked[DAY] ? asked[DAY].size : 0;
    assert.ok(first >= 10, `only ${first} players had their game logs read on the first day`);
    const next = A.w.DB.addDays(DAY, 1);
    cur.day = next;
    A.w.document.dispatchEvent(new A.w.Event('visibilitychange'));
    await sleep(7000);
    const again = asked[next] ? [...asked[next]].filter((n) => asked[DAY].has(n)).length : 0;
    assert.ok(again >= 0.8 * first, `${again} of ${first} players had their game logs read again after the day changed`);
  });
  await test('a quick look at tomorrow and straight back, while tomorrow is still being worked out, leaves tonight\'s tip-off numbers alone', async () => {
    const gate = { wait: null, release: null }, tap = { armed: false, done: false };
    const A = await boot('pre', (w, state) => {
      const d1 = w.DB.addDays(DAY, 1), E = w.Engine, OFF = 1e9; // (tomorrow's games carry their own ids)
      const rowOf = (fx) => {
        if (state.phase === 'pre') return { ...fx.g, status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 };
        const bx = E.boxFromPlays(fx.plays.filter((p) => p.period <= 2), 2, '0:00'), v = fx.g.visitor_team.abbreviation, h = fx.g.home_team.abbreviation;
        return { ...fx.g, status_state: 'in', display_status: 'Half', status: 'Half', period: 2, time: 'Half', visitor_team_score: bx.teams[v].pts, home_team_score: bx.teams[h].pts };
      };
      const tomorrow = (fx) => ({ ...fx.g, id: fx.g.id + OFF, date: d1, datetime: new Date(Date.parse(fx.g.datetime) + 864e5).toISOString(), status_state: 'scheduled', display_status: '7:00 PM ET', status: '7:00 PM ET', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 });
      w.DB.slate = async (d) => (d === DAY ? FX.map(rowOf) : d === d1 ? FX.map(tomorrow) : []);
      const base = (id) => (+id >= OFF ? +id - OFF : +id), fxOf2 = (id) => FX.find((x) => +x.g.id === base(id));
      const realAvail = w.DB.availability;
      // tomorrow one starter is ruled out, so everybody's number is different from tonight's
      w.DB.availability = async (g) => {
        const av = await realAvail({ ...g, id: base(g.id) });
        if (String(g.date).slice(0, 10) !== d1 || !av) return av;
        const tm = g.visitor_team.abbreviation, star = av.in.find((x) => x.team === tm && x.starter);
        return { ...av, in: av.in.filter((x) => x !== star), out: [...av.out, { name: star.name, why: 'out (rest)', team: tm }], starters: { ...av.starters, [tm]: av.starters[tm].filter((n) => n !== star.name) } };
      };
      w.DB.lineupFor = w.DB.availability;
      w.DB.linesFor = () => null; w.DB.props = async () => [];
      w.DB.livePlays = async (g) => { const fx = fxOf2(g.id); return state.phase === 'pre' || +g.id >= OFF ? [] : fx.plays.filter((p) => p.period <= 2); };
      w.DB.plays = async (id) => fxOf2(id).plays;
      // the players' own game logs for tomorrow's slate take as long as the test says
      w.DB.playersLogs = async () => { if (gate.wait) await gate.wait; return {}; };
      // tap back to tonight at the moment tomorrow's first projection is handed to the worker
      const post = w.Worker.prototype.postMessage;
      w.Worker.prototype.postMessage = function (m) {
        if (tap.armed && !tap.done && m && m.payload && m.payload.game && String(m.payload.game.date).slice(0, 10) === d1) { tap.done = true; setTimeout(() => { const b = w.document.querySelector('[data-act="day"][data-d="-1"]'); if (b) b.click(); }, 0); }
        return post.call(this, m);
      };
    });
    // both games projected before tip-off (wait for the tip-off numbers of every player, however busy the machine is)
    let tip0 = null;
    for (let k = 0, same = 0; k < 40 && same < 3; k++) { await sleep(1500); const t = A.w.localStorage.getItem(`tip:${DAY}`); same = t && t === tip0 ? same + 1 : 0; tip0 = t; }
    assert.ok(tip0 && Object.keys(JSON.parse(tip0)).length >= 40, `tip-off numbers were kept for only ${tip0 ? Object.keys(JSON.parse(tip0)).length : 0} players before the game`);
    A.state.phase = 'live';
    A.w.document.getElementById('refreshBtn').click();
    await sleep(6000);
    const since = async () => { const v = await A.go('#/scorers', 500); return [...v.querySelectorAll('.card.scorer')].map((c) => `${c.querySelector('.nmrow b').textContent}: ${c.querySelector('.big').textContent}${c.querySelector('.mv') ? ' ' + c.querySelector('.mv').textContent : ''}`); };
    const before = await since();
    assert.ok(before.some((x) => /since tip/.test(x)), `no moves since tip-off on the scorers screen: ${before.slice(0, 3).join(' | ')} || ${A.errors.slice(0, 4).join(' | ').slice(0, 500)}`);
    // (1) back while tomorrow's first projection is in flight
    let v = await A.go('#/games', 300);
    tap.armed = true;
    v.querySelector('[data-act="day"][data-d="1"]').click();
    await sleep(6000);
    assert.ok(tap.done, 'the test never tapped back');
    assert.strictEqual(A.w.localStorage.getItem(`tip:${DAY}`), tip0, 'tonight\'s tip-off numbers were rewritten by a projection of tomorrow\'s game that finished late');
    // (2) back while tomorrow's game logs are still being read (they re-project tomorrow's games when they arrive)
    gate.wait = new Promise((r) => { gate.release = r; });
    v = await A.go('#/games', 300);
    v.querySelector('[data-act="day"][data-d="1"]').click();
    await sleep(3500);
    A.w.document.getElementById('view').querySelector('[data-act="day"][data-d="-1"]').click();
    await sleep(1500);
    gate.release(); gate.wait = null;
    await sleep(5000);
    assert.strictEqual(A.w.localStorage.getItem(`tip:${DAY}`), tip0, 'tonight\'s tip-off numbers were rewritten when tomorrow\'s game logs arrived after the tap back');
    assert.deepStrictEqual(await since(), before, 'the moves since tip-off changed');
  });
  console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
  process.exit(process.exitCode || 0);
})();
