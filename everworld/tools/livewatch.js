#!/usr/bin/env node
/* Watch the PUBLISHED Courtside app during a real game, the way a phone shows it, and check what it shows.
 *   node tools/livewatch.js [--game <id>] [--minutes 45] [--local]
 * One page at Pixel 9a size on the game's screen, left to refresh by itself; a look every 20 seconds. Once a minute the
 * game's play-by-play is read straight from the feed and boxed with the engine, to compare every player's 3PM count on
 * screen with the made threes in the feed (version 17 counts the ones the feed words without "three point").
 * Without --game: the first game of today's slate that has not finished (earliest tip). Start it a few minutes before
 * the tip to see the numbers cross it. Log: data/livewatch/<date>-<game>.jsonl; the summary is printed at the end
 * (and again with:  node tools/livewatch.js --read <log>).
 * Checks: page errors, the two banned words, odd tokens (NaN, undefined), a projection below what the player has,
 * a player on the floor tagged NOT IN YET, how far numbers move between two looks with nothing new for the player,
 * how far they move across the tip, and 3PM on screen against the feed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const L = require('./lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const E = require(path.join(L.ROOT, 'cs', 'build', 'engine.js'));
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').replace(/ (jr|sr|ii|iii|iv)$/, '').trim();
const etDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** "PTS23.5now 4REB9now 1AST1.5now 03PM0.5now 0" (live) or "PTS24projREB9.5projAST2proj3PM0.5proj" (before the game). */
function parseRow(r) {
  const t = r.text || '';
  const m = /PTS(\d+(?:\.\d+)?)(?:now (\d+?)|proj)REB(\d+(?:\.\d+)?)(?:now (\d+?)|proj)AST(\d+(?:\.\d+)?)(?:now (\d+?)|proj)3PM(\d+(?:\.\d+)?)(?:now (\d+)|proj)/.exec(t);
  const mm = /(?:(\d+)′ → )?(\d+)′/.exec(r.mins || '');
  if (!m || !mm) return null;
  const v = (i) => ({ proj: +m[i], now: m[i + 1] != null ? +m[i + 1] : 0 });
  return { minNow: mm[1] != null ? +mm[1] : 0, minProj: +mm[2], pts: v(1), reb: v(3), ast: v(5), fg3m: v(7), on: /floor/i.test(r.on || ''), notIn: /NOT IN YET/.test(t) };
}

function summarize(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const looks = rows.filter((x) => x.rows), feeds = rows.filter((x) => x.feed), done = rows.find((x) => x.done) || {};
  const out = [];
  const hist = {};
  let n = 0, unparsed = 0, below = 0, onNotIn = 0, banned = 0, odd = 0;
  const ex = [];
  for (const x of looks) {
    banned += x.banned || 0; odd += (x.odd || []).length;
    for (const r of x.rows) {
      const p = parseRow(r);
      if (!p) { unparsed++; if (ex.length < 6) ex.push(`could not read: ${r.text.slice(0, 80)}`); continue; }
      n++;
      (hist[r.name] = hist[r.name] || []).push({ at: x.at, pill: x.pill, ...p });
      for (const k of ['pts', 'reb', 'ast', 'fg3m']) if (p[k].proj < p[k].now - 0.01) { below++; if (ex.length < 12) ex.push(`BELOW what he has: ${r.name} ${x.at.slice(11, 19)} ${x.pill} ${k} has ${p[k].now}, shown ${p[k].proj}`); }
      if (p.minProj < p.minNow) { below++; if (ex.length < 12) ex.push(`BELOW what he has: ${r.name} ${x.at.slice(11, 19)} minutes ${p.minNow} → ${p.minProj}`); }
      if (p.on && p.notIn) { onNotIn++; if (ex.length < 12) ex.push(`on the floor but tagged NOT IN YET: ${r.name} ${x.at.slice(11, 19)} ${x.pill}`); }
    }
  }
  // moves between two looks with nothing new for the player; moves across the tip
  let q = 0, qMin = 0, qPts = 0, big = 0, tipN = 0, tipMin = 0, tipPts = 0, tipMax = 0, subN = 0, subMin = 0;
  const live = (pill) => /Q\d|OT|Half|End of/.test(pill || '');
  for (const [name, h] of Object.entries(hist)) for (let i = 1; i < h.length; i++) {
    const a = h[i - 1], b = h[i];
    if (!live(a.pill) && live(b.pill)) { tipN++; tipMin += Math.abs(b.minProj - a.minProj); tipPts += Math.abs(b.pts.proj - a.pts.proj); tipMax = Math.max(tipMax, Math.abs(b.minProj - a.minProj)); continue; }
    if (!live(a.pill) || !live(b.pill)) continue;
    const same = ['pts', 'reb', 'ast', 'fg3m'].every((k) => a[k].now === b[k].now) && b.minNow - a.minNow <= 1;
    if (same && a.on === b.on) { q++; qMin += Math.abs(b.minProj - a.minProj); qPts += Math.abs(b.pts.proj - a.pts.proj); if (Math.abs(b.minProj - a.minProj) >= 3) { big++; if (ex.length < 16) ex.push(`minutes moved ${a.minProj} → ${b.minProj} with nothing new: ${name} ${a.at.slice(11, 19)} ${a.pill} → ${b.pill}`); } }
    else if (same && a.on !== b.on) { subN++; subMin += Math.abs(b.minProj - a.minProj); }
  }
  // 3PM on screen against the feed (the newest feed read at least 90 seconds before the look: the app may be a little behind the feed, never by that much)
  let c3 = 0, short3 = 0, made = 0, madeWord = 0;
  const ex3 = [];
  const lastFeed = feeds[feeds.length - 1];
  if (lastFeed) { made = Object.values(lastFeed.feed).reduce((a, x) => a + x[0], 0); madeWord = Object.values(lastFeed.feed).reduce((a, x) => a + x[1], 0); }
  for (const x of looks) {
    const f = feeds.filter((y) => Date.parse(y.at) <= Date.parse(x.at) - 90000).pop();
    if (!f) continue;
    for (const r of x.rows) { const p = parseRow(r); const fx = f.feed[norm(r.name)]; if (!p || !fx) continue; c3++; if (p.fg3m.now < fx[0]) { short3++; if (ex3.length < 8) ex3.push(`${r.name} ${x.at.slice(11, 19)} ${x.pill}: screen says ${p.fg3m.now} made threes, the feed had ${fx[0]} ninety seconds earlier`); } }
  }
  out.push(`looks ${looks.length} (${looks.length ? looks[0].at.slice(11, 19) : '-'} to ${looks.length ? looks[looks.length - 1].at.slice(11, 19) : '-'} UTC), last scoreboard: ${looks.length ? looks[looks.length - 1].pill : '-'}`);
  out.push(`player rows read ${n} (could not read ${unparsed}) | page errors ${(done.errs || []).length} | banned words ${banned} | odd tokens ${odd} | a number below what he has ${below} | on the floor but NOT IN YET ${onNotIn}`);
  out.push(`between two looks 20 s apart with nothing new for the player: minutes move ${q ? (qMin / q).toFixed(2) : '-'} on average, points ${q ? (qPts / q).toFixed(2) : '-'} (${q} pairs); moves of 3+ minutes: ${big}`);
  out.push(`when a player checks in or out: minutes move ${subN ? (subMin / subN).toFixed(2) : '-'} on average (${subN} times)`);
  out.push(tipN ? `across the tip (last look before → first live look): ${tipN} players, minutes move ${(tipMin / tipN).toFixed(2)} on average (largest ${tipMax}), points ${(tipPts / tipN).toFixed(2)}` : 'the tip was not inside this watch');
  out.push(feeds.length ? `made threes in the feed at the last read: ${made} (the wording alone finds ${madeWord}); 3PM on screen against the feed: ${c3} comparisons, screen short ${short3}` : 'no feed reads');
  if ((done.errs || []).length) out.push('page errors: ' + done.errs.slice(0, 4).map((e) => e.text).join(' ; '));
  if (done.ls) out.push('saved on the phone: ' + done.ls.join(', '));
  return out.concat(ex, ex3).join('\n');
}

if (arg('--read')) { console.log(summarize(path.resolve(arg('--read')))); process.exit(0); }

(async () => {
  const { chromium } = require('playwright');
  const date = etDate();
  const feed = async (p) => { const r = await fetch(L.DB + p, { headers: { Accept: 'application/json', 'User-Agent': L.UA } }); if (!r.ok) throw new Error(`feed ${r.status}`); return r.json(); };
  let game = arg('--game');
  if (!game) {
    const j = await feed(`/v1/nba/live/games/${date}`); const rows = (Array.isArray(j) ? j : j.data || []).filter((g) => g.status_state !== 'final').sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
    if (!rows.length) { console.log('No game left to watch today.'); process.exit(0); }
    game = String(rows[0].id);
    console.log(`watching ${rows[0].visitor_team.abbreviation} at ${rows[0].home_team.abbreviation} (game ${game}, tip ${rows[0].datetime})`);
  }
  const minutes = +arg('--minutes', 45);
  let base = 'https://everworldlife-courtside-arcade.static.hf.space/', srv = null;
  if (argv.includes('--local')) {
    const dir = path.join(L.ROOT, 'cs', 'build'), MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    srv = http.createServer((req, rsp) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end(); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); if (req.method === 'HEAD') { rsp.end(); return; } rsp.end(fs.readFileSync(f)); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${srv.address().port}/`;
  }
  const outDir = path.join(L.DATA, 'livewatch'); fs.mkdirSync(outDir, { recursive: true });
  const OUT = path.join(outDir, `${date}-${game}.jsonl`);
  fs.writeFileSync(OUT, '');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 840 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push({ at: new Date().toISOString(), text: String(e.message || e).slice(0, 300) }));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|espn/i.test(m.text())) errs.push({ at: new Date().toISOString(), text: 'console: ' + m.text().slice(0, 300) }); });
  // (ESPN's pages do not answer this machine's browser directly; a phone reaches them, so they are fetched here and handed over)
  await page.route(/espn\.com/, async (route) => { try { const r = await fetch(route.request().url(), { headers: { Accept: 'application/json', 'User-Agent': L.UA } }); await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() }); } catch { await route.abort(); } });
  await page.goto(`${base}#/game/${game}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const end = Date.now() + minutes * 60000;
  let lastFeed = 0;
  while (Date.now() < end) {
    const snap = await page.evaluate(() => {
      const view = document.getElementById('view'); if (!view) return null;
      const txt = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : '');
      const rows = [...view.querySelectorAll('[data-act="player"]')].map((el) => { const c = el.cloneNode(true); c.querySelectorAll('.why').forEach((x) => x.remove()); return { pid: el.getAttribute('data-p'), name: txt(el.querySelector('b')), mins: txt(el.querySelector('.mins')), on: (el.querySelector('.oncourt') || {}).title || '', text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260) }; });
      const all = document.body.innerText;
      return { pill: txt(view.querySelector('.pill')), rows, banned: (all.match(/\b(over|under)\b/gi) || []).length, odd: (all.match(/NaN|undefined|Infinity|QOT|\bQ5\b/g) || []).slice(0, 5) };
    }).catch((e) => ({ evalError: String(e.message || e).slice(0, 200) }));
    fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...snap }) + '\n');
    if (Date.now() - lastFeed >= 60000) {
      lastFeed = Date.now();
      try {
        const j = await feed(`/v1/nba/games/${game}/plays`); const plays = Array.isArray(j) ? j : j.data || [];
        const box = (fix) => { const keep = E.TUNE.threeFix; E.TUNE.threeFix = fix; try { return E.boxFromPlays(plays, 9, '0:00').players; } finally { E.TUNE.threeFix = keep; } };
        const neu = box(1), old = box(0), f = {};
        for (const [pid, r] of Object.entries(neu)) if (r.name) f[norm(r.name)] = [r.fg3m || 0, (old[pid] || {}).fg3m || 0];
        fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), plays: plays.length, feed: f }) + '\n');
      } catch (e) { fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), feedError: String(e.message || e) }) + '\n'); }
    }
    await page.waitForTimeout(20000);
  }
  const ls = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('psnap:') || k.startsWith('pat:')).map((k) => `${k} (${localStorage.getItem(k).length} characters)`)).catch(() => []);
  fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), done: true, errs, ls }) + '\n');
  await browser.close(); if (srv) srv.close();
  console.log(`log: ${OUT}`);
  console.log(summarize(OUT));
})().catch((e) => { console.log('ERR', e); process.exit(1); });
