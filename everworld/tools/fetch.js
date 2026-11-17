#!/usr/bin/env node
/* Refresh the NBA cache: DataBallr slates + play-by-play, and ESPN scoreboards + game summaries
 * (closing lines, starters, active lists). Everything is cached on disk; finished games are never re-fetched.
 *
 *   node tools/fetch.js <from YYYY-MM-DD> <to YYYY-MM-DD> [--no-espn]
 */
'use strict';
const path = require('path');
const L = require('./lib');

const [from, to] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noEspn = process.argv.includes('--no-espn');
if (!from || !to) { console.error('usage: node tools/fetch.js <from> <to> [--no-espn]'); process.exit(1); }

const slatePath = (d) => path.join(L.DATA, 'slate', `${d}.json`);
const playsPath = (id) => path.join(L.DATA, 'plays', `${id}.json.gz`);
const sbPath = (d) => path.join(L.DATA, 'espn', 'sb', `${d}.json.gz`);
const sumPath = (id) => path.join(L.DATA, 'espn', 'sum', `${id}.json.gz`);

(async () => {
  const dates = L.dateRange(from, to);
  // 1) slates
  console.error(`slates ${from}..${to} (${dates.length} days)`);
  const slates = {};
  await L.pool(dates, 3, async (d) => {
    if (L.exists(slatePath(d))) { slates[d] = L.readJSON(slatePath(d)); return; }
    const j = await L.getJSON(`${L.DB}/v1/nba/live/games/${d}`);
    const rows = (j && j.data) || [];
    slates[d] = rows;
    // only finished days are frozen on disk
    if (rows.every((g) => g.status_state === 'final' || g.postponed)) L.writeJSON(slatePath(d), rows);
  });
  const games = [];
  for (const d of dates) for (const g of slates[d] || []) if (g.status_state === 'final') games.push(g);
  console.error(`final games: ${games.length}`);

  // 2) play-by-play
  const need = games.filter((g) => !L.exists(playsPath(g.id)));
  console.error(`plays to fetch: ${need.length}`);
  const bad = [];
  await L.pool(need, 3, async (g) => {
    const j = await L.getJSON(`${L.DB}/v1/nba/games/${g.id}/plays`);
    const rows = (j && j.data) || [];
    if (rows.length < 200) { bad.push(g.id); return; }
    // drop the repeated team blob (keep the abbreviation, which is all the engine reads)
    L.writeJSON(playsPath(g.id), rows.map((p) => ({ ...p, team: p.team ? { abbreviation: p.team.abbreviation, id: p.team.id } : null })));
  });
  if (bad.length) console.error(`thin play-by-play (skipped): ${bad.join(',')}`);

  // 3) ESPN scoreboards and summaries
  if (!noEspn) {
    console.error('espn scoreboards');
    const events = [];
    await L.pool(dates.filter((d) => (slates[d] || []).length), 3, async (d) => {
      let j;
      if (L.exists(sbPath(d))) j = L.readJSON(sbPath(d));
      else {
        j = await L.getJSON(`${L.ESPN}/scoreboard?dates=${d.replace(/-/g, '')}`);
        const done = ((j && j.events) || []).every((e) => /FINAL|POSTPONED|CANCEL/.test((e.status && e.status.type && e.status.type.name) || ''));
        if (j && done) L.writeJSON(sbPath(d), { events: (j.events || []).map((e) => ({ id: e.id, date: e.date, name: e.name, shortName: e.shortName, status: e.status && e.status.type && e.status.type.name, competitors: (((e.competitions || [])[0] || {}).competitors || []).map((c) => ({ abbr: L.espnAbbr(c.team && c.team.abbreviation), id: c.team && c.team.id, home: c.homeAway === 'home', score: +c.score || 0 })) })) });
        if (j) j = { events: (j.events || []).map((e) => ({ id: e.id, status: e.status && e.status.type && e.status.type.name })) };
      }
      for (const e of (j && j.events) || []) if (/FINAL/.test(e.status || '')) events.push(e.id);
    });
    const needS = events.filter((id) => !L.exists(sumPath(id)));
    console.error(`espn summaries to fetch: ${needS.length} of ${events.length}`);
    await L.pool(needS, 3, async (id) => {
      const j = await L.getJSON(`${L.ESPN}/summary?event=${id}`);
      if (!j || !j.boxscore) return;
      // keep what the lab needs: lines, box (starters, active lists, minutes), plays (backup feed), header
      L.writeJSON(sumPath(id), { boxscore: j.boxscore, pickcenter: j.pickcenter || [], header: j.header || null, plays: j.plays || [], gameInfo: j.gameInfo ? { attendance: j.gameInfo.attendance, officials: j.gameInfo.officials } : null });
    });
  }
  console.error('done');
})().catch((e) => { console.error(e); process.exit(1); });
