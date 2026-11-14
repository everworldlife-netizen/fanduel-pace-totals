#!/usr/bin/env node
/* mid-11: how much should tonight's minutes so far count? On top of flat + flatLop.
 *   pace     = (now x left/el - engine remaining)/engine remaining   : pull toward tonight's pace of minutes, everyone
 *   paceB    = same, bench tonight only (sT = 0);  paceS = starters tonight only
 *   benchUp  = bench tonight x clamp((min so far - usual by now)/4, 0, 2.5)      (usual by now = own last-10 map)
 *   benchDn  = bench tonight x clamp((usual by now - min so far)/4, 0, 2.5)
 *   startUp2 = starter tonight x clamp((min so far - usual by now)/4, 0, 2.5);  startDn2 likewise below usual */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE } = K;
const acc = [BASE.flat, BASE.flatLop];
const stages = ['s18', 's24', 's30'];
const pace = (r) => clamp((r.now0 * (48 - r.el) / r.el - r.erem) / r.erem, -1, 4);
const d = (r) => (r.hN >= 3 ? r.now0 - r.hSoFar : 0);
const cands = [
  { name: 'pace (all)', fns: [pace], sit: (r) => Math.abs(pace(r)) >= 0.4 },
  { name: 'paceB, paceS', fns: [(r) => (r.sT === 0 ? pace(r) : 0), (r) => (r.sT === 1 ? pace(r) : 0)], names: ['paceB', 'paceS'], sit: (r) => Math.abs(pace(r)) >= 0.4 },
  { name: 'benchUp', fns: [(r) => (r.sT === 0 ? clamp(d(r) / 4, 0, 2.5) : 0)], sit: (r) => r.sT === 0 && d(r) >= 4 },
  { name: 'benchDn', fns: [(r) => (r.sT === 0 ? clamp(-d(r) / 4, 0, 2.5) : 0)], sit: (r) => r.sT === 0 && d(r) <= -4 },
  { name: 'startUp2', fns: [(r) => (r.sT === 1 ? clamp(d(r) / 4, 0, 2.5) : 0)], sit: (r) => r.sT === 1 && d(r) >= 4 },
  { name: 'startDn2', fns: [(r) => (r.sT === 1 ? clamp(-d(r) / 4, 0, 2.5) : 0)], sit: (r) => r.sT === 1 && d(r) <= -4 },
  { name: 'benchUp + paceB', fns: [(r) => (r.sT === 0 ? clamp(d(r) / 4, 0, 2.5) : 0), (r) => (r.sT === 0 ? pace(r) : 0)], names: ['benchUp', 'paceB'], sit: (r) => r.sT === 0 && d(r) >= 4 },
];
for (const c of cands) { K.test({ ...c, stages, accepted: acc }); console.log(''); }
