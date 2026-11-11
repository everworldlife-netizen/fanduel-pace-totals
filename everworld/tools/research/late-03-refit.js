#!/usr/bin/env node
/* late-03: the plain refit baseline. Fit the 49 existing inputs on the first half of 2026 (by date), apply to the second half.
 * Also: fit on all of 2026 and apply to 2027 (out of season). Reports the miss (10+ minutes) before and after. */
'use strict';
const C = require('./late-common'), F = require('./late-fit');
const rows = C.load(2026), rows27 = C.load(2027);
for (const g of ['s36', 's42']) {
  const A = rows.filter((r) => r.g === g), { cutDate, A: h1, B: h2 } = C.splitByDate(A);
  const o = F.fit(h1, null);
  const c = F.compare(h2, (r) => r.mn0, (r) => F.predict(r, o.beta, null));
  console.log(`${g}: cut ${cutDate}; fit on ${o.n} rows / ${o.G} team-games; second half n=${c.n}: engine ${c.a.toFixed(3)} -> plain refit ${c.b.toFixed(3)} (${c.pct.toFixed(2)}%, z ${c.z.toFixed(1)})`);
  const oAll = F.fit(A, null), B = rows27.filter((r) => r.g === g);
  const c2 = F.compare(B, (r) => r.mn0, (r) => F.predict(r, oAll.beta, null));
  console.log(`    all 2026 -> 2027 n=${c2.n}: engine ${c2.a.toFixed(3)} -> plain refit ${c2.b.toFixed(3)} (${c2.pct.toFixed(2)}%, z ${c2.z.toFixed(1)})`);
  const top = oAll.beta.map((b, i) => [C.PAT_F[i], b, oAll.z[i]]).filter((x) => Math.abs(x[2]) >= 3).sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
  console.log('    refit coefficients on top of the engine with |z|>=3: ' + top.map((x) => `${x[0]} ${C.fmt(x[1], 3)} (z ${x[2].toFixed(1)})`).join(', '));
}
