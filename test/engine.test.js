const test = require('node:test');
const assert = require('node:assert');
const E = require('../public/live/engine.js');

const team = (abbr, name) => ({ abbreviation: abbr, city: name, name, full_name: name });
const game = (over = {}) => ({
  id: 1, date: '2026-10-30', datetime: '2026-10-30T23:00:00Z', status_state: 'live', display_status: 'live',
  period: 2, time: 'Q2 6:00', visitor_team: team('AAA', 'Aces'), home_team: team('BBB', 'Bees'),
  visitor_team_score: 30, home_team_score: 28, ...over,
});
const tm = (a) => ({ abbreviation: a });
const P = (period, clock, type, text, participants, team, extra = {}) => ({ period, clock, type, text, participants, team: tm(team), ...extra });

const plays = [
  P(1, '11:40', 'Jump Shot', 'Ann Able makes 25-foot three point jumper (Bob Bell assists)', [1, 2], 'AAA', { shooting_play: true, scoring_play: true, score_value: 3 }),
  P(1, '11:20', 'Jump Shot', 'Cat Cole misses 12-foot jumper', [3], 'BBB', { shooting_play: true }),
  P(1, '11:18', 'Defensive Rebound', 'Bob Bell defensive rebound', [2], 'AAA'),
  P(1, '10:00', 'Shooting Foul', 'Cat Cole shooting foul', [3], 'BBB'),
  P(1, '10:00', 'Free Throw - 1 of 2', 'Ann Able makes free throw 1 of 2', [1], 'AAA', { shooting_play: true, scoring_play: true, score_value: 1 }),
  P(1, '10:00', 'Free Throw - 2 of 2', 'Ann Able misses free throw 2 of 2', [1], 'AAA', { shooting_play: true }),
  P(1, '6:00', 'Substitution', 'Dan Dorn enters the game for Ann Able', [4, 1], 'AAA'),
  P(1, '5:00', 'Lost Ball Turnover', 'Dan Dorn lost ball turnover', [4], 'AAA'),
];

test('clock parsing and elapsed time', () => {
  assert.strictEqual(E.clockSec('7:03'), 423);
  assert.strictEqual(E.clockSec(':59.0'), 59);
  assert.strictEqual(E.elapsedSec(2, '6:00'), 720 + 360);
  assert.strictEqual(E.elapsedSec(5, '5:00'), 2880);
});

test('game state: live, half, final, pregame', () => {
  assert.strictEqual(E.gameState(game()).phase, 'live');
  const h = E.gameState(game({ time: 'Half' }));
  assert.strictEqual(h.period, 2); assert.strictEqual(h.left, 24);
  assert.strictEqual(E.gameState(game({ status_state: 'final', time: 'Final', period: 4 })).left, 0);
  const pre = E.gameState(game({ status_state: 'scheduled', display_status: '7:00 PM ET', period: 0, time: null }));
  assert.strictEqual(pre.phase, 'pre'); assert.strictEqual(pre.left, 48);
});

test('blowout rule: 15+ anytime, 12+ after half', () => {
  assert.ok(E.isBlowout(E.gameState(game({ visitor_team_score: 45, home_team_score: 30 }))));
  assert.ok(!E.isBlowout(E.gameState(game({ visitor_team_score: 42, home_team_score: 30 }))));
  assert.ok(E.isBlowout(E.gameState(game({ period: 3, time: 'Q3 5:00', visitor_team_score: 70, home_team_score: 58 }))));
});

test('box score from play-by-play: points, assists, rebounds, fouls, FTs, turnovers, minutes', () => {
  const { players, teams } = E.boxFromPlays(plays, 1, '4:00');
  assert.strictEqual(players[1].pts, 4);
  assert.strictEqual(players[1].fg3m, 1);
  assert.strictEqual(players[1].fta, 2);
  assert.strictEqual(players[2].ast, 1);
  assert.strictEqual(players[2].reb, 1);
  assert.strictEqual(players[3].pf, 1);
  assert.strictEqual(players[4].tov, 1);
  assert.ok(Math.abs(players[1].min - 6) < 1e-9, 'Able played 12:00 → 6:00');
  assert.ok(Math.abs(players[4].min - 2) < 1e-9, 'Dorn played 6:00 → 4:00');
  assert.ok(players[4].on && !players[1].on);
  assert.strictEqual(teams.AAA.pts, 4);
  assert.ok(teams.AAA.poss > 0);
});

test('samplers have the right means', () => {
  const R = E.makeSampler(42);
  const n = 20000;
  let p = 0, b = 0, nb = 0;
  for (let i = 0; i < n; i++) { p += R.poisson(4.2); b += R.binomial(10, 0.3); nb += R.negbin(6, 1.5); }
  assert.ok(Math.abs(p / n - 4.2) < 0.1);
  assert.ok(Math.abs(b / n - 3) < 0.1);
  assert.ok(Math.abs(nb / n - 6) < 0.15);
});

test('projection: never below current stats, minutes fill the floor, injured excluded', () => {
  const log = {
    id: 9, date: '2026-10-28', v: 'AAA', h: 'BBB', margin: { AAA: 4, BBB: -4 },
    teams: { AAA: { fga: 88, fta: 22, oreb: 10, dreb: 34, tov: 13, pts: 112, fg3a: 36, fg3m: 13, poss: 100.7 }, BBB: { fga: 86, fta: 20, oreb: 9, dreb: 33, tov: 14, pts: 108, fg3a: 34, fg3m: 12, poss: 99.8 } },
    rows: {},
  };
  const roster = [[1, 'Ann Able', 'AAA', 34], [2, 'Bob Bell', 'AAA', 30], [4, 'Dan Dorn', 'AAA', 24], [5, 'Eve Ezra', 'AAA', 28], [6, 'Fay Fox', 'AAA', 22], [7, 'Gus Gray', 'AAA', 20], [8, 'Hal Hill', 'AAA', 30],
    [3, 'Cat Cole', 'BBB', 32], [11, 'Ida Ito', 'BBB', 30], [12, 'Jo Jax', 'BBB', 30], [13, 'Kim Kay', 'BBB', 26], [14, 'Lu Lee', 'BBB', 24], [15, 'Max Moe', 'BBB', 22], [16, 'Ned Nye', 'BBB', 20]];
  for (const [pid, name, t, min] of roster) log.rows[pid] = { name, team: t, min, qmin: { 1: min / 4, 2: min / 4, 3: min / 4, 4: min / 4 }, pts: Math.round(min * 0.5), reb: 5, ast: 3, fg3m: 1, fg3a: 4, fga: Math.round(min * 0.4), fta: 3, ftm: 2, tov: 2, pf: 2 };
  const injuries = [{ status: 'Out', player: { id: 8 } }];
  const out = E.projectGame({ game: game({ period: 1, time: 'Q1 4:00', visitor_team_score: 4, home_team_score: 0 }), plays, logs: [log], priors: { last: {} }, injuries, nsims: 400 });
  const able = out.players.find((p) => p.pid === 1);
  assert.ok(able.proj.pts >= 4);
  assert.ok(!out.players.some((p) => p.pid === 8), 'injured player not projected');
  const remaining = out.players.filter((p) => p.team === 'AAA').reduce((a, p) => a + p.proj.min - p.now.min, 0);
  assert.ok(Math.abs(remaining - 5 * out.state.left) < 3, `AAA remaining minutes ≈ ${5 * out.state.left}, got ${remaining.toFixed(1)}`);
  assert.ok(out.winProb.AAA > 0 && out.winProb.AAA < 1);
  for (const p of out.players) for (const r of p.ladders.pts) assert.ok(r.p >= 0 && r.p <= 1);
});

test('consensus lines + picks + combos', () => {
  const props = [
    { player_id: 1, prop_type: 'points', vendor: 'a', line_value: '20.5', market: { type: 'over_under', over_odds: -110, under_odds: -110 } },
    { player_id: 1, prop_type: 'points', vendor: 'b', line_value: '20.5', market: { type: 'over_under', over_odds: -120, under_odds: 100 } },
    { player_id: 1, prop_type: 'points', vendor: 'c', line_value: '21.5', market: { type: 'milestone', odds: 150 } },
  ];
  const L = E.consensusLines(props);
  assert.strictEqual(L['1:pts'].line, 20.5);
  assert.ok(L['1:pts'].fairOver > 0.5 && L['1:pts'].fairOver < 0.53);
  assert.strictEqual(E.probOver(Int16Array.from([20, 21, 22, 19]), 20.5), 0.5);
  const legs = [
    { gameId: 1, pid: 1, prob: 0.7, kind: 'line' }, { gameId: 2, pid: 2, prob: 0.65, kind: 'line' }, { gameId: 3, pid: 3, prob: 0.4, kind: 'line' },
  ];
  const C = E.buildCombos(legs, { payout: 3 });
  assert.ok(C.repeats.length >= 1);
  assert.ok(C.repeats.every((c) => c.joint >= 1 / 3));
  const used = C.once.flatMap((c) => c.legs.map((l) => l.pid));
  assert.strictEqual(new Set(used).size, used.length, 'each player once');
});
