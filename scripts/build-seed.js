#!/usr/bin/env node
/**
 * Build bundled seed data so a fresh deploy has ratings + gamer profiles before
 * the collector has run:
 *   data/seed-finals.json    compact H2H finals  [id, t, a, b, teamA, teamB, sa, sb]
 *   data/seed-quarters.json  quarter splits      { id: [q1a,q1b,...,q4a,q4b] }
 *   data/seed-context.json   prebuilt ratings / profiles / pairs
 *
 * Usage:
 *   node scripts/build-seed.js --days <dir of schedule JSON> [--timelines <dir of timeline JSON>]
 *   node scripts/build-seed.js --fetch 21          # download schedules politely (no timelines)
 */

const fs = require('fs');
const path = require('path');
const h2h = require('../src/feeds/h2h');
const ctxMod = require('../src/ebContext');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  let schedule = [];
  const daysDir = arg('--days');
  const fetchDays = Number(arg('--fetch') || 0);
  if (daysDir) {
    for (const f of fs.readdirSync(daysDir)) {
      try {
        const rows = JSON.parse(fs.readFileSync(path.join(daysDir, f), 'utf8'));
        if (Array.isArray(rows)) schedule.push(...rows);
      } catch {
        /* skip */
      }
    }
  } else if (fetchDays) {
    for (let i = 0; i < fetchDays; i += 1) {
      const day = h2h.dayKey(Date.now() - i * 86400000);
      try {
        schedule.push(...(await h2h.schedule(day)));
        console.log(`schedule ${day} ok`);
      } catch (err) {
        console.log(`schedule ${day} ${err.message}`);
      }
      await sleep(2000);
    }
  } else {
    console.error('Pass --days <dir> or --fetch <n>');
    process.exit(1);
  }
  const finals = ctxMod.mergeFinals([], schedule, Date.now());
  const quarters = {};
  const tlDir = arg('--timelines');
  if (tlDir) {
    const byId = new Map(schedule.map((m) => [m.externalId, m]));
    for (const f of fs.readdirSync(tlDir)) {
      const id = f.replace(/\.json$/, '');
      const sched = byId.get(id);
      if (!sched) continue;
      try {
        const parsed = h2h.parseTimeline(JSON.parse(fs.readFileSync(path.join(tlDir, f), 'utf8')), sched);
        if (parsed) quarters[id] = parsed.q.flat();
      } catch {
        /* skip */
      }
    }
  }
  const ctx = ctxMod.buildContext(finals, quarters, Date.now());
  fs.writeFileSync(path.join(outDir, 'seed-finals.json'), JSON.stringify(finals));
  fs.writeFileSync(path.join(outDir, 'seed-quarters.json'), JSON.stringify(quarters));
  fs.writeFileSync(path.join(outDir, 'seed-context.json'), JSON.stringify(ctx));
  console.log(`finals ${finals.length}, quarter splits ${Object.keys(quarters).length}, players ${Object.keys(ctx.ratings.players).length}, profiles ${Object.keys(ctx.profiles).length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
