#!/usr/bin/env node
/* mid-10: exploration table. For many mid-game situations: n, team-games, raw gap (real - engine) with z, gap after the
 * plain refit (res), and after refit + flat + flatLop (res2). Nothing here is a finding by itself: it shows where to dig. */
'use strict';
const K = require('./mid-cand');
const { C, F, BASE } = K;
const season = +process.argv[2] || 2026;
const only = process.argv[3] || '';
const EX = [BASE.flat, BASE.flatLop];
const rows = F.addResid(C.load(season).filter((r) => ['s18', 's24', 's30'].includes(r.g)));
for (const g of ['s18', 's24', 's30']) { const R = rows.filter((r) => r.g === g); const o = F.fit(R, EX); for (const r of R) r.res2 = r.ac0 != null ? r.ac0 - F.predict(r, o.beta, EX) : null; }
const P = rows.filter(C.played);
const show = (g, label, f) => {
  const B = P.filter((r) => r.g === g && f(r));
  if (B.length < 30) return;
  const gp = C.cl(B, (r) => r.gap), rs = C.cl(B, (r) => r.res), r2 = C.cl(B, (r) => r.res2), en = C.cl(B, (r) => r.erem), re = C.cl(B, (r) => r.rem);
  console.log(`  ${label.padEnd(62)} n=${String(B.length).padStart(5)} tg=${String(gp.G).padStart(4)} eng ${en.mean.toFixed(1).padStart(4)} real ${re.mean.toFixed(1).padStart(4)} | gap ${C.fmt(gp.mean, 2)} z ${C.fmt(gp.z, 1).padStart(5)} | res ${C.fmt(rs.mean, 2)} z ${C.fmt(rs.z, 1).padStart(5)} | res2 ${C.fmt(r2.mean, 2)} z ${C.fmt(r2.z, 1).padStart(5)}`);
};
const sec = (t) => { console.log(`\n--- ${t} ---`); };
const want = (k) => !only || only.split(',').includes(k);
for (const g of ['s18', 's24', 's30']) {
  console.log(`\n================ ${g} ================`);
  if (want('half') && g === 's24') {
    sec('who starts the second half (halftime: the "on" flag = who finished the half)');
    show(g, 'started tonight, on at the half', (r) => r.sT === 1 && r.on);
    show(g, 'started tonight, OFF at the half', (r) => r.sT === 1 && !r.on);
    show(g, '   ... OFF, sat <= 2 min', (r) => r.sT === 1 && !r.on && r.sitFor <= 2);
    show(g, '   ... OFF, sat 2-5 min', (r) => r.sT === 1 && !r.on && r.sitFor > 2 && r.sitFor <= 5);
    show(g, '   ... OFF, sat 5-9 min', (r) => r.sT === 1 && !r.on && r.sitFor > 5 && r.sitFor <= 9);
    show(g, '   ... OFF, sat 9+ min', (r) => r.sT === 1 && !r.on && r.sitFor > 9);
    show(g, '   ... OFF, pf<=2', (r) => r.sT === 1 && !r.on && r.pf <= 2);
    show(g, '   ... OFF, pf>=3', (r) => r.sT === 1 && !r.on && r.pf >= 3);
    show(g, 'bench tonight, ON at the half', (r) => r.sT === 0 && r.on);
    show(g, '   ... ON, usually starts H2 <30% of games', (r) => r.sT === 0 && r.on && r.hN >= 3 && r.hStH2 < 0.3);
    show(g, '   ... ON, usually starts H2 >=30%', (r) => r.sT === 0 && r.on && r.hN >= 3 && r.hStH2 >= 0.3);
    show(g, '   ... ON, stint so far <= 3 min', (r) => r.sT === 0 && r.on && r.stintNow <= 3);
    show(g, '   ... ON, stint so far 3-8 min', (r) => r.sT === 0 && r.on && r.stintNow > 3 && r.stintNow <= 8);
    show(g, '   ... ON, stint so far 8+ min', (r) => r.sT === 0 && r.on && r.stintNow > 8);
    show(g, 'bench tonight, off at the half', (r) => r.sT === 0 && !r.on);
    show(g, 'on at half, usual H2 starter (hStH2>=.7)', (r) => r.on && r.hN >= 3 && r.hStH2 >= 0.7);
    show(g, 'on at half, not usual H2 starter (hStH2<.3)', (r) => r.on && r.hN >= 3 && r.hStH2 < 0.3);
    show(g, 'off at half, usual H2 starter (hStH2>=.7)', (r) => !r.on && r.hN >= 3 && r.hStH2 >= 0.7);
    show(g, 'off at half, not usual H2 starter (hStH2<.3)', (r) => !r.on && r.hN >= 3 && r.hStH2 < 0.3);
  }
  if (want('half') && g === 's30') {
    sec('who started the second half (known at 30 min)');
    show(g, 'started game, started H2', (r) => r.sT === 1 && r.stH2 === 1);
    show(g, 'started game, did NOT start H2', (r) => r.sT === 1 && r.stH2 === 0);
    show(g, '   ... and has not played in Q3 at all', (r) => r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05);
    show(g, '   ... has not played in Q3, pf<=3', (r) => r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05 && r.pf <= 3);
    show(g, '   ... has not played in Q3, pf<=3, |mg|<15', (r) => r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05 && r.pf <= 3 && Math.abs(r.mg) < 15);
    show(g, '   ... has not played in Q3, sat 10+ min', (r) => r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05 && r.sitFor >= 10);
    show(g, '   ... but has come in during Q3', (r) => r.sT === 1 && r.stH2 === 0 && r.q3 >= 0.05);
    show(g, 'bench, started H2', (r) => r.sT === 0 && r.stH2 === 1);
    show(g, '   ... bench started H2, still on', (r) => r.sT === 0 && r.stH2 === 1 && r.on);
    show(g, '   ... bench started H2, now off', (r) => r.sT === 0 && r.stH2 === 1 && !r.on);
    show(g, 'bench, did not start H2, played in Q3', (r) => r.sT === 0 && r.stH2 === 0 && r.q3 >= 0.05);
    show(g, 'bench, no minutes yet in Q3', (r) => r.sT === 0 && r.q3 < 0.05);
    show(g, '   ... bench no Q3 minutes, played 8+ in H1', (r) => r.sT === 0 && r.q3 < 0.05 && r.q1 + r.q2 >= 8);
    show(g, '   ... bench no Q3 minutes, played <4 in H1', (r) => r.sT === 0 && r.q3 < 0.05 && r.q1 + r.q2 < 4);
  }
  if (want('sit')) {
    sec('stopped appearing: off now, by how long he has sat and how many of those minutes he usually plays (hMissed)');
    for (const role of [1, 0]) for (const [a, b] of [[0, 2], [2, 4], [4, 6], [6, 9], [9, 13], [13, 99]]) show(g, `${role ? 'starter' : 'bench  '} off, sat ${a}-${b} min`, (r) => r.sT === role && !r.on && !r.dnp && r.sitFor > a && r.sitFor <= b);
    for (const role of [1, 0]) for (const [a, b] of [[0, 1], [1, 2.5], [2.5, 4], [4, 6], [6, 8], [8, 99]]) show(g, `${role ? 'starter' : 'bench  '} off, usual minutes missed ${a}-${b}`, (r) => r.sT === role && !r.on && !r.dnp && r.hN >= 3 && r.hMissed > a && r.hMissed <= b);
    show(g, 'starter off, missed 4+, pf low (no foul reason)', (r) => r.sT === 1 && !r.on && r.hN >= 3 && r.hMissed > 4 && r.pf < (g === 's18' ? 2 : g === 's24' ? 3 : 4));
    show(g, 'starter off, missed 4+, in foul trouble', (r) => r.sT === 1 && !r.on && r.hN >= 3 && r.hMissed > 4 && r.pf >= (g === 's18' ? 2 : g === 's24' ? 3 : 4));
    show(g, 'starter off, missed 4+, close game (|mg|<12), no fouls', (r) => r.sT === 1 && !r.on && r.hN >= 3 && r.hMissed > 4 && Math.abs(r.mg) < 12 && r.pf < (g === 's18' ? 2 : g === 's24' ? 3 : 4));
    show(g, 'off, last stint < 2 min, sat 4+', (r) => !r.on && !r.dnp && r.lastLen < 2 && r.sitFor > 4);
  }
  if (want('track')) {
    sec('minutes so far vs his usual by this point (own last-10 map), by role');
    for (const role of [1, 0]) for (const [a, b] of [[-99, -6], [-6, -4], [-4, -2], [-2, -0.75], [-0.75, 0.75], [0.75, 2], [2, 4], [4, 6], [6, 99]]) show(g, `${role ? 'starter' : 'bench  '} minutes so far - usual in ${a}..${b}`, (r) => r.sT === role && r.hN >= 3 && r.now0 - r.hSoFar > a && r.now0 - r.hSoFar <= b);
  }
  if (want('on')) {
    sec('on/off now vs his usual state at this minute (share of last-10 games on the floor just after this minute)');
    show(g, 'on now, usually on (>=.7)', (r) => r.on && r.hN >= 3 && r.hOnAt >= 0.7);
    show(g, 'on now, sometimes (.3-.7)', (r) => r.on && r.hN >= 3 && r.hOnAt >= 0.3 && r.hOnAt < 0.7);
    show(g, 'on now, usually off (<.3)', (r) => r.on && r.hN >= 3 && r.hOnAt < 0.3);
    show(g, 'off now, usually on (>=.7)', (r) => !r.on && !r.dnp && r.hN >= 3 && r.hOnAt >= 0.7);
    show(g, 'off now, sometimes (.3-.7)', (r) => !r.on && !r.dnp && r.hN >= 3 && r.hOnAt >= 0.3 && r.hOnAt < 0.7);
    show(g, 'off now, usually off (<.3)', (r) => !r.on && !r.dnp && r.hN >= 3 && r.hOnAt < 0.3);
  }
}
