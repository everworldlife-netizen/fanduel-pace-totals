/* Courtside Arcade — UI */
(function () {
'use strict';
const E = window.Engine, DB = window.DB;
const view = document.getElementById('view');
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const half = (x) => (Math.round(x * 2) / 2).toString();
const pct = (p) => `${Math.round(p * 100)}%`;
const APP_VERSION = '16 (Nov 11, 2026)'; // shown in Settings so an update can be confirmed on the phone; keep in step with ca-shell-vNN in sw.js

// Backtest of this engine on 25 finished games (2026-10-28 → 10-30), players with 10+ minutes.
const ACCURACY = /*ACCURACY*/{"games":121,"trainGames":3586,"note":"Tested on this season's 121 complete games (Oct 21 to Nov 9) with lessons learned only from the 3,586 games of the three seasons before, so the app had never seen these games. Each game was replayed with what the live app knows at that moment: season stats to date, team ratings, the closing line and the lineup list as it stands at tip-off. Average miss counts everyone who really played 10+ minutes, and a player the app had no number for counts as a full miss. \"Before\" is the app as it was on Nov 10, taught on the same games. After this test the app went on to learn from these games as well, as it does from every finished game.","before":{"pre":{"pts":4.84,"reb":1.98,"ast":1.43,"fg3m":0.89,"min":5.11,"top3":0.769,"total":14.58,"players":2253},"q1":{"pts":4.13,"reb":1.7,"ast":1.21,"fg3m":0.75,"min":4.43,"top3":0.851,"total":13.82,"players":2253},"half":{"pts":3.24,"reb":1.35,"ast":0.94,"fg3m":0.55,"min":3.44,"top3":0.884,"total":10.93,"players":2253},"q3":{"pts":2.2,"reb":0.95,"ast":0.56,"fg3m":0.3,"min":2.82,"top3":0.95,"total":7.9,"players":2253},"late":{"pts":1.24,"reb":0.5,"ast":0.28,"fg3m":0.14,"min":1.61,"top3":0.975,"total":6.88,"players":2253}},"after":{"pre":{"pts":4.67,"reb":1.9,"ast":1.4,"fg3m":0.88,"min":4.03,"top3":0.785,"total":14.22,"players":2253},"q1":{"pts":4.06,"reb":1.66,"ast":1.2,"fg3m":0.74,"min":3.86,"top3":0.826,"total":12.67,"players":2253},"half":{"pts":3.21,"reb":1.34,"ast":0.93,"fg3m":0.55,"min":3.23,"top3":0.909,"total":10.92,"players":2253},"q3":{"pts":2.16,"reb":0.93,"ast":0.55,"fg3m":0.3,"min":2.64,"top3":0.95,"total":7.78,"players":2253},"late":{"pts":1.23,"reb":0.5,"ast":0.29,"fg3m":0.15,"min":1.5,"top3":0.975,"total":6.92,"players":2253}},"calib":[{"said":"85% at tip-off","before":"85%","now":"84%"},{"said":"65% at tip-off","before":"64%","now":"63%"},{"said":"85% at halftime","before":"83%","now":"82%"},{"said":"65% at halftime","before":"65%","now":"65%"},{"said":"65% after Q3","before":"62%","now":"65%"}],"findings":["New in version 16: role anchors. The app's minutes used to be too spread out: a high number finished lower and a low number finished higher, at every stage of a game. Each number is now pulled toward what a player in that role normally plays: tonight's starters, the bench, who is on the floor right now, and his own pace tonight. On this season's 121 games minutes land 21% closer at tip-off and 13 to 20% closer in the first quarter than the app as it was; points 3.5% closer at tip-off.","During a game a player still waiting to check in keeps the same kind of number as before tip-off: what he does if he gets in. Six minutes into a game used to be the app's weakest moment. It is now closer than tip-off, as it should be: minutes 20% closer, points 3.6% closer (121 games).","Late in a decided game the app reads who is actually on the floor. When the reserves are finishing the game, the regulars on the bench are done for the night and the reserves play it out. With three minutes left, minutes land 16% closer.","A lopsided score now costs a player more the more he usually plays, smoothly, instead of one rule for starters and one for everybody else. At halftime his first-half minutes count for more than before.","Before lineups post, deep-bench players get a number too (two of every three players who had no number and then played 10+ minutes were deep bench), and minutes nobody was going to play are no longer handed to teammates. Minutes land 15% closer before lineups, points 2.3% closer.","Tonight's starting five is inside every number from the moment lineups post. A reserve who starts gets his extra minutes, and a usual starter left out of the five is cut and flagged.","How crowded tonight's rotation is counts too: when several players are out, or everyone is back, minutes are not shared out evenly.","Points, rebounds and assists follow the minutes. Through the third quarter points land 1 to 3.6% closer and rebounds 0.6 to 4% closer on these 121 games; in the last six minutes the gain is small (about half a percent on points). A second, larger test on 592 of last season's games that the lessons never saw agrees at every stage (version 16 against version 15: minutes 3 to 13% closer, points up to 1.9%, rebounds up to 2.2%, assists up to 1.4%).","The projected final score ran 2 to 5 points low during games. A check learned from complete games now corrects half of that through the third quarter. Tested on 585 of last season's games that played no part in setting it up, the final score landed 0.6 to 3.5% closer at every moment from six minutes in to the end of the third quarter, and never further off. Player numbers are not touched by it.","What is left is mostly the bounce of the game. With the real minutes known in advance, points would still miss by about 4 at tip-off, and a second learning stage (boosted trees with the whole game state) could not get points, rebounds or assists closer than these numbers on unseen games. The app's numbers close in on the final line as the game goes: about 3.2 points at halftime, 2.2 after three quarters, 1.2 with six minutes left.","The lessons built into the app come from 3,709 games across four seasons: every final through Nov 9. Every plus edge shown is saved and graded on this phone: see EDGE RECORD above."]}/*END*/;

const TEAM = {
ATL: ['#E03A3E', '#C1D32F'], BOS: ['#007A33', '#BA9653'], BKN: ['#2a2a2a', '#FFFFFF'], CHA: ['#1D1160', '#00788C'],
CHI: ['#CE1141', '#111111'], CLE: ['#860038', '#FDBB30'], DAL: ['#00538C', '#B8C4CA'], DEN: ['#0E2240', '#FEC524'],
DET: ['#C8102E', '#1D42BA'], GSW: ['#1D428A', '#FFC72C'], HOU: ['#CE1141', '#C4CED4'], IND: ['#002D62', '#FDBB30'],
LAC: ['#C8102E', '#1D428A'], LAL: ['#552583', '#FDB927'], MEM: ['#5D76A9', '#12173F'], MIA: ['#98002E', '#F9A01B'],
MIL: ['#00471B', '#EEE1C6'], MIN: ['#0C2340', '#78BE20'], NOP: ['#0C2340', '#C8102E'], NYK: ['#006BB6', '#F58426'],
OKC: ['#007AC1', '#EF3B24'], ORL: ['#0077C0', '#C4CED4'], PHI: ['#006BB6', '#ED174C'], PHX: ['#1D1160', '#E56020'],
POR: ['#E03A3E', '#111111'], SAC: ['#5A2D81', '#63727A'], SAS: ['#8a96a0', '#111111'], TOR: ['#CE1141', '#111111'],
UTA: ['#002B5C', '#F9A01B'], WAS: ['#002B5C', '#E31837'],
};
const badge = (abbr, cls = '') => {
const [c1, c2] = TEAM[abbr] || ['#555', '#999'];
return `<span class="badge ${cls}" style="--c1:${c1};--c2:${c2}" aria-hidden="true">${esc(abbr)}</span>`;
};

const MASCOT = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="52" r="42" fill="#ff7a1a" stroke="#0c0720" stroke-width="6"/>
<path d="M10 52h80M50 10v84M22 22c14 14 14 46 0 60M78 22c-14 14-14 46 0 60" fill="none" stroke="#0c0720" stroke-width="4" stroke-linecap="round" opacity=".55"/>
<ellipse cx="37" cy="46" rx="9" ry="11" fill="#fff" stroke="#0c0720" stroke-width="4"/><ellipse cx="63" cy="46" rx="9" ry="11" fill="#fff" stroke="#0c0720" stroke-width="4"/>
<circle cx="39" cy="48" r="4.5" fill="#0c0720"/><circle cx="65" cy="48" r="4.5" fill="#0c0720"/><circle cx="40.5" cy="46" r="1.6" fill="#fff"/><circle cx="66.5" cy="46" r="1.6" fill="#fff"/>
<path d="M38 64q12 11 24 0" fill="#fff" stroke="#0c0720" stroke-width="4" stroke-linejoin="round"/>
<path d="M14 30q36-22 72 0" fill="none" stroke="#2de2e6" stroke-width="7" stroke-linecap="round"/></svg>`;

const ICON = {
games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M6 5.5c3 3 3 10 0 13M18 5.5c-3 3-3 10 0 13"/></svg>',
scorers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8"/></svg>',
picks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
combos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/></svg>',
settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/></svg>',
back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>',
install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg>',
};

// ------------------------------------------------------------------ settings + state
const DEFAULTS = { refresh: 20, skipBlowouts: true, sims: 2000, payout: 3, minP: 0.6 };
const settings = Object.assign({}, DEFAULTS, DB.store.get('settings') || {});
const saveSettings = () => DB.store.set('settings', settings);

const X_ACCOUNTS = ['RotoWireNBA', 'UnderdogNBA', 'ShamsCharania', 'TheSteinLine', 'ChrisBHaynes', 'mcten', 'JakeLFischer', 'anthonyVslater',
'ClutchPoints', 'InStreetClothes', 'BaruthaAlex', 'FantasyProsNBA', 'FantasyLabsNBA', 'SICscore', 'Stokastic'];
function xSearchUrl(g) {
const names = [g.visitor_team.name, g.home_team.name, g.visitor_team.city, g.home_team.city];
const q = `(${X_ACCOUNTS.map((a) => 'from:' + a).join(' OR ')}) (${[...new Set(names)].join(' OR ')}) since:${DB.addDays(state.date, -1)}`;
return 'https://x.com/search?q=' + encodeURIComponent(q) + '&f=live';
}
const ovKey = () => `overrides:${state.date}`;
const getOverrides = () => DB.store.get(ovKey()) || { in: [], out: [] };
function setOverride(pid, status) {
const o = getOverrides();
o.in = o.in.filter((x) => x !== pid); o.out = o.out.filter((x) => x !== pid);
if (status === 'in') o.in.push(pid);
if (status === 'out') o.out.push(pid);
DB.store.set(ovKey(), o);
}

const state = {
dayOffset: 0, date: DB.etDate(0), slate: [], priors: null, injuries: [], avail: {},
logs: new Map(), logTeams: new Set(), proj: new Map(), busy: false, progress: null, gradeTries: new Map(), booted: false, bootFail: false,
team: {}, pickFilter: 'all', sheetPid: null, sheetGame: null, installEvt: null, lastErr: null, lastUpdate: 0,
teamsDb: null, oddsRows: [], glogs: {}, glogTried: new Set(), openDetails: new Set(), sheetAll: null,
moves: new Map(), sig: new Map(), lastFull: 0, lastGame: new Map(),
};

// ------------------------------------------------------------------ worker
const worker = new Worker('worker.js');
let jobId = 0;
const pending = new Map();
worker.onmessage = (e) => {
const job = pending.get(e.data.id);
if (!job) return;
pending.delete(e.data.id);
e.data.ok ? job.res(e.data) : job.rej(new Error(e.data.error));
};
// If the worker ever crashes or a job never comes back, fail that job instead of freezing live updates.
worker.onerror = (e) => { for (const [id, job] of pending) { pending.delete(id); job.rej(new Error('projection worker: ' + (e && e.message))); } };
const runProjection = (payload) => new Promise((res, rej) => {
const id = ++jobId;
const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('projection timed out')); } }, 45000);
pending.set(id, { res: (x) => { clearTimeout(t); res(x); }, rej: (x) => { clearTimeout(t); rej(x); } });
worker.postMessage({ id, payload });
});

// ------------------------------------------------------------------ data flow
const st = (g) => E.gameState(g);
async function loadSlate() {
state.slate = await DB.slate(state.date);
state.lastUpdate = Date.now();
}
async function ensurePriors() {
if (state.priors) return;
const s = DB.seasons(state.date);
setProgress('Loading player profiles…', 0, 1);
const [last, cur] = await Promise.all([DB.lastSeasonPriors(s.last), DB.currentSeasonPriors(s.cur, DB.etDate(0))]);
state.priors = { last, cur };
snapSave();
}
async function ensureLogs(teams) {
const need = teams.filter((t) => !state.logTeams.has(t));
if (!need.length) return;
const logs = await DB.teamLogs(need, state.date, { onProgress: (d, n) => setProgress('Scouting recent games…', d, n) });
for (const l of logs) state.logs.set(l.id, l);
need.forEach((t) => state.logTeams.add(t));
}
async function ensureTeams() {
if (state.teamsDb && state.teamsDb.at > Date.now() - 3 * 3600000) return;
const s = DB.seasons(state.date);
const data = await DB.teamStats(s.cur);
state.teamsDb = { ...data, at: Date.now() };
snapSave();
}
/** DataBallr game logs (tracking stats) for every rotation player in these games, then re-project. */
async function ensureGameLogs(games) {
const season = DB.seasons(state.date).cur;
const want = [], touched = new Set();
for (const g of games) {
const pr = state.proj.get(g.id);
if (!pr) continue;
for (const p of pr.proj.players) {
if (!p.db || !p.db.nba_id || p.proj.min < 8) continue;
const k = E.norm(p.name);
if (state.glogs[k] || state.glogTried.has(k)) continue;
state.glogTried.add(k);
want.push({ nba_id: p.db.nba_id, name: p.name });
touched.add(g.id);
}
}
if (!want.length) return;
const got = await DB.playersLogs(want, season, { onProgress: (d, n) => setProgress('Reading DataBallr game logs…', d, n) });
Object.assign(state.glogs, got);
setProgress(null);
for (const g of games) {
if (!touched.has(g.id) || st(g).phase === 'final') continue;
try { await projectGame(g); } catch (e) { console.warn('project', g.id, e); }
render(true);
}
}
async function projectGame(g) {
const s = st(g);
const logs = [...state.logs.values()].filter((l) => [l.v, l.h].some((t) => t === s.v || t === s.h));
const nameToPid = {};
for (const l of logs) for (const [pid, r] of Object.entries(l.rows)) nameToPid[E.norm(r.name)] = +pid;
let plays = s.phase === 'pre' ? [] : await DB.livePlays(g, { final: s.phase === 'final', nameToPid, scoreNow: s.phase === 'live' ? s.vs + s.hs : null });
// a finished game: the box must add up to the final score before anything is graded from it (the last live read can be a
// play or two short). If it does not, read the plays again, fresh.
let box = null;
if (s.phase === 'final') {
box = finalBox(g, plays);
if (!box) { try { const p2 = await DB.livePlays(g, { final: true, nameToPid, fresh: true }); const b2 = finalBox(g, p2); if (b2 || (p2 && p2.length > plays.length)) { plays = p2; box = b2; } } catch { /* keep the first read */ } }
if (!box) state.gradeTries.set(g.id, (state.gradeTries.get(g.id) || 0) + 1);
}
const before = state.proj.get(g.id);
const props = s.phase === 'final' ? [] : await DB.props(g.id);
let avail = null;
if (s.phase !== 'final') {
try { avail = await DB.availability(g); } catch { avail = null; }
if (avail) state.avail[g.id] = avail; else avail = state.avail[g.id] || null;
}
const market = DB.linesFor(g, s.phase, state.oddsRows);
const gameLogs = {};
for (const [k, x] of Object.entries(state.glogs)) if (x && x.games && x.games[0] && (x.games[0].team === s.v || x.games[0].team === s.h)) gameLogs[k] = x;
// live means live: a new projection for every new play (or new lineup, line or status news), and none when nothing has happened
const playKey = s.phase === 'live' ? [plays.length, s.period, s.clock, s.vs, s.hs, JSON.stringify(getOverrides()), Object.keys(gameLogs).length, avail ? `${avail.in.length}/${avail.out.length}/${avail.confirmed}` : '', props.length, market ? market.total : '', settings.sims, settings.minP].join(':') : null;
if (playKey && before && before.playKey === playKey && Date.now() - before.at < 90000) return before;
const res = await runProjection({ game: g, plays, logs, priors: state.priors, injuries: state.injuries, nsims: settings.sims, props, seed: g.id, minP: settings.minP, overrides: getOverrides(),
market, teams: state.teamsDb, gameLogs, avail, patterns: patternsNow() });
if (s.phase === 'live' && before && before.proj) noteMoves(g, before.proj, res.proj);
state.proj.set(g.id, { ...res, at: Date.now(), playKey, feed: DB.feed[g.id] || 'databallr' });
rememberTip(g, s, res.proj);
try {
if (s.phase === 'final') { if (box) ledgerGrade(g.id, box.rows); }
else {
// the same edges the Edges screen shows: no shaky status, no skipped blowouts
const ov = getOverrides();
const shaky = new Set(res.proj.players.filter((p) => p.doubt && !/not on injury report/.test(p.doubt) && !ov.in.includes(p.pid)).map((p) => p.pid));
const proof = new Set(res.proj.players.filter((p) => p.blowProof).map((p) => p.pid));
const blowSkip = settings.skipBlowouts && E.isBlowout(s);
ledgerNote(g, s, res.picks, (k) => shaky.has(k.pid) || (blowSkip && !proof.has(k.pid)));
}
} catch (e) { console.warn('ledger', e); }
return res;
}
// What just changed: when a live projection moves, remember by how much and the one-line reason, so the card can flash it.
const MOVE_MS = 14000;
function noteMoves(g, A, B) {
const old = new Map(A.players.map((p) => [p.pid, p]));
const mg0 = A.state.vs - A.state.hs, mg1 = B.state.vs - B.state.hs;
for (const p of B.players) {
const q = old.get(p.pid);
if (!q) continue;
const d = p.proj.pts - q.proj.pts;
if (Math.abs(d) < 0.5) continue;
let why = '';
if (p.now.pts > q.now.pts) why = `scored ${p.now.pts - q.now.pts}, now has ${p.now.pts}`;
else if (p.now.pf > q.now.pf) why = `foul number ${p.now.pf}`;
else if (p.on !== q.on) why = p.on ? 'back on the floor' : 'checked out';
else if (p.fade && !q.fade) why = 'fade warning: hot start expected to cool';
else if (Math.abs(mg1) >= 15 && Math.abs(mg1) > Math.abs(mg0)) why = `score getting lopsided (${Math.abs(mg1)} apart)`;
else if (Math.abs(p.proj.min - q.proj.min) >= 0.7) why = `${p.proj.min > q.proj.min ? 'more' : 'fewer'} minutes expected from here`;
else if (p.now.fga > q.now.fga) why = 'missed shot, usage updated';
else why = d > 0 ? 'teammates\' shots moving to him' : 'shots moving to teammates';
state.moves.set(`${g.id}:${p.pid}`, { d, at: Date.now(), why });
}
}
function moveOf(gid, pid) { const m = state.moves.get(`${gid}:${pid}`); return m && Date.now() - m.at < MOVE_MS ? m : null; }
function moveHTML(m) { return m ? `<span class="mvflash ${m.d > 0 ? 'up' : 'down'}" style="--age:${((Date.now() - m.at) / 1000).toFixed(1)}s">${m.d > 0 ? '▲' : '▼'} ${m.d > 0 ? '+' : '−'}${Math.abs(m.d).toFixed(1)} <i>${esc(m.why)}</i></span>` : ''; }
// Each player's points projection at tip-off, kept for the day so live views can show how it has moved.
const tipKey = () => `tip:${state.date}`;
let tipCache = null;
function tipMap() { if (!tipCache) { try { tipCache = DB.store.get(tipKey()) || {}; } catch { tipCache = {}; } } return tipCache; }
function rememberTip(g, s, P) {
if (!P || s.phase !== 'pre') return;
const m = tipMap(); let changed = false;
for (const p of P.players) { const v = Math.round(p.proj.pts * 10) / 10; if (m[p.pid] !== v) { m[p.pid] = v; changed = true; } }
if (changed) { try { DB.store.set(tipKey(), m); } catch { /* storage full or blocked */ } }
}
// ------------------------------------------------------------------ edge record (pick ledger)
// Every plus edge the app shows against a book line is written down once before the game and once during it:
// the line, the chance we gave it and the book's own chance. When the game ends it is graded from the final box.
// Kept on this phone only. Row: [id, date, name, team, stat, line, our chance, book's chance, 0 pregame / 1 live, saved at, result (1 came in, 0 missed, -1 no action), final number].
const LEDGER_KEY = 'ledger:v1', LEDGER_MAX = 900;
let ledgerCache = null;
const ledgerRowOk = (r) => Array.isArray(r) && r.length >= 12 && typeof r[0] === 'string';
function ledger() { if (!ledgerCache) { try { ledgerCache = DB.store.get(LEDGER_KEY) || []; } catch { ledgerCache = []; } if (!Array.isArray(ledgerCache)) ledgerCache = []; ledgerCache = ledgerCache.filter(ledgerRowOk); } return ledgerCache; }
function ledgerSave() {
const L = ledger();
// another open copy of the app may have saved rows or grades since this one loaded: fold them in instead of wiping them
try { const disk = DB.store.get(LEDGER_KEY); if (Array.isArray(disk)) { const mine = new Map(L.map((r) => [r[0], r])); let added = false; for (const r of disk) { if (!ledgerRowOk(r)) continue; const m = mine.get(r[0]); if (!m) { L.push(r); mine.set(r[0], r); added = true; } else if (m[10] == null && r[10] != null) { m[10] = r[10]; m[11] = r[11]; } } if (added) L.sort((a, b) => a[9] - b[9]); } } catch { /* nothing saved yet */ }
// a row still waiting after 6 days can no longer be graded (its game has left the window the app looks back on): no action
const tooOld = Date.now() - 6 * 86400000;
for (const r of L) if (r[10] == null && r[9] < tooOld) { r[10] = -1; r[11] = null; }
if (L.length > LEDGER_MAX) L.splice(0, L.length - LEDGER_MAX);
try { DB.store.set(LEDGER_KEY, L); } catch { /* storage full or blocked */ }
}
/** Does this game still have saved edges waiting for a grade? */
const ledgerOpen = (gameId) => ledger().some((r) => r[10] == null && +String(r[0]).split(':')[0] === +gameId);
/** The final box of a finished game from its plays, or null while the plays do not add up to the final score (a stale or partial read). */
function finalBox(g, plays) {
if (!plays || !plays.length) return null;
let act;
try { act = E.logEntry(g, plays); } catch { return null; }
const s = st(g), sum = { [s.v]: 0, [s.h]: 0 };
for (const r of Object.values(act.rows)) if (r.team in sum) sum[r.team] += r.pts || 0;
return sum[s.v] === s.vs && sum[s.h] === s.hs ? act : null;
}
/** Grade whatever is still waiting from the last few nights (needs no player profiles, so it also runs on a day with no games). */
let sweeping = false, lastSweep = 0;
async function ledgerSweep() {
if (sweeping || Date.now() - lastSweep < 30 * 60000) return;
lastSweep = Date.now();
const open = ledger().filter((r) => r[10] == null);
if (!open.length) return;
sweeping = true;
try {
const today = DB.etDate(0);
const days = [...new Set(open.map((r) => r[1]))].filter((d) => d < today && d >= DB.addDays(today, -6));
for (const d of days) {
let rows = [];
try { rows = await DB.slate(d, 3600000); } catch { continue; }
for (const g of rows) {
if (g.status_state !== 'final' || !ledgerOpen(g.id)) continue;
try { let b = finalBox(g, await DB.plays(g.id, true)); if (!b) b = finalBox(g, await DB.plays(g.id, true, true)); if (b) ledgerGrade(g.id, b.rows); } catch (e) { console.warn('ledger sweep', g.id, e); }
}
}
ledgerSave();
} finally { sweeping = false; }
}
function ledgerNote(g, s, picks, skip) {
if (!picks || !picks.length || (s.phase !== 'pre' && s.phase !== 'live')) return;
const L = ledger(), have = new Set(L.map((r) => r[0]));
let added = false;
for (const k of picks) {
if (k.kind !== 'line' || k.market == null || k.tier === 'unsure' || (skip && skip(k))) continue;
const id = `${g.id}:${k.pid}:${k.stat}:${s.phase === 'pre' ? 0 : 1}`;
if (have.has(id)) continue;
L.push([id, String(g.date || state.date).slice(0, 10), k.name, k.team, k.stat, k.line, +k.prob.toFixed(3), +k.market.toFixed(3), s.phase === 'pre' ? 0 : 1, Date.now(), null, null]);
have.add(id); added = true;
}
if (added) ledgerSave();
}
/** Grade this game's saved edges from its final box: rows = { pid: { pts, reb, ast, fg3m, min } }. */
function ledgerGrade(gameId, rows) {
const L = ledger();
let changed = false;
for (const r of L) {
if (r[10] != null) continue;
const [gid, pid] = String(r[0]).split(':');
if (+gid !== +gameId) continue;
const a = rows[pid];
if (!a || !(a.min > 0)) { r[10] = -1; r[11] = null; changed = true; continue; } // did not play: no action
const v = r[4] === 'pra' ? (a.pts || 0) + (a.reb || 0) + (a.ast || 0) : a[r[4]] || 0;
r[10] = v > r[5] ? 1 : v < r[5] ? 0 : -1; r[11] = v; changed = true;
}
if (changed) ledgerSave();
}
/** The record so far, in bands of the chance we gave. */
function ledgerStats() {
const done = ledger().filter((r) => r[10] === 1 || r[10] === 0);
const bands = [[0, 0.6, '55 to 59%'], [0.6, 0.7, '60 to 69%'], [0.7, 0.8, '70 to 79%'], [0.8, 1.01, '80% and up']].map(([lo, hi, label]) => {
const xs = done.filter((r) => r[6] >= lo && r[6] < hi);
return { label, n: xs.length, hit: xs.filter((r) => r[10] === 1).length, said: xs.length ? xs.reduce((a, r) => a + r[6], 0) / xs.length : 0 };
});
const n = done.length, hit = done.filter((r) => r[10] === 1).length;
const said = n ? done.reduce((a, r) => a + r[6], 0) / n : 0, book = n ? done.reduce((a, r) => a + r[7], 0) / n : 0;
// whose chance was closer: results placed between the book's chance (0) and ours (1), by least squared error
let trust = null;
if (n >= 60) { let num = 0, den = 0; for (const r of done) { const d = r[6] - r[7]; num += d * (r[10] - r[7]); den += d * d; } trust = den > 0 ? Math.max(0, Math.min(1.5, num / den)) : null; }
return { n, hit, said, book, bands, trust, waiting: ledger().filter((r) => r[10] == null).length, noAction: ledger().filter((r) => r[10] === -1).length };
}
function ledgerHTML() {
const S = ledgerStats();
if (!S.n && !S.waiting && !S.noAction) return `<div class="section-title">📒 EDGE RECORD</div><div class="card"><p class="small" style="font-weight:700;margin:0">Every plus edge shown against a book line is saved here with the line, our chance and the book's chance, then graded when the game ends. Your record starts with tonight's edges.</p></div>`;
const row = (b) => `<tr><td>${b.label}</td><td>${b.n}</td><td><b>${b.n ? Math.round((100 * b.hit) / b.n) + '%' : '–'}</b></td></tr>`;
return `<div class="section-title">📒 EDGE RECORD</div>
<div class="card">
<div class="grid3">
<div class="kv"><small>Edges graded</small><b>${S.n}</b></div>
<div class="kv"><small>Came in</small><b>${S.n ? Math.round((100 * S.hit) / S.n) + '%' : '–'}</b></div>
<div class="kv"><small>We said</small><b>${S.n ? Math.round(100 * S.said) + '%' : '–'}</b></div>
</div>
${S.n ? `<table class="mtable acc2" style="margin-top:10px"><tr><th>Chance we gave</th><th>Edges</th><th>Came in</th></tr>${S.bands.map(row).join('')}</table>
<p class="small" style="font-weight:700;margin:10px 0 0">The books gave these same edges ${Math.round(100 * S.book)}% on average.${S.trust != null ? ` So far the results sit <b>${Math.round(100 * Math.min(S.trust, 1))}%</b> of the way from the book's chance to ours (100% means our chance was the right one).` : ' After 60 graded edges this card also shows whose chance has been closer, ours or the book\'s.'}</p>` : ''}
<p class="small muted" style="font-weight:700;margin:8px 0 0">${S.waiting} waiting for a final score${S.noAction ? ` · ${S.noAction} no action (player sat, or landed exactly on the line)` : ''}. One row before the game and one during it for each player and stat. Kept on this phone.</p>
</div>`;
}
// ------------------------------------------------------------------ learning from finished games
// Each day the app grades the last few nights: it re-projects every finished game from tip-off and every 6 game
// minutes after, with the lineup that was posted that night, compares with the final box score, and adds the
// misses to what it has learned.
const PAT_KEY = 'pat:v5:sum', PAT_DATES = 'pat:v5:dates', PAT_FROM = window.__PAT_FROM || '2026-11-10'; // v16: 13 more learned inputs (role anchors, late-game floor picture) and live numbers mean "if he plays", so the phone's own lessons start a fresh tally (the built-in ones cover every game through Nov 9)
try { ['pat:v1:sum', 'pat:v1:dates', 'pat:v3:sum', 'pat:v3:dates', 'pat:v4:sum', 'pat:v4:dates'].forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
function patSum() { let pk = null; try { pk = DB.store.get(PAT_KEY); } catch { pk = null; } try { return pk && pk.v === 2 ? E.patUnpack(pk) : null; } catch { return null; } }
let patCache = null;
function patternsNow() {
if (patCache) return patCache;
patCache = E.patBeta(patSum());
return patCache;
}
function learnedGames() { try { return (DB.store.get(PAT_DATES) || { games: 0 }).games || 0; } catch { return 0; } }
// the moments each finished game is replayed at, in game minutes (0 = tip-off): every stage the lessons are kept for
const CPS = [0, 6, 12, 18, 24, 30, 36, 42];
function gameAt(g, plays, el) {
if (!el) return { game: { ...g, status_state: 'scheduled', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 }, plays: [] };
const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
let per, clock, time, ps;
if (el % 12 === 0) {
per = el / 12; clock = '0:00';
time = per === 2 ? 'Half' : `End of ${per === 1 ? '1st' : '3rd'}`;
ps = plays.filter((p) => p.period <= per);
} else {
per = Math.floor(el / 12) + 1;
const left = (per * 12 - el) * 60;
clock = `${Math.floor(left / 60)}:${String(Math.round(left % 60)).padStart(2, '0')}`;
time = `Q${per} ${clock}`;
ps = plays.filter((p) => p.period < per || (p.period === per && E.clockSec(p.clock) >= left));
}
const bx = E.boxFromPlays(ps, per, clock);
return { game: { ...g, status_state: 'in', period: per, time, visitor_team_score: (bx.teams[v] || {}).pts || 0, home_team_score: (bx.teams[h] || {}).pts || 0 }, plays: ps };
}
let learning = false;
// ---- what the app knew before a game
// The season lines and the team table are refreshed every day, so by the morning after they already contain last night's
// games. A finished game replayed with them would be graded with part of its own result inside the inputs: the phone's
// accuracy table would look better than it is, and its lessons would learn from the answer. So a small dated copy of both
// tables is kept from the first load of each day, and a finished game is replayed with the newest copy that was saved before
// that day's first tip. A day with no such copy is not learned from at all.
const SNAP_F = ['gp', 'mpg', 'pts', 'reb', 'ast', 'fg3m', 'fg3a', 'p3', 'p2', 'ft', 'tsa100', 'tovpg', 'offPoss', 'r3', 'ftr'];
const SNAP_KEEP = 3, SNAP_BACK = 2; // copies kept (today and the two days before: phone storage is tight, see NOTES); how many days before a game its copy may come from
const snapKey = (d) => `psnap:${d}`;
let snapDay = ''; // the day whose copy is known to be complete (so a refresh does not read it back every time)
function snapSave() {
try {
const today = DB.etDate(0);
if (snapDay === today) return;
let sn = DB.store.get(snapKey(today));
const cur = state.priors && state.priors.cur;
if ((!sn || !sn.p) && cur && Object.keys(cur).length >= 20) {
const r3 = (x) => (x == null || !Number.isFinite(+x) ? null : +(+x).toPrecision(3));
const p = {};
for (const [k, c] of Object.entries(cur)) p[k] = SNAP_F.map((f) => r3(c[f]));
sn = { at: Date.now(), p, t: null, tAt: 0 };
for (const k of Object.keys(localStorage)) if (k.startsWith('psnap:') && k.slice(6) < DB.addDays(today, -(SNAP_KEEP - 1))) localStorage.removeItem(k);
DB.store.set(snapKey(today), sn);
}
if (sn && sn.p && !sn.t && state.teamsDb && state.teamsDb.teams && Object.keys(state.teamsDb.teams).length >= 20) {
sn.t = { teams: state.teamsDb.teams, league: state.teamsDb.league || null }; sn.tAt = Date.now();
DB.store.set(snapKey(today), sn);
}
if (sn && sn.p && sn.t) snapDay = today;
} catch (e) { /* storage blocked or full: that day is simply not learned from */ }
}
/** The newest dated copy saved before the first tip of day d (looking back up to three days), or null. */
function snapFor(d, firstTip) {
for (let k = 0; k <= SNAP_BACK; k++) {
let sn = null;
try { sn = DB.store.get(snapKey(DB.addDays(d, -k))); } catch { sn = null; }
if (!sn || !sn.p || !sn.t) continue;
if (Math.max(sn.at || 0, sn.tAt || 0) < firstTip) return sn;
}
return null;
}
/** The season lines as they stood in a dated copy (names, ids and positions come from today's table). */
function snapPriors(sn) {
const now = (state.priors && state.priors.cur) || {}, cur = {};
for (const [k, a] of Object.entries(sn.p)) {
if (!now[k]) continue;
const c = { ...now[k] };
SNAP_F.forEach((f, i) => { c[f] = a[i]; });
cur[k] = c;
}
return { last: state.priors.last, cur };
}

async function learnRecent() {
if (learning || !state.priors) return;
const today = DB.etDate(0);
let rec;
try { rec = DB.store.get(PAT_DATES) || { done: [], games: 0, checked: '' }; } catch { rec = { done: [], games: 0, checked: '' }; }
if (rec.checked === today) return;
learning = true;
try {
for (let i = 5; i >= 1; i--) {
const d = DB.addDays(today, -i);
if (d < PAT_FROM || rec.done.includes(d)) continue;
const rows = await DB.slate(d, 3600000);
const fin = rows.filter((g) => g.status_state === 'final');
if (!fin.length || fin.length < rows.length) continue;
let oddsD = [];
try { oddsD = await DB.gameLines(d); } catch { oddsD = []; }
// the tables as the app had them before this day's first tip (tip times come with the slate; without them, noon Eastern)
const tips = rows.map((g) => (g.datetime ? Date.parse(g.datetime) : NaN));
const firstTip = tips.every(Number.isFinite) ? Math.min(...tips) : Date.parse(`${d}T16:00:00Z`);
const sn = snapFor(d, firstTip);
const jobs = [];
let failed = 0;
for (const g of fin) {
try {
const plays = await DB.plays(g.id, true);
// only a box that adds up to the final score is graded and learned from
const act = finalBox(g, plays) || finalBox(g, await DB.plays(g.id, true, true));
if (!act) { failed++; continue; }
try { ledgerGrade(g.id, act.rows); } catch (e) { console.warn('ledger', e); }
if (!sn) continue; // no copy of the tables from before this game: the edge record is graded, the lessons sit this day out
const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
const logs = await DB.teamLogs([v, h], d);
if (logs.filter((l) => l.v === v || l.h === v).length < 2 || logs.filter((l) => l.v === h || l.h === h).length < 2) continue;
let mkt = null;
try { mkt = DB.linesFor(g, 'final', oddsD); } catch { mkt = null; }
// the lineup posted that night (active list, starters): the learning sees what the live app saw
let av = null;
try { av = await DB.lineupFor(g); } catch { av = null; }
// without the posted lineup the replay would be filed under the wrong stage: leave the game for another day
if (!av) { failed++; continue; }
jobs.push({ rows: act.rows, logs, market: mkt && mkt.total ? mkt : null, avail: av, cps: CPS.map((k) => gameAt(g, plays, k)) });
} catch (e) { failed++; console.warn('learn', g.id, e); }
}
// a game that could not be read (feed down, plays short of the final, no lineup) is tried again on the next two days;
// after that the night is closed with the games that could be read
if (failed && i <= 2) continue;
if (jobs.length) {
// one game per worker job, so live projections never wait long behind the learning
const dayAcc = E.patEmpty();
let n = 0, jobFail = 0;
for (const j of jobs) {
try { const res = await runProjection({ grade: [j], priors: snapPriors(sn), teams: sn.t, nsims: 300, patterns: patternsNow() }); E.patAdd(dayAcc, res.acc); n += res.games; } catch (e) { jobFail++; console.warn('learn job', e); }
}
if (jobFail && i <= 2) continue; // never save half a night while it can still be redone whole
const sum = E.patAdd(patSum() || E.patEmpty(), dayAcc);
DB.store.set(PAT_KEY, E.patPack(sum));
rec.games += n;
}
rec.done.push(d);
rec.done = rec.done.slice(-30);
DB.store.set(PAT_DATES, rec);
patCache = null;
}
rec.checked = today;
DB.store.set(PAT_DATES, rec);
} catch (e) { console.warn('learn', e); }
finally { learning = false; }
}
let refreshGen = 0;
async function refreshAll({ games = null, force = false } = {}) {
if (state.busy && !force) return;
const gen = ++refreshGen, day = state.date;
const stale = () => gen !== refreshGen || day !== state.date;
state.busy = true; setSpinning(true);
try {
const rows = await DB.slate(day, 2500);
state.booted = true; state.bootFail = false; // the first slate has answered: from here an empty board really means no games
setTimeout(() => { ledgerSweep().catch((e) => console.warn('ledger sweep', e)); }, 6000); // grade what is still waiting from earlier nights
if (stale()) return;
state.slate = rows; state.lastUpdate = Date.now();
render();
if (!state.slate.length) {
// no games on this date: nothing to project, but on an off day the app still saves its copy of the tables and learns from
// the last finished nights in the background
if (day === DB.etDate(0)) {
try { await ensurePriors(); await ensureTeams(); } catch (e) { console.warn('idle', e); }
setProgress(null);
if (stale()) return;
snapSave();
setTimeout(() => { learnRecent(); }, 4000);
}
return;
}
await ensurePriors();
state.injuries = await DB.injuries(state.date);
try { await ensureTeams(); } catch (e) { console.warn('teams', e); }
snapSave(); // (also here: an app left open past midnight still gets its copy for the new day, of the tables it is using)
state.oddsRows = await DB.gameLines(state.date);
const teams = [...new Set(state.slate.flatMap((g) => [g.visitor_team.abbreviation, g.home_team.abbreviation]))];
await ensureLogs(teams);
setProgress(null);
const list = games || state.slate;
for (const g of list) {
if (stale()) return;
const s = st(g);
const old = state.proj.get(g.id);
const regrade = s.phase === 'final' && ledgerOpen(g.id) && (state.gradeTries.get(g.id) || 0) < 6;
if (s.phase === 'final' && old && old.proj.state.phase === 'final' && !regrade) continue;
if (s.phase === 'pre' && old && Date.now() - old.at < 5 * 60000) continue;
try { await projectGame(g); } catch (e) { console.warn('project', g.id, e); }
render(true);
}
if (stale()) return;
try { await ensureGameLogs(list); } catch (e) { console.warn('game logs', e); }
// learn from the last few finished nights in the background (once a day), then use it on the next refresh
setTimeout(() => { learnRecent().then(() => { if (!patCache) state.proj.forEach((x) => { x.at = 0; }); }); }, 4000);
state.lastErr = null;
} catch (e) {
if (stale()) return;
console.error(e);
if (!state.booted) state.bootFail = true;
state.lastErr = e.message;
toast(navigator.onLine ? 'DataBallr is slow to answer — retrying soon' : 'You’re offline');
} finally {
if (gen === refreshGen) { state.busy = false; setSpinning(false); setProgress(null); render(true); }
}
}

// ------------------------------------------------------------------ helpers for UI
function setProgress(label, done, total) { state.progress = label ? { label, done, total } : null; const el = $('#progress'); if (el) el.outerHTML = progressHTML(); }
function progressHTML() {
const p = state.progress;
if (!p) return '<div id="progress"></div>';
const w = p.total ? Math.max(6, Math.round((100 * p.done) / p.total)) : 30;
return `<div id="progress" class="card" role="status"><div class="banner">${MASCOT}<div style="flex:1"><b>${esc(p.label)}</b><div class="small muted">${p.total > 1 ? `${p.done} / ${p.total}` : 'One moment'}</div><div class="progress"><i style="width:${w}%"></i></div></div></div></div>`;
}
function setSpinning(on) { const b = $('#refreshBtn'); if (b) b.classList.toggle('spin', on); }
let toastTimer;
function toast(msg) {
let t = $('#toast');
if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
t.className = 'toast'; t.textContent = msg; t.hidden = false;
clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function statusPill(s) {
if (s.phase === 'live') return `<span class="pill live">${s.label === 'HALF' ? 'HALFTIME' : `Q${s.period > 4 ? 'OT' + (s.period - 4) : s.period} ${esc(s.clock)}`}</span>`;
if (s.phase === 'final') return '<span class="pill final">FINAL</span>';
return `<span class="pill pre">${esc(s.label || 'SOON')}</span>`;
}
function stickers(s) {
const out = [];
if (E.isBlowout(s)) out.push('<span class="sticker blowout">BLOWOUT</span>');
else if (s.phase === 'live' && s.period >= 4 && s.margin <= 6) out.push('<span class="sticker clutch">CLUTCH</span>');
else if (s.phase === 'live' && s.margin <= 5) out.push('<span class="sticker close">CLOSE</span>');
return out.join('');
}
const tier = (p) => (p >= 0.7 ? 't-hi' : p >= 0.5 ? 't-mid' : p >= 0.3 ? 't-lo' : 't-x');
const tierColor = (p) => (p >= 0.7 ? 'var(--green)' : p >= 0.5 ? 'var(--yellow)' : p >= 0.3 ? 'var(--orange)' : 'var(--red)');
function dayLabel() {
const o = state.dayOffset;
const name = o === 0 ? 'Today' : o === -1 ? 'Yesterday' : o === 1 ? 'Tomorrow' : new Date(state.date + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long' });
const d = new Date(state.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
return `${name}<small>${d}</small>`;
}
const f1 = (x, d = 1) => (x == null || !Number.isFinite(+x) ? '–' : (+x).toFixed(d));
const pa = (x) => (x == null || !Number.isFinite(+x) ? '–' : +x <= 1.5 ? pct(+x) : `${Math.round(+x)}%`);
const signed = (x, d = 1) => (x == null || !Number.isFinite(+x) ? '–' : `${+x > 0 ? '+' : ''}${(+x).toFixed(d)}`);
/** Collapsible block that stays open across live re-renders. */
const details = (key, title, body) => `<details class="more" data-key="${esc(key)}" ${state.openDetails.has(key) ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
const fmtRaw = (v) => (v == null ? '–' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : (Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1))) : typeof v === 'object' ? esc(JSON.stringify(v).slice(0, 60)) : esc(v));
function rawTable(cols, rows) {
const keys = [...new Set(rows.flatMap((r) => (r ? Object.keys(r) : [])))].sort((a, b) => a.localeCompare(b));
return `<div class="rawscroll"><table class="mtable raw"><tr><th></th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${keys.map((k) => `<tr><td>${esc(k)}</td>${rows.map((r) => `<td>${r ? fmtRaw(r[k]) : '–'}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
function spreadLabel(s, sp) {
if (sp == null) return '–';
if (sp === 0) return 'PICK';
return sp > 0 ? `${s.v} −${sp}` : `${s.h} −${-sp}`;
}
function booksCard(P, s) {
const M = P.market;
if (!M) return s.phase === 'live' ? liveBooksCard(s) : '';
const fav = M.pAway != null ? (M.pAway >= 0.5 ? s.v : s.h) : null;
const favP = M.pAway != null ? (M.pAway >= 0.5 ? M.pAway : 1 - M.pAway) : null;
const modelFav = P.winProb[s.v] >= 0.5 ? s.v : s.h;
const rng = (r) => (r && r[0] !== r[1] ? ` (books ${r[0]} to ${r[1]})` : '');
return `<div class="section-title">📒 BOOK LINES</div><div class="card">
<div class="grid3">
<div class="kv"><small>Spread</small><b>${spreadLabel(s, M.spreadHome)}</b></div>
<div class="kv"><small>Total</small><b>${M.total != null ? M.total : '–'}</b></div>
<div class="kv"><small>Books win %</small><b>${fav ? `${fav} ${pct(favP)}` : '–'}</b></div>
</div>
<ul class="why" style="margin-top:10px">
${M.total != null ? `<li class="info"><span aria-hidden="true">🧮</span><span>Our projected total is <b>${Math.round(M.projTotal)}</b> vs the books' <b>${M.total}</b>${rng(M.totalRange)}. Their total moves our pace from ${Math.round(M.paceModel)} to ${Math.round(P.pace.season)} possessions.</span></li>` : ''}
${M.spreadHome != null ? `<li class="info"><span aria-hidden="true">📐</span><span>Books have ${spreadLabel(s, M.spreadHome)}${rng(M.spreadRange)}. That feeds the blowout and starters-sit chances.</span></li>` : ''}
${fav ? `<li class="info"><span aria-hidden="true">⚖️</span><span>Win chance: we say <b>${modelFav} ${pct(P.winProb[modelFav])}</b>, the books say <b>${fav} ${pct(favP)}</b>.</span></li>` : ''}
</ul>
<div class="small muted" style="font-weight:700;margin-top:6px">${M.books} books via DataBallr${s.phase !== 'pre' ? ' · pregame lines' : ''}${M.updated ? ` · as of ${new Date(M.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</div>
</div>`;
}
/** Opened mid-game with no pregame line saved on this phone: show where the books are now, for reference only. */
function liveBooksCard(s) {
const L = E.gameLineConsensus(state.oddsRows || [], s.id);
if (!L) return '';
const fav = L.pAway != null ? (L.pAway >= 0.5 ? s.v : s.h) : null;
const favP = L.pAway != null ? (L.pAway >= 0.5 ? L.pAway : 1 - L.pAway) : null;
return `<div class="section-title">📒 LIVE BOOK LINES</div><div class="card">
<div class="grid3">
<div class="kv"><small>Live spread</small><b>${spreadLabel(s, L.spreadHome)}</b></div>
<div class="kv"><small>Live total</small><b>${L.total != null ? L.total : '–'}</b></div>
<div class="kv"><small>Books win %</small><b>${fav ? `${fav} ${pct(favP)}` : '–'}</b></div>
</div>
<div class="small muted" style="font-weight:700;margin-top:6px">${L.books} books via DataBallr${L.updated ? ` · as of ${new Date(L.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}. This phone wasn't open before tip-off, so these live numbers are shown for reference and don't change our projection.</div>
</div>`;
}
function matchupCard(P, s) {
const A = P.teamsDb && P.teamsDb[s.v], B = P.teamsDb && P.teamsDb[s.h], L = P.league;
if (!A && !B) return '';
const row = (label, k, f, best) => {
const a = A ? A[k] : null, b = B ? B[k] : null;
let ca = '', cb = '';
if (best && a != null && b != null && a !== b) { const aw = best === 'hi' ? a > b : a < b; ca = aw ? 'win' : ''; cb = aw ? '' : 'win'; }
return `<tr><td>${label}</td><td class="${ca}">${f(a)}</td><td class="${cb}">${f(b)}</td><td class="lg">${L && k in L ? f(L[k]) : '–'}</td></tr>`;
};
const zone = (label, fk, ak) => {
const z = (T) => (T && T[fk] != null ? `${pa(T[fk])} · ${pa(T[ak])}` : '–');
return `<tr><td>${label}</td><td>${z(A)}</td><td>${z(B)}</td><td class="lg">${z(L)}</td></tr>`;
};
return `<div class="section-title">🧭 MATCHUP · SEASON</div><div class="card">
<table class="mtable"><tr><th></th><th>${badge(s.v, 'sm')}</th><th>${badge(s.h, 'sm')}</th><th>NBA</th></tr>
${row('Pace (poss/48)', 'pace', (x) => f1(x), null)}
${row('Points per 100', 'ortg', (x) => f1(x), 'hi')}
${row('Allowed per 100', 'drtg', (x) => f1(x), 'lo')}
${row('Effective FG%', 'efg', pa, 'hi')}
${row('True shooting', 'ts', pa, 'hi')}
${row('Turnovers per 100', 'tov100', (x) => f1(x), 'lo')}
${row('Off. rebound %', 'orb', pa, 'hi')}
${row('Def. rebound %', 'drb', pa, 'hi')}
${row('Free throw rate', 'fta', pa, 'hi')}
${row('Shot quality', 'sq', pa, 'hi')}
${row('Seconds per trip', 'secOff', (x) => f1(x), null)}
<tr><td colspan="4" class="sub">Where shots come from · how often they go in</td></tr>
${zone('At the rim', 'rimF', 'rimA')}
${zone('Short mid', 'smidF', 'smidA')}
${zone('Long mid', 'lmidF', 'lmidA')}
${zone('Corner 3', 'c3F', 'c3A')}
${zone('Above-break 3', 'a3F', 'a3A')}
</table>
<div class="small muted" style="font-weight:700;margin-top:8px">DataBallr season stats (${A ? f1(A.g, 0) : '–'} and ${B ? f1(B.g, 0) : '–'} games). Pace, ratings and defense are blended into the projections.</div>
</div>`;
}

function emptyHTML(title, text) { return `<div class="card empty">${MASCOT}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`; }

// ------------------------------------------------------------------ routing
function route() {
const h = location.hash.replace(/^#\/?/, '');
const [name, id] = h.split('/');
return { name: name === 'picks' ? 'edges' : name || 'edges', id };
}
function setTab(name) {
document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.tab === name ? 'page' : 'false'));
}
window.addEventListener('hashchange', () => { closeSheet(); window.scrollTo(0, 0); render(); });

// ------------------------------------------------------------------ render
let renderQueued = false;
function render(soft = false) {
if (soft) { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; doRender(); }); return; }
doRender();
}
function doRender() {
const r = route();
const liveN = state.slate.filter((g) => st(g).phase === 'live').length;
const lc = $('#liveCount');
if (lc) { lc.className = 'live-count' + (liveN ? '' : ' idle'); lc.innerHTML = liveN ? `<span class="live-dot"></span>${liveN} LIVE` : 'NO LIVE'; }
const ib = $('#installBtn'); if (ib) ib.hidden = !state.installEvt;
setTab(r.name === 'game' ? 'games' : r.name);
if (r.name === 'game') view.innerHTML = gameView(+r.id);
else if (r.name === 'edges') view.innerHTML = picksView();
else if (r.name === 'games') view.innerHTML = gamesView();
else if (r.name === 'scorers') view.innerHTML = scorersView();
else if (r.name === 'combos') view.innerHTML = combosView();
else if (r.name === 'settings') view.innerHTML = settingsView();
else view.innerHTML = picksView();
if (state.sheetPid) renderSheet();
}

// ---- games list
function gameCard(g) {
const s = st(g);
const pr = state.proj.get(g.id);
const P = pr && pr.proj;
let foot = '';
if (P && s.phase !== 'final') {
const fav = P.winProb[s.v] >= 0.5 ? s.v : s.h;
const [c1] = TEAM[s.v] || ['#888']; const [c2] = TEAM[s.h] || ['#aaa'];
const ts = P.players.filter((p) => p.race && !p.flags.includes('out')).sort((a, b) => b.race.game - a.race.game)[0];
foot = `<div class="gc-foot"><span>Proj <b>${Math.round(P.projScore[s.v])}–${Math.round(P.projScore[s.h])}</b></span><span><b>${fav}</b> ${pct(P.winProb[fav])} to win</span></div>
${ts ? `<div class="gc-foot" style="margin-top:4px"><span>🏆 Top scorer: <b>${esc(ts.name)}</b></span><span>${half(ts.proj.pts)} pts · ${pct(ts.race.game)}</span></div>` : ''}
<div class="winbar" style="margin-top:8px" aria-hidden="true"><i style="width:${(P.winProb[s.v] * 100).toFixed(0)}%;background:${c1}"></i><i style="flex:1;background:${c2}"></i></div>`;
} else if (s.phase === 'final') {
foot = `<div class="gc-foot"><span>Final box & projections recap</span><span>›</span></div>`;
} else {
foot = `<div class="gc-foot"><span>Crunching projections…</span><span>⏳</span></div>`;
}
const lead = s.vs === s.hs ? null : s.vs > s.hs ? 'v' : 'h';
const team = (side) => {
const ab = side === 'v' ? s.v : s.h, nm = side === 'v' ? g.visitor_team : g.home_team, sc = side === 'v' ? s.vs : s.hs;
return `<div class="gc-row">${badge(ab)}<span class="tname">${esc(nm.name)}<small>${esc(nm.city)}</small></span>${s.phase === 'pre' ? '' : `<span class="score led ${lead && lead !== side ? 'dim' : ''}">${sc}</span>`}</div>`;
};
const lu = P && P.lineup && s.phase !== 'final' ? (P.lineup.confirmed ? '<span class="lu ok">✓ LINEUPS IN</span>' : P.lineup.report ? '<span class="lu wait">⏳ INACTIVES PENDING</span>' : '') : '';
return `<a class="card tap" href="#/game/${g.id}" style="text-decoration:none;color:inherit" aria-label="${esc(g.visitor_team.full_name)} at ${esc(g.home_team.full_name)}">
<div class="gc-top">${statusPill(s)}${lu}<span class="grow"></span>${stickers(s)}</div>${team('v')}${team('h')}${foot}</a>`;
}
function gamesView() {
const groups = { live: [], pre: [], final: [] };
for (const g of state.slate) groups[st(g).phase].push(g);
let html = `<div class="datebar">
<button class="icon-btn" data-act="day" data-d="-1" aria-label="Previous day">${ICON.prev}</button>
<div class="label">${dayLabel()}</div>
<button class="icon-btn" data-act="day" data-d="1" aria-label="Next day">${ICON.next}</button></div>`;
html += progressHTML();
if (!state.slate.length) return html + (state.busy || (!state.booted && !state.bootFail) ? '<div class="stack" style="margin-top:14px"><div class="skeleton"></div><div class="skeleton"></div></div>' : !state.booted ? emptyHTML('Can’t reach the scores right now', 'Trying again shortly. Check your connection.') : emptyHTML('No games on the board', 'Try another day with the arrows above.'));
const sec = (title, arr) => (arr.length ? `<div class="section-title">${title}<span class="count">${arr.length}</span></div><div class="stack">${arr.map(gameCard).join('')}</div>` : '');
html += sec('🔴 LIVE NOW', groups.live) + sec('⏰ UP NEXT', groups.pre) + sec('🏁 FINAL', groups.final);
html += `<div class="updated">Updated ${new Date(state.lastUpdate || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} · live games update on every new play</div>`;
return html;
}

// ---- single game
function gameView(id) {
const g = state.slate.find((x) => x.id === id);
const back = `<div class="row" style="margin-bottom:12px"><a class="icon-btn" href="#/games" aria-label="Back to games">${ICON.back}</a><div class="section-title" style="margin:0">GAME CENTER</div></div>`;
if (!g) return back + emptyHTML('Game not on this day', 'Head back and pick a game.');
const s = st(g);
const pr = state.proj.get(id);
const P = pr && pr.proj;
const ls = (side) => s[side === 'v' ? 'v' : 'h'];
const lines = s.lines;
const lsRow = (side) => `<tr><td>${ls(side)}</td>${lines[side].map((x) => `<td>${x == null || s.phase === 'pre' ? '–' : x}</td>`).join('')}<td class="tot">${s.phase === 'pre' ? '–' : side === 'v' ? s.vs : s.hs}</td></tr>`;
let html = back + `<div class="card scoreboard">
<div class="sb-main">
<div class="sb-team">${badge(s.v)}<span class="nm">${esc(g.visitor_team.name)}</span>${s.phase === 'pre' ? '' : `<span class="sb-score led">${s.vs}</span>`}</div>
<div class="sb-clock">${statusPill(s)}<span class="clock">${s.phase === 'live' ? (s.label === 'HALF' ? 'HALF' : esc(s.clock)) : s.phase === 'final' ? 'FINAL' : 'TIP-OFF'}</span>${stickers(s)}</div>
<div class="sb-team">${badge(s.h)}<span class="nm">${esc(g.home_team.name)}</span>${s.phase === 'pre' ? '' : `<span class="sb-score led">${s.hs}</span>`}</div>
</div>
<table class="linescore" aria-label="Score by quarter"><tr><th></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>T</th></tr>${lsRow('v')}${lsRow('h')}</table></div>`;
if (!P) return html + progressHTML() + '<div class="stack" style="margin-top:14px"><div class="skeleton"></div><div class="skeleton"></div></div>';
const [c1] = TEAM[s.v] || ['#888']; const [c2] = TEAM[s.h] || ['#aaa'];
const blow = P.blowout.pBlow;
html += `<div class="meters">
<div class="meter wide"><div class="lbl">Projected final</div><div class="val">${s.v} ${Math.round(P.projScore[s.v])} – ${Math.round(P.projScore[s.h])} ${s.h}</div>
<div class="winbar" aria-label="Win chance"><i style="width:${(P.winProb[s.v] * 100).toFixed(0)}%;background:${c1}"></i><i style="flex:1;background:${c2}"></i></div>
<div class="row between small muted" style="margin-top:4px;font-weight:800"><span>${s.v} ${pct(P.winProb[s.v])}</span><span>${pct(P.winProb[s.h])} ${s.h}</span></div></div>
<div class="meter"><div class="lbl">Starters-sit risk</div><div class="val">${pct(blow)}</div><div class="gauge"><i style="width:${(blow * 100).toFixed(0)}%;background:${blow >= 0.4 ? 'var(--red)' : blow >= 0.2 ? 'var(--yellow)' : 'var(--green)'}"></i></div></div>
<div class="meter"><div class="lbl">Pace (poss/48)</div><div class="val">${Math.round(s.phase === 'pre' ? P.pace.season : P.pace.live)}</div><div class="small muted" style="font-weight:700">Season norm ${Math.round(P.pace.season)}</div></div>
</div>`;
if (s.phase !== 'final') html += gameRaceCard(g, s, P, false);
html += lineupCard(P, s) + booksCard(P, s) + matchupCard(P, s);
html += `<a class="btn alt" style="width:100%;margin-top:12px;text-decoration:none" href="${xSearchUrl(g)}" target="_blank" rel="noopener">𝕏 CHECK YOUR 15 X ACCOUNTS FOR THIS GAME</a>`;
const tm = state.team[id] || s.v;
const b2bTeams = [s.v, s.h].filter((t) => P.b2b && P.b2b[t]);
if (b2bTeams.length && s.phase === 'pre') html += `<div class="card small" style="margin-top:12px;font-weight:700;border-color:var(--ink);background:#3b2a12">⏱️ <b>${b2bTeams.join(' & ')}</b> on the 2nd night of a back-to-back — veterans often rest. Confirm on X before you pick.</div>`;
html += `<div class="seg" role="group" aria-label="Team">${[s.v, s.h].map((t) => `<button data-act="team" data-g="${id}" data-t="${t}" aria-pressed="${t === tm}">${badge(t, 'sm')}${t}</button>`).join('')}</div>`;
const players = P.players.filter((p) => p.team === tm && (p.proj.min >= 6 || p.now.min > 0));
html += `<div class="stack">${players.map((p) => playerCard(p, id, s)).join('') || emptyHTML('No rotation yet', 'Projections appear once data loads.')}</div>`;
const absent = (P.absent || []).filter((a) => a.team === tm);
if (absent.length) {
html += `<div class="section-title">🩹 NOT EXPECTED TONIGHT</div><div class="card stack" style="gap:8px">${absent.map((a) => `<div class="row between"><div><b>${esc(a.name)}</b><div class="small muted" style="font-weight:700">${esc(a.why)}</div></div>
<button class="btn small ghost" data-act="ov" data-g="${id}" data-p="${a.pid}" data-s="in">HE'S PLAYING</button></div>`).join('')}
<div class="small muted" style="font-weight:600">His minutes and shots are shared with teammates. Tap if X says he's active.</div></div>`;
}
const TA = DB.teamAll(DB.seasons(state.date).cur, s.v), TB = DB.teamAll(DB.seasons(state.date).cur, s.h);
if ((TA && TA.row) || (TB && TB.row)) html += `<div style="margin-top:12px">${details(`team:${id}`, `📚 ALL DATABALLR TEAM STATS · ${s.v} vs ${s.h}`, rawTable([s.v, s.h, 'NBA'], [TA && TA.row, TB && TB.row, (TA && TA.league) || (TB && TB.league)]))}</div>`;
if ((TA && TA.opp) || (TB && TB.opp)) html += `<div style="margin-top:8px">${details(`teamopp:${id}`, `🛡️ WHAT OPPONENTS DO AGAINST ${s.v} · ${s.h}`, rawTable([`vs ${s.v}`, `vs ${s.h}`, 'NBA'], [TA && TA.opp, TB && TB.opp, (TA && TA.oppLeague) || (TB && TB.oppLeague)]))}</div>`;
html += `<div class="updated">${s.phase === 'live' ? (pr.feed === 'espn' ? 'Live from the backup play-by-play feed (ESPN) · ' : 'Live from DataBallr play-by-play · ') : ''}${P.sims.toLocaleString()} simulations · updated ${new Date(pr.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div>`;
return html;
}
/** Who's in, who's out and how sure we are (ESPN injury report + active lists). */
function lineupCard(P, s) {
if (s.phase === 'final') return '';
const L = P.lineup || {};
const av = state.avail[P.state.id] || null;
const head = L.confirmed ? '<span class="lu ok">✓ LINEUPS CONFIRMED</span>' : L.report ? '<span class="lu wait">⏳ INACTIVES PENDING · INJURY REPORT APPLIED</span>' : '<span class="lu wait">⏳ NO INJURY REPORT YET</span>';
const st5 = av && av.starters ? [s.v, s.h].filter((t) => av.starters[t] && av.starters[t].length).map((t) => `<div class="small" style="font-weight:700"><b>${t}</b> ${av.starters[t].map(esc).join(', ')}</div>`).join('') : '';
const outs = (P.absent || []).length, gtd = P.players.filter((p) => p.doubt).length;
return `<div class="card lineup">${head}${st5 ? `<div class="small muted" style="font-weight:800;margin-top:8px">STARTERS</div>${st5}` : ''}
<div class="small muted" style="font-weight:700;margin-top:6px">${outs} out and removed from projections${gtd ? ` · ${gtd} flagged unsure` : ''}</div></div>`;
}
/** Context chips on a projection: role, usage shift, matchup, pace, blowout, rest, status. */
const TIER_LBL = { strong: 'STRONG EDGE', solid: 'SOLID EDGE', slight: 'SLIGHT EDGE', unsure: 'UNSURE' };
function chipRow(chips, max) {
const list = (chips || []).slice(0, max || 6);
return list.length ? `<div class="cx">${list.map((c) => `<span class="cxc ${c.e}">${esc(c.t)}</span>`).join('')}</div>` : '';
}
/** The live context behind a number (rotation, fouls, role, usage, game script). */
function whyLines(p, max) {
const w = (p.why || []).slice();
if (!w.length) return '';
const rank = (x) => (x.effect === 'down' ? 0 : x.effect === 'up' ? 1 : 2);
const list = max ? w.filter((x) => x.icon !== '🗓️').sort((a, b) => rank(a) - rank(b)).slice(0, max) : w;
if (!list.length) return '';
return `<ul class="why${max ? ' compact' : ''}">${list.map((x) => `<li class="${x.effect}"><span aria-hidden="true">${x.icon}</span><span>${esc(x.text)}${x.so ? `<span class="so">${esc(x.so)}</span>` : ''}</span></li>`).join('')}</ul>`;
}
function playerCard(p, gid, s) {
const tags = [];
if (p.flags.includes('hot')) tags.push('<span class="tag hot">🔥 HOT</span>');
if (p.flags.includes('cold')) tags.push('<span class="tag cold">🧊 COLD</span>');
if (p.flags.some((f) => f.startsWith('foul'))) tags.push(`<span class="tag foul">⚠️ ${p.now.pf} FOULS</span>`);
if (p.flags.includes('sitrisk')) tags.push('<span class="tag sit">💤 MAY SIT LATE</span>');
if (p.flags.includes('blowproof')) tags.push('<span class="tag proof">🛡️ BLOWOUT-PROOF</span>');
if (p.flags.includes('out')) tags.push('<span class="tag out">OUT</span>');
if (p.dnpYet && s.phase === 'live') tags.push('<span class="tag">NOT IN YET</span>');
if (p.rot && s.phase === 'live' && !p.on && !p.rot.foulSit && p.rot.benched < 0.5 && !p.dnpYet) tags.push('<span class="tag out">🪑 PULLED</span>');
if (p.rot && s.phase === 'live' && p.rot.tonight >= 1.12 && p.now.min >= 6) tags.push('<span class="tag hot">📈 ROLE UP</span>');
if (p.doubt && !getOverrides().in.includes(p.pid)) tags.push(`<span class="tag foul">⚠️ CHECK STATUS · ${esc(p.doubt)}</span>`);
if (p.doubt && getOverrides().in.includes(p.pid)) tags.push('<span class="tag" style="background:var(--green);color:var(--ink)">✓ CONFIRMED IN</span>');
else if (p.confirmed && s.phase === 'pre') tags.push('<span class="tag" style="background:var(--green);color:var(--ink)">✓ ACTIVE</span>');
const stat = (k, lbl) => `<div class="stat"><small>${lbl}</small><div class="proj">${half(p.proj[k])}</div><div class="now">${s.phase === 'pre' ? 'proj' : `now <b>${p.now[k]}</b>`}</div></div>`;
const fouls = Array.from({ length: 6 }, (_, i) => `<i class="${i < p.now.pf ? 'f' : ''}"></i>`).join('');
const showNow = s.phase !== 'pre';
const mv = s.phase === 'live' ? moveOf(gid, p.pid) : null;
if (p.fade) tags.unshift('<span class="tag fadew">📉 FADE WARNING</span>');
if (p.flags.includes('realhot')) tags.push('<span class="tag real">REAL USAGE</span>');
return `<button class="card ${mv ? (mv.d > 0 ? 'flash-up' : 'flash-down') : ''}" style="${mv ? `--age:${((Date.now() - mv.at) / 1000).toFixed(1)}s` : ''}" data-act="player" data-g="${gid}" data-p="${p.pid}" aria-label="${esc(p.name)} details">
<div class="pc-head"><span class="oncourt ${p.on ? 'on' : ''}" title="${p.on ? 'On the floor' : 'On the bench'}"></span><b>${esc(p.name)}</b><span class="grow"></span>
<span class="mins">${showNow ? `${Math.round(p.now.min)}′ → ` : ''}${Math.round(p.proj.min)}′</span></div>
${mv ? `<div class="ec-move">${moveHTML(mv)}</div>` : ''}
${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
${chipRow((p.chips || []).filter((c) => !/CHECK STATUS|CONFIRMED/.test(c.t)), 4)}
${whyLines(p, 2)}
<div class="statrow">${stat('pts', 'PTS')}${stat('reb', 'REB')}${stat('ast', 'AST')}${stat('fg3m', '3PM')}</div>
<div class="pc-foot"><div class="minbar" aria-hidden="true"><i class="proj" style="width:${Math.min(100, (p.proj.min / 48) * 100).toFixed(0)}%"></i><i class="played" style="width:${Math.min(100, (p.now.min / 48) * 100).toFixed(0)}%"></i></div>
<span class="usg">USG ${pct(p.usage.proj)}</span><span class="fouls ${p.now.pf >= 4 ? 'danger' : ''}" aria-label="${p.now.pf} fouls">${fouls}</span></div>
</button>`;
}

// ---- player sheet
function openSheet(gid, pid) { state.sheetGame = gid; state.sheetPid = pid; state.sheetAll = null; renderSheet(); }
function closeSheet() { state.sheetPid = null; const s = $('#sheetWrap'); if (s) s.remove(); }
function renderSheet() {
const pr = state.proj.get(state.sheetGame);
const p = pr && pr.proj.players.find((x) => x.pid === state.sheetPid);
if (!p) return closeSheet();
const s = pr.proj.state;
let wrap = $('#sheetWrap');
const fresh = !wrap;
if (!wrap) { wrap = document.createElement('div'); wrap.id = 'sheetWrap'; document.body.appendChild(wrap); }
const ladder = (k, label) => {
const rungs = p.ladders[k].filter((r) => r.t > p.now[k] && r.p >= 0.04).slice(0, 6);
if (!rungs.length) return '';
const m = p.market && p.market[k];
const ahead = m ? p.proj[k] - m.line : 0;
const book = m && ahead > 0 ? `<div class="book">Book line <b>${m.line}</b> · proj <b>${half(p.proj[k])}</b> · <b style="color:var(--green)">+${ahead.toFixed(1)} ahead</b> · hits <b>${pct(m.model)}</b>${m.model - m.book >= 0.03 ? ` (book ${pct(m.book)}) · <b style="color:var(--green)">edge ✓</b>` : ''}</div>` : '';
return `<h3>${label} · now ${p.now[k]} → ${half(p.proj[k])}</h3><div class="ladder">${rungs.map((r) => `<div class="rung"><span>${r.t}+ ${E.STAT_LABEL[k]}</span><div class="bar"><i class="${tier(r.p)}" style="width:${(r.p * 100).toFixed(0)}%"></i></div><span class="pct">${pct(r.p)}</span></div>`).join('')}</div>${book}`;
};
const qmax = Math.max(12, ...[1, 2, 3, 4].map((q) => p.qavg[q] || 0));
const usage = (x) => (x == null ? '–' : pct(x));
wrap.innerHTML = `<div class="sheet-backdrop" data-act="close"></div>
<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">
<div class="grab"></div>
<div class="row">${badge(p.team)}<div style="flex:1;min-width:0"><h2>${esc(p.name)}</h2><div class="small muted" style="font-weight:700">${p.team} vs ${p.opp} · ${s.phase === 'pre' ? 'pregame' : `${p.now.pts} PTS · ${p.now.reb} REB · ${p.now.ast} AST · ${Math.round(p.now.min)} MIN`}</div></div>
<button class="icon-btn" data-act="close" aria-label="Close">✕</button></div>
${p.doubt ? `<div class="card small" style="margin-top:12px;font-weight:700;background:#3b2a12">⚠️ Availability not confirmed: <b>${esc(p.doubt)}</b>. Check X, then tap PLAYING or OUT — picks stay hidden until you do.</div>` : ''}
<div class="row" style="margin-top:12px;gap:8px"><span class="small muted" style="font-weight:800;flex:1">Status tonight (from X / news)</span>
<button class="chip" data-act="ov" data-g="${state.sheetGame}" data-p="${p.pid}" data-s="in" aria-pressed="${getOverrides().in.includes(p.pid) || (!p.doubt && !getOverrides().out.includes(p.pid))}">PLAYING</button>
<button class="chip" data-act="ov" data-g="${state.sheetGame}" data-p="${p.pid}" data-s="out" aria-pressed="${getOverrides().out.includes(p.pid)}">OUT</button></div>
${sheetNow(p, s)}
${(p.why || []).length ? `<h3>WHY THIS NUMBER</h3>${whyLines(p)}` : ''}
${ladder('pts', 'POINTS')}${ladder('reb', 'REBOUNDS')}${ladder('ast', 'ASSISTS')}${ladder('fg3m', 'THREES')}${ladder('pra', 'PTS+REB+AST')}
<h3>SHOT PROFILE</h3>
<div class="grid3">
<div class="kv"><small>Usage now</small><b>${usage(p.usage.tonight)}</b></div>
<div class="kv"><small>Usage season</small><b>${usage(p.usage.season)}</b></div>
<div class="kv"><small>Usage proj</small><b>${usage(p.usage.proj)}</b></div>
<div class="kv"><small>FGA → proj</small><b>${p.now.fga} → ${half(p.proj.fga)}</b></div>
<div class="kv"><small>3PA → proj</small><b>${p.now.fg3a} → ${half(p.proj.fg3a)}</b></div>
<div class="kv"><small>FTA → proj</small><b>${p.now.fta} → ${half(p.proj.fta)}</b></div>
<div class="kv"><small>2P%</small><b>${pct(p.shooting.p2)}</b></div>
<div class="kv"><small>3P%</small><b>${pct(p.shooting.p3)}</b></div>
<div class="kv"><small>FT%</small><b>${pct(p.shooting.ft)}</b></div>
</div>
${dbSections(p, s)}
<h3>MINUTES BY QUARTER</h3>
<div class="qbars">${[1, 2, 3, 4].map((q) => `<div class="qbar"><div class="col" style="height:${Math.max(4, ((p.qavg[q] || 0) / qmax) * 64)}px"></div>Q${q} · ${(p.qavg[q] || 0).toFixed(1)}′</div>`).join('')}</div>
<p class="small muted" style="font-weight:600;margin-top:10px">Season average minutes per quarter (${p.games} recent games). Live, minutes come from this coach's rotation map: when he usually checks in and out, whether he's on the floor right now, foul rest, and how tonight's rotation has treated him. Projected ${Math.round(p.proj.min)} total minutes tonight.</p>
</section>`;
if (fresh) wrap.querySelector('.sheet').focus?.();
}

/** Top of the notes: the number, how wide it could swing, and what changed since tip-off and just now. */
function sheetNow(p, s) {
if (s.phase === 'final') return '';
const tip = tipMap()[p.pid];
const mv = moveOf(state.sheetGame, p.pid);
const rg = p.range && p.range.pts;
const bits = [];
if (s.phase === 'live' && tip != null && Math.abs(p.proj.pts - tip) >= 0.5) bits.push(`<li class="${p.proj.pts > tip ? 'up' : 'down'}"><span aria-hidden="true">${p.proj.pts > tip ? '▲' : '▼'}</span><span>Since tip-off his points projection has moved from ${tip.toFixed(1)} to <b>${p.proj.pts.toFixed(1)}</b>.<span class="so">${p.proj.pts > tip ? 'That helps picks on him.' : 'Any edge shown is measured from the new, lower number.'}</span></span></li>`);
if (p.mean && p.mean.pts - p.proj.pts >= 0.4) bits.push(`<li class="info"><span aria-hidden="true">📍</span><span><b>${p.proj.pts.toFixed(1)}</b> is where he most often finishes from here. A few big finishes pull the plain average up to ${p.mean.pts.toFixed(1)}, so we show the number he lands on most.</span></li>`);
if (mv) bits.push(`<li class="${mv.d > 0 ? 'up' : 'down'}"><span aria-hidden="true">${mv.d > 0 ? '▲' : '▼'}</span><span>Just now: ${mv.d > 0 ? '+' : '−'}${Math.abs(mv.d).toFixed(1)} points on his projection (${esc(mv.why)}).</span></li>`);
if (p.shift && s.phase === 'live' && Math.abs(p.shift.rem - p.shift.baseRem) >= 1.5) { const d = p.shift.rem - p.shift.baseRem; bits.push(`<li class="${d > 0 ? 'up' : 'down'}"><span aria-hidden="true">⚡</span><span>From here he projects for ${p.shift.rem.toFixed(1)} more points. On a normal night it would be about ${p.shift.baseRem.toFixed(1)}.<span class="so">${Math.abs(p.shift.dMin) >= Math.abs(p.shift.dRate) ? `Mostly minutes: ${p.shift.remMin.toFixed(1)} left to play vs his usual ${p.shift.usualRem.toFixed(1)}.` : 'Mostly his share of the shots and how the game is going.'}</span></span></li>`); }
return `<div class="nowbox"><div class="nb-num"><span class="led">${half(p.proj.pts)}</span><small>projected points</small></div>
<div class="nb-range">${rg ? `Likely finish <b>${rg[0]} to ${rg[1]}</b><small>8 games in 10 land in this range</small>` : ''}</div></div>
${bits.length ? `<h3>WHAT CHANGED</h3><ul class="why">${bits.join('')}</ul>` : ''}`;
}
function dbSections(p, s) {
let out = '';
const z = p.zones || {};
const zk = [['rim', 'At the rim'], ['mid', 'Mid-range'], ['three', 'Threes']].filter(([k]) => z[k]);
if (zk.length) out += `<h3>TONIGHT'S SHOTS BY ZONE</h3><div class="grid3">${zk.map(([k, l]) => `<div class="kv"><small>${l}</small><b>${z[k][1]}/${z[k][0]}</b></div>`).join('')}</div>`;
const D = p.db || {};
const P = D.prof;
if (P || D.arch) {
const kv = (l, v) => `<div class="kv"><small>${l}</small><b>${v}</b></div>`;
out += `<h3>DATABALLR PROFILE · SEASON</h3>${D.arch || D.pos ? `<div class="small" style="font-weight:800;margin-bottom:8px">${esc([D.arch, D.pos].filter(Boolean).join(' · '))}</div>` : ''}`;
if (P) out += `<div class="grid3">
${kv('True shooting', pa(P.ts))}${kv('Shot quality', P.sq == null ? '–' : f1(P.sq, 2))}${kv('Pts per 75', f1(P.pts75))}
${kv('Rim FG%', pa(P.rim))}${kv('Short mid FG%', pa(P.smid))}${kv('Long mid FG%', pa(P.lmid))}
${kv('Potential ast /100', f1(P.potAst100))}${kv('On-ball time', pa(P.onBall))}${kv('Creation', f1(P.creation))}
${kv('Steals /100', f1(P.stl100))}${kv('Blocks /game', f1(P.blk))}${kv('On/off net', signed(P.onoff))}
${kv('Off. reb %', pa(P.orb))}${kv('Def. reb %', pa(P.drb))}${kv('Rim shots /g', f1(P.dRim))}
</div>`;
}
const G = D.logs;
if (G && G.n) {
const a = G.avg;
// Only show what DataBallr actually sent (some tracking fields are blank this season).
const has = (x) => x != null && Number.isFinite(+x);
const kv = (l, x, v) => (has(x) ? `<div class="kv"><small>${l}</small><b>${v}</b></div>` : '');
out += `<h3>TRACKING · LAST ${G.n} GAMES</h3><div class="grid3">
${kv('Usage', a.usg, pa(a.usg))}${kv('True shooting', a.ts, pa(a.ts))}${kv('Ball time (min)', a.top, f1(a.top))}
${kv('Potential ast', a.potAst, f1(a.potAst))}${kv('Screen assists', a.scrAst, f1(a.scrAst))}${kv('Rebound %', a.rebPct, pa(a.rebPct))}
${kv('Catch & shoot 3s', a.cs3a, `${f1(a.cs3a)} · ${pa(a.cs3p)}`)}${kv('Pull-up 3s', a.pu3a, `${f1(a.pu3a)} · ${pa(a.pu3p)}`)}${kv('Minutes', a.min, f1(a.min))}
</div>
<h3>LAST GAMES</h3><div class="rawscroll"><table class="mtable"><tr><th>Date</th><th>Opp</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th><th>USG</th></tr>
${G.games.slice(0, 6).map((x) => `<tr><td>${esc(String(x.date || '').replace(/-/g, '').slice(4, 8).replace(/^(\d\d)(\d\d)$/, '$1/$2'))}</td><td>${esc(x.opp)}</td><td>${f1(x.min, 0)}</td><td>${f1(x.pts, 0)}</td><td>${f1(x.reb, 0)}</td><td>${f1(x.ast, 0)}</td><td>${f1(x.fg3m, 0)}</td><td>${pa(x.usg)}</td></tr>`).join('')}
</table></div>`;
}
const A = state.sheetAll && state.sheetAll.pid === p.pid ? state.sheetAll : null;
if (A && (A.season || (A.logs && A.logs.length))) {
let body = '';
if (A.season) body += `<div class="small" style="font-weight:800;margin:8px 0 4px">Season (${Object.keys(A.season).length} fields)</div>${rawTable(['Season'], [A.season])}`;
if (A.logs && A.logs.length) body += `<div class="small" style="font-weight:800;margin:12px 0 4px">Last games, every field</div>${rawTable(A.logs.slice(0, 3).map((r) => String(r.date || '').replace(/-/g, '').slice(4, 8).replace(/^(\d\d)(\d\d)$/, '$1/$2') + ' ' + (r.OpponentAbbreviation || '')), A.logs.slice(0, 3))}`;
out += `<div style="margin-top:14px">${details(`player:${p.pid}`, '📚 ALL DATABALLR STATS', body)}</div>`;
} else if (!A) loadSheetAll(p);
return out;
}
function loadSheetAll(p) {
const pid = p.pid;
state.sheetAll = { pid, loading: true };
const season = DB.seasons(state.date).cur;
const nba = p.db && p.db.nba_id;
Promise.all([DB.playerAll(season, p.name), nba ? DB.playerLogsRaw(nba, season) : Promise.resolve([])]).then(([row, logs]) => {
if (state.sheetPid !== pid) return;
state.sheetAll = { pid, season: row, logs: (logs || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))) };
renderSheet();
}).catch(() => { if (state.sheetPid === pid) state.sheetAll = { pid }; });
}

// ---- picks
function slatePicks() {
const out = [];
for (const g of state.slate) {
const s = st(g);
if (s.phase === 'final') continue;
const pr = state.proj.get(g.id);
if (!pr) continue;
const blowSkip = settings.skipBlowouts && E.isBlowout(s);
const proof = new Set(pr.proj.players.filter((p) => p.blowProof).map((p) => p.pid));
const ov = getOverrides();
const shaky = new Set(pr.proj.players.filter((p) => p.doubt && !/not on injury report/.test(p.doubt) && !ov.in.includes(p.pid)).map((p) => p.pid));
for (const k of pr.picks) {
if (shaky.has(k.pid)) { state.hiddenShaky = (state.hiddenShaky || 0) + 1; continue; }
if (blowSkip && !proof.has(k.pid)) continue;
out.push(k);
}
}
return out;
}
const SIGNAL = { strong: 'edge', solid: 'edge', slight: 'edge', unsure: 'noplay' };
function pickCard(k, rank) {
const pr = state.proj.get(k.gameId);
const p = pr && pr.proj.players.find((x) => x.pid === k.pid);
const s = pr && pr.proj.state;
const mv = moveOf(k.gameId, k.pid);
const ahead = k.ahead ?? (k.proj - k.line);
const sig = p && p.fade ? 'fade' : mv && mv.d > 0 ? 'rise' : SIGNAL[k.tier] || 'edge';
const rng = p && p.range && p.range[k.stat] ? `likely ${p.range[k.stat][0]} to ${p.range[k.stat][1]}` : '';
return `<button class="card edgecard sig-${sig} ${mv ? (mv.d > 0 ? 'flash-up' : 'flash-down') : ''}" style="${mv ? `--age:${((Date.now() - mv.at) / 1000).toFixed(1)}s` : ''}" data-act="player" data-g="${k.gameId}" data-p="${k.pid}" aria-label="${esc(k.name)} ${esc(k.label)}, tap for notes">
<div class="ec-num"><span class="led">${half(k.proj)}</span><small>proj ${E.STAT_LABEL[k.stat]}</small></div>
<div class="ec-main"><div class="ec-name">${rank ? `<span class="ec-rank">${rank}</span>` : ''}<b>${esc(k.name)}</b></div>
<div class="ec-line">${k.kind === 'line' ? 'Line' : 'Rung'} <b>${k.kind === 'line' ? k.line : esc(k.label.split(' ')[0])}</b><span class="ec-edge">+${ahead.toFixed(1)} edge</span><span class="ec-pct">${pct(k.prob)}</span></div>
<div class="ec-sub">${esc(k.game)}${s && s.phase === 'live' ? ` · ${s.label === 'HALF' ? 'half' : `Q${s.period} ${esc(s.clock)}`} · has ${k.now}` : ''}${rng ? ` · ${rng}` : ''}</div></div>
<span class="conf ${k.tier}">${TIER_LBL[k.tier] || ''}</span>
${mv ? `<div class="ec-move">${moveHTML(mv)}</div>` : p && p.fade ? '<div class="ec-move"><span class="mvflash down still">📉 Fade warning: tap for why</span></div>' : k.tier === 'unsure' && k.tierWhy ? `<div class="ec-move"><span class="mvflash still">No play yet: ${esc(k.tierWhy.join(', '))}</span></div>` : ''}
</button>`;
}
/** Usage Shift and Fade alerts across tonight's live games, biggest first. */
function alertRows() {
const out = [];
for (const g of state.slate) {
const pr = state.proj.get(g.id);
if (!pr || !pr.proj || pr.proj.state.phase !== 'live') continue;
for (const a of pr.proj.alerts || []) out.push({ a, g, s: pr.proj.state });
// the projected top scorer has changed hands since tip-off
const tip = tipMap();
const ps = pr.proj.players.filter((p) => tip[p.pid] != null && !p.flags.includes('out'));
if (ps.length >= 6) {
const was = ps.slice().sort((x, y) => tip[y.pid] - tip[x.pid])[0], now = ps.slice().sort((x, y) => y.proj.pts - x.proj.pts)[0];
if (was.pid !== now.pid && now.proj.pts - was.proj.pts >= 1.5) out.push({ g, s: pr.proj.state, a: { type: 'lead', team: now.team, size: now.proj.pts - was.proj.pts + 2, up: { pid: now.pid, name: now.name, proj: now.proj.pts }, down: { pid: was.pid, name: was.name, proj: was.proj.pts },
text: `The projected big game has moved from ${was.name} to ${now.name}.`, so: `${now.name} now projects for ${now.proj.pts.toFixed(1)} points (${tip[now.pid].toFixed(1)} at tip-off). ${was.name} projects for ${was.proj.pts.toFixed(1)} (${tip[was.pid].toFixed(1)} at tip-off).` } });
}
}
return out.sort((x, y) => (y.a.type !== 'fade') - (x.a.type !== 'fade') || y.a.size - x.a.size);
}
function alertCard(row) {
const { a, g, s } = row;
const pid = a.type === 'fade' ? a.pid : a.up.pid;
const head = a.type === 'fade' ? `📉 FADE WARNING · ${esc(a.name)}` : a.type === 'lead' ? `⚡ USAGE SHIFT · ${esc(a.team)} top scorer` : `⚡ USAGE SHIFT · ${esc(a.team)}`;
const nums = a.type === 'fade' ? `<span class="al-n down">on pace ${Math.round(a.onPace)}</span><span class="al-n">we project ${a.proj.toFixed(1)}</span>`
: `<span class="al-n up">▲ ${esc(a.up.name.split(' ').slice(-1)[0])} ${a.up.proj.toFixed(1)}</span>${a.down ? `<span class="al-n down">▼ ${esc(a.down.name.split(' ').slice(-1)[0])} ${a.down.proj.toFixed(1)}</span>` : ''}`;
return `<button class="card alert ${a.type === 'fade' ? 'sig-fade' : 'sig-rise'}" data-act="player" data-g="${g.id}" data-p="${pid}">
<div class="al-head">${head}<span class="grow"></span><span class="al-when">${s.label === 'HALF' ? 'HALF' : `Q${s.period} ${esc(s.clock)}`}</span></div>
<div class="al-text">${esc(a.type === 'fade' ? a.text.replace(/^Fade warning: /, '') : a.text)}</div>
<div class="al-nums">${nums}</div></button>`;
}
function picksView() {
state.hiddenShaky = 0;
const filters = [['all', 'ALL'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['fg3m', '3PM'], ['pra', 'PRA']];
let picks = slatePicks();
if (state.pickFilter !== 'all') picks = picks.filter((k) => k.stat === state.pickFilter);
const alerts = alertRows();
let html = (alerts.length ? `<div class="section-title" style="margin-top:4px">⚡ CHANGING NOW<span class="count">${alerts.length}</span></div><div class="stack">${alerts.slice(0, 4).map(alertCard).join('')}</div>` : '') + `<div class="section-title" style="margin-top:${alerts.length ? 18 : 4}px">🎯 BEST PLUS EDGES NOW</div>
<div class="chips" role="group" aria-label="Stat filter">${filters.map(([k, l]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${state.pickFilter === k}">${l}</button>`).join('')}</div>
<div class="card row between" style="padding:10px 14px"><div><b>Skip blowouts</b><div class="small muted" style="font-weight:600">Hide games up 15+, or 12+ after halftime. Blowout-proof players stay.</div></div>
<label class="toggle"><input type="checkbox" data-act="skipblow" ${settings.skipBlowouts ? 'checked' : ''} aria-label="Skip blowouts"><span></span></label></div>`;
html += progressHTML();
if (state.hiddenShaky) html += `<div class="card small" style="margin-top:10px;font-weight:700;background:#3b2a12">⚠️ ${state.hiddenShaky} pick${state.hiddenShaky > 1 ? 's' : ''} hidden: player status not confirmed (back-to-back rest, questionable, or missed last game). Open the game, check X, and tap PLAYING to unlock.</div>`;
if (!picks.length) return html + (state.busy || state.progress ? '<div class="stack" style="margin-top:14px"><div class="skeleton"></div></div>' : emptyHTML('No plus edges yet', 'Picks show when a player is projected ahead of the line: 60%+ to clear a book line with value, or 75%+ on a model rung.'));
const value = picks.filter((k) => k.kind === 'line'), safe = picks.filter((k) => k.kind !== 'line');
if (value.length) html += `<div class="stack">${value.slice(0, 25).map((k, i) => pickCard(k, i + 1)).join('')}</div>`;
if (safe.length) html += `<div class="section-title">🛡️ SAFE LADDER <span class="count">no book line yet: 75%+ rungs</span></div><div class="stack">${safe.sort((a, b) => b.prob - a.prob).slice(0, 25).map((k) => pickCard(k)).join('')}</div>`;
html += `<div class="legend"><span class="lg edge">Strong edge</span><span class="lg rise">Rising</span><span class="lg fade">Fading</span><span class="lg noplay">No play</span></div>`;
html += `<p class="updated">Every pick is projected ahead of its line. Plus edges = our projection beats the DataBallr book line and our chance to clear it beats the book's no-vig chance. Safe ladder = highest rung still 75%+.</p>`;
return html;
}

// ---- top scorers: who will score the most, across tonight's slate and inside each game, updated live
const SCORE_CHIP = /STEPS UP|STARTS TONIGHT|CLOSER|BLOWOUT-PROOF|NEEDS|HOT|ROLE/;
function scorerRows() {
const rows = [];
for (const g of state.slate) {
const s = st(g), pr = state.proj.get(g.id);
if (!pr || !pr.proj) continue;
for (const p of pr.proj.players) {
if (p.flags.includes('out') || (s.phase !== 'final' && p.proj.min < 10 && p.now.min < 4)) continue;
rows.push({ p, g, s });
}
}
return rows;
}
function ladderAt(p, t) { const x = ((p.ladders && p.ladders.pts) || []).find((y) => y.t === t); return x ? x.p : null; }
function scorerReason(p, s) {
const it = (p.why || []).find((x) => /^sit-/.test(x.key) && x.text) || null;
if (it) return it.text;
if (s.phase === 'live' && p.flags.some((f) => f.startsWith('foul'))) return `In foul trouble with ${p.now.pf} fouls, so his minutes may be cut.`;
if (p.flags.includes('sitrisk')) return 'This game could turn into a blowout, and he may sit late.';
return '';
}
function scorerCard(row, rank) {
const { p, g, s } = row;
const tip = tipMap()[p.pid];
const moved = s.phase === 'live' && tip != null ? p.proj.pts - tip : null;
const marks = [20, 25, 30, 35].map((t) => [t, ladderAt(p, t)]).filter(([, x]) => x != null && x >= 0.4 && x <= 0.97).slice(-2);
const lead = p.race ? p.race.game : null;
const tags = [];
if (s.phase === 'live') tags.push(statusPill(s));
if (p.flags.some((f) => f.startsWith('foul'))) tags.push(`<span class="tag foul">⚠️ ${p.now.pf} FOULS</span>`);
if (p.flags.includes('sitrisk')) tags.push('<span class="tag sit">💤 MAY SIT LATE</span>');
if (p.flags.includes('blowproof')) tags.push('<span class="tag proof">🛡️ BLOWOUT-PROOF</span>');
if (p.flags.includes('hot')) tags.push('<span class="tag hot">🔥 HOT</span>');
if (p.flags.includes('cold')) tags.push('<span class="tag cold">🧊 COLD</span>');
const chips = (p.chips || []).filter((c) => SCORE_CHIP.test(c.t) && !/BLOWOUT-PROOF/.test(c.t));
const reason = scorerReason(p, s);
const odds = [lead != null ? `Leads his game <b>${pct(lead)}</b>` : '', ...marks.map(([t, x]) => `${t}+ pts <b>${pct(x)}</b>`)].filter(Boolean).join(' · ');
return `<button class="card scorer" data-act="player" data-g="${g.id}" data-p="${p.pid}" aria-label="${esc(p.name)} scoring details">
<div class="sc-rank">${rank}</div>
<div class="who"><div class="nmrow">${badge(p.team, 'sm')}<b>${esc(p.name)}</b></div>
<div class="sub">${esc(s.v)} @ ${esc(s.h)}${s.phase === 'pre' ? ` · ${esc(s.label || 'tonight')}` : ''}${s.phase === 'live' ? ` · has <b class="led">${p.now.pts}</b> now` : ''}</div></div>
<div class="sc-pts"><span class="big">${half(s.phase === 'final' ? p.now.pts : p.proj.pts)}</span><small>${s.phase === 'final' ? 'FINAL PTS' : 'PROJ PTS'}</small>${moved != null && Math.abs(moved) >= 0.5 ? `<span class="mv ${moved > 0 ? 'up' : 'down'}">${moved > 0 ? '▲ +' : '▼ '}${moved.toFixed(1)} since tip</span>` : ''}</div>
${s.phase !== 'final' && odds ? `<div class="sc-odds small">${odds}</div>` : ''}
${tags.length || chips.length ? `<div class="sc-tags"><div class="tags">${tags.join('')}</div>${chipRow(chips, 3)}</div>` : ''}
${reason && s.phase !== 'final' ? `<div class="sc-why small">${esc(reason)}</div>` : ''}
</button>`;
}
function gameRaceCard(g, s, P, link = true) {
const top = P.players.filter((p) => p.race && !p.flags.includes('out')).sort((a, b) => b.race.game - a.race.game || b.proj.pts - a.proj.pts).slice(0, 3);
if (!top.length) return '';
const head = link ? `<div class="row between"><div class="row" style="gap:6px">${badge(s.v, 'sm')}<b>${esc(s.v)} @ ${esc(s.h)}</b>${badge(s.h, 'sm')}</div>${statusPill(s)}</div>` : '<div class="row between"><b>🏆 TOP SCORER RACE</b><span class="small muted" style="font-weight:700">chance to lead the game</span></div>';
const open = link ? `<a class="card race" href="#/game/${g.id}" style="text-decoration:none;color:inherit" aria-label="Top scorer race, ${esc(g.visitor_team.full_name)} at ${esc(g.home_team.full_name)}">` : '<div class="card race" style="margin-top:12px">';
return `${open}
${head}
${top.map((p) => `<div class="race-row"><span class="nm">${esc(p.name)}</span><span class="pts">${half(p.proj.pts)} pts${s.phase === 'live' ? ` <small>(${p.now.pts} now)</small>` : ''}</span><span class="bar" aria-hidden="true"><i style="width:${Math.round(p.race.game * 100)}%"></i></span><span class="pc">${pct(p.race.game)}</span></div>`).join('')}
${link ? '</a>' : '</div>'}`;
}
function scorersView() {
const rows = scorerRows();
const open = rows.filter((r) => r.s.phase !== 'final').sort((a, b) => b.p.proj.pts - a.p.proj.pts);
const done = rows.filter((r) => r.s.phase === 'final').sort((a, b) => b.p.now.pts - a.p.now.pts);
const anyLive = state.slate.some((g) => st(g).phase === 'live');
let html = `<div class="section-title" style="margin-top:4px">🏆 TOP SCORERS <span class="count">${anyLive ? 'updates live' : 'tonight'}</span></div>`;
html += progressHTML();
if (!rows.length) return html + (state.busy || state.progress ? '<div class="stack" style="margin-top:14px"><div class="skeleton"></div><div class="skeleton"></div></div>' : emptyHTML('No projections yet', 'Top scorers show once tonight\'s games load.'));
if (open.length) {
html += `<div class="card small" style="font-weight:700">Ranked by projected points for the whole game. It counts his minutes, role, matchup, pace, foul trouble, blowout risk, and how he scores by quarter, score and crunch time. ${anyLive ? 'Live games update with every refresh.' : ''}</div>`;
html += `<div class="stack">${open.slice(0, 15).map((r, i) => scorerCard(r, i + 1)).join('')}</div>`;
const races = state.slate.filter((g) => st(g).phase !== 'final').map((g) => { const pr = state.proj.get(g.id); return pr && pr.proj ? gameRaceCard(g, st(g), pr.proj) : ''; }).filter(Boolean);
if (races.length) html += `<div class="section-title">🥇 WHO LEADS EACH GAME <span class="count">chance to be the game's top scorer</span></div><div class="stack">${races.join('')}</div>`;
}
if (done.length) html += `<div class="section-title">✅ FINISHED GAMES <span class="count">actual points</span></div><div class="stack">${done.slice(0, 5).map((r, i) => scorerCard(r, i + 1)).join('')}</div>`;
return html;
}

// ---- combos
function combosView() {
// a leg the app itself marks as unsure (not checked in yet, foul trouble, status) is not offered inside a ticket: its chance assumes he plays
const picks = slatePicks().filter((k) => k.tier !== 'unsure');
const C = E.buildCombos(picks, { payout: settings.payout, max: 6 });
let html = `<div class="section-title" style="margin-top:4px">🎟️ 2-LEG EDGE TICKETS</div>
<div class="chips" role="group" aria-label="Payout">${[2, 2.5, 3, 4, 5].map((x) => `<button class="chip" data-act="payout" data-x="${x}" aria-pressed="${settings.payout === x}">PAYS ${x}x</button>`).join('')}</div>
<div class="card small" style="font-weight:700">Break-even win chance at ${settings.payout}x: <b class="led">${pct(C.breakEven)}</b>. Every ticket here beats it.</div>`;
html += progressHTML();
const ticket = (c, alt) => `<div class="ticket ${alt ? 'alt' : ''}">${c.legs.map((l) => `<div class="leg">${badge(l.team, 'sm')}<div><div>${esc(l.name)} · ${esc(l.label)}</div><small>${esc(l.game)} · now ${l.now}</small></div><span class="p">${pct(l.prob)}</span></div>`).join('')}
<div class="tfoot"><span>HITS ${pct(c.joint)}</span><span>${c.sameGame ? 'SAME GAME · ' : ''}+${Math.round(c.ev * 100)}% VALUE</span></div></div>`;
if (!C.repeats.length) return html + emptyHTML('No tickets beat the payout yet', 'Lower the payout or check back as games heat up.');
html += `<div class="section-title">1️⃣ EACH PLAYER ONCE</div><div class="stack">${C.once.map((c) => ticket(c, false)).join('')}</div>`;
html += `<div class="section-title">🔁 REPEATS ALLOWED</div><div class="stack">${C.repeats.map((c) => ticket(c, true)).join('')}</div>`;
return html;
}

// ---- accuracy report: the held-out test that shipped with this version, plus what this phone has graded since
function accuracyHTML() {
const a = ACCURACY;
if (!a) return '';
const CP = [['pre', 'Tip-off'], ['q1', 'End of Q1'], ['half', 'Halftime'], ['q3', 'End of Q3']];
const CP2 = a.before.late ? CP.concat([['late', '6 min left']]) : CP;
const row = (k, l) => `<tr><td>${l}</td><td>${a.before[k].pts.toFixed(2)}</td><td><b>${a.after[k].pts.toFixed(2)}</b></td><td>${Math.round(a.before[k].top3 * 100)}%</td><td><b>${Math.round(a.after[k].top3 * 100)}%</b></td></tr>`;
let mine = '';
const sum = patSum();
if (sum && sum.acc) {
const G = { pre: 'pre', q1: 's12', half: 's24', q3: 's36', late: 's42' };
const rows = CP2.map(([k, l]) => { const x = sum.acc[G[k]]; return x && x.g >= 1 && x.n >= 8 ? `<tr><td>${l}</td><td><b>${(x.pts / x.n).toFixed(2)}</b></td><td>${(x.reb / x.n).toFixed(2)}</td><td>${(x.ast / x.n).toFixed(2)}</td><td>${x.g ? Math.round((100 * x.top3) / x.g) + '%' : '–'}</td></tr>` : ''; }).join('');
if (rows) mine = `<div class="small" style="font-weight:800;margin:14px 0 4px">On this phone since ${new Date(PAT_FROM + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}: ${learnedGames()} games graded</div>
<table class="mtable acc2"><tr><th></th><th>PTS miss</th><th>REB</th><th>AST</th><th>Top scorer in our top 3</th></tr>${rows}</table>
<div class="small muted" style="margin-top:6px">Each finished game is replayed with the season stats this phone saved before that game tipped, so the app is graded on what it knew at the time. Everyone who played 10+ minutes counts, and a player the app had no number for counts as a full miss. A night with no saved copy from before tip-off is left out.</div>`;
}
return `<div class="section-title">🎯 ACCURACY REPORT</div>
<div class="card">
<div class="small muted" style="font-weight:700;margin-bottom:8px">${a.note}</div>
<table class="mtable acc2"><tr><th></th><th colspan="2">Average miss, points</th><th colspan="2">Top scorer in our top 3</th></tr>
<tr><th></th><th>before</th><th>now</th><th>before</th><th>now</th></tr>${CP2.map(([k, l]) => row(k, l)).join('')}</table>
<div class="small" style="font-weight:800;margin:14px 0 4px">Assists and threes: average miss</div>
<table class="mtable acc2"><tr><th></th><th colspan="2">Assists</th><th colspan="2">Threes</th></tr>
<tr><th></th><th>before</th><th>now</th><th>before</th><th>now</th></tr>${CP2.map(([k, l]) => `<tr><td>${l}</td><td>${a.before[k].ast.toFixed(2)}</td><td><b>${a.after[k].ast.toFixed(2)}</b></td><td>${a.before[k].fg3m.toFixed(2)}</td><td><b>${a.after[k].fg3m.toFixed(2)}</b></td></tr>`).join('')}</table>
${a.before.pre.total != null ? `<div class="small" style="font-weight:800;margin:14px 0 4px">Final score of the game (both teams added): average miss</div>
<table class="mtable acc2"><tr><th></th><th>before</th><th>now</th></tr>${CP2.map(([k, l]) => `<tr><td>${l}</td><td>${a.before[k].total.toFixed(1)}</td><td><b>${a.after[k].total.toFixed(1)}</b></td></tr>`).join('')}</table>` : ''}
<div class="small" style="font-weight:800;margin:14px 0 4px">When the app says a chance, how often it happens</div>
<table class="mtable acc2"><tr><th>App said</th><th>before: it happened</th><th>now: it happened</th></tr>${a.calib.map((c) => `<tr><td>${c.said}</td><td>${c.before}</td><td><b>${c.now}</b></td></tr>`).join('')}</table>
<ul class="why" style="margin-top:10px">${a.findings.map((t) => `<li class="info"><span aria-hidden="true">📌</span><span>${esc(t)}</span></li>`).join('')}</ul>
${mine || `<p class="small" style="font-weight:700;margin:10px 0 0">📚 Each morning the app grades last night: every finished game is re-projected from tip-off and every 6 game minutes after, with the lineup posted that night, compared with the final box, and the misses tune the weights (minutes, who starts, hot starts, lucky makes, lopsided scores, fouls). The running numbers for this phone show here after the first graded night.</p>`}
</div>`;
}
// ---- settings
function settingsView() {
const chipRow = (act, vals, cur, fmt) => `<div class="chips">${vals.map((v) => `<button class="chip" data-act="${act}" data-x="${v}" aria-pressed="${cur === v}">${fmt(v)}</button>`).join('')}</div>`;
return `<div class="section-title" style="margin-top:4px">⚙️ SETTINGS</div>
<div class="card">
<div class="setting"><div><b>Background refresh</b><small>Live games update on every new play (the app checks every 5 seconds). This sets how often everything else refreshes: lineups, injuries, lines, and live games you are not looking at.</small></div></div>
${chipRow('refresh', [15, 20, 30, 60], settings.refresh, (v) => `${v}s`)}
<div class="setting"><div><b>Simulation depth</b><small>More sims = smoother percentages</small></div></div>
${chipRow('sims', [1000, 2000, 4000], settings.sims, (v) => (v === 1000 ? 'FAST' : v === 2000 ? 'SHARP' : 'MAX'))}
<div class="setting"><div><b>Skip blowouts</b><small>Hide games up 15+, or 12+ after halftime, from picks. Blowout-proof players stay.</small></div>
<label class="toggle"><input type="checkbox" data-act="skipblow" ${settings.skipBlowouts ? 'checked' : ''} aria-label="Skip blowouts"><span></span></label></div>
<div class="setting"><div><b>Pick confidence floor</b><small>Minimum model chance for book-line edges</small></div></div>
${chipRow('minp', [0.55, 0.6, 0.65, 0.7], settings.minP, (v) => pct(v))}
</div>
${ledgerHTML()}
${accuracyHTML()}
<div class="section-title">📲 APP</div>
<div class="card stack">
${state.installEvt ? `<button class="btn" data-act="install">${ICON.install} INSTALL ON THIS PHONE</button>` : '<div class="small muted" style="font-weight:700">To install: Chrome menu ⋮ → <b>Install app</b> (or Add to Home screen).</div>'}
<button class="btn ghost" data-act="clear">CLEAR SAVED DATA</button>
<div class="small" style="font-weight:800">Version ${APP_VERSION}</div>
<div class="small muted" style="font-weight:600">Data: DataBallr (live games, play-by-play with shot zones, player season stats, player game logs with tracking, team stats, game lines from ~13 books, injuries, props) plus ESPN's injury report and lineups. If DataBallr stops answering, scores and play-by-play switch to ESPN's free feed by themselves so live projections keep running.</div>
</div>`;
}

// ------------------------------------------------------------------ events
document.addEventListener('click', async (e) => {
const el = e.target.closest('[data-act]');
if (!el) return;
const act = el.dataset.act;
if (act === 'player') { e.preventDefault(); openSheet(+el.dataset.g, +el.dataset.p); }
else if (act === 'close') closeSheet();
else if (act === 'ov') {
setOverride(+el.dataset.p, el.dataset.s === 'clear' ? null : el.dataset.s);
toast(el.dataset.s === 'out' ? 'Marked out — minutes shared with teammates' : 'Got it — counted as playing');
if (el.dataset.s === 'out') closeSheet();
const g = state.slate.find((x) => x.id === +el.dataset.g);
if (g) { try { await projectGame(g); } catch (e) { console.warn('project', g.id, e); } render(); }
}
else if (act === 'team') { state.team[+el.dataset.g] = el.dataset.t; render(); }
else if (act === 'filter') { state.pickFilter = el.dataset.f; render(); }
else if (act === 'payout') { settings.payout = +el.dataset.x; saveSettings(); render(); }
else if (act === 'refresh') { settings.refresh = +el.dataset.x; saveSettings(); restartTimer(); render(); }
else if (act === 'sims') { settings.sims = +el.dataset.x; saveSettings(); state.proj.clear(); render(); refreshAll({ force: true }); }
else if (act === 'minp') { settings.minP = +el.dataset.x; saveSettings(); state.proj.clear(); render(); refreshAll({ force: true }); }
else if (act === 'day') {
state.dayOffset += +el.dataset.d; state.date = DB.etDate(state.dayOffset);
state.slate = []; state.proj.clear(); render(); refreshAll({ force: true });
} else if (act === 'refresh-now') refreshAll({ force: true });
else if (act === 'install' && state.installEvt) { state.installEvt.prompt(); state.installEvt = null; render(); }
else if (act === 'clear') { DB.clearCache(); state.logs.clear(); state.logTeams.clear(); state.priors = null; state.proj.clear(); toast('Saved data cleared'); refreshAll({ force: true }); }
});
document.addEventListener('change', (e) => {
if (e.target.matches('[data-act="skipblow"]')) { settings.skipBlowouts = e.target.checked; saveSettings(); render(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('toggle', (e) => {
const d = e.target;
if (!d || !d.matches || !d.matches('details[data-key]')) return;
if (d.open) state.openDetails.add(d.dataset.key); else state.openDetails.delete(d.dataset.key);
}, true);
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installEvt = e; render(true); });

// ------------------------------------------------------------------ live loop
// Live games are not on a timer: every 5 seconds the app only asks "did anything happen?" (one small scoreboard
// read). A game whose score or clock moved gets its new play-by-play and a new projection right away. The game you
// are looking at always goes first; the others follow, each at most once per refresh setting. Everything that is
// not live (lineups, injuries, lines) keeps the slower refresh setting.
const WATCH_MS = 5000;
const sigOf = (g) => `${g.status_state}|${g.period}|${g.time}|${g.visitor_team_score}|${g.home_team_score}`;
let timer;
async function watchTick() {
if (document.hidden || state.busy) return;
const r = route();
const due = Date.now() - state.lastFull >= settings.refresh * 1000;
let rows;
try { rows = await DB.slate(state.date, 2500); } catch { return; }
if (state.busy) return;
const changed = [];
for (const g of rows) {
const sg = sigOf(g), was = state.sig.get(g.id);
state.sig.set(g.id, sg);
const ph = st(g).phase;
if (ph !== 'live' && !(ph === 'final' && was && was !== sg)) continue;
const viewing = r.name === 'game' && +r.id === g.id;
const waited = Date.now() - (state.lastGame.get(g.id) || 0);
if (was !== sg && (viewing || waited >= settings.refresh * 1000)) changed.push(g);
else if (waited >= 60000) changed.push(g); // quiet stretch (timeouts, reviews): still look once a minute
}
if (due) {
state.lastFull = Date.now();
const live = rows.filter((g) => st(g).phase === 'live');
const list = r.name === 'game' ? rows.filter((g) => g.id === +r.id) : rows.filter((g) => st(g).phase !== 'final' || !state.proj.has(g.id) || (ledgerOpen(g.id) && (state.gradeTries.get(g.id) || 0) < 6)).sort((a) => (live.includes(a) ? -1 : 1));
for (const g of list) state.lastGame.set(g.id, Date.now());
return refreshAll({ games: list });
}
if (changed.length) {
changed.sort((a) => (r.name === 'game' && +r.id === a.id ? -1 : 1));
for (const g of changed) state.lastGame.set(g.id, Date.now());
return refreshAll({ games: changed });
}
state.slate = rows; state.lastUpdate = Date.now();
if (state.moves.size) render(true);
}
function restartTimer() {
clearInterval(timer);
timer = setInterval(watchTick, WATCH_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });

// ------------------------------------------------------------------ boot
$('#mascot').innerHTML = MASCOT;
document.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = ICON[n.dataset.icon] + n.innerHTML; });
$('#refreshBtn').addEventListener('click', () => refreshAll({ force: true }));
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
render();
(async () => {
// Just after midnight ET, late games from last night are still on. Open on those instead of tonight's slate.
try {
const hr = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
if (state.dayOffset === 0 && hr < 5) {
const y = await DB.slate(DB.etDate(-1));
const on = y.filter((g) => st(g).phase === 'live').length;
if (on && state.dayOffset === 0) { state.dayOffset = -1; state.date = DB.etDate(-1); toast(`${on} game${on > 1 ? 's' : ''} from last night still going`); }
}
} catch { /* open on today */ }
refreshAll({ force: true });
restartTimer();
})();
})();
