#!/usr/bin/env node
/* mid-07: the "flatten" input. Engine remaining minutes are too spread out, most of all in lopsided games.
 * Candidates (all in the engine's multiplicative form, input x engine remaining = minutes moved):
 *   flat     = (half of time left - engine remaining) / engine remaining            -> coef x (anchor - remaining)
 *   flatLop  = flat x clamp((|margin now| - 8)/10, 0, 2.5)
 *   flatPB   = flat x the engine's own blowout chance (pB)
 *   flatFav  = flat x clamp((|pregame spread| - 4)/6, 0, 2)
 * Fit on the first half of 2026, test on the second; coefficients and z on all of 2026; sign check on 2027. */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const usePlain = process.argv.includes('--plain'); // define the input on the remaining minutes before the learned layer
const remOf = (r) => (usePlain ? Math.max(r.mp - r.now0, 0.25) : r.erem);
const flat = (r) => clamp((0.5 * (48 - r.el) - remOf(r)) / remOf(r), -1, 4);
const lop = (r) => clamp((Math.abs(r.mg) - 8) / 10, 0, 2.5);
const E = {
  flat, flatLop: (r) => flat(r) * lop(r), flatPB: (r) => flat(r) * (r.pB || 0),
  flatFav: (r) => (r.fav != null ? flat(r) * clamp((Math.abs(r.fav) - 4) / 6, 0, 2) : 0),
  flatOn: (r) => (r.on ? flat(r) : 0),
};
const sets = { 'flat': ['flat'], 'flat+flatLop': ['flat', 'flatLop'], 'flat+flatPB': ['flat', 'flatPB'], 'flat+flatLop+flatPB': ['flat', 'flatLop', 'flatPB'], 'flat+flatLop+flatFav': ['flat', 'flatLop', 'flatFav'], 'flat+flatLop+flatOn': ['flat', 'flatLop', 'flatOn'] };
const r26 = C.load(2026), r27 = C.load(2027);
for (const g of ['s18', 's24', 's30']) {
  const R = r26.filter((r) => r.g === g), R7 = r27.filter((r) => r.g === g);
  const { A, B } = F.splitByDate(R);
  const base = F.fit(A, null);
  const c0 = F.compare(B, (r) => r.mn0, (r) => F.predict(r, base.beta, null));
  console.log(`\n== ${g}${usePlain ? ' (input on plain remaining)' : ''}: second-half miss engine ${c0.a.toFixed(3)}, plain refit ${c0.b.toFixed(3)} (${c0.pct.toFixed(2)}%)`);
  for (const [nm, ks] of Object.entries(sets)) {
    const ex = ks.map((k) => E[k]);
    const o = F.fit(A, ex), full = F.fit(R, ex), f27 = F.fit(R7, ex);
    const c = F.compare(B, (r) => F.predict(r, base.beta, null), (r) => F.predict(r, o.beta, ex));
    const cE = F.compare(B, (r) => r.mn0, (r) => F.predict(r, o.beta, ex));
    // 2027: apply the 2026 fit (all of 2026) to 2027, against the plain refit from 2026
    const b26 = F.fit(R, null);
    const c7 = F.compare(R7, (r) => F.predict(r, b26.beta, null), (r) => F.predict(r, full.beta, ex));
    console.log(`   ${nm.padEnd(22)} 2026 coefs ${ks.map((k, i) => `${k} ${C.fmt(full.beta[49 + i], 3)} (z ${full.z[49 + i].toFixed(1)})`).join(', ')}`);
    console.log(`   ${''.padEnd(22)} 2nd half: miss ${c.b.toFixed(3)}, vs plain refit ${c.pct.toFixed(2)}% (z ${c.z.toFixed(1)}), vs engine ${cE.pct.toFixed(2)}% | 2027 refit coefs ${ks.map((k, i) => `${C.fmt(f27.beta[49 + i], 3)} (z ${f27.z[49 + i].toFixed(1)})`).join(', ')}; 2026 fit applied to 2027: ${c7.pct.toFixed(2)}% (z ${c7.z.toFixed(1)})`);
  }
}
