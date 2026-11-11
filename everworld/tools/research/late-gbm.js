/* late-gbm: a tiny gradient-boosted regression tree learner (squared loss, histogram splits), plain JS.
 * Only used as a CEILING: how much of the late-game minutes miss could ANY function of the live state remove?
 * (If a handful of simple inputs gets most of what this gets, the inputs are enough.) */
'use strict';
function bins(X, nb = 32) {
  const d = X[0].length, cuts = [];
  for (let j = 0; j < d; j++) {
    const v = X.map((x) => x[j]).sort((a, b) => a - b); const c = [];
    for (let k = 1; k < nb; k++) { const q = v[Math.floor((k * v.length) / nb)]; if (!c.length || q > c[c.length - 1]) c.push(q); }
    cuts.push(c);
  }
  return cuts;
}
const binOf = (c, v) => { let lo = 0, hi = c.length; while (lo < hi) { const m = (lo + hi) >> 1; if (v >= c[m]) lo = m + 1; else hi = m; } return lo; };
function train(X, y, { rounds = 150, depth = 4, lr = 0.08, minLeaf = 40, nb = 32 } = {}) {
  const n = X.length, d = X[0].length, cuts = bins(X, nb);
  const Xb = X.map((x) => Uint8Array.from(x.map((v, j) => binOf(cuts[j], v))));
  const base = y.reduce((a, b) => a + b, 0) / n; const pred = new Float64Array(n).fill(base); const trees = [];
  for (let t = 0; t < rounds; t++) {
    const res = new Float64Array(n); for (let i = 0; i < n; i++) res[i] = y[i] - pred[i];
    const build = (idx, dep) => {
      let s = 0; for (const i of idx) s += res[i]; const mean = s / idx.length;
      if (dep === 0 || idx.length < 2 * minLeaf) return { v: mean * lr };
      let best = null;
      for (let j = 0; j < d; j++) {
        const nbj = cuts[j].length + 1; const hs = new Float64Array(nbj), hc = new Float64Array(nbj);
        for (const i of idx) { hs[Xb[i][j]] += res[i]; hc[Xb[i][j]]++; }
        let ls = 0, lc = 0;
        for (let b = 0; b < nbj - 1; b++) { ls += hs[b]; lc += hc[b]; const rc = idx.length - lc; if (lc < minLeaf || rc < minLeaf) continue; const gain = (ls * ls) / lc + ((s - ls) * (s - ls)) / rc; if (!best || gain > best.gain) best = { gain, j, b }; }
      }
      if (!best || best.gain - (s * s) / idx.length < 1e-9) return { v: mean * lr };
      const L = [], R = []; for (const i of idx) (Xb[i][best.j] <= best.b ? L : R).push(i);
      return { j: best.j, c: cuts[best.j][best.b], l: build(L, dep - 1), r: build(R, dep - 1) };
    };
    const tree = build(Array.from({ length: n }, (_, i) => i), depth); trees.push(tree);
    for (let i = 0; i < n; i++) { let nd = tree; while (nd.v === undefined) nd = X[i][nd.j] < nd.c ? nd.l : nd.r; pred[i] += nd.v; }
  }
  return { base, trees };
}
function predict(m, x) { let p = m.base; for (const t of m.trees) { let nd = t; while (nd.v === undefined) nd = x[nd.j] < nd.c ? nd.l : nd.r; p += nd.v; } return p; }
module.exports = { train, predict };
