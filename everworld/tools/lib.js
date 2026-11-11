/* Shared helpers for the Everworld lab tools: paths, polite cached fetching, gzip JSON. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.env.EW_ROOT || path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DB = 'https://api.databallr.com';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BKN: 'BKN' };
const espnAbbr = (a) => ESPN_ABBR[a] || a;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensure = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); return p; };
const exists = (p) => fs.existsSync(p);
function readJSON(p) {
  const buf = fs.readFileSync(p);
  return JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8'));
}
function writeJSON(p, v) {
  ensure(p);
  const s = JSON.stringify(v);
  const tmp = p + '.tmp' + process.pid;
  fs.writeFileSync(tmp, p.endsWith('.gz') ? zlib.gzipSync(s, { level: 9 }) : s);
  fs.renameSync(tmp, p);
}

/** GET JSON with retries and backoff. Throws after the last attempt. */
async function getJSON(url, { tries = 5, timeout = 45000 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: ac.signal });
      clearTimeout(t);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { err = e; await sleep(800 * Math.pow(2, i)); }
  }
  throw new Error(`${url}: ${err && err.message}`);
}

/** Run jobs a few at a time (be polite to the data services). */
async function pool(items, n, fn) {
  const q = items.slice();
  let done = 0;
  const out = [];
  async function w() {
    while (q.length) {
      const it = q.shift();
      try { out.push(await fn(it)); } catch (e) { out.push({ error: String(e.message || e), item: it }); }
      done++;
      if (done % 100 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: n }, w));
  return out;
}

const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function dateRange(from, to) { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; }
/** DataBallr labels seasons by end year: Oct 2026 → current 2027, last 2026. */
function seasons(date) { const [y, m] = date.split('-').map(Number); const cur = m >= 8 ? y + 1 : y; return { cur, last: cur - 1 }; }

module.exports = { ROOT, DATA, UA, DB, ESPN, espnAbbr, sleep, ensure, exists, readJSON, writeJSON, getJSON, pool, addDays, dateRange, seasons };
