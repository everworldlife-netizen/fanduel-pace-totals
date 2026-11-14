#!/usr/bin/env node
/* late-20: the s42 state anchors one by one. For each state (on/off x margin class x floor unit x role): rows, team-games,
 * engine vs real remaining (mean and middle), the raw gap with z, the L1 and L2 lines fitted on the first half, and the
 * state's own contribution to the second-half miss (10+ minute players): before -> after, and the share of the stage miss. */
'use strict';
const C = require('./late-common'), AN = require('./late-anchor');
const stage = process.argv[2] || 's42';
const rows = C.load(2026).filter((r) => r.ac0 != null && r.g === stage), rows27 = C.load(2027).filter((r) => r.ac0 != null && r.g === stage);
const am = (r) => Math.abs(r.mg);
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
const mc = (r) => (am(r) <= 10 ? 'close' : am(r) <= 15 ? 'mid' : 'dec');
const unit = (r) => (r.mpgOn < 20 ? 'flag' : 'reg');
const stF = (r) => `${r.on ? 'on ' : 'off'} ${mc(r)}${mc(r) === 'dec' ? '/' + unit(r) : ''} ${role(r)}`;
const { A: h1, B: h2 } = C.splitByDate(rows);
const L1 = AN.fit(h1, stF, { kind: 'L1' }), L2 = AN.fit(h1, stF, { kind: 'L2' }), L1all = AN.fit(rows, stF, { kind: 'L1' });
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const T2 = h2.filter(C.p10); const tot = T2.reduce((s, r) => s + Math.abs(r.ac0 - r.mn0), 0);
console.log(`${stage}: second-half miss ${ (tot / T2.length).toFixed(3)} on ${T2.length} player-games`);
console.log('state                 rows   tg  | engine  real(mean / middle) | gap    z   | 2027 gap (n) | L1 line a+b*e | L2 line | H2 miss in state: engine -> L1 line -> L2 line | share of stage miss removed (L1)');
const keys = [...new Set(rows.map(stF))].sort();
let sumGain = 0;
for (const k of keys) {
  const S = rows.filter((r) => stF(r) === k); if (S.length < 60) continue;
  const g = C.cl(S, (r) => r.gap), e = C.cl(S, (r) => r.erem).mean, a = C.cl(S, (r) => r.rem).mean, md = med(S.map((r) => r.rem));
  const S27 = rows27.filter((r) => stF(r) === k), g27 = S27.length ? C.cl(S27, (r) => r.gap) : null;
  const l1 = L1.get(k), l2 = L2.get(k);
  const T = T2.filter((r) => stF(r) === k);
  const m0 = T.reduce((s, r) => s + Math.abs(r.ac0 - r.mn0), 0), m1 = T.reduce((s, r) => s + Math.abs(r.ac0 - AN.predict(r, L1, stF)), 0), m2 = T.reduce((s, r) => s + Math.abs(r.ac0 - AN.predict(r, L2, stF)), 0);
  sumGain += m0 - m1;
  console.log(`${k.padEnd(20)} ${String(S.length).padStart(5)} ${String(g.G).padStart(4)} | ${e.toFixed(2).padStart(5)}  ${a.toFixed(2).padStart(5)} / ${md.toFixed(2).padStart(4)}  | ${C.fmt(g.mean, 2).padStart(5)} ${g.z.toFixed(1).padStart(6)} | ${g27 ? C.fmt(g27.mean, 2) + ' (' + g27.n + ')' : '-'} | ${l1 ? l1[0].toFixed(2) + '+' + l1[1].toFixed(2) + 'e' : '-'} | ${l2 ? l2[0].toFixed(2) + '+' + l2[1].toFixed(2) + 'e' : '-'} | ${T.length ? (m0 / T.length).toFixed(2) + ' -> ' + (m1 / T.length).toFixed(2) + ' -> ' + (m2 / T.length).toFixed(2) : '-'} (n ${T.length}) | ${(100 * (m0 - m1) / tot).toFixed(2)}%`);
}
console.log(`total share removed (L1 lines): ${(100 * sumGain / tot).toFixed(2)}%`);
