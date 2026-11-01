/* Shared helpers for replaying finished games from DataBallr (backtest + post-mortem). */
const fs = require('fs');
const path = require('path');
const E = require('../../public/live/engine.js');

const BASE = 'https://api.databallr.com';
const CACHE = path.join(__dirname, '..', '..', '.cache', 'databallr');
fs.mkdirSync(CACHE, { recursive: true });

async function get(p, { fresh = false } = {}) {
  const file = path.join(CACHE, p.replace(/[^a-z0-9]+/gi, '_') + '.json');
  if (!fresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(BASE + p, { headers: { 'User-Agent': 'Mozilla/5.0', Origin: 'https://databallr.com' } });
      if (!r.ok) throw new Error(`${r.status} ${p}`);
      const j = await r.json();
      fs.writeFileSync(file, JSON.stringify(j));
      return j;
    } catch (e) {
      if (i === 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

async function logsBefore(teams, date, perTeam = 8, lookback = 21) {
  const found = [];
  const count = Object.fromEntries(teams.map((t) => [t, 0]));
  for (let i = 1; i <= lookback; i++) {
    const day = addDays(date, -i);
    let games;
    try { games = (await get(`/v1/nba/live/games/${day}`)).data || []; } catch { continue; }
    for (const g of games) {
      const ab = [g.visitor_team.abbreviation, g.home_team.abbreviation];
      if (g.status_state !== 'final' && !/final/i.test(g.display_status || '')) continue;
      if (!ab.some((t) => teams.includes(t) && count[t] < perTeam)) continue;
      if (found.some((f) => f.id === g.id)) continue;
      const plays = (await get(`/v1/nba/games/${g.id}/plays`)).data || [];
      found.push(E.logEntry(g, plays));
      ab.forEach((t) => { if (t in count) count[t]++; });
    }
    if (teams.every((t) => count[t] >= perTeam)) break;
  }
  return found;
}

/** Cut a finished game back to a checkpoint: pre | q1 | half | q3. */
function truncate(game, plays, checkpoint) {
  if (checkpoint === 'pre') {
    return { game: { ...game, period: 0, time: null, status_state: 'scheduled', display_status: 'scheduled', visitor_team_score: 0, home_team_score: 0 }, plays: [] };
  }
  const period = { q1: 1, half: 2, q3: 3 }[checkpoint];
  const kept = plays.filter((p) => p.period <= period);
  const lastP = kept[kept.length - 1] || { away_score: 0, home_score: 0 };
  return {
    game: { ...game, period, time: period === 2 ? 'Half' : 'END Q' + period, status_state: 'live', display_status: 'live',
      visitor_team_score: lastP.away_score, home_team_score: lastP.home_score },
    plays: kept,
  };
}

module.exports = { E, get, addDays, iso, logsBefore, truncate };
