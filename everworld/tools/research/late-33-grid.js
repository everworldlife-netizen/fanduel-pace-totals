#!/usr/bin/env node
/* late-33: how sharp are the thresholds of the white flag? Gain (first half -> second half, % of the stage miss, mean line /
 * middle line) and the raw gap for a grid of margin and floor-unit thresholds; s42 (regulars off, non-starters on) and s36. */
'use strict';
const C = require('./late-common'), SIT = require('./late-sit');
const am = (r) => Math.abs(r.mg), S = (r) => r.st === 1;
const row = (stage, nm, f) => { const o = SIT.evidence(stage, nm, f); console.log(`  ${nm.padEnd(44)} n=${String(o.n).padStart(5)} tg=${String(o.tg).padStart(4)} engine ${o.engine.toFixed(2)} real ${o.real.toFixed(2)} gap ${(o.gap >= 0 ? '+' : '') + o.gap.toFixed(2)} z ${o.z.toFixed(1).padStart(6)} | gain mean ${o.gainL2.toFixed(2)}% middle ${o.gainL1.toFixed(2)}% | 2027 gap ${(o.gap27 >= 0 ? '+' : '') + o.gap27.toFixed(2)} (n ${o.n27}) gain ${o.gain27L2.toFixed(2)}% / ${o.gain27L1.toFixed(2)}%`); };
console.log('s42: regulars (14+) OFF the floor');
for (const m of [12, 14, 16, 18, 21]) for (const u of [16, 18, 20, 22, 24]) row('s42', `margin >= ${m}, five-on usual min < ${u}`, (r) => !r.on && am(r) >= m && r.mpgOn < u && r.mpg >= 14);
console.log('s42: non-starters ON the floor');
for (const m of [12, 14, 16, 18, 21]) for (const u of [16, 20, 24]) row('s42', `margin >= ${m}, five-on usual min < ${u}`, (r) => r.on && am(r) >= m && r.mpgOn < u && !S(r));
console.log('s42: by the count of usual starters on the floor instead (regulars off)');
for (const m of [16, 21]) for (const k of [0, 1, 2]) row('s42', `margin >= ${m}, usual starters on <= ${k}`, (r) => !r.on && am(r) >= m && r.stOn <= k && r.mpg >= 14);
console.log('s36: regulars (14+) OFF at the Q3 buzzer');
for (const m of [21, 24, 26, 30]) for (const u of [18, 22, 26, 99]) row('s36', `margin >= ${m}, five-on usual min < ${u}`, (r) => !r.on && am(r) >= m && r.mpgOn < u && r.mpg >= 14);
