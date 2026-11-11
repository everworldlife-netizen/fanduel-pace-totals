#!/usr/bin/env node
/* late-24: the s36 (end of Q3) situations, each with the standard evidence (late-sit). Writes data/research/late-findings-s36.json */
'use strict';
const C = require('./late-common'), SIT = require('./late-sit');
const am = (r) => Math.abs(r.mg), S = (r) => r.st === 1, D = (r) => r.st !== 1 && r.mpg < 14, B = (r) => r.st !== 1 && r.mpg >= 14;
const SITS = {
  'deep bench (<14) in a 16+ game': (r) => D(r) && am(r) >= 16,
  '  .. 16-20': (r) => D(r) && am(r) >= 16 && am(r) <= 20,
  '  .. 21-25': (r) => D(r) && am(r) >= 21 && am(r) <= 25,
  '  .. 26+': (r) => D(r) && am(r) >= 26,
  '  .. on the floor at the Q3 buzzer, 21+': (r) => D(r) && r.on && am(r) >= 21,
  '  .. off the floor at the Q3 buzzer, 21+': (r) => D(r) && !r.on && am(r) >= 21,
  'deep bench (<14) off the floor in a game within 10': (r) => D(r) && !r.on && am(r) <= 10,
  '  .. did not play in Q3': (r) => D(r) && !r.on && am(r) <= 10 && r.q3 < 0.01,
  'starter off at the buzzer, 26+, five-on usual min < 22': (r) => S(r) && !r.on && am(r) >= 26 && r.mpgOn < 22,
  'starter off at the buzzer, 26+': (r) => S(r) && !r.on && am(r) >= 26,
  'regular (14+) off at the buzzer, 26+, five-on usual min < 22': (r) => !D(r) && !r.on && am(r) >= 26 && r.mpgOn < 22,
  'starter who played the whole third quarter (on, stint 11.9+)': (r) => S(r) && r.on && r.stintNow >= 11.9,
  '  .. within 15': (r) => S(r) && r.on && r.stintNow >= 11.9 && am(r) <= 15,
  'on the floor, checked in during the last 4 min of Q3': (r) => r.on && r.stintNow < 4,
  '  .. usual starter': (r) => r.on && r.stintNow < 4 && S(r),
  '  .. non-starter': (r) => r.on && r.stintNow < 4 && !S(r),
  'non-starter 18-24 min, within 15': (r) => !S(r) && r.mpg >= 18 && am(r) <= 15,
  'non-starter 18-24 min, leading by 16+': (r) => !S(r) && r.mpg >= 18 && r.mg >= 16,
  'starter with usual min 24-27, 16+ game': (r) => S(r) && r.mpg < 27 && am(r) >= 16,
  'non-starter 14+ already 3+ min above his usual pace, within 15': (r) => B(r) && am(r) <= 15 && r.now0 - 0.75 * r.mpg >= 3,
  'non-starter 14+ with 20+ min already, within 15': (r) => B(r) && am(r) <= 15 && r.now0 >= 20,
  'non-starter with first half 4+ min above half his usual': (r) => !S(r) && r.h1 - r.mpg / 2 >= 4,
  'non-starter with first half 4+ min below half his usual': (r) => !S(r) && r.h1 - r.mpg / 2 <= -4,
  'starter on at the buzzer, within 10': (r) => S(r) && r.on && am(r) <= 10,
  'starter off at the buzzer, within 10': (r) => S(r) && !r.on && am(r) <= 10,
  'starter, margin 11-15': (r) => S(r) && am(r) >= 11 && am(r) <= 15,
  'engine remaining under 2 min (all)': (r) => r.erem < 2,
  'engine remaining under 3 min, on the floor': (r) => r.erem < 3 && r.on,
  'engine remaining 9.5+ min': (r) => r.erem >= 9.5,
  '4 fouls, usual starter, within 10': (r) => S(r) && r.pf === 4 && am(r) <= 10,
  '5 fouls': (r) => r.pf === 5,
};
const out = [];
for (const [nm, f] of Object.entries(SITS)) { const o = SIT.evidence('s36', nm.trim(), f); SIT.show(o); out.push(o); }
C.L.writeJSON(`${C.L.ROOT}/data/research/late-findings-s36.json`, out);
