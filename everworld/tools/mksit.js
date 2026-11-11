#!/usr/bin/env node
/* Build the season situational prior shipped with Courtside (cs/build/sitprior.js) from a finished season's play-by-play,
 * with the engine's own builder, so the prior and the engine always agree.
 *   node tools/mksit.js --engine cs/build/engine.js --season 2026 [--tune sitPre=1] --out cs/build/sitprior.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const R = require('./replay');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const E = R.loadEngine(arg('--engine', 'cs/build/engine.js'));
for (const kv of String(arg('--tune', '')).split(',').filter(Boolean)) { const [k, v] = kv.split('='); E.TUNE[k] = +v; }
const season = +arg('--season', 2026);
const logs = L.readJSON(path.join(L.DATA, 'derived', `games-${season}.json.gz`)).filter((it) => !it.g.postseason).map((it) => it.log);
const stars = {};
const starOf = (tm) => { if (!(tm in stars)) { const x = E.teamStar(logs, tm); stars[tm] = x ? x.pid : null; } return stars[tm]; };
const pids = new Set();
for (const lg of logs) for (const pid of Object.keys(lg.rows)) pids.add(pid);
const rows = [];
for (const pid of pids) {
  const r = E.sitPriorOf(logs, +pid, starOf);
  if (!r) continue;
  const c = r.c.slice(0, 10).flat();
  rows.push([pid, r.s || 0, r.P, r.M, ...c, r.cv[2], r.cv[3]].join(','));
}
const out = path.resolve(L.ROOT, arg('--out', 'cs/build/sitprior.js'));
const label = `${season - 1}-${String(season).slice(2)}`;
fs.writeFileSync(out, `/* Last season's situational scoring per player (built from ${label} play-by-play, ${logs.length} games). */\nself.SIT_PRIOR_TXT = "${rows.join(';')}";\n`);
console.log(`${rows.length} players from ${logs.length} games → ${out}`);
