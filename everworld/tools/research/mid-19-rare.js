#!/usr/bin/env node
/* mid-19: the three rare situations in plain numbers (engine remaining vs real remaining, share who never come back),
 * 2026 and 2027, plus a few named examples to make sure the situations are what they claim to be. */
'use strict';
const C = require('./mid-common');
const lastPf = (r) => (r.pfAt.length ? r.pfAt[r.pfAt.length - 1] : -99);
const satSinceFoul = (r) => !r.on && r.pfAt.length && (r.el - r.sitFor) >= lastPf(r) - 0.1 && (r.el - r.sitFor) <= lastPf(r) + 1.5;
const S = {
  'foulSeat24 (3-4 fouls, off, sat 4+ since the foul)': (r) => r.g === 's24' && r.pf >= 3 && r.pf <= 4 && satSinceFoul(r) && r.sitFor >= 4,
  'foulSeat24 starters tonight': (r) => r.g === 's24' && r.sT === 1 && r.pf === 3 && satSinceFoul(r) && r.sitFor >= 4,
  'foulSeat24 starters, sat 8+': (r) => r.g === 's24' && r.sT === 1 && r.pf === 3 && satSinceFoul(r) && r.sitFor >= 8,
  'foulSeat24 reserves': (r) => r.g === 's24' && r.sT === 0 && r.pf >= 3 && r.pf <= 4 && satSinceFoul(r) && r.sitFor >= 4,
  'starterGone30 (starter, off 2.5+, <=3 fouls, within 15)': (r) => r.g === 's30' && r.sT === 1 && !r.on && r.sitFor >= 2.5 && r.pf <= 3 && Math.abs(r.mg) < 15,
  'starterGone30: never started H2': (r) => r.g === 's30' && r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05 && r.pf <= 3 && Math.abs(r.mg) < 15,
  'starterGone30: left in the first 3.5 min of Q3': (r) => r.g === 's30' && r.sT === 1 && r.stH2 === 1 && !r.on && r.sitFor >= 2.5 && r.pf <= 3 && Math.abs(r.mg) < 15,
  'starter off 2.5+ at 30, <=3 fouls, margin 15+': (r) => r.g === 's30' && r.sT === 1 && !r.on && r.sitFor >= 2.5 && r.pf <= 3 && Math.abs(r.mg) >= 15,
  'benchMissed30 (reserve, off, 6+ usual minutes missed)': (r) => r.g === 's30' && r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 6,
  'benchMissed30, 4-6 missed': (r) => r.g === 's30' && r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 4 && r.hMissed < 6,
  'benchMissed24 (reserve, off, 6+ missed)': (r) => r.g === 's24' && r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 6,
  'starter off, 6+ missed, s30 (for contrast)': (r) => r.g === 's30' && r.sT === 1 && !r.on && r.hN >= 3 && r.hMissed >= 6 && r.pf <= 3,
};
for (const season of [2026, 2027]) {
  const rows = C.load(season).filter((r) => C.played(r));
  console.log(`\n===== ${season} =====`);
  for (const [nm, f] of Object.entries(S)) {
    const B = rows.filter(f);
    if (!B.length) { console.log(`${nm}: none`); continue; }
    const gp = C.cl(B, (r) => r.gap), en = C.cl(B, (r) => r.erem), re = C.cl(B, (r) => r.rem);
    const never = B.filter((r) => r.rem < 0.5).length / B.length;
    const T = B.filter(C.p10), mae = T.length ? T.reduce((a, r) => a + Math.abs(r.ac0 - r.pr0), 0) / T.length : NaN;
    console.log(`${nm.padEnd(58)} n=${String(B.length).padStart(4)} tg=${String(gp.G).padStart(4)} engine rem ${en.mean.toFixed(2).padStart(5)} real ${re.mean.toFixed(2).padStart(5)} gap ${C.fmt(gp.mean, 2)} z ${C.fmt(gp.z, 1)} | never back ${(100 * never).toFixed(0)}% | miss (10+) ${mae.toFixed(2)} | mpg ${(B.reduce((a, r) => a + r.mpg, 0) / B.length).toFixed(1)} usual starter ${(100 * B.filter((r) => r.st).length / B.length).toFixed(0)}% back-from-layoff ${(100 * B.filter((r) => r.fr).length / B.length).toFixed(0)}%`);
    if (season === 2026 && process.argv.includes('--ex')) for (const r of B.slice(0, 4)) console.log(`      e.g. ${r.d} ${r.nm} (${r.tm}) min ${r.now0} pf ${r.pf} sat ${r.sitFor} engine final ${r.mn0} real ${r.ac0} hMissed ${r.hMissed} hStG ${r.hStG}`);
  }
}
