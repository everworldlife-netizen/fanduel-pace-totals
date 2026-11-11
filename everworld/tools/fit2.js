#!/usr/bin/env node
/* Learn Courtside's lessons (the corrections in PAT_PRIOR and the chance calibration in CAL_PRIOR) from finished games.
 * Every game is replayed at tip-off and every 6 game minutes with the inputs the live app has, in three passes:
 *   1. plain engine           → minutes lessons
 *   2. + minutes lessons      → points, rebounds, assists, threes lessons (learned on top of corrected minutes, as used live)
 *   3. + all lessons          → how often the simulated chances really came in (calibration)
 * Targets are the plain averages (`mean`), never the shown most-likely finish and never trimmed.
 *
 *   node tools/fit2.js --engine cs/build/engine.js --seasons 2025,2026 [--from D --to D] --out data/lessons/x.json
 *        [--nsims 300] [--jobs 4] [--every 1] [--lam 32] [--sit auto|prev|shipped|none] [--tune k=v,...] [--passes 3]
 */
'use strict';
const path = require('path');
const { fork } = require('child_process');
const L = require('./lib');
const R = require('./replay');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const opt = {
  engine: arg('--engine', 'cs/build/engine.js'), seasons: String(arg('--seasons', '2026')).split(',').map(Number), from: arg('--from', '0000'), to: arg('--to', '9999'),
  nsims: +arg('--nsims', 300), jobs: +arg('--jobs', 4), every: +arg('--every', 1), out: arg('--out', 'data/lessons/fit.json'), lam: arg('--lam', null), sit: arg('--sit', 'auto'),
  tune: arg('--tune', ''), passes: +arg('--passes', 3), post: !argv.includes('--no-playoffs'), pass: arg('--pass', null), shard: arg('--shard', null), lessonsIn: arg('--lessons-in', null), avail: arg('--avail', 'tip'),
};
// --stages 0,rep refits only those stages (the others are left out of the file: merge with tools/mklessons.js)
const STAGES = arg('--stages', null) ? String(arg('--stages')).split(',').map((x) => (x === 'rep' ? 'rep' : +x)) : [0, 6, 12, 18, 24, 30, 36, 42, 'rep'];
function applyTune(E, s) { for (const kv of String(s || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); E.TUNE[k] = v === 'true' ? true : v === 'false' ? false : +v; } }

/** One pass over a shard of the games: grade with the given lessons applied, return the sums. */
function work(shard, n, pass) {
  const E = R.loadEngine(opt.engine);
  applyTune(E, opt.tune);
  const S = R.loadSeasons(opt.seasons);
  const lessons = opt.lessonsIn ? L.readJSON(path.resolve(L.ROOT, opt.lessonsIn)) : null;
  // pass 1: nothing applied; pass 2: minutes lessons only; pass 3: everything but the calibration
  const patterns = pass === 1 ? null : R.patternsFrom(E, lessons, { minOnly: pass === 2, noCal: true });
  const only = pass === 1 ? ['min'] : pass === 2 ? ['pts', 'reb', 'ast', 'fg3m'] : ['pts'];
  const sitCache = {};
  const sitOf = (season) => { if (!(season in sitCache)) { const mode = opt.sit === 'auto' ? (season >= 2027 ? 'shipped' : 'prev') : opt.sit; sitCache[season] = mode === 'shipped' ? R.sitPriorShipped(E, opt.engine) : mode === 'prev' ? R.sitPriorFor(E, season) : {}; } return sitCache[season]; };
  const acc = E.patEmpty();
  let used = 0, k = 0;
  for (const it of S.games) {
    if (it.g.date < opt.from || it.g.date > opt.to || (!opt.post && it.g.postseason)) continue;
    if (k++ % opt.every !== 0) continue;
    if ((k - 1) / opt.every % n !== shard) continue;
    const ctx = R.contextFor(E, S, it, { avail: opt.avail });
    if (!ctx.ok) continue;
    const plays = L.readJSON(path.join(L.DATA, 'plays', `${it.g.id}.json.gz`));
    for (const el of STAGES) {
      if (el === 'rep' && !(E.TUNE.repGroup > 0)) continue;
      const m = R.momentAt(E, it.g, plays, el === 'rep' ? 0 : el);
      // same convention as the phone's nightly learning: with no line saved, the top-down team check sits out
      const proj = E.projectGame({ ...ctx.base, ...(el === 'rep' ? { avail: ctx.availReport } : {}), game: m.game, plays: m.plays, nsims: opt.nsims, seed: it.g.id, patterns, sitPrior: sitOf(it.season), tdOff: !ctx.base.market });
      E.patGrade(proj, it.log.rows, acc, { only });
      // pass 3 (every lesson applied): how each team's points still to come ran against the sum of our players
      if (pass === 3) E.patScore(proj, it.log.rows, acc);
    }
    used++;
  }
  return { acc, used };
}

function runPass(pass, lessonsIn) {
  const n = Math.max(1, opt.jobs);
  const extra = ['--pass', String(pass)].concat(lessonsIn ? ['--lessons-in', lessonsIn] : []);
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(new Promise((res, rej) => {
    const c = fork(__filename, [...argv, ...extra, '--shard', `${i}/${n}`], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    let got = null;
    c.on('message', (m) => { got = m; });
    c.on('exit', (code) => (got ? res(got) : rej(new Error(`worker ${i} exited ${code}`))));
  }));
  return Promise.all(kids);
}

if (opt.shard != null) {
  const [i, n] = opt.shard.split('/').map(Number);
  const res = work(i, n, +opt.pass);
  // sums are big: hand them over through a file
  const f = path.resolve(L.ROOT, `${opt.out}.p${opt.pass}.s${i}.gz`);
  L.writeJSON(f, res.acc);
  process.send({ file: f, used: res.used }, () => process.exit(0));
} else (async () => {
  const fs = require('fs');
  const E = R.loadEngine(opt.engine);
  applyTune(E, opt.tune);
  const lam = opt.lam != null ? +opt.lam : E.TUNE.patLam;
  const D = E.PAT_F.length;
  const outPath = path.resolve(L.ROOT, opt.out);
  const lessons = { PAT_PRIOR: {}, CAL_PRIOR: {}, meta: { engine: opt.engine, seasons: opt.seasons, from: opt.from, to: opt.to, nsims: opt.nsims, lam, tune: opt.tune, features: E.PAT_F.slice(), games: 0, at: new Date().toISOString() } };
  for (const g of E.PAT_GROUPS) lessons.PAT_PRIOR[g] = {};
  const r3 = (x) => +(+x).toPrecision(3);
  const take = (sum, stats) => {
    const sol = E.patSolve(sum, lam);
    for (const g of E.PAT_GROUPS) for (const s of stats) {
      const T = sum[g] && sum[g][s];
      if (!T || !sol[g] || !sol[g][s]) continue;
      lessons.PAT_PRIOR[g][s] = { b: sol[g][s], d: Array.from({ length: D }, (_, i) => r3(T.A[i * D + i])), n: T.n, w: r3(T.w) };
    }
  };
  const merge = (parts) => { const sum = E.patEmpty(); let used = 0; for (const p of parts) { E.patAdd(sum, L.readJSON(p.file)); fs.unlinkSync(p.file); used += p.used; } return { sum, used }; };
  const t0 = Date.now();
  const tmp = `${opt.out}.tmp.json`;
  // pass 1: minutes
  let r = merge(await runPass(1, null));
  lessons.meta.games = r.used;
  take(r.sum, ['min']);
  L.writeJSON(path.resolve(L.ROOT, tmp), lessons);
  console.error(`pass 1 (minutes): ${r.used} games, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  // pass 2: stats on top of the corrected minutes
  r = merge(await runPass(2, tmp));
  take(r.sum, ['pts', 'reb', 'ast', 'fg3m']);
  if (opt.passes < 3) lessons.CAL_PRIOR = r.sum.cal;
  L.writeJSON(path.resolve(L.ROOT, tmp), lessons);
  console.error(`pass 2 (stats): ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  // pass 3: calibration of the chances with every lesson applied
  if (opt.passes >= 3) {
    r = merge(await runPass(3, tmp));
    lessons.CAL_PRIOR = r.sum.cal;
    if (r.sum.team) lessons.TEAM_PRIOR = Object.fromEntries(Object.entries(r.sum.team).filter(([, t]) => t && t[0] > 0).map(([g, t]) => [g, [t[0], Math.round(t[1]), Math.round(t[2])]]));
    console.error(`pass 3 (calibration): ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // round the calibration sums like the shipped table
  for (const g of Object.keys(lessons.CAL_PRIOR || {})) for (const s of Object.keys(lessons.CAL_PRIOR[g])) lessons.CAL_PRIOR[g][s] = lessons.CAL_PRIOR[g][s].map((lvl) => lvl.map((b) => [b[0], +b[1].toFixed(2), b[2]]));
  fs.unlinkSync(path.resolve(L.ROOT, tmp));
  L.writeJSON(outPath, lessons);
  console.log(`lessons from ${lessons.meta.games} games → ${opt.out}`);
})().catch((e) => { console.error(e); process.exit(1); });
