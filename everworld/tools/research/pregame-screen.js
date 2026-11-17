#!/usr/bin/env node
/* Pregame research: screen many candidate signals at stages rep and pre.
 * For each candidate s (a number per player-game, built point-in-time by pregame-common.js):
 *   raw   gap ~ 1 + s                      (gap = real minutes - engine's plain average, players who played)
 *   ctl   gap ~ controls + s
 * Controls (--ctl): m = the engine's learned inputs the way the learned layer uses them (each times the plain minutes:
 *                       a refit of the existing lessons on these same games)  [default]
 *                   x = the same inputs, additive      mx = both      l = additive role dummies (starter, under 18 a game)
 * --add a,b,c puts already accepted signals into the controls (forward selection). z is cluster-robust by game.
 *   node tools/research/pregame-screen.js [season] [--ctl m] [--add moveBack,seasonGap] [--top 60] [--only regex]
 */
'use strict';
const path = require('path');
const L = require('../lib');
const C = require('./pregame-common');
const season = +process.argv[2] || 2026;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const CTL = arg('--ctl', 'm'), ADD = arg('--add', '').split(',').filter(Boolean), TOP = +arg('--top', 60), ONLY = arg('--only', null);
const S = C.prepare(season);
const CAND = require('./pregame-cands')(season);
const X_NAMES = 'base,starter,bench,b2b,pace,blowout,roleTrend,matesOut,proof,home,softD,track,fouls,livePace,margin,minTrack,shooting,uReal,luck,leadS,trailS,lopB,on,sitLong,dnp,usgHi,closeStar,pfX,recent,mpgC,fadeHist,leadProof,tdMkt,tdLive,startUp,startDown,fresh,deep,vacPos,lastMin,rest3,missShare,loadS,loadB,loadBd,loadBq,favS,dogS,dogB'.split(',');
const out = {};
for (const g of ['rep', 'pre']) {
  const rs = S.rows.filter((r) => r.g === g && r.gap != null);
  const y = rs.map((r) => r.gap), cl = rs.map((r) => r.id);
  const live = X_NAMES.map((_, j) => j).filter((j) => { let a = Infinity, b = -Infinity; for (const r of rs) { const v = r.x[j]; if (v < a) a = v; if (v > b) b = v; } return j === 0 || b - a > 1e-9; });
  const addV = ADD.map((k) => { if (!CAND[k]) throw new Error('unknown ' + k); return rs.map((r) => { const v = CAND[k](r); return v == null ? 0 : v; }); });
  const ctl = rs.map((r, i) => { const a = [1]; if (CTL.includes('x')) for (const j of live) if (j) a.push(r.x[j]); if (CTL.includes('l')) a.push(r.st === 1 ? 1 : 0, r.mpg < 18 ? 1 : 0); if (CTL.includes('m')) for (const j of live) a.push((r.x[j] * r.mp) / 24); for (const v of addV) a.push(v[i]); return a; });
  const base = C.ols(y, ctl, cl, 1e-3);
  if (ADD.length) console.log(`\n${g}: accepted signals in the controls: ` + ADD.map((k, i) => `${k} ${base.beta[ctl[0].length - ADD.length + i].toFixed(3)} (z ${base.z[ctl[0].length - ADD.length + i].toFixed(1)})`).join('  '));
  const res = [];
  for (const [name, fn] of Object.entries(CAND)) {
    if (ONLY && !new RegExp(ONLY).test(name)) continue;
    if (ADD.includes(name)) continue;
    const v = rs.map(fn);
    const idx = []; for (let i = 0; i < v.length; i++) if (v[i] != null) idx.push(i);
    if (idx.length < 500) continue;
    let a = Infinity, b = -Infinity, nzc = 0; for (const i of idx) { if (v[i] < a) a = v[i]; if (v[i] > b) b = v[i]; if (v[i] !== 0) nzc++; }
    if (b - a < 1e-9 || nzc < 60) continue;
    const yy = idx.map((i) => y[i]), cc = idx.map((i) => cl[i]);
    const raw = C.ols(yy, idx.map((i) => [1, v[i]]), cc);
    let cz = null, cb = null;
    try { const c2 = C.ols(yy, idx.map((i) => [...ctl[i], v[i]]), cc, 1e-3); cz = c2.z[c2.z.length - 1]; cb = c2.beta[c2.beta.length - 1]; } catch (e) { /* collinear */ }
    const tgs = new Set(); for (const i of idx) if (v[i] !== 0) tgs.add(rs[i].tgk);
    res.push({ name, n: idx.length, nz: nzc, tg: tgs.size, rawB: raw.beta[1], rawZ: raw.z[1], ctlB: cb, ctlZ: cz });
  }
  res.sort((p, q) => Math.abs(q.ctlZ || 0) - Math.abs(p.ctlZ || 0));
  out[g] = res;
  console.log(`\n=== ${g} ${season}: ${rs.length} player-games, ${new Set(cl).size} games; ${res.length} candidates; controls ${CTL}${ADD.length ? ' + ' + ADD.join(',') : ''}`);
  console.log('signal                          rows  nonzero  team-games |  raw slope   raw z | ctl slope   ctl z');
  for (const o of res.slice(0, TOP)) console.log(`${o.name.padEnd(28)} ${String(o.n).padStart(7)} ${String(o.nz).padStart(7)} ${String(o.tg).padStart(8)}    | ${o.rawB.toFixed(3).padStart(8)} ${o.rawZ.toFixed(1).padStart(7)} | ${(o.ctlB == null ? NaN : o.ctlB).toFixed(3).padStart(8)} ${(o.ctlZ == null ? NaN : o.ctlZ).toFixed(1).padStart(7)}`);
}
L.writeJSON(path.join(L.DATA, 'research', `pregame-screen-${season}-${CTL}${ADD.length ? '-' + ADD.length : ''}.json`), out);
