/* Courtside engine tests: run on two real games (fixtures/games.json.gz, built by tools/mkfixture.js).
 *   node cs/tests/engine.test.js
 */
'use strict';
const path = require('path');
const zlib = require('zlib');
const fs = require('fs');
const assert = require('assert');
const E = require(process.env.CS_BUILD ? path.resolve(process.env.CS_BUILD, 'engine.js') : path.join(__dirname, '..', 'build', 'engine.js')); // CS_BUILD=<folder> tests another build
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
        const mine = P.players.filter((p) => p.team === tm);
        const rem = mine.reduce((a, p) => a + (p.mean.min - p.now.min), 0);
        // regulation minutes left, plus room for the overtime share of the simulations. Before tip-off (v15) each player's
        // minutes are an "if he plays" number, so a full active list may add up to more than a team can play: the TEAM
        // total is what gets scaled to five players' worth there (checked in the team totals test below). From v16 a
        // player still waiting to check in keeps that kind of number during the game too, so the strict cap is for the
        // players who have checked in and the looser one for everyone listed
        const strict = 5 * P.state.left + 5 * 5 * 0.6 + 0.5;
        const ifPlays = E.TUNE.condMin > 0 && (el === 0 || E.TUNE.condLive > 0);
        assert.ok(rem <= (ifPlays ? 5 * P.state.left * 1.4 : strict), `${tm} has ${rem.toFixed(1)} minutes to come with ${P.state.left} left`);
        if (el > 0) { const inRem = mine.filter((p) => !p.dnpYet).reduce((a, p) => a + (p.mean.min - p.now.min), 0); assert.ok(inRem <= strict, `${tm}: players who have checked in have ${inRem.toFixed(1)} minutes to come with ${P.state.left} left`); }
        // (in a lopsided game some of the time left goes to deep-bench players the engine does not track by name)
        assert.ok(rem >= 5 * P.state.left * 0.55 - 0.5, `${tm} has only ${rem.toFixed(1)} minutes to come with ${P.state.left} left`);
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
  test(`${tag}: tonight's team load and the expected margin reach the learned layer, by role`, () => {
    const P = run(fx, 0);
    const ix = Object.fromEntries(E.PAT_F.map((k, i) => [k, i]));
    for (const k of ['loadS', 'loadB', 'loadBd', 'loadBq', 'favS', 'dogS', 'dogB']) assert.ok(ix[k] > 0, `missing input ${k}`);
    const m = fx.base.market, home = fx.g.home_team.abbreviation;
    for (const tm of [fx.g.visitor_team.abbreviation, home]) {
      const ps = P.players.filter((p) => p.team === tm);
      // one load per team: every starter carries it as loadS, everyone else as loadB
      const loads = new Set(ps.map((p) => (p.starter ? p.pat.x.min[ix.loadS] : p.pat.x.min[ix.loadB]).toFixed(4)));
      assert.strictEqual(loads.size, 1, `${tm}: players of one team carry different loads (${[...loads].join(', ')})`);
      for (const p of ps) {
        const x = p.pat.x.min;
        if (p.starter) { assert.strictEqual(x[ix.loadB], 0); assert.strictEqual(x[ix.loadBd], 0); assert.strictEqual(x[ix.dogB], 0); }
        else { assert.strictEqual(x[ix.loadS], 0); assert.strictEqual(x[ix.favS], 0); assert.strictEqual(x[ix.dogS], 0); }
        assert.ok(!(x[ix.favS] > 0 && x[ix.dogS] > 0), `${p.name} is flagged on both sides of the spread`);
      }
      // with a spread past 4 points the favored side's starters carry favS and the other side's carry dogS
      if (m && m.spreadHome != null && Math.abs(m.spreadHome) >= 6) {
        const favored = (tm === home) === (m.spreadHome < 0);
        const st = ps.filter((p) => p.starter);
        assert.ok(st.every((p) => (favored ? p.pat.x.min[ix.favS] > 0 : p.pat.x.min[ix.dogS] > 0)), `${tm}: starters do not carry the ${favored ? 'favored' : 'trailing'} side of a ${m.spreadHome} spread`);
      }
    }
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
  test(`${tag}: before lineups are posted nobody is handed a whole game (short-handed teams)`, () => {
    const P = run(fx, 0, { avail: fx.availReport });
    for (const p of P.players) {
      assert.ok(p.mean.min <= 44.5, `${p.name} is projected ${p.mean.min.toFixed(1)} minutes before lineups post`);
      // (a deep-bench player's number means "if he plays": measured, those who get in play about 10 to 13 minutes, so 14 is allowed for anyone)
      assert.ok(p.mean.min <= Math.max(1.3 * p.mpg, p.mpg + 8, 14), `${p.name}: ${p.mean.min.toFixed(1)} minutes against a usual ${(+p.mpg).toFixed(1)}`);
    }
  });
  test(`${tag}: at the opening tip a posted starter the play-by-play has not named yet is on the floor, not "not checked in"`, () => {
    const P0 = run(fx, 0), P = run(fx, 0.25);
    const starters = new Set(fx.base.avail.in.filter((x) => x.starter).map((x) => E.norm(x.name)));
    let n = 0;
    for (const p of P.players) {
      if (!starters.has(E.norm(p.name))) continue;
      const q = P0.players.find((x) => E.norm(x.name) === E.norm(p.name));
      if (!q) continue;
      n++;
      assert.ok(!p.dnpYet, `${p.name} starts but counts as not checked in 15 seconds into the game`);
      assert.ok(p.mean.min >= 0.75 * q.mean.min, `${p.name} dropped from ${q.mean.min.toFixed(1)} to ${p.mean.min.toFixed(1)} minutes at the opening tip`);
    }
    assert.ok(n >= 8, 'too few posted starters found');
  });
  test(`${tag}: with no posted lineup, a real starter is never labelled as not starting while the play-by-play is still finding the starters`, () => {
    const starters = new Set(fx.base.avail.in.filter((x) => x.starter).map((x) => E.norm(x.name)));
    for (const el of [3, 4, 6]) {
      const P = run(fx, el, { avail: null });
      for (const p of P.players) if (starters.has(E.norm(p.name))) assert.notStrictEqual(p.startsTonight, 0, `${p.name} started but is flagged not starting ${el} minutes in`);
    }
  });
  test(`${tag}: lessons between two stages blend smoothly (no jump at the stage border)`, () => {
    if (!(E.TUNE.patInterp > 0)) return;
    // the old border between the 6- and 12-minute lessons. The game itself moves in those 12 seconds (the pace
    // estimate drifts, the simulation re-rolls), so the lessons' share of the change is what is checked: the change
    // with lessons minus the change without them. With a hard switch at the border that share was about 2 minutes.
    // (the refill rule hands minutes to teammates above a fixed cut-off, a jump of its own: switched off here so only the blend is measured)
    const refill0 = E.TUNE.refill; E.TUNE.refill = 0;
    let a, b, a0, b0;
    try { a = run(fx, 8.9); b = run(fx, 9.1); a0 = run(fx, 8.9, { patterns: null }); b0 = run(fx, 9.1, { patterns: null }); } finally { E.TUNE.refill = refill0; }
    const big = a.players.filter((p) => p.mean.min >= 20);
    let n = 0;
    for (const p of big) {
      const q = b.players.find((x) => x.pid === p.pid), p0 = a0.players.find((x) => x.pid === p.pid), q0 = b0.players.find((x) => x.pid === p.pid);
      // only players for whom nothing happened in those 12 seconds (same box line, same on/off the floor)
      if (!q || !p0 || !q0 || q.on !== p.on || q.now.pts !== p.now.pts || q.now.fga !== p.now.fga || q.now.pf !== p.now.pf) continue;
      n++;
      const dMin = (q.mean.min - p.mean.min) - (q0.mean.min - p0.mean.min), dPts = (q.mean.pts - p.mean.pts) - (q0.mean.pts - p0.mean.pts);
      assert.ok(Math.abs(dMin) < 0.6, `${p.name}: the lessons move his minutes by ${dMin.toFixed(2)} across the border`);
      assert.ok(Math.abs(dPts) < 2.5, `${p.name}: the lessons move his points by ${dPts.toFixed(2)} across the border`);
    }
    assert.ok(n >= 4, 'too few unchanged players to compare');
  });
}
test('team totals: "if he plays" minutes never inflate the game score, and the learned team check is applied', () => {
  for (const fx of FX) {
    const v = fx.g.visitor_team.abbreviation, h = fx.g.home_team.abbreviation;
    for (const el of [0, 6, 24]) {
      const P = run(fx, el);
      for (const [tm, nowPts] of [[v, P.state.vs], [h, P.state.hs]]) {
        assert.ok(P.teamRaw && Number.isFinite(P.teamRaw[tm]), 'no raw team number');
        assert.ok(Math.abs(P.projScore[tm] - (nowPts + P.teamRaw[tm] * P.teamFactor)) < 0.05, 'team score is not points so far + the checked sum of players');
        assert.ok(P.teamFactor >= 0.85 && P.teamFactor <= 1.15, `team check ${P.teamFactor} outside its cap`);
      }
      if (el === 0) {
        // the books' line splits into two team totals: ours must be in the same range, however many players are on the active list
        const mk = fx.base.market, tv = (mk.total + mk.spreadHome) / 2, th = (mk.total - mk.spreadHome) / 2;
        assert.ok(Math.abs(P.projScore[v] - tv) < 0.16 * tv && Math.abs(P.projScore[h] - th) < 0.16 * th, `tip-off team totals ${P.projScore[v].toFixed(1)}/${P.projScore[h].toFixed(1)} far from the line's ${tv}/${th}`);
      }
    }
  }
});
test('learning sums add up and solve (ridge), and the shipped lessons have one number per input', () => {
  const fx = FX[0];
  const acc = E.patEmpty();
  for (const el of [0, 12, 24]) { const m = momentAt(fx.g, fx.plays, el); const P = E.projectGame({ ...fx.base, game: m.game, plays: m.plays, nsims: 200, seed: 3, patterns: null, sitPrior: fx.sitPrior }); E.patGrade(P, fx.rows, acc); E.patScore(P, fx.rows, acc); }
  assert.ok(acc.pre.min.n > 10 && acc.s12.pts.n > 10 && acc.acc.pre.n > 10);
  assert.ok(acc.team.pre[0] === 2 && acc.team.pre[1] > 100 && acc.team.pre[2] > 100, 'team check sums missing');
  assert.strictEqual(E.patUnpack(E.patPack(acc)).team.pre[0], 2);
  const packed = E.patUnpack(E.patPack(acc));
  assert.strictEqual(packed.pre.min.n, acc.pre.min.n);
  const beta = E.patBeta(null);
  for (const g of E.PAT_GROUPS) for (const s of E.PAT_LEARN) if (beta[g] && beta[g][s]) assert.strictEqual(beta[g][s].length, E.PAT_F.length, `${g}/${s}`);
});
const IX = Object.fromEntries(E.PAT_F.map((k, i) => [k, i]));
const NEWIN = ['aAll', 'aS', 'aB', 'aOn', 'aPace', 'aLop', 'aOwn', 'aLong', 'lopTier', 'flagOff', 'flagOn', 'deepLop', 'stintLong'];
const noLessons = () => Object.fromEntries(E.PAT_GROUPS.map((g) => [g, Object.fromEntries(E.PAT_LEARN.map((k) => [k, new Array(E.PAT_F.length).fill(0)]))]));
test('anchor and floor-picture inputs speak only to minutes, and only where they apply', () => {
  for (const k of NEWIN) assert.ok(k in IX, `input ${k} is missing`);
  for (const fx of FX) for (const el of [0, 12, 36]) {
    const P = run(fx, el);
    let anchored = 0;
    for (const p of P.players) {
      for (const s of STATS) for (const k of NEWIN) assert.strictEqual(p.pat.x[s][IX[k]], 0, `${k} leaks into ${s} for ${p.name}`);
      const x = p.pat.x.min;
      for (const k of NEWIN) assert.ok(Number.isFinite(x[IX[k]]) && Math.abs(x[IX[k]]) <= 6, `${k} = ${x[IX[k]]} for ${p.name} at ${el} min`);
      if (x[IX.aAll] > 0) anchored++;
      // the white-flag picture only exists from the middle of the third quarter on
      if (el < 30) for (const k of ['flagOff', 'flagOn', 'deepLop', 'stintLong']) assert.strictEqual(x[IX[k]], 0, `${k} is set at ${el} min`);
      // before the game there is no floor to read; during it the pregame anchors step aside
      for (const k of el === 0 ? ['aOn', 'aPace', 'aLop', 'lopTier'] : ['aOwn', 'aLong']) assert.strictEqual(x[IX[k]], 0, `${k} is set at ${el} min`);
    }
    assert.ok(anchored >= 10, `only ${anchored} players have an anchor at ${el} min`);
  }
});
test('a learned anchor pulls minutes toward the middle: long numbers come down, short ones go up', () => {
  const fx = FX[0];
  // remaining minutes become 0.7 x remaining + 0.3 x 24
  const b = noLessons(); b.pre.min[IX.base] = -0.3; b.pre.min[IX.aAll] = 0.3;
  const P0 = run(fx, 0, { patterns: noLessons() }), P1 = run(fx, 0, { patterns: b });
  let hi = 0, lo = 0;
  for (const p of P0.players) {
    const q = P1.players.find((x) => x.pid === p.pid);
    if (!q) continue;
    if (p.mean.min >= 31) { hi++; assert.ok(q.mean.min < p.mean.min - 0.5, `${p.name}: ${p.mean.min.toFixed(1)} -> ${q.mean.min.toFixed(1)} should come down`); }
    if (p.mean.min >= 8 && p.mean.min <= 16) { lo++; assert.ok(q.mean.min > p.mean.min + 0.5, `${p.name}: ${p.mean.min.toFixed(1)} -> ${q.mean.min.toFixed(1)} should go up`); }
  }
  assert.ok(hi >= 2 && lo >= 2, `too few players to compare (${hi} long, ${lo} short)`);
});
test('during a game, a player who never got in teaches nothing (the live number means "if he plays")', () => {
  const fx = FX[0];
  const m = momentAt(fx.g, fx.plays, 12);
  const P = E.projectGame({ ...fx.base, game: m.game, plays: m.plays, nsims: 200, seed: 3, patterns: null, sitPrior: fx.sitPrior });
  const grade = (v) => { const keep = E.TUNE.condLive; E.TUNE.condLive = v; try { const acc = E.patEmpty(); E.patGrade(P, fx.rows, acc); return acc.s12.min.n; } finally { E.TUNE.condLive = keep; } };
  const played = new Set(Object.entries(fx.rows).filter(([, r]) => r.min > 0).map(([id]) => +id));
  const listed = P.players.length, got = P.players.filter((p) => played.has(+p.pid)).length;
  assert.ok(grade(1) <= got, `${grade(1)} rows learned from, but only ${got} of the ${listed} listed players played`);
  if (listed > got) assert.ok(grade(0) > grade(1), 'with the switch off, players who never got in are counted again');
});
test('nothing jumps at the end of the first quarter or at the start of the next one', () => {
  for (const fx of FX) {
    // six seconds before the horn against the horn itself: the minutes-pace input comes in with its lesson, not all at once
    const a = run(fx, 11.9), b = run(fx, 12);
    let n = 0, sum = 0;
    for (const p of a.players) {
      const q = b.players.find((x) => x.pid === p.pid);
      if (!q || !(p.now.min > 0) || q.on !== p.on || q.now.pts !== p.now.pts || q.now.pf !== p.now.pf) continue;
      n++; sum += Math.abs(q.mean.min - p.mean.min);
      assert.ok(Math.abs(q.mean.min - p.mean.min) < 1.5, `${p.name}: ${p.mean.min.toFixed(1)} -> ${q.mean.min.toFixed(1)} minutes across the horn with nothing happening`);
    }
    assert.ok(n >= 8 && sum / n < 0.6, `players move ${(sum / n).toFixed(2)} minutes on average across the Q1 horn (${n} players)`);
    // the scoreboard says Q2 12:00 but no Q2 play has arrived: the five who closed Q1 are still on the floor
    const m = momentAt(fx.g, fx.plays, 12);
    const c = E.projectGame({ ...fx.base, game: { ...m.game, period: 2, time: 'Q2 12:00' }, plays: m.plays, nsims: 400, seed: fx.g.id, patterns: E.patBeta(null), sitPrior: fx.sitPrior });
    const onB = b.players.filter((p) => p.on).map((p) => p.pid).sort(), onC = c.players.filter((p) => p.on).map((p) => p.pid).sort();
    assert.ok(onB.length >= 8, 'too few players on the floor at the Q1 horn');
    assert.deepStrictEqual(onC, onB, 'the on-floor picture changes when the scoreboard moves to Q2 before any Q2 play');
    for (const p of b.players) { const q = c.players.find((x) => x.pid === p.pid); if (q) assert.ok(Math.abs(q.mean.min - p.mean.min) < 0.8, `${p.name}: ${p.mean.min.toFixed(1)} -> ${q.mean.min.toFixed(1)} minutes at the start of Q2 with nothing happening`); }
  }
});
test('tied when the fourth quarter ends: the numbers already hold the overtime that is certain', () => {
  const fx = FX[0];
  const m = momentAt(fx.g, fx.plays, 48);
  const tied = { ...m.game, period: 4, time: 'End of 4th', visitor_team_score: 110, home_team_score: 110 };
  const st = E.gameState(tied);
  assert.strictEqual(st.period, 5); assert.ok(Math.abs(st.left - 5) < 1e-9, `left ${st.left}`);
  // not tied: the game is simply about to go final
  assert.strictEqual(E.gameState({ ...tied, home_team_score: 112 }).left, 0);
  const P = E.projectGame({ ...fx.base, game: tied, plays: m.plays, nsims: 400, seed: 5, patterns: E.patBeta(null), sitPrior: fx.sitPrior });
  const on = P.players.filter((p) => p.on);
  assert.ok(on.length >= 8, `only ${on.length} players on the floor at the horn`);
  const more = on.reduce((a, p) => a + (p.mean.min - p.now.min), 0) / on.length;
  assert.ok(more > 2 && more <= 5.01, `players on the floor at the horn are shown ${more.toFixed(2)} more minutes`);
  for (const tm of [P.state.v, P.state.h]) assert.ok(P.projScore[tm] > 110 + 4, `${tm} is shown ${P.projScore[tm].toFixed(1)} with five minutes to play from 110`);
});
test('a player who has not checked in: no alert says he is getting the minutes, and no note speaks of him coming back', () => {
  for (const fx of FX) for (const el of [3, 6, 9]) {
    const P = run(fx, el);
    const waiting = new Set(P.players.filter((p) => p.dnpYet).map((p) => p.pid));
    for (const a of P.alerts || []) if (a.type === 'shift' && a.up) assert.ok(!waiting.has(a.up.pid), `${a.up.name} has not checked in but an alert says he is getting the extra minutes (${el} min)`);
    for (const p of P.players) {
      if (!p.dnpYet) continue;
      const texts = (p.why || []).map((w) => `${w.text} ${w.so || ''}`).join(' | ');
      assert.ok(!/No guesswork on whether he plays|checks back in|comes back on his normal schedule/.test(texts), `${p.name} (not checked in, ${el} min): ${texts.slice(0, 200)}`);
      assert.ok(/if he gets in tonight/.test(texts), `${p.name} (not checked in) has no "if he gets in" line`);
    }
  }
});
test("the phone's own accuracy sums count everyone who played 10+ minutes: a player with no number is a full miss", () => {
  const fx = FX[0];
  const P = run(fx, 0);
  const a = E.patEmpty(), b = E.patEmpty();
  E.patScore(P, fx.rows, a);
  // the same night with one more player in the final box whom the app never had a number for
  const extra = { name: 'Nobody Projected', team: P.state.v, min: 22, pts: 14, reb: 6, ast: 3, fg3m: 2 };
  E.patScore(P, { ...fx.rows, 987654321: extra }, b);
  assert.strictEqual(b.acc.pre.n, a.acc.pre.n + 1);
  assert.ok(Math.abs(b.acc.pre.pts - a.acc.pre.pts - 14) < 1e-9 && Math.abs(b.acc.pre.reb - a.acc.pre.reb - 6) < 1e-9 && Math.abs(b.acc.pre.ast - a.acc.pre.ast - 3) < 1e-9, 'his whole line should count as the miss');
  // a short stint does not count, and neither does a player of another game
  const c = E.patEmpty();
  E.patScore(P, { ...fx.rows, 987654321: { ...extra, min: 4 }, 987654322: { ...extra, team: 'ZZZ' } }, c);
  assert.strictEqual(c.acc.pre.n, a.acc.pre.n);
});
test('the first minutes of a game: the tip-off number is carried in, nothing jumps at the tip, 6:00 is untouched', () => {
  for (const fx of FX) {
    const pre = run(fx, 0), live = run(fx, 0.25);
    const keep = E.TUNE.tipBlend; let raw, six1, six0;
    six1 = run(fx, 6);
    E.TUNE.tipBlend = 0; try { raw = run(fx, 0.25); six0 = run(fx, 6); } finally { E.TUNE.tipBlend = keep; }
    let n = 0, moved = 0, movedRaw = 0;
    for (const p of pre.players) {
      const a = live.players.find((x) => E.norm(x.name) === E.norm(p.name)), b = raw.players.find((x) => E.norm(x.name) === E.norm(p.name));
      if (!a || !b) continue;
      n++; moved += Math.abs(a.mean.min - p.mean.min); movedRaw += Math.abs(b.mean.min - p.mean.min);
    }
    assert.ok(n >= 14, `only ${n} players matched across the tip`);
    assert.ok(moved / n < 0.45, `minutes move ${(moved / n).toFixed(2)} on average in the first 15 seconds`);
    assert.ok(moved < movedRaw, `the blend should move minutes less than no blend (${(moved / n).toFixed(2)} vs ${(movedRaw / n).toFixed(2)})`);
    assert.deepStrictEqual(six1.players.map((p) => [p.pid, p.mean.min, p.proj.pts]), six0.players.map((p) => [p.pid, p.mean.min, p.proj.pts]), 'six minutes in must not depend on the tip-off blend');
  }
});
test('early-game readings: no pace reading before 3:00, and the scoring-so-far input has no switch-on step', () => {
  const fx = FX[0];
  const a = run(fx, 1.5), b = run(fx, 3), c = run(fx, 6);
  assert.strictEqual(a.pace.live, a.pace.season, `pace reads ${a.pace.live} after 90 seconds (season norm ${a.pace.season})`);
  // the scoring-so-far input grows smoothly from the tip (no switch at 3:00): small after 90 seconds, no step across 3:00
  const b0 = run(fx, 2.95);
  for (const p of a.players) assert.ok(Math.abs(p.pat.x.pts[IX.tdLive]) < 0.45, `${p.name}: the scoring-so-far input reads ${p.pat.x.pts[IX.tdLive]} after 90 seconds`);
  for (const p of b.players) { const q = b0.players.find((x) => x.pid === p.pid); if (q) assert.ok(Math.abs(p.pat.x.pts[IX.tdLive] - q.pat.x.pts[IX.tdLive]) < 0.25, `${p.name}: the scoring-so-far input steps from ${q.pat.x.pts[IX.tdLive]} to ${p.pat.x.pts[IX.tdLive]} across 3:00`); }
  assert.ok(c.players.some((p) => p.pat.x.pts[IX.tdLive] !== 0), 'the scoring-so-far input never comes on');
});
test('a tied game with seconds left is close to a coin flip, and the two chances add up to 1', () => {
  const fx = FX[0];
  const m = momentAt(fx.g, fx.plays, 47.9);
  const P = E.projectGame({ ...fx.base, game: { ...m.game, visitor_team_score: 110, home_team_score: 110 }, plays: m.plays, nsims: 1000, seed: 9, patterns: E.patBeta(null), sitPrior: fx.sitPrior });
  const [v, h] = [P.state.v, P.state.h];
  assert.ok(Math.abs(P.winProb[v] + P.winProb[h] - 1) < 1e-9);
  assert.ok(P.winProb[v] > 0.3 && P.winProb[v] < 0.7, `${v} is shown ${(100 * P.winProb[v]).toFixed(0)}% in a tied game with six seconds left`);
});
test('late in a game the minutes a note quotes are the minutes shown on the card', () => {
  let seen = 0;
  for (const fx of FX) for (const el of [42, 45, 47.5]) {
    const P = run(fx, el);
    for (const p of P.players) for (const w of p.why || []) {
      const m = /Projected: ([\d.]+) more minutes/.exec(`${w.text || ''} ${w.so || ''}`);
      if (!m) continue;
      seen++;
      assert.ok(Math.abs(+m[1] - Math.max(p.proj.min - p.now.min, 0)) < 0.06, `${p.name} at ${el} min: note says ${m[1]} more minutes, the card shows ${(p.proj.min - p.now.min).toFixed(1)}`);
    }
  }
  assert.ok(seen >= 5, `only ${seen} notes with a minutes figure were found`);
});
test('the combined stat (points + rebounds + assists) is graded and calibrated like the others', () => {
  const fx = FX[0];
  const acc = E.patEmpty();
  for (const el of [0, 24]) { const m = momentAt(fx.g, fx.plays, el); const P = E.projectGame({ ...fx.base, game: m.game, plays: m.plays, nsims: 200, seed: 3, patterns: null, sitPrior: fx.sitPrior }); E.patGrade(P, fx.rows, acc); }
  const count = (g) => acc.cal[g].pra.reduce((a, lvl) => a + lvl.reduce((x, b) => x + b[0], 0), 0);
  assert.ok(count('pre') > 50 && count('s24') > 50, `combined-stat rungs graded: ${count('pre')} before the game, ${count('s24')} at halftime`);
  // with a table that says "half the time" for everything, the shown chances of rungs still ahead follow the table
  const pats = E.patBeta(null);
  const flat = [[0, 1], [0.5, 0.5]];
  const P = run(fx, 24, { patterns: { ...pats, cal: { ...pats.cal, s24: { ...pats.cal.s24, pra: [flat, flat] } } } });
  const p = P.players.find((x) => x.now.min > 10);
  const now = p.now.pts + p.now.reb + p.now.ast;
  const ahead = p.ladders.pra.filter((r) => r.t > now && p.laddersRaw.pra.find((q) => q.t === r.t).p > 0 && p.laddersRaw.pra.find((q) => q.t === r.t).p < 1);
  assert.ok(ahead.length >= 1 && ahead.every((r) => Math.abs(r.p - 0.5) < 1e-9), `calibrated chances not applied: ${JSON.stringify(ahead.slice(0, 3))}`);
  for (const r of p.ladders.pra.filter((x) => x.t <= now)) assert.ok(r.p === 1 || r.p === p.laddersRaw.pra.find((q) => q.t === r.t).p, 'a rung already reached keeps its simulated chance');
});
test('no user-facing wording uses the words "over" or "under"', () => {
  // every note the engine can attach to a player, across the fixture moments
  const texts = [];
  for (const fx of FX) for (const el of [0, 12, 24, 36, 42]) { const P = run(fx, el); for (const p of P.players) { for (const w of p.why || []) texts.push(w.text, w.so, w.chip); for (const c of p.chips || []) texts.push(c.t); if (p.fade) texts.push(p.fade.text, p.fade.so); } for (const a of P.alerts || []) texts.push(a.text, a.so); }
  const bad = texts.filter((t) => t && /\b(over|under)\b/i.test(String(t)));
  assert.strictEqual(bad.length, 0, `found: ${[...new Set(bad)].slice(0, 3).join(' | ')}`);
});
console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
