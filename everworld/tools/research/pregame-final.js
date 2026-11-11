#!/usr/bin/env node
/* Pregame research, the final table (stages rep and pre).
 *
 * Everything is measured the way an engineer would use it: the signals are added to a refit of the engine's own learned
 * inputs, on the engine's PLAIN minutes (the number before the learned layer; it does not depend on which lessons a dump
 * was made with).
 *   target   y = real minutes - plain minutes, players who played
 *   controls K = 1, starter, under-18-a-game, and every learned input that moves at the stage times plain minutes / 24
 *                (= what the learned layer can already say once its lessons are refit)
 * 1. 2026 (discovery): y ~ K + all signals. Joint slope and cluster-robust z (cluster = game) per signal.
 * 2. 2027 (confirmation only): y ~ K + level signals + the one signal, on the 2027 games. Slope and z.
 * 3. Gain on 2026: fit on the first half by date, apply to the second half. Average absolute miss of the minutes number,
 *    players with 10+ real minutes: the engine as it is, a refit of the existing inputs, then signal blocks one by one.
 * 4. Across seasons: fit on all of 2026, apply to 2027 (lessons, signals and all), same ladder.
 *   node tools/research/pregame-final.js
 */
'use strict';
const path = require('path');
const L = require('../lib');
const C = require('./pregame-common');
const CAND = require('./pregame-cands')(2026);
const nb = (r) => (r.st === 1 ? 0 : 1);
const v0 = (x) => (x == null || !isFinite(x) ? 0 : x);
const c = (k) => (r) => v0(CAND[k](r));

const BLOCKS = [
  ['move back to his own average', [['moveBack', c('moveBack'), 'rep,pre']]],
  ['long memory', [['longGap5', c('longGap5'), 'rep,pre']]],
  ['4th-quarter minutes count less', [['q4x', c('q4-quarter'), 'rep,pre']]],
  ['who is available', [['outTotB', (r) => (v0(r.f.outTot) * nb(r)) / 10, 'rep,pre'], ['outSameB', (r) => (v0(r.f.outSame) * nb(r)) / 10, 'rep,pre'], ['availB', (r) => (r.f.availN != null ? (r.f.availN - 12) * nb(r) : 0), 'rep,pre'],
    ['dressShort', (r) => (r.f.activeCount != null ? Math.max(12 - r.f.activeCount, 0) : 0), 'pre'], ['crowdB', (r) => (r.f.activeCount != null ? Math.max(r.f.activeCount - 13, 0) * nb(r) : 0), 'pre']]],
  ['first game back', [['firstBack', c('firstBack'), 'rep,pre'], ['restDays>3', c('restDays>3'), 'rep,pre']]],
  ['last game, by role', [['l1S', (r) => v0(r.f.l1) * (1 - nb(r)), 'rep,pre'], ['l1B', (r) => v0(r.f.l1) * nb(r), 'rep,pre']]],
  ['starting history', [['startDrift', c('startDrift'), 'rep'], ['lowMinStarter', c('lowMinStarter'), 'rep,pre']]],
  ['team form (reserves)', [['teamMargin8B', (r) => v0(r.f.teamMargin8) * nb(r), 'rep,pre']]],
  ['big spreads (starters)', [['fav>10S', c('fav>10|S'), 'rep,pre']]],
  ['volatility', [['sd8', (r) => v0(r.f.sd8), 'rep,pre']]],
];
const LEVEL = ['moveBack', 'longGap5', 'q4x'];
const termsFor = (g) => BLOCKS.flatMap(([bn, ts]) => ts.filter((t) => t[2].split(',').includes(g)).map((t) => ({ block: bn, name: t[0], fn: t[1] })));
const S26 = C.prepare(2026), S27 = C.prepare(2027);
const liveCols = (rs) => { const live = []; for (let j = 0; j < 49; j++) { let a = Infinity, b = -Infinity; for (const r of rs) { const v = r.x[j]; if (v < a) a = v; if (v > b) b = v; } if (j === 0 || b - a > 1e-9) live.push(j); } return live; };
// miss of a minutes number among players with 10+ real minutes
const miss = (rs, num) => { let s = 0, n = 0; rs.forEach((r, i) => { if (r.ac[0] >= 10) { s += Math.abs(r.ac[0] - num[i]); n++; } }); return s / n; };
const pairedZ = (rs, a, b) => { const G = new Map(); rs.forEach((r, i) => { if (r.ac[0] < 10) return; const q = G.get(r.id) || [0, 0]; q[0] += Math.abs(r.ac[0] - a[i]) - Math.abs(r.ac[0] - b[i]); q[1]++; G.set(r.id, q); }); const d = [...G.values()].map((q) => q[0] / q[1]); return C.mean(d) / (C.sd(d) / Math.sqrt(d.length)); };
const dot = (x, b) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * b[i]; return s; };
const out = {};

for (const g of ['rep', 'pre']) {
  const rs = S26.rows.filter((r) => r.g === g && r.gap != null), r27 = S27.rows.filter((r) => r.g === g && r.gap != null);
  const live = liveCols(rs), live27 = liveCols(r27);
  const T = termsFor(g);
  const K = (r, lv) => { const a = [1, r.st === 1 ? 1 : 0, r.mpg < 18 ? 1 : 0]; for (const j of lv) a.push((r.x[j] * r.mp) / 24); return a; };
  const sig = (r) => T.map((t) => t.fn(r));
  const y = rs.map((r) => r.ac[0] - r.mp), cl = rs.map((r) => r.id);
  const Kx = rs.map((r) => K(r, live)), Sx = rs.map(sig);
  const k0 = Kx[0].length;
  const O = (out[g] = { n: rs.length, games: new Set(cl).size, terms: [] });
  console.log(`\n================ ${g}: ${rs.length} player-games, ${new Set(cl).size} games (2026); ${r27.length} player-games, ${new Set(r27.map((r) => r.id)).size} games (2027) ================`);

  // --- the refill (rep): does what the engine adds after its learned factor show up?
  if (g === 'rep') {
    const m = C.ols(y, rs.map((r, i) => [...Kx[i], ...Sx[i], r.rest]), cl, 1e-3);
    const b = m.beta[m.beta.length - 1], se = m.se[m.se.length - 1];
    const m27 = C.ols(r27.map((r) => r.ac[0] - r.mp), r27.map((r) => [...K(r, live27), ...LEVEL.map((k) => T.find((t) => t.name === k).fn(r)), r.rest]), r27.map((r) => r.id), 1e-3);
    const b27 = m27.beta[m27.beta.length - 1], se27 = m27.se[m27.se.length - 1];
    const big = rs.filter((r) => r.rest >= 1.5);
    console.log(`refill (minutes added after the learned factor): share that shows up ${b.toFixed(2)} (se ${se.toFixed(2)}); as a gap slope ${(b - 1).toFixed(2)}, z ${((b - 1) / se).toFixed(1)}; rows with 1.5+ added ${big.length}, team-games ${new Set(big.map((r) => r.tgk)).size}, their gap ${C.mean(big.map((r) => r.gap)).toFixed(2)}`);
    console.log(`   2027: share ${b27.toFixed(2)} (se ${se27.toFixed(2)}); gap slope ${(b27 - 1).toFixed(2)}, z ${((b27 - 1) / se27).toFixed(1)}`);
    O.refill = { share: b, slope: b - 1, z: (b - 1) / se, rows: big.length, teamGames: new Set(big.map((r) => r.tgk)).size, gapBig: C.mean(big.map((r) => r.gap)), slope27: b27 - 1, z27: (b27 - 1) / se27 };
  }
  // --- 1. joint model on 2026
  const X = rs.map((r, i) => [...Kx[i], ...Sx[i]]);
  const m = C.ols(y, X, cl, 1e-3);
  // --- 2. 2027, one signal at a time on top of controls + level signals
  const y27 = r27.map((r) => r.ac[0] - r.mp), cl27 = r27.map((r) => r.id);
  const K27 = r27.map((r) => K(r, live27));
  const lvl27 = r27.map((r) => LEVEL.map((k) => T.find((t) => t.name === k).fn(r)));
  console.log('signal            block                            slope      z   nonzero rows  team-games | 2027 slope      z   team-games');
  T.forEach((t, i) => {
    const nzr = rs.filter((r) => t.fn(r) !== 0).length; const tgs = new Set(); for (const r of rs) if (t.fn(r) !== 0) tgs.add(r.tgk);
    const v = r27.map((r) => t.fn(r)); const tg27 = new Set(); r27.forEach((r, q) => { if (v[q] !== 0) tg27.add(r.tgk); });
    let s27 = null, z27 = null;
    if (tg27.size >= 8) { const li = LEVEL.indexOf(t.name); const X27 = r27.map((r, q) => [...K27[q], ...lvl27[q].filter((_, w) => w !== li), v[q]]); try { const o = C.ols(y27, X27, cl27, 1e-3); s27 = o.beta[o.beta.length - 1]; z27 = o.z[o.z.length - 1]; } catch (e) { /* */ } }
    console.log(`${t.name.padEnd(17)} ${t.block.padEnd(30)} ${m.beta[k0 + i].toFixed(3).padStart(7)} ${m.z[k0 + i].toFixed(1).padStart(6)}   ${String(nzr).padStart(8)}   ${String(tgs.size).padStart(8)}    | ${s27 == null ? '  too few' : s27.toFixed(3).padStart(8)} ${z27 == null ? '' : z27.toFixed(1).padStart(6)}   ${String(tg27.size).padStart(6)}`);
    O.terms.push({ name: t.name, block: t.block, slope: m.beta[k0 + i], z: m.z[k0 + i], rows: nzr, teamGames: tgs.size, slope27: s27, z27, teamGames27: tg27.size });
  });
  // --- ceiling: after everything, is a high number still too high? (second step on the fitted number)
  const fit26 = rs.map((r, i) => r.mp + dot(X[i], m.beta));
  const ceilAt = 35;
  { const res = rs.map((r, i) => r.ac[0] - fit26[i]); const h = fit26.map((v) => Math.max(v - ceilAt, 0)); const o = C.ols(res, h.map((v) => [v]), cl); const nzr = h.filter((v) => v > 0).length; const tg = new Set(); rs.forEach((r, i) => { if (h[i] > 0) tg.add(r.tgk); });
    // on the engine's own number, with the refit controls: the same question for the number the app shows today
    const hm = rs.map((r) => Math.max(r.mn[0] - ceilAt, 0)); const o2 = C.ols(rs.map((r) => r.gap), rs.map((r, i) => [...Kx[i], hm[i]]), cl, 1e-3); const tg2 = new Set(); rs.forEach((r, i) => { if (hm[i] > 0) tg2.add(r.tgk); });
    const hm27 = r27.map((r) => Math.max(r.mn[0] - ceilAt, 0)); const o27 = C.ols(r27.map((r) => r.gap), r27.map((r, i) => [...K27[i], hm27[i]]), cl27, 1e-3); const tg27 = new Set(); r27.forEach((r, i) => { if (hm27[i] > 0) tg27.add(r.tgk); });
    console.log(`ceiling: on the new fitted number above ${ceilAt}: slope ${o.beta[0].toFixed(3)} (z ${o.z[0].toFixed(1)}), ${nzr} rows, ${tg.size} team-games | on the engine's number above ${ceilAt} (refit controls): ${o2.beta[o2.beta.length - 1].toFixed(3)} (z ${o2.z[o2.z.length - 1].toFixed(1)}), ${hm.filter((v) => v > 0).length} rows, ${tg2.size} team-games; 2027: ${o27.beta[o27.beta.length - 1].toFixed(3)} (z ${o27.z[o27.z.length - 1].toFixed(1)}), ${tg27.size} team-games`);
    O.ceiling = { onFit: o.beta[0], onFitZ: o.z[0], onEngine: o2.beta[o2.beta.length - 1], onEngineZ: o2.z[o2.z.length - 1], rows: hm.filter((v) => v > 0).length, teamGames: tg2.size, slope27: o27.beta[o27.beta.length - 1], z27: o27.z[o27.z.length - 1], teamGames27: tg27.size };
    O.ceilSlope = o.beta[0]; }
  // --- 3 and 4. ladders
  const ladder = (trainIdx, testRows, testK, testS, label) => {
    const tr = trainIdx; const yT = tr.map((i) => y[i]), clT = tr.map((i) => cl[i]);
    const eng = testRows.map((r) => r.pr[0]);
    const res = { label, engine: miss(testRows, eng), steps: [] };
    console.log(`  ${label}: ${testRows.length} player-games, ${new Set(testRows.map((r) => r.id)).size} games, ${testRows.filter((r) => r.ac[0] >= 10).length} with 10+ real minutes`);
    console.log(`    engine as it is                          ${res.engine.toFixed(3)}`);
    let prevNum = eng, prev = res.engine;
    const step = (name, num) => { const mv = miss(testRows, num); const z = pairedZ(testRows, prevNum, num); console.log(`    ${name.padEnd(40)} ${mv.toFixed(3)}   step ${(100 * (prev - mv) / res.engine).toFixed(2)}% of the engine miss (paired by game z ${z.toFixed(1)})`); res.steps.push({ name, miss: mv, stepPct: (100 * (prev - mv)) / res.engine, z }); prev = mv; prevNum = num; };
    const keepRest = g === 'rep' ? 1 : 0;   // before lineups: first keep the refill as it is, then drop it
    { // the learned layer alone, refit (no additive constants: the layer multiplies plain minutes)
      const mL = C.ols(tr.map((i) => y[i] - keepRest * rs[i].rest), tr.map((i) => Kx[i].slice(3)), clT, 1e-3);
      step('refit of the learned layer' + (keepRest ? ', refill kept' : ''), testRows.map((r, q) => r.mp + keepRest * r.rest + dot(testK[q].slice(3), mL.beta)));
      const m0 = C.ols(tr.map((i) => y[i] - keepRest * rs[i].rest), tr.map((i) => Kx[i]), clT, 1e-3);
      step('+ additive constants by role', testRows.map((r, q) => r.mp + keepRest * r.rest + dot(testK[q], m0.beta)));
    }
    const m1 = C.ols(yT, tr.map((i) => Kx[i]), clT, 1e-3);
    if (g === 'rep') step('+ refill dropped', testRows.map((r, q) => r.mp + dot(testK[q], m1.beta)));
    res.refit = prev;
    let cols = [];
    for (const [bn] of BLOCKS) {
      const idx = T.map((t, i) => (t.block === bn ? i : -1)).filter((j) => j >= 0); if (!idx.length) continue;
      cols = cols.concat(idx);
      const mm = C.ols(yT, tr.map((i) => [...Kx[i], ...cols.map((j) => Sx[i][j])]), clT, 1e-3);
      step('+ ' + bn, testRows.map((r, q) => r.mp + dot([...testK[q], ...cols.map((j) => testS[q][j])], mm.beta)));
    }
    { // ceiling, second step fitted on the training rows
      const mm = C.ols(yT, tr.map((i) => [...Kx[i], ...Sx[i]]), clT, 1e-3);
      const fT = tr.map((i) => rs[i].mp + dot([...Kx[i], ...Sx[i]], mm.beta));
      const o = C.ols(tr.map((i, q) => rs[i].ac[0] - fT[q]), fT.map((v) => [Math.max(v - ceilAt, 0)]), clT);
      step('+ ceiling', testRows.map((r, q) => { const v = r.mp + dot([...testK[q], ...testS[q]], mm.beta); return v + o.beta[0] * Math.max(v - ceilAt, 0); }));
    }
    res.final = prev;
    { // the ceiling alone, on the engine's own number: constants by role, with and without the hinge above 35
      const gT = tr.map((i) => rs[i].gap);
      const a0 = C.ols(gT, tr.map((i) => [1, rs[i].st === 1 ? 1 : 0, rs[i].mpg < 18 ? 1 : 0]), clT), a1 = C.ols(gT, tr.map((i) => [1, rs[i].st === 1 ? 1 : 0, rs[i].mpg < 18 ? 1 : 0, Math.max(rs[i].mn[0] - ceilAt, 0)]), clT);
      const n0 = testRows.map((r) => r.pr[0] + dot([1, r.st === 1 ? 1 : 0, r.mpg < 18 ? 1 : 0], a0.beta)), n1 = testRows.map((r) => r.pr[0] + dot([1, r.st === 1 ? 1 : 0, r.mpg < 18 ? 1 : 0, Math.max(r.mn[0] - ceilAt, 0)], a1.beta));
      res.ceilAlone = (100 * (miss(testRows, n0) - miss(testRows, n1))) / res.engine;
      console.log(`    (the ceiling alone on today's number: ${miss(testRows, n0).toFixed(3)} -> ${miss(testRows, n1).toFixed(3)} = ${res.ceilAlone.toFixed(2)}% of the engine miss, paired z ${pairedZ(testRows, n0, n1).toFixed(1)})`);
    }
    console.log(`    total ${res.engine.toFixed(3)} -> ${prev.toFixed(3)}: ${(100 * (res.engine - prev) / res.engine).toFixed(1)}% less; the new signals on top of the refit: ${(100 * (res.refit - prev) / res.engine).toFixed(1)}%`);
    return res;
  };
  const dates = [...new Set(rs.map((r) => r.d))].sort(); const cut = dates[Math.floor(dates.length / 2)];
  const h1 = [], h2 = []; rs.forEach((r, i) => (r.d < cut ? h1 : h2).push(i));
  O.half = ladder(h1, h2.map((i) => rs[i]), h2.map((i) => Kx[i]), h2.map((i) => Sx[i]), `2026 second half (from ${cut}), fitted on the first half`);
  O.half.cut = cut;
  O.cross = ladder(rs.map((_, i) => i), r27, r27.map((r) => K(r, live)), r27.map(sig), '2027 games, fitted on all of 2026');
}
L.writeJSON(path.join(L.DATA, 'research', 'pregame-final.json'), out);
console.log('\nsaved data/research/pregame-final.json');
