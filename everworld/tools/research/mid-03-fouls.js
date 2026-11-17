#!/usr/bin/env node
/* mid-03: foul trouble by count and time. For each stage and foul count: what share of his usual remaining minutes
 * (his own last-10 map, hRem) a player really plays, what the engine assumes, the raw gap (real - engine) and the gap
 * left after a plain refit of the 49 inputs (res). Units: minutes per player; z clustered by team-game. */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const season = +process.argv[2] || 2026;
const rows = F.addResid(C.load(season).filter((r) => ['s18', 's24', 's30'].includes(r.g)));
const P = rows.filter(C.played);
const show = (label, list) => {
  if (list.length < 25) return;
  const g = C.cl(list, (r) => r.gap), rs = C.cl(list, (r) => r.res);
  const hr = list.filter((r) => r.hN >= 3 && r.hRem > 1);
  const realShare = hr.length ? hr.reduce((a, r) => a + r.rem, 0) / hr.reduce((a, r) => a + r.hRem, 0) : NaN;
  const engShare = hr.length ? hr.reduce((a, r) => a + r.erem, 0) / hr.reduce((a, r) => a + r.hRem, 0) : NaN;
  console.log(`${label.padEnd(50)} n=${String(g.n).padStart(5)} tg=${String(g.G).padStart(4)} real/usual ${realShare.toFixed(2)} eng/usual ${engShare.toFixed(2)} | gap ${C.fmt(g.mean, 2)} z ${C.fmt(g.z, 1).padStart(5)} | res ${C.fmt(rs.mean, 2)} z ${C.fmt(rs.z, 1).padStart(5)}`);
};
for (const g of ['s18', 's24', 's30']) {
  const A = P.filter((r) => r.g === g);
  console.log(`\n===== ${g} =====`);
  for (const role of ['starter tonight', 'bench tonight']) {
    const B = A.filter((r) => (role[0] === 's' ? r.sT === 1 : r.sT === 0));
    for (let k = 0; k <= 5; k++) {
      const Ck = B.filter((r) => r.pf === k);
      show(`${role} pf=${k}`, Ck);
      if (k >= 2) {
        show(`   on now`, Ck.filter((r) => r.on));
        show(`   off now`, Ck.filter((r) => !r.on));
        const last = (r) => r.pfAt.length ? r.pfAt[r.pfAt.length - 1] : -99;
        show(`   last foul in the last 3 min`, Ck.filter((r) => r.el - last(r) <= 3));
        show(`   last foul 3-9 min ago`, Ck.filter((r) => r.el - last(r) > 3 && r.el - last(r) <= 9));
        show(`   last foul 9+ min ago`, Ck.filter((r) => r.el - last(r) > 9));
        show(`   off since the foul (sat right after it)`, Ck.filter((r) => !r.on && r.el - r.sitFor >= last(r) - 0.1 && r.el - r.sitFor <= last(r) + 1.0));
        show(`   on, has stayed on since the foul`, Ck.filter((r) => r.on && r.el - r.stintNow < last(r)));
        show(`   on, came back after sitting for it`, Ck.filter((r) => r.on && r.el - r.stintNow >= last(r)));
      }
    }
  }
}
