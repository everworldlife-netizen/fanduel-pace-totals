#!/usr/bin/env node
/* mid-17: does "on the floor now" mean the same for a starter and a reserve? The engine has one learned "on" input.
 * On top of flat + flatLop (+ paceT at the half):
 *   onB  = on now and NOT in tonight's starting five
 *   benchInQ3 / startOnSinceHalf (s30 only) = reserve who has already played in Q3 / starter on the floor since the half began
 *   onB_long = reserve on now with a current stint of 6+ minutes */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const accOf = (g) => (g === 's24' ? [BASE.flat, BASE.flatLop, paceT] : [BASE.flat, BASE.flatLop]);
const run = (c) => { for (const g of c.stages) K.test({ ...c, stages: [g], accepted: accOf(g) }); console.log(''); };
run({ name: 'onB (reserve on the floor now)', stages: ['s18', 's24', 's30'], fns: [(r) => (r.sT === 0 && r.on ? 1 : 0)] });
run({ name: 'benchInQ3', stages: ['s30'], fns: [(r) => (r.sT === 0 && r.stH2 === 0 && r.q3 >= 0.05 ? 1 : 0)] });
run({ name: 'startOnSinceHalf', stages: ['s30'], fns: [(r) => (r.sT === 1 && r.on && r.stintNow >= 5.99 ? 1 : 0)] });
run({ name: 'benchInQ3 + startOnSinceHalf', stages: ['s30'], fns: [(r) => (r.sT === 0 && r.stH2 === 0 && r.q3 >= 0.05 ? 1 : 0), (r) => (r.sT === 1 && r.on && r.stintNow >= 5.99 ? 1 : 0)], names: ['benchInQ3', 'startOnSinceHalf'], sit: (r) => (r.sT === 0 && r.stH2 === 0 && r.q3 >= 0.05) || (r.sT === 1 && r.on && r.stintNow >= 5.99) });
run({ name: 'onB + offS', stages: ['s18', 's30'], fns: [(r) => (r.sT === 0 && r.on ? 1 : 0), (r) => (r.sT === 1 && !r.on ? 1 : 0)], names: ['onB', 'offS'], sit: (r) => (r.sT === 0 && r.on) || (r.sT === 1 && !r.on) });
