#!/usr/bin/env node
/* Turn the raw cache into one compact file per season that the replay tools load:
 *   data/derived/games-<season>.json.gz = [{ g, log, market, avail, espnId }] sorted by date
 *     g      = the DataBallr slate row (trimmed)
 *     log    = Engine.logEntry(g, plays): the same compact entry the phone caches per finished game
 *     market = the closing game line from ESPN, in the shape Engine.gameLineConsensus returns
 *     avail  = ESPN's game box lists (active players, starters) as the app reads them at tip-off
 * Seasons are labelled by end year (2025-26 = 2026).
 *
 *   node tools/prep.js [--engine baseline/cs/engine.js] [--season 2026 ...]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const enginePath = path.resolve(L.ROOT, arg('--engine', 'baseline/cs/engine.js'));
const E = require(enginePath);
const only = process.argv.filter((a, i) => process.argv[i - 1] === '--season').map(Number);

const implied = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
function marketFromEspn(sum) {
  const pc = (sum.pickcenter || [])[0];
  if (!pc) return null;
  const out = { total: null, spreadHome: null, pAway: null, books: 1, vendors: [(pc.provider && pc.provider.name) || 'espn'], updated: null, totalRange: null, spreadRange: null };
  const t = +pc.overUnder;
  if (Number.isFinite(t) && t >= 180 && t <= 280) out.total = t;
  const sp = +pc.spread;
  if (Number.isFinite(sp) && Math.abs(sp) <= 30 && pc.spread != null) {
    // home team's line: negative when the home team is favored
    const homeFav = pc.homeTeamOdds && pc.homeTeamOdds.favorite, awayFav = pc.awayTeamOdds && pc.awayTeamOdds.favorite;
    out.spreadHome = homeFav ? -Math.abs(sp) : awayFav ? Math.abs(sp) : sp;
  }
  const ma = pc.awayTeamOdds && +pc.awayTeamOdds.moneyLine, mh = pc.homeTeamOdds && +pc.homeTeamOdds.moneyLine;
  if (Number.isFinite(ma) && Number.isFinite(mh) && Math.abs(ma) >= 100 && Math.abs(mh) >= 100) { const ia = implied(ma), ih = implied(mh); if (ia + ih > 0.95 && ia + ih < 1.2) out.pAway = ia / (ia + ih); }
  return out.total != null || out.spreadHome != null ? out : null;
}
/** Fallback for older games: ESPN's odds archive (tools/espnlines.js). Live-odds feeds are skipped: only the pregame close counts. */
function marketFromOdds(items) {
  const it = (items || []).filter((x) => x && !/live/i.test(x.provider || '') && (x.overUnder != null || x.spread != null))[0];
  if (!it) return null;
  const out = { total: null, spreadHome: null, pAway: null, books: 1, vendors: [it.provider || 'espn'], updated: null, totalRange: null, spreadRange: null };
  const t = +it.overUnder;
  if (Number.isFinite(t) && t >= 180 && t <= 280) out.total = t;
  const sp = +it.spread;
  if (it.spread != null && Number.isFinite(sp) && Math.abs(sp) <= 30) out.spreadHome = it.homeFav ? -Math.abs(sp) : it.awayFav ? Math.abs(sp) : sp;
  const ma = +it.awayML, mh = +it.homeML;
  if (it.awayML != null && it.homeML != null && Number.isFinite(ma) && Number.isFinite(mh) && Math.abs(ma) >= 100 && Math.abs(mh) >= 100) { const ia = implied(ma), ih = implied(mh); if (ia + ih > 0.95 && ia + ih < 1.2) out.pAway = ia / (ia + ih); }
  return out.total != null || out.spreadHome != null ? out : null;
}
function listsFromEspn(sum) {
  const out = {};
  for (const t of (sum.boxscore && sum.boxscore.players) || []) {
    const tm = L.espnAbbr(t.team && t.team.abbreviation);
    const st = (t.statistics && t.statistics[0]) || {};
    const iMin = (st.names || st.labels || []).indexOf('MIN');
    const ath = st.athletes || [];
    if (tm && ath.length) out[tm] = ath.map((x) => ({ name: (x.athlete && x.athlete.displayName) || '', starter: !!x.starter, dnp: !!x.didNotPlay, reason: x.didNotPlay ? x.reason || '' : '', min: iMin >= 0 && x.stats && x.stats[iMin] != null ? +x.stats[iMin] || 0 : 0, pos: (x.athlete && x.athlete.position && x.athlete.position.abbreviation) || null })).filter((x) => x.name);
  }
  return out;
}

const slateDir = path.join(L.DATA, 'slate');
const dates = fs.readdirSync(slateDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 10)).sort();
const bySeason = {};
let nGames = 0, nNoPlays = 0, nNoEspn = 0, nNoLine = 0;
for (const d of dates) {
  const season = L.seasons(d).cur;
  if (only.length && !only.includes(season)) continue;
  const rows = L.readJSON(path.join(slateDir, `${d}.json`));
  const sbP = path.join(L.DATA, 'espn', 'sb', `${d}.json.gz`);
  const sb = L.exists(sbP) ? L.readJSON(sbP) : { events: [] };
  for (const g0 of rows) {
    if (g0.status_state !== 'final') continue;
    const pp = path.join(L.DATA, 'plays', `${g0.id}.json.gz`);
    if (!L.exists(pp)) { nNoPlays++; continue; }
    const plays = L.readJSON(pp);
    const g = { id: g0.id, date: g0.date, datetime: g0.datetime, status_state: 'final', status: g0.status, display_status: g0.display_status, period: g0.period, time: g0.time, postseason: !!g0.postseason, season: g0.season,
      home_team: { abbreviation: g0.home_team.abbreviation, full_name: g0.home_team.full_name, id: g0.home_team.id }, visitor_team: { abbreviation: g0.visitor_team.abbreviation, full_name: g0.visitor_team.full_name, id: g0.visitor_team.id },
      home_team_score: g0.home_team_score, visitor_team_score: g0.visitor_team_score,
      home_q1: g0.home_q1, home_q2: g0.home_q2, home_q3: g0.home_q3, home_q4: g0.home_q4, visitor_q1: g0.visitor_q1, visitor_q2: g0.visitor_q2, visitor_q3: g0.visitor_q3, visitor_q4: g0.visitor_q4 };
    const log = E.logEntry(g, plays);
    const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
    const ev = (sb.events || []).find((e) => { const ab = (e.competitors || []).map((c) => c.abbr); return ab.includes(v) && ab.includes(h); });
    let market = null, lists = null, espnId = null;
    if (ev) {
      espnId = ev.id;
      const sp = path.join(L.DATA, 'espn', 'sum', `${ev.id}.json.gz`);
      if (L.exists(sp)) { const sum = L.readJSON(sp); market = marketFromEspn(sum); lists = listsFromEspn(sum); }
      const op = path.join(L.DATA, 'espn', 'odds', `${ev.id}.json.gz`);
      if (!market && L.exists(op)) market = marketFromOdds(L.readJSON(op));
    }
    if (!lists) nNoEspn++;
    if (!market) nNoLine++;
    (bySeason[season] = bySeason[season] || []).push({ g, log, market, lists, espnId });
    nGames++;
  }
}
for (const [s, arr] of Object.entries(bySeason)) {
  arr.sort((a, b) => String(a.g.date).localeCompare(String(b.g.date)) || a.g.id - b.g.id);
  L.writeJSON(path.join(L.DERIVED, `games-${s}.json.gz`), arr);
  console.log(`season ${s}: ${arr.length} games, ${arr[0].g.date} .. ${arr[arr.length - 1].g.date}`);
}
console.log(`games ${nGames}, missing plays ${nNoPlays}, missing ESPN box ${nNoEspn}, missing closing line ${nNoLine}`);
