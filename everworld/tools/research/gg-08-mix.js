#!/usr/bin/env node
/* GG League, during the game: after the late-game correction, would one steady share of our raw number (instead of the
 * server's learned shares by stretch) land closer? Each day is checked with the setting fitted on the other days.
 *   node tools/research/gg-08-mix.js data/eb/graded-rows.json
 */
'use strict';
const fs = require('fs');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).sort((a, b) => a.t - b.t);
const day = (r) => new Date(r.t).toISOString().slice(0, 10), days = [...new Set(rows.map(day))];
const PW = [0.68, 0.45, 0.15, 0.47, 0.9];
const wNow = (f) => (f < 0.25 ? PW[1] : f < 0.75 ? PW[2] : f < 0.9 ? PW[3] : PW[4]);
const keep = (f) => (f <= 0.7 ? 1 : 1 - 0.5 * (f - 0.7) / 0.3);
const raw2 = (r) => r.S + keep(r.f) * (r.M - r.S);
const mae = (R, fn) => mean(R.map((r) => Math.abs(fn(r) - r.fin)));
const now = (r) => wNow(r.f) * r.M + (1 - wNow(r.f)) * r.L, lateOnly = (r) => wNow(r.f) * raw2(r) + (1 - wNow(r.f)) * r.L;
const steady = (w, wEnd) => (r) => { const k = r.f >= 0.9 ? wEnd : w; return k * raw2(r) + (1 - k) * r.L; };
console.log(`${rows.length} readings. FanDuel ${mae(rows, (r) => r.L).toFixed(3)} | shown now ${mae(rows, now).toFixed(3)} | late fix, server's shares ${mae(rows, lateOnly).toFixed(3)}`);
for (const wEnd of [0.9]) { process.stdout.write(`steady share before the last tenth (last tenth ${wEnd}):`); for (let w = 0; w <= 0.8001; w += 0.1) process.stdout.write(`  ${w.toFixed(1)}: ${mae(rows, steady(w, wEnd)).toFixed(3)}`); console.log(); }
const fit = (R) => { let best = [0.3, 1e9]; for (let w = 0; w <= 0.8001; w += 0.05) { const m = mae(R, steady(w, 0.9)); if (m < best[1] - 1e-9) best = [w, m]; } return +best[0].toFixed(2); };
let a = 0, b = 0, c = 0, n = 0; const ws = [];
for (const d of days) { const w = fit(rows.filter((r) => day(r) !== d)); ws.push(w); for (const r of rows.filter((x) => day(x) === d)) { a += Math.abs(now(r) - r.fin); b += Math.abs(lateOnly(r) - r.fin); c += Math.abs(steady(w, 0.9)(r) - r.fin); n++; } }
console.log(`each day with the other days' setting (${ws.join(', ')}): shown now ${(a / n).toFixed(3)} | late fix with the server's shares ${(b / n).toFixed(3)} (${(((b / a) - 1) * 100).toFixed(1)}%) | late fix with one steady share ${(c / n).toFixed(3)} (${(((c / a) - 1) * 100).toFixed(1)}%)`);
for (const [x, y] of [[0, 0.35], [0.35, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.01]]) { const B = rows.filter((r) => r.f >= x && r.f < y); console.log(`   share played ${x.toFixed(2)}-${Math.min(y, 1).toFixed(2)} (${B.length}): FanDuel ${mae(B, (r) => r.L).toFixed(2)} | shown now ${mae(B, now).toFixed(2)} | late fix ${mae(B, lateOnly).toFixed(2)} | steady 0.3 ${mae(B, steady(0.3, 0.9)).toFixed(2)} | steady 0.4 ${mae(B, steady(0.4, 0.9)).toFixed(2)}`); }
