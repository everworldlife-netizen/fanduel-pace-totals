#!/usr/bin/env node
/* early-09: price each candidate input the way the engine would use it: one more column in the learned minutes layer.
 * Taught on the first half of 2026 (by date), tested on the second half; and taught on all of 2026, tested on 2026-27.
 * Baseline = the same 49 inputs taught the same way on the same games (so the gain is the input's, not the re-teaching's).
 * Two teaching rules: 'all' = everyone listed (the engine's live rule), 'played' = players who played (the tip-off rule).
 *   node tools/research/early-09-price.js [s6|s12] [lam] */
'use strict';
const C = require('./early-common');
const Fx = require('./early-fit');
const ST = process.argv[2] || 's6'; const EL = ST === 's6' ? 6 : 12; const lam = +(process.argv[3] || 8);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const FEATS = {
  earlyIn: (o, r, f) => (o.pre.sT === 0 && r.dnp === 0 && f.nB >= 2 && f['tIn' + EL] != null ? clamp((f.ciBMed - f['tIn' + EL]) / 6, 0, 2) : 0),
  neverBy: (o, r, f) => (o.pre.sT === 0 && r.dnp === 0 && f.nB >= 2 && f['pInB' + EL] === 0 ? 1 : 0),
  demotedWait: (o, r, f) => (o.pre.sT === 0 && r.dnp === 1 && f.nP >= 2 && f.startShare >= 0.5 ? f.startShare : 0),
  benchUsed: (o, r, f) => (o.pre.sT === 0 && r.dnp === 1 ? clamp(f['nBenchIn' + EL] / 2, 0, 2.5) : 0),
  passed: (o, r, f) => (o.pre.sT === 0 && r.dnp === 1 ? clamp(f['passed' + EL], 0, 2) : 0),
  lastOut: (o, r, f) => (o.pre.sT === 0 && r.dnp === 1 && f.nT >= 1 && f.lastPlayed[0] === '0' ? 1 : 0),
  last2Out: (o, r, f) => (o.pre.sT === 0 && r.dnp === 1 && f.nT >= 2 && f.lastPlayed.slice(0, 2) === '00' ? 1 : 0),
  regular: (o, r, f) => (o.pre.sT === 0 && r.dnp === 1 && f.nT >= 4 && f.nP === f.nT ? 1 : 0),
  resStart: (o, r, f) => (o.pre.sT === 1 && f.nP >= 2 ? clamp(1 - f.startShare, 0, 1) : 0),
  foulSit: (o, r, f) => (o.pre.sT === 1 && r.pf >= 2 && r.on === 0 ? 1 : 0),
  foulOn: (o, r, f) => (o.pre.sT === 1 && r.pf >= 2 && r.on === 1 ? 1 : 0),
  onX: (o, r, f) => (o.pre.sT === 1 && f['pOnS' + EL] != null ? r.on - f['pOnS' + EL] : 0),
  anchor: (o, r, f) => clamp((o.pre.mn[0] - r.mp) / Math.max(r.mp - r.now[0], 2), -1.5, 1.5),
  anchorS: (o, r, f) => (o.pre.sT === 1 ? clamp((o.pre.mn[0] - r.mp) / Math.max(r.mp - r.now[0], 2), -1.5, 1.5) : 0),
  anchorI: (o, r, f) => (o.pre.sT === 0 && r.dnp === 0 ? clamp((o.pre.mn[0] - r.mp) / Math.max(r.mp - r.now[0], 2), -1.5, 1.5) : 0),
  anchorN: (o, r, f) => (o.pre.sT === 0 && r.dnp === 1 ? clamp((o.pre.mn[0] - r.mp) / Math.max(r.mp - r.now[0], 2), -1.5, 1.5) : 0),
  lowStart: (o, r, f) => (o.pre.sT === 1 ? clamp((24 - o.pre.mpg) / 6, 0, 2) : 0),
  lowStartReg: (o, r, f) => (o.pre.sT === 1 && f.nP >= 2 && f.startShare >= 0.7 ? clamp((24 - o.pre.mpg) / 6, 0, 2) : 0),
  trailB: (o, r, f) => (o.pre.sT === 0 ? clamp((-r.mg - 6) / 10, 0, 2) : 0),
};
const SETS = [['earlyIn'], ['neverBy'], ['earlyIn', 'neverBy'], ['demotedWait'], ['benchUsed'], ['passed'], ['lastOut'], ['last2Out'], ['regular'], ['lastOut', 'regular', 'benchUsed'], ['resStart'], ['lowStart'], ['lowStartReg'], ['lowStart', 'resStart'], ['foulSit'], ['foulSit', 'foulOn'], ['onX'], ['trailB'], ['anchor'], ['anchorS', 'anchorI', 'anchorN'],
  ['earlyIn', 'neverBy', 'demotedWait', 'resStart', 'foulSit', 'onX'], ['earlyIn', 'neverBy', 'demotedWait', 'resStart', 'foulSit', 'onX', 'lastOut', 'regular', 'benchUsed'], ['earlyIn', 'neverBy', 'demotedWait', 'resStart', 'foulSit', 'onX', 'lastOut', 'regular', 'benchUsed', 'anchorS', 'anchorI', 'anchorN']];
const names = Object.keys(FEATS);
const extra = (o, st) => names.map((k) => FEATS[k](o, o[st], o.f));
const a26 = C.load('2026'), a27 = C.load('2027');
const r26 = Fx.prep(a26, ST, extra), r27 = Fx.prep(a27, ST, extra);
const dates = [...new Set(a26.map((o) => o.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const H1 = r26.filter((q) => q.d < mid), H2 = r26.filter((q) => q.d >= mid);
const base = Array.from({ length: 49 }, (_, i) => i);
const pct = (c) => `${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(2)}% (${c.z.toFixed(1)})`.padEnd(15);
console.log(`stage ${ST}, lam ${lam}. Each cell: change in average miss vs the 49-input baseline taught the same way (z by team-game). Negative = better.`);
for (const rule of ['all', 'played']) {
  const b0 = Fx.fit(H1, rule, lam, base), b0f = Fx.fit(r26, rule, lam, base);
  const p0 = (q) => Fx.predict(q, b0.beta), p0f = (q) => Fx.predict(q, b0f.beta);
  const e0 = Fx.compare(H2, (q) => q.eng, p0, Fx.POPS['10+']), e07 = Fx.compare(r27, (q) => q.eng, p0f, Fx.POPS['10+']);
  const l0 = Fx.compare(H2, (q) => q.eng, p0, Fx.POPS.listed), l07 = Fx.compare(r27, (q) => q.eng, p0f, Fx.POPS.listed);
  console.log(`\n=== teaching rule: ${rule} === baseline miss, 2nd half 2026: 10+ ${e0.b.toFixed(3)} (engine ${e0.a.toFixed(3)}), listed ${l0.b.toFixed(3)} (engine ${l0.a.toFixed(3)}) | 2027: 10+ ${e07.b.toFixed(3)} (engine ${e07.a.toFixed(3)}), listed ${l07.b.toFixed(3)} (engine ${l07.a.toFixed(3)})`);
  console.log('inputs added'.padEnd(44) + '| 2nd half 2026: 10+        played         listed        | 2027: 10+           listed        | coefficient(s) (fit on all 2026)');
  for (const set of SETS) {
    const cols = base.concat(set.map((k) => 49 + names.indexOf(k)));
    const b1 = Fx.fit(H1, rule, lam, cols), b1f = Fx.fit(r26, rule, lam, cols);
    const p1 = (q) => Fx.predict(q, b1.beta), p1f = (q) => Fx.predict(q, b1f.beta);
    const c = ['10+', 'played', 'listed'].map((pn) => Fx.compare(H2, p0, p1, Fx.POPS[pn]));
    const c7 = ['10+', 'listed'].map((pn) => Fx.compare(r27, p0f, p1f, Fx.POPS[pn]));
    console.log(set.join('+').slice(0, 43).padEnd(44) + '| ' + c.map(pct).join('') + '| ' + c7.map(pct).join('') + '| ' + (set.length <= 4 ? set.map((k) => b1f.beta[49 + names.indexOf(k)].toFixed(3)).join(' ') : ''));
  }
}
