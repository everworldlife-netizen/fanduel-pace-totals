#!/usr/bin/env node
/* mid-15: the general inputs together, final numbers (candidate ridge = engine's lineup-input ridge, 0.1x).
 *   flat    = clamp((0.5 x timeLeft - R)/R, -1, 4)                R = engine remaining minutes
 *   flatLop = flat x clamp((|margin| - 8)/10, 0, 2.5)
 *   paceT   = clamp((H x timeLeft/min(el,24) - R)/R, -1, 4)        H = his minutes in the first min(el,24) game minutes
 * Sets: A = flat; B = flat+flatLop; C = flat+flatLop+paceT; D = C + s30 state inputs (benchInQ3, startOnSinceHalf). */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const benchInQ3 = (r) => (r.el === 30 && r.sT === 0 && r.stH2 === 0 && r.q3 >= 0.05 ? 1 : 0);
const startOnSince = (r) => (r.el === 30 && r.sT === 1 && r.on && r.stintNow >= 5.99 ? 1 : 0);
const sets = {
  A: { fns: [BASE.flat], names: ['flat'] },
  B: { fns: [BASE.flat, BASE.flatLop], names: ['flat', 'flatLop'] },
  C: { fns: [BASE.flat, BASE.flatLop, paceT], names: ['flat', 'flatLop', 'paceT'] },
  D: { fns: [BASE.flat, BASE.flatLop, paceT, benchInQ3, startOnSince], names: ['flat', 'flatLop', 'paceT', 'benchInQ3', 'startOnSinceHalf'] },
};
const which = (process.argv[2] || 'A,B,C,D').split(',');
for (const k of which) {
  const s = sets[k];
  console.log(`\n######## set ${k}: ${s.names.join(' + ')}`);
  K.test({ name: k, fns: s.fns, names: s.names, stages: k === 'D' ? ['s30'] : ['s18', 's24', 's30'], sit: (r) => Math.abs(BASE.flat(r)) >= 0.5 });
}
