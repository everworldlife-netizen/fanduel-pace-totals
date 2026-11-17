#!/usr/bin/env node
/* GG League, during the game: a corrected number, fitted on the earlier days and checked on the later ones.
 *   node tools/research/gg-06-livefix.js data/eb/graded-rows.json
 * rows: { t, f (share played, as the server estimated it), S (score then), M (server's raw number), L (FanDuel's line), fin }
 */
'use strict';
const fs = require('fs');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).sort((a, b) => a.t - b.t);
const day = (r) => new Date(r.t).toISOString().slice(0, 10);
const days = [...new Set(rows.map(day))];
console.log(`${rows.length} readings on ${days.join(', ')}`);
const PW = [0.68, 0.45, 0.15, 0.47, 0.9];
const wNow = (f) => (f < 0.25 ? PW[1] : f < 0.75 ? PW[2] : f < 0.9 ? PW[3] : PW[4]);
const shownNow = (r) => wNow(r.f) * r.M + (1 - wNow(r.f)) * r.L;
const mae = (R, fn) => mean(R.map((r) => Math.abs(fn(r) - r.fin))), bias = (R, fn) => mean(R.map((r) => fn(r) - r.fin));
// 1. how much of "points still to come" really comes, by share played (the raw number's own estimate against the real one)
console.log('\n1. points still to come: real as a share of what the raw number expects');
for (const [a, b] of [[0.2, 0.5], [0.5, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]]) { const R = rows.filter((r) => r.f >= a && r.f < b && r.M - r.S > 0.5); console.log(`   ${a.toFixed(2)}-${Math.min(b, 1).toFixed(2)}: ${String(R.length).padStart(3)} readings, real ${mean(R.map((r) => r.fin - r.S)).toFixed(1)}, expected ${mean(R.map((r) => r.M - r.S)).toFixed(1)}, ratio ${(mean(R.map((r) => r.fin - r.S)) / mean(R.map((r) => r.M - r.S))).toFixed(3)}`); }
// 2. candidate: late in the game only a share c of the raw number's "still to come" is kept; then a mix with FanDuel's line by stretch
const fixRaw = (r, c, from) => (r.f >= from ? r.S + c * (r.M - r.S) : r.M);
const bands = [[0, 0.35], [0.35, 0.62], [0.62, 0.75], [0.75, 0.9], [0.9, 1.01]];
const bandOf = (f) => bands.findIndex(([a, b]) => f >= a && f < b);
const fitW = (R, raw) => bands.map(([a, b]) => { const B = R.filter((r) => r.f >= a && r.f < b); let best = [0.5, 1e9]; for (let w = 0; w <= 1.0001; w += 0.05) { const m = mae(B, (r) => w * raw(r) + (1 - w) * r.L); if (m < best[1] - 1e-9) best = [w, m]; } return B.length >= 15 ? +best[0].toFixed(2) : 0.5; });
const fitC = (R, from) => { const B = R.filter((r) => r.f >= from && r.M - r.S > 0.5); let sxy = 0, sxx = 0; for (const r of B) { sxy += (r.M - r.S) * (r.fin - r.S); sxx += (r.M - r.S) ** 2; } return sxx > 0 ? sxy / sxx : 1; };
const report = (label, FIT, TEST) => {
  const c = fitC(FIT, 0.75), raw = (r) => fixRaw(r, c, 0.75), W = fitW(FIT, raw), W0 = fitW(FIT, (r) => r.M);
  const cand = (r) => { const w = W[bandOf(r.f)]; return w * raw(r) + (1 - w) * r.L; }, reW = (r) => { const w = W0[bandOf(r.f)]; return w * r.M + (1 - w) * r.L; };
  console.log(`\n${label}: fitted on ${FIT.length} readings (share kept late ${c.toFixed(3)}; mix by stretch ${W.join(' / ')}), checked on ${TEST.length}`);
  console.log(`   on the check games: FanDuel ${mae(TEST, (r) => r.L).toFixed(3)} | raw ${mae(TEST, (r) => r.M).toFixed(3)} | shown now ${mae(TEST, shownNow).toFixed(3)} (bias ${bias(TEST, shownNow).toFixed(2)}) | new mix only ${mae(TEST, reW).toFixed(3)} | late fix + new mix ${mae(TEST, cand).toFixed(3)} (bias ${bias(TEST, cand).toFixed(2)})`);
  for (const [a, b] of [[0, 0.5], [0.5, 0.75], [0.75, 0.9], [0.9, 1.01]]) { const B = TEST.filter((r) => r.f >= a && r.f < b); if (B.length >= 8) console.log(`      share played ${a.toFixed(2)}-${Math.min(b, 1).toFixed(2)} (${B.length}): FanDuel ${mae(B, (r) => r.L).toFixed(2)} | shown now ${mae(B, shownNow).toFixed(2)} (bias ${bias(B, shownNow).toFixed(2)}) | new ${mae(B, cand).toFixed(2)} (bias ${bias(B, cand).toFixed(2)})`); }
  return { c, W };
};
const cutT = rows[Math.floor(rows.length * 0.55)].t;
report('earlier days → later days', rows.filter((r) => r.t < cutT), rows.filter((r) => r.t >= cutT));
report('later days → earlier days (the mirror)', rows.filter((r) => r.t >= cutT), rows.filter((r) => r.t < cutT));
// leave one day out
{ let sNow = 0, sNew = 0, sFd = 0, n = 0; for (const d of days) { const TEST = rows.filter((r) => day(r) === d), FIT = rows.filter((r) => day(r) !== d); const c = fitC(FIT, 0.75), raw = (r) => fixRaw(r, c, 0.75), W = fitW(FIT, raw); for (const r of TEST) { const w = W[bandOf(r.f)]; sNew += Math.abs(w * raw(r) + (1 - w) * r.L - r.fin); sNow += Math.abs(shownNow(r) - r.fin); sFd += Math.abs(r.L - r.fin); n++; } }
  console.log(`\neach day projected with settings from the other days (${n} readings): FanDuel ${(sFd / n).toFixed(3)} | shown now ${(sNow / n).toFixed(3)} | new ${(sNew / n).toFixed(3)} (${(((sNew / sNow) - 1) * 100).toFixed(1)}%)`); }
const all = report('all days (in sample, for the final settings only)', rows, rows);
