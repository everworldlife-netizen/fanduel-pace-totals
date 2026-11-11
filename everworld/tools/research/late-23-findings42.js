#!/usr/bin/env node
/* late-23: the s42 (6:00 left) situations, each with the standard evidence (late-sit). Writes data/research/late-findings-s42.json */
'use strict';
const C = require('./late-common'), SIT = require('./late-sit');
const am = (r) => Math.abs(r.mg), S = (r) => r.st === 1, D = (r) => r.st !== 1 && r.mpg < 14, B = (r) => r.st !== 1 && r.mpg >= 14;
const dec = (r) => am(r) >= 16, flag = (r) => r.mpgOn < 20;
const SITS = {
  'white flag, regular sitting: off, 16+, five-on usual min < 20, usual 14+ min': (r) => !r.on && dec(r) && flag(r) && !D(r),
  '  .. usual starters only': (r) => !r.on && dec(r) && flag(r) && S(r),
  '  .. bench 14-24 only': (r) => !r.on && dec(r) && flag(r) && B(r),
  'white flag, on the floor, non-starter: on, 16+, five-on usual min < 20, usual < 24': (r) => r.on && dec(r) && flag(r) && !S(r),
  '  .. deep bench (<14) only': (r) => r.on && dec(r) && flag(r) && D(r),
  '  .. bench 14-24 only ': (r) => r.on && dec(r) && flag(r) && B(r),
  'starter still on in a decided game with regulars: on, 16+, five-on usual min 20+, usual starter': (r) => r.on && dec(r) && !flag(r) && S(r),
  '  .. leading': (r) => r.on && dec(r) && !flag(r) && S(r) && r.mg > 0,
  '  .. trailing': (r) => r.on && dec(r) && !flag(r) && S(r) && r.mg < 0,
  'starter on, margin 11-15': (r) => r.on && am(r) >= 11 && am(r) <= 15 && S(r),
  'deep bench waiting: off, 16+, five-on usual min 20+, usual < 14': (r) => !r.on && dec(r) && !flag(r) && D(r),
  'bench 14-24 waiting: off, 16+, five-on 20+': (r) => !r.on && dec(r) && !flag(r) && B(r),
  'starter resting in a close game: off, within 10, usual starter, sat < 12 min': (r) => !r.on && am(r) <= 10 && S(r) && r.sitFor < 12,
  '  .. sat 1-12 min': (r) => !r.on && am(r) <= 10 && S(r) && r.sitFor < 12 && r.sitFor >= 1,
  'starter off, margin 11-15, sat < 12': (r) => !r.on && am(r) >= 11 && am(r) <= 15 && S(r) && r.sitFor < 12,
  'deep bench sitting in a close game: off, within 10, usual < 14': (r) => !r.on && am(r) <= 10 && D(r),
  'bench 14-24 off in a close game': (r) => !r.on && am(r) <= 10 && B(r),
  'starter on in a close game (within 10)': (r) => r.on && am(r) <= 10 && S(r),
  'bench on in a close game (within 10), usual < 24': (r) => r.on && am(r) <= 10 && !S(r),
  '5 fouls, on the floor, within 10': (r) => r.on && r.pf === 5 && am(r) <= 10,
  '5 fouls, any': (r) => r.pf === 5,
  'lead cut by 6+ in the last 6 min, starter, margin 11-20 lead': (r) => S(r) && r.mg >= 11 && r.mg <= 20 && r.d6 <= -6,
  'deficit cut by 6+ in the last 6 min, starter, trailing 11-20': (r) => S(r) && r.mg <= -11 && r.mg >= -20 && r.d6 >= 6,
};
const out = [];
for (const [nm, f] of Object.entries(SITS)) { const o = SIT.evidence('s42', nm.trim(), f); SIT.show(o); out.push(o); }
C.L.writeJSON(`${C.L.ROOT}/data/research/late-findings-s42.json`, out);
