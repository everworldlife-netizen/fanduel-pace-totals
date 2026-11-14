#!/usr/bin/env node
/* late-13: the same floor picture at the end of Q3 (s36): real vs engine remaining minutes by the mean usual minutes of the
 * five on the floor at the Q3 buzzer (mpgOn), for lopsided games; and how many players the dump has on the floor per team. */
'use strict';
const C = require('./late-common');
const season = +process.argv[2] || 2026;
const all = C.load(season);
for (const g of ['s36', 's42']) { const d = {}; const seen = new Set(); for (const r of all) if (r.g === g && !seen.has(r.tg)) { seen.add(r.tg); d[r.nOnT] = (d[r.nOnT] || 0) + 1; } console.log(g, 'projected players on the floor per team-game:', JSON.stringify(d)); }
const rows = all.filter((r) => r.g === 's36' && r.ac0 != null);
function tab(title, S, f, cuts) {
  const out = [];
  for (let i = 0; i <= cuts.length; i++) {
    const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
    const T = S.filter((r) => { const v = f(r); return v != null && v >= lo && v < hi; });
    if (T.length < 20) { out.push(`[${lo},${hi}): n${T.length}`); continue; }
    const e = C.cl(T, (r) => r.erem), a = C.cl(T, (r) => r.rem), gp = C.cl(T, (r) => r.gap);
    out.push(`[${lo},${hi}): eng ${e.mean.toFixed(2)} real ${a.mean.toFixed(2)} z${gp.z.toFixed(1)} n${T.length}`);
  }
  console.log(`  ${title.padEnd(30)} ` + out.join(' | '));
}
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
for (const [lo, hi] of [[0, 10], [11, 15], [16, 20], [21, 25], [26, 99]]) {
  console.log(`\n== s36, |margin| ${lo}-${hi}`);
  for (const ro of ['S', 'B', 'D']) for (const on of [1, 0]) {
    const S = rows.filter((r) => role(r) === ro && r.on === on && Math.abs(r.mg) >= lo && Math.abs(r.mg) <= hi);
    tab(`${ro} ${on ? 'on ' : 'off'}: five-on usual min`, S, (r) => r.mpgOn, [14, 18, 22, 26]);
  }
}
