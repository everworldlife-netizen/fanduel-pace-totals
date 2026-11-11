#!/usr/bin/env node
/* late-26: more s42 situations with the standard evidence: closing-group history, on-floor players the engine rates low,
 * time-on-floor, the other team's flag, home/favourite, and the el=36 flag variants. */
'use strict';
const C = require('./late-common'), SIT = require('./late-sit');
const am = (r) => Math.abs(r.mg), S = (r) => r.st === 1, D = (r) => r.st !== 1 && r.mpg < 14, B = (r) => r.st !== 1 && r.mpg >= 14;
const dec = (r) => am(r) >= 16, flag = (r) => r.mpgOn < 20;
const SITS = {
  'non-starter, off, within 10, top-5 closing rank (last 8 team games)': (r) => !r.on && am(r) <= 10 && !S(r) && r.cgNA >= 2 && r.cgRkA <= 5,
  'non-starter 14+, off, within 10, NOT a top-5 closer': (r) => !r.on && am(r) <= 10 && B(r) && r.cgNA >= 2 && r.cgRkA > 5,
  'starter, off, within 10, sat<12, top-5 closer': (r) => !r.on && am(r) <= 10 && S(r) && r.sitFor < 12 && r.cgNA >= 2 && r.cgRkA <= 5,
  'starter, off, within 10, sat<12, not a top-5 closer': (r) => !r.on && am(r) <= 10 && S(r) && r.sitFor < 12 && r.cgNA >= 2 && r.cgRkA > 5,
  'on, within 10, not a top-5 closer (rank 6+)': (r) => r.on && am(r) <= 10 && r.cgNA >= 2 && r.cgRkA >= 6,
  'on, within 10, top-3 closer': (r) => r.on && am(r) <= 10 && r.cgNA >= 2 && r.cgRkA <= 3,
  'on the floor, engine remaining < 3, within 10': (r) => r.on && r.erem < 3 && am(r) <= 10,
  'on the floor, engine remaining < 3, 11+': (r) => r.on && r.erem < 3 && am(r) >= 11,
  'on, within 10, starter, stint 9+ min': (r) => r.on && am(r) <= 10 && S(r) && r.stintNow >= 9,
  'on, within 10, starter, played all of Q4 so far (stint 6+)': (r) => r.on && am(r) <= 10 && S(r) && r.stintNow >= 6,
  'starter on, trailing 21+, other team has emptied its bench (opp five-on usual min < 20)': (r) => r.on && S(r) && r.mg <= -21 && r.oMpgOn < 20,
  'starter on, leading 16+, other team has emptied its bench': (r) => r.on && S(r) && r.mg >= 16 && r.oMpgOn < 20,
  'home team starters on, within 5': (r) => r.on && S(r) && am(r) <= 5 && r.hm === 1,
  'pre-game favourite by 8+, starter on, leading 11-20': (r) => r.on && S(r) && r.mg >= 11 && r.mg <= 20 && r.fav >= 8,
  'pre-game underdog by 8+, starter on, trailing 11-20': (r) => r.on && S(r) && r.mg <= -11 && r.mg >= -20 && r.fav <= -8,
  'white flag by starters-on count: off, 16+, <=1 usual starter on, usual 14+': (r) => !r.on && dec(r) && r.stOn <= 1 && !D(r),
  'white flag 11-15: off, margin 11-15, five-on usual min < 20, usual 14+': (r) => !r.on && am(r) >= 11 && am(r) <= 15 && flag(r) && !D(r),
  'white flag 11-15 on floor: on, margin 11-15, five-on < 20, non-starter': (r) => r.on && am(r) >= 11 && am(r) <= 15 && flag(r) && !S(r),
  'garbage unit 16-20 only: off regular': (r) => !r.on && am(r) >= 16 && am(r) <= 20 && flag(r) && !D(r),
  'garbage unit 21+ only: off regular': (r) => !r.on && am(r) >= 21 && flag(r) && !D(r),
  'five-on usual min 20-24, 21+, off regular': (r) => !r.on && am(r) >= 21 && r.mpgOn >= 20 && r.mpgOn < 24 && !D(r),
};
for (const [nm, f] of Object.entries(SITS)) SIT.show(SIT.evidence('s42', nm, f));
