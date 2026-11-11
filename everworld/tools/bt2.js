#!/usr/bin/env node
/* Courtside test: replay finished games at tip-off, end of Q1, halftime, end of Q3 and 6:00 left in Q4, giving an
 * engine exactly what the live app knew at that moment, and grade it against the final box score.
 *
 *   node tools/bt2.js --engine cs/build/engine.js --seasons 2027 [--from 2026-10-20 --to 2026-11-09]
 *        [--stages 0,12,24,36,42] [--nsims 500] [--lessons builtin|none|<file.json>] [--sit auto|shipped|prev|none]
 *        [--avail tip|report|none] [--jobs 4] [--every 1] [--out data/runs/x.json] [--dump data/runs/x.rows.json.gz] [--tune k=v,k=v]
 *
 * Headline: average miss for players with 10+ real minutes (the in-app accuracy report uses the same rule).
 * Always compare two engines with the same flags on the same games.
 */
'use strict';
const path = require('path');
const { fork } = require('child_process');
const L = require('./lib');
const R = require('./replay');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const opt = {
  engine: arg('--engine', 'cs/build/engine.js'), seasons: String(arg('--seasons', '2027')).split(',').map(Number), from: arg('--from', '0000'), to: arg('--to', '9999'),
  stages: String(arg('--stages', '0,12,24,36,42')).split(',').map((x) => (x === 'rep' ? 'rep' : Number(x))), nsims: +arg('--nsims', 500), lessons: arg('--lessons', 'builtin'), sit: arg('--sit', 'auto'),
  avail: arg('--avail', 'tip'), jobs: +arg('--jobs', 4), every: +arg('--every', 1), out: arg('--out', null), dump: arg('--dump', null), tune: arg('--tune', ''), shard: arg('--shard', null),
  post: has('--no-playoffs') ? false : true,
};

function applyTune(E, s) { for (const kv of String(s || '').split(',').filter(Boolean)) { const [k, v] = kv.split('='); E.TUNE[k] = v === 'true' ? true : v === 'false' ? false : +v; } }

function work(shard, n) {
  const E = R.loadEngine(opt.engine);
  applyTune(E, opt.tune);
  const S = R.loadSeasons(opt.seasons);
  const lessons = opt.lessons === 'builtin' || opt.lessons === 'none' ? null : L.readJSON(path.resolve(L.ROOT, opt.lessons));
  const patterns = opt.lessons === 'builtin' ? E.patBeta(null) : opt.lessons === 'none' ? null : R.patternsFrom(E, lessons);
  const sitCache = {};
  const sitOf = (season) => {
    if (!(season in sitCache)) {
      const mode = opt.sit === 'auto' ? (season >= 2027 ? 'shipped' : 'prev') : opt.sit;
      sitCache[season] = mode === 'shipped' ? R.sitPriorShipped(E, opt.engine) : mode === 'prev' ? R.sitPriorFor(E, season) : {};
    }
    return sitCache[season];
  };
  const acc = Object.fromEntries(opt.stages.map((s) => [s, R.emptyStage()]));
  const dump = opt.dump ? [] : null;
  let used = 0, skipped = 0, k = 0;
  const pick = S.games.filter((it) => it.g.date >= opt.from && it.g.date <= opt.to && (opt.post || !it.g.postseason));
  for (const it of pick) {
    if (k++ % opt.every !== 0) continue;
    if ((k - 1) / opt.every % n !== shard) continue;
    const ctx = R.contextFor(E, S, it, { avail: opt.avail });
    if (!ctx.ok) { skipped++; continue; }
    const plays = L.readJSON(path.join(L.DATA, 'plays', `${it.g.id}.json.gz`));
    for (const el of opt.stages) {
      const m = R.momentAt(E, it.g, plays, el === 'rep' ? 0 : el);
      const proj = E.projectGame({ ...ctx.base, ...(el === 'rep' ? { avail: ctx.availReport } : {}), game: m.game, plays: m.plays, nsims: opt.nsims, seed: it.g.id, patterns, sitPrior: sitOf(it.season) });
      R.score(E, proj, it, acc[el], dump);
    }
    used++;
  }
  return { acc, used, skipped, dump };
}

if (opt.shard != null) {
  const [i, n] = opt.shard.split('/').map(Number);
  const res = work(i, n);
  if (res.dump) { L.writeJSON(`${opt.dump}.part${i}`, res.dump); res.dump = null; }
  process.send(res, () => process.exit(0));
} else {
  const t0 = Date.now();
  const n = Math.max(1, opt.jobs);
  const kids = [];
  for (let i = 0; i < n; i++) kids.push(new Promise((res, rej) => {
    const c = fork(__filename, [...argv, '--shard', `${i}/${n}`], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    let got = null;
    c.on('message', (m) => { got = m; });
    c.on('exit', (code) => (got ? res(got) : rej(new Error(`worker ${i} exited ${code}`))));
  }));
  Promise.all(kids).then((parts) => {
    const acc = Object.fromEntries(opt.stages.map((s) => [s, R.emptyStage()]));
    let used = 0, skipped = 0;
    for (const p of parts) { used += p.used; skipped += p.skipped; for (const s of opt.stages) R.addStage(acc[s], p.acc[s]); }
    const sum = Object.fromEntries(opt.stages.map((s) => [s, R.summarize(acc[s])]));
    if (opt.dump) {
      const fs = require('fs'); const all = [];
      for (let i = 0; i < n; i++) { const f = `${opt.dump}.part${i}`; if (fs.existsSync(f)) { all.push(...L.readJSON(f)); fs.unlinkSync(f); } }
      L.writeJSON(path.resolve(L.ROOT, opt.dump), all);
    }
    const label = { rep: 'pre-lineup', 0: 'tip-off', 12: 'end Q1', 24: 'half', 36: 'end Q3', 42: '6:00 left' };
    console.log(`engine ${opt.engine} | lessons ${opt.lessons} | seasons ${opt.seasons.join(',')} ${opt.from}..${opt.to} | lineups ${opt.avail} | sims ${opt.nsims}${opt.tune ? ' | tune ' + opt.tune : ''}`);
    console.log(`games ${used} (skipped ${skipped}: thin history or no lineup list) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    const pad = (x, w) => String(x).padStart(w);
    console.log('stage      | players |  PTS   REB   AST   3PM   MIN | PTS(avg) | all-in PTS  MIN | top3 | total miss (bias)  line | team pts | chance gap  brier');
    for (const s of opt.stages) {
      const x = sum[s];
      console.log(`${(label[s] || `${s} min`).padEnd(10)} | ${pad(x.n, 7)} | ${pad(x.pts.toFixed(3), 5)} ${pad(x.reb.toFixed(3), 5)} ${pad(x.ast.toFixed(3), 5)} ${pad(x.fg3m.toFixed(3), 5)} ${pad(x.min.toFixed(2), 5)} | ${pad(x.ptsMean.toFixed(3), 8)} | ${pad(x.ptsAll.toFixed(3), 10)} ${pad(x.minAll.toFixed(2), 5)} | ${pad((x.top3 * 100).toFixed(1), 4)} | ${pad(x.total.toFixed(2), 6)} (${pad(x.totalBias.toFixed(2), 5)})  ${pad(x.lineMiss.toFixed(2), 5)} | ${pad(x.team.toFixed(2), 8)} | ${pad((x.calGap * 100).toFixed(2), 6)}%  ${x.brier.toFixed(4)}`);
    }
    if (opt.out) L.writeJSON(path.resolve(L.ROOT, opt.out), { opt, used, skipped, sum, acc, at: new Date().toISOString() });
  }).catch((e) => { console.error(e); process.exit(1); });
}
