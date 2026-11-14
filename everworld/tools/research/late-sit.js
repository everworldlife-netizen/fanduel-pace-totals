/* late-sit: evidence for one named situation at one stage, the same way for every finding.
 *   2026: rows, team-games, engine vs real remaining, raw gap (real - engine) with z clustered by team-game,
 *         the same after a plain refit of the 49 existing inputs (so the finding is not something a refit would fix);
 *   2027: rows, gap, z (confirmation only);
 *   gain: fit on the first half of 2026 (by date) a line  real remaining = a + b x engine remaining  for the rows in the
 *         situation only, apply to the second half; report the stage miss (players with 10+ real minutes) before/after
 *         in percent. kind L2 = the mean line, L1 = the middle line (least absolute miss). */
'use strict';
const C = require('./late-common'), F = require('./late-fit'), AN = require('./late-anchor');
const cache = {};
function data(stage) {
  if (cache[stage]) return cache[stage];
  const all26 = cache.all26 || (cache.all26 = C.load(2026)), all27 = cache.all27 || (cache.all27 = C.load(2027));
  const A = all26.filter((r) => r.g === stage && r.ac0 != null), B = all27.filter((r) => r.g === stage && r.ac0 != null);
  const o = F.fit(A, null);
  for (const r of A) r.res = r.ac0 - F.predict(r, o.beta, null);
  for (const r of B) r.res = r.ac0 - F.predict(r, o.beta, null);
  const { A: h1, B: h2, cutDate } = C.splitByDate(A);
  return (cache[stage] = { A, B, h1, h2, cutDate });
}
function evidence(stage, name, f) {
  const { A, B, h1, h2 } = data(stage);
  const S = A.filter(f), S27 = B.filter(f);
  const g = C.cl(S, (r) => r.gap), rs = C.cl(S, (r) => r.res), e = C.cl(S, (r) => r.erem).mean, a = C.cl(S, (r) => r.rem).mean;
  const g27 = S27.length ? C.cl(S27, (r) => r.gap) : { mean: NaN, z: NaN, n: 0, G: 0 };
  const e27 = S27.length ? C.cl(S27, (r) => r.erem).mean : NaN, a27 = S27.length ? C.cl(S27, (r) => r.rem).mean : NaN;
  const out = { stage, name, n: g.n, tg: g.G, engine: e, real: a, gap: g.mean, z: g.z, refitGap: rs.mean, refitZ: rs.z, n27: g27.n, tg27: g27.G, gap27: g27.mean, z27: g27.z, engine27: e27, real27: a27 };
  for (const kind of ['L2', 'L1']) {
    const sf = (r) => (f(r) ? 'in' : null);
    const ln = AN.fit(h1, sf, { kind, minN: 30 });
    const c = AN.compare(h2, (r) => r.mn0, (r) => AN.predict(r, ln, sf));
    out['gain' + kind] = c.pct; out['gainZ' + kind] = c.z; out['line' + kind] = ln.get('in');
    if (kind === 'L2') { out.missBefore = c.a; out.missAfterL2 = c.b; } else out.missAfterL1 = c.b;
    // the same line fitted on all 2026, applied to 2027
    const ln2 = AN.fit(A, sf, { kind, minN: 30 }); const d = AN.compare(B, (r) => r.mn0, (r) => AN.predict(r, ln2, sf));
    out['gain27' + kind] = d.pct; out['lineAll' + kind] = ln2.get('in');
  }
  return out;
}
const f2 = (v, d = 2) => (v == null || Number.isNaN(v) ? '-' : (v >= 0 ? '+' : '') + v.toFixed(d));
function show(o) {
  const ln = (l) => (l ? `${l[0].toFixed(2)}+${l[1].toFixed(2)}e` : '-');
  console.log(`[${o.stage}] ${o.name}`);
  console.log(`   2026: n=${o.n} tg=${o.tg} engine ${o.engine.toFixed(2)} real ${o.real.toFixed(2)} gap ${f2(o.gap)} z ${o.z.toFixed(1)} | after plain refit ${f2(o.refitGap)} z ${o.refitZ.toFixed(1)}`);
  console.log(`   2027: n=${o.n27} tg=${o.tg27} engine ${Number.isNaN(o.engine27) ? '-' : o.engine27.toFixed(2)} real ${Number.isNaN(o.real27) ? '-' : o.real27.toFixed(2)} gap ${f2(o.gap27)} z ${Number.isNaN(o.z27) ? '-' : o.z27.toFixed(1)}`);
  console.log(`   gain H1->H2 (stage miss ${o.missBefore.toFixed(3)}): mean line ${ln(o.lineL2)} -> ${o.gainL2.toFixed(2)}% (z ${o.gainZL2.toFixed(1)}); middle line ${ln(o.lineL1)} -> ${o.gainL1.toFixed(2)}% (z ${o.gainZL1.toFixed(1)}) | 2027 with the 2026 line: mean ${o.gain27L2.toFixed(2)}%, middle ${o.gain27L1.toFixed(2)}% | all-2026 lines: mean ${ln(o.lineAllL2)}, middle ${ln(o.lineAllL1)}`);
}
module.exports = { data, evidence, show };
