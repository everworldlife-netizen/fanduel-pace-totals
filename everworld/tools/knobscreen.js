#!/usr/bin/env node
/* Screen engine switches that were set by judgment: run the same games with one switch changed at a time and
 * compare with the shipped setting, game by game (paired z). Screening is done on TRAINING seasons; a winner then
 * has to be confirmed on unseen games with the lessons refit (see NOTES.md).
 *   node tools/knobscreen.js --engine <engine.js> --lessons <lessons.json> --seasons 2025 --every 2 [--stages 0] [--nsims 300] --knobs "minDecay=0.75,minDecay=0.92,usgPriorK=40"
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const L = require('./lib');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const engine = arg('--engine'), lessons = arg('--lessons'), seasons = arg('--seasons', '2025'), every = arg('--every', '2'), stages = arg('--stages', '0'), nsims = arg('--nsims', '300');
const knobs = String(arg('--knobs', '')).split(',').filter(Boolean);
const tag = arg('--tag', 'knob');
const run = (name, tune) => {
  const out = `data/runs/${tag}-${name}.json`;
  if (!L.exists(path.join(L.ROOT, out))) execFileSync('node', ['tools/bt2.js', '--engine', engine, '--seasons', seasons, '--no-playoffs', '--jobs', '4', '--nsims', nsims, '--stages', stages, '--every', every, '--lessons', lessons, '--out', out].concat(tune ? ['--tune', tune] : []), { cwd: L.ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  return out;
};
const base = run('default', '');
const rows = [];
for (const kv of knobs) {
  const out = run(kv.replace(/[^a-zA-Z0-9.=+-]/g, '_'), kv.replace(/\+/g, ','));
  const txt = execFileSync('node', ['tools/cmp.js', base, out], { cwd: L.ROOT }).toString();
  for (const line of txt.split('\n')) {
    const m = line.match(/^(\S.*?)\s+games\s+(\d+)/);
    if (!m) continue;
    const get = (label) => { const r = new RegExp(`\\| ${label} ([0-9.]+)→([0-9.]+) \\((-?[0-9.]+)%, z (-?[0-9.]+)\\)`).exec(line); return r ? { a: +r[1], b: +r[2], pct: +r[3], z: +r[4] } : null; };
    rows.push({ kv, stage: m[1].trim(), games: +m[2], pts: get('PTS real10'), min: get('MIN real10'), reb: get('REB'), ast: get('AST'), tot: get('TOTAL') });
  }
}
const f = (x) => (x ? `${x.pct >= 0 ? '+' : ''}${x.pct.toFixed(2)}% (z ${x.z.toFixed(1)})`.padEnd(18) : ''.padEnd(18));
console.log('switch'.padEnd(22), 'stage'.padEnd(11), 'games', ' PTS'.padEnd(19), 'MIN'.padEnd(18), 'REB'.padEnd(18), 'AST'.padEnd(18), 'TOTAL');
for (const r of rows) console.log(r.kv.padEnd(22), r.stage.padEnd(11), String(r.games).padStart(5), '', f(r.pts), f(r.min), f(r.reb), f(r.ast), f(r.tot));
