/**
 * Shared FanDuel public sportsbook JSON client (server-side only).
 *
 *   In-play board : https://sbapi.{state}.sportsbook.fanduel.com/api/in-play
 *   Event page    : https://sbapi.{state}.sportsbook.fanduel.com/api/event-page?eventId=
 *   Live scores   : https://api.sportsbook.fanduel.com/ips/inplayservice/v1.0/livedata
 *
 * FanDuel rejects browser requests from foreign origins, so these calls run in
 * the Netlify function / local server and the results are cached briefly.
 */

const cache = require('../cache');

const AK = process.env.FANDUEL_SB_AK || 'FhMFpcPWXMeyZxOx';
const UA = 'Mozilla/5.0 (compatible; CourtSidePace/2.0)';
const ORIGIN = 'https://sportsbook.fanduel.com';

const STATES = [
  { host: 'nj', tz: 'America/New_York' },
  { host: 'il', tz: 'America/Chicago' },
  { host: 'pa', tz: 'America/New_York' },
];

const INPLAY_TTL = 6 * 1000;
const LIVEDATA_TTL = 4 * 1000;
const EVENT_TTL = 6 * 1000;

function regionFirst() {
  const want = String(process.env.FANDUEL_REGION || 'NJ').toLowerCase();
  const list = STATES.slice();
  list.sort((a, b) => (a.host === want ? -1 : b.host === want ? 1 : 0));
  return list;
}

async function fdFetch(url, { timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Origin: ORIGIN,
        Referer: `${ORIGIN}/live?tab=basketball`,
      },
    });
    if (!res.ok) {
      const err = new Error(`FanDuel HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Dedupe concurrent identical requests + short TTL cache. */
const inflight = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const data = await fn();
      cache.set(key, data, ttl);
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function inPlay() {
  return cached('fd:inplay:prices', INPLAY_TTL, async () => {
    let lastErr;
    for (const s of regionFirst()) {
      const url = `https://sbapi.${s.host}.sportsbook.fanduel.com/api/in-play?_ak=${AK}&timezone=${encodeURIComponent(s.tz)}&exchangeLocale=en_US&includePrices=true`;
      try {
        return await fdFetch(url);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('FanDuel in-play unavailable');
  });
}

async function liveData(eventIds) {
  const ids = [...new Set((eventIds || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!ids.length) return [];
  return cached(`fd:live:${ids.join(',')}`, LIVEDATA_TTL, async () => {
    const rows = [];
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40);
      const url = `https://api.sportsbook.fanduel.com/ips/inplayservice/v1.0/livedata?eventIds=${chunk.join(',')}&_ak=${AK}&channel=WEB`;
      const data = await fdFetch(url);
      if (Array.isArray(data)) rows.push(...data);
    }
    return rows;
  });
}

async function eventPage(eventId) {
  const id = Number(eventId);
  return cached(`fd:event:${id}`, EVENT_TTL, async () => {
    let lastErr;
    for (const s of regionFirst()) {
      const url = `https://sbapi.${s.host}.sportsbook.fanduel.com/api/event-page?_ak=${AK}&eventId=${id}&tab=popular&timezone=${encodeURIComponent(s.tz)}`;
      try {
        return await fdFetch(url);
      } catch (err) {
        lastErr = err;
        if (err.status === 404) break;
      }
    }
    throw lastErr || new Error('FanDuel event page unavailable');
  });
}

module.exports = { fdFetch, inPlay, liveData, eventPage, AK };
