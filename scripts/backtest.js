#!/usr/bin/env node
/*
 * Backtest the live engine on finished games.
 *
 *   node scripts/backtest.js 2026-10-29 2026-10-30
 *
 * For each final game on those dates, replays DataBallr play-by-play up to a checkpoint
 * (pregame, end Q1, half, end Q3), projects every player with only data that existed then
 * (season logs from earlier dates, last season's priors), and scores projections against
 * the real finals: MAE / bias per stat and calibration of the over-probability ladders.
 * Responses are cached under .cache/databallr so reruns don't re-hit the API.
 */
const { E, get, addDays, iso, logsBefore, truncate } = require('./lib/replay');

function naive(now, mpg, rate, left) {
  // baseline: stat so far + season per-minute rate x (season share of time left)
  return now + rate * Math.min(mpg / 48, 0.85) * left;
}

// TUNE overrides: TUNE='{"tonightW":0.3}' node scripts/backtest.js ...
if (process.env.TUNE) Object.assign(E.TUNE, JSON.parse(process.env.TUNE));

(async () => {
  const dates = process.argv.slice(2);
  const team = { abs: 0, bias: 0, n: 0 };
  if (!dates.length) dates.push(addDays(iso(new Date()), -1));
  const last = E.slimStats(await get('/v1/nba/players/stats?year=2026&playoffs=0&limit=1000'));
  const STATS = ['pts', 'reb', 'ast', 'fg3m'];
  const CPS = ['pre', 'q1', 'half', 'q3'];
  const err = {}; // cp -> stat -> {abs, sq, bias, n, nabs}
  const calib = {}; // bucket -> {p, hit, n}
  for (const cp of CPS) { err[cp] = {}; for (const s of STATS) err[cp][s] = { abs: 0, bias: 0, n: 0, nabs: 0 }; }
  let games = 0;
  for (const date of dates) {
    const slate = (await get(`/v1/nba/live/games/${date}`, { fresh: true })).data || [];
    for (const g of slate) {
      if (g.status_state !== 'final') continue;
      const plays = (await get(`/v1/nba/games/${g.id}/plays`)).data || [];
      const st = E.gameState(g);
      const finalBox = E.boxFromPlays(plays, st.period, '0:00').players;
      const logs = await logsBefore([st.v, st.h], date);
      let inj = [];
      try { inj = (await get(`/v1/nba/injuries?date=${date}`)).data || []; } catch { /* optional */ }
      games++;
      for (const cp of CPS) {
        const t = truncate(g, plays, cp);
        const proj = E.projectGame({ game: t.game, plays: t.plays, logs, priors: { last }, injuries: inj, nsims: 1500, seed: g.id });
        for (const [abbr, fs] of [[st.v, st.vs], [st.h, st.hs]]) { const d = proj.projScore[abbr] - fs; team.abs += Math.abs(d); team.bias += d; team.n++; }
        for (const p of proj.players) {
          const fin = finalBox[p.pid];
          if (!fin || fin.min < 10) continue;
          for (const s of STATS) {
            const e = err[cp][s];
            const d = p.proj[s] - fin[s];
            e.abs += Math.abs(d); e.bias += d; e.n++;
            const lp = last[E.norm(p.name)];
            const rate = lp ? lp[s] : 0;
            e.nabs += Math.abs(naive(p.now[s], p.mpg || 20, rate, proj.state.left) - fin[s]);
          }
          if (cp !== 'pre') {
            for (const s of ['pts', 'reb', 'ast', 'fg3m']) for (const rung of p.ladders[s]) {
              if (rung.t <= p.now[s] || rung.p < 0.05 || rung.p > 0.95) continue;
              const b = Math.min(9, Math.floor(rung.p * 10));
              calib[b] = calib[b] || { p: 0, hit: 0, n: 0 };
              calib[b].p += rung.p; calib[b].hit += fin[s] >= rung.t ? 1 : 0; calib[b].n++;
            }
          }
        }
      }
      process.stderr.write(`  ${date} ${st.v}@${st.h} done (${logs.length} log games)\n`);
    }
  }
  console.log(`\nBacktest: ${games} games on ${dates.join(', ')} (players with 10+ actual minutes)\n`);
  console.log('checkpoint |  stat | MAE model | MAE naive | bias');
  for (const cp of CPS) for (const s of STATS) {
    const e = err[cp][s];
    if (!e.n) continue;
    console.log(`${cp.padEnd(10)} | ${s.padStart(5)} | ${(e.abs / e.n).toFixed(2).padStart(9)} | ${(e.nabs / e.n).toFixed(2).padStart(9)} | ${(e.bias / e.n >= 0 ? '+' : '') + (e.bias / e.n).toFixed(2)}`);
  }
  console.log(`\nTeam final score (all checkpoints): MAE ${(team.abs / team.n).toFixed(2)}  bias ${(team.bias / team.n).toFixed(2)}`);
  console.log('\nCalibration (live checkpoints): predicted P(over rung) vs actual hit rate');
  let brier = 0, bn = 0;
  for (const b of Object.keys(calib).sort((a, b) => a - b)) {
    const c = calib[b];
    console.log(`  ${(b * 10).toString().padStart(2)}-${b * 10 + 10}%  predicted ${(100 * c.p / c.n).toFixed(1)}%  actual ${(100 * c.hit / c.n).toFixed(1)}%  (n=${c.n})`);
  }
  for (const b of Object.keys(calib)) { const c = calib[b]; brier += c.n * Math.pow(c.p / c.n - c.hit / c.n, 2); bn += c.n; }
  console.log(`  calibration error (weighted squared gap): ${(brier / Math.max(bn, 1)).toFixed(4)}`);
})().catch((e) => { console.error(e); process.exit(1); });
