#!/usr/bin/env node
/* GG League, the last 30% of a game: one-setting corrections of the server's raw number, each day checked with the setting
 * fitted on the other days. shown = w x raw + (1 - w) x FanDuel, with the server's current weights w.
 *   node tools/research/gg-07-late.js data/eb/graded-rows.json
 */
'use strict';
const fs = require('fs');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).sort((a, b) => a.t - b.t);
const day = (r) => new Date(r.t).toISOString().slice(0, 10), days = [...new Set(rows.map(day))];
const PW = [0.68, 0.45, 0.15, 0.47, 0.9];
const wNow = (f) => (f < 0.25 ? PW[1] : f < 0.75 ? PW[2] : f < 0.9 ? PW[3] : PW[4]);
const mae = (R, fn) => mean(R.map((r) => Math.abs(fn(r) - r.fin))), bias = (R, fn) => mean(R.map((r) => fn(r) - r.fin));
// family A: share of "still to come" kept = 1 - k x (f - f0) / (1 - f0) from f0 on. family B: flat share c from f0 on.
const keepA = (f, k, f0) => (f <= f0 ? 1 : 1 - k * (f - f0) / (1 - f0));
const shown = (r, raw) => wNow(r.f) * raw + (1 - wNow(r.f)) * r.L;
const cand = (k, f0) => (r) => shown(r, r.S + keepA(r.f, k, f0) * (r.M - r.S));
const fitK = (R, f0) => { let best = [0, 1e9]; for (let k = 0; k <= 0.9001; k += 0.05) { const m = mae(R.filter((r) => r.f > f0), cand(k, f0)); if (m < best[1] - 1e-9) best = [k, m]; } return +best[0].toFixed(2); };
const late = rows.filter((r) => r.f > 0.65);
console.log(`${rows.length} readings, ${late.length} of them in the last 35% of a game`);
console.log(`shown now, last 35%: miss ${mae(late, (r) => shown(r, r.M)).toFixed(3)}, bias ${bias(late, (r) => shown(r, r.M)).toFixed(2)}; FanDuel ${mae(late, (r) => r.L).toFixed(3)}; raw ${mae(late, (r) => r.M).toFixed(3)} (bias ${bias(late, (r) => r.M).toFixed(2)})`);
for (const f0 of [0.6, 0.65, 0.7, 0.75]) {
  const kAll = fitK(rows, f0); let sNow = 0, sNew = 0, n = 0; const ks = [];
  for (const d of days) { const k = fitK(rows.filter((r) => day(r) !== d), f0); ks.push(k); for (const r of rows.filter((x) => day(x) === d && x.f > 0.65)) { sNow += Math.abs(shown(r, r.M) - r.fin); sNew += Math.abs(cand(k, f0)(r) - r.fin); n++; } }
  console.log(`start at ${f0}: setting from all days ${kAll}; by day left out ${ks.join(', ')}; each day with the other days' setting: ${(sNow / n).toFixed(3)} → ${(sNew / n).toFixed(3)} (${(((sNew / sNow) - 1) * 100).toFixed(1)}%), bias ${bias(late, cand(kAll, f0)).toFixed(2)}`);
}
// fixed sensible setting, by stretch and by day
const K = 0.5, F0 = 0.7;
console.log(`\nwith k = ${K} from ${F0} (keeps ${Math.round(100 * keepA(0.8, K, F0))}% at 0.80, ${Math.round(100 * keepA(0.9, K, F0))}% at 0.90, ${Math.round(100 * keepA(0.97, K, F0))}% at 0.97):`);
for (const [a, b] of [[0.65, 0.75], [0.75, 0.85], [0.85, 0.93], [0.93, 1.01]]) { const B = rows.filter((r) => r.f >= a && r.f < b); console.log(`   share played ${a.toFixed(2)}-${Math.min(b, 1).toFixed(2)} (${B.length}): FanDuel ${mae(B, (r) => r.L).toFixed(2)} | shown now ${mae(B, (r) => shown(r, r.M)).toFixed(2)} (bias ${bias(B, (r) => shown(r, r.M)).toFixed(2)}) | new ${mae(B, cand(K, F0)).toFixed(2)} (bias ${bias(B, cand(K, F0)).toFixed(2)})`); }
for (const d of days) { const B = late.filter((r) => day(r) === d); console.log(`   ${d} (${B.length}): shown now ${mae(B, (r) => shown(r, r.M)).toFixed(2)} → new ${mae(B, cand(K, F0)).toFixed(2)}`); }
{ const d = late.map((r) => Math.abs(cand(K, F0)(r) - r.fin) - Math.abs(shown(r, r.M) - r.fin)), m = mean(d), sd = Math.sqrt(mean(d.map((x) => (x - m) ** 2))); console.log(`   paired change over ${late.length} readings: ${m.toFixed(3)} (z ${(m / (sd / Math.sqrt(d.length))).toFixed(1)}); better on ${d.filter((x) => x < -0.05).length}, worse on ${d.filter((x) => x > 0.05).length}`); }
