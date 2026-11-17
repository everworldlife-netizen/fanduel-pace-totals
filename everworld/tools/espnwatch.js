#!/usr/bin/env node
/* Record what ESPN's game boxes show WHILE games are on (who is listed, who is flagged "did not play", minutes),
 * every few minutes, so the lab can learn what the phone really sees at tip-off (archived boxes only show the end state).
 *   node tools/espnwatch.js --date 20261110 [--every 300] [--for 9000]     → data/espn/livecheck/<date>.jsonl
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const date = arg('--date'), every = +arg('--every', 300) * 1000, until = Date.now() + +arg('--for', 9000) * 1000;
const out = path.join(L.DATA, 'espn', 'livecheck', `${date}.jsonl`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const done = new Set();
async function once() {
  const sb = await L.getJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`);
  let live = 0;
  for (const ev of sb.events || []) {
    const st = ev.status.type;
    if (done.has(ev.id)) continue;
    const sum = await L.getJSON(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${ev.id}`);
    const g = { at: new Date().toISOString(), id: ev.id, name: ev.shortName, state: st.state, detail: st.detail, teams: {} };
    for (const t of (sum.boxscore && sum.boxscore.players) || []) {
      const s0 = (t.statistics && t.statistics[0]) || {}, iMin = (s0.names || s0.labels || []).indexOf('MIN');
      g.teams[t.team.abbreviation] = (s0.athletes || []).map((x) => ({ name: x.athlete.displayName, starter: !!x.starter, dnp: !!x.didNotPlay, reason: x.reason || '', active: x.active, min: iMin >= 0 && x.stats ? x.stats[iMin] : null }));
    }
    fs.appendFileSync(out, JSON.stringify(g) + '\n');
    if (st.state === 'post') done.add(ev.id); else live++;
  }
  return live;
}
(async () => {
  for (;;) {
    let live = 1;
    try { live = await once(); } catch (e) { console.error(new Date().toISOString(), e.message); }
    if (!live || Date.now() > until) break;
    await new Promise((r) => setTimeout(r, every));
  }
  console.log('done', out);
})();
