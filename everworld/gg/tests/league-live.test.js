/* GG Winner real-league model tests.   node gg/tests/league-live.test.js */
'use strict';
const path = require('path');
const assert = require('assert');
const LL = require(path.join(__dirname, '..', 'static', 'league-live.js'));
let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };
const row = (o = {}) => ({ leagueId: 'nba', status: 'in_progress', period: 2, clock: '6:00', statusDetail: 'Q2', home: { score: 45, qScores: [28, 17] }, away: { score: 40, qScores: [25, 15] }, ...o });
const texts = (r) => [...r.why, ...r.markets.map((m) => m.text), r.where].join(' | ');

console.log('GG Winner real-league model');
test('a clock under a minute is seconds, not minutes', () => {
  assert.ok(Math.abs(LL.parseClock('45.2') - 45.2 / 60) < 1e-9);
  assert.strictEqual(LL.parseClock('5:32'), 5 + 32 / 60);
  assert.strictEqual(LL.parseClock('0.0'), 0);
  const p = LL.progress(row({ clock: '45.2' }), { prior: 228 });
  assert.ok(Math.abs(p.elapsed - (24 - 45.2 / 60)) < 0.01, `elapsed ${p.elapsed}`);
});
test('a quarter break ("End of 1st") is read as exactly one quarter played', () => {
  const p = LL.progress(row({ period: 1, clock: '0.0', statusDetail: 'End of 1st', home: { score: 30, qScores: [30] }, away: { score: 16, qScores: [16] } }), { prior: 228 });
  assert.strictEqual(p.clockSource, 'clock');
  assert.ok(Math.abs(p.elapsed - 12) < 0.01, `elapsed ${p.elapsed}`);
});
test('at the opening tip the live number equals the line (no step down)', () => {
  const r = LL.project(row({ period: 1, clock: '12:00', statusDetail: 'Q1', home: { score: 0, qScores: [0] }, away: { score: 0, qScores: [0] } }), { prior: 228 });
  assert.ok(Math.abs(r.full - 228) <= 0.6, `full ${r.full}`);
  const pre = LL.project({ leagueId: 'nba', status: 'scheduled', home: { score: 0 }, away: { score: 0 } }, { prior: 228 });
  assert.strictEqual(pre.full, 228);
  assert.ok(Math.abs(pre.periods.reduce((s, x) => s + x.value, 0) - 228) <= 0.5, 'quarters do not add up to the total');
  assert.ok(pre.periods[3].value < pre.periods[0].value, 'the last quarter should be the slowest');
});
test('a line first seen during the game is not treated as a pregame line', () => {
  // halftime, 130 points, pregame total was 228: a sharp live line is about 244
  const half = row({ status: 'halftime', period: 2, clock: '0:00', statusDetail: 'Halftime', home: { score: 68, qScores: [34, 34] }, away: { score: 62, qScores: [31, 31] } });
  const truth = LL.project(half, { prior: 228 }).full;
  const naive = LL.project(half, { prior: 244 }).full;
  const fixed = LL.project(half, { prior: 244, priorSeen: { pts: 130, elapsed: 24, diff: 6 } }).full;
  assert.ok(Math.abs(fixed - truth) < 2.5, `with the fix ${fixed} vs pregame-line answer ${truth}`);
  assert.ok(naive - truth > 5, `without the fix the hot start is counted twice (${naive} vs ${truth})`);
});
test('plus edges only: a line our number is not ahead of gets no number and no call', () => {
  const r = LL.project(row(), { prior: 228, lines: { game: 260, half1: 140, quarter: { 2: 80 } } });
  for (const m of r.markets) { assert.strictEqual(m.call, null); assert.strictEqual(m.ours, null, `${m.id} shows our number below the line`); assert.ok(!/\d{2,3}\.?\d* (vs|below|but)/i.test(m.text), m.text); }
});
test('a plus edge is called only when our number is ahead of the line', () => {
  const hot = row({ period: 3, clock: '6:00', statusDetail: 'Q3', home: { score: 95, qScores: [35, 35, 25] }, away: { score: 90, qScores: [33, 33, 24] } });
  const r = LL.project(hot, { prior: 228, lines: { game: 236.5 } });
  const m = r.markets.find((x) => x.id === 'game');
  if (m.call) { assert.ok(m.ours > m.line); assert.ok(m.chance >= 0.58); }
  for (const lineUp of [200, 220, 240, 260, 280]) for (const mk of LL.project(hot, { prior: 228, lines: { game: lineUp } }).markets) if (mk.call) assert.ok(mk.ours > mk.line, 'called a line we are not ahead of');
});
test('no calls on any line before tip-off', () => {
  const r = LL.project({ leagueId: 'nba', status: 'scheduled', home: { score: 0 }, away: { score: 0 } }, { prior: 228, lines: { game: 220, half1: 100, quarter: { 1: 50 } } });
  for (const m of r.markets) assert.strictEqual(m.call, null, `${m.id} called before tip-off`);
});
test('wording: never "over" or "under"; the league default is not called FanDuel\'s line', () => {
  const cases = [
    LL.project(row(), { prior: 228, lines: { game: 215, half1: 110, half2: 105, quarter: { 2: 50, 3: 55 } } }),
    LL.project(row(), { lines: { game: 215 } }),
    LL.project(row({ status: 'halftime', statusDetail: 'Halftime' }), { prior: 228, priorSeen: { pts: 60, elapsed: 12, diff: 3 }, lines: { game: 240 } }),
    LL.project(row({ leagueId: 'other', leagueName: 'Sweden - Ligan', clock: '', statusDetail: 'Live' }), { lines: { game: 150 } }),
  ];
  for (const r of cases) assert.ok(!/\b(over|under)\b/i.test(texts(r)), texts(r).match(/.{20}\b(over|under)\b.{20}/i));
  assert.ok(!/FanDuel's line of 228/.test(texts(cases[1])), 'default total worded as a FanDuel line');
});
test('numbers stay finite at every minute of a game, and the game fraction only moves forward', () => {
  let last = -1;
  for (let t = 0.5; t <= 47.5; t += 0.5) {
    const per = Math.min(4, Math.floor(t / 12) + 1), left = per * 12 - t;
    const pts = Math.round(t * 4.7);
    const q = [0, 0, 0, 0].map((_, i) => Math.round(Math.max(0, Math.min(12, t - i * 12)) * 4.7 / 2));
    const r = LL.project({ leagueId: 'nba', status: 'in_progress', period: per, clock: `${Math.floor(left)}:${String(Math.round((left % 1) * 60)).padStart(2, '0')}`, statusDetail: `Q${per}`, home: { score: Math.ceil(pts / 2), qScores: q.slice(0, per) }, away: { score: Math.floor(pts / 2), qScores: q.slice(0, per) } }, { prior: 228, lines: { game: 226.5 } });
    assert.ok(Number.isFinite(r.full) && r.full >= pts, `t=${t} full=${r.full}`);
    assert.ok(r.progress.elapsed >= last - 0.01, `clock went backwards at ${t}`);
    last = r.progress.elapsed;
  }
});
console.log(`${pass} checks passed${process.exitCode ? ', SOME FAILED' : ''}`);
