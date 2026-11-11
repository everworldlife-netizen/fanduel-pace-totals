/* Point-in-time inputs: rebuild what the live app knew on a given date from DataBallr's per-game logs.
 *   curPriors(E, season, date)  → the season-to-date stat lines, in the shape Engine.slimStats returns
 *   lastPriors(E, season)       → last season's finished stat lines (Engine.slimStats of the real table)
 *   teamsAt(season, date)       → season-to-date team stats, in the shape Engine.slimTeams returns
 *   gameLogsAt(E, season, date, nbaId) → Engine.slimGameLogs of the tracking logs before that date
 * Nothing here ever reads a game played on or after `date`.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const dInt = (s) => +String(s).slice(0, 10).replace(/-/g, '');
const cache = { plog: {}, tlog: {}, glog: {}, stats: {}, cur: new Map(), teams: new Map(), last: new Map(), meta: {} };

/** The real DataBallr season table (used for last season's priors and for names/positions/ages by nba_id). */
function statsTable(season) {
  if (cache.stats[season] === undefined) {
    const p = path.join(L.DATA, 'stats', `players-${season}.json.gz`);
    cache.stats[season] = L.exists(p) ? L.readJSON(p) : null;
  }
  return cache.stats[season];
}
function lastPriors(E, season) {
  if (!cache.last.has(season)) cache.last.set(season, E.slimStats(statsTable(season - 1) || []));
  return cache.last.get(season);
}
/** Static facts per nba_id (name as the stats table spells it, position, age, archetype): from this season's table, else last season's. */
function metaById(season) {
  if (cache.meta[season]) return cache.meta[season];
  const m = new Map();
  for (const s of [season - 1, season]) for (const r of statsTable(s) || []) {
    const id = r.nba_id || r.RowId; if (!id) continue;
    const old = m.get(+id) || {};
    // age moves with the season: last season's age + 1 is close enough when this season's row is missing
    m.set(+id, { name: r.Name || old.name, pos: r.Pos2 || old.pos || null, age: s === season ? r.Age : (old.age != null ? old.age : r.Age != null ? +r.Age + 1 : null) });
  }
  cache.meta[season] = m;
  return m;
}

/** Every player's per-game rows for a season (regular season + playoffs), oldest first. */
function playerLogs(season) {
  if (cache.plog[season]) return cache.plog[season];
  const dir = path.join(L.DATA, 'plog', String(season));
  const out = new Map();
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    const j = L.readJSON(path.join(dir, f));
    const c = j.columns, n = j.rows;
    const rows = [];
    for (let i = 0; i < n; i++) { const r = { po: !!j.playoffs }; for (const k of Object.keys(c)) r[k] = c[k][i]; rows.push(r); }
    const id = +j.person_id;
    const cur = out.get(id) || { id, name: j.name, rows: [] };
    cur.rows.push(...rows);
    out.set(id, cur);
  }
  for (const p of out.values()) p.rows.sort((a, b) => a.date - b.date);
  cache.plog[season] = out;
  return out;
}

/** Season-to-date stat lines before `date`, keyed like Engine.slimStats (normalized name). Regular-season games only, like DataBallr's table. */
function curPriors(E, season, date) {
  const key = `${season}:${date}`;
  if (cache.cur.has(key)) return cache.cur.get(key);
  const D = dInt(date), meta = metaById(season);
  const out = {};
  for (const p of playerLogs(season).values()) {
    const a = { gp: 0, sec: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, fg3a: 0, fg2m: 0, fg2a: 0, fga: 0, fta: 0, ftm: 0, tov: 0, off: 0 };
    let team = null;
    for (const r of p.rows) {
      if (r.date >= D) break;
      if (r.po || !(r.seconds_pbp > 0)) continue;
      a.gp++; a.sec += r.seconds_pbp; a.pts += r.pts || 0; a.reb += r.reb || 0; a.ast += r.ast || 0; a.fg3m += r.fg3m || 0; a.fg3a += r.fg3a || 0;
      a.fg2m += r.fg2m || 0; a.fg2a += r.fg2a || 0; a.fga += r.fga || 0; a.fta += r.fta || 0; a.ftm += r.ftm || 0; a.tov += r.tov || 0; a.off += r.off_poss || 0;
      team = r.team || team;
    }
    if (!a.gp || !a.sec) continue;
    const min = a.sec / 60, mpg = min / a.gp, m = meta.get(p.id) || {};
    const name = m.name || p.name;
    out[E.norm(name)] = {
      name, team, gp: a.gp, mpg,
      pts: a.pts / min, reb: a.reb / min, ast: a.ast / min, fg3m: a.fg3m / min,
      fg3a: a.fg3a, p3: a.fg3a ? a.fg3m / a.fg3a : null, p2: a.fg2a ? a.fg2m / a.fg2a : null, ft: a.fta ? a.ftm / a.fta : null,
      tsa100: a.off ? (100 * (a.fga + 0.44 * a.fta)) / a.off : null, tovpg: a.tov / a.gp, offPoss: a.off, r3: a.fga ? a.fg3a / a.fga : null, ftr: a.fga ? a.fta / a.fga : null,
      age: m.age != null ? m.age : null, nba_id: p.id, pos: m.pos || null, arch: null, prof: {},
    };
  }
  cache.cur.set(key, out);
  return out;
}

function teamLogs(season) {
  if (cache.tlog[season]) return cache.tlog[season];
  const dir = path.join(L.DATA, 'tlog', String(season));
  const out = new Map();
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    const j = L.readJSON(path.join(dir, f));
    const c = j.columns, n = j.rows;
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ po: !!j.playoffs, date: c.date[i], sec: c.seconds_pbp[i], off: c.own_possessions[i], def: c.opp_possessions[i], pts: c.own_points[i], opp: c.opp_points[i],
      fg2a: c.own_fg2a[i], fg2m: c.own_fg2m[i], fg3a: c.own_fg3a[i], fg3m: c.own_fg3m[i], fta: c.own_fta[i], ftm: c.own_ftm[i], tov: c.own_turnovers[i], ast: c.own_assists[i], stl: c.own_stl[i], blk: c.own_blk[i] });
    const cur = out.get(j.team) || [];
    cur.push(...rows);
    out.set(j.team, cur);
  }
  for (const r of out.values()) r.sort((a, b) => a.date - b.date);
  cache.tlog[season] = out;
  return out;
}
/** Season-to-date team stats before `date` (regular season), in the shape Engine.slimTeams returns. */
function teamsAt(season, date) {
  const key = `${season}:${date}`;
  if (cache.teams.has(key)) return cache.teams.get(key);
  const D = dInt(date);
  const teams = {};
  const lg = { sec: 0, off: 0, def: 0, pts: 0, opp: 0, fg2a: 0, fg2m: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, tov: 0, ast: 0, stl: 0, blk: 0 };
  const one = (a, name) => {
    const g = a.sec / 2880, fga = a.fg2a + a.fg3a;
    return { name, g: +g.toFixed(2), pace: g ? a.off / g : null, ortg: a.off ? (100 * a.pts) / a.off : null, drtg: a.def ? (100 * a.opp) / a.def : null,
      efg: fga ? (a.fg2m + 1.5 * a.fg3m) / fga : null, ts: fga + 0.44 * a.fta ? a.pts / (2 * (fga + 0.44 * a.fta)) : null, fg2: a.fg2a ? a.fg2m / a.fg2a : null, fg3: a.fg3a ? a.fg3m / a.fg3a : null,
      tov100: a.off ? (100 * a.tov) / a.off : null, ast: g ? a.ast / g : null, fta: fga ? a.fta / fga : null, stl: g ? a.stl / g : null, blk: g ? a.blk / g : null };
  };
  for (const [tm, rows] of teamLogs(season)) {
    const a = { sec: 0, off: 0, def: 0, pts: 0, opp: 0, fg2a: 0, fg2m: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, tov: 0, ast: 0, stl: 0, blk: 0 };
    for (const r of rows) { if (r.date >= D) break; if (r.po) continue; for (const k of Object.keys(a)) a[k] += r[k] || 0; }
    if (!a.sec) continue;
    teams[tm] = one(a, tm);
    for (const k of Object.keys(lg)) lg[k] += a[k];
  }
  const out = { teams, league: lg.sec ? one(lg, 'league') : null, statType: 'team', season };
  cache.teams.set(key, out);
  return out;
}

/** The tracking game logs the app reads (usage, etc.): the 20 most recent before `date`, slimmed by the engine. */
function gameLogsAt(E, season, date, nbaId) {
  const k = `${season}:${nbaId}`;
  if (cache.glog[k] === undefined) {
    const p = path.join(L.DATA, 'glog', String(season), `${nbaId}.json.gz`);
    cache.glog[k] = L.exists(p) ? L.readJSON(p).filter((r) => !r.playoffs).sort((a, b) => b.date - a.date) : null;
  }
  const rows = cache.glog[k];
  if (!rows) return null;
  const D = dInt(date);
  const before = [];
  for (const r of rows) { if (r.date < D) { before.push(r); if (before.length >= 20) break; } }
  return before.length ? E.slimGameLogs(before) : null;
}

module.exports = { dInt, statsTable, lastPriors, curPriors, teamsAt, gameLogsAt, playerLogs, teamLogs, metaById };
