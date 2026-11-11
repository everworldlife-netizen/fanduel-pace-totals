/* Courtside engine tests: run on two real games (fixtures/games.json.gz, built by tools/mkfixture.js).
 *   node cs/tests/engine.test.js
 */
'use strict';
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const assert = require('assert');
const E = require(path.join(__dirname, '..', 'build', 'engine.js'));
const FX = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'games.json.gz'))).toString('utf8'));

let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };
const ord = (k) => (k === 1 ? '1st' : k === 2 ? '2nd' : '3rd');
function momentAt(g, plays, el) {
  if (!el) return { game: { ...g, status_state: 'scheduled', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 }, plays: [] };
  const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
  let per, clock, time, ps;
  if (el % 12 === 0) { per = el / 12; clock = '0:00'; time = per === 2 ? 'Half' : `End of ${ord(per)}`; ps = plays.filter((p) => p.period <= per); }
  else { per = Math.floor(el / 12) + 1; const left = (per * 12 - el) * 60; clock = `${Math.floor(left / 60)}:${String(Math.round(left % 60)).padStart(2, '0')}`; time = `Q${per} ${clock}`; ps = plays.filter((p) => p.period < per || (p.period === per && E.clockSec(p.clock) >= left)); }
  const bx = E.boxFromPlays(ps, per, clock);
  return { game: { ...g, status_state: 'in', period: per, time, visitor_team_score: (bx.teams[v] || {}).pts || 0, home_team_score: (bx.teams[h] || {}).pts || 0 }, plays: ps };
}
const run = (fx, el, extra = {}) => { const m = momentAt(fx.g, fx.plays, el); return E.projectGame({ ...fx.base, game: m.game, plays: m.plays, nsims: 400, seed: fx.g.id, patterns: E.patBeta(null), sitPrior: fx.sitPrior, ...extra }); };
const STATS = ['pts', 'reb', 'ast', 'fg3m'];

console.log(`Courtside engine: ${FX.length} fixture games, ${E.PAT_F.length} learned inputs`);
for (const fx of FX) {
  const v = fx.g.visitor_team.abbreviation, h = fx.g.home_team.abbreviation, tag = `${v}@${h}`;
  for (const el of [0, 6, 9, 12, 24, 33, 42, 45]) {
    const P = run(fx, el);
    test(`${tag} at ${el} min: numbers are finite and never below what he already has`, () => {
      assert.ok(P.players.length >= 14, `only ${P.players.length} players`);
      for (const p of P.players) for (const s of [...STATS, 'min']) {
        assert.ok(Number.isFinite(p.proj[s]) && Number.isFinite(p.mean[s]), `${p.name} ${s} not finite`);
        assert.ok(p.proj[s] >= p.now[s] - 1e-6, `${p.name} ${s}: projected ${p.proj[s]} below current ${p.now[s]}`);
      }
      assert.ok(Number.isFinite(P.projScore[v]) && Number.isFinite(P.projScore[h]));
    });
    test(`${tag} at ${el} min: a team never plays more than five players' worth of the time left`, () => {
      for (const tm of [v, h]) {
        const rem = P.players.filter((p) => p.team === tm).reduce((a, p) => a + (p.mean.min - p.now.min), 0);
        // regulation minutes left, plus room for the overtime share of the simulations
        assert.ok(rem <= 5 * P.state.left + 5 * 5 * 0.6 + 0.5, `${tm} has ${rem.toFixed(1)} minutes to come with ${P.state.left} left`);
        assert.ok(rem >= 5 * P.state.left * 0.8 - 0.5, `${tm} has only ${rem.toFixed(1)} minutes to come with ${P.state.left} left`);
      }
    });
    test(`${tag} at ${el} min: stated chances are between 0 and 1 and fall as the rung rises`, () => {
      for (const p of P.players) for (const s of STATS) {
        let prev = 1.0001;
        for (const r of p.ladders[s]) { assert.ok(r.p >= 0 && r.p <= 1, `${p.name} ${s} ${r.t}+ chance ${r.p}`); assert.ok(r.p <= prev + 0.02, `${p.name} ${s} ladder not falling`); prev = r.p; }
      }
    });
  }
  test(`${tag}: same inputs give the same numbers (repeatable)`, () => {
    const a = run(fx, 24), b = run(fx, 24);
    assert.deepStrictEqual(a.players.map((p) => [p.pid, p.proj.pts, p.mean.min]), b.players.map((p) => [p.pid, p.proj.pts, p.mean.min]));
  });
  test(`${tag}: a finished game returns the final box untouched`, () => {
    const P = E.projectGame({ ...fx.base, game: fx.g, plays: fx.plays, nsims: 100, seed: 1, patterns: E.patBeta(null), sitPrior: fx.sitPrior });
    assert.strictEqual(P.state.phase, 'final');
    for (const p of P.players) { const a = fx.rows[p.pid]; if (a) assert.strictEqual(p.proj.pts, a.pts, `${p.name} final points`); }
  });
  test(`${tag}: plus edges only (every pick is projected ahead of its line)`, () => {
    for (const el of [0, 24, 36]) {
      const P = run(fx, el);
      // book lines placed just below, at and above each projection
      const props = [];
      for (const p of P.players.slice(0, 12)) for (const [stat, type] of [['pts', 'points'], ['reb', 'rebounds'], ['ast', 'assists'], ['fg3m', 'threes']]) for (const d of [-2.5, -0.5, 0.5, 2.5]) {
        const line = Math.max(0.5, Math.floor(p.proj[stat] + d) + 0.5);
        props.push({ player_id: p.pid, prop_type: type, line_value: String(line), vendor: 'testbook', market: { type: 'over_under', over_odds: -110, under_odds: -110 } });
      }
      const lines = E.consensusLines(props);
      const picks = E.picksForGame(P, lines, { minP: 0.55 });
      for (const k of picks) {
        assert.ok(k.proj > k.line, `${k.name} ${k.label}: projection ${k.proj} is not ahead of line ${k.line}`);
        if (k.kind === 'line') assert.ok(k.prob >= 0.55 && k.edge >= 0.03, `${k.name} ${k.label}: weak edge shown`);
      }
    }
  });
  test(`${tag}: lineup inputs (v15) reach the learned layer`, () => {
    const P = run(fx, 0);
    const ix = Object.fromEntries(E.PAT_F.map((k, i) => [k, i]));
    for (const k of ['startUp', 'startDown', 'fresh', 'deep', 'vacPos', 'lastMin', 'rest3', 'missShare']) assert.ok(ix[k] > 0, `missing input ${k}`);
    const starters = new Set(fx.base.avail.in.filter((x) => x.starter).map((x) => E.norm(x.name)));
    let up = 0, down = 0;
    for (const p of P.players) {
      const x = p.pat.x.min;
      if (x[ix.startUp] > 0) { up++; assert.ok(starters.has(E.norm(p.name)), `${p.name} flagged as a new starter but is not starting`); }
      if (x[ix.startDown] > 0) { down++; assert.ok(!starters.has(E.norm(p.name)), `${p.name} flagged as not starting but is starting`); }
    }
    assert.ok(up + down > 0, 'no player has a role change flag in either game moment');
  });
  test(`${tag}: before lineups are posted nobody carries a starter flag, and that moment is its own learning stage when switched on`, () => {
    const P = run(fx, 0, { avail: fx.availReport });
    const ix = Object.fromEntries(E.PAT_F.map((k, i) => [k, i]));
    for (const p of P.players) { assert.strictEqual(p.pat.x.min[ix.startUp], 0); assert.strictEqual(p.pat.x.min[ix.startDown], 0); }
    assert.strictEqual(P.patG, E.TUNE.repGroup > 0 ? 'rep' : 'pre');
    assert.strictEqual(run(fx, 0).patG, 'pre');
  });
  test(`${tag}: a rotation player with no recent games is still projected once he is on the posted list`, () => {
    // take the busiest non-starter-by-flag player out of the recent logs, as if he were back from a long layoff
    const P0 = run(fx, 0);
    const cand = P0.players.filter((p) => p.pid > 0 && p.mean.min >= 22 && (fx.base.priors.last[E.norm(p.name)] || fx.base.priors.cur[E.norm(p.name)]))[0];
    assert.ok(cand, 'no candidate player');
    const logs = fx.base.logs.map((l) => ({ ...l, rows: Object.fromEntries(Object.entries(l.rows).filter(([pid]) => +pid !== +cand.pid)) }));
    const P = run(fx, 0, { logs });
    const back = P.players.find((p) => E.norm(p.name) === E.norm(cand.name));
    if (E.TUNE.actNew > 0) { assert.ok(back, `${cand.name} missing although he is on tonight's list`); assert.ok(back.pid < 0 && back.mean.min > 5, `${cand.name} projected ${back && back.mean.min} minutes`); }
    else assert.ok(!back, 'layoff players are switched off but one appeared');
  });
  test(`${tag}: lessons between two stages blend smoothly (no jump at the stage border)`, () => {
    if (!(E.TUNE.patInterp > 0)) return;
    const a = run(fx, 8.9), b = run(fx, 9.1); // the old border between the 6- and 12-minute lessons
    const big = a.players.filter((p) => p.mean.min >= 20);
    for (const p of big) { const q = b.players.find((x) => x.pid === p.pid); if (q) assert.ok(Math.abs(q.mean.pts - p.mean.pts) < 2.5, `${p.name} jumps ${p.mean.pts.toFixed(1)} → ${q.mean.pts.toFixed(1)} across the border`); }
  });
}
test('learning sums add up and solve (ridge), and the shipped lessons have one number per input', () => {
  const fx = FX[0];
  const acc = E.patEmpty();
  for (const el of [0, 12, 24]) { const m = momentAt(fx.g, fx.plays, el); const P = E.projectGame({ ...fx.base, game: m.game, plays: m.plays, nsims: 200, seed: 3, patterns: null, sitPrior: fx.sitPrior }); E.patGrade(P, fx.rows, acc); E.patScore(P, fx.rows, acc); }
  assert.ok(acc.pre.min.n > 10 && acc.s12.pts.n > 10 && acc.acc.pre.n > 10);
  const packed = E.patUnpack(E.patPack(acc));
  assert.strictEqual(packed.pre.min.n, acc.pre.min.n);
  const beta = E.patBeta(null);
  for (const g of E.PAT_GROUPS) for (const s of E.PAT_LEARN) if (beta[g] && beta[g][s]) assert.strictEqual(beta[g][s].length, E.PAT_F.length, `${g}/${s}`);
});
test('no user-facing wording uses the words "over" or "under"', () => {
  // every note the engine can attach to a player, across the fixture moments
  const texts = [];
  for (const fx of FX) for (const el of [0, 12, 24, 36, 42]) { const P = run(fx, el); for (const p of P.players) { for (const w of p.why || []) texts.push(w.text, w.so, w.chip); for (const c of p.chips || []) texts.push(c.t); if (p.fade) texts.push(p.fade.text, p.fade.so); } for (const a of P.alerts || []) texts.push(a.text, a.so); }
  const bad = texts.filter((t) => t && /\b(over|under)\b/i.test(String(t)));
  assert.strictEqual(bad.length, 0, `found: ${[...new Set(bad)].slice(0, 3).join(' | ')}`);
});
console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
