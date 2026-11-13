#!/usr/bin/env node
/* Save what the PUBLISHED Courtside app shows for every player of tonight's games that have not started (the numbers a
 * phone shows right now), next to the books' lines recorded by tools/proprec.js. Numbers on screen are rounded to halves.
 *   node tools/appsnap.js [--date 2026-11-13]      → data/props/<date>/app-<HHMM>.json.gz
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const L = require('./lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const etDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
(async () => {
  const date = arg('--date', etDate()), now = new Date(), hhmm = now.toISOString().slice(11, 16).replace(':', '');
  const slate = await L.getJSON(`${L.DB}/v1/nba/live/games/${date}`); const games = (slate && (slate.data || slate)) || [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 840 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const base = 'https://everworldlife-courtside-arcade.static.hf.space/';
  await page.goto(base + '#/games', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('#view a[href^="#/game/"]').length > 0, null, { timeout: 150000 });
  const out = [];
  const read = () => page.evaluate(() => [...document.querySelectorAll('#view [data-act="player"]')].map((el) => { const c = el.cloneNode(true); c.querySelectorAll('.why').forEach((x) => x.remove()); return { pid: +el.getAttribute('data-p'), name: (el.querySelector('b') || {}).innerText || '', mins: ((el.querySelector('.mins') || {}).innerText || '').replace(/\s+/g, ' ').trim(), text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) }; }));
  for (const g of games) {
    const state = String(g.status_state || '').toLowerCase();
    if (/^(in|post|final)/.test(state) || g.period > 0) continue;
    await page.evaluate((id) => { location.hash = `#/game/${id}`; }, g.id);
    await page.waitForFunction(() => document.querySelectorAll('#view [data-act="player"]').length >= 8, null, { timeout: 150000 }).catch(() => {});
    for (const tm of [g.visitor_team.abbreviation, g.home_team.abbreviation]) {
      await page.evaluate((t) => { const b = [...document.querySelectorAll('#view [data-act="team"]')].find((x) => x.getAttribute('data-t') === t); if (b) b.click(); }, tm);
      await page.waitForTimeout(900);
      for (const r of await read()) {
        const m = /PTS(\d+(?:\.\d+)?)projREB(\d+(?:\.\d+)?)projAST(\d+(?:\.\d+)?)proj3PM(\d+(?:\.\d+)?)proj/.exec(r.text), mm = /(\d+)′/.exec(r.mins);
        if (m) out.push({ id: g.id, tm, pid: r.pid, nm: r.name, min: mm ? +mm[1] : null, pts: +m[1], reb: +m[2], ast: +m[3], fg3m: +m[4] });
      }
    }
    console.log(`  ${g.visitor_team.abbreviation}@${g.home_team.abbreviation}: ${out.filter((x) => x.id === g.id).length} players`);
  }
  await browser.close();
  L.writeJSON(L.ensure(path.join(L.DATA, 'props', date, `app-${hhmm}.json.gz`)), { at: now.toISOString(), rows: out });
  console.log(`${out.length} players saved → data/props/${date}/app-${hhmm}.json.gz`);
})().catch((e) => { console.error(e.message); process.exit(1); });
