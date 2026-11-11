#!/usr/bin/env node
/* Walk both working copies in a browser the size of the owner's phone (Google Pixel 9a, Chrome on Android) on the real feeds:
 * every main screen, with checks a phone user would notice (sideways scrolling, text cut off the screen, page errors, the two
 * banned words) and a screenshot of each screen.
 *   node tools/phoneshots.js [--out <folder>] [--live]      (--live walks the two published links instead of the working copies)
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const L = require('./lib');
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('--out', path.join(L.ROOT, 'data', 'shots-pixel9a')));
const LIVE = argv.includes('--live');
// Pixel 9a: 1080 x 2424 at 2.625 pixels per CSS pixel = 412 x 923; Chrome's bars leave about 412 x 840 for the page
const PHONE = { viewport: { width: 412, height: 840 }, screen: { width: 412, height: 923 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 9a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  serviceWorkers: 'block' }; // (always the files as they are now, never a cached copy)
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const serve = (dir) => new Promise((res) => { const srv = http.createServer((req, rsp) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end('x'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); if (req.method === 'HEAD') { rsp.end(); return; } fs.createReadStream(f).pipe(rsp); }).listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/` })); });
const relay = async (route, u) => { try { const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': L.UA } }); await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() }); } catch (e) { await route.abort(); } };

async function walk(name, url, steps) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  if (/^http:\/\/127\.0\.0\.1/.test(url)) await page.route(/\/functions\/v1\/gg-winner\/db\//, (route) => relay(route, route.request().url().replace(/^.*\/functions\/v1\/gg-winner\/db/, L.DB)));
  await page.route(/espn\.com/, (route) => relay(route, route.request().url()));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  fs.mkdirSync(OUT, { recursive: true });
  let ok = true, k = 0;
  for (const [label, go] of steps) {
    let note = '';
    try { await go(page); } catch (e) { note = `could not open (${String(e.message || e).slice(0, 80)})`; }
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const w = window.innerWidth, se = document.scrollingElement;
      // anything a user would have to scroll sideways for, or text boxes sticking out of the screen
      const wide = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; if (r.right <= w + 1 && r.left >= -1) return false; let p = el.parentElement; while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; p = p.parentElement; } return true; }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`);
      const small = [...document.querySelectorAll('button, a, [data-act]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < window.innerHeight && (r.width < 28 || r.height < 28); }).length;
      const text = document.body.innerText.replace(/\s+/g, ' ');
      return { sideways: se.scrollWidth > w + 1 ? se.scrollWidth - w : 0, wide, small, banned: (text.match(/\b(over|under)\b/gi) || []).length, chars: text.length, fonts: Math.min(...[...document.querySelectorAll('#view *, main *')].filter((el) => el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && el.textContent.trim().length > 2).map((el) => parseFloat(getComputedStyle(el).fontSize)).filter(Boolean).concat([99])) };
    });
    const file = `${name}-${++k}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    const bad = m.sideways > 0 || m.wide.length > 0 || m.banned > 0 || m.chars < 60 || note;
    if (bad) ok = false;
    console.log(`${bad ? 'CHECK' : 'ok   '} ${name} / ${label}: ${m.chars} characters${m.sideways ? `, scrolls sideways by ${m.sideways}px` : ''}${m.wide.length ? `, sticking out: ${m.wide.join(', ')}` : ''}${m.banned ? `, banned words: ${m.banned}` : ''}, smallest text ${m.fonts}px, ${m.small} small tap targets${note ? ', ' + note : ''} → ${file}`);
  }
  if (errors.length) { ok = false; console.log(`CHECK ${name}: page errors: ${errors.slice(0, 3).join(' ; ')}`); }
  await browser.close();
  return ok;
}

const csSteps = [
  ['games board', async (p) => { await p.goto(p.url().split('#')[0] + '#/games'); await p.waitForFunction(() => document.querySelectorAll('#view .badge').length >= 2 || /No games/i.test(document.getElementById('view').innerText), null, { timeout: 90000 }); await p.waitForFunction(() => document.querySelectorAll('#view a[href^="#/game/"]').length > 0, null, { timeout: 120000 }).catch(() => {}); }],
  ['one game', async (p) => { const link = await p.$('#view a[href^="#/game/"]'); if (link) { await link.click(); await p.waitForFunction(() => document.querySelectorAll('#view [data-act="player"]').length >= 8, null, { timeout: 120000 }); } }],
  ['player sheet', async (p) => { const b = await p.$('#view [data-act="player"]'); if (b) { await b.click(); await p.waitForTimeout(1500); } }],
  ['plus edges', async (p) => { await p.keyboard.press('Escape').catch(() => {}); await p.goto(p.url().split('#')[0] + '#/edges'); await p.waitForTimeout(2500); }],
  ['top scorers', async (p) => { await p.goto(p.url().split('#')[0] + '#/scorers'); await p.waitForTimeout(2000); }],
  ['tickets', async (p) => { await p.goto(p.url().split('#')[0] + '#/combos'); await p.waitForTimeout(2000); }],
  ['settings and accuracy', async (p) => { await p.goto(p.url().split('#')[0] + '#/settings'); await p.waitForTimeout(2000); }],
  ['settings, further down', async (p) => { await p.evaluate(() => window.scrollTo(0, 1400)); }],
];
// on a phone the bottom bar is the navigation (the top tabs are for wide screens)
const ggTab = (v) => async (p) => { const b = (await p.$(`#bottomNav [data-view="${v}"]`)) || (await p.$(`#tabs [data-view="${v}"]`)); if (b) { await b.click({ timeout: 8000 }); await p.waitForTimeout(3500); } };
const ggSteps = [
  ['welcome sheet (first visit)', async (p) => { await p.waitForFunction(() => document.body.innerText.length > 200, null, { timeout: 90000 }); await p.waitForTimeout(4000); }],
  ['board', async (p) => { const skip = p.getByRole('button', { name: /^skip$/i }); if (await skip.count()) { await skip.first().click({ timeout: 5000 }).catch(() => {}); } await p.waitForTimeout(3500); }],
  ['leagues', ggTab('leagues')], ['lab', ggTab('lab')], ['players', ggTab('players')], ['results', ggTab('results')],
];

(async () => {
  let all = true;
  if (LIVE) {
    all = await walk('courtside-live', 'https://everworldlife-courtside-arcade.static.hf.space/', csSteps) && all;
    all = await walk('gg-winner-live', 'https://everworldlife-gg-winner.static.hf.space/', ggSteps) && all;
  } else {
    const a = await serve(path.join(L.ROOT, 'cs/build')); all = await walk('courtside', a.url, csSteps) && all; a.srv.close();
    const b = await serve(path.join(L.ROOT, 'gg/static')); all = await walk('gg-winner', b.url, ggSteps) && all; b.srv.close();
  }
  console.log(all ? `All screens fit a Pixel 9a. Screenshots in ${OUT}` : `Some screens need a look. Screenshots in ${OUT}`);
  process.exit(all ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
