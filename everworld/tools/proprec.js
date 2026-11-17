#!/usr/bin/env node
/* Record the books' player lines (props) and game lines for one night, before they vanish from the feed.
 * The feed keeps no history of player lines: once a game is played they are gone. Run this before the first tip and again
 * shortly before each later tip; every run adds one snapshot per game that has not started.
 *   node tools/proprec.js [--date 2026-11-13] [--all]        (--all: also games already under way, marked live)
 * Writes data/props/<date>/<game id>-<HHMM>.json.gz (the feed's own rows, untouched) and data/props/<date>/slate-<HHMM>.json.gz
 * Polite: one request per game, one at a time.
 */
'use strict';
const path = require('path');
const L = require('./lib');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const etDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
(async () => {
  const date = arg('--date', etDate()), now = new Date(), hhmm = now.toISOString().slice(11, 16).replace(':', '');
  const dir = path.join(L.DATA, 'props', date);
  const slate = await L.getJSON(`${L.DB}/v1/nba/live/games/${date}`);
  const games = (slate && (slate.data || slate.games || slate)) || [];
  L.writeJSON(L.ensure(path.join(dir, `slate-${hhmm}.json.gz`)), { at: now.toISOString(), games });
  let odds = null; try { odds = await L.getJSON(`${L.DB}/v1/nba/odds?date=${date}`); } catch { odds = null; }
  if (odds) L.writeJSON(path.join(dir, `lines-${hhmm}.json.gz`), { at: now.toISOString(), rows: odds.data || odds });
  // the two injury reports the phone reads, as they stand now (to study what the lines know that the reports do not)
  try { const inj = await L.getJSON(`${L.DB}/v1/nba/injuries?date=${date}`); L.writeJSON(path.join(dir, `injuries-${hhmm}.json.gz`), { at: now.toISOString(), rows: (inj && inj.data) || [] }); } catch { /* not vital */ }
  try { const e = await L.getJSON(`${L.ESPN}/injuries`); const rows = []; for (const t of e.injuries || []) for (const x of t.injuries || []) rows.push({ team: t.displayName, name: x.athlete && x.athlete.displayName, status: x.status, date: x.date, note: x.shortComment, fs: (x.details && x.details.fantasyStatus && x.details.fantasyStatus.abbreviation) || null, type: (x.details && x.details.type) || null, ret: (x.details && x.details.returnDate) || null }); L.writeJSON(path.join(dir, `espn-injuries-${hhmm}.json.gz`), { at: now.toISOString(), rows }); } catch { /* not vital */ }
  let saved = 0, lines = 0;
  for (const g of games) {
    const state = String(g.status_state || g.display_status || g.status || '').toLowerCase();
    const started = /^(in|post|final)/.test(state) || g.period > 0;
    if (started && !argv.includes('--all')) { console.log(`  ${g.visitor_team && g.visitor_team.abbreviation}@${g.home_team && g.home_team.abbreviation}: already started (${g.status}), not recorded`); continue; }
    let rows = [];
    try { const r = await L.getJSON(`${L.DB}/v1/nba/odds/games/${g.id}/props`); rows = (r && r.data) || []; } catch (e) { console.log(`  game ${g.id}: ${e.message}`); }
    // keep what a line is (player, stat, number, book, prices, time); the links into each book's bet slip are nine tenths of the bytes
    rows = rows.map((x) => ({ player_id: x.player_id, prop_type: x.prop_type, line_value: x.line_value, vendor: x.vendor, market: x.market, updated_at: x.updated_at }));
    L.writeJSON(path.join(dir, `${g.id}-${hhmm}.json.gz`), { at: now.toISOString(), game: { id: g.id, date: g.date, datetime: g.datetime, status: g.status, started, visitor: g.visitor_team && g.visitor_team.abbreviation, home: g.home_team && g.home_team.abbreviation }, rows });
    saved++; lines += rows.length;
    const types = {}; for (const r of rows) types[r.prop_type] = (types[r.prop_type] || 0) + 1;
    console.log(`  ${g.visitor_team && g.visitor_team.abbreviation}@${g.home_team && g.home_team.abbreviation} (${g.status}): ${rows.length} lines ${JSON.stringify(types).slice(0, 160)}`);
    await L.sleep(400);
  }
  console.log(`${date} ${now.toISOString().slice(11, 16)} UTC: ${saved} games recorded, ${lines} player lines → ${dir}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
