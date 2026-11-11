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

// (windows are never closed during the run: closing one in the middle of the app's own work makes the simulated browser
// throw from that pending work later; the process exit at the end takes them all down)
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
  const morningAfter = async (seed, offDay) => {
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
      w.DB.slate = async (d) => (d === DAY ? FX.map((x) => x.g) : d === next && !offDay ? FX.map(tonight) : []);
      w.DB.livePlays = async () => [];
      w.DB.props = async () => [];
      if (seed) seed(w);
    });
    const next = M.w.DB.addDays(DAY, 1);
    for (let i = 0; i < 240; i++) { await sleep(500); const rec = JSON.parse(M.w.localStorage.getItem('pat:v5:dates') || 'null'); if (rec && rec.checked === next) break; }
    const rec = JSON.parse(M.w.localStorage.getItem('pat:v5:dates') || 'null'), sum = JSON.parse(M.w.localStorage.getItem('pat:v5:sum') || 'null');
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
  console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
  process.exit(process.exitCode || 0);
})();
