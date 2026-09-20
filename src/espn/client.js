const cache = require('../cache');

const TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; PaceTotals/1.0; +https://github.com/everworldlife-netizen)';

async function fetchJSON(url, cacheKey, ttl) {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} for ${url}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (cacheKey) cache.set(cacheKey, data, ttl);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchJSON, UA, TIMEOUT_MS };
