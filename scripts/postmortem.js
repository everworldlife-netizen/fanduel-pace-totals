#!/usr/bin/env node
/*
 * Post-mortem: why were projections off?  node scripts/postmortem.js 2026-10-31 [checkpoint]
 *
 * For each finished game, projects every player at the checkpoint and compares with the real
 * final line. Each points miss is split into:
 *   minutes  — (proj min - actual min) x projected scoring rate
 *   volume   — shot attempts per minute off (usage)
 *   shooting — points per attempt off (makes)
 * and roster misses (played but not projected / projected but sat) are listed separately.
 */
const { E, get, logsBefore, truncate } = require('./lib/replay');

if (process.env.TUNE) Object.assign(E.TUNE, JSON.parse(process.env.TUNE));

(async () => {
  const date = process.argv[2];
  const cp = process.argv[3] || 'half';
  const last = E.slimStats(await get('/v1/nba/players/stats?year=2026&playoffs=0&limit=1000'));
  const slate = (await get(`/v1/nba/live/games/${date}`, { fresh: true })).data || [];
  let inj = [];
  try { inj = (await get(`/v1/nba/injuries?date=${date}`)).data || []; } catch { /* optional */ }
  const all = [];
  const roster = [];
  const games = [];
  for (const g of slate) {
    if (g.status_state !== 'final') continue;
    const plays = (await get(`/v1/nba/games/${g.id}/plays`)).data || [];
    const st = E.gameState(g);
    const fin = E.boxFromPlays(plays, st.period, '0:00').players;
    const logs = await logsBefore([st.v, st.h], date);
    const t = truncate(g, plays, cp);
    const proj = E.projectGame({ game: t.game, plays: t.plays, logs, priors: { last }, injuries: inj, nsims: 2000, seed: g.id });
    const ps = proj.state;
    games.push({ tag: `${st.v} ${st.vs}-${st.hs} ${st.h}`, at: `${ps.v} ${ps.vs}-${ps.hs} ${ps.h}`, proj: proj.projScore, pBlow: proj.blowout.pBlow, finalMargin: st.vs - st.hs, ot: st.period > 4 });
    const seen = new Set();
    for (const p of proj.players) {
      seen.add(+p.pid);
      const f = fin[p.pid];
      const actual = f ? { pts: f.pts, reb: f.reb, ast: f.ast, fg3m: f.fg3m, fga: f.fga, fta: f.fta, min: f.min } : { pts: 0, reb: 0, ast: 0, fg3m: 0, fga: 0, fta: 0, min: 0 };
      if (p.proj.min >= 10 && actual.min < 3) roster.push(`${p.team} ${p.name}: projected ${p.proj.min.toFixed(0)} min, played ${actual.min.toFixed(0)} (${proj.state.v}@${proj.state.h})`);
      if (actual.min < 10 && p.proj.min < 10) continue;
      const remP = p.proj.min - p.now.min, remA = actual.min - p.now.min;
      const ptsRateP = remP > 0.5 ? (p.proj.pts - p.now.pts) / remP : 0;
      const minErr = (remP - remA) * ptsRateP;
      const attP = p.proj.fga + 0.44 * p.proj.fta - p.now.fga - 0.44 * p.now.fta;
      const attA = actual.fga + 0.44 * actual.fta - p.now.fga - 0.44 * p.now.fta;
      const ppaP = attP > 0.3 ? (p.proj.pts - p.now.pts) / attP : 0;
      const ppaA = attA > 0.3 ? (actual.pts - p.now.pts) / attA : 0;
      const volErr = remA > 0.5 && remP > 0.5 ? (attP / remP - attA / remA) * remA * ppaP : 0;
      const shotErr = (ppaP - ppaA) * Math.max(attA, 0);
      all.push({ game: `${proj.state.v}@${proj.state.h}`, team: p.team, name: p.name, starter: p.starter, nowMin: p.now.min,
        projPts: p.proj.pts, pts: actual.pts, projMin: p.proj.min, min: actual.min, projReb: p.proj.reb, reb: actual.reb, projAst: p.proj.ast, ast: actual.ast,
        projFga: p.proj.fga, fga: actual.fga, err: p.proj.pts - actual.pts, minErr, volErr, shotErr, finalMargin: Math.abs(st.vs - st.hs) });
    }
    for (const [pid, f] of Object.entries(fin)) {
      if ((f.team === st.v || f.team === st.h) && f.min >= 10 && !seen.has(+pid)) roster.push(`${f.team} ${f.name}: NOT projected, played ${f.min.toFixed(0)} min, ${f.pts} pts (${st.v}@${st.h})`);
    }
  }
  console.log(`\n=== ${date} · checkpoint: ${cp} ===`);
  for (const g of games) console.log(`${g.tag}${g.ot ? ' (OT)' : ''} | at ${cp}: ${g.at} | proj ${Object.entries(g.proj).map(([k, v]) => k + ' ' + v.toFixed(0)).join('-')} | P(20+ into Q4) ${(g.pBlow * 100).toFixed(0)}%`);
  const mae = (k, a) => all.reduce((s, r) => s + Math.abs(r['proj' + k] - r[a]), 0) / all.length;
  console.log(`\nplayers: ${all.length}  MAE pts ${mae('Pts', 'pts').toFixed(2)}  reb ${mae('Reb', 'reb').toFixed(2)}  ast ${mae('Ast', 'ast').toFixed(2)}  min ${mae('Min', 'min').toFixed(2)}`);
  const sum = (k) => all.reduce((s, r) => s + Math.abs(r[k]), 0);
  const tot = sum('minErr') + sum('volErr') + sum('shotErr');
  console.log(`points-miss share → minutes ${(100 * sum('minErr') / tot).toFixed(0)}% · shot volume ${(100 * sum('volErr') / tot).toFixed(0)}% · shooting ${(100 * sum('shotErr') / tot).toFixed(0)}%`);
  const bl = all.filter((r) => r.finalMargin >= 18), cl = all.filter((r) => r.finalMargin < 18);
  const m = (arr, k1, k2) => (arr.length ? arr.reduce((s, r) => s + Math.abs(r[k1] - r[k2]), 0) / arr.length : 0);
  const b = (arr, k1, k2) => (arr.length ? arr.reduce((s, r) => s + (r[k1] - r[k2]), 0) / arr.length : 0);
  console.log(`blowout games (final ≥18): n=${bl.length} MAE pts ${m(bl, 'projPts', 'pts').toFixed(2)} min ${m(bl, 'projMin', 'min').toFixed(2)} | starters min bias ${b(bl.filter((r) => r.starter), 'projMin', 'min').toFixed(2)} bench min bias ${b(bl.filter((r) => !r.starter), 'projMin', 'min').toFixed(2)}`);
  console.log(`close games    (final <18): n=${cl.length} MAE pts ${m(cl, 'projPts', 'pts').toFixed(2)} min ${m(cl, 'projMin', 'min').toFixed(2)} | starters min bias ${b(cl.filter((r) => r.starter), 'projMin', 'min').toFixed(2)} bench min bias ${b(cl.filter((r) => !r.starter), 'projMin', 'min').toFixed(2)}`);
  console.log('\nBiggest points misses (proj → actual) with cause split:');
  for (const r of all.sort((a, b2) => Math.abs(b2.err) - Math.abs(a.err)).slice(0, 18)) {
    const parts = [['min', r.minErr], ['vol', r.volErr], ['shoot', r.shotErr]].sort((a, b2) => Math.abs(b2[1]) - Math.abs(a[1]));
    console.log(`  ${r.game.padEnd(8)} ${r.team} ${r.name.slice(0, 22).padEnd(22)} pts ${r.projPts.toFixed(1).padStart(5)} → ${String(r.pts).padStart(2)} | min ${r.projMin.toFixed(0).padStart(2)} → ${r.min.toFixed(0).padStart(2)} | FGA ${r.projFga.toFixed(1).padStart(4)} → ${String(r.fga).padStart(2)} | main cause: ${parts[0][0]} (${parts.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(1)}`).join(', ')})`);
  }
  console.log('\nRoster misses:');
  for (const x of roster) console.log('  ' + x);
})().catch((e) => { console.error(e); process.exit(1); });
