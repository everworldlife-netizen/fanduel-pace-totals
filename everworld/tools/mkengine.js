#!/usr/bin/env node
/* Put learned lessons (and switch settings) into an engine file: replaces the PAT_PRIOR and CAL_PRIOR tables,
 * optionally LAND, and sets TUNE defaults.
 *   node tools/mkengine.js --engine cs/build/engine.js --lessons data/lessons/x.json [--tune k=v,...] [--land data/lessons/land.json] [--note "..."]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const file = path.resolve(L.ROOT, arg('--engine', 'cs/build/engine.js'));
let s = fs.readFileSync(file, 'utf8');
const lessons = arg('--lessons') ? L.readJSON(path.resolve(L.ROOT, arg('--lessons'))) : null;
const swapLine = (name, value) => {
  const re = new RegExp(`^const ${name} = .*$`, 'm');
  if (!re.test(s)) throw new Error(`no ${name} line in ${file}`);
  s = s.replace(re, () => `const ${name} = ${value};`);
};
if (lessons) {
  swapLine('PAT_PRIOR', JSON.stringify(lessons.PAT_PRIOR));
  swapLine('CAL_PRIOR', JSON.stringify(lessons.CAL_PRIOR));
  if (lessons.TEAM_PRIOR) swapLine('TEAM_PRIOR', JSON.stringify(lessons.TEAM_PRIOR));
}
if (arg('--land')) swapLine('LAND', JSON.stringify(L.readJSON(path.resolve(L.ROOT, arg('--land')))).replace(/"/g, ''));
for (const kv of String(arg('--tune', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  const re = new RegExp(`(\\b${k}: )([-0-9.a-z]+)`, 'g');
  const i0 = s.indexOf('const TUNE = {'), i1 = s.indexOf('\n};', i0);
  const block = s.slice(i0, i1);
  if (!re.test(block)) throw new Error(`no TUNE.${k}`);
  s = s.slice(0, i0) + block.replace(re, (_, a) => a + v) + s.slice(i1);
}
fs.writeFileSync(file, s);
const E = require(file);
console.log(`engine updated: ${file}; inputs ${E.PAT_F.length}; lessons n=${E.patBeta(null).n}`);
