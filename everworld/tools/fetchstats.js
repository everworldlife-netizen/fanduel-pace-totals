#!/usr/bin/env node
/* Refresh the DataBallr season data the lab needs to rebuild "what the app knew on that date":
 *   - season stat lines (what the app reads as priors)            data/stats/players-<Y>.json.gz
 *   - season team stats                                           data/stats/teams-<Y>.json.gz
 *   - every player's and team's season totals (play-by-play)      data/stats/totals-<Y>.json.gz
 *   - per-game player logs from the play-by-play engine           data/plog/<Y>/<person_id>.json.gz
 *   - per-game team logs from the play-by-play engine             data/tlog/<Y>/<team_id>.json.gz
 *   - per-game tracking logs (usage etc., what the app's gameLogs read)  data/glog/<Y>/<nba_id>.json.gz
 * Seasons are labelled by end year (2025-26 = 2026). Finished seasons are fetched once; the current one is refreshed.
 *
 *   node tools/fetchstats.js <season> [<season> ...] [--refresh]
 */
'use strict';
const path = require('path');
const L = require('./lib');

const seasons = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);
const refresh = process.argv.includes('--refresh');
if (!seasons.length) { console.error('usage: node tools/fetchstats.js <season> [...] [--refresh]'); process.exit(1); }
const TEAM_IDS = Array.from({ length: 30 }, (_, i) => 1610612737 + i);
const S = (...p) => path.join(L.DATA, ...p);
const stale = (p, force) => force || !L.exists(p);

(async () => {
  for (const Y of seasons) {
    console.error(`season ${Y}`);
    const force = refresh;
    if (stale(S('stats', `players-${Y}.json.gz`), force)) {
      const rows = await L.getJSON(`${L.DB}/v1/nba/players/stats?year=${Y}&playoffs=0&limit=1000`);
      if (Array.isArray(rows) && rows.length) L.writeJSON(S('stats', `players-${Y}.json.gz`), rows);
    }
    if (stale(S('stats', `teams-${Y}.json.gz`), force)) {
      const j = await L.getJSON(`${L.DB}/v1/nba/teams/stats?season=${Y}`);
      if (j && j.team) L.writeJSON(S('stats', `teams-${Y}.json.gz`), j);
    }
    for (const type of ['regular', 'playoffs']) {
      const f = S('stats', `totals-${Y}-${type}.json.gz`);
      if (stale(f, force)) {
        const j = await L.getJSON(`${L.DB}/v1/nba/pbp/season-totals?season=${Y}&season_type=${type}`);
        if (j && j.columns) L.writeJSON(f, j);
      }
    }
    const tot = L.exists(S('stats', `totals-${Y}-regular.json.gz`)) ? L.readJSON(S('stats', `totals-${Y}-regular.json.gz`)) : null;
    const ids = tot ? tot.columns.person_id.slice() : [];
    console.error(`  players: ${ids.length}`);

    console.error('  team logs');
    // (these log endpoints serve the regular season only, which is also all DataBallr's season tables hold)
    await L.pool(TEAM_IDS, 2, async (tid) => {
      const f = S('tlog', String(Y), `${tid}.json.gz`);
      if (!stale(f, force)) return;
      const j = await L.getJSON(`${L.DB}/v1/nba/pbp/team-log?team_id=${tid}&season=${Y}`);
      if (j && j.core && j.core.rows) L.writeJSON(f, { team: j.team, team_id: j.team_id, season: j.season, playoffs: j.playoffs, rows: j.core.rows, columns: j.core.columns });
      await L.sleep(150);
    });

    console.error('  player logs (play-by-play engine)');
    await L.pool(ids, 3, async (id) => {
      const f = S('plog', String(Y), `${id}.json.gz`);
      if (!stale(f, force)) return;
      const j = await L.getJSON(`${L.DB}/v1/nba/pbp/player-log?person_id=${id}&season=${Y}`);
      if (j && j.core && j.core.rows) {
        // keep the columns a box score and a usage profile need
        const keep = ['date', 'game_id', 'team', 'team_id', 'opponent', 'is_home', 'seconds_pbp', 'off_poss', 'def_poss', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'fouls', 'fga', 'fgm', 'fg2a', 'fg2m', 'fg3a', 'fg3m', 'fta', 'ftm', 'at_rim_fga', 'at_rim_fgm', 'short_midrange_fga', 'short_midrange_fgm', 'long_midrange_fga', 'long_midrange_fgm', 'corner3_fga', 'corner3_fgm', 'arc3_fga', 'arc3_fgm', 'plus_minus', 'stints', 'fgm_assisted'];
        const cols = {}; for (const k of keep) if (j.core.columns[k]) cols[k] = j.core.columns[k];
        L.writeJSON(f, { name: j.name, person_id: j.person_id, season: j.season, playoffs: j.playoffs, rows: j.core.rows, columns: cols });
      }
      await L.sleep(100);
    });

    console.error('  tracking game logs');
    await L.pool(ids, 3, async (id) => {
      const f = S('glog', String(Y), `${id}.json.gz`);
      if (!stale(f, force)) return;
      const j = await L.getJSON(`${L.DB}/v1/nba/players/game-logs?nba_id=${id}&year=${Y}&limit=120`);
      const rows = (j && j.data) || [];
      L.writeJSON(f, rows.map((r) => { const o = { ...r }; delete o.pending_fields; delete o.unsupported_fields; return o; }));
      await L.sleep(150);
    });
  }
  console.error('done');
})().catch((e) => { console.error(e); process.exit(1); });
