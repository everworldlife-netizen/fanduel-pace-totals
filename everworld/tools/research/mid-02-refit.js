#!/usr/bin/env node
/* mid-02: how much does a plain refit of the 49 existing inputs buy at the mid-game stages (first half of 2026 -> second half)?
 * This is the baseline every candidate has to beat. Also prints which existing inputs the refit moves most. */
'use strict';
const C = require('./mid-common'), F = require('./mid-fit');
const rows = C.load(2026);
for (const g of ['s18', 's24', 's30']) {
  const R = rows.filter((r) => r.g === g);
  const { cutDate, A, B } = F.splitByDate(R);
  const o = F.fit(A, null);
  const cmp = F.compare(B, (r) => r.mn0, (r) => F.predict(r, o.beta, null));
  console.log(`\n== ${g}: cut ${cutDate}; train rows ${A.length}, test rows ${B.length} (10+: ${cmp.n})`);
  console.log(`   second half miss: engine ${cmp.a.toFixed(3)} -> plain refit ${cmp.b.toFixed(3)}  (${cmp.pct.toFixed(2)}%, z ${cmp.z.toFixed(1)})`);
  const full = F.fit(R, null);
  const top = full.beta.map((b, i) => ({ k: C.PAT_F[i], b, z: full.z[i] })).filter((t) => Math.abs(t.z) >= 3).sort((a, b2) => Math.abs(b2.z) - Math.abs(a.z));
  console.log('   refit on all of 2026, inputs with |z|>=3: ' + top.map((t) => `${t.k} ${C.fmt(t.b, 3)} (z ${t.z.toFixed(1)})`).join(', '));
}
