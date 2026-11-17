#!/usr/bin/env node
/* mid-33: last candidates on top of each stage's general chain: flatFav (flatten more when the books expected a lopsided game),
 * flatOn (flatten differently for players on the floor now), lopTier at the earlier stages, flatLop at 30, deepTrail. */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE } = K;
const h1 = (r) => (r.el <= 24 ? r.now0 : r.q1 + r.q2);
const paceT = (r) => clamp((h1(r) * (48 - r.el) / Math.min(r.el, 24) - r.erem) / r.erem, -1, 4);
const onB = (r) => (r.sT === 0 && r.on ? 1 : 0), offS = (r) => (r.sT === 1 && !r.on ? 1 : 0), lopTier = (r) => K.lop(r) * clamp((r.mpg - 24) / 8, -2, 1.5);
const gen = { s18: [BASE.flat, BASE.flatLop, offS], s24: [BASE.flat, BASE.flatLop, paceT], s30: [BASE.flat, onB, offS, lopTier] };
const flatFav = (r) => (r.fav != null ? BASE.flat(r) * clamp((Math.abs(r.fav) - 4) / 6, 0, 2) : 0);
const flatOn = (r) => (r.on ? BASE.flat(r) : 0);
const deepTrail = (r) => (r.mpg < 12 ? clamp((-r.mg - 8) / 10, 0, 2.5) : 0);
const favTier = (r) => (r.fav != null ? clamp((Math.abs(r.fav) - 4) / 6, 0, 2) * clamp((r.mpg - 24) / 8, -2, 1.5) : 0);
const C = [
  ['flatFav', flatFav, ['s18', 's24', 's30'], (r) => r.fav != null && Math.abs(r.fav) >= 8 && Math.abs(BASE.flat(r)) >= 0.3],
  ['favTier (|spread| x mpg tier)', favTier, ['s18', 's24', 's30'], (r) => r.fav != null && Math.abs(r.fav) >= 8],
  ['flatOn', flatOn, ['s18', 's30'], (r) => r.on && Math.abs(BASE.flat(r)) >= 0.3],
  ['lopTier', lopTier, ['s18', 's24'], (r) => Math.abs(r.mg) >= 16],
  ['flatLop', BASE.flatLop, ['s30'], (r) => Math.abs(r.mg) >= 16],
  ['deepTrail', deepTrail, ['s24', 's30'], (r) => r.mpg < 12 && r.mg <= -16],
];
for (const [nm, f, stages, sit] of C) { for (const g of stages) K.test({ name: nm, fns: [f], stages: [g], accepted: gen[g], sit }); console.log(''); }
