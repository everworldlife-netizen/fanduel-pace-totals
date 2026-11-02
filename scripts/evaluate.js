#!/usr/bin/env node
/*
 * Live-accuracy evaluation: replays every finished game at six live moments and scores the
 * engine the way the app is used.
 *
 *   node scripts/evaluate.js 2026-10-25 2026-11-01          (date range, inclusive)
 *   TUNE='{"tonightW":0.3}' node scripts/evaluate.js ...     (try a setting)
 *   EVAL_JSON=out.json node scripts/evaluate.js ...          (save the summary for diffing)
 *
 * Checkpoints: end Q1, 6:00 Q2, half, 6:00 Q3, end Q3, 6:00 Q4 (mid-quarter moments matter:
 * players are mid-stint, sitting with fouls, or just pulled).
 *
 * Reports
 *   - MAE / bias per stat and minutes (players with 10+ real minutes or a 12+ mpg regular)
 *   - ladder Brier score per stat (every rung above what the player already has: a fixed set)
 *   - calibration buckets per stat
 *   - the app's own "safe ladder" picks (75%+ rungs): predicted vs actual hit rate
 *   - minutes error by situation: foul trouble, on court vs sitting, starters vs bench
 */
const fs = require('fs');
const { E, get, addDays, logsBefore } = require('./lib/replay');

if (process.env.TUNE) Object.assign(E.TUNE, JSON.parse(process.env.TUNE));

const CPS = [
  { key: 'q1', period: 1, clock: 0 },
  { key: 'q2mid', period: 2, clock: 360 },
  { key: 'half', period: 2, clock: 0 },
  { key: 'q3mid', period: 3, clock: 360 },
  { key: 'q3', period: 3, clock: 0 },
  { key: 'q4mid', period: 4, clock: 360 },
];
const STATS = ['pts', 'reb', 'ast', 'fg3m'];

function cut(game, plays, cp) {
  const kept = plays.filter((p) => p.period < cp.period || (p.period === cp.period && E.clockSec(p.clock) >= cp.clock));
  const lastP = kept[kept.length - 1] || { away_score: 0, home_score: 0 };
  const time = cp.clock === 0 ? (cp.period === 2 ? 'Half' : 'END Q' + cp.period) : `Q${cp.period} ${Math.floor(cp.clock / 60)}:${String(cp.clock % 60).padStart(2, '0')}`;
  return {
    game: { ...game, period: cp.period, time, status_state: 'live', display_status: 'live', visitor_team_score: lastP.away_score, home_team_score: lastP.home_score },
    plays: kept,
  };
}

function dateRange(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

(async () => {
  const [from, to] = process.argv.slice(2);
  const dates = dateRange(from || '2026-10-25', to || from || '2026-11-01');
  const last = E.slimStats(await get('/v1/nba/players/stats?year=2026&playoffs=0&limit=1000'));
  const err = {}; // cp -> key -> {abs, bias, n}
  const brier = {}; // stat -> {sum, n}
  const calib = {}; // stat -> bucket -> {p, hit, n}
  const picks = {}; // stat -> {p, hit, n}
  const sit = {}; // situation -> {abs, bias, n}  (minutes left error)
  const add = (o, k, d) => { const e = (o[k] = o[k] || { abs: 0, bias: 0, n: 0 }); e.abs += Math.abs(d); e.bias += d; e.n++; };
  let games = 0;
  for (const date of dates) {
    let slate;
    try { slate = (await get(`/v1/nba/live/games/${date}`)).data || []; } catch { continue; }
    let inj = [];
    try { inj = (await get(`/v1/nba/injuries?date=${date}`)).data || []; } catch { /* optional */ }
    for (const g of slate) {
      if (g.status_state !== 'final') continue;
      const plays = (await get(`/v1/nba/games/${g.id}/plays`)).data || [];
      const st = E.gameState(g);
      const fin = E.boxFromPlays(plays, st.period, '0:00').players;
      const logs = await logsBefore([st.v, st.h], date);
      if (!logs.length) continue;
      games++;
      for (const cp of CPS) {
        const t = cut(g, plays, cp);
        const proj = E.projectGame({ game: t.game, plays: t.plays, logs, priors: { last }, injuries: inj, nsims: 1200, seed: g.id });
        const E_ = (err[cp.key] = err[cp.key] || {});
        for (const p of proj.players) {
          const f = fin[p.pid] || { pts: 0, reb: 0, ast: 0, fg3m: 0, min: 0 };
          // fixed population (doesn't depend on the projection): real 10+ minutes, or a 12+ mpg regular
          if (f.min < 10 && !(p.mpg >= 12)) continue;
          for (const s of STATS) add(E_, s, p.proj[s] - f[s]);
          const dMin = p.proj.min - f.min;
          add(E_, 'min', dMin);
          // minutes-left error by situation
          const pf = p.now.pf, per = cp.period;
          const foul = (pf >= 2 && per === 1) || (pf >= 3 && per === 2) || (pf >= 4 && per === 3) || (pf >= 5 && per === 4);
          add(sit, foul ? `foul trouble (${pf} PF in Q${per})` : 'no foul trouble', dMin);
          if (foul) add(sit, 'foul trouble (all)', dMin);
          add(sit, p.on ? 'on court at checkpoint' : 'sitting at checkpoint', dMin);
          add(sit, p.starter ? 'starter' : 'bench', dMin);
          if (p.flags.includes('hot')) add(sit, 'flagged hot', dMin);
          if (f.min < 10) add(sit, 'regular who played <10', dMin);
          for (const s of STATS) for (const rung of p.ladders[s]) {
            if (rung.t <= p.now[s]) continue;
            const hit = f[s] >= rung.t ? 1 : 0;
            // Brier over every rung above what he has (a fixed set, so settings compare fairly)
            const b = (brier[s] = brier[s] || { sum: 0, n: 0 });
            b.sum += (rung.p - hit) ** 2; b.n++;
            if (rung.p < 0.05 || rung.p > 0.95) continue;
            const bk = Math.min(9, Math.floor(rung.p * 10));
            const c = ((calib[s] = calib[s] || {})[bk] = calib[s][bk] || { p: 0, hit: 0, n: 0 });
            c.p += rung.p; c.hit += hit; c.n++;
          }
        }
        for (const pk of E.picksForGame(proj, {})) {
          const f = fin[pk.pid] || { pts: 0, reb: 0, ast: 0, fg3m: 0 };
          const hit = f[pk.stat] > pk.line ? 1 : 0;
          const o = (picks[pk.stat] = picks[pk.stat] || { p: 0, hit: 0, n: 0 });
          o.p += pk.prob; o.hit += hit; o.n++;
          const all = (picks.all = picks.all || { p: 0, hit: 0, n: 0 });
          all.p += pk.prob; all.hit += hit; all.n++;
        }
      }
      process.stderr.write(`  ${date} ${st.v}@${st.h} (${logs.length} logs)\n`);
    }
  }
  const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
  console.log(`\nLive evaluation: ${games} games, ${dates[0]} → ${dates[dates.length - 1]}\n`);
  console.log('checkpoint |   pts MAE  bias |  reb MAE  bias |  ast MAE  bias | 3pm MAE  bias |  min MAE  bias');
  const summary = { games, mae: {}, brier: {}, picks: {}, sit: {} };
  for (const cp of CPS) {
    const e = err[cp.key]; if (!e) continue;
    const cell = (k) => `${(e[k].abs / e[k].n).toFixed(2).padStart(8)} ${f2(e[k].bias / e[k].n).padStart(5)}`;
    console.log(`${cp.key.padEnd(10)} |${cell('pts')} |${cell('reb')} |${cell('ast')} |${cell('fg3m')} |${cell('min')}`);
    summary.mae[cp.key] = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, +(v.abs / v.n).toFixed(3)]));
  }
  const avg = {};
  for (const k of [...STATS, 'min']) { let a = 0, n = 0; for (const cp of CPS) if (err[cp.key]) { a += err[cp.key][k].abs; n += err[cp.key][k].n; } avg[k] = a / n; }
  console.log(`ALL        | ${Object.entries(avg).map(([k, v]) => `${k} ${v.toFixed(3)}`).join('  ')}`);
  summary.mae.all = avg;
  console.log('\nLadder Brier (lower = sharper + better calibrated):', STATS.map((s) => `${s} ${(brier[s].sum / brier[s].n).toFixed(4)}`).join('  '));
  for (const s of STATS) summary.brier[s] = +(brier[s].sum / brier[s].n).toFixed(5);
  console.log('\nCalibration (predicted → actual) per stat:');
  for (const s of STATS) {
    const row = Object.keys(calib[s]).sort((a, b) => a - b).map((b) => { const c = calib[s][b]; return `${(100 * c.p / c.n).toFixed(0)}→${(100 * c.hit / c.n).toFixed(0)}`; });
    console.log(`  ${s.padEnd(5)} ${row.join('  ')}`);
  }
  console.log("\nApp's safe-ladder picks (75%+ rungs): predicted vs actual hit rate");
  for (const [s, o] of Object.entries(picks)) { console.log(`  ${s.padEnd(5)} n=${String(o.n).padStart(4)}  predicted ${(100 * o.p / o.n).toFixed(1)}%  hit ${(100 * o.hit / o.n).toFixed(1)}%`); summary.picks[s] = { n: o.n, pred: +(o.p / o.n).toFixed(4), hit: +(o.hit / o.n).toFixed(4) }; }
  console.log('\nMinutes error (projected − actual final minutes) by situation:');
  for (const [k, o] of Object.entries(sit).sort()) { console.log(`  ${k.padEnd(34)} n=${String(o.n).padStart(4)}  MAE ${(o.abs / o.n).toFixed(2)}  bias ${f2(o.bias / o.n)}`); summary.sit[k] = { n: o.n, mae: +(o.abs / o.n).toFixed(3), bias: +(o.bias / o.n).toFixed(3) }; }
  if (process.env.EVAL_JSON) fs.writeFileSync(process.env.EVAL_JSON, JSON.stringify(summary, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
