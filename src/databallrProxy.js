/*
 * Read-only DataBallr proxy for the Courtside Arcade PWA (/live).
 * DataBallr's API sends no CORS headers, so the phone app calls /live/db/... and we forward
 * GETs for /v1/nba/* only, with short in-memory caching so many phones = few upstream calls.
 */
const express = require('express');

const BASE = 'https://api.databallr.com';
const router = express.Router();
const cache = new Map();
const MAX_ENTRIES = 600;

function ttlFor(path) {
  if (/^\/v1\/nba\/live\/games/.test(path)) return 8 * 1000;
  if (/^\/v1\/nba\/games\/\d+\/plays/.test(path)) return 8 * 1000;
  if (/^\/v1\/nba\/odds/.test(path)) return 30 * 1000;
  if (/^\/v1\/nba\/injuries/.test(path)) return 5 * 60 * 1000;
  if (/^\/v1\/nba\/players\/stats/.test(path)) return 6 * 60 * 60 * 1000;
  return 60 * 1000;
}

router.get(/^\/v1\/nba\/.+/, async (req, res) => {
  const key = req.url;
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) {
    res.set('Content-Type', 'application/json').set('X-Cache', 'HIT');
    return res.send(hit.body);
  }
  try {
    const r = await fetch(BASE + key, { headers: { 'User-Agent': 'CourtsideArcade/1.0', Accept: 'application/json', Origin: 'https://databallr.com' } });
    const body = await r.text();
    if (!r.ok) return res.status(r.status).set('Content-Type', 'application/json').send(body || '{"error":"upstream"}');
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { body, exp: now + ttlFor(req.path) });
    res.set('Content-Type', 'application/json').set('X-Cache', 'MISS').send(body);
  } catch (err) {
    if (hit) return res.set('Content-Type', 'application/json').set('X-Cache', 'STALE').send(hit.body);
    res.status(502).json({ error: 'DataBallr unreachable', details: err.message });
  }
});

router.all('*', (req, res) => res.status(404).json({ error: 'Only GET /v1/nba/* is proxied' }));

module.exports = router;
