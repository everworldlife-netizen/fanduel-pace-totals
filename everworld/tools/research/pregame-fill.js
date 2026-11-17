'use strict';
// How much of the minutes the simulation adds to (or takes from) a player's own base really shows up?
// base = his usual regulation minutes, all recent games (regAvg). move = plain number - base. realized = real - base.
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const S = C.prepare(season);
const cuts = [-8, -5, -3, -1.5, -0.5, 0.5, 1.5, 3, 5, 8];
for (const g of ['rep', 'pre']) {
  for (const [nm, rf] of [['starters (24+ usual)', (r) => r.st === 1], ['18-24 usual', (r) => r.st !== 1 && r.mpg >= 18], ['10-18 usual', (r) => r.mpg < 18 && r.mpg >= 10]]) {
    const rs = S.rows.filter((r) => r.g === g && r.gap != null && r.f.n >= 3 && !r.fr && !r.dp && rf(r));
    console.log(`\n${g} ${season} ${nm}: ${rs.length} player-games (3+ recent games)`);
    console.log('  move bin        n   plain-base  engine-base  real-base   gap(real-engine)  z     | real-base among 10+ | team minutes out');
    for (let i = 0; i <= cuts.length; i++) {
      const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
      const q = rs.filter((r) => { const v = r.mp - r.f.regAvg; return v >= lo && v < hi; });
      if (q.length < 30) continue;
      const c = C.cmean(q.map((r) => r.gap), q.map((r) => r.id));
      const p10 = q.filter((r) => r.ac[0] >= 10);
      console.log(`  ${String(lo).padStart(9)}..${String(hi).padEnd(8)} ${String(q.length).padStart(5)}  ${C.mean(q.map((r) => r.mp - r.f.regAvg)).toFixed(2).padStart(7)}  ${C.mean(q.map((r) => r.mn[0] - r.f.regAvg)).toFixed(2).padStart(9)}  ${C.mean(q.map((r) => r.ac[0] - r.f.regAvg)).toFixed(2).padStart(9)}  ${c.m.toFixed(2).padStart(9)}  ${c.z.toFixed(1).padStart(9)}    |  ${C.mean(p10.map((r) => r.ac[0] - r.f.regAvg)).toFixed(2).padStart(6)}  | ${C.mean(q.map((r) => r.f.outTot || 0)).toFixed(0)}`);
    }
  }
}
