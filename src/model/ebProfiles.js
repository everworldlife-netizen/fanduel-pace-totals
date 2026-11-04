/**
 * Gamer profiles from official H2H play-by-play quarter splits:
 *   - last-10 first-half game totals (the "60-second pre-game check")
 *   - quarter scoring shape (who starts fast / fades)
 *   - head-to-head pair history vs the ratings model (heavily shrunk)
 */

const { normPlayer, predictGame } = require('./ebRatings');

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * @param {Array<{id,t,a,b,q:Array<[number,number]>}>} qGames games with quarter splits (participant A/B order)
 */
function buildProfiles(qGames) {
  const by = new Map();
  const sorted = (qGames || []).slice().sort((x, y) => y.t - x.t); // newest first
  for (const g of sorted) {
    if (!Array.isArray(g.q) || g.q.length !== 4) continue;
    const qTotals = g.q.map(([x, y]) => x + y);
    const total = qTotals.reduce((s, v) => s + v, 0);
    if (total < 40) continue;
    const half = qTotals[0] + qTotals[1];
    for (const [pl, idx] of [[normPlayer(g.a), 0], [normPlayer(g.b), 1]]) {
      if (!pl) continue;
      const p = by.get(pl) || { halves: [], shares: [0, 0, 0, 0], qFor: [0, 0, 0, 0], qAgainst: [0, 0, 0, 0], n: 0 };
      if (p.halves.length < 10) p.halves.push(half);
      if (p.n < 40) {
        for (let k = 0; k < 4; k += 1) {
          p.shares[k] += qTotals[k] / total;
          p.qFor[k] += g.q[k][idx];
          p.qAgainst[k] += g.q[k][1 - idx];
        }
        p.n += 1;
      }
      by.set(pl, p);
    }
  }
  const out = {};
  for (const [pl, p] of by) {
    const avg = p.halves.reduce((s, v) => s + v, 0) / p.halves.length;
    out[pl] = {
      n: p.n,
      last10Half: { avg: round1(avg), n: p.halves.length, values: p.halves },
      qShare: p.shares.map((s) => round3(s / p.n)),
      qFor: p.qFor.map((s) => round1(s / p.n)),
      qAgainst: p.qAgainst.map((s) => round1(s / p.n)),
      bestQuarter: p.qFor.indexOf(Math.max(...p.qFor)) + 1,
    };
  }
  return out;
}

/** Pair (head-to-head) residuals vs the ratings model. */
function buildPairs(finals, ratings) {
  const pairs = {};
  for (const g of finals || []) {
    const key = [normPlayer(g.a), normPlayer(g.b)].sort().join('|');
    const pred = predictGame(ratings, g).total;
    const total = g.sa + g.sb;
    const p = pairs[key] || { n: 0, resSum: 0, totalSum: 0, last: [] };
    p.n += 1;
    p.resSum += total - pred;
    p.totalSum += total;
    p.last.push([g.t, normPlayer(g.a), g.sa, normPlayer(g.b), g.sb]);
    pairs[key] = p;
  }
  for (const p of Object.values(pairs)) {
    p.resSum = round1(p.resSum);
    p.last = p.last.sort((x, y) => y[0] - x[0]).slice(0, 6);
  }
  return pairs;
}

module.exports = { buildProfiles, buildPairs };
