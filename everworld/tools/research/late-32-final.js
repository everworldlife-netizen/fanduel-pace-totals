#!/usr/bin/env node
/* late-32-final: the numbers quoted in the report, in one run. For every finding: 2026 rows / team-games / games, engine vs
 * real remaining minutes, gap with z clustered by team-game AND by game, the same after a plain refit of the existing
 * inputs, 2027 gap and z, and the first-half -> second-half gain (mean line and middle line) in % of the stage miss.
 * Then the joint models, the shape test (middle vs mean lines), and the overtime calibration.
 * Writes data/research/late-final.json */
'use strict';
const C = require('./late-common'), SIT = require('./late-sit'), AN = require('./late-anchor');
const am = (r) => Math.abs(r.mg), S = (r) => r.st === 1, D = (r) => r.st !== 1 && r.mpg < 14, B = (r) => r.st !== 1 && r.mpg >= 14;
const F = {
  s42: {
    flagOffReg: (r) => !r.on && am(r) >= 16 && r.mpgOn < 20 && r.mpg >= 14,
    flagOnBench: (r) => r.on && am(r) >= 16 && r.mpgOn < 20 && !S(r),
    sOnDecided: (r) => r.on && am(r) >= 16 && r.mpgOn >= 20 && S(r),
    deepWait: (r) => !r.on && am(r) >= 16 && r.mpgOn >= 20 && D(r),
    restClose: (r) => !r.on && am(r) <= 10 && S(r) && r.sitFor < 12,
    deepOffClose: (r) => !r.on && am(r) <= 10 && D(r),
    onLowEngineClose: (r) => r.on && am(r) <= 10 && r.erem < 3,
    sLongStintClose: (r) => r.on && am(r) <= 10 && S(r) && r.stintNow >= 9,
  },
  s36: {
    deepLop: (r) => D(r) && am(r) >= 16,
    flagOffReg26: (r) => r.mpg >= 14 && !r.on && am(r) >= 26 && r.mpgOn < 22,
    sFullQ3: (r) => S(r) && r.on && r.stintNow >= 11.9,
    benchJustIn: (r) => r.on && r.stintNow < 4 && !S(r),
    midBenchLead: (r) => !S(r) && r.mpg >= 18 && r.mg >= 16,
    benchHot: (r) => B(r) && am(r) <= 15 && r.now0 - 0.75 * r.mpg >= 3,
    onLowEngine: (r) => r.on && r.erem < 3,
    engineHigh: (r) => r.erem >= 9.5,
  },
};
const out = { findings: [], joint: {}, ot: {} };
for (const stage of ['s42', 's36']) for (const [nm, f] of Object.entries(F[stage])) {
  const o = SIT.evidence(stage, nm, f);
  const { A, B: B27 } = SIT.data(stage);
  const Sx = A.filter(f), S27 = B27.filter(f);
  o.zGame = C.cl(Sx, (r) => r.gap, (r) => r.id).z; o.games = C.cl(Sx, (r) => r.gap, (r) => r.id).G;
  o.zGame27 = S27.length ? C.cl(S27, (r) => r.gap, (r) => r.id).z : null;
  o.shareNone = Sx.filter((r) => r.rem < 0.05).length / Sx.length; o.shareAll = Sx.filter((r) => r.remReg > (48 - r.el) - 0.25).length / Sx.length;
  const md = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  o.realMiddle = md(Sx.map((r) => r.rem));
  SIT.show(o);
  console.log(`   z by game ${o.zGame.toFixed(1)} (${o.games} games); 2027 z by game ${o.zGame27 == null ? '-' : o.zGame27.toFixed(1)}; share with no more minutes ${(100 * o.shareNone).toFixed(0)}%, share who play all the rest ${(100 * o.shareAll).toFixed(0)}%, real middle ${o.realMiddle.toFixed(2)}`);
  out.findings.push(o);
}
// joint models: all situations of a stage (first matching situation wins is NOT used: additive, see late-25)
const role = (r) => (r.st === 1 ? 'S' : r.mpg >= 14 ? 'B' : 'D');
const mc = (r) => (am(r) <= 10 ? 'c' : am(r) <= 15 ? 'm' : 'd');
const st24 = (r) => (r.on ? 'on' : 'off') + mc(r) + (mc(r) === 'd' ? (r.mpgOn < 20 ? 'f' : 'r') : '') + role(r);
for (const stage of ['s42', 's36']) {
  const { A, B: B27, h1, h2 } = SIT.data(stage);
  const L1 = AN.fit(h1, st24, { kind: 'L1' }), L2 = AN.fit(h1, st24, { kind: 'L2' }), L1a = AN.fit(A, st24, { kind: 'L1' }), L2a = AN.fit(A, st24, { kind: 'L2' });
  const c1 = AN.compare(h2, (r) => r.mn0, (r) => AN.predict(r, L1, st24)), c2 = AN.compare(h2, (r) => r.mn0, (r) => AN.predict(r, L2, st24));
  const c12 = AN.compare(h2, (r) => AN.predict(r, L2, st24), (r) => AN.predict(r, L1, st24));
  const d1 = AN.compare(B27, (r) => r.mn0, (r) => AN.predict(r, L1a, st24)), d2 = AN.compare(B27, (r) => r.mn0, (r) => AN.predict(r, L2a, st24));
  const d12 = AN.compare(B27, (r) => AN.predict(r, L2a, st24), (r) => AN.predict(r, L1a, st24));
  console.log(`\n${stage} 24 state anchors (on/off x margin class x floor unit x role): H1->H2 mean lines ${c2.pct.toFixed(2)}% (z ${c2.z.toFixed(1)}), middle lines ${c1.pct.toFixed(2)}% (z ${c1.z.toFixed(1)}); middle vs mean ${c12.pct.toFixed(2)}% (z ${c12.z.toFixed(1)})`);
  console.log(`   2026->2027: mean lines ${d2.pct.toFixed(2)}% (z ${d2.z.toFixed(1)}), middle lines ${d1.pct.toFixed(2)}% (z ${d1.z.toFixed(1)}); middle vs mean ${d12.pct.toFixed(2)}% (z ${d12.z.toFixed(1)})`);
  out.joint[stage] = { h2Mean: c2, h2Middle: c1, h2MiddleVsMean: c12, y27Mean: d2, y27Middle: d1, y27MiddleVsMean: d12, lines: Object.fromEntries([...L1a].map(([k, v]) => [k, { middle: v, mean: L2a.get(k) }])) };
}
// overtime calibration (unit = game)
const pOt = (m, el) => { const sd = 2.5 * Math.sqrt(48 - el), z = m / sd; return Math.min(0.6, (1.8 * Math.exp(-0.5 * z * z)) / (sd * 2.5066)); };
for (const season of [2026, 2027]) for (const stage of ['s36', 's42']) {
  const rows = C.load(season).filter((r) => r.g === stage); const el = stage === 's36' ? 36 : 42;
  const G = new Map(); for (const r of rows) if (!G.has(r.id)) G.set(r.id, { am: Math.abs(r.mg), ot: r.ot });
  const g = [...G.values()]; const obs = g.filter((x) => x.ot).length, exp = g.reduce((s, x) => s + pOt(x.am, el), 0), v = g.reduce((s, x) => { const p = pOt(x.am, el); return s + p * (1 - p); }, 0);
  const cl = g.filter((x) => x.am <= 6), obsC = cl.filter((x) => x.ot).length, expC = cl.reduce((s, x) => s + pOt(x.am, el), 0), vC = cl.reduce((s, x) => { const p = pOt(x.am, el); return s + p * (1 - p); }, 0);
  console.log(`overtime ${season} ${stage}: ${g.length} games, went to OT ${obs}, engine formula expects ${exp.toFixed(1)} (z ${((obs - exp) / Math.sqrt(v)).toFixed(1)}); within 6: ${cl.length} games, OT ${obsC}, expected ${expC.toFixed(1)} (z ${((obsC - expC) / Math.sqrt(vC)).toFixed(1)})`);
  out.ot[`${season}:${stage}`] = { games: g.length, obs, exp, z: (obs - exp) / Math.sqrt(v) };
}
C.L.writeJSON(`${C.L.ROOT}/data/research/late-final.json`, out);
