/* Real-browser check of the phone storage and nightly-learning path on the real feeds (run: node tools/phonecheck.js; FREE=2500000 squeezes storage to an iPhone-like size).
 *  visit 1: the copy of today's tables is saved; last night (no copy from before its tips) is closed without learning
 *  visit 2: the same phone with a copy stamped before last night's tips: last night IS learned from and graded. */
const http = require('http'), fs = require('fs'), path = require('path');
const L = require('./lib');
const { chromium } = require('playwright');
const dir = require('path').resolve(__dirname, '..', 'cs', 'build');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
(async () => {
  const srv = http.createServer((req, rsp) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(dir, p); if (!f.startsWith(dir) || !fs.existsSync(f)) { rsp.writeHead(404); rsp.end('x'); return; } rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); if (req.method === 'HEAD') { rsp.end(); return; } fs.createReadStream(f).pipe(rsp); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  const open = async () => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/espn|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
    await page.route(/\/functions\/v1\/gg-winner\/db\//, async (route) => { const u = route.request().url().replace(/^.*\/functions\/v1\/gg-winner\/db/, L.DB); try { const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': L.UA } }); await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() }); } catch (e) { await route.abort(); } });
    await page.route(/espn\.com/, async (route) => { try { const r = await fetch(route.request().url(), { headers: { Accept: 'application/json', 'User-Agent': L.UA } }); await route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await r.text() }); } catch (e) { await route.abort(); } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return page;
  };
  const state = (page) => page.evaluate(() => { const o = { keys: {}, total: 0 }; for (const k of Object.keys(localStorage)) { if (k.startsWith('zz_fill')) continue; const n = localStorage.getItem(k).length; o.total += n; const g = k.split(':')[0]; o.keys[g] = (o.keys[g] || 0) + n; } o.snaps = Object.keys(localStorage).filter((k) => k.startsWith('psnap:')).map((k) => { const s = JSON.parse(localStorage.getItem(k)); return { k, players: Object.keys(s.p || {}).length, teams: s.t ? Object.keys(s.t.teams || {}).length : 0, chars: localStorage.getItem(k).length }; }); o.dates = JSON.parse(localStorage.getItem('pat:v6:dates') || 'null'); const sum = JSON.parse(localStorage.getItem('pat:v6:sum') || 'null'); o.learned = sum && sum.acc ? Object.fromEntries(Object.entries(sum.acc).map(([g, a]) => [g, a.n ? [a.g, a.n, +(a.pts / a.n).toFixed(2)] : 0])) : null; return o; });
  const waitChecked = async (page, secs) => { for (let i = 0; i < secs; i++) { await page.waitForTimeout(1000); const d = await page.evaluate(() => JSON.parse(localStorage.getItem('pat:v6:dates') || 'null')); if (d && d.checked) return d; } return null; };
  // optional: leave only FREE characters of storage (an iPhone holds about 2.5 million)
  const FREE = +(process.env.FREE || 0);
  if (FREE) {
    const p0 = await ctx.newPage(); await p0.goto(url + 'manifest.webmanifest');
    const cap = await p0.evaluate(() => { localStorage.clear(); let n = 0; const chunk = 'x'.repeat(100000); try { for (let i = 0; i < 200; i++) { localStorage.setItem('zz_fill' + i, chunk); n += chunk.length + 8; } } catch (e) { /* full */ } const keys = Object.keys(localStorage).filter((k) => k.startsWith('zz_fill')); return { n, keys: keys.length }; });
    const drop = Math.ceil(FREE / 100008);
    await p0.evaluate((drop) => { const keys = Object.keys(localStorage).filter((k) => k.startsWith('zz_fill')); for (const k of keys.slice(0, drop)) localStorage.removeItem(k); }, drop);
    console.log('storage capacity of this browser about', cap.n, 'characters; filler left in place so that about', drop * 100008, 'are free');
    await p0.close();
  }
  // visit 1
  let page = await open();
  await page.waitForTimeout(15000);
  const d1 = await waitChecked(page, 240);
  const s1 = await state(page);
  console.log('VISIT 1 | copies:', JSON.stringify(s1.snaps), '| nights closed:', JSON.stringify(d1), '| learned:', JSON.stringify(s1.learned));
  console.log('        | storage used (characters) by kind:', JSON.stringify(s1.keys), 'total', s1.total);
  // visit 2: pretend the copy had been saved before last night's tips (move today's copy to the day before, stamp it early), reopen
  const moved = await page.evaluate(() => { const today = Object.keys(localStorage).filter((k) => k.startsWith('psnap:')).sort().pop(); if (!today) return null; const d = new Date(today.slice(6) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); const y = d.toISOString().slice(0, 10); const s = JSON.parse(localStorage.getItem(today)); s.at = s.tAt = Date.parse(y + 'T15:00:00Z'); localStorage.setItem('psnap:' + y, JSON.stringify(s)); localStorage.removeItem('pat:v6:dates'); localStorage.removeItem('pat:v6:sum'); return y; });
  await page.close();
  page = await open();
  await page.waitForTimeout(15000);
  const d2 = await waitChecked(page, 420);
  const s2 = await state(page);
  console.log('VISIT 2 | copy stamped before the tips of', moved, '| nights closed:', JSON.stringify(d2), '| learned [games, players, points miss] by stage:', JSON.stringify(s2.learned));
  await page.goto(url + '#/settings'); await page.waitForTimeout(1500);
  const txt = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
  console.log('        | settings says how the phone grades itself:', /saved before that game tipped/.test(txt), '| banned words on screen:', (txt.match(/\b(over|under)\b/gi) || []).length, '| version line:', (txt.match(/Version \d+[^.]*\)/) || [''])[0]);
  console.log('page errors:', errors.length ? errors.slice(0, 5).join(' ; ') : 'none');
  await browser.close(); srv.close();
})().catch((e) => { console.log('ERR', e); process.exit(1); });
