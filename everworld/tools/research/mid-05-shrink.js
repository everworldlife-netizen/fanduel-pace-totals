#!/usr/bin/env node
/* mid-05: the engine's remaining minutes are too spread out. Which anchor does the real number regress to?
 * (a) half of the time left (5 on the floor of ~10 in a rotation), (b) his own usual remaining minutes from this point
 * (last 10 games, hRem), (c) his usual minutes x time left / 48.  OLS of real remaining on engine remaining + anchors,
 * clustered by team-game; then the out-of-sample gain (first half of 2026 -> second half) of adding one "shrink" input
 * to the plain refit, in the engine's multiplicative form: input = (anchor - engine remaining) / engine remaining. */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const season = +process.argv[2] || 2026;
const rows = C.load(season).filter((r) => ['s18', 's24', 's30'].includes(r.g));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
for (const g of ['s18', 's24', 's30']) {
  const R = rows.filter((r) => r.g === g && r.ac0 != null && r.hN >= 3);
  const left = 48 - R[0].el;
  const X = R.map((r) => [1, r.erem, r.hRem, r.mpg * left / 48, r.on ? 1 : 0]);
  const o = C.ols(X, R.map((r) => r.rem), R.map((r) => r.tg));
  console.log(`\n== ${g} (n ${R.length}): real remaining = ${['const', 'engine rem', 'usual rem (own map)', 'mpg share', 'on'].map((k, i) => `${C.fmt(o.beta[i], 3)} ${k} (z ${o.z[i].toFixed(1)})`).join('  ')}`);
  const X1 = R.map((r) => [1, r.erem]);
  const o1 = C.ols(X1, R.map((r) => r.rem), R.map((r) => r.tg));
  console.log(`   affine only: real = ${o1.beta[0].toFixed(2)} + ${o1.beta[1].toFixed(3)} x engine (slope differs from 1 by z ${((o1.beta[1] - 1) / o1.se[1]).toFixed(1)}); fixed point ${(o1.beta[0] / (1 - o1.beta[1])).toFixed(1)} min = ${(o1.beta[0] / (1 - o1.beta[1]) / left).toFixed(2)} of the time left`);
}
// out-of-sample: candidates as one extra input on top of the plain refit
const cands = {
  'half of time left': (r) => clamp((0.5 * (48 - r.el) - r.erem) / r.erem, -1, 4),
  'own usual remaining (hRem)': (r) => (r.hN >= 3 ? clamp((r.hRem - r.erem) / r.erem, -1, 4) : 0),
  'mpg share of time left': (r) => clamp((r.mpg * (48 - r.el) / 48 - r.erem) / r.erem, -1, 4),
  'constant (1/rem)': (r) => clamp(6 / r.erem, 0, 6),
};
for (const g of ['s18', 's24', 's30']) {
  const R = rows.filter((r) => r.g === g);
  const { A, B } = F.splitByDate(R);
  const base = F.fit(A, null);
  const c0 = F.compare(B, (r) => r.mn0, (r) => F.predict(r, base.beta, null));
  console.log(`\n== ${g}: second-half miss engine ${c0.a.toFixed(3)}, plain refit ${c0.b.toFixed(3)} (${c0.pct.toFixed(2)}%)`);
  for (const [nm, f] of Object.entries(cands)) {
    const ex = [f];
    const o = F.fit(A, ex), full = F.fit(R, ex);
    const c = F.compare(B, (r) => F.predict(r, base.beta, null), (r) => F.predict(r, o.beta, ex));
    const cE = F.compare(B, (r) => r.mn0, (r) => F.predict(r, o.beta, ex));
    console.log(`   + ${nm.padEnd(28)} coef ${C.fmt(full.beta[49], 3)} (z ${full.z[49].toFixed(1)} on all 2026)  miss ${c.b.toFixed(3)}  vs plain refit ${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)})  vs engine ${cE.pct.toFixed(2)}%`);
  }
  const ex = Object.values(cands).slice(0, 3);
  const o = F.fit(A, ex), full = F.fit(R, ex);
  const c = F.compare(B, (r) => F.predict(r, base.beta, null), (r) => F.predict(r, o.beta, ex));
  console.log(`   + first three together: coefs ${full.beta.slice(49).map((b, i) => `${C.fmt(b, 3)} (z ${full.z[49 + i].toFixed(1)})`).join(', ')}  miss ${c.b.toFixed(3)}  vs plain refit ${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)})`);
}
