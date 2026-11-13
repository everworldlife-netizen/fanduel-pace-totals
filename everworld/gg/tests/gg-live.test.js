// The number shown for GG League games while they are played (gg-live.js): the late-game correction and the report card.
// Run: node gg/tests/gg-live.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const G = require(path.join(__dirname, '..', 'static', 'gg-live.js'));
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'graded-nov9-13.json'), 'utf8'));
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
  assert.ok(near(G.usualMiss(0.35, true), 6.8) && near(G.usualMiss(0.61, true), 5.5) && near(G.usualMiss(0.87, true), 3.6) && near(G.usualMiss(1, true), 2.5) && near(G.usualMiss(3, true), 2.5));
  assert.ok(near(G.usualMiss(0.175, true), (9.3 + 6.8) / 2) && near(G.usualMiss(0.74, true), (5.5 + 3.6) / 2));
  let prev = 99; for (let f = 0; f <= 1.0001; f += 0.01) { const u = G.usualMiss(f, true); assert.ok(u <= prev + 1e-12 && u >= 2.5 - 1e-12); prev = u; }
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
  // the phone's own bars are used (a stricter minimum gap removes the call)
  const strict = game(0.85); G.fixEval(strict, strict.eval, { edgeMin: 4, evMin: 0.03 }); assert.ok(strict.eval.markets[0].call === 'Pass' && /Edge under 4 pts/.test(strict.eval.markets[0].reason));
});
test('a whole answer: the board (games and picks) and one game\'s page', () => {
  const early = game(0.4), late = game(0.85), gone = game(0.85, { market: { mean: 118, fair: 114.6, gap: 3.1 } });
  early.eventId = '2'; late.eventId = '3'; gone.eventId = '4'; gone.total = 104;
  const pick = (g) => ({ id: g.id, eventId: g.eventId, name: 'x', away: g.away, home: g.home, status: 'live', market: JSON.parse(JSON.stringify(g.eval.markets[0])) });
  const board = { live: [early, late, gone], upcoming: [], picks: [pick(gone), pick(late), pick(early)] };
  G.fix(board, { edgeMin: 2, evMin: 0.03 });
  assert.deepStrictEqual(board.picks.map((p) => p.eventId).sort(), ['2', '3'], 'the pick that is no longer a plus edge is still listed');
  const lp = board.picks.find((p) => p.eventId === '3'); assert.ok(lp.market === late.eval.markets[0] && lp.market.lateKeep === 0.75 && lp.market.fair === late.eval.markets[0].fair);
  assert.ok(board.picks.find((p) => p.eventId === '2').market.fair === 116.2); // the early game's pick is untouched
  for (let i = 1; i < board.picks.length; i++) assert.ok(board.picks[i - 1].market.score >= board.picks[i].market.score, 'picks not in order of strength');
  // one game's page has the game and its numbers side by side
  const g = game(0.9), page = { game: { ...g, eval: undefined }, eval: g.eval, trace: {} };
  G.fix(page, { edgeMin: 2, evMin: 0.03 }); assert.strictEqual(page.eval.markets[0].lateKeep, Math.round(G.keepLate(0.9) * 1000) / 1000); assert.strictEqual(page.eval.markets[0].mean, Math.round((100 + G.keepLate(0.9) * 21.6) * 10) / 10);
  // answers of other kinds pass through
  for (const x of [null, 5, 'x', [], { players: [] }, { live: 'no' }, { picks: [{ eventId: '9', market: { id: 'game', call: 'Over' } }] }]) { const s = JSON.stringify(x); assert.strictEqual(JSON.stringify(G.fix(x, {})), s); }
});
test('the score is worked back out of the server\'s raw number exactly (its own formula, turned around)', () => {
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
  assert.ok(row.all.n === 268 && row.all.fanduel === null && near(row.all.ours, 9.35, 0.01) && row.pre.n === 50 && near(row.pre.ours, 9.35, 0.01) && near(row.pre.fanduel, 9.70, 0.01), JSON.stringify([row.all, row.pre]));
  // during the game: the mix, with the late correction where it applies
  assert.ok(near(row['25'].ours, 6.80, 0.02) && near(row['25'].fanduel, 6.75, 0.02) && near(row['25'].raw, 7.66, 0.02) && near(row['25'].f, 0.35, 0.01));
  assert.ok(near(row['50'].ours, 5.51, 0.02) && near(row['50'].fanduel, 5.63, 0.02) && near(row['50'].raw, 5.54, 0.02));
  assert.ok(near(row['75'].ours, 3.61, 0.02) && near(row['75'].fanduel, 4.60, 0.02) && near(row['75'].raw, 4.89, 0.02) && near(row['75'].f, 0.87, 0.01), JSON.stringify(row['75']));
  // odd input: no games, games with no final, checkpoints with holes
  assert.deepStrictEqual(G.reportCard(null, null), { games: 0, rows: [] });
  const odd = G.reportCard([{ final: null }, { final: { total: 100 }, pregame: {}, checkpoints: { 25: { f: 0.3, game: { line: 100 } }, 50: null, x: { f: 0.5, game: { line: 1, mean: 2 } } } }, { final: { total: 110 }, pregame: { expected: 105 }, checkpoints: { 0: { game: { line: 108.5, mean: 105 } } } }], null);
  assert.ok(odd.games === 2 && odd.rows.length === 2 && odd.rows[0].key === 'all' && odd.rows[1].key === 'pre' && odd.rows[1].ours === 5 && odd.rows[1].fanduel === 1.5);
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
