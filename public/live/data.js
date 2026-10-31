/* Courtside Arcade — DataBallr client (through the same-origin proxy at ./db). */
(function () {
  'use strict';
  const BASE = './db';
  const mem = new Map();
  const VER = 'v2';

  const store = {
    get(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); }
      catch {
        // quota: drop the oldest cached game logs and retry once
        try {
          Object.keys(localStorage).filter((x) => x.startsWith('log:')).slice(0, 40).forEach((x) => localStorage.removeItem(x));
          localStorage.setItem(k, JSON.stringify(v));
        } catch { /* give up quietly */ }
      }
    },
  };

  async function getJSON(path, ttlMs = 0) {
    const hit = mem.get(path);
    if (hit && ttlMs > 0 && hit.exp > Date.now()) return hit.data;
    const r = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`DataBallr ${r.status}`);
    const data = await r.json();
    mem.set(path, { data, exp: Date.now() + ttlMs });
    return data;
  }

  function etDate(offsetDays = 0) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  async function slate(date, ttl = 6000) {
    const today = etDate(0);
    if (date < today) {
      const cached = store.get(`slate:${VER}:${date}`);
      if (cached) return cached;
    }
    const j = await getJSON(`/v1/nba/live/games/${date}`, ttl);
    const rows = j.data || [];
    if (date < today && rows.length && rows.every((g) => g.status_state === 'final')) store.set(`slate:${VER}:${date}`, rows);
    return rows;
  }

  async function plays(gameId, final = false) {
    const j = await getJSON(`/v1/nba/games/${gameId}/plays`, final ? 3600000 : 5000);
    return j.data || [];
  }

  async function lastSeasonPriors(season) {
    const key = `priors:${VER}:${season}`;
    const cached = store.get(key);
    if (cached && Object.keys(cached).length > 100) return cached;
    const rows = await getJSON(`/v1/nba/players/stats?year=${season}&playoffs=0&limit=1000`, 86400000);
    const slim = window.Engine.slimStats(rows);
    store.set(key, slim);
    return slim;
  }

  /** This season's DataBallr line, refreshed daily (used once players have games). */
  async function currentSeasonPriors(season, date) {
    const key = `priors:${VER}:cur:${season}`;
    const cached = store.get(key);
    if (cached && cached.date === date) return cached.data;
    try {
      const rows = await getJSON(`/v1/nba/players/stats?year=${season}&playoffs=0&limit=1000`, 3600000);
      const slim = window.Engine.slimStats(rows);
      store.set(key, { date, data: slim });
      return slim;
    } catch { return (cached && cached.data) || {}; }
  }

  async function injuries(date) {
    try { return (await getJSON(`/v1/nba/injuries?date=${date}`, 300000)).data || []; }
    catch { return []; }
  }

  async function props(gameId) {
    try { return (await getJSON(`/v1/nba/odds/games/${gameId}/props`, 45000)).data || []; }
    catch { return []; }
  }

  /** Recent finished games for a set of teams (cached forever on the phone once final). */
  async function teamLogs(teams, date, { perTeam = 8, lookback = 21, onProgress } = {}) {
    const want = new Set(teams);
    const count = Object.fromEntries(teams.map((t) => [t, 0]));
    const games = [];
    for (let i = 1; i <= lookback; i++) {
      const day = addDays(date, -i);
      let rows = [];
      try { rows = await slate(day, 3600000); } catch { continue; }
      for (const g of rows) {
        if (g.status_state !== 'final') continue;
        const ab = [g.visitor_team.abbreviation, g.home_team.abbreviation];
        if (!ab.some((t) => want.has(t) && count[t] < perTeam)) continue;
        if (games.some((x) => x.id === g.id)) continue;
        games.push(g);
        ab.forEach((t) => { if (t in count) count[t]++; });
      }
      if (teams.every((t) => count[t] >= perTeam)) break;
    }
    const out = [];
    let done = 0;
    const queue = games.slice();
    async function worker() {
      while (queue.length) {
        const g = queue.shift();
        const key = `log:${VER}:${g.id}`;
        let entry = store.get(key);
        if (!entry) {
          try { entry = window.Engine.logEntry(g, await plays(g.id, true)); store.set(key, entry); }
          catch { entry = null; }
        }
        if (entry) out.push(entry);
        done++;
        if (onProgress) onProgress(done, games.length);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }

  function clearCache() {
    mem.clear();
    try { Object.keys(localStorage).filter((k) => /^(log|slate|priors):/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  }

  /** DataBallr labels seasons by end year: Oct 2026 → current 2027, last 2026. */
  function seasons(date) {
    const [y, m] = date.split('-').map(Number);
    const cur = m >= 8 ? y + 1 : y;
    return { cur, last: cur - 1 };
  }

  window.DB = { etDate, addDays, seasons, slate, plays, lastSeasonPriors, currentSeasonPriors, injuries, props, teamLogs, clearCache, store };
})();
