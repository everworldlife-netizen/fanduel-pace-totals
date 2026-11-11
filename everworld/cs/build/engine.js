/*
* Courtside Arcade — live NBA projection engine (runs in the browser and in Node tests).
*
* Input is DataBallr data only: live games, play-by-play, season player stats, player game logs
* (tracking: usage, potential assists, catch-and-shoot / pull-up threes, time of possession),
* team stats (pace, ratings, shot zones, rebounding), game lines from ~13 books, injuries, props.
*
* Model (per player, rest of game):
* minutes = season quarter-minute pattern + tonight's share, foul trouble, and the coach's
* blowout habit learned from this season's logs (simulated margin path)
* usage = (FGA + .44 FTA + TOV) share of team plays on court: this season blended with last
* season and tonight (80/20), renormalized so each team's floor usage sums to 100%
* shots = remaining team possessions x on-court share x usage, split by shot mix
* makes = shooting %s shrunk toward last season / league, adjusted for opponent defense,
* with hot/cold night variance
* reb/ast = per-minute rates (season + last season + tonight)
* Every team's minutes are forced to fill 5 x time left so team totals stay coherent.
*/
(function (root, factory) {
const api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Engine = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const LEAGUE = { p2: 0.545, p3: 0.36, ft: 0.78, ortg: 114.5, pace: 99, usg: 0.2 };
// Tunables (chosen by scripts/backtest.js; see README "Accuracy").
const TUNE = {
tonightW: 0.1, // weight on tonight's rates (Nov 8 backtest: 0.1 beats 0.2)
tonightRamp: 15, // minutes played before tonight's weight is fully on
usgPriorK: 80, // on-court team plays before season usage outweighs last season
p3K: 120, p2K: 200, ftK: 60, // shooting % shrink (attempts of prior)
paceK: 30, // minutes before live pace outweighs season pace
qShareTonight: 0.4, // weight of tonight's share inside the current quarter
minShock: 0.4, // per-sim minutes noise (live backtest: best calibration)
usgTarget: 0.2, // average on-floor usage after renormalization
absentMinMpg: 20, // a 20+ mpg player who missed the last game is presumed out (backtest)
b2bRestAge: 0, // on a back-to-back 2nd night, presume starters this old sit (0 = flag only)
liveOutMin: 10, // live: a 24+ mpg player not checked in by this game minute is out
closeQ4: true, // quarter-minute pattern from close games (blowouts are simulated separately)
drift: 2, // weight of team-strength drift in the margin path (backtest)
homeAdv: 2.5, // home-court points per 48
marginK: 2, // live margin random walk: sd per sqrt(minute) (Nov 8 backtest)
preQ3Sd: 16, // pregame sd of the margin at the end of Q3
q4Pace: 0.94, // 4th quarters run ~6% fewer possessions per minute (backtest)
shotEff: 0.93, // early-season makes vs last season's rates (Nov 8 backtest, 77 games)
closerQ4: 0, // when the simulated game stays within 8, starters play at least this many Q4 minutes
rot: 1, // live minutes from the coach's rotation map (stints from this season's games)
rotK: 2, // pseudo-games of the plain map when conditioning on "on court / sitting right now"
rotTonight: 0.25, // exponent on tonight's rotation share so far vs the map (fit on 17k live moments)
rotTonightK: 6, // minutes of shrink on that share
benchM50: 7, // sitting through this many of his usual on-court minutes = 50% he's done for the night
benchS: 1.2, // steepness of that curve (Nov 8 backtest)
// foul trouble by foul count: share of his usual minutes he plays until the coach's foul-rest
// point, [if on the floor now, if already sitting]
// (fit on this season: coaches play through 4 fouls in Q3; 2/3/5 fouls cost part of the rest)
foulRest: { 2: [0.7, 0.4], 3: [0.7, 0.4], 4: [1, 1], 5: [0.7, 0.4] },
foulAfter: 0.95, // with 4+ fouls, share of usual minutes after that point (coaches stay careful)
envW: 0, // reb/ast follow tonight's environment (rebound chances, team assists): no gain yet on the backtest
envK: 30, // minutes before tonight's environment outweighs the season's
usgShock: 0.3, // per-sim sd of a player's usage tonight (relative; fixes overconfident points ladders)
rebShock: 0.2, // per-sim sd of his rebound rate tonight (matchups, size, who's guarding whom)
astShock: 0, // per-sim sd of his assist rate tonight
fillByMin: 2, // spread unclaimed team minutes over tonight's rotation (2 = whole roster at once)
fillPow: 0, // ...weighted by (projected minutes)^fillPow x room left (0 = room left: best on backtest)
// DataBallr extras (Nov 7 update; set by judgment, not yet backtested — 0 turns each one off)
dbTeamW: 0.5, // weight of DataBallr season team stats (pace, ratings, defense) vs our recent-game logs
mktTotalW: 0.35, // weight of the books' game total (as a tempo signal) in the pace prior
mktSpreadW: 0.5, // weight of the books' spread in the margin path (blowout / starters-sit scenarios)
glUsgW: 0.3, // weight of DataBallr game-log usage (last games) in the usage prior
// Context layer (Nov 8). Values come from the backtest on finished games; 0 (or 1 for minDecay) turns one off.
blowAhead: 0, // live: minutes of margin drift still ahead when judging garbage time (0 = margin at end of Q3)
zoneW: 0, // opponent's allowed FG% by zone (rim / mid-range) against this player's own shot mix
zoneK: 60, // shot attempts of league average mixed into each opponent zone
usgRedistPow: 0, // when the floor is short of usage (teammates out), higher-usage players absorb more of it
fillPos: 0.1, // freed minutes go first to the position group of the missing players
minDecay: 0.85, // recency weight per game back for minutes and quarter pattern (1 = every game equal)
b2bMin: 0.03, // 2nd night of a back-to-back: starters' minutes trim
b2bEff: 0, // 2nd night of a back-to-back: shooting trim
// Blowout-proof players (Nov 8): each player's own 4th-quarter minutes in lopsided games vs close ones.
blowPlayer: 1, // 1 = use each player's own blowout habit (shrunk toward his coach's), 0 = coach habit only
blowPK: 4, // pseudo-games of the coach's habit mixed into a player's own blowout record
sitK: 150, sitPriorW: 0.5, sitFadeK: 3, sitStreakK: 3, sitQW: 1, sitStateW: 1, sitHomeW: 0, sitRestW: 0, sitStarW: 0.5, sitFadeW: 0, sitStreakW: 0.5, // situational scoring tendencies (minutes of shrinkage, weights)
patW: 1, // learned game patterns: 1 = apply the corrections graded from finished games, 0 = off
patCap: 0.3, // most a learned pattern can move a remaining projection (±30%)
patLam: 32, // ridge shrink when solving the patterns (Nov 9 backtest: 32 lowers misses at every checkpoint, both folds)
immuneLead: 0.6, // blowout-proof: keeps at least this share of his normal Q4 minutes when his team is way ahead
// Live role engine (Nov 9): learned corrections to remaining minutes and remaining rates, by stage of the game.
patCapMin: 0.6, // most the learned layer can move a player's remaining minutes (±60%: blowouts, never checked in)
shiftCenter: 1, // usage shifts are shared inside the team: one player's extra shots come off his teammates' (1 = fully)
liveConfirmedOut: 1, // live: with confirmed lineups, a player left off tonight's active list is out (was pregame only)
refill: 1, // minutes the learned layer takes from one player go back to his teammates when the game is close (lopsided: the deep bench gets them)
landOn: 1, // show the number he is most likely to land on (see LAND) instead of the plain average of the simulations
otSim: 1, // close games sometimes go to overtime: those simulations get the extra five minutes (0 = off)
tdOn: 1, // top-down team check feeds the learned layer (0 = off)
otherPM: 0.4, // points per minute for minutes played by players we don't track (deep bench), so team totals stay whole
// v15 (Nov 11): tonight's lineup inside the number. Each switch was tested on games the lessons never saw (see NOTES.md).
actDeep: 1, // posted active list: project deep-bench players too (they play on short-handed nights)
actNew: 1, actNewMpg: 12, // posted active list: project players back from a layoff from their season line (non-starters need this many minutes a game)
patCapMinUp: 1.5, // most the learned layer can raise remaining minutes (0 = same as patCapMin): a reserve who starts can more than double
patInterp: 1, // between two learning stages, blend their lessons by game minute (0 = nearest stage)
sitPre: 0, // situational scoring: a basket counts under the score before it (0 = the old filing, after it)
patYCap: 0, // learning target: 1 = the old one-sided cap on big finishes, 0 = the plain miss
repGroup: 1, // learn "before lineups are posted" as its own stage (1) or share the tip-off lessons (0)
patLamLineup: 0.1, // pull toward "no effect" for the lineup inputs, relative to the other inputs (1 = same; lower lets rare, strong signals through)
condMin: 1, // before tip-off, player minutes stay "if he plays" numbers and the team total is scaled to five players' worth instead
teamCal: 0, // apply the learned team check (TEAM_PRIOR) to team totals
// v16: how crowded tonight's rotation is, and which side is expected to win big, as learned inputs
loadIn: 1, loadMid: 0.06, // team load = the usual minutes of everyone available tonight, added up, vs the 240 a team can play; loadMid = a typical night
favIn: 1, // expected winning margin by role (starters of a team expected to win or lose big, bench of a team expected to lose big)
loadStats: 0, // 0 = the team load only teaches minutes (who plays), 1 = it also teaches points, rebounds, assists and threes
ctxUntil: 33, // game minute from which the team load and expected margin sit out (by then the live score and rotation say more)
};
const addDaysStr = (s, n) => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const BENCH_RATE = { pts: 0.4, reb: 0.17, ast: 0.09, fg3m: 0.04 };
const VAR_K = { reb: 1.5, ast: 1.6 }; // overridable via TUNE.varReb / TUNE.varAst

// ---------------------------------------------------------------- RNG + samplers
function mulberry32(seed) {
let a = seed >>> 0;
return function () {
a = (a + 0x6d2b79f5) >>> 0;
let t = a;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}

function makeSampler(seed) {
const u = mulberry32(seed || 1);
let spare = null;
function normal(mu = 0, sd = 1) {
if (spare !== null) { const s = spare; spare = null; return mu + sd * s; }
let x, y, r;
do { x = u() * 2 - 1; y = u() * 2 - 1; r = x * x + y * y; } while (r === 0 || r >= 1);
const f = Math.sqrt((-2 * Math.log(r)) / r);
spare = y * f;
return mu + sd * x * f;
}
function poisson(lam) {
if (!(lam > 0)) return 0;
if (lam > 30) return Math.max(0, Math.round(normal(lam, Math.sqrt(lam))));
const L = Math.exp(-lam);
let k = 0, p = 1;
do { k++; p *= u(); } while (p > L);
return k - 1;
}
function binomial(n, p) {
if (n <= 0 || p <= 0) return 0;
if (p >= 1) return n;
if (n > 60) return Math.min(n, Math.max(0, Math.round(normal(n * p, Math.sqrt(n * p * (1 - p))))));
let k = 0;
for (let i = 0; i < n; i++) if (u() < p) k++;
return k;
}
function gamma(shape, scale) {
if (shape < 1) return gamma(shape + 1, scale) * Math.pow(u(), 1 / shape);
const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
for (;;) {
let x, v;
do { x = normal(); v = 1 + c * x; } while (v <= 0);
v = v * v * v;
const uu = u();
if (uu < 1 - 0.0331 * x * x * x * x || Math.log(uu) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
}
}
// negative binomial with given mean and variance = k * mean (gamma-Poisson mixture)
function negbin(mean, k) {
if (!(mean > 0)) return 0;
return poisson(gamma(mean / (k - 1), k - 1));
}
return { u, normal, poisson, binomial, gamma, negbin };
}

// ---------------------------------------------------------------- helpers
function clockSec(clock) {
if (clock == null) return 0;
const s = String(clock).trim();
if (!s) return 0;
if (s.includes(':')) {
const [m, sec] = s.split(':');
return (m ? parseFloat(m) : 0) * 60 + (parseFloat(sec) || 0);
}
const f = parseFloat(s);
return Number.isFinite(f) ? f : 0;
}
const periodLen = (p) => (p <= 4 ? 720 : 300);
function elapsedSec(period, clock) {
let base = 0;
for (let q = 1; q < period; q++) base += periodLen(q);
return base + periodLen(period) - clockSec(clock);
}
function norm(name) {
return String(name || '')
.normalize('NFKD').replace(/[̀-ͯ]/g, '')
.toLowerCase().replace(/[.'\-]/g, '')
.replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
.replace(/\s+/g, ' ').trim();
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
/** Minutes on court between game minutes a and b, from stints [[in, out], ...]. */
function onBetween(stints, a, b) {
let s = 0;
for (const [x, y] of stints || []) s += Math.max(0, Math.min(y, b) - Math.max(x, a));
return s;
}
/** Game minute (0–48) → "6:00 Q2". */
function clockLabel(m) {
const q = Math.min(4, Math.floor(m / 12) + 1);
const left = Math.max(0, q * 12 - m);
const mm = Math.floor(left + 1e-6), ss = Math.round((left - mm) * 60);
return `${mm}:${String(ss === 60 ? 0 : ss).padStart(2, '0')} Q${q}`;
}
const fmtMin = (m) => { const mm = Math.floor(m), ss = Math.round((m - mm) * 60); return `${mm}:${String(ss === 60 ? 59 : ss).padStart(2, '0')}`; };
function onAt(stints, t) {
for (const [x, y] of stints || []) if (t >= x && t < y) return true;
return false;
}
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** Parse a DataBallr live-games row into a clean game state. */
function gameState(g) {
const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
const vs = g.visitor_team_score || 0, hs = g.home_team_score || 0;
const state = String(g.status_state || g.display_status || '').toLowerCase();
let period = g.period || 0;
const t = String(g.time || '').trim();
let clock = '12:00';
let phase = 'pre';
if (state === 'final' || (!g.status_state && (/final/i.test(t) || /final/i.test(g.display_status || '')))) { phase = 'final'; clock = '0:00'; period = Math.max(period, 4); }
else if (period > 0) {
phase = 'live';
if (/half/i.test(t)) { period = 2; clock = '0:00'; }
else if (/^end/i.test(t)) clock = '0:00';
else if (t) clock = t.split(/\s+/).pop();
}
const el = phase === 'pre' ? 0 : elapsedSec(period, clock) / 60;
const regLeft = Math.max(48 - el, 0);
const left = phase === 'final' ? 0 : period > 4 ? clockSec(clock) / 60 : regLeft;
const label = phase === 'pre' ? (g.display_status || '') : phase === 'final' ? 'FINAL' : (/half/i.test(t) ? 'HALF' : t);
return {
id: g.id, v, h, vs, hs, period, clock, phase, elapsed: el, left, label,
margin: Math.abs(vs - hs), isClutch: !!g.is_clutch, tip: g.datetime,
vName: g.visitor_team.full_name, hName: g.home_team.full_name,
lines: {
v: [g.visitor_q1, g.visitor_q2, g.visitor_q3, g.visitor_q4],
h: [g.home_q1, g.home_q2, g.home_q3, g.home_q4],
},
};
}

/** Blowout rule the user bets by: 15+ any time, or 12+ in the second half. */
function isBlowout(st, any = 15, second = 12) {
if (st.phase === 'pre') return false;
return st.margin >= any || (st.period >= 3 && st.margin >= second);
}

// ---------------------------------------------------------------- box score from play-by-play
const SHOT = /^(.*?) (makes|misses) /;
const BLOCK = /^.*? blocks (.*?)'s /;
const REB = /^(.*?) (offensive|defensive) rebound/;
const SUB = /^(.*?) enters the game for (.*)$/;

/** Shot zone from the play text: rim (layups, dunks, tips, 0-4 ft), mid (other 2s), three. */
function shotZone(txt, three) {
if (three) return 'three';
const d = /(\d+)-foot/.exec(txt);
if (/layup|dunk|tip|alley|putback|finger roll|hook/i.test(txt) && (!d || +d[1] <= 6)) return 'rim';
if (d && +d[1] <= 4) return 'rim';
return 'mid';
}

function boxFromPlays(plays, curPeriod, curClock) {
const P = new Map();
const T = {};
const team = (abbr) => (T[abbr] = T[abbr] || { fga: 0, fta: 0, oreb: 0, dreb: 0, tov: 0, pts: 0, fg3a: 0, fg3m: 0, fgm: 0, ast: 0 });
const pl = (id) => {
if (!P.has(id)) P.set(id, { pid: id, name: '', teams: {}, pts: 0, reb: 0, oreb: 0, ast: 0, fg3m: 0, fg3a: 0, fga: 0, fgm: 0, fta: 0, ftm: 0, tov: 0, pf: 0, tech: 0, ejected: false, q: {}, st: [], pfAt: [], z: {} });
return P.get(id);
};
const tag = (rec, abbr) => { if (abbr) rec.teams[abbr] = (rec.teams[abbr] || 0) + 1; };
const byPer = new Map();
for (const p of plays || []) {
if (!byPer.has(p.period)) byPer.set(p.period, []);
byPer.get(p.period).push(p);
const txt = String(p.text || '').trim();
const parts = p.participants || [];
const typ = p.type || '';
const abbr = p.team && p.team.abbreviation;
if (typ === 'Substitution') {
const m = SUB.exec(txt);
if (m && parts.length >= 2) {
const a = pl(parts[0]), b = pl(parts[1]);
a.name = m[1]; b.name = m[2]; tag(a, abbr); tag(b, abbr);
}
continue;
}
if (/ejected/i.test(txt) && parts.length) pl(parts[0]).ejected = true;
if (p.shooting_play && parts.length) {
const a = pl(parts[0]);
const m = SHOT.exec(txt);
if (m) a.name = a.name || m[1];
else { const mb = BLOCK.exec(txt); if (mb) a.name = a.name || mb[1]; }
tag(a, abbr);
const made = (' ' + txt + ' ').includes(' makes ');
const three = txt.includes('three point');
if (txt.includes('free throw')) {
a.fta++; if (made) a.ftm++;
if (abbr) team(abbr).fta++;
} else {
a.fga++; if (made) a.fgm++;
if (abbr) team(abbr).fga++;
const zn = shotZone(txt, three);
const zz = (a.z[zn] = a.z[zn] || [0, 0]); zz[0]++; if (made) zz[1]++;
if (three) { a.fg3a++; if (abbr) team(abbr).fg3a++; }
}
if (made) {
const sv = p.score_value || 0;
a.pts += sv;
if (abbr) team(abbr).pts += sv;
if (abbr && !txt.includes('free throw')) team(abbr).fgm++;
if (three) { a.fg3m++; if (abbr) team(abbr).fg3m++; }
const am = /\((.*?) assists\)/.exec(txt);
if (am && parts.length >= 2) { const b = pl(parts[1]); b.ast++; b.name = b.name || am[1]; tag(b, abbr); if (abbr) team(abbr).ast++; }
}
continue;
}
if (typ.includes('Rebound')) {
if (abbr) team(abbr)[typ.includes('Offensive') ? 'oreb' : 'dreb']++;
if (parts.length) {
const m = REB.exec(txt);
if (m) { const a = pl(parts[0]); a.reb++; if (typ.includes('Offensive')) a.oreb++; a.name = a.name || m[1]; tag(a, abbr); }
}
continue;
}
if (typ.includes('Turnover')) {
if (abbr) team(abbr).tov++;
if (parts.length) pl(parts[0]).tov++;
continue;
}
if (typ.includes('Foul') && parts.length) {
if (typ.includes('Technical') || /technical/i.test(txt)) { if (!/3-seconds/i.test(txt)) pl(parts[0]).tech++; }
else { const a = pl(parts[0]); a.pf++; a.pfAt.push(+(elapsedSec(p.period, p.clock) / 60).toFixed(2)); }
}
}
const teamOf = (rec) => {
let best = null, n = -1;
for (const [k, c] of Object.entries(rec.teams)) if (c > n) { best = k; n = c; }
return best;
};
// minutes by quarter: rebuild lineups from substitutions + activity
let prevEnd = new Set();
const onNow = new Set();
const pers = [...byPer.keys()].sort((a, b) => a - b);
for (const per of pers) {
// feeds sometimes list a period's plays slightly out of clock order: replay them by clock (stable)
const evs = byPer.get(per).map((p, i) => [p, i, clockSec(p.clock)]).sort((a, b) => b[2] - a[2] || a[1] - b[1]).map((x) => x[0]);
const entered = new Set();
const seen = [];
for (const p of evs) {
const parts = p.participants || [];
if (p.type === 'Substitution' && parts.length >= 2) {
if (!entered.has(parts[1]) && !seen.includes(parts[1])) seen.push(parts[1]);
entered.add(parts[0]);
} else {
for (const id of parts.slice(0, 2)) if (!entered.has(id) && !seen.includes(id)) seen.push(id);
}
}
const byTeam = {};
for (const id of seen) {
const rec = P.get(id); if (!rec) continue;
const t = teamOf(rec); if (!t) continue;
byTeam[t] = byTeam[t] || [];
if (byTeam[t].length < 5) byTeam[t].push(id);
}
for (const id of prevEnd) {
const rec = P.get(id); if (!rec) continue;
const t = teamOf(rec); if (!t) continue;
byTeam[t] = byTeam[t] || [];
if (byTeam[t].length < 5 && !entered.has(id) && !byTeam[t].includes(id)) byTeam[t].push(id);
}
const on = new Map();
for (const ids of Object.values(byTeam)) for (const id of ids) on.set(id, periodLen(per));
// stints in elapsed game minutes: [checked in, checked out] (from/to are game-clock seconds left)
const stint = (rec, from, to) => { if (from > to) rec.st.push([+(elapsedSec(per, from) / 60).toFixed(2), +(elapsedSec(per, to) / 60).toFixed(2)]); };
for (const p of evs) {
const parts = p.participants || [];
if (p.type === 'Substitution' && parts.length >= 2) {
const c = clockSec(p.clock);
if (on.has(parts[1])) { const rec = pl(parts[1]); rec.q[per] = (rec.q[per] || 0) + Math.max(on.get(parts[1]) - c, 0); stint(rec, on.get(parts[1]), c); on.delete(parts[1]); }
on.set(parts[0], c);
}
}
const endC = per === curPeriod ? clockSec(curClock) : 0;
for (const [id, c] of on) { const rec = pl(id); rec.q[per] = (rec.q[per] || 0) + Math.max(c - endC, 0); stint(rec, c, endC); }
prevEnd = new Set(on.keys());
if (per === curPeriod) for (const id of on.keys()) onNow.add(id);
}
const players = {};
for (const rec of P.values()) {
const t = teamOf(rec);
if (!rec.name || !t) continue;
const qmin = {};
let sec = 0;
for (const [q, s] of Object.entries(rec.q)) { qmin[q] = s / 60; sec += s; }
// merge stints that continue across a quarter break
const stints = [];
for (const [a, b] of rec.st.sort((x, y) => x[0] - y[0])) {
const lastS = stints[stints.length - 1];
if (lastS && a - lastS[1] < 0.02) lastS[1] = Math.max(lastS[1], b); else stints.push([a, b]);
}
players[rec.pid] = { ...rec, team: t, min: sec / 60, qmin, on: onNow.has(rec.pid), stints };
delete players[rec.pid].teams;
delete players[rec.pid].q;
delete players[rec.pid].st;
}
for (const abbr of Object.keys(T)) { const t = T[abbr]; t.poss = t.fga + 0.44 * t.fta - t.oreb + t.tov; }
return { players, teams: T };
}

/** Every made basket and free throw in order: [elapsed minutes, team, points, scorer id]. */
function scoringEvents(plays) {
const out = [];
for (const p of plays || []) {
if (!p.shooting_play) continue;
const txt = String(p.text || '');
if (!(' ' + txt + ' ').includes(' makes ')) continue;
const parts = p.participants || [];
const abbr = p.team && p.team.abbreviation;
const sv = p.score_value || 0;
if (!sv || !abbr) continue;
out.push([+(elapsedSec(p.period, p.clock) / 60).toFixed(2), abbr, sv, parts[0] != null ? +parts[0] : null]);
}
return out.sort((a, b) => a[0] - b[0]);
}

/** Turn a finished game's plays into a compact log entry (what we cache on the phone). */
function logEntry(game, plays) {
const st = gameState(game);
const { players, teams } = boxFromPlays(plays, st.period, '0:00');
const rows = {};
for (const [pid, r] of Object.entries(players)) {
if (r.min <= 0) continue;
rows[pid] = { name: r.name, team: r.team, min: +r.min.toFixed(2), qmin: Object.fromEntries(Object.entries(r.qmin).map(([k, v]) => [k, +v.toFixed(2)])),
pts: r.pts, reb: r.reb, ast: r.ast, fg3m: r.fg3m, fg3a: r.fg3a, fga: r.fga, fta: r.fta, ftm: r.ftm, tov: r.tov, pf: r.pf,
oreb: r.oreb, fgm: r.fgm, st: r.stints, pfAt: r.pfAt, z: r.z && Object.keys(r.z).length ? r.z : undefined };
}
// scoring timeline (who scored when) for the situational scoring tendencies
const sc = scoringEvents(plays).map((e) => [e[0], e[1] === st.v ? 0 : 1, e[2], e[3]]);
return {
id: st.id, date: game.date, v: st.v, h: st.h, len: 48 + 5 * Math.max(0, st.period - 4),
margin: { [st.v]: st.vs - st.hs, [st.h]: st.hs - st.vs },
teams, rows, sc,
};
}

// ---------------------------------------------------------------- priors (DataBallr season stats)
/** Keep only what the model needs from /v1/nba/players/stats (≈5 MB → ≈100 KB). */
const num = (x) => (x == null || x === '' || !Number.isFinite(+x) ? null : +x);
/** The DataBallr profile numbers shown on the player sheet (a small slice of the 454 fields). */
function profileOf(r) {
return {
ts: num(r.TS_pct), sq: num(r.adj_shot_quality), rim: num(r.RimFGPerc), smid: num(r.ShortMidFGPerc), lmid: num(r.LongMidFGPerc),
potAst100: num(r['PASSING_Potential Assists/100']), potAstMin: num(r.PASSING_POT_AST_PER_MIN), onBall: num(r['PASSING_on-ball-time%']),
stl100: num(r.Steals_100), blk: num(r.Blocks_PG), orb: num(r.OffFGReboundPct), drb: num(r.DefFGReboundPct),
onoff: num(r.netrtg_on_off), pts75: num(r.Pts75), creation: num(r.creation_TSA),
dRim: num(r.d_AtRimFGA_PerGame), dSmid: num(r.d_ShortMidRangeFGA_PerGame), dLmid: num(r.d_LongMidRangeFGA_PerGame), d3: num(r.d_FG3A_PerGame),
};
}

function slimStats(rows) {
const out = {};
for (const r of rows || []) {
const gp = r.GamesPlayed || 0, mpg = r.MPG || 0;
if (!gp || !mpg || !r.Name) continue;
const offPoss = r.OffPoss || 0;
const fg3a = ((r['3PA_100'] || 0) * offPoss) / 100;
out[norm(r.Name)] = {
name: r.Name, team: r.TeamAbbreviation, gp, mpg,
pts: (r.basic_PPG || 0) / mpg, reb: (r.basic_REB || 0) / mpg, ast: (r.basic_APG || 0) / mpg,
fg3m: (fg3a * (r['3P_PERC'] || 0)) / gp / mpg,
fg3a: fg3a, p3: r['3P_PERC'], p2: r['2P_PERC'], ft: r.FT_PERC,
tsa100: r.TSA100, tovpg: r.basic_TOVPG, offPoss, r3: r['3PR'], ftr: r.FTR, age: r.Age,
nba_id: r.nba_id || r.RowId || null, pos: r.Pos2 || null, arch: r['Offensive Archetype'] || null,
prof: profileOf(r),
};
}
return out;
}

/** Blend this season's DataBallr line (once it has games) with last season's. */
function mergePrior(last, cur) {
if (!cur || cur.gp < 3) return last || null;
if (!last) return cur;
const w = cur.gp / (cur.gp + 12);
const mix = (k) => (cur[k] == null ? last[k] : last[k] == null ? cur[k] : w * cur[k] + (1 - w) * last[k]);
const out = { ...last };
for (const k of ['pts', 'reb', 'ast', 'fg3m', 'mpg', 'p3', 'p2', 'ft', 'tsa100', 'r3', 'ftr']) out[k] = mix(k);
out.fg3a = (cur.fg3a || 0) + (last.fg3a || 0);
// turnovers per own possession, blended, then re-expressed on last season's scale
const tovRate = (x) => (x && x.offPoss && x.gp ? (x.tovpg || 0) / (x.offPoss / x.gp) : null);
const tr = tovRate(cur) != null && tovRate(last) != null ? w * tovRate(cur) + (1 - w) * tovRate(last) : tovRate(last);
if (tr != null && last.offPoss && last.gp) out.tovpg = tr * (last.offPoss / last.gp);
for (const k of ['nba_id', 'pos', 'arch', 'prof', 'team']) if (cur[k] != null) out[k] = cur[k];
return out;
}

// ---------------------------------------------------------------- DataBallr team stats
/**
* /v1/nba/teams/stats → { teams: { ABBR: {...} }, league: {...} }. The rows are each team's own
* numbers (Points − OpponentPoints = PlusMinus), whether they sit at the top level or under a key.
*/
function slimTeams(j) {
const blocks = [j && j.team, j, j && j.opponent].filter((b) => b && Array.isArray(b.team_data));
// The team's own numbers live under `team`; `opponent` is what opponents did against them.
const b = blocks.find((x) => x.stat_type !== 'opponent') || blocks[0];
if (!b) return { teams: {}, league: null };
const one = (r) => {
if (!r) return null;
const off = num(r.OffPoss) || 0, def = num(r.DefPoss) || 0;
const pace = num(r.Pace) || null;
const g = num(r.SecondsPlayed) ? r.SecondsPlayed / 2880 : pace && off ? off / pace : 0;
const fga = (num(r.FG2A) || 0) + (num(r.FG3A) || 0);
return {
name: r.Name || null, g: +g.toFixed(2), pace,
ortg: off ? (100 * (num(r.Points) || 0)) / off : null, drtg: def ? (100 * (num(r.OpponentPoints) || 0)) / def : null,
efg: num(r.EfgPct), ts: num(r.TsPct), fg2: num(r.Fg2Pct), fg3: num(r.Fg3Pct),
tov100: off ? (100 * (num(r.Turnovers) || 0)) / off : null, ast: g ? (num(r.Assists) || 0) / g : null,
orb: num(r.OffFGReboundPct), drb: num(r.DefFGReboundPct),
rimF: num(r.AtRimFrequency), rimA: num(r.AtRimAccuracy),
smidF: num(r.ShortMidRangeFrequency), smidA: num(r.ShortMidRangeAccuracy),
lmidF: num(r.LongMidRangeFrequency), lmidA: num(r.LongMidRangeAccuracy),
c3F: num(r.Corner3Frequency), c3A: num(r.Corner3Accuracy), a3F: num(r.Arc3Frequency), a3A: num(r.Arc3Accuracy),
fta: fga ? (num(r.FTA) || 0) / fga : null, sq: num(r.ShotQualityAvg),
secOff: num(r.SecondsPerPossOff), secDef: num(r.SecondsPerPossDef),
stl: g ? (num(r.Steals) || 0) / g : null, blk: g ? (num(r.Blocks) || 0) / g : null,
};
};
const teams = {};
for (const r of b.team_data) { const ab = r.TeamAbbreviation; if (ab) teams[ab] = one(r); }
const L = one(b.league_avg);
return { teams, league: L, statType: b.stat_type || null, season: b.season || null };
}

// ---------------------------------------------------------------- game lines (DataBallr /odds?date=)
const medianOf = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
/** Consensus spread, total and no-vig win chance across books for one game (sanity-filtered). */
function gameLineConsensus(rows, gameId, before) {
const xs = (rows || []).filter((x) => x && (gameId == null || +x.game_id === +gameId) && (!before || !x.updated_at || String(x.updated_at) <= before));
const tot = [], spr = [], pA = [], vend = [];
let upd = null;
for (const x of xs) {
const t = parseFloat(x.total_value), sp = parseFloat(x.spread_home_value);
const ma = num(x.moneyline_away_odds), mh = num(x.moneyline_home_odds);
let ok = false;
if (Number.isFinite(t) && t >= 180 && t <= 280) { tot.push(t); ok = true; }
if (Number.isFinite(sp) && Math.abs(sp) <= 30) { spr.push(sp); ok = true; }
if (ma != null && mh != null && Math.abs(ma) >= 100 && Math.abs(mh) >= 100) { const ia = implied(ma), ih = implied(mh); if (ia + ih > 0.95 && ia + ih < 1.2) { pA.push(ia / (ia + ih)); ok = true; } }
if (ok) { vend.push(x.vendor); if (x.updated_at && (!upd || x.updated_at > upd)) upd = x.updated_at; }
}
if (!vend.length) return null;
return { total: medianOf(tot), spreadHome: medianOf(spr), pAway: medianOf(pA), books: new Set(vend).size, vendors: [...new Set(vend)], updated: upd,
totalRange: tot.length ? [Math.min(...tot), Math.max(...tot)] : null, spreadRange: spr.length ? [Math.min(...spr), Math.max(...spr)] : null };
}

// ---------------------------------------------------------------- DataBallr player game logs
const pctN = (x) => (x == null ? null : x > 1.5 ? x / 100 : x);
/** /v1/nba/players/game-logs rows → the last games (newest first) plus tracking averages. */
function slimGameLogs(rows, keep = 10) {
const list = (rows || []).filter((r) => r && num(r.MIN) > 0).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, keep);
const games = list.map((r) => ({
date: String(r.date || '').slice(0, 10), opp: r.OpponentAbbreviation || '', team: r.TeamAbbreviation || '',
min: num(r.MIN), pts: num(r.PTS), reb: num(r.REB), ast: num(r.AST), fg3m: num(r.FG3M), fg3a: num(r.FG3A), fga: num(r.FGA),
stl: num(r.STL), blk: num(r.BLK), tov: num(r.TOV), pm: num(r.PLUS_MINUS), usg: pctN(num(r.USG_PCT)), ts: pctN(num(r.TS_PCT)),
potAst: num(r.POTENTIAL_AST), top: num(r.TIME_OF_POSS), poss: num(r.POSS), cs3a: num(r.CATCH_SHOOT_FG3A), cs3p: pctN(num(r.CATCH_SHOOT_FG3_PCT)),
pu3a: num(r.PULL_UP_FG3A), pu3p: pctN(num(r.PULL_UP_FG3_PCT)), rebPct: pctN(num(r.REB_PCT)), scrAst: num(r.SCREEN_AST),
}));
const n = games.length;
const avg = (k, w) => { let s = 0, ws = 0; for (const g of games) { if (g[k] == null) continue; const ww = w ? g.min || 0 : 1; s += g[k] * ww; ws += ww; } return ws ? s / ws : null; };
return {
n, games,
avg: { min: avg('min'), pts: avg('pts'), reb: avg('reb'), ast: avg('ast'), fg3m: avg('fg3m'), usg: avg('usg', true), ts: avg('ts', true),
potAst: avg('potAst'), top: avg('top'), cs3a: avg('cs3a'), cs3p: avg('cs3p', true), pu3a: avg('pu3a'), pu3p: avg('pu3p', true), rebPct: avg('rebPct', true), scrAst: avg('scrAst') },
};
}

// ---------------------------------------------------------------- team context from season logs
function teamContext(logs, abbr) {
const c = { g: 0, poss: 0, oppPts: 0, oppPoss: 0, o3a: 0, o3m: 0, oFga: 0, plays: 0, ownPoss: 0, ownPts: 0, mins: 0, reb: 0, ast: 0, oppAst: 0, astG: 0 };
const oz = { rim: [0, 0], mid: [0, 0], three: [0, 0] }; let zg = 0;
for (const lg of logs) {
if (!lg.teams[abbr]) continue;
const opp = Object.keys(lg.teams).find((x) => x !== abbr);
if (!opp) continue;
const O = lg.teams[opp], M = lg.teams[abbr];
c.g++; c.poss += (M.poss + O.poss) / 2; c.oppPts += O.pts; c.oppPoss += O.poss; c.mins += lg.len || 48;
c.o3a += O.fg3a; c.o3m += O.fg3m; c.oFga += O.fga;
c.plays += M.fga + 0.44 * M.fta + M.tov; c.ownPoss += M.poss; c.ownPts += M.pts;
c.reb += M.oreb + M.dreb + O.oreb + O.dreb;
if (M.ast != null && O.ast != null) { c.ast += M.ast; c.oppAst += O.ast; c.astG += lg.len || 48; }
let anyZ = false;
for (const r of Object.values(lg.rows)) if (r.team === opp && r.z) { anyZ = true; for (const k of ['rim', 'mid', 'three']) if (r.z[k]) { oz[k][0] += r.z[k][0]; oz[k][1] += r.z[k][1]; } }
if (anyZ) zg++;
}
const k = c.g / (c.g + 8);
const drtg = c.oppPoss ? (100 * c.oppPts) / c.oppPoss : LEAGUE.ortg;
const o3p = c.o3a ? c.o3m / c.o3a : LEAGUE.p3;
return {
games: c.g,
pace: c.g ? (c.poss / c.mins) * 48 : LEAGUE.pace, // per 48 minutes (OT games don't inflate it)
drtg, opp3p: o3p,
p3f: 1 + k * 0.5 * (o3p / LEAGUE.p3 - 1),
p2f: 1 + k * 0.5 * (drtg / LEAGUE.ortg - 1),
// offensive rebounds give extra shots: plays (FGA + .44 FTA + TOV) per possession
playsPerPoss: c.ownPoss > 0 ? clamp(c.plays / c.ownPoss, 1.03, 1.2) : 1.1,
// net rating per 100 possessions, shrunk toward 0 for small samples
net: c.g ? (c.g / (c.g + 10)) * ((100 * (c.ownPts - c.oppPts)) / Math.max((c.ownPoss + c.oppPoss) / 2, 1)) : 0,
// game environment per minute: rebounds by both teams, own assists, assists allowed
rebPM: c.mins ? c.reb / c.mins : null, astPM: c.astG ? c.ast / c.astG : null, astAllowPM: c.astG ? c.oppAst / c.astG : null,
oppZone: zg ? oz : null, zoneGames: zg,
};
}

/** How this coach treats starters' 4th-quarter minutes in blowouts (learned, with defaults). */
function coachHabits(logs, abbr) {
const mins = {};
for (const lg of logs) for (const r of Object.values(lg.rows)) if (r.team === abbr) {
(mins[r.name] = mins[r.name] || []).push(r.min);
}
const starters = new Set(Object.entries(mins).filter(([, a]) => mean(a) >= 24).map(([n]) => n));
const q4 = { close: [], lead: [], trail: [] };
for (const lg of logs) {
if (!(abbr in lg.margin)) continue;
const m = lg.margin[abbr];
const s = Object.values(lg.rows).filter((r) => r.team === abbr && starters.has(r.name)).map((r) => r.qmin[4] || 0);
if (!s.length) continue;
const bucket = Math.abs(m) <= 10 ? 'close' : m >= 18 ? 'lead' : m <= -18 ? 'trail' : null;
if (bucket) q4[bucket].push(mean(s));
}
const close = q4.close.length ? mean(q4.close) : 8;
const lead = q4.lead.length ? clamp(mean(q4.lead) / Math.max(close, 1), 0.02, 1.1) : 0.3;
const trail = q4.trail.length ? clamp(mean(q4.trail) / Math.max(close, 1), 0.1, 1.2) : 0.75;
// each regular's own record: Q4 minutes in blowouts (18+) vs his close-game Q4 minutes, shrunk toward the coach
const players = {};
const K = TUNE.blowPK;
for (const [name, a] of Object.entries(mins)) {
if (mean(a) < 20) continue;
const pc = [], pl = [], pt = [];
for (const lg of logs) {
if (!(abbr in lg.margin)) continue;
const r = Object.values(lg.rows).find((x) => x.team === abbr && x.name === name);
if (!r || !(r.min > 0)) continue;
const m = lg.margin[abbr], q = r.qmin[4] || 0;
if (Math.abs(m) <= 10) pc.push(q); else if (m >= 18) pl.push(q); else if (m <= -18) pt.push(q);
}
const base = Math.max(pc.length ? (pc.length * mean(pc) + 2 * close) / (pc.length + 2) : close, 1);
const sh = (xs, prior) => (xs.length ? (xs.length * clamp(mean(xs) / base, 0, 1.3) + K * prior) / (xs.length + K) : prior);
const pLead = sh(pl, lead), pTrail = sh(pt, trail);
players[name] = { lead: pLead, trail: pTrail, nLead: pl.length, nTrail: pt.length, q4Lead: pl.length ? mean(pl) : null, q4Close: base,
proof: pl.length + pt.length >= 1 && pLead >= TUNE.immuneLead && pTrail >= 0.75 };
}
return { lead, trail, players, samples: { close: q4.close.length, lead: q4.lead.length, trail: q4.trail.length } };
}

// ---------------------------------------------------------------- the projection
// ---------------------------------------------------------------- learned game patterns
// Each night the app grades its projections (pregame, end of Q1, half, end of Q3) against what
// the players actually did. A small ridge regression per checkpoint and stat learns which
// situations it keeps missing (fast games, back-to-backs, bench roles, hot starts, foul trouble,
// blowout drift...) and how much. Tonight's projections then get that correction.
const PAT_STATS = ['pts', 'reb', 'ast', 'fg3m'];
// what the nightly learning grades: remaining minutes first, then each stat on top of the corrected minutes
const PAT_LEARN = ['min', 'pts', 'reb', 'ast', 'fg3m'];
const PAT_F = ['base', 'starter', 'bench', 'b2b', 'pace', 'blowout', 'roleTrend', 'matesOut', 'proof', 'home', 'softD', 'track', 'fouls', 'livePace', 'margin', 'minTrack', 'shooting',
// live role engine: real usage vs shot luck, game script by role, where he is right now, who he is
'uReal', 'luck', 'leadS', 'trailS', 'lopB', 'on', 'sitLong', 'dnp', 'usgHi', 'closeStar', 'pfX', 'recent', 'mpgC', 'fadeHist', 'leadProof',
// top-down team check: the books' line (or team ratings) and tonight's score so far vs what our player numbers add up to
'tdMkt', 'tdLive',
// tonight's lineup (v15): starting tonight vs his usual role, back from a layoff, deep bench, minutes freed at his position, last game's minutes, rest, games missed
'startUp', 'startDown', 'fresh', 'deep', 'vacPos', 'lastMin', 'rest3', 'missShare',
// tonight's crowd (v16): how over- or under-booked the team's minutes are (full bench vs short-handed), by role; and the expected margin by role
'loadS', 'loadB', 'loadBd', 'loadBq', 'favS', 'dogS', 'dogB'];
const PAT_D = PAT_F.length;
const PAT_IX = Object.fromEntries(PAT_F.map((k, i) => [k, i]));
// How hard each input is pulled toward "no effect" when the lessons are solved, relative to the others (1 = the usual pull).
// The lineup inputs are rare but strong (about one reserve a game starts), so the usual pull would flatten them.
const PAT_LAMF = PAT_F.map((k) => (TUNE.patLamLineup > 0 && ['startUp', 'startDown', 'fresh', 'deep'].includes(k) ? TUNE.patLamLineup : 1));
// stages of the game: pregame, then every 6 game minutes (the learned trust in live data changes with each)
// 'rep' (v15) = before the lineups are posted, when only the injury report is known: the app knows less then, so it learns that moment separately
const PAT_GROUPS = ['pre', 's6', 's12', 's18', 's24', 's30', 's36', 's42', 'rep'];
// features that describe a shift of shots between teammates (shared inside the team when TUNE.shiftCenter is on)
const PAT_SHIFT = ['track', 'shooting', 'uReal', 'luck', 'recent', 'fadeHist'];
// The number we show. The average of the simulations is pulled up by rare big finishes; the middle of them is where a player
// most often lands. How much of the middle to show at each stage was learned on last season (595 games) and checked on this
// season's 123 games: average miss from the end of Q3 fell 3% on points, 13% on assists, 22% on threes (6 minutes left: 12%, 23%, 32%).
const LAND = { pre: { fg3m: 1 }, s6: { fg3m: 1 }, s12: { ast: 0.25, fg3m: 1 }, s18: { ast: 0.5, fg3m: 1 }, s24: { pts: 0.25, ast: 1, fg3m: 1 },
s30: { pts: 0.75, reb: 0.25, ast: 1, fg3m: 1 }, s36: { pts: 1, reb: 1, ast: 1, fg3m: 1 }, s42: { pts: 1, reb: 1, ast: 1, fg3m: 1 }, rep: { fg3m: 1 } };
function patGroup(st, lineupPosted) { if (st.phase === 'pre') return lineupPosted === false && TUNE.repGroup > 0 ? 'rep' : 'pre'; const k = clamp(Math.round(st.elapsed / 6), 1, 7); return 's' + k * 6; }
/** One feature row per graded stat for a player at this moment (all scaled to about -2..2). */
function patFeatures(f) {
const out = {};
const live = f.phase !== 'pre';
const b = new Array(PAT_D).fill(0);
b[0] = 1; b[1] = f.starter ? 1 : 0; b[2] = f.mpg < 18 ? 1 : 0; b[3] = f.b2b ? 1 : 0;
b[4] = clamp((f.pace - 99) / 5, -2, 2); b[5] = clamp(f.pBlow, 0, 1); b[6] = clamp(f.roleTrend / 5, -2, 2);
b[7] = clamp((f.scale - 1) * 10, 0, 2); b[8] = f.proof ? 1 : 0; b[9] = f.home ? 1 : 0; b[10] = clamp((f.zoneF2 - 1) * 10, -2, 2);
const usgS = f.usgS > 0 ? f.usgS : 0.2;
b[PAT_IX.usgHi] = clamp((usgS - 0.2) * 10, -1.5, 2.5);
b[PAT_IX.mpgC] = clamp((f.mpg - 24) / 8, -2, 1.5);
b[PAT_IX.tdMkt] = f.tdMkt || 0;
b[PAT_IX.startUp] = clamp(f.startUp || 0, 0, 2.5); b[PAT_IX.startDown] = clamp(f.startDown || 0, 0, 1);
b[PAT_IX.fresh] = f.fresh ? 1 : 0; b[PAT_IX.deep] = f.deep ? 1 : 0;
b[PAT_IX.vacPos] = clamp(f.vacPos || 0, 0, 2); b[PAT_IX.lastMin] = clamp((f.lastMin || 0) / 10, -2, 2);
b[PAT_IX.rest3] = f.rest3 ? 1 : 0; b[PAT_IX.missShare] = clamp(f.missShare || 0, 0, 1);
// team load: 0 = a typical night, +1 = the usual minutes of tonight's available players add up to 24 more than usual
// (everyone is back: a crowded rotation), -1 = 24 fewer (short-handed)
const ctxOn = !live || !(TUNE.ctxUntil > 0) || f.el < TUNE.ctxUntil;
const ld = TUNE.loadIn > 0 && ctxOn && f.load != null ? clamp((f.load - TUNE.loadMid) / 0.1, -2.5, 2.5) : 0;
b[PAT_IX.loadS] = f.starter ? ld : 0; b[PAT_IX.loadB] = f.starter ? 0 : ld; b[PAT_IX.loadBd] = f.starter ? 0 : ld * clamp((18 - f.mpg) / 8, 0, 1.5);
b[PAT_IX.loadBq] = f.starter ? 0 : (Math.max(ld, 0) * Math.max(ld, 0)) / 2.5;
// expected margin before tip-off (books' spread, or team ratings): past 4 points it starts to cost starters minutes
const fv = TUNE.favIn > 0 && ctxOn ? f.favBy || 0 : 0;
b[PAT_IX.favS] = f.starter ? clamp((fv - 4) / 6, 0, 2) : 0; b[PAT_IX.dogS] = f.starter ? clamp((-fv - 4) / 6, 0, 2) : 0; b[PAT_IX.dogB] = f.starter ? 0 : clamp((-fv - 4) / 6, 0, 2);
if (live) {
const mg = f.mg || 0, am = Math.abs(mg);
b[12] = f.foulTrouble ? 1 : 0;
b[13] = clamp((f.livePace - f.pace) / 5, -2, 2);
b[14] = clamp(am / 10, 0, 3);
b[15] = clamp(f.minTrack - 1, -1, 1);
b[16] = f.fga >= 4 ? clamp((f.fgm / f.fga - 0.47) * 5, -2, 2) : 0;
const lu = f.lu || null;
// real usage: plays he finished vs what his normal share of the plays run while he was on the floor would be
b[PAT_IX.uReal] = lu && lu.onPlays >= 4 ? clamp((lu.plays - usgS * lu.onPlays) / Math.sqrt(usgS * lu.onPlays + 1), -2.5, 2.5) : 0;
// shot luck: points scored vs points his shots are normally worth (same shots, his usual accuracy)
b[PAT_IX.luck] = lu && lu.shots >= 2 ? clamp((f.now.pts - lu.xPts) / Math.sqrt(lu.xPts + 1), -2.5, 2.5) : 0;
b[PAT_IX.recent] = lu && lu.minR >= 3 && lu.onPlaysR >= 3 ? clamp((lu.playsR - usgS * lu.onPlaysR) / Math.sqrt(usgS * lu.onPlaysR + 1), -2.5, 2.5) : 0;
b[PAT_IX.leadS] = f.starter ? clamp((mg - 8) / 10, 0, 2.5) : 0;
b[PAT_IX.trailS] = f.starter ? clamp((-mg - 8) / 10, 0, 2.5) : 0;
b[PAT_IX.lopB] = f.starter ? 0 : clamp((am - 8) / 10, 0, 2.5);
b[PAT_IX.leadProof] = f.proof ? b[PAT_IX.leadS] + b[PAT_IX.trailS] : 0;
b[PAT_IX.on] = f.on ? 1 : 0;
b[PAT_IX.sitLong] = !f.on && !f.dnp ? clamp((f.sitting || 0) / 6, 0, 2) : 0;
b[PAT_IX.dnp] = f.dnp ? 1 : 0;
b[PAT_IX.closeStar] = am <= 8 ? b[PAT_IX.usgHi] : 0;
b[PAT_IX.pfX] = clamp((f.now.pf || 0) - 1 - f.el / 16, -2, 2.5);
b[PAT_IX.fadeHist] = f.fade != null && f.d1 != null ? clamp(f.fade * f.d1, -1, 1) : 0;
b[PAT_IX.tdLive] = f.tdLive || 0;
}
for (const s of PAT_LEARN) {
const x = b.slice();
if (s === 'min') { x[PAT_IX.tdMkt] = 0; x[PAT_IX.tdLive] = 0; } // a team's scoring level says nothing about who plays
else if (!(TUNE.loadStats > 0)) { x[PAT_IX.loadS] = 0; x[PAT_IX.loadB] = 0; x[PAT_IX.loadBd] = 0; x[PAT_IX.loadBq] = 0; } // and how crowded the rotation is only says who plays
if (live) {
const k = s === 'min' ? 'pts' : s;
const exp = f.ratePM[k] * f.min;
x[11] = f.min >= 4 && exp > 0.3 ? clamp((f.now[k] - exp) / Math.sqrt(exp + 1), -2, 2.5) : 0;
}
out[s] = x;
}
return out;
}
/** Empty sufficient statistics (what grading adds up; sums across nights). */
function patEmpty() {
const o = {};
for (const g of PAT_GROUPS) { o[g] = {}; for (const s of PAT_LEARN) o[g][s] = { A: new Array(PAT_D * PAT_D).fill(0), b: new Array(PAT_D).fill(0), n: 0, w: 0 }; }
// running accuracy: average miss in points (players who played 10+ minutes) and how often the real top scorer was in our top 3
o.acc = {}; for (const g of PAT_GROUPS) o.acc[g] = { n: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, g: 0, top3: 0 };
o.cal = calEmpty();
o.team = {}; for (const g of PAT_GROUPS) o.team[g] = [0, 0, 0];
return o;
}
function patAdd(acc, more, wt = 1) {
for (const g of PAT_GROUPS) for (const s of PAT_LEARN) {
const m = more && more[g] && more[g][s];
if (!m || !m.A || m.A.length !== PAT_D * PAT_D) continue;
if (!acc[g]) acc[g] = {};
const a = (acc[g][s] = acc[g][s] || { A: new Array(PAT_D * PAT_D).fill(0), b: new Array(PAT_D).fill(0), n: 0, w: 0 });
for (let i = 0; i < a.A.length; i++) a.A[i] += wt * m.A[i];
for (let i = 0; i < a.b.length; i++) a.b[i] += wt * m.b[i];
a.n += wt * m.n; a.w += wt * m.w;
}
if (more && more.cal) { acc.cal = acc.cal || calEmpty(); calAdd(acc.cal, more.cal, wt); }
if (more && more.team) { acc.team = acc.team || {}; for (const g of PAT_GROUPS) { const m = more.team[g]; if (!m) continue; const a = (acc.team[g] = acc.team[g] || [0, 0, 0]); for (let j = 0; j < 3; j++) a[j] += wt * (m[j] || 0); } }
if (more && more.acc) { acc.acc = acc.acc || {}; for (const g of PAT_GROUPS) { const m = more.acc[g]; if (!m) continue; const a = (acc.acc[g] = acc.acc[g] || { n: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, g: 0, top3: 0 }); for (const k of Object.keys(a)) a[k] += wt * (m[k] || 0); } }
return acc;
}
/**
* Grade one projection against the final box. proj = projectGame() output (made with patW 0),
* rows = logEntry().rows of the finished game. Adds into acc (patEmpty()).
*/
/** The box-score row of a player we projected from tonight's posted list before he had a play-by-play id. */
function rowByName(rows, p) {
if (!p || !(p.pid < 0)) return undefined;
const k = norm(p.name);
for (const r of Object.values(rows)) if (r.team === p.team && norm(r.name) === k) return r;
return undefined;
}
function patGrade(proj, rows, acc, opts) {
const only = opts && opts.only ? opts.only : null; // grade just these stats (the fit runs in two passes)
const live = proj.state.phase !== 'pre';
for (const p of proj.players) {
let a = rows[p.pid] || rowByName(rows, p);
if (!p.pat) continue;
// live: a rotation player who never got in is a real miss (he finished with what he had); pregame we assume lineups are known
if (!a || !(a.min > 0)) { if (!live) continue; a = { min: p.now.min, pts: p.now.pts, reb: p.now.reb, ast: p.now.ast, fg3m: p.now.fg3m }; }
const S = acc[p.pat.g];
if (!S) continue;
for (const s of PAT_LEARN) {
if (only && !only.includes(s)) continue;
const T = S[s];
if (!T) continue;
// minutes are graded against the plain projection (the learned minutes factor backed out)
const f0 = s === 'min' && p.pat.f && p.pat.f.min ? p.pat.f.min : 1;
// (the engine reports his minutes before the learned factor as minPlain: exact, where dividing the factor back out is only close)
const rem = s === 'min' && p.minPlain != null ? p.minPlain - p.now.min : ((p.mean || p.proj)[s] - p.now[s]) / f0;
if (!(rem >= 0.25)) continue;
// the target is the plain miss (Nov 10: the old cap at +200% cut off big nights for small roles and taught the layer to aim low late in games)
const y0 = a[s] - (p.now[s] + rem);
const y = TUNE.patYCap > 0 ? Math.min(y0, rem * 4 + (s === 'min' ? 14 : s === 'pts' ? 10 : 5)) : y0;
const x = p.pat.x[s];
for (let i = 0; i < PAT_D; i++) { const xi = x[i]; if (!xi) continue; T.b[i] += rem * y * xi; for (let j = 0; j < PAT_D; j++) T.A[i * PAT_D + j] += rem * rem * xi * x[j]; }
T.n++; T.w += rem * rem;
}
// were the chances right? every ladder rung still ahead of him: the simulated chance vs whether he got there
if (acc.cal && p.laddersRaw && (!only || only.includes('pts'))) for (const s of CAL_STATS) {
const lvl = calLevel(s, (p.mean || p.proj)[s] - p.now[s]);
for (const L1 of p.laddersRaw[s]) { if (L1.t <= p.now[s]) continue; calObs(acc.cal, p.pat.g, s, lvl, L1.p, a[s] >= L1.t ? 1 : 0); }
}
}
return acc;
}
/** Running accuracy for one graded projection: average miss (10+ minute players) and top scorer inside our top 3. */
function patScore(proj, rows, acc) {
if (!acc.acc) { acc.acc = {}; for (const g of PAT_GROUPS) acc.acc[g] = { n: 0, pts: 0, reb: 0, ast: 0, fg3m: 0, g: 0, top3: 0 }; }
const A = acc.acc[proj.patG || patGroup(proj.state)];
if (!A) return acc;
let top = -1;
for (const r of Object.values(rows)) if (r.pts > top) top = r.pts;
const ids = new Set(Object.entries(rows).filter(([, r]) => r.pts === top).map(([id]) => +id));
const best = proj.players.slice().sort((x, y) => y.proj.pts - x.proj.pts).slice(0, 3);
A.g++; if (best.some((p) => ids.has(+p.pid))) A.top3++;
// team check: our points still to come for each team (before the check itself) against the real ones
if (proj.teamRaw && proj.state.phase !== 'final') {
acc.team = acc.team || {};
const T = (acc.team[proj.patG || patGroup(proj.state)] = acc.team[proj.patG || patGroup(proj.state)] || [0, 0, 0]);
for (const [tm, nowPts] of [[proj.state.v, proj.state.vs], [proj.state.h, proj.state.hs]]) {
let fin = 0; for (const r of Object.values(rows)) if (r.team === tm) fin += r.pts;
if (!(fin > 0) || proj.teamRaw[tm] == null) continue;
T[0]++; T[1] += proj.teamRaw[tm]; T[2] += Math.max(fin - nowPts, 0);
}
}
for (const p of proj.players) {
const a = rows[p.pid] || rowByName(rows, p);
if (!a || !(a.min >= 10)) continue;
A.n++;
for (const s of PAT_STATS) A[s] += Math.abs(p.proj[s] - a[s]);
}
return acc;
}
function solveLin(A, b, d) {
const M = []; for (let i = 0; i < d; i++) { M.push(A.slice(i * d, i * d + d)); M[i].push(b[i]); }
for (let c = 0; c < d; c++) {
let piv = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
if (Math.abs(M[piv][c]) < 1e-12) continue;
[M[c], M[piv]] = [M[piv], M[c]];
for (let r = 0; r < d; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
}
return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[d] / row[i]));
}
/** Sufficient statistics → coefficients per checkpoint and stat: { pre: { pts: [..17], ... }, ... , n }. */
function patSolve(acc, lam) {
const L = lam != null ? lam : TUNE.patLam;
PAT_F.forEach((k, i) => { PAT_LAMF[i] = TUNE.patLamLineup > 0 && ['startUp', 'startDown', 'fresh', 'deep'].includes(k) ? TUNE.patLamLineup : 1; });
const out = { n: 0 };
for (const g of PAT_GROUPS) {
out[g] = {};
for (const s of PAT_LEARN) {
const T = acc[g] && acc[g][s];
if (!T || T.n < 200) { out[g][s] = null; continue; }
const A = T.A.slice();
const avg = T.w / T.n;
for (let i = 0; i < PAT_D; i++) A[i * PAT_D + i] += L * avg * 25 * PAT_LAMF[i];
out[g][s] = solveLin(A, T.b, PAT_D).map((v) => +v.toFixed(5));
out.n = Math.max(out.n, T.n);
}
}
return out;
}
// What 1,314 finished games taught the live role engine (1,191 from all of last season + 123 from Oct 21 - Nov 9 this season), projected with the same inputs the live app has (season-to-date stats, team ratings, closing lines, lineups):
// coefficients per stage and stat (b), how much evidence sits behind each (d = diagonal weight, n = player-moments graded).
// Held-out check: weights learned on last season only, then tested on this season's 123 games (see ACCURACY in app.js).
const PAT_PRIOR = {"pre":{"min":{"b":[0.1446,-0.10929,-0.00524,0.00778,-0.02799,0.01422,0.00161,-0.0259,-0.00292,0.00085,0.00102,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.02372,0,0,0,-0.03979,0,0,0,0,0.41794,-0.22646,-0.15778,0.35825,0.00401,0.01906,0.00704,0.01527],"d":[41700000,35000000,2280000,7250000,22400000,2960000,12100000,6290000,7120000,20800000,6270000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,17100000,0,0,0,43100000,0,0,0,0,426000,1220000,345000,96300,7840000,10000000,2250000,2060000],"n":72035,"w":41700000},"pts":{"b":[0.03882,-0.02593,-0.0167,-0.00421,-0.00789,-0.01283,-0.01688,-0.01201,0.00648,-0.00658,0.00371,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.03033,0,0,0,0.03119,0,0,0.12078,0,-0.01567,0.01855,-0.10364,-0.03111,0.00788,-0.00414,-0.00022,0.00555],"d":[11400000,9820000,552000,2010000,5830000,809000,2850000,1710000,1940000,5760000,1730000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7200000,0,0,0,13500000,0,0,1010000,0,239000,146000,86000,51300,2110000,2440000,617000,598000],"n":71858,"w":11400000},"reb":{"b":[-0.00959,-0.04527,0.00415,-0.01213,0.02662,0.01194,-0.00418,-0.00484,-0.00083,-0.00034,0.0051,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0005,0,0,0,0.01993,0,0,0.10046,0,-0.01006,-0.04229,-0.0253,-0.00249,-0.00642,-0.02088,0.01468,-0.00351],"d":[1790000,1390000,161000,319000,953000,127000,502000,276000,285000,899000,270000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,764000,0,0,0,1810000,0,0,158000,0,64600,32400,10700,12100,272000,424000,94500,94000],"n":71057,"w":1790000},"ast":{"b":[-0.03288,-0.02173,-0.02275,-0.02119,0.05697,-0.00387,-0.00038,0.05229,-0.01135,0.02083,0.0335,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.01265,0,0,0,0.02344,0,0,0.08787,0,0.0326,-0.04949,0.02403,-0.02247,0.00706,-0.01313,-0.01329,-0.00857],"d":[730000,626000,35100,128000,344000,51000,178000,83900,123000,365000,111000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,422000,0,0,0,868000,0,0,68500,0,13000,10500,4440,2550,138000,151000,40600,36300],"n":68523,"w":730000},"fg3m":{"b":[0.02321,-0.03713,-0.03499,-0.01409,-0.01318,-0.00112,-0.00616,-0.05625,0.00707,0.00787,0.00993,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02422,0,0,0,0.03477,0,0,0.11958,0,-0.01521,0.02256,-0.08597,-0.09059,0.00053,-0.00226,-0.00102,-0.04455],"d":[145000,116000,10200,26100,75400,10400,40100,27100,24000,72800,21900,0,0,0,0,0,0,0,0,0,0,0,0,0,0,64600,0,0,0,149000,0,0,12700,0,4300,2630,1110,920,33600,33500,8020,7810],"n":58981,"w":145000}},"s6":{"min":{"b":[0.09984,-0.1159,-0.05759,0,-0.01709,-0.02493,0.01948,-0.03323,0.00573,0.00163,-0.00179,0.01722,0.06323,-0.00024,0.00497,-0.16594,0.00115,-0.0179,-0.00593,0.00982,0.00106,-0.00499,0.04695,0.01158,-0.08208,0.00201,0.01609,-0.02466,0.00398,-0.05445,0,-0.00453,0,0,0.14552,-0.1954,-0.75563,0.05076,0.00496,0.03892,0.01238,-0.10602],"d":[34200000,26900000,2900000,0,19000000,1670000,9640000,5870000,5300000,17100000,5110000,31800000,542000,68600000,13000000,1650000,5230000,12200000,16900000,373000,376000,246000,22100000,129000,8070000,13600000,11200000,53800000,11900000,34600000,0,165000,0,0,538000,1280000,1520000,117000,6810000,8120000,1810000,3210000],"n":90807,"w":34200000},"pts":{"b":[0.07047,-0.03593,-0.01031,0,0.0106,-0.03633,-0.01849,-0.01358,0.00626,-0.0094,0.00004,0.00112,0.01644,-0.00058,0.00682,-0.07641,0.00277,-0.01447,-0.00968,-0.03542,0.04642,0.00705,-0.02433,0.00525,-0.07729,-0.02384,0.00748,-0.01171,0.00536,0.01658,0,-0.03095,0.13027,-0.03314,-0.00512,-0.18672,-0.64744,-0.11592,0.01123,-0.01364,0.00529,-0.02311],"d":[8470000,7130000,458000,0,4480000,404000,2210000,1360000,1420000,4280000,1280000,9290000,144000,16900000,3210000,318000,2010000,3450000,5240000,117000,81300,44700,6230000,35000,1150000,5240000,4330000,13100000,3400000,9910000,0,47200,892000,2390000,128000,150000,51700,27000,1570000,1860000,454000,467000],"n":90050,"w":8470000},"reb":{"b":[0.00483,-0.06051,0.01108,0,0.05177,0.0235,-0.00208,-0.01509,-0.00253,-0.00015,0.00436,-0.00573,-0.00203,0.01112,0.00392,-0.06719,0.0066,-0.01735,-0.01639,0.01029,0.00951,-0.01501,-0.02182,0.00244,-0.06922,0.01442,0.00002,-0.01024,0.02027,0.01062,0,-0.01619,0.0979,0.00279,0.02222,-0.05464,-0.55513,-0.11901,0.00233,-0.02514,0.02434,-0.04681],"d":[1350000,1010000,137000,0,753000,62900,393000,224000,207000,677000,203000,568000,27300,2710000,507000,63400,233000,542000,643000,14800,12000,10800,937000,5960,248000,564000,467000,2090000,531000,1360000,0,6520,144000,396000,36200,27200,6880,6890,206000,330000,70700,74800],"n":87283,"w":1350000},"ast":{"b":[-0.00456,-0.0344,-0.00802,0,0.07023,0.02251,0.00231,0.03906,-0.01632,0.01814,0.0329,-0.01324,0.00376,0.0117,-0.00003,-0.031,0.00774,-0.00161,-0.00189,0.01671,-0.01073,0.00868,-0.0364,-0.02012,-0.08122,0.015,0.00289,-0.00638,0.00701,0.00321,0,0.00995,0.0866,-0.01546,0.00936,-0.11559,-0.61917,-0.20611,0.01201,-0.02741,-0.00903,-0.02425],"d":[538000,452000,29000,0,263000,24200,136000,67300,89800,269000,81700,215000,8480,1070000,200000,20000,106000,220000,317000,6670,5360,2820,395000,2100,73900,306000,254000,842000,217000,635000,0,2660,59600,150000,7010,9810,3750,1510,102000,114000,29700,28900],"n":80152,"w":538000},"fg3m":{"b":[0.00914,-0.04024,-0.03333,0,0.00549,-0.0006,-0.00762,-0.04977,0.013,0.00789,0.00397,0.02728,-0.00435,0.0007,0.00745,-0.06255,-0.00185,-0.00768,-0.00032,-0.03006,0.04226,0.00457,-0.00167,0.01168,-0.02693,-0.01403,0.00006,-0.00982,-0.0127,0.01391,0,-0.0075,0.1229,-0.03945,-0.01631,-0.02525,-0.66326,-0.1836,-0.00546,-0.004,-0.00099,-0.08794],"d":[109000,85300,8220,0,58400,5380,31300,21300,17800,55100,16400,20100,1630,218000,41900,5480,20000,39000,63800,1430,1010,809,75700,387,21500,47200,39100,174000,38300,110000,0,619,11400,31400,2190,2350,906,396,25300,25900,6010,6330],"n":66142,"w":109000}},"s12":{"min":{"b":[0.0452,-0.08029,-0.00316,0,-0.01837,-0.03505,0.01686,-0.02423,0.00406,0.00015,-0.00402,0.01302,0.03155,-0.00116,0.00408,-0.03098,-0.00841,0.00034,0.00918,-0.00148,0.00243,-0.01706,0.03501,0.09981,-0.32043,0.02209,0.00667,-0.01062,-0.01593,-0.03067,-0.00527,-0.02109,0,0,0.15657,-0.09998,-0.61679,0.01463,-0.00117,0.02868,0.00975,-0.05578],"d":[25600000,19900000,2360000,0,14200000,1830000,7070000,4870000,3960000,12800000,3820000,32600000,1360000,41200000,20400000,932000,10100000,14300000,18900000,1360000,1410000,1090000,13000000,4570000,2050000,10100000,6610000,56100000,13000000,26300000,320000,684000,0,0,516000,830000,1330000,77200,6880000,5940000,1350000,2670000],"n":89140,"w":25600000},"pts":{"b":[0.01624,-0.02133,0.01803,0,0.00909,-0.05986,-0.01249,-0.01396,0.01278,-0.0098,0.00026,0.00938,0.00924,-0.00108,0.01165,-0.08438,-0.01099,-0.00643,-0.00947,-0.06268,0.06815,0.01204,-0.01359,-0.01273,-0.11104,-0.02455,-0.00198,-0.00698,-0.00489,0.02559,-0.00684,-0.01918,0.13593,-0.02654,-0.00337,-0.05531,-0.75257,-0.03608,0.02143,-0.00684,0.00989,-0.02336],"d":[6530000,5560000,341000,0,3410000,444000,1660000,1140000,1110000,3300000,983000,9170000,381000,10300000,5040000,214000,3520000,4020000,5640000,451000,300000,171000,3540000,1230000,105000,4090000,2690000,14000000,3560000,7620000,59500,191000,851000,1900000,137000,97100,43300,8470,1600000,1400000,349000,398000],"n":87521,"w":6530000},"reb":{"b":[-0.0324,-0.0402,0.02452,0,0.04923,0.00728,-0.00598,-0.0121,0.00269,0.00271,0.00626,0.00013,-0.00418,0.0177,-0.00552,-0.059,0.0028,0.00033,-0.01196,0.01566,0.01437,0.00593,-0.00235,-0.00356,-0.13715,-0.00109,-0.00369,-0.00564,0.00791,0.0142,0.00983,-0.02176,0.07849,0.01035,0.01422,-0.06675,-0.61344,-0.08264,0.00629,-0.01976,0.02097,-0.02162],"d":[1040000,793000,98800,0,577000,68800,296000,189000,163000,521000,156000,630000,69400,1680000,790000,41100,432000,635000,730000,54400,46600,41300,519000,243000,21600,440000,292000,2190000,572000,1040000,11900,26100,139000,316000,37800,19800,5940,2140,211000,249000,54600,63600],"n":83773,"w":1040000},"ast":{"b":[-0.06117,-0.02076,0.0014,0,0.06349,0.01162,0.00956,0.04217,-0.0209,0.01467,0.03618,0.00271,-0.00553,0.0166,0.01537,-0.04397,0.00545,-0.01169,-0.00777,0.00308,-0.03206,-0.00805,-0.017,-0.01925,-0.11674,0.01022,-0.01191,-0.00652,0.01869,0.01319,-0.03392,0.0103,0.05514,-0.01572,0.05088,-0.04861,-0.66009,-0.12498,0.01337,-0.02024,-0.00853,-0.02057],"d":[418000,356000,21200,0,202000,26300,103000,57300,70500,209000,63500,231000,22800,649000,312000,12800,207000,256000,356000,25000,19900,10700,220000,81000,7170,239000,160000,907000,226000,491000,4700,11100,56700,119000,6950,6830,3230,484,103000,86700,23100,24900],"n":74994,"w":418000},"fg3m":{"b":[-0.01126,-0.03222,-0.00604,0,0.00164,-0.01526,-0.00359,-0.04412,0.01071,0.00807,0.00548,0.06187,-0.00387,-0.00373,0.00629,-0.08229,-0.01264,-0.00531,-0.01107,-0.04906,0.04677,-0.00677,-0.03031,-0.03099,-0.10065,-0.00349,-0.0216,-0.01049,-0.02094,0.02417,-0.00937,0.01202,0.11358,-0.03024,-0.00374,-0.01741,-0.70324,-0.09944,0.01126,-0.0057,-0.00852,-0.07159],"d":[83600,66300,6090,0,44500,5970,23500,18200,13900,42100,12600,27700,4620,131000,66200,3450,37200,50000,74600,5350,3780,3190,46200,15500,1770,36600,24000,182000,44500,84200,1010,2400,10800,24800,2410,1690,752,86.1,25300,19500,4650,5370],"n":60833,"w":83600}},"s18":{"min":{"b":[-0.06642,-0.02284,-0.04331,0,0.03497,-0.04684,0.0128,-0.03629,0.00881,-0.00396,0.0004,0.02075,-0.00294,0.00901,-0.00935,-0.00328,-0.01073,-0.01514,0.00546,0.01698,-0.00865,-0.0031,0.09441,0.06551,-0.21713,0.02572,0.00996,-0.0095,0.00344,0.00136,-0.01064,-0.0196,0,0,0.16948,-0.16613,0,0,-0.00231,0.0189,0.00592,-0.0498],"d":[20200000,15800000,1740000,0,11600000,1810000,6090000,4600000,3190000,10100000,3020000,31400000,284000,31800000,23700000,787000,12100000,13900000,18600000,2130000,2390000,1740000,13000000,3270000,193000,8170000,4590000,50700000,12200000,21100000,310000,1090000,0,0,491000,499000,0,0,6380000,5130000,1060000,1180000],"n":71050,"w":20200000},"pts":{"b":[-0.03049,0.0195,0.04361,0,-0.00091,-0.0337,-0.02267,0.00989,0.0121,-0.00307,0.00421,0.00208,-0.00693,-0.00434,0.01211,-0.02218,-0.00385,0.00429,-0.0152,-0.06505,0.08311,0.02912,-0.06044,-0.01864,-0.05261,-0.04521,0.00673,-0.00217,-0.01742,0.04998,-0.00257,-0.00651,0.13813,-0.02595,-0.12091,0.02238,0,0,0.0191,-0.01202,0.00762,0.01014],"d":[4860000,4180000,222000,0,2450000,377000,1240000,887000,820000,2450000,733000,7780000,51400,7160000,5190000,148000,3490000,3360000,4840000,644000,408000,225000,3380000,748000,9560,3210000,1880000,12500000,3010000,5840000,47800,258000,809000,1380000,143000,52400,0,0,1370000,1040000,261000,256000],"n":70725,"w":4860000},"reb":{"b":[-0.06218,-0.00076,0.04187,0,0.04001,0.0041,-0.01714,0.00402,0.00363,0.00648,0.00968,-0.00003,-0.02408,0.02015,-0.01145,-0.00612,0.00963,0.01089,-0.02246,0.0023,0.04262,0.02511,-0.04714,-0.02626,-0.10313,-0.02319,-0.01642,-0.00192,-0.01344,0.03796,0.00911,-0.00962,0.08432,0.02078,-0.09951,0.03182,0,0,0.00686,-0.02961,0.01296,0.01715],"d":[774000,593000,68400,0,421000,59200,222000,154000,120000,388000,116000,582000,10700,1190000,821000,30700,492000,542000,661000,77200,65100,58600,533000,135000,2750,343000,203000,1910000,474000,797000,10200,35300,135000,233000,41900,11300,0,0,184000,187000,41000,42400],"n":69844,"w":774000},"ast":{"b":[-0.1014,0.01059,0.02138,0,0.04919,0.03945,0.00132,0.04578,-0.02042,0.01546,0.03493,0.01266,-0.00879,0.01448,-0.0004,-0.02203,0.00796,0.00232,-0.01019,0.02114,0.0216,0.00972,-0.05821,-0.01066,-0.04877,-0.01997,0.00202,-0.00532,-0.00101,0.02814,-0.03631,0.00029,0.04818,-0.02057,-0.05328,0.00472,0,0,0.01955,-0.02668,-0.00802,0.01648],"d":[319000,275000,13500,0,149000,22600,79000,43900,53300,160000,48500,217000,3130,461000,327000,8910,218000,219000,317000,36400,27500,13600,224000,46900,518,193000,115000,831000,193000,387000,3870,15200,54900,87500,7590,3840,0,0,90200,66500,17700,15900],"n":65628,"w":319000},"fg3m":{"b":[-0.07162,0.00503,0.02244,0,-0.00243,-0.00177,-0.01074,-0.01669,0.01352,0.01351,0.00522,0.06975,-0.00702,-0.00828,0.00311,-0.02572,0.00095,-0.00716,-0.03463,-0.04687,0.0652,0.00962,-0.0444,-0.00342,-0.05046,-0.02896,-0.01218,-0.00179,-0.04177,0.0532,0.01868,0.00123,0.10165,-0.03043,-0.13528,0.02303,0,0,0.03073,-0.00748,-0.01449,-0.0331],"d":[60700,48800,3960,0,31100,4940,17000,14000,10000,30500,9130,28000,650,89900,66800,2330,39400,41900,65500,7490,5090,4080,42100,9660,127,28300,16500,158000,37600,63600,852,3150,10100,17700,2620,910,0,0,21100,14100,3370,3340],"n":53953,"w":60700}},"s24":{"min":{"b":[-0.03839,0.0033,-0.01451,0,0.02725,-0.05358,0.00795,-0.02452,0.00989,-0.00388,0.00093,0.01539,0.00422,0.01067,-0.01342,0.04468,-0.01127,-0.00135,0.00939,0.01511,-0.01813,-0.01485,0.00483,0.03,0,0.02487,0.01064,0.00518,0.00269,0.01608,-0.013,-0.01445,0,0,0.12989,-0.12001,0,0,0.00797,0.01413,0.00282,-0.03903],"d":[13200000,10000000,1220000,0,7590000,1540000,4080000,3150000,2040000,6610000,1990000,22000000,675000,18300000,20900000,620000,8940000,10100000,13200000,2160000,2470000,2190000,9120000,3680000,0,5310000,2620000,31800000,7920000,13400000,183000,1100000,0,0,356000,321000,0,0,2650000,3410000,697000,782000],"n":66466,"w":13200000},"pts":{"b":[-0.06309,-0.0036,0.02324,0,-0.01336,-0.02518,-0.02032,0.0014,0.00979,-0.00154,-0.00114,-0.00786,0.01607,-0.00739,0.00764,-0.03372,-0.00618,0.0031,-0.01737,-0.05529,0.05584,0.0323,-0.00195,-0.01807,0,-0.06325,0.00092,-0.01662,-0.01278,0.03956,-0.00764,-0.01074,0.13645,-0.03439,-0.13802,0.02746,0,0,-0.00044,-0.01468,0.00252,0.00845],"d":[3030000,2580000,156000,0,1500000,278000,773000,586000,516000,1530000,455000,5260000,160000,3840000,4110000,107000,2130000,2370000,3200000,606000,374000,252000,2270000,670000,0,2040000,1110000,7210000,1830000,3620000,26200,236000,565000,739000,93300,35000,0,0,562000,653000,165000,165000],"n":66399,"w":3030000},"reb":{"b":[-0.09787,-0.02728,0.01187,0,0.03104,-0.03562,-0.00942,-0.00041,0.00036,0.01075,0.00661,0.00802,-0.00302,0.01814,0.01947,-0.0117,0.00809,-0.00385,-0.02061,-0.00018,-0.00022,0.00714,-0.00415,-0.03028,0,-0.03327,-0.01399,-0.01064,-0.00712,0.02602,-0.00223,-0.03519,0.06233,0.00926,-0.11053,0.01367,0,0,0.00342,-0.03071,0.00563,0.01791],"d":[484000,365000,48600,0,260000,45300,138000,102000,75300,242000,72500,409000,30100,643000,665000,23400,350000,380000,452000,73800,61600,65800,326000,146000,0,219000,118000,1110000,292000,500000,5690,33100,95000,125000,26900,7720,0,0,74900,117000,25800,27600],"n":66071,"w":484000},"ast":{"b":[-0.12427,-0.01243,-0.0029,0,0.03617,0.00737,-0.00927,0.03644,-0.02785,0.01815,0.02978,0.02158,-0.02628,0.01423,0.01872,-0.01534,0.01589,-0.00948,-0.02037,0.01574,-0.00771,0.00596,0.00981,-0.03055,0,-0.03762,-0.00606,-0.00289,0.00769,0.00831,-0.03966,-0.01128,0.03308,-0.02953,-0.09349,0.00828,0,0,0.00748,-0.03423,-0.01109,0.02976],"d":[201000,172000,9770,0,92700,16700,50100,29700,34100,101000,30600,160000,9660,248000,258000,6580,142000,156000,214000,34900,25000,15100,153000,41600,0,125000,69900,488000,120000,244000,2120,14700,38600,46800,5120,2580,0,0,38500,42200,11200,10400],"n":62959,"w":201000},"fg3m":{"b":[-0.07328,-0.02213,-0.00213,0,-0.00781,0.00586,-0.00729,-0.01314,0.00903,0.01505,-0.00404,0.07471,0.01017,-0.02048,0.00952,-0.01812,0.00944,-0.02026,-0.06195,-0.02572,0.06079,0.00475,-0.01315,-0.03929,0,-0.04964,0.00585,-0.01359,-0.02757,0.0421,0.01624,-0.01362,0.08139,-0.02503,-0.15715,0.00019,0,0,-0.00077,-0.01054,-0.01456,-0.03406],"d":[37800,30000,2740,0,19100,3670,10700,9250,6300,19000,5690,21400,1930,48100,53000,1750,25300,29600,43500,6900,4650,4530,26700,10000,0,18000,9790,92300,23100,39400,466,2850,7090,9450,1760,605,0,0,8730,8910,2170,2170],"n":50779,"w":37800}},"s30":{"min":{"b":[-0.08803,0.00685,0.02885,0,0.02582,-0.03134,0.01124,-0.00504,0.02071,-0.00827,-0.00063,0.02005,-0.01779,0.01009,-0.03664,-0.03757,-0.00921,-0.01327,0.00874,0.00806,-0.02759,-0.00149,0.0661,0.02724,0,0.03548,0.01491,-0.00591,0.01046,-0.03174,-0.01426,-0.01391,0,0,-0.11457,0.31761,0,0,0.00865,0.01858,-0.00193,-0.04464],"d":[7400000,5120000,893000,0,4260000,1080000,2320000,1980000,1080000,3700000,1110000,12400000,164000,9460000,14600000,505000,4700000,5940000,7650000,1430000,1800000,2270000,4870000,4220000,0,2870000,1290000,19400000,4230000,7300000,95500,760000,0,0,237000,146000,0,0,1520000,1940000,389000,462000],"n":66426,"w":7400000},"pts":{"b":[-0.02978,0.02286,-0.00929,0,-0.00288,-0.015,-0.02037,-0.0061,0.00503,0.00052,0.0068,-0.00479,-0.04331,-0.00562,0.01031,0.02176,-0.00578,0.02253,-0.01186,-0.07955,0.00681,0.07206,-0.03937,-0.04228,0,-0.04972,0.01647,-0.00607,-0.029,0.0867,-0.00106,-0.0075,0.12227,-0.06421,-0.0478,-0.13015,0,0,0.01112,-0.00959,0.00258,-0.0263],"d":[1490000,1140000,144000,0,746000,161000,404000,340000,238000,748000,225000,2540000,25000,1730000,2420000,70800,920000,1180000,1610000,336000,218000,277000,1060000,725000,0,900000,475000,3940000,841000,1670000,12400,134000,356000,321000,20700,36200,0,0,282000,337000,81500,93600],"n":66308,"w":1490000},"reb":{"b":[-0.09272,-0.00102,-0.03519,0,0.04567,-0.02158,-0.00774,-0.00572,-0.00553,0.00676,0.00692,0.00891,-0.02775,0.01989,0.00318,0.06212,0.01085,0.00507,-0.0178,-0.00391,-0.03428,0.04392,-0.01774,-0.01862,0,-0.0236,-0.02958,-0.00645,-0.01905,0.06118,0.01294,-0.04195,0.04817,0.00232,-0.02935,-0.12191,0,0,0.02213,-0.02065,0.02004,0.00325],"d":[258000,164000,44400,0,141000,28400,78000,61300,35500,129000,38700,221000,5340,317000,425000,16100,171000,204000,244000,40500,36000,70100,166000,181000,0,108000,55000,668000,149000,257000,3060,18500,64800,59100,5870,8270,0,0,40300,64800,13700,17000],"n":65876,"w":258000},"ast":{"b":[-0.09611,-0.01811,-0.04115,0,0.06248,-0.00705,-0.00536,0.03152,-0.03852,0.01831,0.03253,0.02473,-0.02637,0.021,0.04038,0.05138,0.00315,0.0035,-0.01036,0.00935,-0.05609,0.01916,-0.05233,-0.04334,0,-0.03888,0.02752,0.0049,-0.00448,0.03357,-0.05932,-0.01275,0.01107,-0.04295,-0.0607,-0.04285,0,0,-0.00125,-0.03213,-0.0021,-0.00038],"d":[100000,76900,9350,0,46900,9680,26800,17900,16200,50100,15300,82800,1510,113000,152000,4500,62500,78300,109000,19100,14600,16900,71600,47200,0,55900,30200,269000,55500,113000,1050,8190,24700,20500,1160,2650,0,0,19800,22300,5580,5890],"n":61687,"w":100000},"fg3m":{"b":[-0.07409,0.01039,-0.03822,0,-0.0016,0.00084,-0.00443,-0.01508,-0.00702,0.01279,0.00577,0.07423,-0.04694,-0.01569,0.01804,0.00738,0.02057,-0.00273,-0.05312,-0.04106,-0.00308,0.04934,-0.04255,-0.03015,0,-0.01976,0.01563,-0.00447,-0.04358,0.06638,0.0324,0.01641,0.04771,-0.06111,-0.0776,-0.13778,0,0,0.00885,-0.00453,0.00893,-0.06781],"d":[19900,13800,2510,0,10100,2300,5920,5470,3100,10000,3000,11800,275,23100,33900,1210,11900,15700,23400,4020,2770,5050,13200,12900,0,8310,4250,55300,11600,19300,245,1730,4770,4390,358,621,0,0,4600,4890,1130,1300],"n":47237,"w":19900}},"s36":{"min":{"b":[-0.06352,0.0751,0.01103,0,0.01546,-0.02727,0.01275,-0.00301,0.02619,-0.01185,0.00148,0.02163,0.00282,0.00643,-0.05084,-0.03975,-0.00738,-0.00251,0.01401,-0.02366,-0.0381,0.01493,-0.0089,0.02561,0,0.02003,0.0377,-0.00111,-0.02092,-0.01295,-0.0146,-0.02127,0,0,0.01636,-0.01895,0,0,0.0179,0.01714,-0.00101,-0.04774],"d":[3370000,2330000,441000,0,1930000,706000,1050000,1050000,490000,1690000,506000,5910000,162000,4280000,7940000,221000,2170000,2930000,3590000,749000,1030000,1540000,2130000,960000,0,1280000,533000,8960000,2110000,3420000,39900,420000,0,0,106000,86000,0,0,688000,887000,178000,225000],"n":66697,"w":3370000},"pts":{"b":[-0.08052,0.00342,0.03433,0,-0.01269,-0.06799,-0.01832,-0.03372,0.01733,0.00041,0.01184,-0.00679,-0.02691,0.00062,0.02217,-0.04854,-0.00648,0.00954,-0.01197,-0.09426,0.00983,0.06201,0.01007,0.00905,0,-0.05146,0.01243,-0.00392,0.02391,0.05585,-0.02037,0.00226,0.12864,-0.06903,-0.04051,-0.00216,0,0,-0.00223,0.00569,0.00793,-0.01224],"d":[661000,540000,50300,0,328000,85700,171000,168000,110000,332000,99500,1180000,31500,755000,1140000,28800,391000,574000,737000,147000,114000,160000,398000,173000,0,406000,221000,1730000,409000,769000,4750,62200,236000,127000,13600,10500,0,0,126000,146000,36900,39400],"n":65990,"w":661000},"reb":{"b":[-0.08963,-0.04291,-0.00314,0,0.03656,-0.03992,-0.00595,-0.0145,-0.00337,0.0039,0.00028,0.0163,-0.0055,0.01799,-0.01565,0.03341,0.00562,-0.00913,-0.02076,0.02369,-0.01334,0.02008,0.01462,-0.00635,0,-0.03711,-0.00954,-0.00547,0.02492,0.04114,-0.00619,-0.05022,0.04596,-0.0012,-0.01697,-0.01282,0,0,0.00465,-0.01808,0.02179,0.00862],"d":[116000,83900,14900,0,62900,16700,33300,31000,17800,58100,17500,109000,6830,141000,213000,6530,82200,100000,117000,19300,20900,40400,65300,39600,0,49200,25100,293000,71300,120000,1160,9390,43600,24300,3870,2400,0,0,18100,28100,6240,7270],"n":64119,"w":116000},"ast":{"b":[-0.1433,-0.0426,-0.02231,0,0.04799,-0.04788,-0.00679,0.02167,-0.02575,0.0087,0.03232,0.03273,-0.02776,0.01323,0.03836,0.00356,-0.00922,-0.00569,0.00132,0.00871,-0.03091,0.01104,-0.00641,-0.00278,0,-0.03213,0.03049,0.00803,0.01753,0.00872,-0.04214,-0.01637,-0.00384,-0.04399,-0.03897,0.05046,0,0,-0.00105,-0.02404,0.00592,0.01504],"d":[46600,38600,3150,0,21500,5270,11900,8970,7920,23300,7060,41800,2090,51700,74500,1840,28200,40300,52600,8640,7930,9750,27600,11900,0,26400,14500,124000,28800,54200,419,3940,17100,8380,758,814,0,0,9080,10000,2650,2580],"n":53021,"w":46600},"fg3m":{"b":[-0.10254,-0.0062,0.01023,0,-0.00774,-0.00927,-0.00449,-0.01259,0.0022,-0.00185,0.0198,0.07731,-0.03835,-0.01863,0.00807,-0.03608,0.01435,-0.01249,-0.05166,-0.06165,0.00797,0.05443,0.01885,0.01872,0,0.01064,-0.0193,0.00732,-0.00544,0.05404,0.00541,0.03386,0.00734,-0.05554,-0.06965,-0.08927,0,0,-0.02564,-0.00127,0.03398,-0.06401],"d":[8120,6210,787,0,4100,1180,2290,2600,1350,4070,1220,5490,341,9240,14900,452,4700,7080,9980,1620,1240,2810,5080,2190,0,3580,1920,22100,5040,8360,84,758,2910,1590,229,163,0,0,1900,1930,474,501],"n":33489,"w":8120}},"s42":{"min":{"b":[-0.26833,0.111,0.05869,0,0.01844,0.0461,0.01295,-0.01066,-0.00173,-0.02051,0.01442,0.02049,-0.06207,0.01196,-0.14756,-0.06548,0.00774,-0.00778,-0.00171,0.0142,-0.02462,0.11925,0.48217,-0.10338,0,-0.00228,0.08149,0.00063,0.00856,-0.03433,-0.01955,-0.00741,0,0,0.00639,-0.171,0,0,0.0057,0.00534,0.00972,-0.01895],"d":[891000,655000,110000,0,501000,210000,267000,262000,134000,446000,133000,1570000,14900,1240000,2270000,56100,552000,811000,965000,235000,324000,446000,644000,191000,0,352000,141000,2390000,574000,997000,8600,128000,0,0,28300,21400,0,0,178000,228000,47100,64800],"n":66788,"w":891000},"pts":{"b":[-0.11036,0.12797,0.16359,0,-0.02155,0.01729,-0.01046,0.00146,0.00101,0.00682,0.02925,0.02391,-0.00048,0.00231,-0.02256,-0.04502,-0.01204,0.01715,0.00037,-0.15331,-0.05679,0.14124,-0.09993,0.00968,0,0.00284,0.09398,-0.03038,0.02544,0.08639,-0.00538,-0.01546,0.13312,-0.10351,-0.06591,-0.14092,0,0,0.00043,0.02532,0.00671,-0.01487],"d":[195000,159000,16700,0,95600,28200,49600,43900,31000,98200,29400,341000,2340,243000,359000,8910,104000,174000,209000,39500,32700,66800,178000,8760,0,118000,62100,518000,128000,242000,1140,17000,76700,36300,4340,2590,0,0,35900,43200,10900,12500],"n":58019,"w":195000},"reb":{"b":[-0.10788,0.09279,0.06304,0,0.02733,0.03539,0.00935,-0.00023,-0.00037,0.0066,0.0271,0.02871,-0.02115,0.01913,-0.06424,-0.01426,0.00335,0.00725,0.00504,0.0053,-0.0526,0.11195,-0.03793,0.01943,0,-0.02206,0.04331,0.00328,0.02715,0.04975,0.01855,-0.06762,0.04067,-0.00726,-0.00072,-0.14065,0,0,0.00815,0.00767,0.02568,0.02599],"d":[35900,26200,4710,0,19200,5710,10100,8860,5340,18000,5410,34800,582,48000,70300,2140,25100,32400,35200,5570,6170,16600,33000,1640,0,14900,7390,90900,23100,39800,298,2800,14900,7320,1230,584,0,0,5350,8740,1940,2470],"n":46284,"w":35900},"ast":{"b":[-0.14776,0.029,0.03308,0,0.0375,-0.00847,-0.00359,0.03804,-0.01264,0.03016,0.05048,0.03861,-0.02447,0.01439,-0.00821,-0.01886,-0.01233,0.00319,0.02861,-0.00473,-0.04914,0.07895,-0.11428,0.01869,0,0.0033,0.07217,-0.01139,0.02753,0.01597,-0.04125,-0.01661,-0.04582,-0.0661,-0.06983,-0.04589,0,0,0.00342,0.00081,0.01974,-0.01396],"d":[14000,11700,937,0,6370,1620,3460,2280,2270,7000,2110,12900,153,17000,22700,539,7710,12500,15300,2360,2190,3600,13000,365,0,7900,4230,37400,9100,17400,101,1090,5640,2360,244,184,0,0,2620,3000,790,804],"n":31844,"w":14000},"fg3m":{"b":[-0.09492,0.01593,0.06767,0,0.00794,0.05008,0.01177,0.0227,-0.01111,0.021,0.04725,0.08685,-0.00396,-0.00441,-0.07111,0.00274,-0.01922,-0.00567,-0.0114,-0.0555,-0.02196,0.09388,-0.05158,-0.00845,0,0.06983,0.03702,-0.01032,0.00789,0.0836,0.0009,-0.00701,0.02146,-0.09793,-0.13914,-0.23596,0,0,-0.05949,0.02095,0.01082,-0.03481],"d":[1880,1450,200,0,924,278,508,562,300,942,282,1320,16.8,2320,3480,110,942,1680,2250,301,187,888,1830,14.9,0,885,478,5200,1250,2180,13.7,142,727,347,61,27.7,0,0,438,434,108,130],"n":13283,"w":1880}},"rep":{"min":{"b":[0.03922,-0.0454,-0.01937,0.00435,0.02123,-0.01574,0.00602,-0.03976,-0.00154,-0.00394,0.0018,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.03448,0,0,0,-0.00841,0,0,0,0,0,0,0,0,-0.00762,0.02237,-0.00063,0.01122],"d":[47500000,38000000,3320000,8410000,26900000,3390000,14500000,9520000,7840000,23800000,7160000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,19200000,0,0,0,48200000,0,0,0,0,0,0,0,0,9570000,12100000,2520000,2020000],"n":66284,"w":47500000},"pts":{"b":[-0.00077,0.01275,-0.01376,-0.00083,0.01109,-0.01768,-0.02196,-0.02114,0.00475,-0.00799,0.00304,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.05498,0,0,0,0.03798,0,0,0.12277,0,0,0,0,0,0.01074,-0.02012,0.00018,0.01038],"d":[11800000,10100000,543000,2070000,6260000,841000,3070000,2070000,2030000,5980000,1800000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7670000,0,0,0,13900000,0,0,1030000,0,0,0,0,0,2170000,2630000,634000,524000],"n":66284,"w":11800000},"reb":{"b":[-0.06235,0.01194,0.02164,-0.00961,0.05523,-0.00722,-0.00758,-0.01274,-0.00069,-0.00377,0.00523,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02546,0,0,0,0.03474,0,0,0.10096,0,0,0,0,0,0.00053,-0.03204,0.01024,0.00694],"d":[1840000,1390000,163000,325000,1020000,131000,533000,330000,289000,925000,279000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,798000,0,0,0,1830000,0,0,160000,0,0,0,0,0,274000,456000,97700,83400],"n":66251,"w":1840000},"ast":{"b":[-0.06409,0.00784,-0.00247,-0.01656,0.06534,-0.00763,-0.00201,0.02894,-0.01146,0.02035,0.03495,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.01304,0,0,0,0.02927,0,0,0.09236,0,0,0,0,0,0.01297,-0.02457,-0.015,-0.00442],"d":[742000,635000,33100,129000,356000,51700,185000,94900,126000,370000,113000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,441000,0,0,0,880000,0,0,67800,0,0,0,0,0,138000,158000,40700,32000],"n":65533,"w":742000},"fg3m":{"b":[-0.00589,-0.00455,-0.02992,-0.00795,0.00332,-0.00108,-0.01028,-0.05645,0.00794,0.00509,0.0075,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.0428,0,0,0,0.03571,0,0,0.11489,0,0,0,0,0,-0.00106,-0.01608,-0.00014,-0.05225],"d":[149000,119000,9890,26500,80000,10700,43000,31900,24700,75000,22600,0,0,0,0,0,0,0,0,0,0,0,0,0,0,67900,0,0,0,151000,0,0,12900,0,0,0,0,0,34100,36200,8190,6820],"n":57187,"w":149000}}};
// How often the simulated chances really came in over those games: [count, sum of chances, sum of hits] per 10% bin.
const CAL_PRIOR = {"pre":{"pts":[[[231985,2130.97,4086],[17422,2481.41,3490],[9551,2371.72,3163],[9494,3291.88,3965],[4638,2066.84,2422],[4908,2700.41,2977],[6134,3990.8,4242],[3133,2277.55,2397],[6,4.8,5],[0,0,0]],[[146915,4265.93,1497],[42673,6153.14,3684],[29468,7211.38,5911],[20863,7226.25,6947],[20970,9381.03,10359],[17910,9802.34,11160],[15573,10069.76,11494],[18192,13692.51,15321],[23375,19858.45,21082],[25663,24344.18,25015]]],"reb":[[[133442,1529.86,3064],[10298,1495.56,2473],[8139,1952.3,2744],[3246,1138.35,1571],[4407,1986.7,2506],[5209,2855.35,3429],[779,477.29,548],[0,0,0],[0,0,0],[0,0,0]],[[175361,4675.92,2400],[48660,6987.59,5109],[31691,7834.34,6862],[28091,9727.06,9691],[21998,9821.95,10364],[18765,10275.32,11277],[21810,14162,15784],[22945,17173.22,19080],[22559,19131.82,20509],[19376,18313.78,18889]]],"ast":[[[218410,2869.45,2909],[20854,3001.39,3311],[13238,3204.07,3624],[8241,2867.44,3394],[7652,3424.95,3889],[6476,3532.45,3929],[1117,686.29,756],[0,0,0],[0,0,0],[0,0,0]],[[52084,1845.89,909],[21929,3128.48,2239],[13643,3393.67,2842],[13127,4539.14,4462],[9543,4256.41,4393],[7651,4191.96,4569],[11073,7197.09,7982],[10646,7956.22,8813],[9924,8414.95,9062],[6974,6544.26,6779]]],"fg3m":[[[185230,2425.79,4994],[19205,2676.56,3894],[12928,3218.74,4166],[7380,2504.36,3106],[6161,2770.29,3235],[7572,4166.48,4680],[4212,2642.25,2860],[6,4.22,5],[0,0,0],[0,0,0]],[[56224,2606.87,2262],[31564,4617.1,4081],[19538,4759.35,4638],[17343,6065.13,6222],[14378,6411.5,6687],[10009,5449.89,5605],[11766,7715.59,8202],[15133,11309.82,11852],[11395,9617.62,9859],[2538,2340,2357]]]},"s6":{"pts":[[[437684,3188.3,5715],[24024,3424.09,4348],[14137,3479.76,4059],[11559,4002.81,4493],[7413,3317.33,3646],[6842,3745.84,3970],[6662,4317.26,4474],[3923,2882.87,2888],[2104,1787.12,1866],[1218,1136.32,1144]],[[122053,3398.04,1456],[32806,4721.65,3196],[22336,5471.94,4767],[16128,5594.91,5676],[15730,7035.81,7623],[13474,7373.9,8396],[12171,7876.16,8781],[14302,10754.5,11642],[16711,14190.87,14958],[28068,26927.29,27237]]],"reb":[[[306561,2870.6,4566],[20197,2915.74,3401],[12804,3079.44,3527],[6725,2349.82,2654],[6987,3130.01,3567],[7233,3955.44,4402],[1410,877.02,990],[971,737.9,863],[638,523.66,576],[0,0,0]],[[159000,3973.75,2453],[39984,5726.41,4846],[25556,6341.89,6096],[22370,7731.36,8014],[17698,7907.81,8394],[14533,7960.47,8671],[18443,11982.09,13112],[17538,13105.2,14071],[17294,14687.14,15465],[19367,18390.46,18719]]],"ast":[[[347150,3849.41,3653],[26682,3817.51,3906],[16053,3909.19,4190],[10278,3558.14,3835],[7170,3194.04,3552],[5711,3126.56,3457],[2234,1426.55,1580],[1998,1498.28,1622],[813,667.09,702],[0,0,0]],[[40865,1460.72,831],[16360,2346.15,1742],[10566,2616.04,2361],[9233,3185.24,3135],[7624,3409.66,3592],[6077,3321.19,3617],[7948,5168.63,5737],[7206,5380.94,5771],[7786,6625.93,7050],[7604,7183.34,7401]]],"fg3m":[[[307851,3631,6143],[29271,4102.49,4649],[18744,4639.79,4996],[10638,3612.46,3770],[8564,3852.05,3946],[9875,5430.28,5712],[5689,3572.82,3702],[6,4.25,5],[0,0,0],[0,0,0]],[[45464,2029.11,1684],[23603,3476.41,3243],[13572,3288.75,3064],[13518,4751.06,4929],[10777,4786.1,4892],[6452,3505.58,3565],[9321,6143.06,6350],[12197,9096.21,9307],[7234,6083.23,6125],[908,834.98,842]]]},"s12":{"pts":[[[462226,3191.01,4920],[23876,3400.7,3911],[14010,3430.78,3958],[10178,3525.02,3913],[7684,3440.31,3858],[7086,3873.41,4254],[6504,4219.46,4479],[5766,4299.39,4479],[5607,4760.02,4829],[3286,3067.59,3061]],[[98698,2708.36,1196],[25676,3696.23,2572],[16930,4158.2,3682],[13091,4535.99,4623],[11609,5185.82,5549],[10595,5808.55,6398],[10019,6492.2,7148],[10814,8118.11,8715],[12528,10645.44,11157],[24435,23445.17,23640]]],"reb":[[[338213,2973.4,4180],[21838,3118.72,3420],[12311,2979.3,3361],[7708,2687.44,3222],[5859,2615.8,3181],[6151,3371.9,3919],[2653,1699.16,2011],[3657,2756.64,3105],[1852,1520.98,1641],[0,0,0]],[[129076,3283.53,1748],[32303,4644.95,3663],[21136,5219.87,4809],[17266,5960.02,5921],[15056,6739.2,7161],[12362,6763.41,7209],[14377,9334.8,10245],[12874,9612.79,10339],[15585,13278.23,13978],[17075,16160.64,16442]]],"ast":[[[356493,3769.83,3181],[25482,3628.14,3582],[14994,3656.25,3900],[9612,3328.79,3651],[6559,2918.41,3358],[6016,3298.27,3742],[3677,2365.32,2627],[3393,2544.49,2798],[1377,1130.72,1203],[0,0,0]],[[31374,1160.11,634],[12712,1834.16,1298],[8529,2110.6,1874],[6774,2336.11,2282],[6235,2792.79,2913],[5001,2731.89,2997],[5895,3824.75,4179],[5159,3851.66,4143],[6667,5689.71,6040],[6070,5707.51,5853]]],"fg3m":[[[323667,3720.68,5936],[29717,4171.48,4688],[19436,4802.17,5157],[10253,3484.81,3812],[8389,3777.62,4132],[10269,5645.12,6130],[5815,3653.16,3755],[4,2.81,2],[0,0,0],[0,0,0]],[[33325,1486.76,1133],[17265,2564.77,2289],[9417,2268.56,2093],[10464,3685.31,3739],[7942,3521.99,3492],[4322,2345.1,2332],[7015,4644.25,4772],[9752,7266.33,7352],[4466,3734.25,3755],[328,301.07,299]]]},"s18":{"pts":[[[345827,2801.61,4185],[22300,3192.53,3829],[14024,3446.78,4010],[10520,3642.78,4103],[8663,3877.35,4303],[7923,4333.24,4536],[7413,4807.69,4916],[6970,5211.93,5281],[7066,5996.69,5985],[4995,4677.73,4606]],[[69163,1866.13,958],[17531,2522.43,1929],[11444,2814.72,2603],[8961,3105.38,3141],[7950,3556.4,3699],[7047,3865.07,4181],[7086,4593.35,4889],[7516,5631.47,5928],[8752,7443.3,7690],[19440,18698.8,18699]]],"reb":[[[246979,2634.01,3155],[20140,2874.38,3479],[12704,3097.16,3709],[9191,3212.09,3881],[6756,3002.81,3566],[7002,3845.78,4461],[4565,2936.21,3398],[5443,4091.51,4426],[2773,2283.84,2397],[0,0,0]],[[94692,2384.39,1363],[23136,3333.87,2647],[15202,3757.52,3537],[12012,4139.52,4116],[11054,4956.59,5099],[8902,4865.08,5120],[10385,6752.37,7249],[9047,6755.23,7087],[11814,10089.07,10486],[13122,12412.86,12513]]],"ast":[[[267606,3244.26,2593],[24482,3483.11,3548],[14066,3426.29,3758],[9346,3235.37,3693],[6869,3059.76,3500],[6387,3500.79,3994],[4164,2678.14,2957],[3754,2811.99,3041],[1681,1384.96,1463],[1,0.91,0]],[[21467,801.44,389],[8792,1271.39,967],[5928,1464.22,1296],[4615,1590.19,1575],[4496,2021.62,2103],[3391,1847.45,1973],[4073,2649.69,2807],[3594,2679.1,2851],[4843,4141.22,4335],[4468,4201.51,4265]]],"fg3m":[[[244462,3239.89,5070],[26076,3670.71,4509],[17991,4449.97,5103],[10611,3620.37,4059],[9440,4242.63,4631],[10175,5586.43,5911],[5951,3751.28,3771],[22,15.55,18],[0,0,0],[0,0,0]],[[21089,925.56,712],[11034,1656.31,1486],[5651,1354.58,1228],[7098,2514.12,2513],[5264,2328.18,2323],[2496,1350.48,1280],[4519,3011.18,3032],[7062,5249.19,5270],[2675,2234.72,2157],[181,166.64,160]]]},"s24":{"pts":[[[354063,2975.89,4430],[24298,3481.92,4053],[15382,3778.13,4371],[11753,4069.34,4384],[9971,4460.98,4709],[8860,4850.87,5019],[8411,5449.8,5526],[8156,6101.39,6090],[8173,6932.65,6825],[5793,5425.71,5263]],[[34561,967.46,577],[9113,1310.58,1027],[5843,1436.53,1358],[4792,1659.11,1623],[4056,1811.56,1882],[3655,2004.89,2138],[3784,2451.46,2549],[3933,2945.7,3095],[4526,3850.61,3954],[9941,9549.43,9500]]],"reb":[[[265634,2975.03,3293],[23471,3354.8,3956],[14737,3599.77,4211],[11140,3877.09,4516],[8227,3664.69,4292],[8331,4570.87,5239],[6256,4036.41,4496],[6648,4988.66,5400],[2992,2465.45,2577],[0,0,0]],[[53712,1438.82,778],[14157,2050.86,1606],[9181,2278.76,2044],[7143,2454.84,2398],[6938,3115,3172],[5170,2818.65,2915],[6482,4217.49,4378],[5208,3881.36,4058],[7473,6394.24,6561],[6641,6242.23,6250]]],"ast":[[[262841,3326.88,2627],[25259,3588.04,3633],[13985,3415,3766],[10098,3508.78,4023],[7707,3432.34,3935],[6414,3508.6,3937],[4370,2809.75,3134],[3754,2808.63,3065],[1640,1353.19,1429],[0,0,0]],[[8597,348.33,146],[4290,619.3,411],[2845,710.54,601],[2195,749.54,695],[2327,1046.55,1109],[1562,848.64,868],[2167,1413.5,1491],[1641,1219.38,1277],[2506,2150.87,2253],[1771,1652.68,1674]]],"fg3m":[[[242321,3324.52,5112],[27170,3850.35,4718],[18360,4528.6,5216],[12177,4192.87,4689],[11165,5002.72,5349],[10091,5517.45,5614],[4923,3105.99,3022],[10,7.03,8],[0,0,0],[0,0,0]],[[8072,357.31,252],[4684,714.88,558],[1855,434.73,338],[3563,1268.88,1202],[2144,943.48,858],[578,309.36,269],[2347,1576,1562],[3339,2467.11,2369],[602,499.22,478],[27,24.75,25]]]},"s30":{"pts":[[[396272,3100.11,4859],[25573,3660.29,4390],[16077,3943.63,4403],[12349,4277.82,4558],[10440,4665.9,4754],[9318,5101.57,5146],[8878,5755.35,5629],[8398,6281.39,6121],[8197,6949.45,6638],[4678,4373.27,4192]],[[6909,223.42,139],[2308,330.06,268],[1577,387.42,354],[1228,426.1,421],[1090,489.08,498],[995,545.85,577],[958,621.36,631],[1006,753.93,779],[1266,1077.83,1076],[2336,2238.27,2225]]],"reb":[[[314977,3479.03,3859],[27195,3880.3,4503],[16866,4123.68,4812],[12452,4323.96,4938],[9963,4445.38,5096],[9279,5093.56,5673],[7469,4819.36,5248],[6386,4771.35,5007],[2287,1884.35,1890],[0,0,0]],[[18717,542.96,284],[5616,815.78,580],[3611,899.48,778],[2762,948.25,878],[2951,1323.97,1279],[1890,1025.15,1010],[2759,1795.12,1814],[1958,1453.75,1440],[3174,2724.5,2740],[1911,1777.96,1724]]],"ast":[[[281839,3379.19,2704],[24590,3478.86,3533],[13901,3406.71,3805],[10394,3601.18,4044],[7256,3233.94,3592],[5535,3022.35,3331],[3822,2469.38,2708],[2658,1977.68,2103],[766,630.23,647],[0,0,0]],[[860,38.91,18],[607,90.45,45],[438,110.85,84],[323,109.13,98],[477,214.68,197],[198,106.75,95],[437,285.43,308],[209,153.87,164],[561,482.32,499],[190,175.04,172]]],"fg3m":[[[260773,3272.33,5001],[26041,3719.07,4374],[17917,4424.46,4960],[14330,4963.57,5185],[10857,4830.07,4853],[6685,3630.52,3433],[2101,1321.78,1236],[6,4.26,3],[0,0,0],[0,0,0]],[[1080,48.72,27],[823,126.85,92],[191,44.28,28],[792,280.35,243],[268,116.06,90],[53,28.34,24],[607,408.49,390],[529,387.53,358],[54,44.54,43],[0,0,0]]]},"s36":{"pts":[[[423033,2607.51,4876],[21284,3044.63,3774],[13319,3273.72,3618],[10276,3559.3,3711],[8812,3935.89,3858],[7896,4321.49,4143],[6871,4451.26,4093],[5879,4390.09,4003],[4423,3737.53,3438],[1958,1829.06,1745]],[[246,8.98,3],[128,18.51,11],[86,20.98,13],[76,26.1,24],[59,26.79,22],[74,40.49,28],[57,37.08,34],[62,45.95,41],[74,63.02,59],[175,167.47,159]]],"reb":[[[351548,3413.71,4167],[25867,3692.89,4302],[15735,3857.48,4442],[11742,4068.54,4544],[9117,4067.4,4472],[7579,4141.75,4366],[5183,3337.96,3394],[3230,2402.36,2362],[900,741.46,699],[0,0,0]],[[2085,76.42,31],[962,140.69,108],[692,173.48,143],[467,158.92,135],[619,279.28,268],[342,185.28,159],[579,378.64,374],[333,246.05,230],[711,613.13,612],[270,248.48,231]]],"ast":[[[298012,3009.46,2710],[20041,2855.74,3096],[12062,2945.34,3362],[7509,2591.47,2919],[4851,2156.29,2356],[3207,1747.02,1887],[1928,1238.97,1303],[760,562.6,581],[147,120.95,130],[0,0,0]],[[10,0.48,0],[15,2.46,0],[13,3.43,3],[9,2.93,2],[23,10.34,9],[5,2.64,3],[32,21,21],[6,4.32,3],[31,26.71,25],[6,5.5,6]]],"fg3m":[[[278056,2739.1,4548],[23449,3391.27,4035],[16462,4037.74,4305],[10446,3587.69,3509],[4998,2203.79,2059],[1555,835.57,768],[236,147.85,130],[1,0.71,0],[0,0,0],[0,0,0]],[[38,1.79,2],[45,7.07,6],[2,0.48,0],[47,16.55,14],[13,5.52,3],[0,0,0],[45,30.33,27],[25,18.24,18],[1,0.8,1],[0,0,0]]]},"s42":{"pts":[[[449875,1885.39,3410],[15619,2235.62,2457],[9381,2304.26,2266],[6574,2275.13,2195],[5112,2280.49,2197],[4194,2292.14,2164],[3213,2073.31,1920],[2291,1704.66,1612],[1383,1165.92,1107],[395,366.06,354]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"reb":[[[382014,2814.85,3105],[19698,2800.87,3006],[10578,2586.21,2838],[7160,2469.08,2777],[5254,2342.84,2554],[3105,1691.24,1780],[1749,1124.08,1181],[923,684.08,702],[179,146.52,154],[0,0,0]],[[43,1.12,0],[11,1.69,2],[12,3.16,1],[5,1.72,1],[14,6.24,6],[1,0.57,0],[23,14.8,15],[3,2.15,1],[20,17.15,17],[2,1.89,2]]],"ast":[[[319726,2342.78,1958],[14165,2003.45,2207],[6369,1549.7,1834],[3536,1216.57,1353],[1936,854.37,946],[830,448.06,491],[213,135.05,157],[26,18.81,20],[2,1.62,1],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"fg3m":[[[303178,2237.11,3379],[17523,2508.18,2897],[8577,2064.71,2073],[2963,998.31,986],[586,253.22,228],[72,38.31,37],[8,5.01,6],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]]},"rep":{"pts":[[[187210,1800.43,3018],[15204,2157.36,2952],[8656,2155.75,2867],[8955,3114.91,3827],[4431,1974.07,2278],[4713,2593.55,2862],[6072,3948.83,4304],[3940,2879.84,2956],[21,16.98,18],[0,0,0]],[[149530,4153.95,1747],[40483,5854.97,3838],[27600,6751.68,5772],[19691,6819.5,6799],[19904,8905.8,9832],[17133,9376.49,10611],[14887,9626.84,10846],[16948,12760.95,13986],[22925,19472.45,20503],[28253,26893.24,27322]]],"reb":[[[98789,1203.49,1964],[8062,1183.13,1782],[6889,1650.6,2288],[2758,971.12,1357],[3988,1797.71,2301],[5189,2850.54,3446],[1085,668.38,771],[0,0,0],[0,0,0],[0,0,0]],[[175686,4528.53,2729],[46295,6646.12,5313],[29669,7344.14,6730],[26753,9258.05,9541],[20840,9307.55,9864],[17716,9695.45,10565],[20681,13443.1,14951],[22069,16522.25,18049],[22269,18893.19,20035],[21534,20416.95,20779]]],"ast":[[[186725,2593.89,2286],[19349,2793.48,3022],[12959,3140.24,3585],[8224,2870.7,3346],[7684,3439.05,3872],[6361,3475.62,3851],[1260,776.62,810],[0,0,0],[0,0,0],[0,0,0]],[[53019,1830.6,1032],[21186,3010.59,2267],[13388,3340.68,3053],[12442,4301.2,4210],[9198,4100.72,4277],[7374,4038.49,4344],[10525,6847.48,7492],[10374,7755.49,8477],[9932,8418.66,8928],[7704,7257.12,7425]]],"fg3m":[[[155393,2130.9,4096],[16775,2332.04,3292],[12057,3003.55,3833],[6914,2342.37,2853],[5776,2599.92,3089],[7379,4060.33,4521],[4615,2903.55,3120],[11,7.76,6],[0,0,0],[0,0,0]],[[56966,2573.97,2287],[30940,4510.84,4148],[18989,4618.29,4518],[16773,5868.34,6102],[14198,6330.61,6513],[9868,5378.87,5551],[11303,7412.09,7778],[14992,11202.71,11642],[11743,9916.56,10103],[3012,2782.63,2772]]]}};
/**
* Coefficients from the built-in lessons plus whatever this phone has graded since (dev = patEmpty()
* sums). With nothing new graded this is exactly the built-in set.
*/
// How each team's points still to come really ran against the sum of our player numbers, per stage:
// [team-games graded, sum of our points still to come, sum of the real ones]. Learned with every other lesson applied.
const TEAM_PRIOR = {"pre":[7418,841402,831601],"s6":[7418,722808,727481],"s12":[7418,617088,621313],"s18":[7418,516233,523104],"s24":[7418,407487,413557],"s30":[7418,301342,308098],"s36":[7418,197909,202147],"s42":[7418,103022,106041],"rep":[7418,835249,831601]};
/** The team check factor per stage from the built-in record plus what this phone has graded (shrunk toward 1, capped). */
function teamTableFrom(dev, prior) {
const out = {};
for (const g of PAT_GROUPS) {
const P0 = (prior && prior[g]) || [0, 0, 0], T = (dev && dev[g]) || [0, 0, 0];
const n = P0[0] + T[0], sp = P0[1] + T[1], sa = P0[2] + T[2];
if (n < 100 || !(sp > 0)) continue;
const K = 60 * (sp / n);
out[g] = +clamp((sa + K) / (sp + K), 0.85, 1.15).toFixed(4);
}
return out;
}
function patBeta(dev, lam) {
const L = lam != null ? lam : TUNE.patLam;
const out = { n: 0, graded: 0 };
for (const g of PAT_GROUPS) {
out[g] = {};
for (const s of PAT_LEARN) {
const P0 = PAT_PRIOR[g] && PAT_PRIOR[g][s];
let T = dev && dev[g] && dev[g][s];
if (T && (!T.A || T.A.length !== PAT_D * PAT_D)) T = null;
if (!P0) { out[g][s] = null; continue; }
const A = T ? T.A.slice() : new Array(PAT_D * PAT_D).fill(0);
const b = T ? T.b.slice() : new Array(PAT_D).fill(0);
const avg0 = P0.w / Math.max(P0.n, 1);
for (let i = 0; i < PAT_D; i++) { const di = (P0.d[i] || 0) + L * avg0 * 25 * PAT_LAMF[i]; A[i * PAT_D + i] += di; b[i] += di * (P0.b[i] || 0); }
out[g][s] = solveLin(A, b, PAT_D).map((v) => +v.toFixed(5));
out.n = Math.max(out.n, P0.n + (T ? T.n : 0));
out.graded = Math.max(out.graded, T ? T.n : 0);
}
}
out.cal = calTable(dev && dev.cal);
out.team = teamTableFrom(dev && dev.team, TEAM_PRIOR);
return out;
}
/** The correction factor and each feature's share of it. */
function patApply(beta, x, cap, shift, capUp) {
let z = 0;
const c = cap != null ? cap : TUNE.patCap;
const cu = capUp != null ? capUp : c;
const parts = new Array(PAT_D).fill(0);
for (let i = 0; i < PAT_D; i++) { parts[i] = (beta[i] || 0) * x[i]; z += parts[i]; }
// shift: the team's average usage-shift, taken back out so one player's extra shots come off his teammates'
const zz = z - (shift || 0);
return { f: 1 + TUNE.patW * clamp(zz, -c, cu), z: zz, parts, shift: shift || 0 };
}
/** The usage-shift part of a correction (hot/cold starts, real usage, luck): the part that is shared inside a team. */
function patShiftPart(beta, x) { let z = 0; for (const k of PAT_SHIFT) { const i = PAT_IX[k]; z += (beta[i] || 0) * x[i]; } return z; }
// ---- learned calibration of the chances: when the simulations said 70%, how often did it happen?
// Counted in 10 probability bins per stage, stat and "a lot / a little still to come". The sums add up
// across nights, so the phone keeps learning; the map is kept monotone and shrunk toward "as simulated".
const CAL_STATS = ['pts', 'reb', 'ast', 'fg3m'];
const CAL_LEVEL = { pts: 9, reb: 2.5, ast: 2.5, fg3m: 1.2 }; // expected amount still to come that counts as "a lot"
const calLevel = (s, rem) => (rem >= CAL_LEVEL[s] ? 1 : 0);
function calEmpty() { const o = {}; for (const g of PAT_GROUPS) { o[g] = {}; for (const s of CAL_STATS) o[g][s] = [0, 1].map(() => Array.from({ length: 10 }, () => [0, 0, 0])); } return o; }
function calObs(acc, g, s, lvl, p, y) { const c = acc[g] && acc[g][s] && acc[g][s][lvl]; if (!c) return; const b = c[Math.min(9, Math.floor(p * 10))]; b[0]++; b[1] += p; b[2] += y; }
function calAdd(acc, more, wt = 1) {
for (const g of PAT_GROUPS) for (const s of CAL_STATS) for (const l of [0, 1]) { const m = more && more[g] && more[g][s] && more[g][s][l]; if (!m) continue; const a = acc[g][s][l]; for (let i = 0; i < 10; i++) if (m[i]) for (let j = 0; j < 3; j++) a[i][j] += wt * (m[i][j] || 0); }
return acc;
}
/** Calibration maps from the built-in record plus what this phone has graded: { group: { stat: [map, map] } }, map = [[x...], [y...]]. */
function calTable(dev) { return calTableFrom(dev, CAL_PRIOR); }
function calTableFrom(dev, prior) {
const CAL_P = prior || {};
const out = {};
for (const g of PAT_GROUPS) {
out[g] = {};
for (const s of CAL_STATS) out[g][s] = [0, 1].map((l) => {
const P0 = (CAL_P[g] && CAL_P[g][s] && CAL_P[g][s][l]) || [], T = (dev && dev[g] && dev[g][s] && dev[g][s][l]) || [];
const pts = [];
for (let i = 0; i < 10; i++) {
const a = P0[i] || [0, 0, 0], b = T[i] || [0, 0, 0];
const n = a[0] + b[0];
if (n < 30) continue;
const x = (a[1] + b[1]) / n, K = 40;
pts.push([x, ((a[2] + b[2]) + K * x) / (n + K), n]);
}
// keep it monotone (pool neighbours that run backwards)
for (let i = 1; i < pts.length; i++) if (pts[i][1] < pts[i - 1][1]) { const n = pts[i][2] + pts[i - 1][2]; const y = (pts[i][1] * pts[i][2] + pts[i - 1][1] * pts[i - 1][2]) / n; pts[i][1] = y; pts[i - 1][1] = y; pts[i][2] = n; pts[i - 1][2] = n; i = Math.max(0, i - 2); }
return [[0].concat(pts.map((q) => +q[0].toFixed(4)), [1]), [0].concat(pts.map((q) => +q[1].toFixed(4)), [1])];
});
}
return out;
}
/** A simulated chance → the calibrated chance (straight lines between the learned points). */
function calP(map, p) {
if (!map || !(p > 0) || p >= 1) return p;
const xs = map[0], ys = map[1];
for (let i = 1; i < xs.length; i++) if (p <= xs[i]) { const d = xs[i] - xs[i - 1]; return d > 0 ? ys[i - 1] + ((p - xs[i - 1]) / d) * (ys[i] - ys[i - 1]) : ys[i]; }
return p;
}
/** The calibrated chance for one player's stat line (pra and anything unlearned stay as simulated). */
function calProb(player, stat, p) { const m = player && player.cal && player.cal[stat]; return m ? calP(m, p) : p; }
/** What the phone has learned, packed small for storage (each table is symmetric: keep the upper half; skip empty stages). */
function patPack(sum) {
const out = { v: 2, acc: sum.acc || null, cal: sum.cal || null, team: sum.team || null, g: {} };
const r5 = (x) => +(+x).toPrecision(5);
for (const g of PAT_GROUPS) { if (!sum[g]) continue; for (const s of PAT_LEARN) { const T = sum[g][s]; if (!T || !T.n) continue; const u = []; for (let i = 0; i < PAT_D; i++) for (let j = i; j < PAT_D; j++) u.push(r5(T.A[i * PAT_D + j])); (out.g[g] = out.g[g] || {})[s] = { u, b: T.b.map(r5), n: T.n, w: r5(T.w) }; } }
return out;
}
function patUnpack(pk) {
const sum = patEmpty();
if (!pk || pk.v !== 2) return sum;
for (const g of Object.keys(pk.g || {})) for (const s of Object.keys(pk.g[g])) {
const T = sum[g] && sum[g][s], P = pk.g[g][s];
if (!T || !P || !P.u || P.u.length !== (PAT_D * (PAT_D + 1)) / 2) continue;
let k = 0; for (let i = 0; i < PAT_D; i++) for (let j = i; j < PAT_D; j++) { T.A[i * PAT_D + j] = P.u[k]; T.A[j * PAT_D + i] = P.u[k]; k++; }
T.b = P.b.slice(); T.n = P.n; T.w = P.w;
}
if (pk.acc) patAdd(sum, { acc: pk.acc });
if (pk.cal) patAdd(sum, { cal: pk.cal });
if (pk.team) patAdd(sum, { team: pk.team });
return sum;
}
/** Keep only the minutes lessons (the nightly learning grades the stats on top of corrected minutes). */
function patMinOnly(beta) { if (!beta) return null; const out = { n: beta.n, graded: beta.graded, minOnly: true }; for (const g of PAT_GROUPS) out[g] = { min: beta[g] ? beta[g].min : null }; return out; }
/** Tonight's usage detail from the play-by-play: plays run while each player was on the floor, his own plays, the last 6 on-court minutes, and what his shots are normally worth. */
function liveUsage(plays, box, el) {
const ev = {};
for (const p of plays || []) {
const ab = p.team && p.team.abbreviation; if (!ab) continue;
let w = 0;
if (p.shooting_play) w = String(p.text || '').includes('free throw') ? 0.44 : 1; else if (String(p.type || '').includes('Turnover')) w = 1;
if (!w) continue;
(ev[ab] = ev[ab] || []).push([elapsedSec(p.period, p.clock) / 60, w, (p.participants || [])[0]]);
}
const out = {};
for (const r of Object.values(box || {})) {
const st = r.stints || [];
let need = 6, cut = el;
for (let i = st.length - 1; i >= 0 && need > 0; i--) { const d = Math.min(st[i][1] - st[i][0], need); cut = st[i][1] - d; need -= d; }
let onPlays = 0, onPlaysR = 0, playsR = 0;
for (const [u, w, who] of ev[r.team] || []) {
let inS = false;
for (let i = 0; i < st.length; i++) if (u >= st[i][0] - 0.02 && u <= st[i][1] + 0.02) { inS = true; break; }
if (!inS) continue;
onPlays += w;
if (u >= cut) { onPlaysR += w; if (who === r.pid) playsR += w; }
}
out[r.pid] = { onPlays, onPlaysR, playsR, minR: 6 - need, plays: r.fga + 0.44 * r.fta + r.tov, shots: r.fga + r.fta };
}
return out;
}


// ---------------------------------------------------------------- situational scoring tendencies
// From the scoring timeline of each recent game: how a player scores by quarter, when his team is
// ahead / close / behind, in crunch time, with the team's top scorer on or off the floor, at home or on
// the road, on back-to-backs, how his hot (or cold) starts carry into the second half, and how one
// game's form carries into the next. Each split is a rate vs his own normal rate, shrunk toward 1.
const SIT_CATS = ['q1', 'q2', 'q3', 'q4', 'ahead', 'close', 'behind', 'clutch', 'starOn', 'starOff', 'home', 'away', 'b2b', 'rest'];
/** The team's top scorer in these logs (points per game, regulars only). */
function teamStar(logs, tm) {
const t = {};
for (const lg of logs) for (const [pid, r] of Object.entries(lg.rows)) {
if (r.team !== tm || !(r.min > 0)) continue;
const x = (t[pid] = t[pid] || { pts: 0, min: 0, g: 0, name: r.name });
x.pts += r.pts; x.min += r.min; x.g++;
}
let best = null, bp = 0;
for (const [pid, x] of Object.entries(t)) if (x.g >= 3 && x.min / x.g >= 20 && x.pts / x.g > bp) { bp = x.pts / x.g; best = { pid: +pid, name: x.name, ppg: x.pts / x.g, mpg: x.min / x.g }; }
return best;
}
/**
* Raw situational totals for one player: points and minutes in each situation, plus the
* first-half → second-half and game → next-game pairs that show his scoring curve.
* o.team: his team (string), or null to follow him across teams (season prior).
* o.starOf(team) → that team's top scorer pid. Star on/off is only counted on o.starTeam.
*/
function sitAgg(logs, pid, o) {
const c = {};
for (const k of SIT_CATS) c[k] = [0, 0];
let P = 0, M = 0;
const halves = [], games = [];
const sorted = logs.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
const datesBy = {};
for (const lg of sorted) for (const t of Object.keys(lg.margin || {})) (datesBy[t] = datesBy[t] || []).push(String(lg.date).slice(0, 10));
const DT = 0.25;
for (const lg of sorted) {
const row = lg.rows[pid];
if (!row || (o.team && row.team !== o.team) || !Array.isArray(row.st) || !Array.isArray(lg.sc)) continue;
const tm = row.team, side = lg.v === tm ? 0 : 1, len = lg.len || 48;
const T = [], Mg = [];
let m = 0;
for (const e of lg.sc) { m += (e[1] === side ? 1 : -1) * e[2]; T.push(e[0]); Mg.push(m); }
const mAt = (u) => { let lo = 0, hi = T.length - 1, k = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (T[mid] <= u) { k = mid; lo = mid + 1; } else hi = mid - 1; } return k < 0 ? 0 : Mg[k]; };
const sp = tm === o.starTeam && o.starOf ? o.starOf(tm) : null;
const starId = sp != null && +sp !== +pid ? +sp : null;
const sRow = starId != null ? lg.rows[starId] : null;
const sSt = sRow && sRow.team === tm && Array.isArray(sRow.st) ? sRow.st : null;
const starOn = (u) => !!(sSt && sSt.some(([a, b]) => u >= a && u < b));
const d = String(lg.date).slice(0, 10), td = datesBy[tm] || [], di = td.indexOf(d);
const isB2b = di > 0 && td[di - 1] === addDaysStr(d, -1);
const gameCats = [side === 1 ? 'home' : 'away', isB2b ? 'b2b' : 'rest'];
const catsAt = (u, own) => {
// a basket belongs to the score it was scored at: take his own points back out of the margin (v15; before, scoring itself pushed baskets into "ahead")
const mm = mAt(u) - (TUNE.sitPre > 0 && own ? own : 0);
const out = ['q' + Math.min(4, Math.floor(u / 12) + 1), mm >= 12 ? 'ahead' : mm <= -12 ? 'behind' : 'close'];
if (u >= len - 5 && Math.abs(mm) <= 5) out.push('clutch');
if (starId != null) out.push(starOn(u) ? 'starOn' : 'starOff');
return out;
};
let gp = 0, gm = 0, p1 = 0, m1 = 0;
for (const [a, b] of row.st) {
for (let u = a; u < b; u += DT) {
const dt = Math.min(DT, b - u), mid = u + dt / 2;
for (const k of catsAt(mid)) c[k][1] += dt;
for (const k of gameCats) c[k][1] += dt;
gm += dt; if (mid < 24) m1 += dt;
}
}
const onAt = (u) => row.st.some(([a, b]) => u >= a - 0.1 && u <= b + 0.1);
for (const e of lg.sc) {
if (e[3] !== +pid || e[1] !== side || !onAt(e[0])) continue;
for (const k of catsAt(e[0], e[2])) c[k][0] += e[2];
for (const k of gameCats) c[k][0] += e[2];
gp += e[2]; if (e[0] < 24) p1 += e[2];
}
if (gm <= 0) continue;
P += gp; M += gm;
halves.push([p1, m1, gp - p1, gm - m1]);
games.push([gp, gm]);
}
return { c, P, M, halves, games };
}
/** Curve sums against a base rate: [Σw·d1·d2, Σw·d1²] for halves, same for game → next game. */
function sitCurve(A, base) {
let sxy = 0, sxx = 0, gxy = 0, gxx = 0;
for (const [a1, b1, a2, b2] of A.halves) {
if (b1 < 6 || b2 < 6) continue;
const d1 = clamp(a1 / b1 / base - 1, -1, 2), d2 = clamp(a2 / b2 / base - 1, -1, 2), w = Math.min(b1, b2) / 12;
sxy += w * d1 * d2; sxx += w * d1 * d1;
}
for (let i = 1; i < A.games.length; i++) {
const [pa, ma] = A.games[i - 1], [pb, mb] = A.games[i];
if (ma < 10 || mb < 10) continue;
const d1 = clamp(pa / ma / base - 1, -1, 2), d2 = clamp(pb / mb / base - 1, -1, 2);
gxy += d1 * d2; gxx += d1 * d1;
}
return [sxy, sxx, gxy, gxx];
}
/** A compact season prior for one player (built from last season's play-by-play). */
function sitPriorOf(logs, pid, starOf) {
const mins = {};
for (const lg of logs) { const r = lg.rows[pid]; if (r && r.min > 0) mins[r.team] = (mins[r.team] || 0) + r.min; }
const main = Object.keys(mins).sort((a, b) => mins[b] - mins[a])[0];
if (!main) return null;
const A = sitAgg(logs, pid, { team: null, starTeam: main, starOf });
if (A.M < 200 || !(A.P / A.M > 0.05)) return null;
const r1 = (x) => Math.round(x * 10) / 10, r3 = (x) => Math.round(x * 1000) / 1000;
const cv = sitCurve(A, A.P / A.M).map(r3);
const sp = starOf(main);
return { t: main, s: sp != null && +sp !== +pid ? +sp : null, P: r1(A.P), M: r1(A.M), c: SIT_CATS.map((k) => [r1(A.c[k][0]), r1(A.c[k][1])]), cv };
}
/** Read the shipped season prior: "pid,star,P,M, then pts,min for q1..q4, ahead, close, behind, clutch, starOn, starOff, then streak sums;…". */
const SIT_PRIOR_CATS = 10;
function sitPriorParse(txt) {
const out = {};
if (!txt) return out;
for (const row of String(txt).split(';')) {
const a = row.split(',').map(Number);
if (a.length < 6 + SIT_PRIOR_CATS * 2 || !(a[3] > 0)) continue;
const c = SIT_CATS.map((k, i) => (i < SIT_PRIOR_CATS ? [a[4 + 2 * i], a[5 + 2 * i]] : [0, 0]));
const g = 4 + SIT_PRIOR_CATS * 2;
out[a[0]] = { s: a[1] || null, P: a[2], M: a[3], c, cv: [0, 0, a[g], a[g + 1]] };
}
return out;
}
let SIT_PRIOR_CACHE = null;
function sitPriorShipped() { if (!SIT_PRIOR_CACHE) SIT_PRIOR_CACHE = typeof self !== 'undefined' && self.SIT_PRIOR_TXT ? sitPriorParse(self.SIT_PRIOR_TXT) : {}; return SIT_PRIOR_CACHE; }
function sitProfile(logs, pid, tm, star, prior) {
const starId = star && +star.pid !== +pid ? +star.pid : null;
const A = sitAgg(logs, pid, { team: tm, starTeam: tm, starOf: () => (star ? star.pid : null) });
const pr = prior && prior.M > 0 ? prior : null;
const lam = pr ? TUNE.sitPriorW : 0;
const bCur = A.M >= 30 && A.P > 0 ? A.P / A.M : null, bPr = pr ? pr.P / pr.M : null;
if (bCur == null && bPr == null) return null;
// put last season's points on this season's scoring level before blending
const sc = bCur != null && bPr ? bCur / bPr : 1;
const M = A.M + lam * (pr ? pr.M : 0), P = A.P + lam * (pr ? pr.P * sc : 0);
if (M < 30) return null;
const base = P / M;
if (!(base > 0.05)) return null;
const sameStar = pr && starId != null && pr.s === starId;
const c = {};
SIT_CATS.forEach((k, i) => {
const usePr = pr && (pr.c[i][1] > 0 || pr.c[i][0] > 0) && (k !== 'starOn' && k !== 'starOff' ? true : sameStar);
c[k] = [A.c[k][0] + (usePr ? lam * pr.c[i][0] * sc : 0), A.c[k][1] + (usePr ? lam * pr.c[i][1] : 0)];
});
const K = TUNE.sitK;
const ratio = {};
for (const k of SIT_CATS) ratio[k] = clamp((c[k][0] + K * base) / ((c[k][1] + K) * base), 0.6, 1.6);
const cv = sitCurve(A, base);
const pc = pr ? pr.cv : [0, 0, 0, 0];
const fade = (cv[0] + lam * pc[0]) / (cv[1] + lam * pc[1] + TUNE.sitFadeK);
const streak = (cv[2] + lam * pc[2]) / (cv[3] + lam * pc[3] + TUNE.sitStreakK);
const last = A.games.length ? A.games[A.games.length - 1] : null;
const offShare = c.starOn[1] + c.starOff[1] > 0 ? c.starOff[1] / (c.starOn[1] + c.starOff[1]) : null;
return { base, min: M, games: A.games.length, c, ratio, fade, streak, lastDev: last && last[1] >= 10 ? clamp(last[0] / last[1] / base - 1, -1, 2) : 0, star: starId != null ? star : null, offShare, prior: !!pr };
}
/** Tonight's situational multiplier on his scoring, for one simulated game script. */
function sitFactor(S, o) {
const R = S.ratio, W = TUNE;
const parts = {};
// quarters still to play, weighted by his minutes in each
let qs = 0, qw = 0;
for (const q of [1, 2, 3, 4]) { const w = o.qRem[q] || 0; qs += w * R['q' + q]; qw += w; }
parts.q = qw > 0 ? qs / qw : 1;
// game script: before the 4th from the current lead, the 4th from the simulated lead after three
const st = (mm) => (mm >= 12 ? R.ahead : mm <= -12 ? R.behind : R.close);
const pre = qw > 0 ? (qw - (o.qRem[4] || 0)) / qw : 0, q4 = 1 - pre;
const cl = Math.min(o.clutchShare, 1);
const q4f = Math.abs(o.m3) <= 6 ? (1 - cl) * R.close + cl * R.clutch : st(o.m3);
parts.state = qw > 0 ? pre * st((o.m0 + o.m3) / 2) + q4 * q4f : 1;
parts.home = o.home ? R.home : R.away;
parts.rest = o.b2b ? R.b2b : R.rest;
// the team's top scorer off the floor: who takes over his shots
if (S.star && S.offShare != null) {
const h = S.offShare, f = clamp(h + o.starOffShift, 0, 1);
parts.star = (f * R.starOff + (1 - f) * R.starOn) / (h * R.starOff + (1 - h) * R.starOn);
} else parts.star = 1;
parts.fade = o.d1 != null ? clamp(1 + S.fade * o.d1, 0.8, 1.25) : 1;
parts.streak = clamp(1 + S.streak * S.lastDev, 0.88, 1.12);
let f = 1;
f *= Math.pow(parts.q, W.sitQW) * Math.pow(parts.state, W.sitStateW) * Math.pow(parts.home, W.sitHomeW) * Math.pow(parts.rest, W.sitRestW);
f *= Math.pow(parts.star, W.sitStarW) * Math.pow(parts.fade, W.sitFadeW) * Math.pow(parts.streak, W.sitStreakW);
return { f: clamp(f, 0.7, 1.35), parts };
}

const LADDERS = {
pts: [5, 10, 15, 20, 25, 30, 35, 40, 45],
reb: [2, 4, 6, 8, 10, 12, 14, 16],
ast: [2, 4, 6, 8, 10, 12],
fg3m: [1, 2, 3, 4, 5, 6],
pra: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
};

/**
* The live context behind a projection, in plain words: rotation, fouls, role, usage, game script.
* Each item: { icon, text, so, effect: 'up' | 'down' | 'info' }. text says what is happening;
* so says what it does to his number and to the pick.
*/
const sgn1 = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
const pct0 = (x) => `${Math.round(x * 100)}%`;
/** His projected stat per remaining minute (what one minute more or less is worth). */
function perMin(c, s) { return c.minProj > 0.5 ? Math.max(c.proj[s] - c.now[s], 0) / c.minProj : 0; }
function remOf(c, s) { return Math.max(c.proj[s] - c.now[s], 0); }
/** "+1.8 pts, +0.6 reb" for a change of dmin minutes. */
function minEffect(c, dmin) {
const parts = [['pts', 'pts'], ['reb', 'reb'], ['ast', 'ast']].map(([s, l]) => [dmin * perMin(c, s), l]).filter(([v]) => Math.abs(v) >= 0.2);
return parts.length ? parts.map(([v, l]) => `${sgn1(v)} ${l}`).join(', ') : `${sgn1(dmin)} min`;
}
const helps = (what) => `Helps his picks: about ${what} on his projection.`;
const cuts = (what) => `Already taken off his number: about ${what}. Any edge shown is after this.`;
const lastName = (n) => { const w = String(n).split(' ').filter((x) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(x)); return w[w.length - 1] || String(n); };

function explain(p, r, c) {
const out = [];
const ri = p.rotInfo;
const remPlayed = Math.max(c.minProj, 0);
if (r.ejected) out.push({ icon: '🟥', text: 'Ejected: he is done for the night.', so: 'His projection is locked at what he has now, so skip any pick that needs more from him.', effect: 'down' });
else if (r.pf >= 6) out.push({ icon: '🟥', text: 'Fouled out: he is done for the night.', so: 'His projection is locked at what he has now, so skip any pick that needs more from him.', effect: 'down' });
if (ri) {
const usual = ri.remMap;
const dmin = remPlayed - usual;
const minSo = dmin < -0.3 ? `${cuts(minEffect(c, dmin))} He's projected for ${remPlayed.toFixed(1)} more minutes instead of his usual ${usual.toFixed(1)}.` : `He's still projected for ${remPlayed.toFixed(1)} more minutes, close to his usual ${usual.toFixed(1)}.`;
const fr = (TUNE.foulRest || {})[ri.foulLvl] || [1, 1];
const restBites = ri.foulRest && Math.min(fr[0], fr[1]) < 0.95;
if (restBites && ri.foulSit) out.push({ icon: '⚠️', text: `Sitting with ${r.pf} fouls. This coach usually rests a player in this spot until about ${clockLabel(ri.foulRest)}, then puts him back in.`, so: minSo, effect: 'down' });
else if (restBites && r.on) out.push({ icon: '⚠️', text: `${r.pf} fouls and still playing. The coach is letting him play through it for now, but a rest before ${clockLabel(ri.foulRest)} is likely.`, so: minSo, effect: 'down' });
else if (r.pf >= 4 && r.pf < 6 && c.el < 44) out.push({ icon: 'ℹ️', text: `${r.pf} fouls, but coaches this season mostly keep players in with ${r.pf === 4 ? '4 fouls in the 3rd quarter' : 'foul trouble this late'}.`, so: 'Only a small trim to his minutes, so his number barely moves.', effect: 'info' });
if (!r.on && !ri.foulSit && ri.benched < 0.5) out.push({ icon: '🪑', text: `Out of the rotation: he's been on the bench for ${fmtMin(ri.sitFor)}, when he'd normally have played ${ri.missed.toFixed(1)} of those minutes. Either he's hurt or the coach has gone away from him.`, so: `${cuts(minEffect(c, dmin))} Only ${remPlayed.toFixed(1)} more minutes projected.`, effect: 'down' });
else if (!r.on && !ri.foulSit && ri.missed >= 2) out.push({ icon: '🪑', text: `Longer rest than usual: ${fmtMin(ri.sitFor)} on the bench. Watch whether he checks back in.`, so: dmin < -0.3 ? cuts(minEffect(c, dmin)) : 'His number assumes he comes back on his normal schedule.', effect: 'down' });
if (r.on && ri.stintAvg && p.r.stints && p.r.stints.length) {
const cur = c.el - p.r.stints[p.r.stints.length - 1][0];
if (cur > ri.stintAvg + 2) out.push({ icon: '🔄', text: `On the floor for ${fmtMin(cur)} straight; his usual stretch is ${fmtMin(ri.stintAvg)}. A rest is coming.`, so: 'Already built in: his projection expects a short break before he returns.', effect: 'info' });
}
const dTon = ri.tonight > 0 ? remPlayed * (1 - 1 / ri.tonight) : 0;
if (ri.tonight >= 1.12 && r.min >= 6) out.push({ icon: '📈', text: `Playing more than usual: ${r.min.toFixed(0)} minutes so far, when he'd normally have about ${ri.expSoFar.toFixed(0)} by now. The coach is leaning on him tonight.`, so: helps(minEffect(c, dTon)), effect: 'up' });
else if (ri.tonight <= 0.88 && ri.benched >= 0.5 && ri.expSoFar >= 4) out.push({ icon: '📉', text: `Playing less than usual: ${r.min.toFixed(0)} minutes so far, when he'd normally have about ${ri.expSoFar.toFixed(0)} by now.`, so: cuts(minEffect(c, dTon)), effect: 'down' });
}
const uT = p.usgTonight, uS = p.usgSeason;
const ue = p.usgBase > 0 && p.usg > 0 ? remOf(c, 'pts') * (1 - p.usgBase / p.usg) : 0;
if (uT != null && uS && r.min >= 8) {
if (uT >= uS * 1.25) out.push({ icon: '🎯', text: `Taking more of his team's shots: about ${Math.round(uT * 100)} of every 100 team plays end with him tonight, vs ${Math.round(uS * 100)} this season (${r.fgm} of ${r.fga} from the field).`, so: ue >= 0.2 ? helps(`${sgn1(ue)} pts`) + ' Part of tonight\'s bigger role sticks.' : 'Part of that bigger role carries into the rest of his projection.', effect: 'up' });
else if (uT <= uS * 0.75) out.push({ icon: '🧊', text: `Quieter than usual: about ${Math.round(uT * 100)} of every 100 team plays end with him tonight, vs ${Math.round(uS * 100)} this season (${r.fga} shots).`, so: ue <= -0.2 ? cuts(`${sgn1(ue)} pts`) : 'His projection still leans on his normal role, since quiet stretches usually pass.', effect: 'down' });
}
const fgPct = r.fga ? r.fgm / r.fga : 0;
if (r.fga >= 6 && fgPct >= 0.65) out.push({ icon: '🔥', text: `Hot shooting: ${r.fgm} of ${r.fga} from the field${r.fg3m ? `, ${r.fg3m} threes` : ''}.`, so: `Hot shooters keep getting the ball, but their accuracy usually comes back down, so the rest of his game is projected at his normal ${pct0(p.p2)} on 2s and ${pct0(p.p3)} on 3s. No bonus for the streak itself.`, effect: 'info' });
else if (r.fga >= 7 && fgPct <= 0.25) out.push({ icon: '🧊', text: `Cold shooting: ${r.fgm} of ${r.fga} from the field.`, so: 'Cold nights usually bounce back, so the rest of his game is projected at his normal shooting, not tonight\'s.', effect: 'info' });
if (c.scale > 1.04 && c.absentMates.length) out.push({ icon: '➕', text: `${c.absentMates.map((x) => lastName(x.name)).join(', ')} out: the team's shots are split among fewer players, so his share is about ${Math.round((c.scale - 1) * 100)}% bigger.`, so: helps(`${sgn1(remOf(c, 'pts') * (1 - 1 / c.scale))} pts`), effect: 'up' });
if (c.proof) out.push({ icon: '🛡️', text: `Blowout-proof: in ${c.blowP.nLead + c.blowP.nTrail} lopsided game${c.blowP.nLead + c.blowP.nTrail > 1 ? 's' : ''} he kept ${pct0(c.blowP.lead)} of his normal 4th-quarter minutes, while most starters sit much more.`, so: `Helps his picks: even if this turns into a blowout (${pct0(c.pBlow)} chance from here), his minutes and his number hold up.`, effect: 'up' });
else if (p.starter && c.pBlow >= 0.3) out.push({ icon: '💤', text: `${pct0(c.pBlow)} chance this turns into a blowout. When that happens, this coach plays his starters only ${pct0(c.habit.lead)} of their usual 4th-quarter minutes.`, so: cuts(minEffect(c, -c.pBlow * (1 - c.habit.lead) * Math.min(p.qavg[4] || 0, c.left))), effect: 'down' });
if (ri && ri.games >= 2 && r.on !== undefined && !out.some((x) => x.icon === '🪑')) out.push({ icon: '🗓️', text: `In his last ${ri.games} games, he usually played ${ri.remMap.toFixed(1)} of the remaining ${c.left.toFixed(0)} minutes from this point.`, so: `Projected: ${remPlayed.toFixed(1)} more minutes, after tonight's role and fouls.`, effect: 'info' });
return out;
}


/** His own scoring tendencies by situation, in plain words, with what each does to his number. */
function sitItems(p, r, c) {
const out = [];
const S = c.sit, M = c.sitMean;
if (!S || !M) return out;
const R = S.ratio, rem = remOf(c, 'pts');
const pc = (x) => `${Math.round(Math.abs(x - 1) * 100)}%`;
const more = (x) => (x >= 1 ? 'more' : 'less');
const eff = (part, w) => rem * (1 - 1 / Math.pow(part, w));
const push = (o, e) => { if (Math.abs(e) < 0.3) return; out.push({ ...o, effect: e > 0 ? 'up' : 'down', so: e > 0 ? helps(`${sgn1(e)} pts`) : cuts(`${sgn1(e)} pts`) }); };
const mins = (k) => Math.round(S.c[k][1]);
// who takes over when the top scorer sits
if (S.star && Math.abs(M.star - 1) >= 0.02 && Math.abs(R.starOff - 1) >= 0.08) {
const star = lastName(S.star.name);
const why = M.starOffShift >= 0.99 ? `${star} is out tonight, so he plays every minute without him.` : M.starOffShift > 0.05 ? `${star} is projected to sit more than usual tonight.` : M.starOffShift < -0.05 ? `${star} is projected to play more than usual tonight.` : '';
push({ icon: '🔁', key: 'sit-star', chip: R.starOff > 1 ? `STEPS UP FOR ${star.toUpperCase()}` : `NEEDS ${star.toUpperCase()}`,
text: `With ${star} off the floor he scores ${pc(R.starOff)} ${more(R.starOff)} per minute than his normal rate (${mins('starOff')} minutes without him lately). ${why}`.trim() }, eff(M.star, TUNE.sitStarW));
}
// crunch time / game script
if (Math.abs(M.state - 1) >= 0.02) {
if (c.phase === 'live' && c.m0 >= 12) push({ icon: '📈', key: 'sit-state', text: `His team leads by ${c.m0}. When his team is up 12 or more, he scores ${pc(R.ahead)} ${more(R.ahead)} per minute than his normal rate (${mins('ahead')} minutes like that lately).` }, eff(M.state, TUNE.sitStateW));
else if (c.phase === 'live' && c.m0 <= -12) push({ icon: '📉', key: 'sit-state', text: `His team trails by ${-c.m0}. When his team is down 12 or more, he scores ${pc(R.behind)} ${more(R.behind)} per minute than his normal rate (${mins('behind')} minutes like that lately).` }, eff(M.state, TUNE.sitStateW));
else if (Math.abs(R.clutch - 1) >= 0.12 && S.c.clutch[1] >= 4) push({ icon: R.clutch > 1 ? '🧊' : '😬', key: 'sit-state', chip: R.clutch > 1 ? 'CLOSER' : '', text: `${R.clutch > 1 ? 'Closer' : 'Quiet in crunch time'}: in the last 5 minutes of close games he scores ${pc(R.clutch)} ${more(R.clutch)} per minute than his normal rate (${mins('clutch')} crunch-time minutes lately).` }, eff(M.state, TUNE.sitStateW));
else {
const lab = { close: 'in close games', ahead: 'when his team is up 12 or more', behind: 'when his team is down 12 or more' };
const k = ['close', 'ahead', 'behind'].sort((a, b) => Math.abs(R[b] - 1) - Math.abs(R[a] - 1))[0];
push({ icon: '📊', key: 'sit-state', text: `The score changes his scoring: ${lab[k]} he scores ${pc(R[k])} ${more(R[k])} per minute than his normal rate (${mins(k)} minutes like that lately).` }, eff(M.state, TUNE.sitStateW));
}
}
// quarter shape
if (Math.abs(M.q - 1) >= 0.02) {
const qs = [1, 2, 3, 4].filter((q) => (c.phase === 'pre' || q >= c.period)).sort((a, b) => Math.abs(R['q' + b] - 1) - Math.abs(R['q' + a] - 1));
const q = qs[0], nm = ['', '1st', '2nd', '3rd', '4th'][q];
if (q) push({ icon: '🕐', key: 'sit-q', text: `${R['q' + q] > 1 ? 'Heats up' : 'Slows down'} in the ${nm} quarter: he scores ${pc(R['q' + q])} ${more(R['q' + q])} per minute then than his normal rate${c.phase === 'pre' ? '' : ', and that quarter is still to come'}.` }, eff(M.q, TUNE.sitQW));
}
if (Math.abs(M.home - 1) >= 0.02) { const k = c.home ? 'home' : 'away'; push({ icon: c.home ? '🏠' : '✈️', key: 'sit-home', text: `${c.home ? 'At home' : 'On the road'} he scores ${pc(R[k])} ${more(R[k])} per minute than his normal rate.` }, eff(M.home, TUNE.sitHomeW)); }
if (Math.abs(M.rest - 1) >= 0.02 && c.b2b) push({ icon: '🛌', key: 'sit-rest', text: `On the second night of back-to-backs he scores ${pc(R.b2b)} ${more(R.b2b)} per minute than his normal rate.` }, eff(M.rest, TUNE.sitRestW));
// scoring curve: hot or cold start tonight, and how his starts usually play out
if (M.d1 != null && Math.abs(M.fade - 1) >= 0.02) {
const hot = M.d1 > 0;
const keeps = S.fade > 0 ? (hot ? 'his hot starts usually keep going' : 'his slow starts usually stay slow') : (hot ? 'his hot starts usually cool off after the break' : 'his slow starts usually pick up after the break');
push({ icon: hot ? '🔥' : '🧊', key: 'sit-fade', text: `${hot ? 'Hot' : 'Slow'} start tonight (${r.pts} points in ${Math.round(r.min)} minutes), and in his recent games ${keeps}.` }, eff(M.fade, TUNE.sitFadeW));
}
if (Math.abs(M.streak - 1) >= 0.02 && Math.abs(S.lastDev) >= 0.15) {
const big = S.lastDev > 0;
const carries = S.streak > 0;
push({ icon: '📆', key: 'sit-streak', text: `Coming off a ${big ? 'big' : 'quiet'} scoring night, and his ${big ? 'big' : 'quiet'} nights ${carries ? 'tend to carry into the next game' : 'tend to be followed by the opposite'}.` }, eff(M.streak, TUNE.sitStreakW));
}
return out;
}

// what a learned pattern is about, by the sign of the feature: [when positive, when negative]
const PAT_WORDS = {
base: ['players overall', 'players overall'], starter: ['starters', ''], bench: ['bench players', ''], b2b: ['players on a back-to-back', ''],
pace: ['fast games', 'slow games'], blowout: ['games likely to get lopsided', ''], roleTrend: ['players whose minutes are rising', 'players whose minutes are falling'],
matesOut: ['players whose teammates are out', ''], proof: ['blowout-proof starters', ''], home: ['home players', ''],
softD: ['soft inside defenses', 'tough inside defenses'], track: ['players running ahead of their normal pace', 'players running behind their normal pace'],
fouls: ['players in foul trouble', ''], livePace: ['games running faster than expected', 'games running slower than expected'], margin: ['lopsided scores', ''],
minTrack: ['players getting more minutes than usual', 'players getting fewer minutes than usual'], shooting: ['hot-shooting players', 'cold-shooting players'],
uReal: ['players getting more of the shots than usual', 'players getting fewer of the shots than usual'], luck: ['players whose shots are falling more than usual', 'players whose shots are not falling'],
leadS: ['starters on a team with a big lead', ''], trailS: ['starters on a team that is far behind', ''], lopB: ['bench players in a lopsided game', ''],
on: ['players on the floor right now', ''], sitLong: ['players who have sat a long stretch', ''], dnp: ['players who have not checked in yet', ''],
usgHi: ['high-usage scorers', 'low-usage role players'], closeStar: ['go-to scorers in a close game', 'role players in a close game'],
pfX: ['players with more fouls than usual by now', 'players with fewer fouls than usual'], recent: ['players who took charge in the last few minutes', 'players who went quiet in the last few minutes'],
startUp: ['players who start tonight after coming off the bench', ''], startDown: ['usual starters left out of tonight\'s starting five', ''],
fresh: ['players back from a layoff', ''], deep: ['deep-bench players on a short-handed night', ''], vacPos: ['players whose position is short-handed tonight', ''],
lastMin: ['players who played more than usual last game', 'players who played less than usual last game'], rest3: ['teams coming off three or more days of rest', ''], missShare: ['players who have missed recent games', ''],
loadS: ['starters on a team with a full bench tonight', 'starters on a short-handed team'], loadB: ['bench players on a team with a full bench tonight', 'bench players on a short-handed team'],
loadBd: ['deep-bench players on a team with a full bench tonight', 'deep-bench players on a short-handed team'], loadBq: ['bench players in a crowded rotation', ''],
favS: ['starters on a team expected to win big', ''], dogS: ['starters on a team expected to lose big', ''], dogB: ['bench players on a team expected to lose big', ''],
mpgC: ['heavy-minute players', 'light-minute players'], fadeHist: ['players whose starts usually carry', 'players whose starts usually reverse'], leadProof: ['blowout-proof starters in a lopsided game', ''],
};
/** Lessons from graded games (learned patterns) and, live, how he's tracking vs his normal pace. */
function patternItems(p, r, c) {
const out = [];
const P = c.pat;
if (!P || c.phase === 'final') return out;
const eff = {};
for (const s of ['pts', 'reb', 'ast']) eff[s] = remOf(c, s) * (P.F[s].f - 1);
if (P.F.pts.parts && Math.abs(eff.pts) >= 0.3) {
const sign = Math.sign(eff.pts);
const top = P.F.pts.parts.map((v, i) => ({ v, i, x: P.x.pts[i] })).filter((o) => o.i > 0 && Math.sign(o.v) === sign && Math.abs(o.v) >= 0.004 && (PAT_WORDS[PAT_F[o.i]] || [])[o.x >= 0 ? 0 : 1]).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 2);
const who = top.map((o) => PAT_WORDS[PAT_F[o.i]][o.x >= 0 ? 0 : 1]);
const what = ['pts', 'reb', 'ast'].filter((s) => s === 'pts' || Math.abs(eff[s]) >= 0.3).map((s) => `${sgn1(eff[s])} ${s}`).join(', ');
out.push({ icon: '📚', key: 'learned', chip: `LEARNED ${sgn1(eff.pts)} PTS`, effect: sign > 0 ? 'up' : 'down',
text: `Learned from past games: our numbers for ${who.length ? who.join(' and ') : 'players in his spot'} have been finishing ${sign > 0 ? 'below' : 'above'} what they actually did${c.phase === 'pre' ? '' : ' from this point of the game'}, so the app corrects for it.`,
so: sign > 0 ? helps(what) : cuts(what) });
}
if (c.phase !== 'pre' && r.min >= 6 && c.ratePM) {
const exp = c.ratePM.pts * r.min;
if (Math.abs(r.pts - exp) >= 3) {
const ahead = r.pts > exp;
const tp = P.F.pts.parts ? P.F.pts.parts[PAT_F.indexOf('track')] * remOf(c, 'pts') : null;
out.push({ icon: ahead ? '⏫' : '⏬', key: 'track', effect: tp != null && Math.abs(tp) >= 0.3 ? (tp > 0 ? 'up' : 'down') : 'info',
text: `Scoring ${ahead ? 'ahead of' : 'behind'} his normal pace: ${r.pts} points in ${Math.round(r.min)} minutes, when he'd usually have about ${Math.round(exp)} by now.`,
so: tp == null ? 'The rest of his game is projected from his normal rates plus tonight\'s role.' : Math.abs(tp) < 0.3 ? 'Past games show little of a start like this lasts, so the rest of his game stays close to his normal rates.' : `Past games show some of a start like this lasts: about ${sgn1(tp)} pts on his projection.` });
}
}
return out;
}

/**
* Game context behind any projection (pregame and live): role, freed usage and minutes, matchup by
* zone, pace, game script, rest and lineup status. Each item: { icon, text, so, effect, key, chip }.
*/
function contextItems(p, r, c) {
const out = [];
const pre = c.phase === 'pre';
const mates = c.absentMates.filter((x) => x.pid !== r.pid);
const names = mates.map((x) => lastName(x.name)).join(', ');
// tonight's role vs his usual one (known once the lineups are posted; the change in minutes is already in his number)
if (p.sT != null && c.phase !== 'final') {
const mp = c.pat && c.pat.F && c.pat.F.min && c.pat.F.min.parts ? c.pat.F.min.parts : null;
const plainRem = Math.max((p.minPlain || 0), 0);
if (p.sT === 1 && p.startShare <= 0.3 && p.lineupF.startUp > 0) {
const dmin = mp ? mp[PAT_IX.startUp] * plainRem : 0;
out.push({ icon: '🚀', key: 'starts', chip: 'STARTS TONIGHT', effect: 'up', text: `${lastName(r.name)} ${pre ? 'starts' : 'started'} tonight. He came off the bench in most of his recent games.`,
so: dmin >= 0.5 ? helps(minEffect(c, dmin)) + ' New starters usually play more.' : 'New starters usually play more: that is built into his minutes.' });
} else if (p.sT === 0 && p.startShare >= 0.7) {
const dmin = mp ? mp[PAT_IX.startDown] * plainRem : 0;
out.push({ icon: '🪑', key: 'notstarting', chip: 'NOT STARTING', effect: 'down', text: `${lastName(r.name)} usually starts but ${pre ? 'is' : 'was'} not in tonight's starting five.`,
so: (dmin <= -0.5 ? cuts(minEffect(c, dmin)) + ' ' : '') + (pre ? 'Usual starters who are left out often sit the whole game, so check his status before using a pick on him.' : 'Usual starters who come off the bench play less, and some do not play at all.') });
}
}
if (pre && p.n) {
if (p.n >= 4 && p.recent3 != null && p.recent3 - p.mpgFlat >= 3) out.push({ icon: '📈', key: 'role', chip: 'ROLE UP', effect: 'up', text: `His minutes are growing: ${p.recent3.toFixed(0)} a game in his last 3 vs ${p.mpgFlat.toFixed(0)} for the season. Recent games count more in his projection.`, so: helps(minEffect(c, p.mpg - p.mpgFlat)) });
else if (p.n >= 4 && p.recent3 != null && p.recent3 - p.mpgFlat <= -3) out.push({ icon: '📉', key: 'role', chip: 'ROLE DOWN', effect: 'down', text: `His minutes are shrinking: ${p.recent3.toFixed(0)} a game in his last 3 vs ${p.mpgFlat.toFixed(0)} for the season.`, so: cuts(minEffect(c, p.mpg - p.mpgFlat)) });
else out.push({ icon: '🧭', key: 'role', chip: p.starter ? 'STARTER' : 'BENCH', effect: 'info', text: `${p.starter ? 'Starter' : 'Bench'} role: about ${p.mpg.toFixed(0)} minutes a game lately, ${c.minProj.toFixed(0)} projected tonight.`, so: `Minutes drive everything else: each minute is worth about ${perMin(c, 'pts').toFixed(1)} pts, ${perMin(c, 'reb').toFixed(1)} reb and ${perMin(c, 'ast').toFixed(1)} ast for him.` });
}
if (pre && mates.length && c.minProj - p.mpg >= 2.5) out.push({ icon: '⏱️', key: 'min', chip: `+${(c.minProj - p.mpg).toFixed(0)} MIN`, effect: 'up', text: `More minutes with ${names} out: ${c.minProj.toFixed(0)} projected vs his usual ${p.mpg.toFixed(0)}.`, so: helps(minEffect(c, c.minProj - p.mpg)) });
const um = p.uMul != null ? p.uMul : c.scale;
if (mates.length && um > 1.03) out.push({ icon: '➕', key: 'usage', chip: `USG +${((um - 1) * 100).toFixed(0)}%`, effect: 'up', text: `With ${names} out, more of the team's shots go to him: his share is about ${Math.round((um - 1) * 100)}% bigger.`, so: helps(`${sgn1(remOf(c, 'pts') * (1 - 1 / um))} pts`) });
const z = p.zone, oc = c.oppCtx;
// points from his 2-pointers, as a share of his scoring (for what the defense does to his number)
const ftPerFga = p.mix && p.mix.fga > 0 ? ((p.mix.ft / 0.44) * p.ft) / p.mix.fga : 0;
const v2 = 2 * (1 - p.r3) * p.p2, v3 = 3 * p.r3 * p.p3;
const share2 = v2 + v3 + ftPerFga > 0 ? v2 / (v2 + v3 + ftPerFga) : 0.5;
if (z && Math.abs(z.f2 - 1) >= 0.02) {
const soft = z.f2 > 1;
const e2 = p.p2fA ? remOf(c, 'pts') * share2 * (1 - 1 / p.p2fA) : 0;
out.push({ icon: soft ? '🎯' : '🛡️', key: 'matchup', chip: soft ? 'SOFT INSIDE D' : 'TOUGH INSIDE D', effect: soft ? 'up' : 'down',
text: `${p.opp} allows ${pct0(z.rimAllow)} at the rim and ${pct0(z.midAllow)} from mid-range (league: ${pct0(z.lgRim)} and ${pct0(z.lgMid)}). ${pct0(z.sRim)} of his 2-pointers come at the rim.`,
so: Math.abs(e2) >= 0.2 ? `His 2-pointers are projected against ${p.opp}'s overall defense: about ${sgn1(e2)} pts on his number.` : `His number uses ${p.opp}'s overall defense, which grades close to average, so this is context rather than a change.` });
}
if (oc && oc.games >= 3 && Math.abs(oc.p3f - 1) >= 0.015) {
const soft = oc.p3f > 1;
const e3 = remOf(c, 'fg3m') * (1 - 1 / oc.p3f);
out.push({ icon: soft ? '🎯' : '🛡️', key: 'matchup3', chip: soft ? 'SOFT 3PT D' : 'TOUGH 3PT D', effect: soft ? 'up' : 'down', text: `Opponents make ${pct0(oc.opp3p)} of their threes against ${p.opp} (league ${pct0(c.lgP3)}).`,
so: (soft ? helps : cuts)(`${sgn1(e3)} threes (${sgn1(3 * e3)} pts)`) });
}
if (Math.abs(c.pace - 99) >= 2 && (pre || c.el < 8)) {
const fast = c.pace > 99;
out.push({ icon: fast ? '⏩' : '🐢', key: 'pace', chip: fast ? 'FAST PACE' : 'SLOW PACE', effect: fast ? 'up' : 'down', text: `${fast ? 'Fast' : 'Slow'} game expected: about ${c.pace.toFixed(0)} possessions per team (league average 99)${c.mk && c.mk.total ? `, and the books' total is ${c.mk.total}` : ''}. ${fast ? 'More' : 'Fewer'} possessions means ${fast ? 'more' : 'fewer'} shots for everyone.`,
so: (fast ? helps : cuts)(`${sgn1(remOf(c, 'pts') * (1 - 99 / c.pace))} pts`) });
}
if (!pre && c.el >= 8 && c.livePace && Math.abs(c.livePace - c.pace) >= 5) {
const hot = c.livePace > c.pace;
const w = c.el / (c.el + TUNE.paceK);
const ratio = ((1 - w) * c.pace + w * c.livePace) / c.pace;
out.push({ icon: hot ? '🏃' : '🧱', key: 'livepace', chip: hot ? 'RUNNING HOT' : 'GRINDING SLOW', effect: hot ? 'up' : 'down', text: `This game is moving ${hot ? 'faster' : 'slower'} than expected: ${c.livePace.toFixed(0)} possessions per team at this rate vs ${c.pace.toFixed(0)} expected. The longer it lasts, the more the rest of the game follows tonight's speed.`,
so: (hot ? helps : cuts)(`${sgn1(remOf(c, 'pts') * (1 - 1 / ratio))} pts`) });
}
if (c.proof) {
const n = c.blowP.nLead + c.blowP.nTrail;
out.push({ icon: '🛡️', key: 'blowproof', chip: 'BLOWOUT-PROOF', effect: 'up', text: `Blowout-proof: in ${n} lopsided game${n > 1 ? 's' : ''} this season he kept about ${pct0(c.blowP.lead)} of his normal 4th-quarter minutes (his coach's starters average ${pct0(c.habit.lead)}).`, so: `Helps his picks: if this turns into a blowout${c.pBlow >= 0.1 ? ` (${pct0(c.pBlow)} chance tonight)` : ''}, his minutes and his number hold up.` });
} else if (pre && p.starter && c.pBlow >= 0.18) {
const sp = c.mk && c.mk.spreadHome != null ? Math.abs(c.mk.spreadHome) : null;
out.push({ icon: '💤', key: 'script', chip: `BLOWOUT ${pct0(c.pBlow)}`, effect: 'down', text: `${pct0(c.pBlow)} chance of a blowout${sp ? ` (the books have it at ${sp} points)` : ''}. In blowouts this coach plays his starters only ${pct0(c.habit.lead)} of their usual 4th-quarter minutes.`, so: cuts(minEffect(c, -c.pBlow * (1 - c.habit.lead) * (p.qavg[4] || 0))) });
}
if (pre && c.b2b) out.push({ icon: '🛌', key: 'rest', chip: 'B2B', effect: p.starter && TUNE.b2bMin > 0 ? 'down' : 'info', text: 'Second night of a back-to-back.', so: p.starter && TUNE.b2bMin > 0 ? `Starters play a little less on these nights. ${cuts(minEffect(c, c.minProj * (1 - 1 / (1 - TUNE.b2bMin))))}` : 'Bench players play their normal minutes on these nights, so his number doesn\'t change.' });
if (pre && c.doubt) out.push({ icon: '⚠️', key: 'status', chip: 'CHECK STATUS', effect: 'down', text: `Not confirmed to play: ${c.doubt}.`, so: 'His projection assumes he plays. Check his status before tip-off.' });
else if (c.lineup && c.lineup.confirmed && c.inList) out.push({ icon: '✅', key: 'status', chip: 'CONFIRMED', effect: 'info', text: `Confirmed in tonight's lineup${c.lineup.source ? ` (${c.lineup.source})` : ''}.`, so: 'No guesswork on whether he plays.' });
return out.concat(sitItems(p, r, c), patternItems(p, r, c));
}

const ESPN_TEAM = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };
/**
* Backup feed: ESPN's game summary carries the same play-by-play DataBallr relays. This puts it in DataBallr's
* shape. nameToPid maps normalized player names to the ids our logs use; unknown players get a stable id of their own.
*/
function playsFromEspn(summary, nameToPid) {
const teams = {}, who = {};
for (const t of (summary && summary.boxscore && summary.boxscore.teams) || []) if (t.team) teams[t.team.id] = ESPN_TEAM[t.team.abbreviation] || t.team.abbreviation;
for (const t of (summary && summary.boxscore && summary.boxscore.players) || []) {
if (t.team && !teams[t.team.id]) teams[t.team.id] = ESPN_TEAM[t.team.abbreviation] || t.team.abbreviation;
for (const grp of t.statistics || []) for (const a of grp.athletes || []) if (a.athlete) who[a.athlete.id] = a.athlete.displayName;
}
const pid = (id) => { const nm = who[id]; const k = nm && nameToPid ? nameToPid[norm(nm)] : null; return k != null ? k : 900000000 + (+id || 0); };
return ((summary && summary.plays) || []).map((p, i) => ({
order: +p.sequenceNumber || i + 1, period: p.period ? p.period.number : 0, clock: p.clock ? p.clock.displayValue : '', type: (p.type && p.type.text) || '', text: p.text || '',
participants: (p.participants || []).map((x) => pid(x.athlete && x.athlete.id)), team: p.team && teams[p.team.id] ? { abbreviation: teams[p.team.id] } : null,
shooting_play: !!p.shootingPlay, scoring_play: !!p.scoringPlay, score_value: p.scoringPlay ? p.scoreValue || 0 : null, away_score: p.awayScore, home_score: p.homeScore, wallclock: p.wallclock || null,
}));
}
/**
* Fade warning: a hot start we expect to cool, with the concrete reason. Hot starts by themselves hold up fine on
* average (the learned weights say real extra shots stick, lucky makes do not), so a warning needs a cause:
* lucky makes, a lopsided score, foul trouble, a rest that is due, or his own record of cooling after the break.
*/
function fadeCheck(p, r, c, avg, patF) {
if (!(r.min >= 5) || !(r.pts >= 8) || !(c.left > 3)) return null;
const exp = p.ratePM.pts * r.min;
if (!(r.pts - exp >= 4)) return null; // not a hot start
const remMin = Math.max(c.minProj, 0);
const onPace = r.pts + (r.pts / r.min) * remMin;
const cool = onPace - avg.pts;
if (!(cool >= 3)) return null;
const lu = p.lu, x = p.pat.x.pts;
const why = [];
const mg = c.m0;
if (lu && r.pts - lu.xPts >= 3.5 && x[PAT_IX.uReal] < 0.8) why.push({ k: 'luck', t: `${Math.round(r.pts - lu.xPts)} of his ${r.pts} points came from shots falling more than usual, not from extra shots: the same shots are normally worth about ${Math.round(lu.xPts)}` });
if (p.starter && !c.proof && (Math.abs(mg) >= 15 || c.pBlow >= 0.35)) why.push({ k: 'script', t: Math.abs(mg) >= 15 ? `the score is lopsided (${mg > 0 ? 'up' : 'down'} ${Math.abs(mg)}), and starters play and shoot less late in games like this` : `there is a ${pct0(c.pBlow)} chance this game gets lopsided, and starters sit late when it does` });
if (r.pf >= Math.min(c.period + 1, 5) && r.pf < 6) why.push({ k: 'fouls', t: `he has ${r.pf} fouls, so the coach has to manage his minutes` });
if (p.rotInfo && p.rotInfo.tonight >= 1.15 && r.min - p.rotInfo.expSoFar >= 3) why.push({ k: 'rest', t: `he has played ${Math.round(r.min)} minutes when he normally has ${Math.round(p.rotInfo.expSoFar)} by now, so a longer rest is due` });
if (p.sit && p.sit.fade <= -0.15 && p.sit.games >= 5) why.push({ k: 'history', t: 'in his recent games his hot starts have cooled after the break' });
if (!why.length) return null;
return { level: why.length >= 2 || cool >= 7 ? 'high' : 'some', onPace: +onPace.toFixed(1), proj: +avg.pts.toFixed(1), cool: +cool.toFixed(1), keys: why.map((w) => w.k),
text: `Fade warning: ${r.pts} points in ${Math.round(r.min)} minutes, but ${why.slice(0, 2).map((w) => w.t).join('; and ')}.`,
so: `At this rate he would finish near ${Math.round(onPace)}. We project ${avg.pts.toFixed(1)}, and that cooler number is the one every edge here is measured from.` };
}
/**
* Usage Shift alerts: inside one team, the scoring left in this game has moved from one player to another compared
* with a normal night. Each alert names both players, the size of the move and the plain reason.
*/
function liveAlerts(players, st, absent) {
const out = [];
for (const tm of [st.v, st.h]) {
const ps = players.filter((p) => p.team === tm && p.shift && !p.flags.includes('out'));
if (ps.length < 5) continue;
// take out what moves the whole team (pace, opponent, score) so only the reshuffle between teammates is left
const sb = ps.reduce((a, p) => a + p.shift.baseRem, 0), sr = ps.reduce((a, p) => a + p.shift.rem, 0);
const k = sb > 0 ? sr / sb : 1;
const d = ps.map((p) => ({ p, d: p.shift.rem - k * p.shift.baseRem }));
const up = d.filter((x) => x.d >= 2 && x.p.shift.baseRem > 0 && x.d / Math.max(x.p.shift.baseRem * k, 2) >= 0.15).sort((a, b) => b.d - a.d)[0];
const cause = (p) => {
const r = p.rot;
if (p.now.pf >= 6) return { w: 3, t: `${lastName(p.name)} has fouled out` };
if (p.flags.some((f) => f.startsWith('foul')) && !p.on) return { w: 3, t: `${lastName(p.name)} sits with ${p.now.pf} fouls` };
if (p.flags.some((f) => f.startsWith('foul'))) return { w: 2, t: `${lastName(p.name)} is in foul trouble (${p.now.pf})` };
if (r && !p.on && !r.foulSit && r.benched < 0.5 && !p.dnpYet) return { w: 3, t: `${lastName(p.name)} has been on the bench for ${fmtMin(r.sitFor)} (hurt, or the coach has gone away from him)` };
if (p.dnpYet) return { w: 2, t: `${lastName(p.name)} has not checked in` };
if (p.pat && p.pat.x.pts[PAT_IX.uReal] <= -1) return { w: 1, t: `${lastName(p.name)} is getting fewer of the shots than usual` };
if (p.flags.includes('sitrisk')) return { w: 1, t: `${lastName(p.name)} may sit late if the lead holds` };
return null;
};
const downs = d.filter((x) => x.d <= -2).map((x) => ({ ...x, c: cause(x.p) })).filter((x) => x.c && (x.c.w >= 2 || x.d <= -3.5)).sort((a, b) => b.c.w - a.c.w || a.d - b.d);
const outNow = (absent || []).filter((a) => a.team === tm && /check|eject|foul/i.test(a.why || ''));
const down = downs[0] || null;
if (!up || (!down && !outNow.length)) continue;
const g = up.p, ux = g.pat ? g.pat.x.pts : null;
const how = ux && ux[PAT_IX.uReal] >= 1 ? `The offense is running through ${lastName(g.name)}` : g.shift.dMin >= 1.5 ? `${lastName(g.name)} is getting the extra minutes` : `More of the scoring from here goes to ${lastName(g.name)}`;
const whyT = down ? down.c.t : `${lastName(outNow[0].name)} is out (${outNow[0].why})`;
out.push({ type: 'shift', team: tm, up: { pid: g.pid, name: g.name, pts: +up.d.toFixed(1), proj: +g.proj.pts.toFixed(1) }, down: down ? { pid: down.p.pid, name: down.p.name, pts: +down.d.toFixed(1), proj: +down.p.proj.pts.toFixed(1) } : null,
size: +(up.d - (down ? down.d : 0)).toFixed(1),
text: `${how} while ${whyT}.`,
so: `${lastName(g.name)} is projected for about ${sgn1(up.d)} more points from here than on a normal night${down ? `, ${lastName(down.p.name)} for about ${sgn1(down.d)}` : ''}. Both numbers already include this.` });
}
for (const p of players) if (p.fade) out.push({ type: 'fade', team: p.team, pid: p.pid, name: p.name, level: p.fade.level, onPace: p.fade.onPace, proj: p.fade.proj, size: p.fade.cool, text: p.fade.text, so: p.fade.so });
return out.sort((a, b) => b.size - a.size);
}

/**
* @param {object} o
* game DataBallr live-games row
* plays play-by-play rows for this game ([] pregame)
* logs logEntry[] of both teams' recent finished games
* priors { last: slimStats(prev season), cur: slimStats(this season) }
* injuries DataBallr injury rows for the date
* nsims simulations (default 2000)
*/
function projectGame(o) {
const st = gameState(o.game);
const { v, h } = st;
const N = o.nsims || 2000;
const R = makeSampler(o.seed || st.id || 7);
const sitPrior = o.sitPrior || sitPriorShipped();
const logs = (o.logs || []).filter((l) => l.v === v || l.h === v || l.v === h || l.h === h);
const last = (o.priors && o.priors.last) || {};
const cur = (o.priors && o.priors.cur) || {};
const out = (o.injuries || []).filter((x) => /^(out|doubtful)/i.test(x.status || ''));
const outIds = new Set(out.map((x) => x.player && x.player.id));
const shaky = new Map((o.injuries || []).filter((x) => /^(questionable|day|gtd|game.?time)/i.test(x.status || '')).map((x) => [x.player && x.player.id, x.status]));
const gameDate = String(o.game.date || o.game.datetime || '').slice(0, 10);
const ctx = { [v]: teamContext(logs, v), [h]: teamContext(logs, h) };
const habits = { [v]: coachHabits(logs, v), [h]: coachHabits(logs, h) };
// DataBallr season team stats: pace, ratings and defense, blended with our recent-game logs
const TD = (o.teams && o.teams.teams) || {};
const lgT = (o.teams && o.teams.league) || null;
const lgOrtg = lgT && lgT.ortg ? lgT.ortg : LEAGUE.ortg;
const teamsDb = {};
for (const tm of [v, h]) {
const d = TD[tm], c = ctx[tm];
if (!d || !d.g || !d.pace || d.ortg == null || d.drtg == null) continue;
teamsDb[tm] = d;
const wd = (c.games ? TUNE.dbTeamW : 1) * (d.g / (d.g + 4));
c.paceLogs = c.pace; c.netLogs = c.net;
c.pace = (1 - wd) * c.pace + wd * d.pace;
c.net = (1 - wd) * c.net + wd * (d.g / (d.g + 10)) * (d.ortg - d.drtg);
const kd = d.g / (d.g + 8);
c.p2f = (1 - wd) * c.p2f + wd * (1 + kd * 0.5 * (d.drtg / lgOrtg - 1));
c.dbW = wd;
}
const mk = st.phase !== 'final' && o.market && (o.market.total || o.market.spreadHome != null) ? o.market : null;
const now = boxFromPlays(o.plays || [], st.period, st.clock);
const left = st.left;
const el = st.elapsed;

// roster: tonight's box + (pregame / not yet checked in) recent rotation minus injured
const hist = {};
for (const lg of logs.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
for (const [pid, r] of Object.entries(lg.rows)) if (r.team === v || r.team === h) (hist[pid] = hist[pid] || []).push({ ...r, margin: lg.margin[r.team], date: lg.date });
}
const roster = {};
for (const [pid, r] of Object.entries(now.players)) if (r.team === v || r.team === h) roster[pid] = r;
// who played in each team's most recent game: a player who missed it is presumed out until he checks in
const ov = o.overrides || {};
const forceIn = new Set((ov.in || []).map(Number)), forceOut = new Set((ov.out || []).map(Number));
// lineup / injury report from outside DataBallr (ESPN in the app): names → ids on these two rosters
const av = o.avail || null;
const availOut = new Map(), availIn = new Set(), availDoubt = new Map();
const startT = new Set(); // tonight's starters, once the lineups are posted
const freshIn = []; // on tonight's active list with no recent games in our logs (back from a layoff, new to the team)
const byName = {};
for (const [pid, hs] of Object.entries(hist)) byName[norm(hs[hs.length - 1].name)] = +pid;
for (const r of Object.values(now.players)) if (r.team === v || r.team === h) byName[norm(r.name)] = r.pid;
if (av) {
const idOf = (n) => byName[norm(n)];
for (const x of av.out || []) { const id = idOf(x.name || x); if (id != null) availOut.set(id, x.why || (av.confirmed ? 'inactive tonight' : 'out on injury report')); }
for (const x of av.in || []) {
const id = idOf(x.name || x);
if (id != null) { availIn.add(id); if (x.starter) startT.add(+id); }
else if (av.confirmed && x.name && (x.team === v || x.team === h)) freshIn.push(x);
}
for (const x of av.doubt || []) { const id = idOf(x.name || x); if (id != null && !availIn.has(id)) availDoubt.set(id, x.why || 'questionable'); }
}
const lineup = { confirmed: !!(av && av.confirmed), report: !!(av && (av.report || av.confirmed)), source: (av && av.source) || null, out: availOut.size, in: availIn.size };
const lastPlayed = {};
for (const tm of [v, h]) {
const lg = logs.filter((l) => tm in l.margin).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
lastPlayed[tm] = lg ? new Set(Object.entries(lg.rows).filter(([, r]) => r.team === tm && r.min > 0).map(([id]) => +id)) : null;
}
const absent = [];
const doubt = {}; // pid -> reason (still projected, but availability is shaky)
const b2b = {};
for (const tm of [v, h]) b2b[tm] = !!gameDate && logs.some((l) => tm in l.margin && String(l.date).slice(0, 10) === addDaysStr(gameDate, -1));
if (st.phase !== 'final') {
for (const [pid, hs] of Object.entries(hist)) {
const lastRow = hs[hs.length - 1];
const lpA = last[norm(lastRow.name)] || cur[norm(lastRow.name)] || {};
const avgMin = hs.slice(-3).reduce((a, r) => a + r.min, 0) / Math.min(3, hs.length);
if (shaky.has(+pid) && !availIn.has(+pid)) doubt[pid] = `${shaky.get(+pid)} on injury report`;
if (availDoubt.has(+pid) && !forceIn.has(+pid)) doubt[pid] = availDoubt.get(+pid);
if (b2b[lastRow.team] && lpA.age >= 31 && avgMin >= 24) doubt[pid] = doubt[pid] || 'back-to-back rest risk';
if (roster[pid]) continue;
if (st.phase === 'pre' && TUNE.b2bRestAge > 0 && b2b[lastRow.team] && lpA.age >= TUNE.b2bRestAge && avgMin >= 24 && !forceIn.has(+pid)) {
absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: 'back-to-back rest' });
continue;
}
if (forceOut.has(+pid) || (!forceIn.has(+pid) && (availOut.has(+pid) || (outIds.has(+pid) && !availIn.has(+pid))))) {
absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: forceOut.has(+pid) ? 'you marked out' : availOut.has(+pid) ? availOut.get(+pid) : 'injury report' });
continue;
}
// lineups confirmed: anyone left off tonight's active list sits
if (lineup.confirmed && av.complete && !availIn.has(+pid) && !forceIn.has(+pid) && (st.phase === 'pre' || TUNE.liveConfirmedOut)) {
absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: 'not on tonight\'s active list' });
continue;
}
const lp0 = lastPlayed[lastRow.team];
if (lp0 && !lp0.has(+pid) && !forceIn.has(+pid) && !availIn.has(+pid) && avgMin >= 20) {
// a full injury report that doesn't list him: he's expected back, just flag it
if (lineup.report) doubt[pid] = doubt[pid] || 'missed last game, not on injury report';
else if (TUNE.absentMinMpg > 0 && avgMin >= TUNE.absentMinMpg) {
absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: 'missed last game' });
continue;
}
doubt[pid] = doubt[pid] || 'missed last game';
}
const recent = hs.slice(-3);
const tm = hs[hs.length - 1].team;
if (tm !== v && tm !== h) continue;
// deep bench: skipped unless tonight's posted active list has him (short-handed nights are when he plays)
const deepIn = TUNE.actDeep > 0 && lineup.confirmed && availIn.has(+pid) && (st.phase === 'pre' || el <= 12.5);
if (recent.reduce((a, r) => a + r.min, 0) / 3 < 6 && !deepIn) continue;
// a game in progress: starters who haven't checked in early, and anyone by halftime, are out
if (st.phase === 'live') {
if (el >= 24) continue;
if ((el >= TUNE.liveOutMin && avgMin >= 24) || (el >= 18 && avgMin >= 14)) {
absent.push({ pid: +pid, name: lastRow.name, team: lastRow.team, why: "hasn't checked in" });
continue;
}
}
roster[pid] = { pid: +pid, name: hs[hs.length - 1].name, team: tm, pts: 0, reb: 0, oreb: 0, ast: 0, fg3m: 0, fg3a: 0, fga: 0, fgm: 0, fta: 0, ftm: 0, tov: 0, pf: 0, tech: 0, ejected: false, min: 0, qmin: {}, on: false, dnpYet: true,
deep: recent.reduce((a, r) => a + r.min, 0) / 3 < 6 };
}
// back from a layoff: on tonight's posted list, no recent games here, but a real season line (starters always; others with a regular role)
if (TUNE.actNew > 0 && (st.phase === 'pre' || el <= 12.5)) for (const x of freshIn) {
const k = norm(x.name);
const lpF = mergePrior(last[k], cur[k]);
if (!lpF || !(lpF.mpg > 0) || (!x.starter && !(lpF.mpg >= TUNE.actNewMpg && lpF.gp >= 5))) continue;
if (Object.values(roster).some((r) => norm(r.name) === k)) continue;
const pid = -(Math.abs(+lpF.nba_id || 0) || 1000 + Object.keys(roster).length);
roster[pid] = { pid, name: lpF.name || x.name, team: x.team, pts: 0, reb: 0, oreb: 0, ast: 0, fg3m: 0, fg3a: 0, fga: 0, fgm: 0, fta: 0, ftm: 0, tov: 0, pf: 0, tech: 0, ejected: false, min: 0, qmin: {}, on: false, dnpYet: true, fresh: true };
availIn.add(pid); if (x.starter) startT.add(pid);
}
}
// tonight's starters: from the posted lineup before tip, from who was on the floor at the opening tip once the game is on
// (early in a game the play-by-play has not named every starter yet: a starter with no shot, rebound or foul so far is
// missing from it, so the posted lineup stays in and the play-by-play only adds to it; fewer than 8 known = not known)
if (st.phase === 'live') for (const r of Object.values(now.players)) if ((r.team === v || r.team === h) && r.stints && r.stints[0] && r.stints[0][0] < 0.05) startT.add(+r.pid);
const startKnown = startT.size >= 8;
const teamGames = {}, lastGameDay = {};
for (const tm of [v, h]) { const tl = logs.filter((l) => tm in l.margin); teamGames[tm] = tl.length; lastGameDay[tm] = tl.reduce((a, l) => (String(l.date).slice(0, 10) > a ? String(l.date).slice(0, 10) : a), ''); }
const rest3 = {};
for (const tm of [v, h]) rest3[tm] = !!gameDate && !!lastGameDay[tm] && lastGameDay[tm] < addDaysStr(gameDate, -3);

// live pace / possessions left
const tNow = now.teams;
const possNow = ((tNow[v] ? tNow[v].poss : 0) + (tNow[h] ? tNow[h].poss : 0)) / 2;
let seasonPace = (ctx[v].pace + ctx[h].pace) / 2;
const paceModel = seasonPace;
// the books' total as a tempo signal: total ÷ each side's expected points per 100 possessions
let paceMkt = null;
if (mk && mk.total && TUNE.mktTotalW > 0) {
const shr = (tm, k) => { const d = teamsDb[tm]; return d ? lgOrtg + (d.g / (d.g + 8)) * (d[k] - lgOrtg) : lgOrtg; };
const ppV = (shr(v, 'ortg') * shr(h, 'drtg')) / lgOrtg, ppH = (shr(h, 'ortg') * shr(v, 'drtg')) / lgOrtg;
paceMkt = clamp((100 * mk.total) / (ppV + ppH), 88, 112);
seasonPace = (1 - TUNE.mktTotalW) * seasonPace + TUNE.mktTotalW * paceMkt;
}
const livePace = el > 0 ? (possNow * 48) / Math.max(el, 1) : seasonPace;
const w = el / (el + TUNE.paceK);
const q4Left = st.phase === 'final' ? 0 : st.period > 4 ? left : Math.min(left, 12);
const possLeft = (((1 - w) * seasonPace + w * livePace) * (left - q4Left + q4Left * TUNE.q4Pace)) / 48;

// tonight's environment for rebounds and assists (both teams' tendencies, then the live game)
const env = {};
const wEnv = el / (el + TUNE.envK);
const rebLive = el > 0 ? ['oreb', 'dreb'].reduce((a, k) => a + (tNow[v] ? tNow[v][k] : 0) + (tNow[h] ? tNow[h][k] : 0), 0) / el : null;
for (const tm of [v, h]) {
const op = tm === v ? h : v, A = ctx[tm], B = ctx[op];
const shrink = (x, g) => 1 + (g / (g + 8)) * (x - 1);
let fr = 1, fa = 1;
if (A.rebPM && B.rebPM) {
let exp = (A.rebPM + B.rebPM) / 2;
if (rebLive != null) exp = (1 - wEnv) * exp + wEnv * rebLive;
fr = shrink(exp / A.rebPM, Math.min(A.games, B.games));
}
if (A.astPM && B.astAllowPM) {
let exp = (A.astPM + B.astAllowPM) / 2;
const astLive = el > 0 && tNow[tm] && tNow[tm].ast != null ? tNow[tm].ast / el : null;
if (astLive != null) exp = (1 - wEnv) * exp + wEnv * astLive;
fa = shrink(exp / A.astPM, Math.min(A.games, B.games));
}
env[tm] = { reb: Math.pow(clamp(fr, 0.8, 1.25), TUNE.envW), ast: Math.pow(clamp(fa, 0.8, 1.25), TUNE.envW) };
}

// margin path to the end of Q3 → blowout scenarios
const toQ3 = Math.max(Math.max(36, el + (TUNE.blowAhead || 0)) - el, 0);
const marginNow = st.vs - st.hs;
const mQ3 = new Float64Array(N);
// team strength drift (visitor perspective): net-rating gap minus home court, over the minutes to Q3
const marginModel = ((ctx[v].net - ctx[h].net) / 100) * seasonPace - TUNE.homeAdv; // visitor, per 48
const marginMkt = mk && mk.spreadHome != null ? mk.spreadHome : null; // home +7.5 → visitor by 7.5
const expV48 = marginMkt != null && TUNE.mktSpreadW > 0
? (1 - TUNE.mktSpreadW) * TUNE.drift * marginModel + TUNE.mktSpreadW * marginMkt
: TUNE.drift * marginModel; // visitor's expected winning margin over a full game, as seen before tip-off
const drift = expV48 * (toQ3 / 48);
for (let i = 0; i < N; i++) mQ3[i] = marginNow + drift + R.normal(0, st.phase === 'pre' ? TUNE.preQ3Sd : TUNE.marginK * Math.sqrt(Math.max(toQ3, 0.01)));
let pBlow = 0, pBig = 0;
for (let i = 0; i < N; i++) { const a = Math.abs(mQ3[i]); if (a >= 20) pBlow++; if (a >= 15) pBig++; }
pBlow /= N; pBig /= N;

// league shooting by zone from every game in these logs (both sides), for the matchup factor
const LGZ = { rim: [0, 0], mid: [0, 0], three: [0, 0] };
for (const lg of logs) for (const r of Object.values(lg.rows)) if (r.z) for (const k of ['rim', 'mid', 'three']) if (r.z[k]) { LGZ[k][0] += r.z[k][0]; LGZ[k][1] += r.z[k][1]; }
const lgZ = { rim: LGZ.rim[0] >= 200 ? LGZ.rim[1] / LGZ.rim[0] : 0.66, mid: LGZ.mid[0] >= 200 ? LGZ.mid[1] / LGZ.mid[0] : 0.43, three: LGZ.three[0] >= 200 ? LGZ.three[1] / LGZ.three[0] : LEAGUE.p3 };
const tPlaysNow = {}, tMinNow = {};
for (const tm of [v, h]) {
const T = tNow[tm] || { fga: 0, fta: 0, tov: 0 };
tPlaysNow[tm] = T.fga + 0.44 * T.fta + T.tov;
tMinNow[tm] = Object.values(now.players).filter((r) => r.team === tm).reduce((a, r) => a + r.min, 0);
}

const players = [];
const LU = st.phase === 'live' ? liveUsage(o.plays || [], now.players, el) : {};
const stars = { [v]: teamStar(logs, v), [h]: teamStar(logs, h) };
for (const r of Object.values(roster)) {
const tm = r.team, opp = tm === v ? h : v;
const hs = hist[r.pid] || [];
const n = hs.length;
const lp = mergePrior(last[norm(r.name)], cur[norm(r.name)]);
// --- season aggregates from logs
const a = { plays: 0, on: 0, fga: 0, fg3a: 0, fg3m: 0, fta: 0, ftm: 0, tov: 0, pts: 0, min: 0, reb: 0, ast: 0 };
for (const lg of logs) {
const row = lg.rows[r.pid];
if (!row || row.team !== tm) continue;
const T = lg.teams[tm]; if (!T) continue;
const tPlays = T.fga + 0.44 * T.fta + T.tov;
const tMin = Object.values(lg.rows).filter((x) => x.team === tm).reduce((s, x) => s + x.min, 0);
if (tMin <= 0) continue;
a.plays += row.fga + 0.44 * row.fta + row.tov;
a.on += (tPlays * row.min) / (tMin / 5);
for (const k of ['fga', 'fg3a', 'fg3m', 'fta', 'ftm', 'tov', 'pts', 'min', 'reb', 'ast']) a[k] += row[k];
}
// --- usage
const usgCur = a.on > 0 ? a.plays / a.on : null;
let usgPrior = null;
if (lp && lp.offPoss && lp.gp && lp.tsa100 != null) {
const tov100 = ((lp.tovpg || 0) / (lp.offPoss / lp.gp)) * 100;
usgPrior = (lp.tsa100 + tov100) / 100;
}
let usg;
if (usgCur != null && usgPrior) { const wc = a.on / (a.on + TUNE.usgPriorK); usg = wc * usgCur + (1 - wc) * usgPrior; }
else usg = usgCur != null ? usgCur : usgPrior || 0.16;
const gl = (o.gameLogs && o.gameLogs[norm(r.name)]) || null;
if (gl && gl.n >= 2 && gl.avg && gl.avg.usg > 0.03 && gl.avg.usg < 0.5 && TUNE.glUsgW > 0) {
const wg = TUNE.glUsgW * (gl.n / (gl.n + 3));
usg = (1 - wg) * usg + wg * gl.avg.usg;
}
const playsT = r.fga + 0.44 * r.fta + r.tov;
const onPlaysT = tMinNow[tm] > 0 ? (tPlaysNow[tm] * r.min) / (tMinNow[tm] / 5) : 0;
const usgT = onPlaysT > 0 ? playsT / onPlaysT : usg;
const wt = TUNE.tonightW * Math.min(1, r.min / TUNE.tonightRamp);
const wu = (TUNE.usgTonightW != null ? TUNE.usgTonightW : TUNE.tonightW) * Math.min(1, r.min / TUNE.tonightRamp);
const usgB = (1 - wu) * usg + wu * usgT;
// --- shot mix
const tot = a.fga + 0.44 * a.fta + a.tov;
let mix, r3;
if (tot >= 8) { mix = { fga: a.fga / tot, ft: (0.44 * a.fta) / tot }; r3 = a.fg3a / Math.max(a.fga, 1); }
else if (lp) { const ftr = lp.ftr || 0.25; mix = { fga: 0.82, ft: 0.44 * ftr * 0.82 }; r3 = lp.r3 != null ? lp.r3 : 0.35; }
else { mix = { fga: 0.8, ft: 0.08 }; r3 = 0.35; }
// --- shooting %
let p3prior = LEAGUE.p3;
if (lp && lp.p3 != null) { const att = lp.fg3a || 0; p3prior = (lp.p3 * att + LEAGUE.p3 * 60) / (att + 60); }
const p2prior = lp && lp.p2 != null ? lp.p2 : LEAGUE.p2;
const ftprior = lp && lp.ft != null ? lp.ft : LEAGUE.ft;
const f2a = a.fga - a.fg3a, f2m = Math.max((a.pts - 3 * a.fg3m - a.ftm) / 2, 0);
const d = ctx[opp];
// matchup: how this opponent defends the zones he actually shoots from (rim vs mid-range)
let zone = null;
if (d.oppZone && d.zoneGames >= 2) {
const pz = { rim: [0, 0], mid: [0, 0], three: [0, 0] };
for (const x of hs) if (x.z) for (const k of ['rim', 'mid', 'three']) if (x.z[k]) { pz[k][0] += x.z[k][0]; pz[k][1] += x.z[k][1]; }
const K = TUNE.zoneK;
const allow = (k) => (d.oppZone[k][1] + lgZ[k] * K) / (d.oppZone[k][0] + K);
const own = (k) => (pz[k][1] + lgZ[k] * 10) / (pz[k][0] + 10);
const twoA = pz.rim[0] + pz.mid[0];
const sRim = twoA >= 6 ? pz.rim[0] / twoA : lp && lp.prof && lp.prof.rim != null ? 0.45 : 0.45;
const num2 = sRim * own('rim') * (allow('rim') / lgZ.rim) + (1 - sRim) * own('mid') * (allow('mid') / lgZ.mid);
const den2 = sRim * own('rim') + (1 - sRim) * own('mid');
const f2 = den2 > 0 ? clamp(num2 / den2, 0.88, 1.12) : 1;
zone = { f2, sRim, rimAllow: allow('rim'), midAllow: allow('mid'), threeAllow: allow('three'), lgRim: lgZ.rim, lgMid: lgZ.mid, lgThree: lgZ.three, games: d.zoneGames };
}
const p2f = zone && TUNE.zoneW > 0 ? (1 - TUNE.zoneW) * d.p2f + TUNE.zoneW * zone.f2 : d.p2f;
const b2bE = b2b[tm] && st.phase === 'pre' ? 1 - TUNE.b2bEff : 1;
const p3 = clamp(((a.fg3m + p3prior * TUNE.p3K) / (a.fg3a + TUNE.p3K)) * d.p3f * TUNE.shotEff * b2bE, 0.15, 0.6);
const p2 = clamp(((f2m + p2prior * TUNE.p2K) / (f2a + TUNE.p2K)) * p2f * TUNE.shotEff * b2bE, 0.3, 0.75);
const ft = clamp((a.ftm + ftprior * TUNE.ftK) / (a.fta + TUNE.ftK), 0.4, 0.97);
// --- reb / ast per minute
const rate = {};
for (const k of ['reb', 'ast']) {
const cur = a.min > 0 ? a[k] / a.min : null;
const pr = lp ? lp[k] : null;
let base;
if (cur != null && pr != null) { const wc = n / (n + 6); base = wc * cur + (1 - wc) * pr; }
else base = cur != null ? cur : pr != null ? pr : BENCH_RATE[k];
const tn = r.min > 0 ? r[k] / r.min : base;
// the season part follows tonight's environment; tonight's own rate already lives in it
rate[k] = (1 - wt) * base * env[tm][k] + wt * tn;
}
// --- minutes
// recent games count more (role changes, returns from injury): weight decays per game back
const wOf = (x) => Math.pow(TUNE.minDecay, n - 1 - hs.indexOf(x));
const wmean = (arr, f) => { let s2 = 0, w2 = 0; for (const x of arr) { const ww = wOf(x); s2 += ww * f(x); w2 += ww; } return w2 ? s2 / w2 : 0; };
const mpg = n ? wmean(hs, (x) => x.min) : lp ? lp.mpg : 14;
const mpgFlat = n ? mean(hs.map((x) => x.min)) : mpg;
const qavg = {};
const closeG = TUNE.closeQ4 ? hs.filter((x) => Math.abs(x.margin) < 15) : hs;
const qBase = closeG.length >= 2 ? closeG : hs;
for (const q of [1, 2, 3, 4]) qavg[q] = n ? wmean(qBase, (x) => x.qmin[q] || 0) : mpg / 4;
let remCur = 0, remMid = 0, q4 = 0, rotInfo = null;
if (st.phase === 'pre') { remMid = qavg[1] + qavg[2] + qavg[3]; q4 = qavg[4]; }
else if (st.period <= 4) {
const curLeft = clockSec(st.clock) / 60;
const playedQ = r.qmin[st.period] || 0;
const fracQ = Math.min(qavg[st.period] / 12, 1);
const tf = 12 - curLeft > 1 ? playedQ / (12 - curLeft) : fracQ;
remCur = curLeft * ((1 - TUNE.qShareTonight) * fracQ + TUNE.qShareTonight * Math.min(tf, 1));
for (let q = st.period + 1; q <= 3; q++) remMid += qavg[q];
q4 = st.period < 4 ? qavg[4] : 0;
// rotation map: when this coach plays him, minute by minute, conditioned on whether he is
// on the floor right now, scaled by how tonight's rotation has treated him so far
const rotG = qBase.filter((x) => Array.isArray(x.st) && x.st.length);
if (TUNE.rot && rotG.length >= 2) {
// coach's foul rules: 2 in Q1 → sit to ~6:00 Q2; 3 in the 1st half → to halftime;
// 4 before Q4 → to ~9:00 Q4; 5 → saved for the last ~6 minutes
const pfT = r.pfAt || [];
const FR = { 2: [12, 18], 3: [24, 24], 4: [36, 39], 5: [42, 42] }; // foul # → [picked up before, rests until]
let restEnd = 0, lvl = 0;
for (const k of [5, 4, 3, 2]) {
if (r.pf >= k && pfT.length >= k && pfT[k - 1] < FR[k][0] && el < FR[k][1]) { restEnd = FR[k][1]; lvl = k; break; }
}
const fr = TUNE.foulRest[lvl] || [1, 1];
const fIn = restEnd > el ? (r.on ? fr[0] : fr[1]) : 1;
const fAfter = r.pf >= 4 ? TUNE.foulAfter : 1;
const seg = (x, a, b) => (b <= a ? 0 : restEnd > a ? fIn * onBetween(x.st, a, Math.min(b, restEnd)) + fAfter * onBetween(x.st, Math.max(a, restEnd), b) : fAfter * onBetween(x.st, a, b));
const pre = (x) => seg(x, el, 36), post = (x) => seg(x, Math.max(el, 36), 48);
const match = rotG.filter((x) => onAt(x.st, el) === !!r.on);
const wm = match.length / (match.length + TUNE.rotK);
let rPre = wm * (match.length ? mean(match.map(pre)) : 0) + (1 - wm) * mean(rotG.map(pre));
let rQ4 = wm * (match.length ? mean(match.map(post)) : 0) + (1 - wm) * mean(rotG.map(post));
const expSoFar = mean(rotG.map((x) => onBetween(x.st, 0, el)));
let tonight = 1;
if (TUNE.rotTonight > 0 && el >= 3) tonight = Math.pow((Math.max(r.min, 0) + TUNE.rotTonightK) / (Math.max(expSoFar, 0) + TUNE.rotTonightK), TUNE.rotTonight);
// sitting through minutes he normally plays = the coach has gone away from him (or he's hurt)
const sts = r.stints || [];
const sitFor = r.on ? 0 : sts.length ? el - sts[sts.length - 1][1] : el;
// a foul-trouble seat is the coach's normal foul rest, not a benching
const pfAt = r.pfAt || [];
const foulSit = restEnd > el && !r.on && sts.length && pfAt.length && sts[sts.length - 1][1] >= pfAt[pfAt.length - 1] - 0.1;
const missed = r.on || foulSit ? 0 : mean(rotG.map((x) => onBetween(x.st, el - sitFor, el)));
const benched = TUNE.benchM50 > 0 ? 1 / (1 + Math.exp((missed - TUNE.benchM50) / TUNE.benchS)) : 1;
rPre *= tonight * benched; rQ4 *= tonight * benched;
remCur = rPre; remMid = 0; q4 = rQ4;
const stintLens = rotG.flatMap((x) => x.st.filter(([a, b]) => b <= 48).map(([a, b]) => b - a));
rotInfo = { expSoFar, tonight, missed, sitFor, benched, foulRest: restEnd > el ? restEnd : 0, foulLvl: lvl, foulSit: !!foulSit, match: match.length, games: rotG.length,
stintAvg: stintLens.length ? mean(stintLens) : null, remMap: mean(rotG.map((x) => onBetween(x.st, el, 48))) };
}

} else {
remCur = (clockSec(st.clock) / 60) * Math.min(mpg / 40, 0.95);
}
const starter = mpg >= 24;
const hab0 = habits[tm];
const ph = hab0.players && hab0.players[r.name];
const hab = TUNE.blowPlayer && ph ? ph : hab0;
const b2bM = b2b[tm] && starter && st.phase === 'pre' ? 1 - TUNE.b2bMin : 1;
const foul = r.ejected || r.pf >= 6 || forceOut.has(+r.pid) ? 0 : rotInfo ? 1 : r.pf >= 5 ? 0.65 : r.pf === 4 && st.period <= 3 ? 0.82 : r.pf === 3 && st.period <= 2 ? 0.93 : 1;
const playShare = r.deep && !(r.min > 0) && teamGames[tm] > 0 ? clamp(n / teamGames[tm], 0.1, 1) : 1;
const mins = new Float64Array(N);
for (let i = 0; i < N; i++) {
const lead = (tm === v ? 1 : -1) * Math.sign(mQ3[i]);
const am = Math.abs(mQ3[i]);
let q4i = q4;
if (am >= 20) q4i = starter ? q4 * (lead > 0 ? hab.lead : hab.trail) : q4 * (lead > 0 ? 1.9 : 1.3);
else if (am >= 15) q4i = starter ? q4 * (lead > 0 ? (1 + hab.lead) / 2 : 0.9) : q4 * 1.15;
else if (am < 8 && starter && TUNE.closerQ4 > 0) q4i = Math.max(q4, Math.min(TUNE.closerQ4, 12));
const shock = clamp(R.normal(1, TUNE.minShock), 0.4, 1.5);
mins[i] = Math.min((remCur + remMid + q4i) * foul * shock * b2bM * playShare, left);
}
// his minutes still to come, quarter by quarter (for his quarter-by-quarter scoring shape)
const qRem = { 1: 0, 2: 0, 3: 0, 4: q4 };
if (st.phase === 'pre') { qRem[1] = qavg[1]; qRem[2] = qavg[2]; qRem[3] = qavg[3]; }
else if (st.period >= 4) qRem[4] = remCur + remMid + q4;
else {
const curLeft = clockSec(st.clock) / 60;
let tw = 0; const wq = {};
for (let q = st.period; q <= 3; q++) { wq[q] = (q === st.period ? curLeft : 12) * Math.max(qavg[q], 0.5) / 12; tw += wq[q]; }
for (let q = st.period; q <= 3; q++) qRem[q] = tw > 0 ? ((remCur + remMid) * wq[q]) / tw : 0;
}
const ratePM = {};
for (const k of ['pts', 'reb', 'ast', 'fg3m']) { const pk = lp && lp[k] != null ? lp[k] : k === 'pts' ? 0.42 : BENCH_RATE[k] || 0.05; ratePM[k] = (a[k] + pk * 60) / (a.min + 60); }
const sit = TUNE.sitOn !== 0 ? sitProfile(logs, r.pid, tm, stars[tm], sitPrior[r.pid] || null) : null;
// tonight's role vs his usual one
const startShare = n ? hs.filter((x) => Array.isArray(x.st) && x.st[0] && x.st[0][0] < 0.05).length / n : (lp && lp.mpg >= 26 ? 0.8 : 0.2);
const sT = startKnown ? (startT.has(+r.pid) ? 1 : 0) : null;
const lineupF = { startUp: sT === 1 ? (1 - startShare) * clamp((30 - mpg) / Math.max(mpg, 6), 0, 2.5) : 0, startDown: sT === 0 ? startShare : 0, fresh: !!r.fresh, deep: !!r.deep,
lastMin: n >= 2 ? hs[n - 1].min - mpg : 0, rest3: rest3[tm], missShare: teamGames[tm] > 0 ? clamp(1 - n / teamGames[tm], 0, 1) : 0 };
if (st.phase === 'pre' && sT === 0 && startShare >= 0.7 && mpg >= 20 && !forceIn.has(+r.pid)) doubt[r.pid] = doubt[r.pid] || 'usual starter, not in tonight\'s starting five';
players.push({ lineupF, sT, startShare, sit, qRem, ratePM, usgBase: usg, p2fA: p2f, r, tm, opp, usg: usgB, usgSeason: usgCur, usgTonight: r.min > 0 ? usgT : null, mix, r3, p3, p2, ft, rate, mins, mpg, mpgFlat, qavg, starter, n, rotInfo, lp, gl, zone, recent3: n ? mean(hs.slice(-3).map((x) => x.min)) : null });
}

// position groups of the missing players: their minutes go first to the same group (guards for guards)
const grp = (pos) => (!pos ? null : /C/.test(pos) ? 'C' : /PF|SF/.test(pos) ? 'F' : 'G');
const posNeed = {};
for (const tm of [v, h]) {
const need = { G: 0, F: 0, C: 0 }; let tot = 0;
for (const x of absent.filter((y) => y.team === tm)) {
const hs = hist[x.pid] || []; const m = hs.length ? mean(hs.slice(-3).map((r) => r.min)) : 0;
const pr = last[norm(x.name)] || cur[norm(x.name)]; const g = grp(pr && pr.pos);
if (g && m > 0) { need[g] += m; tot += m; }
}
posNeed[tm] = tot > 0 ? { G: need.G / tot, F: need.F / tot, C: need.C / tot, min: tot } : null;
}
for (const p of players) p.grp = grp(p.lp && p.lp.pos);
// fill each team's minutes to 5 x time left (bench first, then starters)
const fillDebug = {};
for (const tm of [v, h]) {
const ps = players.filter((p) => p.tm === tm);
if (!ps.length) continue;
fillDebug[tm] = left > 0 ? ps.reduce((a, p) => a + mean(p.mins), 0) / (5 * left) : 1;
const bench = ps.filter((p) => !p.starter), sts = ps.filter((p) => p.starter);
for (let i = 0; i < N; i++) {
let tot = 0;
for (const p of ps) tot += p.mins[i];
let excess = Math.max(tot - 5 * left, 0);
// too many minutes (deep rotation / inactive guys): trim bench first, then starters
for (const group of [bench, sts]) {
if (excess <= 0) break;
let have = 0;
for (const p of group) have += p.mins[i];
if (have <= 0) continue;
const take = Math.min(excess, have * 0.95);
for (const p of group) p.mins[i] -= (take * p.mins[i]) / have;
excess -= take;
}
let deficit = Math.max(5 * left - tot, 0);
// unclaimed minutes go to players already in tonight's rotation (not to guys the coach benched)
const avail = (p) => (p.rotInfo ? p.rotInfo.benched : 1) * (p.r.ejected || p.r.pf >= 6 ? 0 : 1);
const pn = posNeed[tm];
const posW = (p) => (pn && TUNE.fillPos > 0 && st.phase === 'pre' && p.grp ? 1 + TUNE.fillPos * 3 * (pn[p.grp] || 0) : 1);
const share = (p) => Math.max(left - p.mins[i], 0) * avail(p) * posW(p) * (TUNE.fillByMin ? Math.pow(p.mins[i] / Math.max(left, 1) + 0.02, TUNE.fillPow) : 1);
for (const group of TUNE.fillByMin === 2 ? [ps] : [bench, sts]) {
if (deficit <= 0) break;
let cap = 0, wsum = 0;
for (const p of group) { cap += Math.max(left - p.mins[i], 0); wsum += share(p); }
if (cap <= 0 || wsum <= 0) continue;
const give = Math.min(deficit, cap * 0.9);
for (const p of group) p.mins[i] = Math.min(left, p.mins[i] + (give * share(p)) / wsum);
deficit -= give;
}
}
}
// usage renormalization: each team's on-floor usage averages 20%
const scale = {};
for (const tm of [v, h]) {
const ps = players.filter((p) => p.tm === tm);
let wm = 0, mm = 0;
for (const p of ps) { const m = mean(p.mins); wm += p.usg * m; mm += m; }
scale[tm] = mm > 0 ? clamp(TUNE.usgTarget / (wm / mm), 0.85, 1.2) : 1;
// short of usage (teammates out): the bigger roles take a bigger share of what's freed
if (TUNE.usgRedistPow > 0 && scale[tm] > 1 && mm > 0) {
const mu = wm / mm, s0 = scale[tm];
let w2 = 0;
for (const p of ps) { p.uMul = 1 + (s0 - 1) * Math.pow(p.usg / mu, TUNE.usgRedistPow); w2 += p.usg * p.uMul * mean(p.mins); }
const c = w2 > 0 ? (s0 * wm) / w2 : 1;
for (const p of ps) p.uMul *= c;
}
}

// top-down team check: each team's points for the rest of the game by the books' line (or team ratings), and tonight's scoring so far, vs the sum of our player numbers
const tdF = { [v]: { mkt: 0, live: 0 }, [h]: { mkt: 0, live: 0 } };
if (TUNE.tdOn > 0 && !o.tdOff && st.phase !== 'final' && left > 0) {
const shrT = (tm, k) => { const d = teamsDb[tm]; return d ? lgOrtg + (d.g / (d.g + 8)) * (d[k] - lgOrtg) : lgOrtg; };
for (const tm of [v, h]) {
const op = tm === v ? h : v;
let bu = 0, tot = 0;
for (const p of players) {
if (p.tm !== tm) continue;
const m = mean(p.mins); tot += m;
const u = p.usg * (p.uMul != null ? p.uMul : scale[p.tm]);
bu += ((possLeft * ctx[tm].playsPerPoss * m) / left) * u * (p.mix.fga * (p.r3 * 3 * p.p3 + (1 - p.r3) * 2 * p.p2) + (p.mix.ft / 0.44) * p.ft);
}
if (TUNE.otherPM > 0 && tot < 5 * left) bu += (5 * left - tot) * TUNE.otherPM;
const full = mk && mk.total ? (mk.spreadHome != null ? (mk.total + (tm === v ? 1 : -1) * mk.spreadHome) / 2 : mk.total / 2) : (seasonPace * ((shrT(tm, 'ortg') * shrT(op, 'drtg')) / lgOrtg)) / 100;
const priorRem = (full * Math.min(left, 48)) / 48;
if (bu > 1 && priorRem > 1) tdF[tm].mkt = clamp(Math.log(priorRem / bu) * 5, -2, 2);
const ptsNow = tm === v ? st.vs : st.hs;
if (st.phase === 'live' && el >= 3 && full > 0) tdF[tm].live = clamp(Math.log(Math.max(ptsNow, 1) / ((full * el) / 48)) * 5 * (el / (el + 12)), -2, 2);
}
}
// team load: the usual minutes of everyone available tonight, added up, against the 240 a team can play. When players
// are out it falls short of 240, when everyone is back it runs well past it. The simulation shares the difference out
// by its own rules; who really absorbs it (measured on 1,199 unseen games: the regular bench far less than assumed, in
// both directions) is learned from finished games.
const loadT = {};
for (const tm of [v, h]) { let s = 0; for (const p of players) if (p.tm === tm) s += p.mpg || 0; loadT[tm] = s / 240 - 1; }
// learned layer, pass 1: each player's features and his learned minutes factor
const patOn = !!(o.patterns && TUNE.patW > 0);
const patG = patGroup(st, lineup.confirmed);
// lessons for the injury-report stage fall back to the posted-lineup ones until they have been learned
const patSrc = (g) => (o.patterns[g] || (g === 'rep' ? o.patterns.pre : null) || {});
let patB = patOn ? patSrc(patG) : {};
if (patOn && TUNE.patInterp > 0 && st.phase === 'live' && st.period <= 4) {
// the lessons were learned at exact stages (6, 12, ... 42 minutes in): between two stages, mix them by how far along the game is
const lo = clamp(Math.floor(el / 6) * 6, 6, 42), hi = Math.min(lo + 6, 42), t = hi > lo ? clamp((el - lo) / 6, 0, 1) : 0;
const A = o.patterns['s' + lo] || {}, B = o.patterns['s' + hi] || {};
if (t > 0.001 && t < 0.999) {
patB = {};
for (const s2 of PAT_LEARN) {
const a = A[s2], b2 = B[s2];
// (just after halftime the minutes lessons do not blend: the halftime ones describe a break with nobody on the floor.
// Measured on 400 unseen games: blending them made minutes 2% worse at 27 minutes, and better everywhere else)
if (s2 === 'min' && lo === 24 && TUNE.patInterp < 2) { patB[s2] = (o.patterns[patG] || {}).min || a || b2 || null; continue; }
patB[s2] = a && b2 ? a.map((x, i) => (1 - t) * (x || 0) + t * (b2[i] || 0)) : a || b2 || null;
}
} else patB = (t >= 0.999 ? B : A) || {};
}
for (const p of players) {
const r = p.r;
const proofP = !!(p.starter && ((habits[p.tm].players || {})[r.name] || {}).proof);
const lu0 = LU[r.pid] || null;
const lu = lu0 ? { ...lu0, xPts: r.fg3a * 3 * p.p3 + (r.fga - r.fg3a) * 2 * p.p2 + r.fta * p.ft } : null;
const sts0 = r.stints || [], lastS0 = sts0[sts0.length - 1];
const d1 = p.sit && st.phase === 'live' && r.min >= 6 && el >= 10 ? clamp(r.pts / r.min / p.sit.base - 1, -1, 2) : null;
const patX = patFeatures({ phase: st.phase, starter: p.starter, mpg: p.mpg, b2b: b2b[p.tm] && st.phase === 'pre', pace: seasonPace, pBlow, roleTrend: p.recent3 != null ? p.recent3 - p.mpgFlat : 0,
scale: p.uMul != null ? p.uMul : scale[p.tm], proof: proofP, home: p.tm === h, zoneF2: p.zone ? p.zone.f2 : 1, ratePM: p.ratePM, min: r.min, now: r,
foulTrouble: st.phase !== 'pre' && r.pf >= Math.min(st.period + 1, 5) && !(r.ejected || r.pf >= 6), livePace, absMargin: Math.abs(st.vs - st.hs),
minTrack: p.rotInfo ? (r.min + 6) / (p.rotInfo.expSoFar + 6) : 1, fga: r.fga, fgm: r.fgm,
startUp: p.lineupF.startUp, startDown: p.lineupF.startDown, fresh: p.lineupF.fresh, deep: p.lineupF.deep, lastMin: p.lineupF.lastMin, rest3: p.lineupF.rest3, missShare: p.lineupF.missShare,
vacPos: posNeed[p.tm] && p.grp ? (posNeed[p.tm].min * (posNeed[p.tm][p.grp] || 0)) / 48 : 0,
usgS: p.usgBase, lu, mg: (p.tm === v ? 1 : -1) * (st.vs - st.hs), on: !!r.on, dnp: !!r.dnpYet, sitting: !r.on && lastS0 ? el - lastS0[1] : 0, el, fade: p.sit ? p.sit.fade : null, d1, tdMkt: tdF[p.tm].mkt, tdLive: tdF[p.tm].live, load: loadT[p.tm], favBy: (p.tm === v ? 1 : -1) * expV48 });
const Fm = patB.min && !(r.ejected || r.pf >= 6) ? patApply(patB.min, patX.min, TUNE.patCapMin, 0, TUNE.patCapMinUp > 0 ? TUNE.patCapMinUp : null) : { f: 1, z: 0, parts: null };
p.lu = lu; p.pat = { g: patG, x: patX, F: { min: Fm } };
p.minPlain = mean(p.mins);
if (Fm.f !== 1) for (let i = 0; i < N; i++) p.mins[i] = Math.min(left, p.mins[i] * Fm.f);
}
// a team can't play more than 5 x the time left (it can play fewer of the players we track: deep bench in garbage time)
// Before tip-off each player's number answers "what if he plays": someone on the active list who ends up sitting is no
// action on a pick. Those minutes can add up to more than a team has, so before tip-off they are left as they are and the
// TEAM total is scaled to five players' worth of minutes instead (v15). Once the game is on, minutes are squeezed as before.
const teamK = { [v]: null, [h]: null };
if (patOn && patB.min) for (const tm of [v, h]) {
const ps = players.filter((p) => p.tm === tm);
const amNow = Math.abs(st.vs - st.hs);
const close = st.phase === 'live' ? 1 - clamp(Math.max(pBlow, (amNow - 8) / 15), 0, 1) : 1;
const give = TUNE.refill * close;
const cond = TUNE.condMin > 0 && st.phase === 'pre';
if (cond) teamK[tm] = new Float64Array(N).fill(1);
for (let i = 0; i < N; i++) {
let tot = 0; for (const p of ps) tot += p.mins[i];
if (tot > 5 * left && tot > 0) { const k = (5 * left) / tot; if (cond) teamK[tm][i] = k; else for (const p of ps) p.mins[i] *= k; }
else if (give > 0 && tot < 5 * left) {
// close game: minutes taken from one player are played by his teammates (those the layer did not cut)
let room = 0;
for (const p of ps) if (p.pat.F.min.f >= 0.97 && !(p.r.ejected || p.r.pf >= 6)) room += p.mins[i] * Math.max(left - p.mins[i], 0);
if (room > 0) { const add = give * (5 * left - tot); for (const p of ps) if (p.pat.F.min.f >= 0.97 && !(p.r.ejected || p.r.pf >= 6)) p.mins[i] = Math.min(left, p.mins[i] + (add * p.mins[i] * Math.max(left - p.mins[i], 0)) / room); }
}
}
}
// overtime: the closer the game late, the more often it runs five extra minutes, and the players finishing the game play them
let otShare = 0;
if (TUNE.otSim > 0 && st.phase !== 'final' && st.period <= 4 && left > 0) {
const tau = Math.max(48 - Math.max(36, el), 0.5), sdM = 2.5 * Math.sqrt(tau);
for (let i = 0; i < N; i++) {
const z = mQ3[i] / sdM;
const pOt = Math.min(0.6, (1.8 * Math.exp(-0.5 * z * z)) / (sdM * 2.5066));
if (R.u() >= pOt) continue;
otShare++;
for (const tm of [v, h]) {
let sw = 0;
for (const p of players) if (p.tm === tm && !(p.r.ejected || p.r.pf >= 6)) sw += p.mins[i] * p.mins[i];
if (sw > 0) for (const p of players) if (p.tm === tm && !(p.r.ejected || p.r.pf >= 6)) p.mins[i] += Math.min(5, (25 * p.mins[i] * p.mins[i]) / sw);
}
}
otShare /= N;
}
// learned layer, pass 2: stat factors; the usage-shift part is shared inside the team (his extra shots come off teammates)
const shiftT = { [v]: 0, [h]: 0 };
if (patOn && patB.pts && TUNE.shiftCenter > 0 && st.phase === 'live') for (const tm of [v, h]) {
let sw = 0, sz = 0;
for (const p of players) { if (p.tm !== tm) continue; const w = mean(p.mins) * p.usg; sw += w; sz += w * patShiftPart(patB.pts, p.pat.x.pts); }
shiftT[tm] = sw > 0 ? (TUNE.shiftCenter * sz) / sw : 0;
}
for (const p of players) {
for (const s2 of PAT_STATS) p.pat.F[s2] = patB[s2] ? patApply(patB[s2], p.pat.x[s2], TUNE.patCap, s2 === 'pts' ? shiftT[p.tm] : 0) : { f: 1, z: 0, parts: null };
}

// simulate
const results = [];
const teamPts = { [v]: new Float64Array(N), [h]: new Float64Array(N) };
for (const p of players) {
const r = p.r;
const proofP = !!(p.starter && ((habits[p.tm].players || {})[r.name] || {}).proof);
const patF = p.pat.F;
const usg = p.usg * (p.uMul != null ? p.uMul : scale[p.tm]) * patF.pts.f;
// situational scoring tendencies for this game's script (re-read on every live update)
const S = p.sit;
let sitArr = null, sitMean = null;
if (S && st.phase !== 'final' && left > 0) {
const sgn = p.tm === v ? 1 : -1;
let starOffShift = 0;
if (S.star) {
const sp = players.find((x) => +x.r.pid === +S.star.pid);
const gone = !sp || sp.r.ejected || sp.r.pf >= 6 || forceOut.has(+S.star.pid);
if (gone) starOffShift = 1;
else {
const msRem = mean(sp.mins);
const normRem = sp.rotInfo ? sp.rotInfo.remMap : (S.star.mpg * left) / 48;
starOffShift = clamp((normRem - msRem) / Math.max(left, 1), -0.5, 1);
}
}
const clutchShare = st.phase !== 'pre' && st.period >= 4 ? (left <= 5 ? 1 : 5 / left) : 5 / 12;
const d1 = st.phase === 'live' && r.min >= 6 && el >= 10 ? clamp(r.pts / r.min / S.base - 1, -1, 2) : null;
sitArr = new Float64Array(N);
const acc = { f: 0, q: 0, state: 0, home: 0, rest: 0, star: 0, fade: 0, streak: 0 };
for (let i = 0; i < N; i++) {
const F = sitFactor(S, { qRem: p.qRem, m0: sgn * (st.vs - st.hs), m3: sgn * mQ3[i], clutchShare, home: p.tm === h, b2b: !!b2b[p.tm], starOffShift, d1 });
sitArr[i] = F.f; acc.f += F.f;
for (const k of Object.keys(F.parts)) acc[k] += F.parts[k];
}
sitMean = {};
for (const k of Object.keys(acc)) sitMean[k] = acc[k] / N;
sitMean.starOffShift = starOffShift; sitMean.d1 = d1;
}
p.sitMean = sitMean;
const r3P = clamp(p.r3 * patF.fg3m.f / patF.pts.f, 0, 0.95);
const sims = { pts: new Int16Array(N), reb: new Int16Array(N), ast: new Int16Array(N), fg3m: new Int16Array(N), fga: new Int16Array(N), fg3a: new Int16Array(N), fta: new Int16Array(N) };
let minSum = 0;
for (let i = 0; i < N; i++) {
const m = p.mins[i];
minSum += m;
const uS = TUNE.usgShock > 0 ? Math.exp(R.normal(-TUNE.usgShock * TUNE.usgShock / 2, TUNE.usgShock)) : 1;
const lam = left > 0 ? ((possLeft * ctx[p.tm].playsPerPoss * m) / left) * usg * uS * (sitArr ? sitArr[i] : 1) : 0;
const plays = R.poisson(lam);
const fga = R.binomial(plays, p.mix.fga);
const fta = R.poisson((lam * p.mix.ft) / 0.44);
const f3a = R.binomial(fga, r3P);
const f2a = fga - f3a;
const n3 = clamp(R.normal(p.p3, 0.07), 0.05, 0.75), n2 = clamp(R.normal(p.p2, 0.06), 0.2, 0.85);
const m3 = R.binomial(f3a, n3), m2 = R.binomial(f2a, n2), mft = R.binomial(fta, p.ft);
const add = 3 * m3 + 2 * m2 + mft;
sims.pts[i] = r.pts + add;
sims.fg3m[i] = r.fg3m + m3;
sims.fga[i] = r.fga + fga;
sims.fg3a[i] = r.fg3a + f3a;
sims.fta[i] = r.fta + fta;
const sR = TUNE.rebShock > 0 ? Math.exp(R.normal(-TUNE.rebShock * TUNE.rebShock / 2, TUNE.rebShock)) : 1;
const sA = TUNE.astShock > 0 ? Math.exp(R.normal(-TUNE.astShock * TUNE.astShock / 2, TUNE.astShock)) : 1;
sims.reb[i] = r.reb + R.negbin(p.rate.reb * m * sR * patF.reb.f, TUNE.varReb || VAR_K.reb);
sims.ast[i] = r.ast + R.negbin(p.rate.ast * m * sA * patF.ast.f, TUNE.varAst || VAR_K.ast);
teamPts[p.tm][i] += add;
}
const sdOf = (a) => { let m = 0; for (let i = 0; i < N; i++) m += a[i]; m /= N; let v = 0; for (let i = 0; i < N; i++) v += (a[i] - m) * (a[i] - m); return Math.sqrt(v / N); };
const pra = new Int16Array(N);
for (let i = 0; i < N; i++) pra[i] = sims.pts[i] + sims.reb[i] + sims.ast[i];
sims.pra = pra;
const avg = {};
for (const k of Object.keys(sims)) { let s = 0; const a = sims[k]; for (let i = 0; i < N; i++) s += a[i]; avg[k] = s / N; }
const sd = {}; for (const k of ['pts', 'reb', 'ast', 'fg3m', 'pra']) sd[k] = +sdOf(sims[k]).toFixed(2);
// chances on each ladder: as simulated, then calibrated to how often such chances really came in from this stage
const calT = patOn && o.patterns.cal ? o.patterns.cal[patG] || (patG === 'rep' ? o.patterns.cal.pre : null) : null;
const cal = {};
if (calT) for (const k of CAL_STATS) cal[k] = calT[k] ? calT[k][calLevel(k, avg[k] - r[k])] : null;
const laddersRaw = {}, ladders = {};
for (const [k, steps] of Object.entries(LADDERS)) {
laddersRaw[k] = steps.map((t) => ({ t, p: probAtLeast(sims[k], t) }));
ladders[k] = cal[k] ? laddersRaw[k].map((x) => ({ t: x.t, p: x.t <= r[k] ? x.p : calP(cal[k], x.p) })) : laddersRaw[k];
}
// the likely range: about 8 games in 10 land between these two numbers (from the calibrated chances, so it is as wide as results really run)
const range = {}, mid = {};
for (const k of ['pts', 'reb', 'ast', 'fg3m', 'pra']) {
const srt = Array.from(sims[k]).sort((x, y) => x - y);
{ let m = 0, c = 0; for (let q = Math.floor(N * 0.4); q <= Math.min(N - 1, Math.floor(N * 0.6)); q++) { m += srt[q]; c++; } mid[k] = c ? m / c : avg[k]; }
const base = k === 'pra' ? r.pts + r.reb + r.ast : r[k];
let lo = base, hi = base, j = 0;
for (let t = base + 1; t <= srt[N - 1]; t++) { while (j < N && srt[j] < t) j++; const pc = cal[k] ? calP(cal[k], (N - j) / N) : (N - j) / N; if (pc >= 0.9) lo = t; if (pc >= 0.1) hi = t; else break; }
range[k] = [lo, hi];
}
// what we show: average and middle blended by stage (LAND); the plain average stays in `mean` for the learning loop and team totals
const shown = { ...avg };
const landW = TUNE.landOn > 0 && st.phase !== 'final' && left > 0 ? LAND[patG] : null;
if (landW) for (const k of PAT_STATS) { const lw = landW[k] || 0; if (lw > 0) shown[k] = Math.max(r[k], (1 - lw) * avg[k] + lw * mid[k]); }
const flags = [];
if (r.pf >= 5) flags.push('foul5');
else if (r.pf >= 4 && st.period <= 3) flags.push('foul4');
else if (r.pf >= 3 && st.period <= 2) flags.push('foul3');
if (r.ejected || forceOut.has(+r.pid)) flags.push('out');
if (r.min >= 8 && p.n) {
const seasonRate = p.n ? mean((hist[r.pid] || []).map((x) => x.pts / Math.max(x.min, 1))) : 0;
if (seasonRate > 0 && r.pts / r.min > seasonRate * 1.4) flags.push('hot');
else if (seasonRate > 0 && r.min >= 12 && r.pts / r.min < seasonRate * 0.5) flags.push('cold');
}
const blowP = (habits[p.tm].players || {})[r.name] || null;
const proof = !!(p.starter && blowP && blowP.proof);
if (proof) flags.push('blowproof');
if (p.starter && pBlow >= 0.3 && st.phase === 'live' && !proof) flags.push('sitrisk');
if (doubt[r.pid] && st.phase === 'pre') flags.push('doubt');

const stints = r.stints || [];
const lastSt = stints[stints.length - 1];
const cx = { phase: st.phase, el, left, minProj: minSum / N, scale: scale[p.tm], pBlow, habit: habits[p.tm], blowP, proof, absentMates: absent.filter((x) => x.team === p.tm),
pace: seasonPace, livePace, mk, b2b: b2b[p.tm], doubt: st.phase === 'pre' ? doubt[r.pid] || null : null, lineup, inList: availIn.has(+r.pid), oppCtx: ctx[p.opp], lgP3: lgZ.three,
b2b: b2b[p.tm], proj: shown, now: r, ratePM: p.ratePM, pat: { x: p.pat.x, F: p.pat.F }, sit: p.sit, sitMean: p.sitMean, home: p.tm === h, m0: (p.tm === v ? 1 : -1) * (st.vs - st.hs), period: st.period };
// vs a normal night from this point: his usual remaining minutes at his usual scoring rate
const usualRem = st.phase === 'live' ? (p.rotInfo ? p.rotInfo.remMap : (p.mpg * left) / 48) : null;
const remPts = shown.pts - r.pts, remMinP = minSum / N;
const baseRem = usualRem != null ? p.ratePM.pts * usualRem : null;
cx.shift = usualRem != null ? { usualRem, remMin: remMinP, baseRem, rem: remPts, dMin: (remMinP - usualRem) * p.ratePM.pts, dRate: remPts - remMinP * p.ratePM.pts } : null;
cx.fade = st.phase === 'live' ? fadeCheck(p, r, cx, shown, patF) : null;
const ctxItems = contextItems(p, r, cx);
const why = st.phase === 'live' ? (cx.fade ? [{ icon: '📉', key: 'fade', effect: 'down', text: cx.fade.text, so: cx.fade.so }] : []).concat(explain(p, r, cx), ctxItems.filter((x) => x.key !== 'usage' && x.key !== 'role' && x.key !== 'blowproof')) : ctxItems;
if (cx.fade) flags.push('fade');
if (cx.fade === null && st.phase === 'live' && p.lu && r.min >= 8 && flags.includes('hot') && p.pat.x.pts[PAT_IX.uReal] >= 1) flags.push('realhot');
results.push({
shift: cx.shift, fade: cx.fade,
pid: r.pid, name: r.name, team: p.tm, opp: p.opp, on: r.on, starter: p.starter, dnpYet: !!r.dnpYet, fresh: !!r.fresh, deep: !!r.deep, startsTonight: p.sT, blowProof: proof, blowHab: blowP,
stints, stintNow: r.on && lastSt ? el - lastSt[0] : 0, sitting: !r.on && lastSt ? el - lastSt[1] : null, rot: p.rotInfo, why,
chips: ctxItems.filter((x) => x.chip).sort((a, b) => (a.effect === 'info') - (b.effect === 'info')).map((x) => ({ t: x.chip, e: x.effect })), confirmed: lineup.confirmed && availIn.has(+r.pid),
now: { pts: r.pts, reb: r.reb, ast: r.ast, fg3m: r.fg3m, fg3a: r.fg3a, fga: r.fga, fgm: r.fgm, fta: r.fta, ftm: r.ftm, tov: r.tov, pf: r.pf, min: r.min },
proj: { ...shown, min: r.min + minSum / N }, mean: { ...avg, min: r.min + minSum / N }, mid,
usage: { season: p.usgSeason, tonight: p.usgTonight, proj: usg },
shooting: { p2: p.p2, p3: p.p3, ft: p.ft, r3: p.r3 },
mpg: p.mpg, qavg: p.qavg, games: p.n, flags, ladders, doubt: st.phase === 'pre' ? doubt[r.pid] || null : null,
zones: r.z || {},
db: { nba_id: p.lp ? p.lp.nba_id || null : null, pos: p.lp ? p.lp.pos || null : null, arch: p.lp ? p.lp.arch || null : null, prof: p.lp ? p.lp.prof || null : null, logs: p.gl },
sit: p.sitMean ? { f: +p.sitMean.f.toFixed(3), parts: Object.fromEntries(Object.entries(p.sitMean).filter(([k]) => k !== 'f').map(([k, x]) => [k, x == null ? null : +x.toFixed(3)])), ratio: p.sit ? Object.fromEntries(Object.entries(p.sit.ratio).map(([k, x]) => [k, +x.toFixed(3)])) : null, fade: p.sit ? +p.sit.fade.toFixed(3) : null, streak: p.sit ? +p.sit.streak.toFixed(3) : null, star: p.sit && p.sit.star ? p.sit.star.name : null } : null,
pat: { g: p.pat.g, x: p.pat.x, f: Object.fromEntries(PAT_LEARN.map((s2) => [s2, p.pat.F[s2].f])), parts: patOn ? Object.fromEntries(PAT_LEARN.map((s2) => [s2, p.pat.F[s2].parts])) : null, shift: p.pat.F.pts.shift || 0 },
sd, range, cal, laddersRaw,
live: p.lu ? { onPlays: +p.lu.onPlays.toFixed(1), plays: +p.lu.plays.toFixed(1), xPts: +p.lu.xPts.toFixed(1), playsR: +p.lu.playsR.toFixed(1), onPlaysR: +p.lu.onPlaysR.toFixed(1), minR: +p.lu.minR.toFixed(1) } : null, minPlain: r.min + p.minPlain, usgBase: p.usgBase, ratePM: p.ratePM,
_sims: sims,
});
}
results.sort((x, y) => y.proj.pts - x.proj.pts);
scorerRace(results, N);
const alerts = st.phase === 'live' ? liveAlerts(results, st, absent) : [];
if (TUNE.otherPM > 0 && left > 0) for (const tm of [v, h]) {
const ps = players.filter((p) => p.tm === tm);
for (let i = 0; i < N; i++) { let tot = 0; for (const p of ps) tot += p.mins[i]; if (tot < 5 * left) teamPts[tm][i] += (5 * left - tot) * TUNE.otherPM; }
}
// team totals: "if he plays" minutes scaled to what a team can play, then the learned team check for this stage
// (how the points still to come really ran against our sum of players in graded games)
const teamRaw = {};
const tF = patOn && TUNE.teamCal > 0 && o.patterns.team ? (o.patterns.team[patG] != null ? o.patterns.team[patG] : patG === 'rep' && o.patterns.team.pre != null ? o.patterns.team.pre : 1) : 1;
for (const tm of [v, h]) {
const K = teamK[tm];
let sRaw = 0;
for (let i = 0; i < N; i++) { if (K) teamPts[tm][i] *= K[i]; sRaw += teamPts[tm][i]; teamPts[tm][i] *= tF; }
teamRaw[tm] = sRaw / N;
}
let vWin = 0;
for (let i = 0; i < N; i++) if (st.vs + teamPts[v][i] > st.hs + teamPts[h][i]) vWin++;
const projScore = { [v]: st.vs + mean(Array.from(teamPts[v])), [h]: st.hs + mean(Array.from(teamPts[h])) };
return {
state: st, patG, teamRaw, teamFactor: tF, players: results, projScore, winProb: { [v]: vWin / N, [h]: 1 - vWin / N },
blowout: { now: isBlowout(st), pBlow, pBig }, possLeft, pace: { season: seasonPace, live: livePace },
context: ctx, habits, injuries: out, absent, b2b, sims: N, fillDebug, env, lineup, lgZone: lgZ, alerts,
market: mk ? { ...mk, paceMkt, paceModel, marginModel, projTotal: projScore[v] + projScore[h], projMargin: projScore[v] - projScore[h] } : null,
teamsDb, league: lgT,
};
}

/**
* Scoring race inside one game: for each player, the share of simulations where he finishes as the game's
* top scorer, his team's top scorer, and in the game's top 3 (ties split evenly). Uses the full simulated
* finals, so it already carries minutes, role, foul trouble, blowouts and situational scoring.
*/
function scorerRace(players, N) {
const ps = players.filter((p) => p._sims && p._sims.pts);
const lead = new Float64Array(ps.length), teamLead = new Float64Array(ps.length), top3 = new Float64Array(ps.length);
const teams = [...new Set(ps.map((p) => p.team))];
const byTeam = teams.map((t) => ps.map((p, j) => (p.team === t ? j : -1)).filter((j) => j >= 0));
const a = ps.map((p) => p._sims.pts);
for (let i = 0; i < N; i++) {
let m1 = -1, m2 = -1, m3 = -1;
for (let j = 0; j < ps.length; j++) { const x = a[j][i]; if (x > m1) { m3 = m2; m2 = m1; m1 = x; } else if (x > m2) { m3 = m2; m2 = x; } else if (x > m3) m3 = x; }
let k = 0; for (let j = 0; j < ps.length; j++) if (a[j][i] === m1) k++;
// top 3 by value; players tied at the 3rd value share the spots left
let above = 0, at = 0; for (let j = 0; j < ps.length; j++) { const x = a[j][i]; if (x > m3) above++; else if (x === m3) at++; }
const share3 = at ? Math.max(0, Math.min(1, (3 - above) / at)) : 0;
for (let j = 0; j < ps.length; j++) { const x = a[j][i]; if (x === m1) lead[j] += 1 / k; if (x > m3) top3[j] += 1; else if (x === m3) top3[j] += share3; }
for (const js of byTeam) {
let tm = -1; for (const j of js) if (a[j][i] > tm) tm = a[j][i];
let tk = 0; for (const j of js) if (a[j][i] === tm) tk++;
for (const j of js) if (a[j][i] === tm) teamLead[j] += 1 / tk;
}
}
ps.forEach((p, j) => { p.race = { game: lead[j] / N, team: teamLead[j] / N, top3: Math.min(1, top3[j] / N) }; });
for (const p of players) if (!p.race) p.race = { game: 0, team: 0, top3: 0 };
return players;
}

function probAtLeast(arr, t) {
let c = 0;
for (let i = 0; i < arr.length; i++) if (arr[i] >= t) c++;
return c / arr.length;
}
/** P(over a posted line): half-point lines need floor(line)+1. */
function probOver(arr, line) {
const t = Number.isInteger(line) ? line + 1 : Math.floor(line) + 1;
return probAtLeast(arr, t);
}

// ---------------------------------------------------------------- market lines (DataBallr props)
const PROP_MAP = { points: 'pts', rebounds: 'reb', assists: 'ast', threes: 'fg3m', points_rebounds_assists: 'pra' };
const implied = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
function consensusLines(props) {
const by = {};
for (const x of props || []) {
const stat = PROP_MAP[x.prop_type];
if (!stat || !x.market || x.market.type !== 'over_under') continue;
const key = x.player_id + ':' + stat;
(by[key] = by[key] || []).push(x);
}
const out = {};
for (const [key, xs] of Object.entries(by)) {
const lines = xs.map((x) => parseFloat(x.line_value)).filter(Number.isFinite).sort((a, b) => a - b);
if (!lines.length) continue;
const med = lines[Math.floor(lines.length / 2)];
const at = xs.filter((x) => parseFloat(x.line_value) === med);
const fair = mean(at.map((x) => { const io = implied(x.market.over_odds), iu = implied(x.market.under_odds); return io / (io + iu); }));
const [pid, stat] = key.split(':');
out[key] = { pid: +pid, stat, line: med, fairOver: fair, books: at.length };
}
return out;
}

// ---------------------------------------------------------------- picks + combos
const STAT_LABEL = { pts: 'PTS', reb: 'REB', ast: 'AST', fg3m: '3PM', pra: 'PRA' };

/**
* Edge tier for a pick: STRONG / SOLID / SLIGHT by how far the model clears the book, or UNSURE when
* the number rests on something shaky (status, foul trouble, pulled from the rotation, thin minutes).
*/
function edgeTier(p, k, phase) {
const why = [];
if (p.doubt) why.push(p.doubt);
if (p.flags.some((f) => f.startsWith('foul'))) why.push(`${p.now.pf} fouls`);
if (p.flags.includes('sitrisk')) why.push('may sit late');
if (phase === 'live' && p.rot && !p.on && !p.rot.foulSit && p.rot.benched < 0.5 && !p.dnpYet) why.push('pulled from the rotation');
if (phase === 'live' && p.dnpYet) why.push("hasn't checked in");
if (p.proj.min < 16) why.push(`only ${Math.round(p.proj.min)} min projected`);
if (k.kind === 'line' && k.line > 0 && Math.abs(k.proj - k.line) / Math.max(k.line, 1) > 0.6) why.push('book line far from his usual numbers');
if (why.length) return { tier: 'unsure', why };
if (k.kind === 'line') {
const e = k.edge;
const w = [`We give it ${Math.round(k.prob * 100)}%, the book ${Math.round(k.market * 100)}%`];
if (e >= 0.12 && k.prob >= 0.62) return { tier: 'strong', why: w };
if (e >= 0.07) return { tier: 'solid', why: w };
return { tier: 'slight', why: w };
}
const w = [`Hits in ${Math.round(k.prob * 100)}% of our simulations`];
if (k.prob >= 0.88) return { tier: 'strong', why: w };
if (k.prob >= 0.8) return { tier: 'solid', why: w };
return { tier: 'slight', why: w };
}
const TIER_RANK = { strong: 0, solid: 1, slight: 2, unsure: 3 };

/** Plus edges only: every pick's projection sits ahead of its line. With a market line: model % vs no-vig market %. Without: the highest safe ladder rung. */
function picksForGame(proj, lines, opts = {}) {
const minP = opts.minP != null ? opts.minP : 0.6;
const picks = [];
if (proj.state.phase === 'final') return picks;
for (const p of proj.players) {
if (p.flags.includes('out')) continue;
let used = false;
for (const stat of ['pts', 'reb', 'ast', 'fg3m', 'pra']) {
const L = lines && lines[p.pid + ':' + stat];
if (L) {
const prob = calProb(p, stat, probOver(p._sims[stat], L.line));
const edge = prob - L.fairOver;
if (prob >= minP && edge >= 0.03 && p.proj[stat] > L.line) {
picks.push({ gameId: proj.state.id, game: `${proj.state.v} @ ${proj.state.h}`, pid: p.pid, name: p.name, team: p.team, stat, label: `${L.line} ${STAT_LABEL[stat]}`, line: L.line, kind: 'line', prob, market: L.fairOver, edge, ahead: p.proj[stat] - L.line, proj: p.proj[stat], now: p.now[stat] ?? (p.now.pts + p.now.reb + p.now.ast) });
used = true;
}
}
}
if (!used && (p.proj.min >= 20 || p.now.min >= 12)) {
// safest meaningful rung: highest threshold still >= 75%, above what he already has
for (const stat of ['pts', 'reb', 'ast', 'fg3m']) {
const nowV = p.now[stat];
const rungs = p.ladders[stat].filter((x) => x.p >= 0.75 && x.t > nowV);
if (!rungs.length) continue;
const best = rungs[rungs.length - 1];
const minRung = { pts: 10, reb: 4, ast: 4, fg3m: 2 }[stat];
if (best.t < minRung || !(p.proj[stat] > best.t - 0.5)) continue;
picks.push({ gameId: proj.state.id, game: `${proj.state.v} @ ${proj.state.h}`, pid: p.pid, name: p.name, team: p.team, stat, label: `${best.t}+ ${STAT_LABEL[stat]}`, line: best.t - 0.5, kind: 'rung', prob: best.p, market: null, edge: null, ahead: p.proj[stat] - (best.t - 0.5), proj: p.proj[stat], now: nowV });
}
}
}
for (const k of picks) {
const p = proj.players.find((x) => x.pid === k.pid);
const t = edgeTier(p, k, proj.state.phase);
k.tier = t.tier; k.tierWhy = t.why; k.blowProof = !!p.blowProof; k.chips = (p.chips || []).slice().sort((a, b) => (b.t === 'BLOWOUT-PROOF') - (a.t === 'BLOWOUT-PROOF')).slice(0, 4);
}
return picks.sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (b.edge ?? 0) - (a.edge ?? 0) || b.prob - a.prob);
}

/** 2-leg plus-edge tickets at a payout multiple (default 3x ≈ +200). */ function buildCombos(picks, opts = {}) { const payout = opts.payout || 3; const be = 1 / payout; const legs = picks.slice().sort((a, b) => b.prob - a.prob).slice(0, 40); const pairs = []; for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) { const a = legs[i], b = legs[j]; if (a.pid === b.pid) continue; const same = a.gameId === b.gameId; const joint = a.prob * b.prob * (same ? 0.97 : 1); if (joint < be) continue; pairs.push({ legs: [a, b], joint, ev: joint * payout - 1, sameGame: same }); } pairs.sort((x, y) => (x.sameGame - y.sameGame) || y.ev - x.ev); const max = opts.max || 6; const repeats = pairs.slice(0, max); const once = []; const used = new Set(); for (const c of pairs) { if (c.legs.some((l) => used.has(l.pid))) continue; once.push(c); c.legs.forEach((l) => used.add(l.pid)); if (once.length >= max) break; } return { once, repeats, breakEven: be, payout }; } return { LEAGUE, TUNE, LADDERS, STAT_LABEL, makeSampler, clockSec, elapsedSec, norm, gameState, isBlowout, clockLabel, onBetween, boxFromPlays, logEntry, slimStats, mergePrior, teamContext, slimTeams, gameLineConsensus, slimGameLogs, shotZone, profileOf, coachHabits, projectGame, probAtLeast, probOver, consensusLines, picksForGame, buildCombos, contextItems, edgeTier, TIER_RANK, PAT_STATS, PAT_F, PAT_GROUPS, patFeatures, patEmpty, patAdd, patGrade, patScore, patSolve, patApply, patGroup, patBeta, patMinOnly, rowByName, teamTableFrom, TEAM_PRIOR, liveUsage, PAT_LEARN, PAT_IX, PAT_PRIOR, patPack, patUnpack, playsFromEspn, fadeCheck, liveAlerts, calEmpty, calAdd, calTable, calTableFrom, calP, calProb, calLevel, CAL_STATS, SIT_CATS, scoringEvents, scorerRace, teamStar, sitAgg, sitCurve, sitPriorOf, sitPriorParse, sitProfile, sitFactor, }; });
