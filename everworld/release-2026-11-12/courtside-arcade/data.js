/* Courtside Arcade — DataBallr client (through the Supabase data relay). */
(function () {
'use strict';
const BASE = 'https://pjthpontugjihnjsxxry.supabase.co/functions/v1/gg-winner/db';
const mem = new Map();
const VER = 'v6'; // v6: the box counts every made three, whatever its wording (v5: scoring timeline for situational tendencies, v4: shot zones, v3: stints + foul times)
const PVER = 'p4'; // p4: player profiles carry the DataBallr ids, archetype and profile numbers
const raw = { players: new Map(), teams: new Map(), logs: new Map() }; // full DataBallr rows (memory only)
const PRIORS_MS = 6 * 3600000; // how long one read of the season table is used before it is read again

// free the space held by older log formats
try { Object.keys(localStorage).filter((k) => k.startsWith('log:') && !k.startsWith(`log:${VER}:`)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
try { Object.keys(localStorage).filter((k) => (k.startsWith('priors:') && !k.startsWith(`priors:${PVER}:`)) || (k.startsWith('glog:') && !k.startsWith(`glog:${PVER}:${etDate(0)}:`))).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
// dated keys nothing reads any more: slates older than the look-back, the working slate from before yesterday, old tip-off and
// status maps, lines of games from more than a week ago. Left in place they crowd the game logs out of a small phone's storage.
try {
const today = etDate(0);
for (const k of Object.keys(localStorage)) {
let m;
if ((m = k.match(/^slate:last:(\d{4}-\d\d-\d\d)$/))) { if (m[1] < addDays(today, -1)) localStorage.removeItem(k); }
else if ((m = k.match(/^slate:[^:]+:(\d{4}-\d\d-\d\d)$/))) { if (!k.startsWith(`slate:${VER}:`) || m[1] < addDays(today, -25)) localStorage.removeItem(k); }
else if ((m = k.match(/^(?:tip|overrides):(\d{4}-\d\d-\d\d)$/))) { if (m[1] < addDays(today, -2)) localStorage.removeItem(k); }
else if (k.startsWith('glines:')) { let v = null; try { v = JSON.parse(localStorage.getItem(k)); } catch { v = null; } if (!v || !(v.at > Date.now() - 7 * 86400000)) localStorage.removeItem(k); }
// game logs of games nothing looks back to any more (recent form reads 21 days back, the nightly learning 5 more): without
// this the logs pile up for the whole season until storage refuses a write
else if (k.startsWith(`log:${VER}:`)) { const d = /"date":"(\d{4}-\d\d-\d\d)/.exec((localStorage.getItem(k) || '').slice(0, 120)); if (d && d[1] < addDays(today, -30)) localStorage.removeItem(k); }
}
} catch { /* ignore */ }

const store = {
get(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } },
/** Saves a value and says whether it really landed (true) or storage refused it (false). */
set(k, v) {
let s;
try { s = JSON.stringify(v); } catch { return false; }
try { localStorage.setItem(k, s); return true; } catch { /* storage is full: make room below */ }
// drop cached game logs, oldest games first (their ids rise with the date), 40 at a time, until the value fits; a large value
// (the phone's own lessons) needs more room than one round frees. Dropped logs are simply read again when a slate needs them.
for (let round = 0; round < 12; round++) {
let ks = [];
try {
ks = Object.keys(localStorage).filter((x) => x.startsWith('log:') && x !== k).sort((a, b) => (+a.split(':')[2] || 0) - (+b.split(':')[2] || 0)).slice(0, 40);
if (!ks.length) ks = Object.keys(localStorage).filter((x) => x.startsWith('glog:') && x !== k).slice(0, 80);
ks.forEach((x) => localStorage.removeItem(x));
} catch { return false; }
if (!ks.length) return false;
try { localStorage.setItem(k, s); return true; } catch { /* still full: next round */ }
}
return false;
},
};

async function getJSON(path, ttlMs = 0) {
const hit = mem.get(path);
// A copy is only good for the freshness this caller asked for (a live score must not reuse an hour-old read).
if (hit && ttlMs > 0 && Date.now() - hit.at < ttlMs) return hit.data;
const r = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
if (!r.ok) throw new Error(`DataBallr ${r.status}`);
const data = await r.json();
mem.set(path, { data, at: Date.now() });
return data;
}

// (function declarations, so the start-up clean-up above can use them)
function addDays(s, n) { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** Today's date in US Eastern time, or that date plus a number of calendar days (shifting the clock by 24 hours instead was a day off for an hour around each daylight-saving change). */
function etDate(offsetDays = 0) {
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
return offsetDays ? addDays(today, offsetDays) : today;
}

const lastSlate = new Map();
let slateSource = 'databallr', savedAt = 0;
async function slate(date, ttl = 6000) {
const today = etDate(0);
if (date < today) {
const cached = store.get(`slate:${VER}:${date}`);
if (cached) return cached;
}
let rows;
try {
const j = await getJSON(`/v1/nba/live/games/${date}`, ttl);
rows = j.data || [];
if (rows.length) lastSlate.set(date, rows);
slateSource = 'databallr';
} catch (e) {
// DataBallr is not answering: keep the board alive from the last slate we saw, with ESPN's live scores on top
const keep = lastSlate.get(date) || store.get(`slate:last:${date}`);
if (!keep || !keep.length) throw e;
try { rows = await espnScores(keep, date); slateSource = 'espn'; } catch { rows = keep; slateSource = 'saved'; }
}
if (date === today && rows.length && slateSource === 'databallr' && (!savedAt || Date.now() - savedAt > 120000)) { savedAt = Date.now(); store.set(`slate:last:${date}`, rows); }
if (date < today && rows.length && rows.every((g) => g.status_state === 'final')) store.set(`slate:${VER}:${date}`, rows);
return rows;
}

async function plays(gameId, final = false, fresh = false) {
// fresh: never reuse a copy (the last read of a live game can be a play or two short of the final)
const j = await getJSON(`/v1/nba/games/${gameId}/plays`, fresh ? 0 : final ? 3600000 : 3000);
return j.data || [];
}
const feed = {}; // gameId -> 'databallr' | 'espn' (which play-by-play feed the last read came from)
/**
* Play-by-play that doesn't go dark: DataBallr first; if it fails, comes back empty mid-game, or has fallen
* behind the scoreboard, ESPN's copy of the same play-by-play is used instead.
*/
async function livePlays(game, { final = false, nameToPid = null, scoreNow = null, fresh = false } = {}) {
let rows = null, err = null;
try { rows = await plays(game.id, final, fresh); } catch (e) { err = e; }
const last = rows && rows.length ? rows[rows.length - 1] : null;
const behind = !!(scoreNow != null && last && last.away_score != null && scoreNow - ((last.away_score || 0) + (last.home_score || 0)) >= 6);
if (rows && rows.length && !behind) { feed[game.id] = 'databallr'; return rows; }
try {
const ev = await espnEvent(game);
if (ev) {
const sum = await espnJSON(`${ESPN}/summary?event=${ev.id}`, fresh ? 0 : final ? 3600000 : 3000);
const alt = window.Engine.playsFromEspn(sum, nameToPid);
if (alt.length && (!rows || alt.length > rows.length)) { feed[game.id] = 'espn'; return alt; }
}
} catch { /* backup not reachable either */ }
if (rows) { feed[game.id] = 'databallr'; return rows; }
throw err || new Error('no play-by-play');
}
/** Live scores and clocks from ESPN's scoreboard, laid over the last slate we have (used when DataBallr's slate is down). */
async function espnScores(rows, date) {
const d = String(date).replace(/-/g, '');
const j = await espnJSON(`${ESPN}/scoreboard?dates=${d}`, 4000);
const ord = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
return rows.map((g) => {
const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
const e = ((j && j.events) || []).find((x) => { const c = ((x.competitions || [])[0] || {}).competitors || []; const ab = c.map((y) => espnAbbr(y.team && y.team.abbreviation)); return ab.includes(v) && ab.includes(h); });
if (!e) return g;
const c = e.competitions[0], stt = (e.status && e.status.type && e.status.type.name) || '', per = (e.status && e.status.period) || 0, clk = (e.status && e.status.displayClock) || '';
const sc = (ab) => { const y = c.competitors.find((z) => espnAbbr(z.team && z.team.abbreviation) === ab); return y ? +y.score || 0 : 0; };
const out = { ...g, visitor_team_score: sc(v), home_team_score: sc(h), period: per };
if (/FINAL/.test(stt)) { out.status_state = 'final'; out.time = 'Final'; out.display_status = 'final'; }
else if (/HALFTIME/.test(stt)) { out.status_state = 'in'; out.period = 2; out.time = 'Half'; }
else if (/END_PERIOD/.test(stt)) { out.status_state = 'in'; out.time = `End of ${ord(per)}`; }
else if (/IN_PROGRESS/.test(stt)) { out.status_state = 'in'; out.time = `Q${per} ${clk}`; }
return out;
});
}

async function lastSeasonPriors(season) {
const key = `priors:${PVER}:${season}`;
const cached = store.get(key);
if (cached && Object.keys(cached).length > 100) return cached;
const rows = await getJSON(`/v1/nba/players/stats?year=${season}&playoffs=0&limit=1000`, 86400000);
keepRaw(season, rows);
const slim = window.Engine.slimStats(rows);
store.set(key, slim);
return slim;
}

/** This season's DataBallr line, refreshed daily (used once players have games). */
async function currentSeasonPriors(season, date) {
const key = `priors:${PVER}:cur:${season}`;
const cached = store.get(key);
// good for the day it was read on, and for six hours: a table read just after midnight may not hold last night's late games yet,
// so a later start that day reads it again (a stored table without a time is from an older version: read again once)
if (cached && cached.date === date && cached.at > Date.now() - PRIORS_MS) return cached.data;
try {
// a stored table that is out of date is never replaced by a read still held in memory from before (ttl 0: ask the feed)
const rows = await getJSON(`/v1/nba/players/stats?year=${season}&playoffs=0&limit=1000`, cached ? 0 : 3600000);
keepRaw(season, rows);
const slim = window.Engine.slimStats(rows);
store.set(key, { date, at: Date.now(), data: slim });
return slim;
} catch { return (cached && cached.data) || {}; }
}

function keepRaw(season, rows) {
const m = new Map();
for (const r of rows || []) if (r && r.Name) m.set(window.Engine.norm(r.Name), r);
raw.players.set(season, m);
}

/** Every DataBallr season field for one player (all ~450), fetched on demand. */
async function playerAll(season, name) {
if (!raw.players.has(season)) {
try { keepRaw(season, await getJSON(`/v1/nba/players/stats?year=${season}&playoffs=0&limit=1000`, 3600000)); } catch { return null; }
}
return raw.players.get(season).get(window.Engine.norm(name)) || null;
}

/** Season team stats (pace, ratings, shot zones, rebounding), refreshed every few hours. */
async function teamStats(season) {
const key = `teams:${PVER}b:${season}`;
const cached = store.get(key);
if (cached && cached.at > Date.now() - 3 * 3600000 && raw.teams.has(season)) return cached.data;
try {
const j = await getJSON(`/v1/nba/teams/stats?year=${season}`, 3 * 3600000);
const blks = [j && j.team, j, j && j.opponent].filter((b) => b && Array.isArray(b.team_data));
const blk = blks.find((b) => b.stat_type !== 'opponent') || blks[0];
const opp = j && j.opponent && Array.isArray(j.opponent.team_data) && j.opponent !== blk ? j.opponent : null;
const rowsOf = (b) => Object.fromEntries(b.team_data.map((r) => [r.TeamAbbreviation, r]));
if (blk) raw.teams.set(season, { rows: rowsOf(blk), league: blk.league_avg || null, oppRows: opp ? rowsOf(opp) : null, oppLeague: opp ? opp.league_avg || null : null });
const data = window.Engine.slimTeams(j);
store.set(key, { at: Date.now(), data });
return data;
} catch { return (cached && cached.data) || { teams: {}, league: null }; }
}
const teamAll = (season, abbr) => { const t = raw.teams.get(season); return t ? { row: t.rows[abbr] || null, league: t.league, opp: (t.oppRows && t.oppRows[abbr]) || null, oppLeague: t.oppLeague } : null; };

/** Game lines for every game on a date (spread, total, moneyline from ~13 books). */
async function gameLines(date) {
try { return (await getJSON(`/v1/nba/odds?date=${date}`, 60000)).data || []; }
catch { return []; }
}

/**
* The pregame consensus for one game. Once a game tips, keep using the last pregame read saved on
* this phone (live lines move with the score and would double-count it).
*/
function linesFor(game, phase, rows) {
const key = `glines:${game.id}`;
if (phase === 'pre') {
const c = window.Engine.gameLineConsensus(rows, game.id);
if (c) store.set(key, { at: Date.now(), c });
return c || ((store.get(key) || {}).c) || null;
}
const saved = store.get(key);
if (saved && saved.c) return saved.c;
const tip = game.datetime ? new Date(game.datetime).toISOString() : null;
return tip ? window.Engine.gameLineConsensus(rows, game.id, tip) : null;
}

/** DataBallr game logs for one player this season (tracking stats), cached for the day. */
async function playerLogs(nbaId, season) {
const key = `glog:${PVER}:${etDate(0)}:${season}:${nbaId}`;
const cached = store.get(key);
if (cached) return cached;
const j = await getJSON(`/v1/nba/players/game-logs?nba_id=${nbaId}&year=${season}&limit=20`, 3600000);
raw.logs.set(String(nbaId), (j && j.data) || []);
const slim = window.Engine.slimGameLogs((j && j.data) || []);
store.set(key, slim);
return slim;
}
const logAll = (nbaId) => raw.logs.get(String(nbaId)) || null;
/** Every game-log field for one player (network, kept in memory for an hour). */
async function playerLogsRaw(nbaId, season) {
if (raw.logs.has(String(nbaId))) return raw.logs.get(String(nbaId));
try { const j = await getJSON(`/v1/nba/players/game-logs?nba_id=${nbaId}&year=${season}&limit=20`, 3600000); raw.logs.set(String(nbaId), (j && j.data) || []); return raw.logs.get(String(nbaId)); }
catch { return []; }
}

/** Game logs for many players, a few at a time. Returns { normName: slimLogs }. */
async function playersLogs(list, season, { onProgress } = {}) {
const out = {};
const queue = list.filter((x) => x && x.nba_id).slice();
const total = queue.length;
let done = 0;
async function w() {
while (queue.length) {
const x = queue.shift();
try { out[window.Engine.norm(x.name)] = await playerLogs(x.nba_id, season); } catch { /* skip this one */ }
done++;
if (onProgress) onProgress(done, total);
}
}
await Promise.all([w(), w(), w()]);
return out;
}

async function injuries(date) {
try { return (await getJSON(`/v1/nba/injuries?date=${date}`, 300000)).data || []; }
catch { return []; }
}

async function props(gameId) {
try { return (await getJSON(`/v1/nba/odds/games/${gameId}/props`, 45000)).data || []; }
catch { return []; }
}

/* ---------- ESPN: tonight's injury report and active lists (public, CORS open) ---------- */
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_ABBR = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BKN: 'BKN' };
const espnAbbr = (a) => ESPN_ABBR[a] || a;
const emem = new Map();
async function espnJSON(url, ttl) {
const hit = emem.get(url);
if (hit && Date.now() - hit.t < ttl) return hit.v;
const r = await fetch(url, { headers: { Accept: 'application/json' } });
if (!r.ok) throw new Error(`ESPN ${r.status}`);
const v = await r.json();
emem.set(url, { t: Date.now(), v });
// a game summary is about 430 KB: keep only the newest few in memory
while (emem.size > 12) emem.delete(emem.keys().next().value);
return v;
}
/** League injury report → { ABBR: [{ name, status, out, doubt, why, ret }] }. */
async function espnInjuries() {
const j = await espnJSON(`${ESPN}/injuries`, 300000);
const out = {};
for (const grp of (j && j.injuries) || []) {
for (const i of grp.injuries || []) {
const a = i.athlete || {};
const tm = espnAbbr((a.team && a.team.abbreviation) || '');
if (!tm || !a.displayName) continue;
const fs = ((i.details && i.details.fantasyStatus && i.details.fantasyStatus.abbreviation) || '').toUpperCase();
const st = String(i.status || '');
const isOut = /^out/i.test(st) || fs === 'OUT' || fs === 'OFS' || /suspend/i.test(st);
const part = (i.details && i.details.type) ? String(i.details.type) : '';
(out[tm] = out[tm] || []).push({ name: a.displayName, status: st, out: isOut, doubt: !isOut, why: (isOut ? 'out' : (fs === 'GTD' ? 'game-time call' : st.toLowerCase())) + (part ? ` (${part.toLowerCase()})` : ''), ret: (i.details && i.details.returnDate) || null });
}
}
return out;
}
/** ESPN event id + team ids for one game, matched by team abbreviations. */
async function espnEvent(game) {
const d = String(game.date || '').slice(0, 10).replace(/-/g, '');
const j = await espnJSON(`${ESPN}/scoreboard?dates=${d}`, 600000);
const v = game.visitor_team.abbreviation, h = game.home_team.abbreviation;
for (const e of (j && j.events) || []) {
const c = (e.competitions && e.competitions[0]) || {};
const teams = (c.competitors || []).map((x) => ({ abbr: espnAbbr(x.team && x.team.abbreviation), id: x.team && x.team.id }));
if (teams.some((t) => t.abbr === v) && teams.some((t) => t.abbr === h)) return { id: e.id, comp: c.id || e.id, teams };
}
return null;
}
/** Tonight's active lists from ESPN's game box (posted at tip-off): { ABBR: [{ name, starter, dnp }] }. */
// After a game ESPN adds the players who were ruled out (injury, rest, suspension, not with team) to the box, with the
// reason. They were never on the list while the game was on, so they are left off here too: the nightly learning then
// replays a finished game with the same list the live app had. Players who sat by coach's decision were dressed and stay.
const ruledOut = (x) => !!(x.dnp && x.reason && !/COACH/i.test(x.reason));
async function espnLists(ev, ttl) {
const j = await espnJSON(`${ESPN}/summary?event=${ev.id}`, ttl);
const out = {};
for (const t of (j && j.boxscore && j.boxscore.players) || []) {
const tm = espnAbbr(t.team && t.team.abbreviation);
const ath = (t.statistics && t.statistics[0] && t.statistics[0].athletes) || [];
if (tm && ath.length) out[tm] = ath.map((x) => ({ name: (x.athlete && x.athlete.displayName) || '', starter: !!x.starter, dnp: !!x.didNotPlay, reason: x.didNotPlay ? x.reason || '' : '' })).filter((x) => x.name && !ruledOut(x));
}
return out;
}
/**
 * Tonight's availability for the engine: confirmed lineups when ESPN has them,
 * otherwise the injury report (OUT removed, game-time calls flagged).
 */
async function availability(game) {
const v = game.visitor_team.abbreviation, h = game.home_team.abbreviation;
const res = { confirmed: false, complete: false, report: false, source: '', in: [], out: [], doubt: [], starters: {} };
try {
const inj = await espnInjuries();
res.report = true; res.source = 'injury report';
for (const tm of [v, h]) for (const r of inj[tm] || []) {
if (r.out) res.out.push({ name: r.name, why: r.why, team: tm });
else res.doubt.push({ name: r.name, why: r.why, team: tm });
}
} catch { /* no report this time */ }
try {
const ev = await espnEvent(game);
if (ev) {
const live = game.status_state !== 'scheduled';
const lists = await espnLists(ev, live ? 60000 : 300000);
const ok = [v, h].every((tm) => lists[tm] && lists[tm].filter((x) => x.starter).length >= 5);
if (ok) {
// the box lists tonight's active players; "did not play" there only means not in yet
res.confirmed = true; res.complete = true; res.source = 'confirmed lineups';
for (const tm of [v, h]) {
res.starters[tm] = lists[tm].filter((x) => x.starter).map((x) => x.name);
for (const x of lists[tm]) res.in.push({ name: x.name, starter: x.starter, team: tm });
}
const inNames = new Set(res.in.map((x) => window.Engine.norm(x.name)));
res.out = res.out.filter((x) => !inNames.has(window.Engine.norm(x.name)));
res.doubt = res.doubt.filter((x) => !inNames.has(window.Engine.norm(x.name)));
}
}
} catch { /* lineups not posted yet */ }
return res.report || res.confirmed ? res : null;
}

/**
 * The posted lineup of a game that has started or finished, from ESPN's game box: who was active and who started.
 * The nightly learning replays finished games with it, so it learns from the same lineup news the live app had.
 */
async function lineupFor(game) {
const v = game.visitor_team.abbreviation, h = game.home_team.abbreviation;
const ev = await espnEvent(game);
if (!ev) return null;
const lists = await espnLists(ev, 3600000);
if (![v, h].every((tm) => lists[tm] && lists[tm].filter((x) => x.starter).length >= 5)) return null;
const res = { confirmed: true, complete: true, report: true, source: 'confirmed lineups', in: [], out: [], doubt: [], starters: {} };
for (const tm of [v, h]) {
res.starters[tm] = lists[tm].filter((x) => x.starter).map((x) => x.name);
for (const x of lists[tm]) res.in.push({ name: x.name, starter: x.starter, team: tm });
}
return res;
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
mem.clear(); emem.clear();
raw.players.clear(); raw.teams.clear(); raw.logs.clear();
try { Object.keys(localStorage).filter((k) => /^(log|slate|priors|teams|glog|glines):/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
}

/** DataBallr labels seasons by end year: Oct 2026 → current 2027, last 2026. */
function seasons(date) {
const [y, m] = date.split('-').map(Number);
const cur = m >= 8 ? y + 1 : y;
return { cur, last: cur - 1 };
}

/**
* The time by the server's clock: the Date header of a small file from the app's own address (never from the phone's cache), or
* null when it cannot be read. A phone's own clock can be set wrong; what must not happen is a copy of the season tables being
* stamped earlier than it really was taken.
*/
async function serverNow() {
try {
const t0 = Date.now();
const r = await fetch(`manifest.webmanifest?t=${t0}`, { method: 'HEAD', cache: 'no-store' });
const t = Date.parse((r && r.headers && r.headers.get('date')) || '');
return Number.isFinite(t) ? t + Math.round((Date.now() - t0) / 2) : null;
} catch { return null; }
}

window.DB = { PRIORS_MS, serverNow, livePlays, espnScores, feed, slateSource: () => slateSource, etDate, addDays, seasons, slate, plays, lastSeasonPriors, currentSeasonPriors, injuries, props, teamLogs, clearCache, store,
teamStats, teamAll, gameLines, linesFor, playerLogs, playersLogs, logAll, playerLogsRaw, playerAll, availability, espnInjuries, lineupFor };
})();
