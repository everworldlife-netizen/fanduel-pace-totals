/**
 * H2H GG League (h2hggl.com) public stats API — the official league data behind
 * FanDuel's "eBasketball H2H GG League 4x5 Mins" board.
 *
 *   Schedule + final scores : https://api-h2h.cdn-hudstats.com/v1/schedule/nba?date=<ISO with tz>
 *   Play-by-play timeline   : https://api-h2h.cdn-hudstats.com/v1/timeline/?external_id=<id>
 *
 * Responses are CDN-cached by the league (several minutes), so this is used for
 * history (finals, quarter splits), never as a live clock. Requests are cached
 * and rate-limit friendly: callers should not loop over hundreds of ids at once.
 */

const cache = require('../cache');

const BASE = 'https://api-h2h.cdn-hudstats.com/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; GGWinner/3.0)',
  Accept: 'application/json',
  Origin: 'https://h2hggl.com',
  Referer: 'https://h2hggl.com/',
};

async function h2hFetch(path, { timeoutMs = 9000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { signal: controller.signal, headers: HEADERS });
    if (!res.ok) {
      const err = new Error(`H2H HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** All matches for a UTC day (YYYY-MM-DD). Today: 3 min cache, past days: 6 h. */
async function schedule(day) {
  const today = dayKey(Date.now());
  const ttl = day >= today ? 3 * 60 * 1000 : 6 * 60 * 60 * 1000;
  const key = `h2h:sched:${day}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = await h2hFetch(`v1/schedule/nba?date=${encodeURIComponent(`${day}T00:00:00+00:00`)}`);
  const rows = Array.isArray(data) ? data : [];
  cache.set(key, rows, ttl);
  return rows;
}

async function timeline(externalId) {
  const key = `h2h:tl:${externalId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const data = await h2hFetch(`v1/timeline/?external_id=${encodeURIComponent(externalId)}`);
  cache.set(key, data, 30 * 60 * 1000);
  return data;
}

/**
 * Quarter-end running scores from a timeline, mapped to participant A/B of the
 * schedule row (the timeline's team_a/team_b can be inverted).
 * @returns {{q:Array<[number,number]>, half:[number,number], final:[number,number], ot:boolean}|null}
 */
function parseTimeline(tl, sched) {
  const inc = Array.isArray(tl?.incidents) ? tl.incidents : [];
  if (!inc.length) return null;
  const ends = new Map();
  let last = null;
  for (const i of inc) {
    const rs = i.runningScore;
    if (rs && Number.isFinite(Number(rs.team_a)) && Number.isFinite(Number(rs.team_b))) {
      last = [Number(rs.team_a), Number(rs.team_b)];
    }
    const p = i.period || {};
    if (i.messageType === 'NBA_PERIOD_CHANGE' && i.payload?.phase === 'ENDED' && p.type === 'QUARTER' && last) {
      ends.set(Number(p.id), last.slice());
    }
    if (i.messageType === 'NBA_PERIOD_CHANGE' && i.payload?.phase === 'ENDED' && p.type === 'OVERTIME' && last) {
      ends.set(5, last.slice());
    }
  }
  if (!last || ends.size < 4 || ![1, 2, 3, 4].every((q) => ends.has(q))) return null;
  let swap = false;
  const sa = Number(sched?.teamAScore);
  const sb = Number(sched?.teamBScore);
  if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
    if (last[0] === sb && last[1] === sa) swap = true;
  } else if (tl?.matchSummary?.finalScore) {
    const fa = Number(tl.matchSummary.finalScore.teamA);
    const fb = Number(tl.matchSummary.finalScore.teamB);
    if (fa !== fb && last[0] === fb && last[1] === fa) swap = true;
  }
  const fix = (pair) => (swap ? [pair[1], pair[0]] : pair);
  const q = [];
  let prev = [0, 0];
  for (let k = 1; k <= 4; k += 1) {
    const cum = ends.get(k);
    q.push(fix([cum[0] - prev[0], cum[1] - prev[1]]));
    prev = cum;
  }
  const half = fix(ends.get(2));
  return { q, half, final: fix(last), ot: ends.has(5) };
}

module.exports = { schedule, timeline, parseTimeline, dayKey, h2hFetch };
