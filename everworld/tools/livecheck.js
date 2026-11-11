#!/usr/bin/env node
/* Open an app in a phone-sized browser and confirm it loads tonight's games with no page errors.
 *   node tools/livecheck.js                      both live links
 *   node tools/livecheck.js --local cs           serve cs/build locally and check it (also: --local gg)
 *   --shots <dir>  save screenshots there
 * ESPN requests can be blocked in automated browsers; that is not an app bug and is reported separately.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const shots = arg('--shots', null);
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve(dir) {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(dir, p);
      if (!f.startsWith(dir) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end('not found'); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

async function check(name, url, waitFor) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('requestfailed', (r) => failed.push(r.url()));
  if (/^http:\/\/127\.0\.0\.1/.test(url)) {
    // a local copy is not on the Space's address, so the data relay refuses its requests: answer them straight from DataBallr
    await page.route(/\/functions\/v1\/gg-winner\/db\//, async (route) => {
      const u = route.request().url().replace(/^.*\/functions\/v1\/gg-winner\/db/, L.DB);
      try { const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': L.UA } }); await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() }); }
      catch (e) { await route.abort(); }
    });
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const out = await waitFor(page).catch((e) => ({ ok: false, note: String(e.message || e) }));
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  const words = text.match(/\b(over|under)\b/gi) || [];
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${name}.png`) }); }
  await browser.close();
  const espnBlocked = failed.filter((u) => /espn\.com/.test(u)).length, otherFailed = failed.filter((u) => !/espn\.com|fonts\.g/.test(u));
  const ok = out.ok && !errors.length && !words.length;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${out.note}${errors.length ? ` | page errors: ${errors.slice(0, 2).join(' ; ')}` : ' | no page errors'}${words.length ? ` | banned words on screen: ${[...new Set(words)].join(',')}` : ''}${espnBlocked ? ` | ${espnBlocked} ESPN requests blocked (not an app bug)` : ''}${otherFailed.length ? ` | other failed requests: ${otherFailed.slice(0, 2).join(' ')}` : ''}`);
  return ok;
}

const csWait = async (page) => {
  // the games tab lists tonight's games (team badges) once the slate has loaded
  await page.goto(page.url().split('#')[0] + '#/games');
  await page.waitForFunction(() => document.querySelectorAll('#view .badge').length >= 2 || /No games/i.test(document.getElementById('view').innerText), null, { timeout: 90000 });
  const n = await page.evaluate(() => document.querySelectorAll('#view .badge').length / 2);
  const sw = await page.evaluate(() => fetch('sw.js').then((r) => r.text()).then((t) => (t.match(/ca-shell-v\d+/) || [''])[0]).catch(() => ''));
  // open the first game and wait for player projections (rows with a player button)
  let players = 0;
  if (n >= 1) {
    await page.waitForFunction(() => document.querySelectorAll('#view [data-act="player"], #view a[href^="#/game/"]').length > 0, null, { timeout: 120000 }).catch(() => {});
    const link = await page.$('#view a[href^="#/game/"]');
    if (link) { await link.click(); await page.waitForFunction(() => document.querySelectorAll('#view [data-act="player"]').length >= 8, null, { timeout: 120000 }).catch(() => {}); players = await page.evaluate(() => document.querySelectorAll('#view [data-act="player"]').length); }
  }
  return { ok: true, note: `${Math.floor(n)} games on the board, ${players} player rows in the first game, ${sw}` };
};
const ggWait = async (page) => {
  await page.waitForFunction(() => document.body.innerText.length > 200, null, { timeout: 90000 });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => ({ len: document.body.innerText.length, cards: document.querySelectorAll('[data-game], .game, .card, .row').length }));
  const sw = await page.evaluate(() => fetch('sw.js').then((r) => r.text()).then((t) => (t.match(/gg-winner-v[\d.]+/) || [''])[0]).catch(() => ''));
  return { ok: info.len > 200, note: `board rendered (${info.cards} cards/rows), ${sw}` };
};

(async () => {
  let all = true;
  const local = arg('--local', null);
  if (local) {
    const dir = path.join(L.ROOT, local === 'cs' ? 'cs/build' : 'gg/static');
    const { srv, url } = await serve(dir);
    all = await check(`local-${local}`, url, local === 'cs' ? csWait : ggWait) && all;
    srv.close();
  } else {
    all = await check('courtside-live', 'https://everworldlife-courtside-arcade.static.hf.space/', csWait) && all;
    all = await check('gg-winner-live', 'https://everworldlife-gg-winner.static.hf.space/', ggWait) && all;
  }
  process.exit(all ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
