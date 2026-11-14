#!/usr/bin/env node
/* late-07: end of Q3 (s36). Shape of the plain-refit residual by usual minutes, floor state, Q3 pattern, in games within 15. */
'use strict';
const C = require('./late-common'), F = require('./late-fit');
const rows = C.load(2026);
const A = rows.filter((r) => r.g === 's36'); const o = F.fit(A, null);
for (const r of A) { r.fitted = F.predict(r, o.beta, null); r.res = (r.ac0 != null ? r.ac0 : r.now0) - r.fitted; }
function table(title, S, f, cuts) {
  const out = [];
  for (let i = 0; i <= cuts.length; i++) {
    const lo = i ? cuts[i - 1] : -Infinity, hi = i < cuts.length ? cuts[i] : Infinity;
    const T = S.filter((r) => { const v = f(r); return v != null && v >= lo && v < hi; });
    if (T.length < 25) { out.push(`[${lo},${hi}): n${T.length}`); continue; }
    const c = C.cl(T, (r) => r.res), e = C.cl(T, (r) => r.fitted - r.now0), a = C.cl(T, (r) => r.rem);
    out.push(`[${lo},${hi}): ${C.fmt(c.mean, 2)} z${c.z.toFixed(1)} (${e.mean.toFixed(1)}->${a.mean.toFixed(1)} n${c.n})`);
  }
  console.log(`  ${title.padEnd(36)} ` + out.join(' | '));
}
const close = A.filter((r) => Math.abs(r.mg) <= 15);
console.log('== s36, games within 15');
table('usual minutes (all)', close, (r) => r.mpg, [6, 10, 14, 18, 21, 24, 27, 30, 33]);
table('usual minutes (on at Q3 end)', close.filter((r) => r.on), (r) => r.mpg, [6, 10, 14, 18, 21, 24, 27, 30, 33]);
table('usual minutes (off at Q3 end)', close.filter((r) => !r.on), (r) => r.mpg, [6, 10, 14, 18, 21, 24, 27, 30, 33]);
table('minutes tonight (mpg 14-24)', close.filter((r) => r.mpg >= 14 && r.mpg < 24), (r) => r.now0, [8, 12, 16, 20, 24]);
table('minutes tonight - usual pace (14-24)', close.filter((r) => r.mpg >= 14 && r.mpg < 24), (r) => r.now0 - r.mpg * 0.75, [-6, -3, 0, 3, 6]);
table('minutes tonight - usual pace (S)', close.filter((r) => r.st === 1), (r) => r.now0 - r.mpg * 0.75, [-6, -3, 0, 3, 6]);
table('minutes tonight - usual pace (<14)', close.filter((r) => r.mpg < 14), (r) => r.now0 - r.mpg * 0.75, [-3, 0, 3, 6]);
table('Q3 minutes (14-24)', close.filter((r) => r.mpg >= 14 && r.mpg < 24), (r) => r.q3, [0.01, 3, 6, 9]);
table('Q3 minutes (S)', close.filter((r) => r.st === 1), (r) => r.q3, [3, 6, 8, 10, 11.9]);
table('Q3 minutes (<14)', close.filter((r) => r.mpg < 14), (r) => r.q3, [0.01, 2, 4, 6]);
table('started tonight & not usual starter', close.filter((r) => r.st !== 1), (r) => r.sT, [0.5]);
table('usual starter: started tonight', close.filter((r) => r.st === 1), (r) => r.sT, [0.5]);
table('sat for (S off)', close.filter((r) => r.st === 1 && !r.on), (r) => r.sitFor, [1, 2, 3, 4, 6, 9, 12]);
table('sat for (B off)', close.filter((r) => r.st !== 1 && r.mpg >= 14 && !r.on), (r) => r.sitFor, [1, 2, 3, 4, 6, 9, 12, 18]);
table('sat for (D off)', close.filter((r) => r.mpg < 14 && !r.on), (r) => r.sitFor, [2, 4, 6, 9, 12, 18]);
table('stint so far (S on)', close.filter((r) => r.st === 1 && r.on), (r) => r.stintNow, [2, 4, 6, 9, 11.9]);
table('stint so far (B on)', close.filter((r) => r.st !== 1 && r.mpg >= 14 && r.on), (r) => r.stintNow, [2, 4, 6, 9, 11.9]);
table('fouls (S)', close.filter((r) => r.st === 1), (r) => r.pf, [2, 3, 4, 5]);
table('fouls (B)', close.filter((r) => r.st !== 1 && r.mpg >= 14), (r) => r.pf, [2, 3, 4, 5]);
table('closing share X (S)', close.filter((r) => r.st === 1), (r) => (r.cgNX ? r.cgShX : null), [0.2, 0.4, 0.6, 0.8]);
table('closing share X (B)', close.filter((r) => r.st !== 1 && r.mpg >= 14), (r) => (r.cgNX ? r.cgShX : null), [0.1, 0.25, 0.4, 0.6]);
table('closing share A (B)', close.filter((r) => r.st !== 1 && r.mpg >= 14), (r) => (r.cgNA ? r.cgShA : null), [0.1, 0.25, 0.4, 0.6]);
table('closing share X (D)', close.filter((r) => r.mpg < 14), (r) => (r.cgNX ? r.cgShX : null), [0.05, 0.15, 0.3]);
table('games in log (gms)', close, (r) => r.gms, [2, 4, 6, 8]);
console.log('== s36, 16+ games');
const lop = A.filter((r) => Math.abs(r.mg) >= 16);
table('usual minutes (lead)', lop.filter((r) => r.mg > 0), (r) => r.mpg, [6, 10, 14, 18, 21, 24, 27, 30, 33]);
table('usual minutes (trail)', lop.filter((r) => r.mg < 0), (r) => r.mpg, [6, 10, 14, 18, 21, 24, 27, 30, 33]);
table('minutes tonight (<14)', lop.filter((r) => r.mpg < 14), (r) => r.now0, [3, 6, 9, 12, 16]);
table('|margin| (<14)', lop.filter((r) => r.mpg < 14), (r) => Math.abs(r.mg), [19, 22, 26, 31]);
table('|margin| (S on)', lop.filter((r) => r.st === 1 && r.on), (r) => Math.abs(r.mg), [19, 22, 26, 31]);
table('|margin| (S off)', lop.filter((r) => r.st === 1 && !r.on), (r) => Math.abs(r.mg), [19, 22, 26, 31]);
table('S off: sat for', lop.filter((r) => r.st === 1 && !r.on), (r) => r.sitFor, [1, 2, 3, 4, 6, 9, 12]);
table('S off 21+: sat for', lop.filter((r) => r.st === 1 && !r.on && Math.abs(r.mg) >= 21), (r) => r.sitFor, [1, 2, 3, 4, 6, 9, 12]);
table('S: swing in Q3 (lead)', lop.filter((r) => r.st === 1 && r.mg > 0), (r) => r.mg - r.m24, [-5, 0, 5, 10, 15]);
table('S: swing last 6 (lead)', lop.filter((r) => r.st === 1 && r.mg > 0), (r) => r.d6, [-6, -2, 2, 6]);
table('S: swing last 6 (trail)', lop.filter((r) => r.st === 1 && r.mg < 0), (r) => r.d6, [-6, -2, 2, 6]);
