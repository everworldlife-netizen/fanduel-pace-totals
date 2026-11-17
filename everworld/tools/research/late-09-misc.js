#!/usr/bin/env node
/* late-09: fouls late (4 and 5 fouls at s36 / s42), who closes close games (closing-group history), and comebacks
 * (lead shrinking / growing). Raw engine gap AND plain-refit residual, clustered by team-game. */
'use strict';
const C = require('./late-common'), F = require('./late-fit');
const season = +process.argv[2] || 2026;
const rows = C.load(season);
const fitRows = season === 2026 ? rows : C.load(2026);
const beta = {}; for (const g of ['s36', 's42']) beta[g] = F.fit(fitRows.filter((r) => r.g === g), null).beta;
for (const r of rows) if (beta[r.g]) { r.fitted = F.predict(r, beta[r.g], null); r.res = (r.ac0 != null ? r.ac0 : r.now0) - r.fitted; }
function cell(label, S) {
  if (S.length < 20) { console.log(`  ${label.padEnd(58)} n=${S.length}`); return; }
  const g = C.cl(S, (r) => r.gap), rs = C.cl(S, (r) => r.res), e = C.cl(S, (r) => r.erem), a = C.cl(S, (r) => r.rem);
  console.log(`  ${label.padEnd(58)} n=${String(g.n).padStart(5)} tg=${String(g.G).padStart(4)} engine ${e.mean.toFixed(2)} real ${a.mean.toFixed(2)} | gap ${C.fmt(g.mean, 2)} z ${g.z.toFixed(1).padStart(5)} | after refit ${C.fmt(rs.mean, 2)} z ${rs.z.toFixed(1).padStart(5)}`);
}
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g && r.ac0 != null);
  console.log(`\n== ${g} (${season}) FOULS`);
  for (const pf of [3, 4, 5]) for (const on of [1, 0]) {
    cell(`${pf} fouls, ${on ? 'on' : 'off'}, usual starter, within 10`, A.filter((r) => r.pf === pf && r.on === on && r.st === 1 && Math.abs(r.mg) <= 10));
    cell(`${pf} fouls, ${on ? 'on' : 'off'}, non-starter 14+, within 10`, A.filter((r) => r.pf === pf && r.on === on && r.st !== 1 && r.mpg >= 14 && Math.abs(r.mg) <= 10));
    cell(`${pf} fouls, ${on ? 'on' : 'off'}, anyone, 11+`, A.filter((r) => r.pf === pf && r.on === on && Math.abs(r.mg) >= 11));
  }
  const el = g === 's36' ? 36 : 42;
  cell('5 fouls, last foul in the last 3 min', A.filter((r) => r.pf === 5 && r.pfAt.length && el - r.pfAt[r.pfAt.length - 1] <= 3));
  cell('5 fouls, last foul earlier', A.filter((r) => r.pf === 5 && r.pfAt.length && el - r.pfAt[r.pfAt.length - 1] > 3));
  cell('4 fouls, last foul in the last 3 min, within 10', A.filter((r) => r.pf === 4 && r.pfAt.length && el - r.pfAt[r.pfAt.length - 1] <= 3 && Math.abs(r.mg) <= 10));
  cell('4 fouls, last foul earlier, within 10', A.filter((r) => r.pf === 4 && r.pfAt.length && el - r.pfAt[r.pfAt.length - 1] > 3 && Math.abs(r.mg) <= 10));
  // fouled out share
  { const S = A.filter((r) => r.pf === 5); const lost = S.filter((r) => r.ac && r.remReg < (48 - el) * 0.5).length; console.log(`  5 fouls: ${S.length} players; share on floor ${(S.filter((r) => r.on).length / S.length).toFixed(2)}`); }
  console.log(`== ${g} (${season}) CLOSING GROUP (within 8)`);
  const cl8 = A.filter((r) => Math.abs(r.mg) <= 8);
  for (const tag of ['A', 'X']) {
    for (const on of [1, 0]) for (const [lo, hi] of [[0, 0.15], [0.15, 0.4], [0.4, 0.7], [0.7, 1.01]]) cell(`window ${tag}: ${on ? 'on ' : 'off'} closing share ${lo}-${hi}`, cl8.filter((r) => r['cgN' + tag] >= 2 && r.on === on && r['cgSh' + tag] >= lo && r['cgSh' + tag] < hi));
    for (const on of [1, 0]) for (const [lo, hi] of [[1, 3], [4, 5], [6, 7], [8, 20]]) cell(`window ${tag}: ${on ? 'on ' : 'off'} closing rank ${lo}-${hi}`, cl8.filter((r) => r['cgN' + tag] >= 2 && r.on === on && r['cgRk' + tag] >= lo && r['cgRk' + tag] <= hi));
  }
  console.log(`== ${g} (${season}) COMEBACKS: usual starters, by margin now and the swing over the last 6 minutes`);
  for (const [lo, hi] of [[11, 15], [16, 20], [21, 30]]) for (const sg of [1, -1]) for (const on of [1, 0]) {
    for (const [a, b, nm] of [[-99, -6, 'margin moved 6+ against'], [-5, 5, 'steady'], [6, 99, 'moved 6+ in favour']]) cell(`${sg > 0 ? 'lead' : 'trail'} ${lo}-${hi} ${on ? 'on ' : 'off'} ${nm}`, A.filter((r) => r.st === 1 && r.on === on && Math.sign(r.mg) === sg && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi && r.d6 >= a && r.d6 <= b));
  }
  console.log(`== ${g} (${season}) was bigger: games within 12 now that had been a 20+ lead/deficit`);
  cell('starter on, own lead was 20+, now within 12', A.filter((r) => r.st === 1 && r.on && Math.abs(r.mg) <= 12 && r.mMax >= 20));
  cell('starter off, own lead was 20+, now within 12', A.filter((r) => r.st === 1 && !r.on && Math.abs(r.mg) <= 12 && r.mMax >= 20));
  cell('starter on, was down 20+, now within 12', A.filter((r) => r.st === 1 && r.on && Math.abs(r.mg) <= 12 && r.mMin <= -20));
  cell('starter off, was down 20+, now within 12', A.filter((r) => r.st === 1 && !r.on && Math.abs(r.mg) <= 12 && r.mMin <= -20));
}
