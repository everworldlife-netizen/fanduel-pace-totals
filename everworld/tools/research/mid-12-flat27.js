#!/usr/bin/env node
/* mid-12: the flatten inputs under the full protocol (accepted = none), incl. the clean 2027 check. */
'use strict';
const K = require('./mid-cand');
const { BASE, clamp } = K;
const stages = ['s18', 's24', 's30'];
K.test({ name: 'flat', fns: [BASE.flat], names: ['flat'], stages, sit: (r) => Math.abs(BASE.flat(r)) >= 0.5 });
console.log('');
K.test({ name: 'flat + flatLop', fns: [BASE.flat, BASE.flatLop], names: ['flat', 'flatLop'], stages, sit: (r) => Math.abs(BASE.flat(r)) >= 0.5 });
console.log('');
K.test({ name: 'flatLop | flat', fns: [BASE.flatLop], names: ['flatLop'], accepted: [BASE.flat], stages, sit: (r) => Math.abs(r.mg) >= 16 });
