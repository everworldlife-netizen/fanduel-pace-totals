#!/usr/bin/env node
/* "Comes true" numbers: for every player and stat, the highest whole number he reaches with a stated chance (the engine's
 * own calibrated chances, every whole number, not only the ladder rungs), against what he really finished with.
 *   node tools/research/v19-02-sure.js --seasons 2026 --from 2026-01-18 --lessons data/lessons/P1H-v17a.json [--to] [--stages rep,0,12,24,36]
 *        [--levels 0.75,0.8,0.85,0.9,0.95] [--jobs 4] [--nsims 500] [--engine cs/build/engine.js] [--out file.json] [--tune k=v] [--lines closing]
 * Prints per stage, stat and level: statements made, how many came true, how big the number is next to the projection.
 * Before the tip a player who does not play is not graded ("if he plays"); once the game is on everyone shown is graded.
 */
'use strict';
const path = require('path');
const { fork } = require('child_process');
const L = require('../lib');
const R = require('../replay');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const opt = {
  engine: arg('--engine', 'cs/build/engine.js'), seasons: String(arg('--seasons', '2027')).split(',').map(Number), from: arg('--from', '0000'), to: arg('--to', '9999'),
  stages: String(arg('--stages', 'rep,0,6,12,18,24,30,36,42')).split(',').map((x) => (x === 'rep' ? 'rep' : Number(x))), nsims: +arg('--nsims', 500), lessons: arg('--lessons', 'builtin'),
  levels: String(arg('--levels', 'e,0.75,0.9,0.95')).split(',').map((x) => (x === 'e' ? 'e' : Number(x))) /* e = the engine's own 9-in-10 number (p.sure) */, jobs: +arg('--jobs', 4), out: arg('--out', null), tune: arg('--tune', ''), shard: arg('--shard', null), minMin: +arg('--min', 0), lines: arg('--lines', 'off') /* closing | first | <minutes>: hand the recorded books' lines to the engine (with --tune lineWPts=... it puts them inside the number) */,
};
const STATS = ['pts', 'reb', 'ast', 'fg3m', 'pra'];
const statOf = (r, k) => (k === 'pra' ? (r.pts || 0) + (r.reb || 0) + (r.ast || 0) : r[k] || 0);
/** The highest whole number above what he has that he reaches with a calibrated chance of q or more (what he has, if none). */
function sureNumber(E, p, k, q, now) {
  const a = p._sims[k]; let best = now, hi = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > hi) hi = a[i];
  for (let t = now + 1; t <= hi; t++) { let c = 0; for (let i = 0; i < a.length; i++) if (a[i] >= t) c++; if (E.calProb(p, k, c / a.length) >= q) best = t; else break; }
  return best;
}
function work(shard, n) {
  const E = R.loadEngine(opt.engine);
  for (const kv of String(opt.tune || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); E.TUNE[k] = +v; }
  const S = R.loadSeasons(opt.seasons);
  const lessons = opt.lessons === 'builtin' || opt.lessons === 'none' ? null : L.readJSON(path.resolve(L.ROOT, opt.lessons));
  const patterns = opt.lessons === 'builtin' ? E.patBeta(null) : opt.lessons === 'none' ? null : R.patternsFrom(E, lessons);
  const sitCache = {};
  const sitOf = (season) => (season in sitCache ? sitCache[season] : (sitCache[season] = season >= 2027 ? R.sitPriorShipped(E, opt.engine) : R.sitPriorFor(E, season)));
  // acc[stage][stat][level] = [statements, came true, sum of the number, sum of the projection, sum of the result, no number (nothing above what he has), sum of what he had]
  const acc = {}; for (const s of opt.stages) { acc[s] = {}; for (const k of STATS) { acc[s][k] = {}; for (const q of opt.levels) acc[s][k][q] = [0, 0, 0, 0, 0, 0, 0]; } }
  const exact = {}; for (const s of opt.stages) { exact[s] = {}; for (const k of STATS) exact[s][k] = [0, 0, 0, 0, 0, 0, 0]; } // players, exact after rounding, within 1, within 2, within 3, finished at or above the shown number, at or above the shown number rounded down
  let used = 0, k0 = 0;
  const pick = S.games.filter((it) => it.g.date >= opt.from && it.g.date <= opt.to && !it.g.postseason);
  for (const it of pick) {
    if (k0++ % n !== shard) continue;
    const ctx = R.contextFor(E, S, it, { avail: 'tip', lines: opt.lines });
    if (!ctx.ok) continue;
    const plays = L.readJSON(path.join(L.DATA, 'plays', `${it.g.id}.json.gz`));
    const rows = it.truth || it.log.rows;
    const byName = {}; for (const [pid, r] of Object.entries(rows)) byName[`${r.team}:${E.norm(r.name)}`] = +pid;
    for (const el of opt.stages) {
      const m = R.momentAt(E, it.g, plays, el === 'rep' ? 0 : el);
      const proj = E.projectGame({ ...ctx.base, ...(ctx.lines ? { lines: ctx.lines, toTip: ctx.lines.toTip } : {}), ...(el === 'rep' ? { avail: ctx.availReport } : {}), game: m.game, plays: m.plays, nsims: opt.nsims, seed: it.g.id, patterns, sitPrior: sitOf(it.season) });
      const pre = proj.state.phase === 'pre';
      for (const p of proj.players) {
        const rid = rows[p.pid] ? +p.pid : (+p.pid < 0 ? byName[`${p.team}:${E.norm(p.name)}`] : undefined);
        const a = rid != null ? rows[rid] : undefined, act = a && a.min > 0 ? a : null;
        if (pre && !act) continue;
        if (p.proj.min < opt.minMin) continue;
        for (const k of STATS) {
          const now = statOf(p.now, k), fin = act ? statOf(act, k) : now;
          const shown = k === 'pra' ? p.proj.pts + p.proj.reb + p.proj.ast : p.proj[k];
          const X = exact[el][k]; const d = Math.abs(Math.round(shown) - fin); X[0]++; if (d === 0) X[1]++; if (d <= 1) X[2]++; if (d <= 2) X[3]++; if (d <= 3) X[4]++; if (fin >= shown) X[5]++; if (fin >= Math.floor(shown)) X[6]++;
          for (const q of opt.levels) {
            const t = q === 'e' ? (p.sure ? p.sure[k] : now) : sureNumber(E, p, k, q, now), A = acc[el][k][q];
            if (t <= now) { A[5]++; continue; }
            A[0]++; if (fin >= t) A[1]++; A[2] += t; A[3] += shown; A[4] += fin; A[6] += now;
          }
        }
      }
    }
    used++;
  }
  return { acc, exact, used };
}
if (opt.shard != null) { const [i, n] = opt.shard.split('/').map(Number); process.send(work(i, n), () => process.exit(0)); }
else {
  const n = Math.max(1, opt.jobs);
  Promise.all(Array.from({ length: n }, (_, i) => new Promise((res, rej) => { const c = fork(__filename, [...argv, '--shard', `${i}/${n}`], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }); let got = null; c.on('message', (m) => { got = m; }); c.on('exit', (code) => (got ? res(got) : rej(new Error(`worker ${i} exited ${code}`)))); }))).then((parts) => {
    const acc = parts[0].acc, exact = parts[0].exact; let used = parts[0].used;
    for (const p of parts.slice(1)) { used += p.used; for (const s of opt.stages) for (const k of STATS) { for (const q of opt.levels) for (let j = 0; j < 7; j++) acc[s][k][q][j] += p.acc[s][k][q][j]; for (let j = 0; j < 7; j++) exact[s][k][j] += p.exact[s][k][j]; } }
    const label = { rep: 'before lineups', 0: 'tip-off' };
    console.log(`engine ${opt.engine} | lessons ${opt.lessons} | seasons ${opt.seasons.join(',')} ${opt.from}..${opt.to} | ${used} games | sims ${opt.nsims}${opt.minMin ? ' | players shown ' + opt.minMin + '+ minutes' : ''}`);
    console.log('\nThe shown number, rounded, against the result: how often exactly right, within 1, within 2, within 3');
    for (const s of opt.stages) console.log(`${String(label[s] || s + ' min').padEnd(14)} ${STATS.map((k) => { const X = exact[s][k]; return `${k} ${(100 * X[1] / X[0]).toFixed(0)}/${(100 * X[2] / X[0]).toFixed(0)}/${(100 * X[3] / X[0]).toFixed(0)}/${(100 * X[4] / X[0]).toFixed(0)}%`; }).join('  |  ')}   (${exact[s].pts[0]} players)`);
    console.log('\nHow often the player finished AT OR ABOVE the shown number (the shown number is a middle: about half by design)');
    for (const s of opt.stages) console.log(`${String(label[s] || s + ' min').padEnd(14)} ${STATS.map((k) => { const X = exact[s][k]; return `${k} ${(100 * X[5] / X[0]).toFixed(0)}%`; }).join('  |  ')}`);
    for (const q of opt.levels) {
      console.log(`\n${q === 'e' ? "The engine's 9-in-10 number (p.sure)" : `Stated chance ${Math.round(q * 100)}%`}: came true % (statements) | the number as a share of what was still to come in the projection`);
      for (const s of opt.stages) console.log(`${String(label[s] || s + ' min').padEnd(14)} ${STATS.map((k) => { const A = acc[s][k][q]; return `${k} ${A[0] ? (100 * A[1] / A[0]).toFixed(1) : '—'}% (${A[0]}) ${A[0] && A[3] - A[6] > 0 ? Math.round((100 * (A[2] - A[6])) / (A[3] - A[6])) : '—'}%`; }).join('  |  ')}`);
    }
    if (opt.out) L.writeJSON(path.resolve(L.ROOT, opt.out), { opt, used, acc, exact, at: new Date().toISOString() });
  });
}
module.exports = { sureNumber };
