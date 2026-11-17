#!/usr/bin/env node
/* mid-38: which simple "on the floor" input is best at 30 minutes, on top of flat?  onB+offS (indicators) vs flatOnB
 * (flat for reserves on the floor) vs flatOn (flat for anyone on the floor). */
'use strict';
const K = require('./mid-cand');
const { BASE } = K;
const onB = (r) => (r.sT === 0 && r.on ? 1 : 0), offS = (r) => (r.sT === 1 && !r.on ? 1 : 0);
const flatOnB = (r) => (r.sT === 0 && r.on ? BASE.flat(r) : 0), flatOn = (r) => (r.on ? BASE.flat(r) : 0);
const sit = (r) => r.sT === 0 && r.on;
K.test({ name: 'onB + offS', fns: [onB, offS], names: ['onB', 'offS'], stages: ['s30'], accepted: [BASE.flat], sit });
K.test({ name: 'flatOnB', fns: [flatOnB], names: ['flatOnB'], stages: ['s30'], accepted: [BASE.flat], sit });
K.test({ name: 'flatOn', fns: [flatOn], names: ['flatOn'], stages: ['s30'], accepted: [BASE.flat], sit });
K.test({ name: 'onB + offS + flatOnB', fns: [onB, offS, flatOnB], names: ['onB', 'offS', 'flatOnB'], stages: ['s30'], accepted: [BASE.flat], sit });
