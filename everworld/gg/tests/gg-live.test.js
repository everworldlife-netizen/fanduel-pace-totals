// The number shown for GG League games while they are played (gg-live.js): the late-game correction and the report card.
// Run: node gg/tests/gg-live.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const G = require(path.join(__dirname, '..', 'static', 'gg-live.js'));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'graded-nov9-13.json'), 'utf8'));
const BOARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'board-samples.json'), 'utf8'));
let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
// a live game as the data server sends it
const market = (o = {}) => ({ id: 'game', label: 'Game total', line: 111.5, overOdds: -115, underOdds: -115, open: true, mean: 121.6, fair: 116.2, sd: 6.4, gap: 4.7, rawGap: 10.1, weight: 0.47, pOver: 0.79, evOver: 0.47, evUnder: -0.6, side: 'Over', ev: 0.47, call: 'Over', reason: null, score: 13.5, ...o });
const game = (f, o = {}) => ({ id: 'eb:1', eventId: '1', status: 'live', away: { player: 'A', team: 'X', score: 48 }, home: { player: 'B', team: 'Y', score: 52 }, total: 100, eval: { progress: { f, overtime: false }, markets: [market(o.market), { id: 'q4', label: 'Q4 total', quarter: 4, soFar: 6, mean: 20, fair: 20, line: null, call: 'Pass' }, { id: 'awayTotal', label: 'A team total', line: null, mean: 58, fair: 58, call: null, gap: null, score: 0 }, { id: 'homeTotal', label: 'B team total', line: null, mean: 63.6, fair: 63.6, call: null, gap: null, score: 0 }], best: null }, ...o.game });
console.log('GG Winner: the number shown during GG League games');

test('share of the points still expected that is kept: all of them through 70% of a game, half at the horn', () => {
  for (const f of [0, 0.25, 0.5, 0.699, 0.7]) assert.strictEqual(G.keepLate(f), 1);
  assert.ok(near(G.keepLate(0.8), 1 - 0.5 / 3) && near(G.keepLate(0.85), 0.75) && near(G.keepLate(0.9), 1 - 1 / 3) && near(G.keepLate(1), 0.5));
  assert.strictEqual(G.keepLate(1.2), 0.5); // a share past the horn is the horn
  for (const bad of [null, undefined, '', NaN, 'x']) assert.strictEqual(G.keepLate(bad), 1);
  let prev = 1; for (let f = 0.7; f <= 1.0001; f += 0.01) { const k = G.keepLate(f); assert.ok(k <= prev + 1e-12 && k >= 0.5 - 1e-12); prev = k; }
  // the corrected raw number never drops below the score and never rises
  assert.ok(near(G.lateRaw(121.6, 100, 0.85), 100 + 0.75 * 21.6) && G.lateRaw(121.6, 100, 0.5) === 121.6 && G.lateRaw(99, 100, 0.9) === 99 && G.lateRaw(110, null, 0.9) === 110);
});
test('the usual miss shown next to our number: the measured points, a straight line between them, never rising as a game goes on', () => {
  assert.strictEqual(G.usualMiss(0.5, false), 9.3); assert.strictEqual(G.usualMiss(0, true), 9.3); assert.strictEqual(G.usualMiss(null, true), 9.3);
  assert.ok(near(G.usualMiss(0.35, true), 6.8) && near(G.usualMiss(0.61, true), 5.5) && near(G.usualMiss(0.87, true), 3.6) && near(G.usualMiss(1, true), 3.0) && near(G.usualMiss(3, true), 3.0));
  assert.ok(near(G.usualMiss(0.175, true), (9.3 + 6.8) / 2) && near(G.usualMiss(0.74, true), (5.5 + 3.6) / 2));
  let prev = 99; for (let f = 0; f <= 1.0001; f += 0.01) { const u = G.usualMiss(f, true); assert.ok(u <= prev + 1e-12 && u >= 3.0 - 1e-12); prev = u; }
  // the same numbers as the report card gives on the graded games behind them (to the tenth)
  const R = Object.fromEntries(G.reportCard(FX.graded, FX.phaseWeights).rows.map((r) => [r.key, r]));
  assert.ok(Math.abs(R.all.ours - 9.3) < 0.06 && Math.abs(R['25'].ours - 6.8) < 0.06 && Math.abs(R['50'].ours - 5.5) < 0.06 && Math.abs(R['75'].ours - 3.6) < 0.06);
});
test('one market late in a game: raw number, number shown, gap, spread and chance all move together', () => {
  const m = market(), keep = G.keepLate(0.85);
  G.fixMarket(m, 100, keep, { edge: 2, ev: 0.03 });
  const raw = 100 + 0.75 * 21.6, shown = 0.47 * raw + 0.53 * 111.5;
  assert.strictEqual(m.mean, Math.round(raw * 10) / 10); assert.strictEqual(m.fair, Math.round(shown * 10) / 10);
  assert.strictEqual(m.gap, Math.round((shown - 111.5) * 10) / 10); assert.strictEqual(m.rawGap, Math.round((raw - 111.5) * 10) / 10);
  assert.strictEqual(m.sd, Math.round(6.4 * Math.sqrt(0.75) * 10) / 10);
  assert.ok(m.serverMean === 121.6 && m.serverFair === 116.2 && m.lateKeep === 0.75);
  assert.ok(m.pOver > 0.5 && m.pOver < 0.79, `chance ${m.pOver}`); // still ahead of the line, by less
  assert.ok(near(m.evOver, Math.round((m.pOver * (100 / 115) - (1 - m.pOver)) * 1000) / 1000, 0.002));
  assert.ok(m.call === 'Over' && m.score > 0 && m.score < 13.5);
  assert.ok(m.side === 'Over' && m.ev === m.evOver && near(m.evUnder, Math.round(((1 - m.pOver) * (100 / 115) - m.pOver) * 1000) / 1000, 0.002) && near(m.score, Math.round(m.gap * (1 + m.ev * 4) * 10) / 10, 0.11), 'side, return and strength do not follow the new gap');
  // a second pass changes nothing (an answer can be handled twice)
  const snap = JSON.stringify(m); G.fixMarket(m, 100, keep, { edge: 2, ev: 0.03 }); assert.strictEqual(JSON.stringify(m), snap);
});
test('a plus edge stays only while the corrected number clears the same bars, and none is ever added', () => {
  // ahead by 4.7 on the server's number, by less than 2 after the correction: no call, with the reason
  const a = market({ mean: 118, fair: 114.6, gap: 3.1 }); G.fixMarket(a, 104, G.keepLate(0.85), { edge: 2, ev: 0.03 });
  assert.ok(a.gap > 0 && a.gap < 2 && a.call === 'Pass' && a.reason === 'Edge under 2 pts' && a.score === 0, JSON.stringify(a));
  // corrected below the line: said as such
  const b = market({ mean: 114, fair: 112.7, gap: 1.2, weight: 0.47, call: 'Over' }); G.fixMarket(b, 105, G.keepLate(0.95), { edge: 0.5, ev: 0.0 });
  assert.ok(b.gap <= 0 && b.call === 'Pass' && b.reason === 'Below the line: plus edges only', JSON.stringify(b));
  assert.ok(b.side === 'Under' && b.ev === b.evUnder && b.score === 0, 'a number below the line still carries the plus side');
  // a price too poor for the smaller edge
  const c = market({ overOdds: -400 }); G.fixMarket(c, 100, G.keepLate(0.85), { edge: 2, ev: 0.03 });
  assert.ok(c.call === 'Pass' && c.reason === 'Price eats the edge');
  // the server passed: stays a pass whatever the numbers; a server call below the line (never shown) is not turned into anything
  const d = market({ call: 'Pass', reason: 'Market suspended' }); G.fixMarket(d, 100, G.keepLate(0.85), { edge: 0, ev: -1 });
  assert.ok(d.call === 'Pass' && d.reason === 'Market suspended' && d.score === 0);
  const e = market({ call: 'Under', mean: 105, fair: 108, gap: -3.5 }); G.fixMarket(e, 100, G.keepLate(0.85), { edge: 2, ev: 0.03 });
  assert.strictEqual(e.call, 'Under');
  // nothing to correct: no line and no raw number, a raw number at or below the score, no score
  for (const m of [market({ mean: null }), market({ mean: 100 }), market({ mean: 99 })]) { const s = JSON.stringify(m); G.fixMarket(m, 100, 0.75, {}); assert.strictEqual(JSON.stringify(m), s); }
  const noScore = market(); const s0 = JSON.stringify(noScore); G.fixMarket(noScore, null, 0.75, {}); assert.strictEqual(JSON.stringify(noScore), s0);
  // no line: the raw number is the number shown
  const t = { id: 'awayTotal', line: null, mean: 58, fair: 58, call: null }; G.fixMarket(t, 48, 0.75, {}); assert.ok(t.mean === 55.5 && t.fair === 55.5 && t.call === null);
  // the share of our number is read back from the server's two numbers when it is not sent
  const u = market({ weight: undefined }); G.fixMarket(u, 100, 0.75, { edge: 2, ev: 0.03 }); const w = (116.2 - 111.5) / (121.6 - 111.5);
  assert.ok(near(u.fair, Math.round((w * 116.2 + (1 - w) * 111.5) * 10) / 10, 0.11), `fair ${u.fair}`);
  // ... and when the two numbers are too close to read it back, the game's own share is used (not all of our number)
  const u2 = market({ weight: undefined, mean: 111.6, fair: 111.5, gap: 0, call: 'Pass' }); G.fixMarket(u2, 104, 0.75, { edge: 2, ev: 0.03, weight: 0.47 });
  assert.strictEqual(u2.fair, Math.round((0.47 * (104 + 0.75 * 7.6) + 0.53 * 111.5) * 10) / 10);
  // rounded to a tenth, and never above the server's own numbers (just past 70% the correction is smaller than the rounding)
  for (const f of [0.7001, 0.701, 0.705, 0.72]) for (const mean of [110.04, 110.05, 113.35, 121.64]) { const c2 = market({ mean, fair: Math.round((0.47 * mean + 0.53 * 111.5) * 10) / 10, call: 'Pass' }); G.fixMarket(c2, 100, G.keepLate(f), {}); assert.ok(c2.mean <= mean + 1e-9 && c2.fair <= c2.serverFair + 1e-9 && c2.mean >= 100, `f ${f}, mean ${mean}: ${c2.mean} / ${c2.fair} against ${c2.serverFair}`); }
});
test('a live game: nothing before 70%, every market after it, overtime and games not being played left alone', () => {
  for (const f of [0, 0.3, 0.69, 0.7]) { const g = game(f), s = JSON.stringify(g); G.fixEval(g, g.eval, { edgeMin: 2, evMin: 0.03 }); assert.strictEqual(JSON.stringify(g), s, `changed at ${f}`); }
  const g = game(0.85); G.fixEval(g, g.eval, { edgeMin: 2, evMin: 0.03 });
  const [gm, q4, at, ht] = g.eval.markets;
  assert.ok(gm.lateKeep === 0.75 && gm.mean === 116.2 && q4.mean === 16.5 && at.mean === 55.5 && ht.mean === 60.7, JSON.stringify(g.eval.markets.map((m) => m.mean)));
  assert.ok(near(at.mean + ht.mean, gm.mean, 0.11), 'the two sides no longer add up to the game');
  assert.ok(g.eval.lateKeep === 0.75 && g.eval.best === gm, 'the best plus edge is not the corrected market');
  const ot = game(0.99, { game: {} }); ot.eval.progress.overtime = true; const s1 = JSON.stringify(ot); G.fixEval(ot, ot.eval, {}); assert.strictEqual(JSON.stringify(ot), s1);
  const pre = game(0.9, { game: { status: 'pre' } }); const s2 = JSON.stringify(pre); G.fixEval(pre, pre.eval, {}); assert.strictEqual(JSON.stringify(pre), s2);
  // a call that no longer clears the bar is no longer the game's best plus edge
  const weak = game(0.85, { market: { mean: 118, fair: 114.6, gap: 3.1 } }); weak.total = 104; weak.away.score = 50; weak.home.score = 54; G.fixEval(weak, weak.eval, { edgeMin: 2, evMin: 0.03 });
  assert.ok(weak.eval.markets[0].call === 'Pass' && weak.eval.best === null);
  // each side's points and the quarter being played have their own, lower bars (three quarters of the game's; at least 1.5 for a quarter)
  const bars = game(0.85);
  Object.assign(bars.eval.markets[2], { line: 53.5, overOdds: -110, underOdds: -110, sd: 4, weight: 0.47, fair: 55.6, gap: 2.1, call: 'Over', score: 3 }); // away: raw 58 → 55.5, shown 54.4, gap 0.9
  Object.assign(bars.eval.markets[1], { line: 14.5, overOdds: -110, underOdds: -110, sd: 3, weight: 0.47, fair: 17.1, gap: 2.6, call: 'Over', score: 3 }); // quarter: raw 20 → 16.5, shown 15.4, gap 0.9
  G.fixEval(bars, bars.eval, { edgeMin: 1, evMin: 0.0 });
  assert.ok(bars.eval.markets[2].gap === 0.9 && bars.eval.markets[2].call === 'Over', `side total with a bar of 0.75: ${JSON.stringify(bars.eval.markets[2])}`); // 0.9 clears 0.75 x 1
  assert.ok(bars.eval.markets[1].gap === 0.9 && bars.eval.markets[1].call === 'Pass' && /Edge under 1.5 pts/.test(bars.eval.markets[1].reason), `quarter with a bar of 1.5: ${JSON.stringify(bars.eval.markets[1])}`);
  const bars2 = game(0.85); Object.assign(bars2.eval.markets[2], { line: 53.5, overOdds: -110, underOdds: -110, sd: 4, weight: 0.47, fair: 55.6, gap: 2.1, call: 'Over', score: 3 });
  G.fixEval(bars2, bars2.eval, { edgeMin: 2, evMin: 0.0 }); assert.ok(bars2.eval.markets[2].call === 'Pass' && /Edge under 1.5 pts/.test(bars2.eval.markets[2].reason)); // 0.9 does not clear 0.75 x 2
  // the score is the two sides added up, whatever a stale "total" field says
  const stale = game(0.85); stale.total = 80; G.fixEval(stale, stale.eval, {}); assert.strictEqual(stale.eval.markets[0].mean, 116.2);
  const noSides = game(0.85); noSides.away = { player: 'A' }; noSides.home = { player: 'B' }; noSides.total = 100; G.fixEval(noSides, noSides.eval, {}); assert.ok(noSides.eval.markets[0].mean === 116.2 && noSides.eval.markets[2].mean === 58);
  // the phone's own bars are used (a stricter minimum gap removes the call)
  const strict = game(0.85); G.fixEval(strict, strict.eval, { edgeMin: 4, evMin: 0.03 }); assert.ok(strict.eval.markets[0].call === 'Pass' && /Edge under 4 pts/.test(strict.eval.markets[0].reason));
});
test('a whole answer: the board (games and picks rebuilt from the games) and one game\'s page', () => {
  const early = game(0.4), late = game(0.85), gone = game(0.85, { market: { mean: 118, fair: 114.6, gap: 3.1 } });
  early.eventId = '2'; late.eventId = '3'; gone.eventId = '4'; gone.away.score = 50; gone.home.score = 54;
  const pick = (g) => ({ id: g.id, eventId: g.eventId, name: 'x', away: g.away, home: g.home, status: 'live', market: JSON.parse(JSON.stringify(g.eval.markets[0])) });
  const board = { live: [early, late, gone], upcoming: [], picks: [pick(gone), pick(late), pick(early)] };
  G.fix(board, { edgeMin: 2, evMin: 0.03 });
  assert.deepStrictEqual(board.picks.map((p) => p.eventId), ['2', '3'], 'the picks are not the plus edges on the cards, strongest first');
  for (const p of board.picks) { const g = board.live.find((x) => x.eventId === p.eventId); assert.ok(p.market === g.eval.markets[0] && p.away === g.away && p.status === 'live', 'a pick is not the game\'s own market'); }
  assert.ok(board.picks[1].market.lateKeep === 0.75 && board.picks[0].market.fair === 116.2);
  // the server only sends its three strongest: when late ones go, a fourth plus edge on the board moves up
  const four = [game(0.85, { market: { mean: 118, fair: 114.6, gap: 3.1, score: 20 } }), game(0.86, { market: { mean: 118, fair: 114.6, gap: 3.1, score: 19 } }), game(0.87, { market: { mean: 118, fair: 114.6, gap: 3.1, score: 18 } }), game(0.3, { market: { score: 5 } })];
  four.forEach((g, i) => { g.eventId = String(10 + i); if (i < 3) { g.away.score = 50; g.home.score = 54; } });
  const b4 = { live: four, picks: four.slice(0, 3).map(pick) };
  G.fix(b4, { edgeMin: 2, evMin: 0.03 });
  assert.deepStrictEqual(b4.picks.map((p) => p.eventId), ['13'], 'a plus edge on a card is missing from the picks');
  // at most three; a game whose only call is on the other side of the line is not a pick; answers with no game list keep their picks
  const many = [0.2, 0.3, 0.4, 0.5, 0.6].map((f, i) => { const g = game(f, { market: { score: 10 + i } }); g.eventId = String(20 + i); return g; });
  many[4].eval.markets[0].call = 'Under';
  const bm = { live: many, picks: [] }; G.fix(bm, {}); assert.deepStrictEqual(bm.picks.map((p) => p.eventId), ['23', '22', '21']);
  const only = { picks: [{ eventId: '9', market: { id: 'game', call: 'Over' } }] }; G.fix(only, {}); assert.strictEqual(only.picks.length, 1);
  // one game's page has the game and its numbers side by side
  const g = game(0.9), page = { game: { ...g, eval: undefined }, eval: g.eval, trace: {} };
  G.fix(page, { edgeMin: 2, evMin: 0.03 }); assert.strictEqual(page.eval.markets[0].lateKeep, Math.round(G.keepLate(0.9) * 1000) / 1000); assert.strictEqual(page.eval.markets[0].mean, Math.round((100 + G.keepLate(0.9) * 21.6) * 10) / 10);
  // answers of other kinds pass through
  for (const x of [null, 5, 'x', [], { players: [] }, { live: 'no' }, { picks: [{ eventId: '9', market: { id: 'game', call: 'Over' } }] }]) { const s = JSON.stringify(x); assert.strictEqual(JSON.stringify(G.fix(x, {})), s); }
});
test('real board answers: nothing odd is written, the correction only takes points away, and the picks match the cards', () => {
  let liveGames = 0, corrected = 0;
  for (const raw of BOARDS.boards) {
    const before = JSON.parse(JSON.stringify(raw)), b = JSON.parse(JSON.stringify(raw));
    G.fix(b, { edgeMin: 2, evMin: 0.03 });
    b.live.forEach((g, i) => {
      const g0 = before.live[i], f = g.eval.progress.f, score = (g.away.score || 0) + (g.home.score || 0);
      if (g.status === 'live') liveGames++;
      g.eval.markets.forEach((m, j) => {
        const m0 = g0.eval.markets[j];
        for (const k of ['mean', 'fair', 'gap', 'rawGap', 'sd', 'pOver', 'evOver', 'evUnder', 'ev', 'score']) if (m[k] != null) assert.ok(Number.isFinite(m[k]), `${k} = ${m[k]}`);
        if (m.lateKeep == null) { assert.deepStrictEqual(m, m0); return; }
        corrected++;
        assert.ok(g.status === 'live' && f > 0.7 && !g.eval.progress.overtime && m.mean <= m0.mean && (m0.fair == null || m.fair <= m0.fair) && (m.sd == null || m.sd <= m0.sd));
        if (m.id === 'game') assert.ok(m.mean >= score - 1e-9, `${m.mean} below the score ${score}`);
        assert.ok(!(m.call === 'Over' && m0.call !== 'Over'), 'a call was added');
        if (m.line != null) assert.ok((m.side === 'Over') === (m.gap > 0) && m.ev === (m.side === 'Over' ? m.evOver : m.evUnder));
      });
      // the score worked back out of the server's number is the score on the board, to within a point and a half
      const gm = g0.eval.markets.find((m) => m.id === 'game');
      if (g.status === 'live' && f >= 0.1 && !g.eval.progress.overtime && gm && gm.mean != null) assert.ok(Math.abs(G.scoreFromRaw(gm.mean, g0.eval.pregame.expected, f) - score) <= 1.5, `worked-back score ${G.scoreFromRaw(gm.mean, g0.eval.pregame.expected, f).toFixed(1)} against ${score} at ${f}`);
    });
    const want = b.live.map((g) => ({ g, m: g.eval.markets.filter((m) => m.call === 'Over').sort((x, y) => y.score - x.score)[0] })).filter((x) => x.m).sort((x, y) => y.m.score - x.m.score).slice(0, 3).map((x) => x.g.eventId);
    assert.deepStrictEqual(b.picks.map((p) => p.eventId), want);
    assert.deepStrictEqual(G.learnWeights(before, null).filter((x) => x != null).every((x) => x >= 0 && x <= 1), true);
  }
  assert.ok(liveGames >= 12 && corrected >= 6, `${liveGames} live games, ${corrected} corrected markets in the samples`);
  // the saved game page (79% played): the page and the board card of the same game get the same numbers
  const page = JSON.parse(JSON.stringify(BOARDS.game)); G.fix(page, { edgeMin: 2, evMin: 0.03 });
  const gm = page.eval.markets.find((m) => m.id === 'game');
  assert.ok(gm.lateKeep != null && gm.mean < gm.serverMean && gm.fair <= gm.serverFair && gm.fair === Math.min(Math.round((gm.weight * gm.mean + (1 - gm.weight) * gm.line) * 10) / 10, gm.serverFair), JSON.stringify(gm));
});
test('the score comes back out of a number built with the server\'s own formula (real boards are checked in the test above)', () => {
  for (const [S, E, f] of [[30, 110, 0.3], [61, 104.5, 0.55], [95, 91.5, 0.948], [120, 131, 0.999], [0, 108, 0.02]]) {
    const k0 = G.pointsShare(0, f), kr = G.pointsShare(f, 1), raw = S + ((G.SERVER.n0 * E + S) / (G.SERVER.n0 + k0)) * kr;
    assert.ok(near(G.scoreFromRaw(raw, E, f), S, 1e-9), `score ${S}: got ${G.scoreFromRaw(raw, E, f)}`);
  }
  assert.ok(near(G.pointsShare(0, 1), 1) && near(G.pointsShare(0, 0.5) + G.pointsShare(0.5, 1), 1) && G.pointsShare(0.25, 0.25) === 0);
  assert.deepStrictEqual([0.1, 0.3, 0.74, 0.75, 0.89, 0.9, 1].map((f) => G.phaseWeight(f, [0.68, 0.45, 0.15, 0.47, 0.9])), [0.45, 0.15, 0.15, 0.47, 0.47, 0.9, 0.9]);
  // a weight that is not known falls back to the server's value of Nov 13, one stretch at a time
  assert.strictEqual(G.phaseWeight(0.5, null), 0.15); assert.strictEqual(G.phaseWeight(0.5, [1, 2]), 0.15); assert.strictEqual(G.phaseWeight(0.5, [null, null, 0.3, null, null]), 0.3); assert.strictEqual(G.phaseWeight(0.8, [null, null, 0.3, 7, null]), 0.47);
  assert.deepStrictEqual([G.phaseIndex(0.5, false), G.phaseIndex(0, true), G.phaseIndex(0.25, true), G.phaseIndex(0.75, true), G.phaseIndex(0.9, true)], [0, 1, 2, 3, 4]);
  // reading the weights off a board: live games by stretch, upcoming games before the tip, overtime and odd values skipped, known ones kept
  const ev = (f, w, o = {}) => ({ status: 'live', eval: { progress: { f, ...o }, modelWeight: w } });
  assert.deepStrictEqual(G.learnWeights({ live: [ev(0.1, 0.45), ev(0.6, 0.2), ev(0.95, 0.9), ev(0.99, 0.5, { overtime: true }), ev(0.8, 'x'), ev(0.8, 1.7)], upcoming: [{ status: 'pre', eval: { progress: { f: 0 }, modelWeight: 0.7 } }] }, [0.68, null, 0.15, 0.47]), [0.7, 0.45, 0.2, 0.47, 0.9]);
  assert.deepStrictEqual(G.learnWeights(null, null), [null, null, null, null, null]);
});
test(`report card on ${FX.graded.length} graded games: the number shown is graded, next to FanDuel's line at the same moment`, () => {
  const R = G.reportCard(FX.graded, FX.phaseWeights), row = Object.fromEntries(R.rows.map((r) => [r.key, r]));
  assert.strictEqual(R.games, FX.graded.length);
  assert.deepStrictEqual(R.rows.map((r) => r.key), ['all', 'pre', '25', '50', '75']);
  // before the tip the number shown is the pregame number; with FanDuel's line only where one was up early
  // (before the tip the board shows the pregame number, or its mix with FanDuel's line in the 50 games where FanDuel had one up)
  assert.ok(row.all.n === 268 && row.all.fanduel === null && near(row.all.ours, 9.34, 0.01) && row.pre.n === 50 && near(row.pre.ours, 9.27, 0.01) && near(row.pre.fanduel, 9.70, 0.01), JSON.stringify([row.all, row.pre]));
  const pre1 = G.reportCard([{ final: { total: 110 }, pregame: { expected: 104 }, checkpoints: { 0: { game: { line: 108.5, mean: 104 } } } }], [0.5, 0, 0, 0, 0]).rows;
  assert.ok(pre1[0].ours === 110 - (0.5 * 104 + 0.5 * 108.5) && pre1[1].ours === pre1[0].ours && pre1[1].fanduel === 1.5 && G.preWeight(null) === 0.68 && G.preWeight([0.3]) === 0.3 && G.preWeight([7]) === 0.68);
  // during the game: the mix, with the late correction where it applies
  assert.ok(near(row['25'].ours, 6.80, 0.02) && near(row['25'].fanduel, 6.75, 0.02) && near(row['25'].raw, 7.66, 0.02) && near(row['25'].f, 0.35, 0.01));
  assert.ok(near(row['50'].ours, 5.51, 0.02) && near(row['50'].fanduel, 5.63, 0.02) && near(row['50'].raw, 5.54, 0.02));
  assert.ok(near(row['75'].ours, 3.61, 0.02) && near(row['75'].fanduel, 4.60, 0.02) && near(row['75'].raw, 4.89, 0.02) && near(row['75'].f, 0.87, 0.01), JSON.stringify(row['75']));
  // odd input: no games, games with no final, checkpoints with holes
  assert.deepStrictEqual(G.reportCard(null, null), { games: 0, rows: [] });
  const odd = G.reportCard([{ final: null }, { final: { total: 100 }, pregame: {}, checkpoints: { 25: { f: 0.3, game: { line: 100 } }, 50: null, x: { f: 0.5, game: { line: 1, mean: 2 } } } }, { final: { total: 110 }, pregame: { expected: 105 }, checkpoints: { 0: { game: { line: 108.5, mean: 105 } } } }], null);
  assert.ok(odd.games === 2 && odd.rows.length === 2 && odd.rows[0].key === 'all' && odd.rows[1].key === 'pre' && near(odd.rows[1].ours, 110 - (0.68 * 105 + 0.32 * 108.5)) && odd.rows[1].fanduel === 1.5);
});
test('the correction on real games: late readings land closer, on every day, and early readings do not move', () => {
  const rows = [];
  for (const g of FX.graded) for (const [cp, c] of Object.entries(g.checkpoints)) {
    if (cp === '0' || c.game.mean == null || c.game.line == null) continue;
    const f = c.f, raw = c.game.mean, w = G.phaseWeight(f, FX.phaseWeights), soFar = Math.min(Math.max(G.scoreFromRaw(raw, g.pregame.expected, f), 0), raw);
    rows.push({ day: new Date(g.scheduledMs).toISOString().slice(0, 10), f, fin: g.final.total, before: w * raw + (1 - w) * c.game.line, after: G.shownLive({ f, raw, line: c.game.line, soFar, weight: w }), fd: c.game.line });
  }
  assert.strictEqual(rows.length, 296);
  const miss = (R, k) => mean(R.map((r) => Math.abs(r[k] - r.fin)));
  for (const r of rows.filter((x) => x.f <= 0.7)) assert.strictEqual(r.after, r.before);
  const late = rows.filter((r) => r.f > 0.7), last = rows.filter((r) => r.f >= 0.9);
  assert.strictEqual(late.length, 125);
  assert.ok(near(miss(late, 'before'), 4.07, 0.02) && near(miss(late, 'after'), 3.73, 0.02), `last 30%: ${miss(late, 'before').toFixed(3)} → ${miss(late, 'after').toFixed(3)}`);
  assert.ok(near(miss(last, 'before'), 3.87, 0.02) && near(miss(last, 'after'), 3.10, 0.02), `last tenth: ${miss(last, 'before').toFixed(3)} → ${miss(last, 'after').toFixed(3)}`);
  assert.ok(miss(late, 'after') < miss(late, 'fd') - 0.5, 'not clearly closer than FanDuel late');
  for (const d of [...new Set(late.map((r) => r.day))]) { const D = late.filter((r) => r.day === d); assert.ok(miss(D, 'after') < miss(D, 'before'), `${d}: ${miss(D, 'before').toFixed(2)} → ${miss(D, 'after').toFixed(2)}`); }
  assert.ok(near(miss(rows, 'before'), 5.33, 0.02) && near(miss(rows, 'after'), 5.19, 0.02) && near(miss(rows, 'fd'), 5.58, 0.02));
  // the number shown ran high late; it no longer does by more than a point either way
  const bias = (R, k) => mean(R.map((r) => r[k] - r.fin)), b7590 = rows.filter((r) => r.f >= 0.75 && r.f < 0.9);
  assert.ok(bias(b7590, 'before') > 1.5 && Math.abs(bias(b7590, 'after')) < 0.6, `75 to 90%: bias ${bias(b7590, 'before').toFixed(2)} → ${bias(b7590, 'after').toFixed(2)}`);
});
console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
