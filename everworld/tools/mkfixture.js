#!/usr/bin/env node
/* Build the small fixture the Courtside tests run on: two real finished games with everything the engine was
 * given (recent logs, stat lines, team stats, closing line, posted lineup, tracking logs, plays) and the final box.
 *   node tools/mkfixture.js [--engine cs/build/engine.js] [--date 2026-11-09] [--n 2]
 */
'use strict';
const path = require('path');
const L = require('./lib');
const R = require('./replay');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const enginePath = arg('--engine', 'cs/build/engine.js');
const E = R.loadEngine(enginePath);
const date = arg('--date', '2026-11-09'), n = +arg('--n', 2);
const season = L.seasons(date).cur;
const S = R.loadSeasons([season]);
const sit = R.sitPriorShipped(E, enginePath);
const out = [];
for (const it of (S.byDate.get(date) || []).slice(0, n)) {
  const ctx = R.contextFor(E, S, it, {});
  if (!ctx.ok) continue;
  const names = new Set();
  for (const l of ctx.base.logs) for (const r of Object.values(l.rows)) names.add(E.norm(r.name));
  for (const x of ctx.base.avail.in) names.add(E.norm(x.name));
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => names.has(k)));
  const pids = new Set();
  for (const l of ctx.base.logs) for (const pid of Object.keys(l.rows)) pids.add(pid);
  const plays = L.readJSON(path.join(L.DATA, 'plays', `${it.g.id}.json.gz`));
  out.push({
    g: it.g, rows: it.log.rows, plays,
    base: { ...ctx.base, priors: { last: pick(ctx.base.priors.last), cur: pick(ctx.base.priors.cur) } },
    availReport: ctx.availReport,
    sitPrior: Object.fromEntries(Object.entries(sit).filter(([pid]) => pids.has(pid))),
  });
}
const f = path.join(L.ROOT, 'cs', 'tests', 'fixtures', 'games.json.gz');
L.writeJSON(f, out);
console.log(`${out.length} games → ${f}`);
