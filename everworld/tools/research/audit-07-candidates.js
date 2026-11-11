#!/usr/bin/env node
'use strict';
/* Audit, step 7: candidate inputs for MINUTES, tested next to the 49 existing inputs in the engine's own form
 *     real final - engine final  ~  engine remaining minutes x (b . inputs)
 * For each stage and each candidate set (added on top of a base set):
 *   - coefficient and cluster-robust z on all of 2026 (games as clusters), and the same regression run on 2027 alone (sign and size)
 *   - gain: fitted on the first half of 2026, scored on the second half (players with 10+ real minutes, and every graded row),
 *     against the base set fitted the same way; and fitted on all of 2026, scored on 2027.
 *   node tools/research/audit-07-candidates.js [set ...]       sets: calib calibRole endgame trailB startFloor ...
 */
const C = require('./audit-common');
const REG = require('./audit-reg');
const IX = C.IX;
const D26 = C.load(2026), D27 = C.load(2027);
const wMin = (r) => (r._remE >= 0.25 ? r._remE : 0);
const live = (r) => r._s >= 2;
const yMin = (r) => (r._played || live(r) ? r._d[0] : null);
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const left = (r) => 48 - r.el;
const benchT = (r) => (r.sT == null ? (r.st === 1 ? 0 : 1) : r.sT === 0 ? 1 : 0); // comes off the bench tonight (before lineups: usual role)
const off = (r) => (live(r) && !r.on && !r.dnp ? 1 : 0);
const Lop = (r) => cl((Math.abs(r.mg) - 8) / 10, 0, 2.5); // how lopsided (the engine's own scale)
const Clo = (r) => cl((8 - Math.abs(r.mg)) / 8, 0, 1); // how close
const IN = {
  thin: (r) => Math.min(3 / Math.max(r._remE, 0.25), 6),
  full: (r) => r._remE / left(r) - 0.5,
  thinB: (r) => benchT(r) * Math.min(3 / Math.max(r._remE, 0.25), 6),
  fullB: (r) => benchT(r) * (r._remE / left(r) - 0.5),
  benchT: (r) => benchT(r),
  // end-game script: who is on the floor x how decided / how close the game is, by role
  doneS: (r) => (r.st === 1 ? off(r) * Lop(r) : 0), // usual starter sitting in a decided game
  stayB: (r) => (r.st !== 1 && r.on ? Lop(r) : 0), // reserve on the floor in a decided game
  backS: (r) => (r.st === 1 ? off(r) * Clo(r) : 0), // usual starter sitting in a close game
  outB: (r) => (r.st !== 1 && r.on ? Clo(r) : 0), // reserve on the floor in a close game
  trailB: (r) => (r.st !== 1 ? cl((-r.mg - 8) / 10, 0, 2.5) : 0), // reserve on the trailing side
  leadB: (r) => (r.st !== 1 ? cl((r.mg - 8) / 10, 0, 2.5) : 0),
  // a reserve who starts tonight finishes near 24 whatever his usual minutes
  startFloor: (r) => (r.st !== 1 && r.sT === 1 ? cl((24 - r.mn[0]) / Math.max(r._remE, 1), -1, 2.5) : 0),
  sixth: (r) => (r.st === 1 && r.sT === 0 ? 1 : 0), // 24+ usual minutes but off the bench tonight
  b2bLive: (r) => (live(r) ? r._b2b : 0),
  b2bLiveS: (r) => (live(r) && r.st === 1 ? r._b2b : 0),
  frLive: (r) => (live(r) && r._fr && !r.dnp ? 1 : 0), // back from a layoff and has checked in
  octNov: (r) => (r.d.slice(5, 7) === '10' || r.d.slice(5, 7) === '11' ? 1 : 0),
  april: (r) => (r.d.slice(5, 7) === '04' ? 1 : 0),
  aprilS: (r) => (r.d.slice(5, 7) === '04' && r.st === 1 ? 1 : 0),
  hot: (r) => (r._hot != null ? cl(r._hot, -2, 2.5) : 0),
  hotB: (r) => (r._hot != null && r.st !== 1 ? cl(r._hot, -2, 2.5) : 0),
  pf0: (r) => (live(r) && r.pf === 0 && r.now[0] >= 3 ? 1 : 0),
  favLate: (r) => (r._fav != null && r.el >= 33 ? cl(r._fav / 10, -2, 2) * (r.st === 1 ? 1 : -1) : 0),
  ldLateB: (r) => (r._ld != null && r.el >= 33 && r.st !== 1 ? r._ld : 0),
  ldLateS: (r) => (r._ld != null && r.el >= 33 && r.st === 1 ? r._ld : 0),
  homeB: (r) => (r.hm && r.st !== 1 ? 1 : 0),
  within2S: (r) => (live(r) && Math.abs(r.mg) <= 2 && r.st === 1 ? 1 : 0),
  onS: (r) => (r.on && r.st === 1 ? 1 : 0),
  onB: (r) => (r.on && r.st !== 1 ? 1 : 0),
};
const SETS = { // name: [base inputs, added inputs, stages]
  calib: [[], ['thin', 'full'], C.STAGES],
  calibRole: [['thin', 'full'], ['thinB', 'fullB', 'benchT'], C.STAGES],
  endgame: [[], ['doneS', 'stayB', 'backS', 'outB'], ['s30', 's36', 's42']],
  endgameC: [['thin', 'full'], ['doneS', 'stayB', 'backS', 'outB'], ['s30', 's36']],
  trailB: [['thin', 'full'], ['trailB'], ['s12', 's18', 's24', 's30', 's36']],
  trailB42: [[], ['trailB'], ['s42']],
  startFloor: [['thin', 'full'], ['startFloor'], ['pre', 's6', 's12', 's18', 's24']],
  sixth: [['thin', 'full'], ['sixth'], ['pre', 's6', 's12', 's18', 's24', 's30']],
  b2b: [['thin', 'full'], ['b2bLive', 'b2bLiveS'], ['s6', 's12', 's18', 's24', 's30', 's36']],
  fr: [['thin', 'full'], ['frLive'], ['s6', 's12', 's18', 's24', 's30', 's36']],
  cal: [['thin', 'full'], ['octNov', 'april', 'aprilS'], C.STAGES.filter((s) => s !== 's42')],
  hot: [['thin', 'full'], ['hotB'], ['s6', 's12', 's18', 's24', 's30', 's36']],
  pf0: [['thin', 'full'], ['pf0'], ['s6', 's12', 's18', 's24', 's30', 's36']],
  late: [[], ['favLate', 'ldLateB', 'ldLateS'], ['s36', 's42']],
  onRole: [['thin', 'full'], ['onB'], ['s6', 's12', 's18', 's24', 's30', 's36']],
  onRole42: [[], ['onB'], ['s42']],
};
const CAPLO = +(process.env.AUDIT_CAPLO || -0.6);
const want = process.argv.slice(2).length ? process.argv.slice(2) : ['calib'];
const xOf = (names) => (r) => { const x = r.x.slice(); for (const n of names) x.push(IN[n](r)); return x; };
const fmt = (c) => `${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)})`;
for (const setName of want) {
  const [base, add, stages] = SETS[setName];
  console.log(`\n######## ${setName}: base = 49 inputs${base.length ? ' + ' + base.join(', ') : ''}; candidate = ${add.join(', ')}${CAPLO !== -0.6 ? '; lower cap ' + CAPLO : ''}`);
  for (const g of stages) {
    const r26 = D26.rows.filter((r) => r.g === g), r27 = D27.rows.filter((r) => r.g === g);
    const xB = xOf(base), xC = xOf(base.concat(add)), nb = 49 + base.length;
    const full26 = REG.fit(r26, wMin, yMin, xC, 49), full27 = REG.fit(r27, wMin, yMin, xC, 49);
    const pred = (m, xf) => (r) => { const w = wMin(r); return w > 0 ? Math.max(r.mn[0] + w * cl(REG.dot(m.beta, xf(r)), CAPLO, 1.5), r.now[0]) : r.mn[0]; };
    const line = [];
    for (const [nm, tr, te, nG] of [['2nd half 2026', r26.filter((r) => r._half === 0), r26.filter((r) => r._half === 1), D26.nGames], ['2027', r26, r27, D27.nGames]]) {
      const mB = REG.fit(tr, wMin, yMin, xB, 49, { se: false }), mC = REG.fit(tr, wMin, yMin, xC, 49, { se: false });
      const t10 = te.filter((r) => r._p10), tG = te.filter((r) => yMin(r) != null);
      const a = REG.compare(t10, nG, (r) => r.mn[0], pred(mB, xB)), c10 = REG.compare(t10, nG, pred(mB, xB), pred(mC, xC)), cG = REG.compare(tG, nG, pred(mB, xB), pred(mC, xC));
      line.push(`${nm}: engine ${a.a.toFixed(3)} base ${a.b.toFixed(3)} -> ${c10.b.toFixed(3)} = ${fmt(c10)} on 10+; all graded ${fmt(cG)}`);
    }
    console.log(`${g.padEnd(4)} ` + add.map((n, i) => { const tgs = new Set(); let rows = 0; for (const r of r26) { if (IN[n](r) && yMin(r) != null && wMin(r) > 0) { rows++; tgs.add(r.id + ':' + r.tm); } } return `${n}: b ${full26.beta[nb + i].toFixed(3)} z ${full26.z[nb + i].toFixed(1)} [2027 b ${full27.beta[nb + i].toFixed(3)} z ${full27.z[nb + i].toFixed(1)}] (${rows} rows, ${tgs.size} team-games)`; }).join(' | '));
    for (const l of line) console.log('       ' + l);
  }
}
