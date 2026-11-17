#!/usr/bin/env node
/* Prints the blind check of the books' line inside the number: the average miss of every scored player with the line
 * off and on, on the blind night and on every recorded night together, and applies the pass rule of NOTES.md
 * ("Version 20 candidate": written before the blind night was played).   node tools/blind20cmp.js <blind date> <first night> */
'use strict';
const path = require('path');
const L = require('./lib');
const [D, FROM] = process.argv.slice(2);
const rd = (f) => L.readJSON(path.join(L.DATA, 'runs', f));
const STAGES = [['rep', 'before lineups'], ['0', 'tip-off'], ['6', '6:00'], ['12', '12:00'], ['24', 'halftime']];
const STATS = [['pts', 'points'], ['reb', 'rebounds'], ['ast', 'assists'], ['fg3m', 'threes']];
function table(title, off, on) {
  console.log(`\n== ${title}: ${off.used} games (average miss, every scored player; off → on)`);
  const out = {};
  for (const [s, sl] of STAGES) {
    const a = off.sum[s], b = on.sum[s]; if (!a || !b) continue;
    if (a.n !== b.n) console.log(`   (!) ${sl}: ${a.n} players off, ${b.n} on`);
    out[s] = {};
    console.log(`${sl.padEnd(15)} ${STATS.map(([k, kl]) => { const d = b[k] - a[k]; out[s][k] = d; return `${kl} ${a[k].toFixed(3)} → ${b[k].toFixed(3)} (${d <= 0 ? '' : '+'}${(100 * d / a[k]).toFixed(1)}%)`; }).join('  |  ')}   (${a.n} players)`);
  }
  return out;
}
const night = table(`BLIND NIGHT ${D}`, rd(`B20-${D}-off.json`), rd(`B20-${D}-on.json`));
const all = table(`ALL NIGHTS ${FROM}..${D}`, rd('B20-all-off.json'), rd('B20-all-on.json'));
const closer = (t, s, k) => t[s] && t[s][k] < 0;
const p1 = closer(night, 'rep', 'pts'), p2 = closer(night, '0', 'pts');
console.log('\n== THE PASS RULE');
console.log(`1. points closer on the blind night before lineups: ${p1 ? 'YES' : 'NO'}; at tip-off: ${p2 ? 'YES' : 'NO'}  →  ${p1 && p2 ? 'PASS' : 'NOT PASSED (rule 3: nothing is published today)'}`);
for (const [k, kl] of STATS.slice(1)) { const a = closer(all, 'rep', k), b = closer(all, '0', k); console.log(`2. ${kl}, all nights together: closer before lineups ${a ? 'YES' : 'NO'}, at tip-off ${b ? 'YES' : 'NO'}  →  ${a && b ? 'its share stays' : 'ITS SHARE IS SET TO 0 in the release'}`); }
