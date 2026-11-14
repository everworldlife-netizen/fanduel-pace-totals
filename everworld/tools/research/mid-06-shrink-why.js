#!/usr/bin/env node
/* mid-06: why is the engine's remaining-minutes number too spread out? Slope of real remaining on engine remaining
 * (affine OLS, clustered) inside slices: current margin, how the game ended (hindsight: diagnosis only), role, on/off,
 * history depth. A slope of 1 with intercept 0 = calibrated. */
'use strict';
const C = require('./mid-common');
const season = +process.argv[2] || 2026;
const all = C.load(season);
const rows = all.filter((r) => ['s18', 's24', 's30'].includes(r.g));
// final margin per team-game (hindsight) from the derived games
const G = C.L.readJSON(`${C.L.ROOT}/data/derived/games-${season}.json.gz`);
const fmOf = new Map(); for (const it of G) fmOf.set(it.g.id, { h: it.g.home_team.abbreviation, m: (it.g.home_team_score || 0) - (it.g.visitor_team_score || 0) });
for (const r of rows) { const f = fmOf.get(r.id); r.fmAbs = f ? Math.abs(f.m) : null; }
const slope = (label, R) => {
  if (R.length < 150) return;
  const o = C.ols(R.map((r) => [1, r.erem]), R.map((r) => r.rem), R.map((r) => r.tg));
  const gp = C.cl(R, (r) => r.gap);
  console.log(`   ${label.padEnd(40)} n=${String(R.length).padStart(6)}  real = ${o.beta[0].toFixed(2).padStart(5)} + ${o.beta[1].toFixed(3)} x engine  (slope-1: z ${((o.beta[1] - 1) / o.se[1]).toFixed(1).padStart(6)})  mean gap ${C.fmt(gp.mean, 2)}`);
};
for (const g of ['s18', 's24', 's30']) {
  const R = rows.filter((r) => r.g === g && r.ac0 != null && !r.dnp);
  console.log(`\n== ${g}`);
  slope('all', R);
  slope('game ended within 9 (hindsight)', R.filter((r) => r.fmAbs != null && r.fmAbs <= 9));
  slope('game ended 10-19 (hindsight)', R.filter((r) => r.fmAbs >= 10 && r.fmAbs <= 19));
  slope('game ended 20+ (hindsight)', R.filter((r) => r.fmAbs >= 20));
  slope('margin now 0-5', R.filter((r) => Math.abs(r.mg) <= 5));
  slope('margin now 6-11', R.filter((r) => Math.abs(r.mg) >= 6 && Math.abs(r.mg) <= 11));
  slope('margin now 12-19', R.filter((r) => Math.abs(r.mg) >= 12 && Math.abs(r.mg) <= 19));
  slope('margin now 20+', R.filter((r) => Math.abs(r.mg) >= 20));
  slope('on now', R.filter((r) => r.on));
  slope('off now', R.filter((r) => !r.on));
  slope('started tonight', R.filter((r) => r.sT === 1));
  slope('bench tonight', R.filter((r) => r.sT === 0));
  slope('history 0-2 games', R.filter((r) => (r.hN || 0) <= 2));
  slope('history 3-6 games', R.filter((r) => r.hN >= 3 && r.hN <= 6));
  slope('history 7+ games', R.filter((r) => r.hN >= 7));
  slope('pregame fav by 6+', R.filter((r) => r.fav != null && r.fav >= 6));
  slope('pregame dog by 6+', R.filter((r) => r.fav != null && r.fav <= -6));
  slope('pregame within 5.5', R.filter((r) => r.fav != null && Math.abs(r.fav) < 6));
}
