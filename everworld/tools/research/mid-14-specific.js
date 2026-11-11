#!/usr/bin/env node
/* mid-14: specific situations on top of the accepted general inputs (flat, flatLop, paceT).
 * paceT = (minutes in the first min(el,24) game minutes x time left / min(el,24) - engine remaining)/engine remaining.
 * Each candidate is an indicator (or a ramp) inside the engine's multiplicative layer. */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const acc = [BASE.flat, BASE.flatLop, paceT];
const lastPf = (r) => (r.pfAt.length ? r.pfAt[r.pfAt.length - 1] : -99);
const satSinceFoul = (r) => !r.on && r.pfAt.length && (r.el - r.sitFor) >= lastPf(r) - 0.1 && (r.el - r.sitFor) <= lastPf(r) + 1.5;
const which = process.argv[2] || '';
const cands = [
  // ---- foul trouble
  { k: 'foul', name: 'foulSeat (s24: 3+ fouls, off, sat 4+ min since the foul)', stages: ['s24'], fns: [(r) => (r.pf >= 3 && r.pf <= 4 && satSinceFoul(r) && r.sitFor >= 4 ? 1 : 0)] },
  { k: 'foul', name: 'foulSeat starters only (s24)', stages: ['s24'], fns: [(r) => (r.sT === 1 && r.pf === 3 && satSinceFoul(r) && r.sitFor >= 4 ? 1 : 0)] },
  { k: 'foul', name: 'foulSeat starters, sat 8+ (s24)', stages: ['s24'], fns: [(r) => (r.sT === 1 && r.pf === 3 && satSinceFoul(r) && r.sitFor >= 8 ? 1 : 0)] },
  { k: 'foul', name: 'foulSeat (s18: 2+ fouls, off, sat 4+ min since the foul)', stages: ['s18'], fns: [(r) => (r.pf >= 2 && satSinceFoul(r) && r.sitFor >= 4 ? 1 : 0)] },
  { k: 'foul', name: 'foulSeat starters (s18: 2 fouls in Q1, still sitting)', stages: ['s18'], fns: [(r) => (r.sT === 1 && r.pf >= 2 && r.pfAt[1] < 12 && satSinceFoul(r) && r.sitFor >= 4 ? 1 : 0)] },
  { k: 'foul', name: 'foulOn (s18: starter, 2 fouls, on since the foul)', stages: ['s18'], fns: [(r) => (r.sT === 1 && r.pf === 2 && r.on && r.el - r.stintNow < lastPf(r) ? 1 : 0)] },
  { k: 'foul', name: 'foulOn (s24: starter, 3 fouls, on at half)', stages: ['s24'], fns: [(r) => (r.sT === 1 && r.pf === 3 && r.on ? 1 : 0)] },
  { k: 'foul', name: 'four fouls at 30 (anyone)', stages: ['s30'], fns: [(r) => (r.pf === 4 ? 1 : 0)] },
  { k: 'foul', name: 'four fouls at 30, on / off', stages: ['s30'], fns: [(r) => (r.pf === 4 && r.on ? 1 : 0), (r) => (r.pf === 4 && !r.on ? 1 : 0)], names: ['pf4on', 'pf4off'], sit: (r) => r.pf === 4 },
  { k: 'foul', name: 'three fouls at 30, picked up in Q3, starter', stages: ['s30'], fns: [(r) => (r.sT === 1 && r.pf === 3 && lastPf(r) >= 24 ? 1 : 0)] },
  { k: 'foul', name: 'five fouls at 30', stages: ['s30'], fns: [(r) => (r.pf === 5 ? 1 : 0)] },
  { k: 'foul', name: 'four fouls at half', stages: ['s24'], fns: [(r) => (r.pf === 4 ? 1 : 0)] },
  { k: 'foul', name: 'three fouls at half, bench', stages: ['s24'], fns: [(r) => (r.sT === 0 && r.pf === 3 ? 1 : 0)] },
  { k: 'foul', name: 'two fouls at 18 picked up in Q1, bench', stages: ['s18'], fns: [(r) => (r.sT === 0 && r.pf === 2 && r.pfAt[1] < 12 ? 1 : 0)] },
  { k: 'foul', name: 'three fouls at 18', stages: ['s18'], fns: [(r) => (r.pf === 3 ? 1 : 0)] },
  // ---- exits / who starts the second half
  { k: 'exit', name: 'starter did not start H2, no Q3 minutes, <=3 fouls (s30)', stages: ['s30'], fns: [(r) => (r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05 && r.pf <= 3 ? 1 : 0)] },
  { k: 'exit', name: '... same, game within 15', stages: ['s30'], fns: [(r) => (r.sT === 1 && r.stH2 === 0 && r.q3 < 0.05 && r.pf <= 3 && Math.abs(r.mg) < 15 ? 1 : 0)] },
  { k: 'exit', name: 'starter left early in Q3 and is still off (sat 2.5+, <=3 fouls, within 15)', stages: ['s30'], fns: [(r) => (r.sT === 1 && !r.on && r.sitFor >= 2.5 && r.pf <= 3 && Math.abs(r.mg) < 15 ? 1 : 0)] },
  { k: 'exit', name: 'bench started H2 (s30)', stages: ['s30'], fns: [(r) => (r.sT === 0 && r.stH2 === 1 ? 1 : 0)] },
  { k: 'exit', name: 'bench off, usual minutes missed 6+ (s30)', stages: ['s30'], fns: [(r) => (r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 6 ? 1 : 0)] },
  { k: 'exit', name: 'bench off, usual minutes missed 6+ (s24)', stages: ['s24'], fns: [(r) => (r.sT === 0 && !r.on && r.hN >= 3 && r.hMissed >= 6 ? 1 : 0)] },
  { k: 'exit', name: 'bench tonight but usual starter (hStG>=.6), off', stages: ['s18', 's24', 's30'], fns: [(r) => (r.sT === 0 && !r.on && r.hN >= 3 && r.hStG >= 0.6 ? 1 : 0)] },
  { k: 'exit', name: 'starter off at half, not in foul trouble, sat 9+ (s24)', stages: ['s24'], fns: [(r) => (r.sT === 1 && !r.on && r.pf <= 2 && r.sitFor >= 9 ? 1 : 0)] },
  { k: 'exit', name: 'starter off at 18 since Q1, not in foul trouble (sat 9+)', stages: ['s18'], fns: [(r) => (r.sT === 1 && !r.on && r.pf <= 1 && r.sitFor >= 9 ? 1 : 0)] },
  { k: 'exit', name: 'starter off 13+ at 18', stages: ['s18'], fns: [(r) => (r.sT === 1 && !r.on && r.sitFor >= 13 ? 1 : 0)] },
  // ---- halftime on/off
  { k: 'half', name: 'starter tonight, off at the half (s24)', stages: ['s24'], fns: [(r) => (r.sT === 1 && !r.on ? 1 : 0)] },
  { k: 'half', name: 'bench tonight, on at the half (s24)', stages: ['s24'], fns: [(r) => (r.sT === 0 && r.on ? 1 : 0)] },
  { k: 'half', name: 'bench on at half with 8+ straight minutes (s24)', stages: ['s24'], fns: [(r) => (r.sT === 0 && r.on && r.stintNow >= 8 ? 1 : 0)] },
  { k: 'half', name: 'off at half but usually starts H2 (>=.7) (s24)', stages: ['s24'], fns: [(r) => (!r.on && r.hN >= 3 && r.hStH2 >= 0.7 ? 1 : 0)] },
  { k: 'half', name: 'on at half, rarely starts H2 (<.3) (s24)', stages: ['s24'], fns: [(r) => (r.on && r.hN >= 3 && r.hStH2 < 0.3 ? 1 : 0)] },
  { k: 'half', name: 'bench no Q3 minutes yet, 8+ in H1 (s30)', stages: ['s30'], fns: [(r) => (r.sT === 0 && r.q3 < 0.05 && r.q1 + r.q2 >= 8 ? 1 : 0)] },
  { k: 'half', name: 'bench no Q3 minutes yet, <4 in H1 (s30)', stages: ['s30'], fns: [(r) => (r.sT === 0 && r.q3 < 0.05 && r.q1 + r.q2 < 4 ? 1 : 0)] },
  { k: 'half', name: 'bench came in during Q3 (s30)', stages: ['s30'], fns: [(r) => (r.sT === 0 && r.stH2 === 0 && r.q3 >= 0.05 ? 1 : 0)] },
  { k: 'half', name: 'starter still on since the half started (s30)', stages: ['s30'], fns: [(r) => (r.sT === 1 && r.on && r.stintNow >= 5.99 ? 1 : 0)] },
];
for (const c of cands) { if (which && c.k !== which) continue; K.test({ ...c, accepted: acc }); console.log(''); }
