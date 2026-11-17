#!/usr/bin/env node
/* Before any result is in: how far the app's numbers sit from the books' lines on one night, and where the two disagree most.
 *   node tools/research/v19-01-gap.js [--date 2026-11-13]
 * Uses data/props/<date>/app-*.json.gz (tools/appsnap.js) and the snapshots of tools/proprec.js nearest in time.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../lib');
const E = require(path.join(L.ROOT, 'cs/build/engine.js'));
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const date = arg('--date', '2026-11-13'), dir = path.join(L.DATA, 'props', date);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const appF = fs.readdirSync(dir).filter((f) => /^app-\d{4}\.json\.gz$/.test(f)).sort().pop();
const app = L.readJSON(path.join(dir, appF));
const lines = new Map();
for (const f of fs.readdirSync(dir).filter((x) => /^\d+-\d{4}\.json\.gz$/.test(x)).sort()) { const s = L.readJSON(path.join(dir, f)); if (Date.parse(s.at) <= Date.parse(app.at) + 600000) lines.set(s.game.id, { C: E.consensusLines(s.rows), game: s.game, raw: s.rows }); }
console.log(`${app.rows.length} players on the app at ${app.at.slice(11, 16)} UTC, lines for ${lines.size} games`);
const S = [];
for (const r of app.rows) { const G = lines.get(r.id); if (!G) continue; for (const k of ['pts', 'reb', 'ast', 'fg3m']) { const c = G.C[`${r.pid}:${k}`]; if (c) S.push({ k, nm: r.nm, tm: r.tm, ours: r[k], line: c.line, books: c.books, fair: c.fairOver, min: r.min }); } }
console.log('\nstat | players with a line | our number minus the line: average, spread | ours ahead of the line | level | below');
for (const k of ['pts', 'reb', 'ast', 'fg3m']) { const R = S.filter((x) => x.k === k), g = R.map((x) => x.ours - x.line), m = mean(g), sd = Math.sqrt(mean(g.map((x) => (x - m) ** 2))); console.log(`${k.padEnd(4)} | ${String(R.length).padStart(4)} | ${m >= 0 ? '+' : ''}${m.toFixed(2)}, ${sd.toFixed(2)} | ${R.filter((x) => x.ours > x.line).length} | ${R.filter((x) => x.ours === x.line).length} | ${R.filter((x) => x.ours < x.line).length} | line as a share of ours: ${(mean(R.map((x) => x.line)) / mean(R.map((x) => x.ours))).toFixed(3)}`); }
for (const k of ['pts', 'reb', 'ast']) { const R = S.filter((x) => x.k === k).sort((a, b) => Math.abs(b.ours - b.line) / Math.max(b.line, 3) - Math.abs(a.ours - a.line) / Math.max(a.line, 3)); console.log(`\nwidest disagreements, ${k}:`); for (const x of R.slice(0, 8)) console.log(`   ${x.nm.padEnd(24)} ${x.tm}  ours ${String(x.ours).padStart(5)}  line ${String(x.line).padStart(5)}  (${x.books} books)  our minutes ${x.min}`); }
// who has real minutes from us but no line anywhere, and who has a line but little or nothing from us
const withLine = new Set(S.map((x) => x.nm + x.tm));
const noLine = app.rows.filter((r) => lines.has(r.id) && r.min >= 18 && !withLine.has(r.nm + r.tm));
console.log(`\nplayers we give 18+ minutes with no line at any book (${noLine.length}): ${noLine.map((r) => `${r.nm} ${r.tm} ${r.min}′ ${r.pts}pts`).join('; ')}`);
const pidsApp = new Map(app.rows.map((r) => [`${r.id}:${r.pid}`, r]));
const orphan = []; for (const [gid, G] of lines) for (const c of Object.values(G.C)) if (c.stat === 'pts' && !pidsApp.has(`${gid}:${c.pid}`)) orphan.push(`${c.pid} (line ${c.line}, ${G.game.visitor}@${G.game.home})`);
console.log(`players with a points line the app shows no number for (${orphan.length}): ${orphan.join('; ')}`);
const low = S.filter((x) => x.k === 'pts' && x.min != null && x.min < 12); console.log(`players with a points line we give under 12 minutes (${low.length}): ${low.map((x) => `${x.nm} ${x.tm} ${x.min}′ ours ${x.ours} line ${x.line}`).join('; ')}`);
