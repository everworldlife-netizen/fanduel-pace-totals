#!/usr/bin/env node
/* mid-13: "tonight's pace of minutes" as a second anchor, on top of flat + flatLop, full protocol.
 *   pace    = (min so far x time left / time played - engine remaining) / engine remaining, clamp -1..4
 *   paceH1  = (s30 only) same with first-half minutes: (H1 minutes x 18/24 - engine remaining)/engine remaining
 *   paceB / paceS = pace for bench-tonight / starters-tonight separately */
'use strict';
const K = require('./mid-cand');
const { clamp, BASE } = K;
const acc = [BASE.flat, BASE.flatLop];
const pace = (r) => clamp((r.now0 * (48 - r.el) / r.el - r.erem) / r.erem, -1, 4);
const paceH1 = (r) => clamp(((r.q1 + r.q2) * (48 - r.el) / 24 - r.erem) / r.erem, -1, 4);
K.test({ name: 'pace', fns: [pace], names: ['pace'], stages: ['s18', 's24', 's30'], accepted: acc, sit: (r) => Math.abs(pace(r)) >= 0.4 });
console.log('');
K.test({ name: 'paceH1 (s30)', fns: [paceH1], names: ['paceH1'], stages: ['s30'], accepted: acc, sit: (r) => Math.abs(paceH1(r)) >= 0.4 });
console.log('');
K.test({ name: 'paceB/paceS', fns: [(r) => (r.sT === 0 ? pace(r) : 0), (r) => (r.sT === 1 ? pace(r) : 0)], names: ['paceB', 'paceS'], stages: ['s18', 's24', 's30'], accepted: acc, sit: (r) => Math.abs(pace(r)) >= 0.4 });
console.log('');
K.test({ name: 'paceH1 B/S (s30)', fns: [(r) => (r.sT === 0 ? paceH1(r) : 0), (r) => (r.sT === 1 ? paceH1(r) : 0)], names: ['paceH1B', 'paceH1S'], stages: ['s30'], accepted: acc, sit: (r) => Math.abs(paceH1(r)) >= 0.4 });
