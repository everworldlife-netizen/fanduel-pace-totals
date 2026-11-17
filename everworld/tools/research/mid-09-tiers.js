#!/usr/bin/env node
/* mid-09: lopsided games by role tier, on top of flat + flatLop. The engine cuts "starters" (24+ usual minutes) and lifts
 * everyone else in a blowout: a step at 24 minutes. Candidates:
 *   leadMid  = 18-24 mpg player, his team leads: clamp((mg-8)/10,0,2.5)          (engine lifts him; coaches pull him)
 *   leadLow  = 24-28 mpg "starter", his team leads                                  (engine cuts him as a star; he stays)
 *   deepTrail= under-12 mpg player, team trails: clamp((-mg-8)/10,0,2.5)            (garbage time comes earlier when behind)
 *   deepLead = under-12 mpg player, team leads
 *   topLop   = 28+ mpg, |mg| >= 20: clamp((|mg|-20)/10,0,1.5)                        (stars sit sooner than the engine thinks)
 *   lopTier  = lop x mpgC (smooth version)                                           */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE } = K;
const lead = (r) => clamp((r.mg - 8) / 10, 0, 2.5), trail = (r) => clamp((-r.mg - 8) / 10, 0, 2.5);
const acc = [BASE.flat, BASE.flatLop];
const stages = ['s18', 's24', 's30'];
const cands = [
  { name: 'leadMid (18-24 mpg, leading)', fns: [(r) => (r.mpg >= 18 && r.mpg < 24 ? lead(r) : 0)], sit: (r) => r.mpg >= 18 && r.mpg < 24 && r.mg >= 16 },
  { name: 'leadLow (24-28 mpg, leading)', fns: [(r) => (r.mpg >= 24 && r.mpg < 28 ? lead(r) : 0)], sit: (r) => r.mpg >= 24 && r.mpg < 28 && r.mg >= 16 },
  { name: 'deepTrail (<12 mpg, trailing)', fns: [(r) => (r.mpg < 12 ? trail(r) : 0)], sit: (r) => r.mpg < 12 && r.mg <= -16 },
  { name: 'deepLead (<12 mpg, leading)', fns: [(r) => (r.mpg < 12 ? lead(r) : 0)], sit: (r) => r.mpg < 12 && r.mg >= 16 },
  { name: 'topLop (28+ mpg, 20+ either way)', fns: [(r) => (r.mpg >= 28 ? clamp((Math.abs(r.mg) - 20) / 10, 0, 1.5) : 0)], sit: (r) => r.mpg >= 28 && Math.abs(r.mg) >= 24 },
  { name: 'lopTier (lop x mpgC)', fns: [(r) => K.lop(r) * clamp((r.mpg - 24) / 8, -2, 1.5)], sit: (r) => Math.abs(r.mg) >= 16 },
  { name: 'trailTier, leadTier (signed, x mpgC)', fns: [(r) => trail(r) * clamp((r.mpg - 24) / 8, -2, 1.5), (r) => lead(r) * clamp((r.mpg - 24) / 8, -2, 1.5)], names: ['trailTier', 'leadTier'], sit: (r) => Math.abs(r.mg) >= 16 },
];
for (const c of cands) { K.test({ ...c, stages, accepted: acc }); console.log(''); }
