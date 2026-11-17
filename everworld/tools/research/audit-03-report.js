#!/usr/bin/env node
'use strict';
/* Audit, step 3: read data/research/audit-scan.json and list the scenarios where the engine is systematically off.
 *   node tools/research/audit-03-report.js min        minutes, every view (raw / after plain refit; flat / share)
 *   node tools/research/audit-03-report.js pm         per-minute view for points, rebounds, assists (real minutes plugged in)
 *   node tools/research/audit-03-report.js tot        total line bias for points, rebounds, assists
 *   node tools/research/audit-03-report.js cell <stage> <scenario substring>     everything about matching cells
 * A line is listed when |z| >= 3.5 on 2026 and the 2027 value has the same sign (zmin and view can be changed: --z 3.5 --view shRes).
 */
const path = require('path');
const A = require(path.resolve(__dirname, `../../data/research/audit-scan${process.env.AUDIT_YARD ? '-' + process.env.AUDIT_YARD : ''}.json`));
const mode = process.argv[2] || 'min';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ZMIN = +arg('--z', 3.5);
const f = (x, w = 7, d = 3) => (x == null ? '-' : x.toFixed(d)).padStart(w);
const z = (x) => (x == null ? '-' : x.toFixed(1)).padStart(6);
const lab = (r) => `${r.g.padEnd(4)} ${r.role.padEnd(8)} ${r.scen.padEnd(48)}`;

if (mode === 'min') {
  const views = (arg('--view', 'gr,sh,resGr,shRes')).split(',');
  for (const v of views) {
    const flat = v === 'gr' || v === 'resGr' || v === 'b' || v === 'res';
    console.log(`\n=== MINUTES, view ${v} (${flat ? 'flat: minutes per player' : 'share of the remaining minutes'}; ${v.includes('es') ? 'AFTER the plain refit' : 'engine as dumped'}) ===`);
    console.log('stage role     scenario                                          tg-26  rows  | value      z   vs rest   z | 2027: tg  value    z  | gain% (2nd half) | miss  miss-refit');
    const L = A.filter((r) => r.scen !== 'everyone' && r.c27 && Math.abs(r.min[v][1]) >= ZMIN && r.c27.min[v][0] * r.min[v][0] > 0 && r.tg >= 40);
    const gain = (r) => (v === 'gr' ? r.gainFl : v === 'sh' ? r.gainSh[0] : v === 'resGr' ? r.gainFlR : r.gainShR);
    L.sort((a, b) => gain(b) - gain(a));
    for (const r of L.slice(0, +arg('--top', 60))) {
      const m = r.min[v], c = r.c27.min[v];
      console.log(`${lab(r)} ${String(r.tg).padStart(5)} ${String(r.graded).padStart(6)} | ${f(m[0])} ${z(m[1])} ${flat ? f(m[2]) : '      -'} ${flat ? z(m[3]) : '     -'} | ${String(r.c27.tg).padStart(4)} ${f(c[0])} ${z(c[1])} | ${f(gain(r), 6, 2)} | ${f(r.miss ? r.miss[0] : null, 5, 2)} ${f(r.missRefitMin, 5, 2)}`);
    }
    console.log(`(${L.length} cells pass; ${A.filter((r) => r.scen !== 'everyone' && r.tg >= 40).length} tested in this view)`);
  }
}
if (mode === 'pm' || mode === 'tot') {
  for (const st of ['pts', 'reb', 'ast']) for (const v of (mode === 'pm' ? arg('--view', 'pmSh,pmShRes') : 'b').split(',')) {
    const k = { pts: 1, reb: 2, ast: 3 }[st];
    console.log(`\n=== ${st.toUpperCase()}, view ${v} ===`);
    console.log('stage role     scenario                                          tg-26 played | value      z   vs rest   z | 2027: tg  value    z  | gain% | miss  miss with real minutes | min bias (gr) z');
    const L = A.filter((r) => r.scen !== 'everyone' && r.c27 && Math.abs(r[st][v][1]) >= ZMIN && r.c27[st][v][0] * r[st][v][0] > 0 && r.tg >= 40);
    L.sort((a, b) => Math.abs(b[st][v][1]) - Math.abs(a[st][v][1]));
    for (const r of L.slice(0, +arg('--top', 40))) {
      const m = r[st][v], c = r.c27[st][v];
      console.log(`${lab(r)} ${String(r.tg).padStart(5)} ${String(r.played).padStart(6)} | ${f(m[0])} ${z(m[1])} ${m.length > 2 ? f(m[2]) : '      -'} ${m.length > 2 ? z(m[3]) : '     -'} | ${String(r.c27.tg).padStart(4)} ${f(c[0])} ${z(c[1])} | ${f(r.gainSh[k], 6, 2)} | ${f(r.miss ? r.miss[k] : null, 5, 2)} ${f(r.missRM ? r.missRM[k] : null, 5, 2)} | ${f(r.min.gr[0])} ${z(r.min.gr[1])}`);
    }
    console.log(`(${L.length} cells pass)`);
  }
}
if (mode === 'cell') {
  const g = process.argv[3], sub = (process.argv[4] || '').toLowerCase();
  for (const r of A.filter((x) => (g === 'all' || x.g === g) && x.scen.toLowerCase().includes(sub))) {
    const c = r.c27 || { min: {}, pts: {}, reb: {}, ast: {} };
    console.log(`\n${lab(r)} rows ${r.rows} played ${r.played} 10+ ${r.n10} team-games ${r.tg} | 2027: rows ${c.rows} tg ${c.tg}`);
    console.log(`  MIN  bias(played) ${f(r.min.b[0])} z${z(r.min.b[1])} | graded ${f(r.min.gr[0])} z${z(r.min.gr[1])} vs rest ${f(r.min.gr[2])} z${z(r.min.gr[3])} | share ${f(r.min.sh[0])} z${z(r.min.sh[1])} | after refit flat ${f(r.min.resGr[0])} z${z(r.min.resGr[1])} share ${f(r.min.shRes[0])} z${z(r.min.shRes[1])} | miss ${r.miss && r.miss[0]} refit ${r.missRefitMin}`);
    if (c.min.b) console.log(`  2027 bias(played) ${f(c.min.b[0])} z${z(c.min.b[1])} | graded ${f(c.min.gr[0])} z${z(c.min.gr[1])} vs rest ${f(c.min.gr[2])} z${z(c.min.gr[3])} | share ${f(c.min.sh[0])} z${z(c.min.sh[1])} | after refit flat ${f(c.min.resGr[0])} z${z(c.min.resGr[1])} share ${f(c.min.shRes[0])} z${z(c.min.shRes[1])}`);
    console.log(`  gain% of stage miss (2nd half): flat ${r.gainFl} share ${r.gainSh[0]} | over refit: flat ${r.gainFlR} share ${r.gainShR} | fitted: flat ${r.flat} share ${r.coef[0]}`);
    for (const st of ['pts', 'reb', 'ast']) {
      const k = { pts: 1, reb: 2, ast: 3 }[st], m = r[st], d = c[st];
      console.log(`  ${st.toUpperCase()}  bias ${f(m.b[0])} z${z(m.b[1])} | per-minute (real minutes) flat ${f(m.pm[0])} z${z(m.pm[1])} vs rest z${z(m.pm[3])} share ${f(m.pmSh[0])} z${z(m.pmSh[1])} | after refit ${f(m.pmRes[0])} z${z(m.pmRes[1])} share ${f(m.pmShRes[0])} z${z(m.pmShRes[1])} | miss ${r.miss && r.miss[k]} real-min ${r.missRM && r.missRM[k]} | gain ${r.gainSh[k]}` +
        (d && d.b ? ` || 2027 bias ${f(d.b[0])} z${z(d.b[1])} pm ${f(d.pm[0])} z${z(d.pm[1])} share ${f(d.pmSh[0])} z${z(d.pmSh[1])} after refit z${z(d.pmShRes[1])}` : ''));
    }
  }
}
