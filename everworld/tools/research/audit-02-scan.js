#!/usr/bin/env node
'use strict';
/* Audit, step 2: every scenario x stage x role, for minutes, points, rebounds, assists.
 * For each cell:
 *   flat view    signed bias = real minus the engine's plain average (players who played), z with games as clusters, the same
 *                against the rest of the role at that stage, and the graded view for minutes (live: never got in = 0;
 *                before tip: players who played, because the number answers "if he plays").
 *   share view   the engine corrects by a SHARE of what is still to come, so the same gap is also fitted as
 *                gap ~ c x (engine's remaining minutes); c and its score z.
 *   after refit  both views again on what is left after a cross-fitted plain refit of the 49 existing inputs
 *                (audit-fit.js): a scenario still off there is not stale weights, the engine has no input or shape for it.
 *   per-minute   for points, rebounds, assists: the gap with REAL minutes plugged in (flat and share), raw and after refit.
 *   miss         of the number shown (10+ real minutes), and with real minutes plugged in.
 *   gain         effect fitted on the first half of 2026, applied to the second half, as % of the stage's whole miss.
 *   node tools/research/audit-02-scan.js            -> data/research/audit-scan.json
 */
const fs = require('fs');
const path = require('path');
const C = require('./audit-common');
const FIT = require('./audit-fit');
const SC = require('./audit-scen');

const D26 = C.load(2026), D27 = C.load(2027);
const YARD = process.env.AUDIT_YARD || ''; // '' = plain refit of the 49 inputs; 'C' = plus the calibration pair (thin, full)
FIT.attach(D26, D27, YARD);
const NM = 21;
const clampv = (v, a, b) => Math.max(a, Math.min(b, v));
const isLive = (g) => g !== 'rep' && g !== 'pre';

function scan(D, withGain) {
  const nG = D.nGames, out = [];
  for (const g of C.STAGES) {
    const rows = D.rows.filter((r) => r.g === g);
    const lv = isLive(g);
    const scs = SC.S.filter((s) => SC.applies(s, g));
    const nC = scs.length * 3;
    const sums = Array.from({ length: nC }, () => new Float64Array(nG * NM));
    const nP = Array.from({ length: nC }, () => new Float64Array(nG)), nA = Array.from({ length: nC }, () => new Float64Array(nG));
    const tot = Array.from({ length: nC }, () => ({ rows: 0, n10: 0, e: [0, 0, 0, 0], er: [0, 0, 0, 0], eR: 0, tg: new Set(), rem2: 0, w2: [0, 0, 0, 0],
      // first-half fits: [sum w*y, sum w*w] share form; [sum y, n] flat form; raw and after refit
      fS: [[0, 0], [0, 0], [0, 0], [0, 0]], fSR: [0, 0], fF: [0, 0], fFR: [0, 0],
      gS: [0, 0, 0, 0], gSR: 0, gF: 0, gFR: 0, n10b: 0 }));
    const mem = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], ri = r.st === 1 ? 1 : 2, list = [];
      for (let s = 0; s < scs.length; s++) { if (scs[s].f(r)) { list.push(s * 3, s * 3 + ri); } }
      mem[i] = list;
      const gi = r._gi, graded = r._played || lv;
      const rem = r._remE >= 0.25 ? r._remE : 0;
      const w = [0, Math.max(r._rm[1] - r.now[1], 0), Math.max(r._rm[2] - r.now[2], 0), Math.max(r._rm[3] - r.now[3], 0)];
      for (const c of list) {
        const T = tot[c], Sm = sums[c], o = gi * NM;
        T.rows++;
        if (graded) {
          nA[c][gi]++; Sm[o + 11] += r._d[0]; Sm[o + 12] += r._dR; Sm[o + 13] += rem * r._d[0]; Sm[o + 14] += rem * r._dR; T.rem2 += rem * rem;
          if (withGain && r._half === 0) { T.fS[0][0] += rem * r._d[0]; T.fS[0][1] += rem * rem; T.fSR[0] += rem * r._dR; T.fSR[1] += rem * rem; T.fF[0] += r._d[0]; T.fF[1]++; T.fFR[0] += r._dR; T.fFR[1]++; }
        }
        if (!r._played) continue;
        nP[c][gi]++; T.tg.add(r.id + ':' + r.tm);
        Sm[o] += r._d[0]; Sm[o + 1] += r._d[1]; Sm[o + 2] += r._d[2]; Sm[o + 3] += r._d[3];
        Sm[o + 4] += r._dr[1]; Sm[o + 5] += r._dr[2]; Sm[o + 6] += r._dr[3];
        Sm[o + 7] += r._dR; Sm[o + 8] += r._qR[1]; Sm[o + 9] += r._qR[2]; Sm[o + 10] += r._qR[3];
        for (let k = 1; k <= 3; k++) { Sm[o + 14 + k] += w[k] * r._dr[k]; Sm[o + 17 + k] += w[k] * r._qR[k]; T.w2[k] += w[k] * w[k]; }
        if (r._p10) { T.n10++; for (let k = 0; k < 4; k++) { T.e[k] += r._e[k]; T.er[k] += r._er[k]; } T.eR += Math.abs(r._a[0] - r._mR); }
        if (withGain && r._half === 0) for (let k = 1; k <= 3; k++) { const wk = Math.max(r.mn[k] - r.now[k], 0); T.fS[k][0] += wk * r._d[k]; T.fS[k][1] += wk * wk; }
      }
    }
    const stageTot = { n10: 0, e: [0, 0, 0, 0], eR: 0 };
    if (withGain) {
      const coef = tot.map((T) => ({ c: T.fS.map((x, k) => (x[1] > 0 ? clampv(x[0] / x[1], k ? -0.3 : -0.6, k ? 0.3 : 1.5) : 0)), cR: T.fSR[1] > 0 ? clampv(T.fSR[0] / T.fSR[1], -0.6, 1.5) : 0,
        f: T.fF[1] > 0 ? T.fF[0] / T.fF[1] : 0, fR: T.fFR[1] > 0 ? T.fFR[0] / T.fFR[1] : 0 }));
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r._half !== 1 || !r._p10) continue;
        const eR0 = Math.abs(r._a[0] - r._mR);
        stageTot.n10++; for (let k = 0; k < 4; k++) stageTot.e[k] += r._e[k]; stageTot.eR += eR0;
        const rem = r._remE >= 0.25 ? r._remE : 0;
        for (const c of mem[i]) {
          const T = tot[c], K = coef[c];
          T.n10b++;
          T.gS[0] += r._e[0] - Math.abs(r._a[0] - (r.pr[0] + K.c[0] * rem));
          T.gSR += eR0 - Math.abs(r._a[0] - (r._mR + K.cR * rem));
          T.gF += r._e[0] - Math.abs(r._a[0] - Math.max(r.pr[0] + K.f, r.now[0]));
          T.gFR += eR0 - Math.abs(r._a[0] - Math.max(r._mR + K.fR, r.now[0]));
          for (let k = 1; k <= 3; k++) T.gS[k] += r._e[k] - Math.abs(r._a[k] - (r.pr[k] + K.c[k] * Math.max(r.pr[k] - r.now[k], 0)));
        }
      }
      for (let c = 0; c < nC; c++) tot[c].coef = coef[c];
    }
    const col = (c, m) => { const s = new Float64Array(nG), Sm = sums[c]; for (let gI = 0; gI < nG; gI++) s[gI] = Sm[gI * NM + m]; return s; };
    const scoreZ = (c, m) => { let S = 0, V = 0; const Sm = sums[c]; for (let gI = 0; gI < nG; gI++) { const v = Sm[gI * NM + m]; S += v; V += v * v; } return { S, z: V > 0 ? S / Math.sqrt(V) : 0 }; };
    for (let s = 0; s < scs.length; s++) for (let ro = 0; ro < 3; ro++) {
      const c = s * 3 + ro, T = tot[c];
      if (T.rows < 1) continue;
      const base = ro;
      const rec = { g, scen: scs[s].name, group: scs[s].group, role: SC.ROLES[ro][0], rows: T.rows, played: 0, graded: 0, n10: T.n10, tg: T.tg.size, games: 0 };
      const M = [];
      for (let m = 0; m <= 12; m++) {
        const n = m >= 11 ? nA[c] : nP[c];
        const a = C.clusterMean(col(c, m), n);
        let d = { d: 0, z: 0 };
        if (s > 0) {
          const sb = col(base, m), nb = m >= 11 ? nA[base] : nP[base], sc = col(c, m);
          const s0 = new Float64Array(nG), n0 = new Float64Array(nG);
          for (let gI = 0; gI < nG; gI++) { s0[gI] = sb[gI] - sc[gI]; n0[gI] = nb[gI] - n[gI]; }
          d = C.clusterDiff(sc, n, s0, n0);
        }
        M.push([+a.m.toFixed(4), +a.z.toFixed(2), +d.d.toFixed(4), +d.z.toFixed(2)]);
        if (m === 0) { rec.played = a.n; rec.games = a.c; }
        if (m === 11) rec.graded = a.n;
      }
      const sh = (m, den) => { const q = scoreZ(c, m); return [den > 0 ? +(q.S / den).toFixed(4) : 0, +q.z.toFixed(2)]; };
      // [mean, z, difference from the rest of the role, z of the difference]; share = [c, z]
      rec.min = { b: M[0], gr: M[11], res: M[7], resGr: M[12], sh: sh(13, T.rem2), shRes: sh(14, T.rem2) };
      rec.pts = { b: M[1], pm: M[4], pmRes: M[8], pmSh: sh(15, T.w2[1]), pmShRes: sh(18, T.w2[1]) };
      rec.reb = { b: M[2], pm: M[5], pmRes: M[9], pmSh: sh(16, T.w2[2]), pmShRes: sh(19, T.w2[2]) };
      rec.ast = { b: M[3], pm: M[6], pmRes: M[10], pmSh: sh(17, T.w2[3]), pmShRes: sh(20, T.w2[3]) };
      rec.miss = T.n10 ? T.e.map((x) => +(x / T.n10).toFixed(3)) : null;
      rec.missRM = T.n10 ? T.er.map((x) => +(x / T.n10).toFixed(3)) : null;
      rec.missRefitMin = T.n10 ? +(T.eR / T.n10).toFixed(3) : null;
      if (withGain) {
        rec.coef = T.coef.c.map((x) => +x.toFixed(4)); rec.coefR = +T.coef.cR.toFixed(4); rec.flat = +T.coef.f.toFixed(3); rec.flatR = +T.coef.fR.toFixed(3);
        rec.gainSh = T.gS.map((x, k) => +(100 * x / stageTot.e[k]).toFixed(3)); // share form, vs the engine as dumped: % of the stage's whole miss (second half)
        rec.gainShR = +(100 * T.gSR / stageTot.eR).toFixed(3); // share form, on top of the plain refit
        rec.gainFl = +(100 * T.gF / stageTot.e[0]).toFixed(3); rec.gainFlR = +(100 * T.gFR / stageTot.eR).toFixed(3);
        rec.n10b = T.n10b; rec.stageMiss2 = stageTot.e.map((x) => +(x / stageTot.n10).toFixed(3)); rec.stageN10b = stageTot.n10;
      }
      out.push(rec);
    }
    process.stderr.write(`${D === D26 ? 2026 : 2027} ${g}: ${rows.length} rows, ${nC} cells\n`);
  }
  return out;
}
const A = scan(D26, true), B = scan(D27, false);
const key = (r) => `${r.g}|${r.scen}|${r.role}`;
const B27 = new Map(B.map((r) => [key(r), r]));
for (const r of A) { const b = B27.get(key(r)); r.c27 = b ? { rows: b.rows, played: b.played, graded: b.graded, tg: b.tg, min: b.min, pts: b.pts, reb: b.reb, ast: b.ast, miss: b.miss, missRM: b.missRM } : null; }
const outFile = path.join(C.L.ROOT, `data/research/audit-scan${YARD ? '-' + YARD : ''}.json`);
fs.writeFileSync(outFile, JSON.stringify(A));
console.log(`${A.length} cells written to ${outFile}`);
