#!/usr/bin/env node
/* Pregame research: keep only the before-the-game rows (stages rep, pre, and un rows at el 0) of a research dump, so
 * later scripts load fast.   node tools/research/pregame-extract.js 2026 */
'use strict';
const path = require('path');
const L = require('../lib');
for (const s of process.argv.slice(2)) {
  const rows = L.readJSON(path.join(L.DATA, 'runs', `research-${s}.rows.json.gz`));
  const keep = rows.filter((r) => r.g === 'rep' || r.g === 'pre' || (r.un && r.el === 0));
  L.writeJSON(path.join(L.DATA, 'research', `pregame-rows-${s}.json.gz`), keep);
  const c = {}; for (const r of keep) { const k = r.un ? 'un' : r.g; c[k] = (c[k] || 0) + 1; }
  console.log(s, rows.length, '->', keep.length, c);
}
