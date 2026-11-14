#!/usr/bin/env node
/* Closing game lines from ESPN's odds archive for games whose game summary has no line (older games).
 * Cached per event in data/espn/odds/<eventId>.json.gz; tools/prep.js reads them as a fallback.
 *
 *   node tools/espnlines.js [--all]      (default: only games that still lack a line)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const all = process.argv.includes('--all');
const dir = L.DERIVED;
const need = [];
for (const f of fs.readdirSync(dir).filter((x) => /^games-\d+\.json\.gz$/.test(x))) {
  for (const it of L.readJSON(path.join(dir, f))) {
    if (!it.espnId) continue;
    if (!all && it.market) continue;
    if (!L.exists(path.join(L.DATA, 'espn', 'odds', `${it.espnId}.json.gz`))) need.push(it.espnId);
  }
}
console.error(`odds to fetch: ${need.length}`);
(async () => {
  let got = 0, empty = 0;
  await L.pool(need, 3, async (id) => {
    const j = await L.getJSON(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${id}/competitions/${id}/odds`);
    const items = ((j && j.items) || []).map((x) => ({
      provider: x.provider && x.provider.name, priority: x.provider && x.provider.priority, details: x.details, overUnder: x.overUnder, spread: x.spread,
      awayFav: !!(x.awayTeamOdds && x.awayTeamOdds.favorite), homeFav: !!(x.homeTeamOdds && x.homeTeamOdds.favorite),
      awayML: x.awayTeamOdds && x.awayTeamOdds.moneyLine, homeML: x.homeTeamOdds && x.homeTeamOdds.moneyLine,
      closeTotal: x.close && x.close.total && x.close.total.american, openTotal: x.open && x.open.total && x.open.total.american,
    }));
    L.writeJSON(path.join(L.DATA, 'espn', 'odds', `${id}.json.gz`), items);
    if (items.length) got++; else empty++;
  });
  console.error(`done: ${got} with odds, ${empty} empty`);
})().catch((e) => { console.error(e); process.exit(1); });
