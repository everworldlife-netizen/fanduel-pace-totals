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
actDeep: 0, // posted active list: project deep-bench players too (they play on short-handed nights)
actNew: 0, actNewMpg: 12, // posted active list: project players back from a layoff from their season line (non-starters need this many minutes a game)
patCapMinUp: 0, // most the learned layer can raise remaining minutes (0 = same as patCapMin): a reserve who starts can more than double
patInterp: 0, // between two learning stages, blend their lessons by game minute (0 = nearest stage)
sitPre: 0, // situational scoring: a basket counts under the score before it (0 = the old filing, after it)
patYCap: 1, // learning target: 1 = the old one-sided cap on big finishes, 0 = the plain miss
repGroup: 0, // learn "before lineups are posted" as its own stage (1) or share the tip-off lessons (0)
patLamLineup: 1, // pull toward "no effect" for the lineup inputs, relative to the other inputs (1 = same; lower lets rare, strong signals through)
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
'startUp', 'startDown', 'fresh', 'deep', 'vacPos', 'lastMin', 'rest3', 'missShare'];
const PAT_D = PAT_F.length;
const PAT_IX = Object.fromEntries(PAT_F.map((k, i) => [k, i]));
// How hard each input is pulled toward "no effect" when the lessons are solved, relative to the others (1 = the usual pull).
// The lineup inputs are rare but strong (a reserve starts in about one game in two), so the usual pull would flatten them.
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
const PAT_PRIOR = {"pre":{"min":{"b":[0.019,-0.0352,-0.0121,0.0047,-0.0114,0.0002,0.0114,-0.0586,-0.0124,-0.0017,-0.0032,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0277,0,0,0,-0.0192,0,0,0,0],"d":[15700000,11900000,1330000,2790000,9310000,1080000,3600000,2090000,1820000,7840000,2540000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,6220000,0,0,0,13300000,0,0,0,0],"n":24939,"w":15660000},"pts":{"b":[0.024,0.0127,-0.0245,0.0103,-0.0103,0.0037,-0.0243,-0.0609,0.0017,0.0025,0.0141,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.0415,0,0,0,0.0199,0,0,0.0801,0],"d":[3680000,3040000,210000,647000,2120000,254000,728000,405000,436000,1850000,612000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2410000,0,0,0,3710000,0,0,625000,0],"n":24939,"w":3680000},"reb":{"b":[-0.0077,-0.0109,-0.0214,-0.0043,0.037,0.0054,-0.0132,-0.0235,-0.0075,-0.0027,0.0091,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.0057,0,0,0,0.0057,0,0,0.054,0],"d":[597000,430000,63000,105000,350000,41100,135000,66500,66800,299000,96800,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253000,0,0,0,497000,0,0,103000,0],"n":24921,"w":597200},"ast":{"b":[-0.0309,0.0112,-0.0198,-0.005,0.0419,0.0052,0.0253,0.0263,-0.0129,0.0139,0.0297,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0045,0,0,0,0.0164,0,0,0.06,0],"d":[255000,209000,15000,43900,146000,17500,52100,22500,30000,127000,42300,0,0,0,0,0,0,0,0,0,0,0,0,0,0,148000,0,0,0,260000,0,0,44300,0],"n":24548,"w":255300},"fg3m":{"b":[-0.0019,-0.0019,-0.0354,0.0051,0.0015,0.0026,-0.0111,-0.0981,0.027,0.0056,-0.0047,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.0382,0,0,0,0.0283,0,0,0.0914,0],"d":[46200,35200,3710,8190,27700,3180,10000,6360,5190,23300,7910,0,0,0,0,0,0,0,0,0,0,0,0,0,0,22200,0,0,0,39800,0,0,7910,0],"n":21440,"w":46150}},"s6":{"min":{"b":[0.0158,-0.0857,-0.0396,0,-0.004,-0.0145,0.0342,-0.0398,0.0019,0.0005,-0.0006,0.0102,0.0214,-0.0007,0.0004,-0.0604,0.0048,-0.0074,0.0013,0.0009,-0.0047,-0.003,0.037,0.0169,-0.1121,-0.0048,0.015,-0.0141,-0.0038,-0.0226,0,-0.0002,0,0],"d":[12300000,8970000,1300000,0,7320000,565000,2770000,1370000,1340000,6150000,2000000,11100000,222000,24100000,4590000,654000,1760000,4270000,6130000,120000,117000,113000,7660000,71600,2650000,4910000,4090000,19100000,4170000,10600000,0,45800,0,0],"n":28934,"w":12310000},"pts":{"b":[0.0156,0.0013,0.0124,0,-0.0006,-0.0019,-0.0455,-0.0204,0.0135,0.0013,0.0175,-0.0018,0.0161,-0.0029,0.0023,-0.0085,-0.0041,0.0045,-0.0225,-0.0038,0.0077,0.0041,-0.0302,0.0212,-0.0407,-0.0554,0.0257,0.0032,-0.0074,0.0478,0,0.0011,0.1039,-0.0213],"d":[2870000,2290000,183000,0,1650000,129000,565000,277000,321000,1440000,476000,3040000,51100,5650000,1060000,121000,632000,1120000,1780000,33700,26200,19000,2050000,16800,354000,1870000,1570000,4420000,1090000,2800000,0,11500,483000,741000],"n":28928,"w":2865000},"reb":{"b":[-0.021,-0.0099,0.0159,0,0.05,0.0122,-0.027,-0.0008,-0.0049,0,0.013,-0.0103,0.0032,0.0109,0.0025,-0.0339,-0.0123,-0.0078,-0.0308,0.0125,0.0021,-0.0094,-0.0513,0.0054,-0.0256,0.0063,0.0008,0.0048,0.0216,0.0257,0,-0.001,0.0785,0.0041],"d":[475000,322000,56700,0,280000,21100,107000,47100,49200,238000,76000,185000,9170,926000,174000,26800,74800,182000,230000,4460,3530,4810,322000,2900,79200,200000,168000,732000,177000,389000,0,1680,81900,125000],"n":28852,"w":474800},"ast":{"b":[-0.033,-0.0205,0.01,0,0.0429,0.0189,0.0026,0.0661,-0.0121,0.0178,0.0336,-0.0038,-0.0087,0.0092,0.0088,0.0268,-0.0146,0.0166,-0.01,0.0117,-0.009,0.0045,-0.0431,0.0081,-0.0455,0.0045,0.0035,0.005,0.002,0.0368,0,0.0096,0.0791,-0.0104],"d":[198000,157000,13100,0,113000,8690,40400,14900,22300,99000,32700,76000,3620,389000,72500,8300,34800,76300,115000,2150,1840,1380,141000,1090,26500,113000,95800,306000,74800,197000,0,698,34600,51900],"n":27972,"w":198200},"fg3m":{"b":[-0.0273,-0.0172,-0.0213,0,0.014,0.0203,-0.0176,-0.0629,0.0309,0.0163,0.0021,0.0334,0.0219,-0.0024,0.0068,-0.0606,0.0104,0.0005,-0.0278,0.0086,0.0176,-0.0063,-0.029,0.0075,0.0143,-0.0714,0.0437,0.0007,-0.0301,0.0538,0,0.0168,0.0886,-0.0178],"d":[36400,26700,3240,0,21900,1650,7850,4360,3880,18300,6260,6230,599,71800,13500,1930,6390,12100,22000,393,314,326,25100,177,6160,17400,14600,57100,11800,30700,0,151,6180,9530],"n":23676,"w":36410}},"s12":{"min":{"b":[-0.0175,-0.0511,-0.0101,0,-0.0018,-0.0249,0.031,-0.0204,-0.0008,-0.0036,-0.0026,0.0139,0.0135,-0.0005,-0.0087,0.0492,-0.0042,-0.0095,0.0073,0.0032,-0.0011,-0.0142,0.0388,0.1043,-0.2374,0.021,0.0068,0.0023,-0.0015,-0.0157,-0.0074,-0.0039,0,0],"d":[9170000,6760000,957000,0,5450000,566000,2030000,1250000,1010000,4580000,1490000,12000000,549000,13400000,6690000,302000,3530000,4790000,6900000,401000,389000,395000,4620000,1940000,330000,3640000,2440000,19500000,4570000,8060000,111000,148000,0,0],"n":29100,"w":9168000},"pts":{"b":[-0.0024,0.0139,-0.0069,0,0.0027,-0.0298,-0.0254,0.0002,0.0171,-0.0015,0.0136,0.0066,0.0115,-0.0039,0.0032,-0.022,-0.0137,-0.004,-0.0131,-0.0381,0.0208,0.0053,-0.0131,-0.0121,-0.0764,-0.0359,-0.0006,-0.0066,-0.0071,0.0328,-0.0067,0.0018,0.1005,-0.0233],"d":[2180000,1770000,143000,0,1250000,131000,419000,269000,245000,1100000,362000,3050000,138000,3240000,1560000,58100,1110000,1170000,1850000,121000,88000,61800,1100000,485000,25600,1430000,964000,4600000,1130000,2170000,19200,38900,367000,563000],"n":29054,"w":2181000},"reb":{"b":[-0.054,-0.02,-0.0066,0,0.0477,0.0123,-0.0118,0.0204,-0.0104,-0.0029,0.0116,0.0046,0.0057,0.0138,-0.0059,0.0084,-0.0024,0.0107,-0.0176,0.0205,0.0089,-0.0013,0.0043,0.0229,-0.0995,0,0.0017,-0.0039,0,0.0174,0.0057,-0.0014,0.0679,0.0034],"d":[356000,250000,41200,0,209000,20700,76700,43000,38100,178000,57000,208000,23800,521000,250000,11900,137000,197000,250000,15100,12500,14600,167000,93300,6540,153000,103000,740000,185000,299000,3980,5420,61600,93600],"n":28816,"w":355800},"ast":{"b":[-0.0726,-0.005,0.0034,0,0.0465,0.0115,0.0094,0.0806,-0.0099,0.0135,0.0343,0.0114,0.0149,0.0075,0.0172,0.0296,0.0004,0.0155,-0.0027,0.026,-0.0055,0.0073,-0.0191,-0.0295,-0.0827,-0.004,0.0106,-0.0113,-0.0137,0.0201,-0.0262,-0.0079,0.0558,-0.022],"d":[150000,121000,9920,0,85500,8450,30000,14600,17000,75100,24900,83700,9080,219000,104000,3900,69700,79000,125000,7220,5870,4460,76000,33200,1960,85900,59100,317000,76100,151000,1630,2200,26200,38200],"n":27066,"w":150500},"fg3m":{"b":[-0.0371,-0.0029,-0.0165,0,0.0268,0.003,-0.0106,-0.0662,0.0362,0.0037,-0.0084,0.0648,0.012,-0.0104,0.0024,-0.0592,-0.0089,-0.0406,-0.021,-0.0135,0.0258,-0.0027,-0.0199,-0.0135,-0.0797,-0.041,0.0083,-0.0145,0.0102,0.0376,-0.0342,0.004,0.0771,-0.0224],"d":[27600,20500,2510,0,16600,1690,5840,4270,2920,13900,4730,8670,1790,40600,20100,911,11700,14200,24400,1420,1010,1080,14500,5910,415,13200,8880,58800,13900,23800,329,499,4670,7210],"n":22353,"w":27560}},"s18":{"min":{"b":[-0.0448,-0.0466,-0.0219,0,0.0075,-0.0271,0.0318,-0.0106,0.0001,-0.0051,-0.0033,0.0202,-0.0013,-0.0027,-0.0159,0.0514,-0.008,-0.0141,0.0102,0.0042,-0.0015,-0.0074,0.0853,0.0626,-0.1652,0.0232,0.0091,-0.0048,0.0035,-0.005,-0.0088,-0.0122,0,0],"d":[6650000,5000000,635000,0,3950000,504000,1460000,889000,735000,3320000,1080000,9890000,108000,7280000,7070000,206000,3910000,3940000,6050000,585000,609000,600000,4010000,1070000,77400,2690000,1620000,16400000,3630000,5930000,90500,203000,0,0],"n":28196,"w":6652000},"pts":{"b":[-0.011,0.0259,-0.011,0,0.006,-0.0174,-0.0255,0.0045,0.0122,0.0033,0.0175,0.0058,0.0043,-0.0076,-0.0041,-0.0205,-0.0124,-0.0031,-0.0098,-0.0393,0.0268,0.0255,-0.0053,0.0094,-0.0553,-0.0331,0.0078,-0.0053,-0.0205,0.0371,-0.0023,0.0098,0.094,-0.0298],"d":[1560000,1290000,93300,0,896000,111000,297000,187000,177000,784000,260000,2370000,20900,1730000,1590000,38300,1070000,928000,1500000,173000,127000,88000,1020000,232000,5920,1060000,646000,3930000,863000,1620000,14300,49400,300000,387000],"n":28038,"w":1564000},"reb":{"b":[-0.0421,-0.0181,-0.0129,0,0.0407,-0.0066,-0.0188,0.0182,-0.0108,-0.002,0.0113,0.0043,-0.0106,0.0157,-0.0046,0.002,0.0034,0.0188,-0.0187,0.0152,0.0284,-0.0016,-0.0085,-0.0051,-0.0938,0.003,-0.0058,-0.0034,-0.0162,0.0161,0.0125,-0.014,0.0699,-0.0017],"d":[253000,182000,27300,0,148000,17500,54900,30400,27300,126000,40600,180000,4230,278000,253000,8510,154000,160000,215000,20400,18300,22600,160000,41800,1670,111000,68500,614000,144000,221000,3230,6680,50100,64000],"n":27562,"w":253000},"ast":{"b":[-0.0863,-0.006,-0.0042,0,0.0562,0.0366,0.0029,0.0892,-0.0087,0.015,0.0355,0.0125,0.0003,0.0101,-0.0023,0.0059,0.0069,0.0081,-0.001,0.0302,0.025,0.014,-0.0095,0.0202,-0.0561,-0.0096,0.035,-0.0092,-0.0019,0.0161,-0.0488,0.0087,0.0447,-0.0299],"d":[111000,90600,6470,0,62900,7330,21700,10400,12500,55100,18300,74200,1370,120000,109000,2620,71500,64200,105000,10800,9100,6140,72500,15900,412,65900,40400,278000,59600,116000,1250,2910,22100,27300],"n":25681,"w":110700},"fg3m":{"b":[-0.0425,0.0102,-0.0135,0,0.0398,0.0031,0.0029,-0.0575,0.0402,0.012,-0.0083,0.0838,0.0078,-0.0105,0.0064,-0.0413,-0.0067,-0.0278,-0.0303,-0.0112,0.0029,0.0164,-0.0093,0.0063,-0.0494,-0.0248,-0.0095,-0.0022,-0.0204,0.0528,-0.0078,0.0108,0.063,-0.0335],"d":[19400,14800,1590,0,11600,1430,4010,3010,2100,9760,3340,8090,276,21400,20200,584,12000,11300,20400,2000,1480,1540,12500,2980,80,9690,5920,49200,10900,17400,253,607,3790,4890],"n":20817,"w":19440}},"s24":{"min":{"b":[-0.0154,-0.0052,0.0065,0,0.011,-0.0363,0.0253,-0.0004,0.0023,-0.0031,-0.0031,0.0156,0.0174,-0.0014,-0.022,0.0578,-0.0124,-0.0026,0.0152,0.0066,-0.016,-0.0273,0.0052,-0.0006,0,0.0188,0.0166,0.0072,-0.0002,-0.0135,-0.0064,-0.0123,0,0],"d":[4410000,3190000,447000,0,2630000,419000,997000,581000,473000,2200000,718000,7020000,253000,4360000,6140000,163000,2930000,2890000,4340000,551000,564000,730000,2940000,1160000,0,1760000,940000,10400000,2470000,3800000,53100,186000,0,0],"n":25692,"w":4407000},"pts":{"b":[-0.0353,0.0232,-0.0239,0,0.011,-0.0066,-0.0365,0.0014,0.0139,0.0078,0.0056,0.0003,0.0005,-0.0045,-0.0006,-0.0191,-0.0087,-0.0222,-0.0275,-0.0402,0.0135,0.0357,-0.0003,0.0045,0,-0.058,-0.0034,-0.0145,0.0009,0.0585,0.0028,0.0131,0.0836,-0.0358],"d":[982000,790000,71600,0,561000,78100,191000,117000,110000,492000,164000,1640000,61200,986000,1220000,30100,687000,649000,1030000,152000,101000,91600,720000,185000,0,667000,380000,2300000,564000,1000000,7880,39200,201000,210000],"n":25655,"w":982500},"reb":{"b":[-0.0589,-0.0245,-0.0314,0,0.0518,0,-0.0227,0.0364,-0.0055,0.0043,0.0094,0.0087,-0.0118,0.0121,0.0063,0.0008,0.0037,-0.0012,-0.0269,0.0178,0.003,-0.0093,0.0041,0.0004,0,-0.0135,-0.0152,-0.003,-0.0006,0.034,-0.0001,-0.0181,0.0425,-0.0092],"d":[162000,112000,20600,0,94700,12800,35800,19100,17200,80500,26200,131000,11200,159000,201000,6960,112000,111000,151000,18100,14600,23600,105000,43800,0,71400,40100,366000,92200,141000,1850,5360,34200,34800],"n":25519,"w":161800},"ast":{"b":[-0.0972,-0.0148,-0.0241,0,0.0422,0.0236,-0.023,0.0782,-0.0214,0.0191,0.032,0.0248,-0.0151,0.0101,0.022,0.0285,0.0113,0.0023,-0.0139,0.0133,-0.0005,0.0286,-0.0012,-0.0297,0,-0.0275,0.0175,-0.0029,0.0073,0.0288,-0.0402,0.0167,0.0337,-0.0315],"d":[69800,55800,5000,0,39500,5120,14200,6480,7830,34800,11600,52600,4140,67900,83500,2070,48400,44900,73300,9440,7180,6100,50700,13100,0,41400,24100,164000,38500,71600,716,2500,14800,14800],"n":24227,"w":69810},"fg3m":{"b":[-0.0486,0.0116,-0.0341,0,0.0393,0.0321,-0.0006,-0.0458,0.0403,-0.0026,-0.0137,0.0848,0.0136,-0.0242,-0.0039,-0.0191,-0.0037,-0.0332,-0.0598,-0.0012,0.0132,0.0487,-0.0089,-0.0098,0,-0.0443,0.0079,-0.0125,-0.0182,0.0664,0.0073,0.0225,0.0437,-0.0098],"d":[12300,9080,1230,0,7340,1030,2620,1860,1310,6210,2130,6400,772,12400,15800,479,8140,7950,14200,1720,1190,1570,8440,3040,0,6150,3510,29300,7140,11000,140,471,2560,2700],"n":19496,"w":12330}},"s30":{"min":{"b":[-0.0578,0.0082,0.0234,0,0.0175,-0.0341,0.0182,0.0034,0.0148,-0.0081,-0.0012,0.0242,-0.0383,-0.0024,-0.0409,-0.0864,-0.0065,-0.0089,0.0104,-0.0099,-0.0313,-0.0103,0.0421,0.0169,0,0.0181,0.0206,-0.0122,0.0008,-0.0472,-0.0077,-0.0164,0,0],"d":[2480000,1590000,344000,0,1480000,295000,580000,436000,245000,1240000,402000,3950000,58100,2140000,4270000,152000,1540000,1710000,2500000,357000,388000,759000,1510000,1450000,0,940000,461000,6360000,1340000,2100000,27700,138000,0,0],"n":25689,"w":2478000},"pts":{"b":[-0.0224,0.0432,-0.024,0,0.0127,0.0002,-0.0181,0.0126,0.0162,0.0073,0.0036,-0.0016,-0.0411,-0.0041,0.017,-0.0063,-0.0168,-0.0024,-0.0052,-0.0597,-0.0124,0.0526,-0.0187,-0.0206,0,-0.0478,0.0132,0.0048,-0.0151,0.0832,0.0054,0.0153,0.0846,-0.0558],"d":[492000,349000,61100,0,280000,43900,99800,78100,51200,246000,81200,796000,9150,428000,711000,22900,300000,337000,518000,78800,53600,96200,325000,248000,0,300000,168000,1290000,264000,492000,3610,22600,131000,92100],"n":25632,"w":491800},"reb":{"b":[-0.0389,-0.0076,-0.0489,0,0.0476,0.016,-0.0204,0.0152,-0.0106,-0.0071,0.0065,0.0157,-0.0207,0.0142,-0.0091,0.0272,0.0045,0.0047,-0.0225,0.0138,0.0008,0.0126,0.0152,-0.0089,0,-0.0063,-0.0242,0.0076,-0.0044,0.0519,-0.0212,-0.0188,0.0316,-0.0156],"d":[86200,49200,17900,0,50500,7950,19600,13500,7940,43100,13900,71000,1740,73500,128000,5410,54200,60500,80500,9330,7740,24300,51200,60200,0,35300,18700,223000,46900,77800,918,3090,23700,16400],"n":25441,"w":86240},"ast":{"b":[-0.1017,-0.0211,-0.047,0,0.0467,0.0303,-0.0154,0.0679,-0.0263,0.0239,0.0386,0.0301,-0.0322,0.0156,0.0434,0.0226,-0.0061,0.0066,0.0051,0.0153,-0.009,0.0291,-0.0226,-0.0329,0,-0.0237,0.0211,0.0064,0.0052,0.0317,-0.0439,0.0218,0.0106,-0.0642],"d":[35700,25000,4370,0,20000,2900,7560,4540,3700,17700,5880,28000,591,30200,48800,1620,21700,24100,37700,4850,3800,6570,23500,18700,0,18900,10900,93200,19000,35100,358,1480,9850,6650],"n":23581,"w":35650},"fg3m":{"b":[-0.0507,0.0318,-0.0377,0,0.0292,0.0116,0.0196,-0.0102,0.0236,-0.0138,-0.0246,0.0831,-0.0455,-0.0229,0.0216,-0.0674,0.002,-0.0163,-0.0445,-0.0205,-0.047,0.0549,-0.0022,-0.0186,0,-0.0197,0.0044,0.0153,-0.0406,0.0698,0.0361,0.0399,0.0294,-0.0231],"d":[6510,4060,1050,0,3860,620,1430,1250,610,3270,1110,3530,109,5720,9860,376,3800,4350,7490,916,626,1670,4020,4360,0,2840,1540,17700,3590,5730,68.9,269,1750,1250],"n":17659,"w":6512}},"s36":{"min":{"b":[-0.0377,0.0478,0.0185,0,0.0197,-0.0545,0.0276,0.0029,0.0199,-0.0081,0.0012,0.0264,-0.0057,-0.0034,-0.0583,-0.037,-0.0103,-0.0022,0.0151,-0.045,-0.0497,0.0092,0.0049,0.032,0,0.0131,0.036,0.0079,-0.0129,-0.0168,-0.0147,-0.0242,0,0],"d":[1150000,760000,163000,0,688000,196000,269000,251000,116000,577000,187000,1900000,56200,908000,2340000,67300,745000,851000,1210000,178000,220000,513000,686000,348000,0,425000,201000,3000000,666000,1020000,11200,74400,0,0],"n":25786,"w":1155000},"pts":{"b":[-0.035,0.0364,-0.0129,0,0.0186,-0.0282,-0.0271,-0.0265,0.0109,0.0066,0.0111,0.0018,-0.0475,-0.0001,0.0244,-0.0251,-0.0162,-0.0135,-0.0224,-0.0665,0.0014,0.0595,-0.0083,-0.0256,0,-0.0567,-0.0094,-0.0063,0.0138,0.0649,-0.006,0.0152,0.079,-0.0536],"d":[217000,168000,21300,0,122000,21500,43200,38300,24500,109000,35100,367000,11400,170000,323000,9130,129000,160000,237000,30300,25300,52700,124000,65900,0,135000,79700,556000,126000,224000,1360,9410,81700,35300],"n":25460,"w":217400},"reb":{"b":[-0.0293,-0.0303,-0.0338,0,0.0461,-0.0067,-0.0256,-0.015,-0.0146,-0.0064,-0.0032,0.0047,-0.0101,0.0107,-0.0121,0.0412,0.0147,0.0043,-0.0348,0.026,0.0263,0.0104,0.0055,-0.0143,0,-0.0193,-0.0191,-0.0012,0.0111,0.0497,-0.0126,-0.0255,0.0136,-0.0137],"d":[38500,25700,5860,0,22200,4380,8500,6960,4070,19200,6070,34400,2340,29500,61300,2080,26200,29400,38900,4060,4030,13200,20500,14900,0,16300,8950,95400,22400,35000,345,1420,14900,6460],"n":24475,"w":38530},"ast":{"b":[-0.11,-0.0377,-0.0288,0,0.0514,-0.0075,-0.0178,0.0466,-0.009,0.0134,0.0295,0.0281,-0.0424,-0.0027,0.0553,0.0181,0.004,0.0182,0.0007,0.0238,0.0018,0.0273,-0.005,-0.0321,0,-0.0287,0.0183,0.0095,-0.0196,0.0247,-0.0337,0.0114,-0.018,-0.0633],"d":[16300,12600,1480,0,9050,1430,3400,2170,1850,8140,2640,13900,831,12700,22700,648,9800,11700,17900,1840,1850,3670,9270,4820,0,8740,5250,41700,9240,16500,131,610,6390,2640],"n":19972,"w":16320},"fg3m":{"b":[-0.0813,0.0162,-0.0181,0,0.015,-0.0051,-0.0077,-0.0195,0.0241,-0.0199,-0.0082,0.0836,-0.0591,-0.0167,0.0302,-0.056,-0.0315,-0.0431,-0.0421,0.0055,-0.0385,0.0534,0.0142,-0.0514,0,-0.0148,-0.016,0.0193,-0.0089,0.0881,0.0041,0.0177,0.008,-0.0096],"d":[2600,1860,319,0,1510,281,550,576,276,1300,438,1660,124,2030,3970,136,1510,1860,3200,289,231,840,1550,807,0,1180,712,6850,1490,2400,23,95.6,984,424],"n":11792,"w":2597}},"s42":{"min":{"b":[-0.1855,0.0821,0.0614,0,0.0265,-0.0183,0.0216,0.003,0.0024,-0.0232,0.0169,0.025,-0.0513,0.004,-0.1116,-0.072,0.0173,-0.0008,-0.0023,-0.0922,-0.0971,0.1205,0.3395,-0.1183,0,-0.0064,0.0813,0.0017,0.0084,-0.03,-0.0072,-0.0148,0,0],"d":[320000,225000,43300,0,189000,61500,70200,67700,33200,160000,51400,530000,5620,224000,681000,18900,195000,248000,340000,52600,70800,153000,221000,71500,0,125000,57700,839000,187000,320000,2430,22400,0,0],"n":25802,"w":320100},"pts":{"b":[-0.1062,0.0799,0.1139,0,0.0262,0.0399,-0.034,0.0305,0.0226,0.0293,0.0287,0.0308,-0.0273,0.0139,-0.0214,-0.011,-0.0155,0.0137,-0.0269,-0.1052,-0.0252,0.0973,0.0183,-0.0495,0,-0.0208,0.1323,-0.034,-0.0051,0.0956,-0.0165,-0.0049,0.0482,-0.0673],"d":[64400,49500,6780,0,36200,7840,12600,11400,6850,32300,10500,106000,871,45000,103000,2970,35000,48700,67800,6540,6220,24900,55900,3990,0,39200,22900,167000,38200,72000,322,2040,25500,9780],"n":22390,"w":64360},"reb":{"b":[-0.0688,0.0438,0.0392,0,0.0412,0.0735,0.0141,0.0215,-0.0323,-0.0066,0.0318,0.0157,-0.0262,0.0163,-0.0496,-0.0035,0.005,0.0231,-0.0067,-0.0007,-0.0331,0.0819,0.0507,-0.0209,0,-0.004,0.0212,-0.0003,-0.0018,0.0604,0.003,-0.0025,-0.0342,0.0024],"d":[11800,7870,1820,0,6870,1650,2560,2170,1210,5860,1870,10900,214,8100,20700,695,7760,9270,11400,858,992,5990,10200,750,0,4850,2640,29600,6900,11600,88.7,315,4830,1860],"n":17506,"w":11750},"ast":{"b":[-0.1294,-0.0115,0.018,0,0.0641,0.0163,-0.0129,0.0684,-0.0019,0.0218,0.051,0.037,-0.0471,0,0.0066,-0.0199,0.0223,0.0227,0.0121,-0.0042,-0.0106,0.0708,-0.0268,-0.0113,0,0.0156,0.0979,0.0069,0.0109,0.0154,-0.0191,-0.0265,-0.0677,-0.0588],"d":[4800,3760,425,0,2670,471,971,647,528,2430,773,4220,63.9,3340,6860,195,2680,3550,5190,370,413,1530,4270,191,0,2650,1560,12500,2820,5310,32,129,2000,711],"n":11851,"w":4805},"fg3m":{"b":[-0.0777,0.0133,0.0224,0,-0.0077,0.041,0.0394,0.0541,0.0186,-0.0051,0.0137,0.1026,-0.0037,0.0116,-0.0275,0.0339,-0.0038,0.0017,-0.0493,-0.0087,-0.0385,0.0559,0.0059,-0.0262,0,0.0491,0.0945,0.056,0.0004,0.0795,-0.002,0.0135,0.0149,-0.0263],"d":[570,419,70.9,0,341,73.2,112,138,56.4,280,98,374,6.86,403,927,31.5,288,415,689,33.9,25.8,298,541,7.35,0,284,169,1540,347,617,3.33,9.53,226,87.5],"n":4276,"w":570}}};
// How often the simulated chances really came in over those games: [count, sum of chances, sum of hits] per 10% bin.
const CAL_PRIOR = {"pre":{"pts":[[[77766,716.27,1186],[6171,871.95,1137],[3624,894.85,1153],[3576,1239.72,1440],[1875,832.52,968],[2013,1105.96,1221],[2395,1557.58,1651],[1542,1127.96,1146],[29,23.56,24],[0,0,0]],[[54159,1460.26,574],[14173,2033.01,1312],[9798,2386.72,2065],[6803,2354.82,2338],[6972,3113.15,3482],[5918,3233.39,3647],[5033,3250.05,3690],[5975,4488.76,4993],[7766,6591.53,6913],[8863,8402.7,8578]]],"reb":[[[40018,471.5,751],[3314,481.68,670],[2753,658.7,839],[1127,394.31,540],[1675,755.61,975],[2094,1147.18,1316],[451,277.76,308],[0,0,0],[0,0,0],[0,0,0]],[[65457,1683.77,995],[17368,2480.21,1899],[11009,2712.49,2430],[9839,3400.97,3475],[7649,3409.13,3605],[6386,3494.2,3847],[7518,4879.26,5393],[8040,6008.99,6541],[7991,6769.83,7233],[6823,6445.02,6576]]],"ast":[[[70053,962.69,936],[7320,1055.64,1187],[4878,1170.51,1322],[2876,997.86,1197],[2850,1274.85,1477],[2576,1404.11,1565],[503,310.33,342],[0,0,0],[0,0,0],[0,0,0]],[[19987,679.94,402],[8148,1155.25,829],[5062,1256.83,1104],[4797,1657.61,1616],[3585,1596.62,1615],[2765,1513.34,1622],[3914,2546.93,2789],[4021,3003.44,3303],[3574,3019.56,3224],[2725,2563.03,2635]]],"fg3m":[[[63948,871.07,1604],[7030,975.79,1324],[5017,1244.01,1532],[2958,1004.11,1197],[2530,1137.4,1336],[3189,1750.98,1924],[1818,1144,1177],[12,8.45,7],[0,0,0],[0,0,0]],[[20018,882.71,708],[10370,1512.23,1398],[6164,1495.76,1427],[5643,1972.09,2066],[4650,2063.48,2140],[3138,1706.63,1754],[3783,2480.35,2601],[5029,3748.28,3843],[3574,3010.81,3069],[763,702.35,698]]]},"s6":{"pts":[[[122570,1009.6,1776],[8519,1211.53,1608],[5284,1294.11,1600],[4403,1521.92,1720],[2860,1275.62,1452],[2653,1452.57,1583],[2499,1620.23,1652],[1633,1204.09,1161],[861,731.43,755],[578,539.27,544]],[[46162,1208.23,541],[11456,1645.47,1147],[7578,1852.53,1646],[5529,1911.28,1948],[5411,2418.22,2644],[4586,2505.77,2787],[4223,2733.17,3029],[4828,3623.26,3902],[5782,4907.86,5049],[9727,9325.48,9400]]],"reb":[[[76614,822.76,1336],[6260,902.56,1183],[4341,1045.4,1290],[2700,944.12,1085],[2640,1178.52,1361],[2752,1501.16,1639],[633,393.29,446],[365,276.48,318],[292,240.83,257],[0,0,0]],[[60552,1470.16,933],[14678,2086.1,1804],[9331,2304.11,2249],[8150,2808.09,2860],[6360,2839.48,3072],[5171,2827.51,3099],[6605,4289.73,4556],[6416,4786.74,5072],[6163,5225.81,5436],[7089,6724.69,6804]]],"ast":[[[97707,1244.23,1190],[9724,1386.42,1506],[5827,1411.5,1604],[3793,1317.58,1396],[2857,1273.67,1460],[2352,1283.59,1439],[932,595.37,647],[766,574.96,620],[338,278.29,282],[1,0.91,1]],[[16177,558.41,333],[6322,900.16,671],[4111,1017.79,952],[3526,1215.19,1164],[2858,1275.5,1355],[2309,1259.54,1373],[3015,1961.31,2120],[2774,2064.71,2213],[2922,2484.16,2623],[2977,2813.61,2897]]],"fg3m":[[[91377,1207.22,1986],[9721,1353.67,1663],[6962,1721.74,1951],[4196,1427.06,1551],[3520,1580.06,1641],[3952,2166.88,2250],[2267,1426.83,1457],[13,9.14,9],[0,0,0],[0,0,0]],[[15768,675.9,559],[7778,1140.7,1059],[4349,1049.5,989],[4403,1545.09,1594],[3523,1561.39,1563],[1984,1076.69,1081],[2975,1958.98,2013],[4135,3082.55,3086],[2182,1829.74,1855],[240,220.61,211]]]},"s12":{"pts":[[[138074,1098.66,1634],[8896,1259.85,1497],[5463,1336.14,1508],[4109,1419.27,1521],[3093,1378.72,1516],[2759,1508.97,1639],[2586,1672.62,1771],[2332,1737.91,1788],[2285,1937.06,1958],[1410,1317.14,1298]],[[36238,946.67,382],[8912,1274.61,909],[5845,1432.35,1332],[4495,1556.34,1523],[4004,1788.3,1970],[3596,1966.95,2167],[3439,2225.42,2505],[3674,2755.35,2946],[4250,3605.81,3767],[8349,8006.54,8075]]],"reb":[[[92767,929.32,1248],[7558,1075.45,1268],[4634,1121.02,1299],[2977,1037.05,1213],[2395,1066.19,1251],[2329,1275.1,1483],[1149,735.63,855],[1502,1130.75,1238],[737,606.09,656],[0,0,0]],[[48897,1218.62,683],[12078,1720.77,1340],[7911,1948.24,1755],[6315,2173.45,2221],[5512,2466.78,2568],[4501,2458.92,2641],[5209,3377.07,3671],[4751,3544.22,3798],[5648,4810.34,5034],[6131,5793.55,5869]]],"ast":[[[105336,1284,1101],[9519,1345.34,1373],[5704,1385.37,1493],[3845,1333.33,1468],[2581,1149.35,1329],[2351,1287.49,1477],[1445,928.4,1020],[1406,1051.6,1144],[594,488.82,525],[0,0,0]],[[12277,439.53,246],[4924,703.21,515],[3339,821.81,709],[2674,920.9,896],[2339,1047.44,1083],[1882,1026.49,1149],[2422,1570.87,1690],[1885,1405.02,1508],[2561,2184.07,2323],[2335,2194.95,2251]]],"fg3m":[[[100419,1275.92,1999],[10457,1458.55,1731],[7410,1824.38,2057],[4288,1459.48,1623],[3440,1540.87,1652],[4055,2223.54,2355],[2312,1455.13,1494],[18,12.8,10],[0,0,0],[0,0,0]],[[11116,482.07,366],[5604,825.47,731],[2964,710.65,662],[3410,1201.23,1201],[2512,1112.32,1110],[1268,687.77,658],[2208,1462.47,1496],[3263,2427.02,2451],[1227,1021.12,1011],[77,70.34,70]]]},"s18":{"pts":[[[146686,1145.08,1676],[9245,1311.57,1498],[5696,1392.41,1606],[4246,1464.94,1616],[3479,1553.25,1683],[3123,1703.63,1827],[2970,1920.14,2001],[2730,2038.76,2067],[2761,2338.92,2332],[1903,1780.11,1754]],[[24447,646.94,261],[6129,873.44,625],[4041,989.96,899],[3143,1086.43,1076],[2696,1202.45,1273],[2463,1345.94,1459],[2478,1603.72,1723],[2555,1910.38,2031],[2911,2472.21,2572],[6077,5830.1,5861]]],"reb":[[[103978,1070.05,1215],[8506,1205.27,1339],[5110,1243.04,1424],[3738,1299.54,1500],[2762,1223.81,1395],[2832,1552.55,1776],[1775,1140.49,1266],[2228,1672.6,1833],[1017,837.71,869],[1,0.9,1]],[[35530,900.15,468],[8801,1260.19,966],[5706,1405.01,1331],[4554,1566.35,1532],[4002,1789.14,1910],[3335,1819.99,1910],[3842,2487.83,2692],[3267,2435.26,2574],[4297,3664.62,3824],[4167,3924.8,3987]]],"ast":[[[107595,1288.47,1066],[9806,1387.92,1397],[5538,1344.03,1411],[3798,1313.05,1512],[2808,1246.52,1408],[2573,1410.01,1597],[1583,1017.75,1129],[1544,1154.36,1250],[624,514.17,547],[0,0,0]],[[7812,292.31,124],[3409,490.78,370],[2255,556.14,496],[1783,613.95,606],[1704,764.09,803],[1281,696.74,750],[1553,1007.17,1067],[1373,1020.94,1079],[1832,1565.42,1653],[1543,1447.35,1484]]],"fg3m":[[[103611,1315.09,2010],[10784,1519.6,1787],[7347,1810.58,2058],[4444,1518.08,1700],[3818,1709.3,1813],[4048,2216.84,2267],[2051,1292.28,1330],[7,4.95,5],[0,0,0],[0,0,0]],[[6584,286.5,210],[3492,519.2,450],[1749,416.59,348],[2255,794.86,787],[1642,725.13,702],[656,352.83,318],[1522,1013.04,1030],[2166,1606.43,1597],[633,525.06,507],[24,21.89,21]]]},"s24":{"pts":[[[143069,1163.46,1612],[9816,1398.03,1595],[6147,1503.29,1720],[4640,1602.49,1673],[3904,1743.64,1881],[3520,1921.08,2014],[3312,2143.66,2206],[3128,2339.59,2327],[3146,2663.93,2619],[2285,2137.16,2061]],[[11300,310.47,164],[2976,425.74,322],[1939,473.11,428],[1527,531.21,506],[1355,605.4,642],[1126,616.34,643],[1173,759.42,800],[1294,966.56,1039],[1417,1202.21,1239],[2907,2787.19,2788]]],"reb":[[[105189,1157.03,1193],[9425,1336.09,1462],[5755,1402.77,1629],[4423,1534.98,1766],[3261,1452.33,1658],[3324,1821.37,2054],[2375,1531.37,1692],[2570,1925.38,2082],[1102,907.36,930],[2,1.81,2]],[[20306,537.05,267],[5295,759.26,559],[3449,851.41,768],[2665,914.01,896],[2531,1133.69,1192],[1891,1031.77,1079],[2390,1550.84,1625],[1798,1338.12,1391],[2779,2376.62,2473],[2030,1900.8,1913]]],"ast":[[[101209,1274.6,1008],[9833,1387.81,1434],[5565,1354.43,1470],[4015,1387.99,1553],[2980,1327.1,1499],[2578,1411.07,1580],[1778,1145.59,1286],[1492,1116.44,1217],[610,502.81,536],[0,0,0]],[[3190,131.26,53],[1651,238.81,158],[1142,283.21,247],[862,294.65,279],[859,386.51,404],[670,363.7,371],[826,535.61,594],[598,444.43,465],[999,855.81,897],[621,577.62,597]]],"fg3m":[[[97699,1273.39,1919],[10736,1517.2,1786],[7387,1815.91,2123],[4858,1672.66,1773],[4338,1941.42,2089],[3669,1998.15,2002],[1604,1009.32,973],[10,7.05,6],[0,0,0],[0,0,0]],[[2215,98.63,65],[1366,207.57,149],[522,121.97,88],[1054,374.16,345],[607,265.7,230],[138,73.87,69],[758,506.31,508],[900,663.34,629],[136,112.82,105],[4,3.63,3]]]},"s30":{"pts":[[[158545,1195.71,1874],[9997,1422.86,1707],[6160,1503.93,1619],[4732,1637.92,1766],[4070,1817.12,1887],[3469,1898.98,1896],[3431,2220.37,2166],[3134,2340.9,2300],[2914,2467.55,2359],[1609,1501.96,1449]],[[1809,60.41,40],[653,93.76,73],[416,102.1,105],[317,109.18,106],[301,135.21,130],[265,145.64,159],[236,152.84,155],[274,205.43,210],[318,270.1,271],[554,529.7,534]]],"reb":[[[124718,1342.83,1482],[10909,1550.08,1803],[6536,1594.1,1856],[4874,1686.97,1939],[3801,1693.02,1890],[3798,2076.12,2315],[2867,1848.96,1983],[2388,1782.97,1841],[800,658.91,682],[0,0,0]],[[6666,192.38,88],[1983,287.28,196],[1261,312.34,255],[932,317.57,268],[1056,474.3,476],[618,335.4,305],[942,610.83,607],[645,478.97,469],[1147,982.03,1007],[506,468.32,453]]],"ast":[[[108390,1285.83,1028],[9715,1367.66,1457],[5326,1300.04,1472],[4150,1432.12,1589],[2912,1295.77,1432],[2165,1179.27,1340],[1478,953.38,1026],[1109,827.68,881],[277,227.7,239],[0,0,0]],[[435,18.97,5],[280,41.09,22],[207,51.97,37],[135,44.79,26],[212,95.47,97],[91,49.12,44],[205,133.09,132],[70,52.01,53],[252,216.68,224],[61,56.07,55]]],"fg3m":[[[104116,1223.09,1854],[10160,1438.52,1742],[6937,1702.82,1844],[5622,1938.75,2012],[3888,1728.29,1744],[2160,1168.39,1126],[567,356.53,308],[1,0.7,1],[0,0,0],[0,0,0]],[[260,12.26,5],[209,31.94,19],[45,10.09,9],[194,68.31,48],[69,29.5,24],[3,1.74,1],[159,105.94,109],[120,87.34,73],[5,4.17,3],[0,0,0]]]},"s36":{"pts":[[[168185,973.38,1813],[8103,1152.82,1429],[5007,1224.56,1357],[3909,1351.27,1396],[3193,1426.36,1415],[2821,1541.47,1456],[2488,1606.54,1511],[2147,1597.48,1461],[1442,1215.88,1139],[631,587,572]],[[28,0.98,1],[10,1.36,0],[14,3.32,2],[5,1.77,0],[11,4.83,1],[10,5.58,5],[5,3.22,2],[3,2.27,0],[12,10.08,8],[15,14.11,14]]],"reb":[[[138784,1300.95,1643],[10012,1422.29,1643],[6045,1478.52,1746],[4498,1553.86,1716],[3385,1507.9,1619],[2803,1529.4,1599],[1923,1239,1281],[1157,857.36,859],[277,228.72,210],[0,0,0]],[[804,27.99,7],[356,51.72,38],[237,59.17,45],[167,56.49,54],[209,93.9,89],[112,60.2,49],[195,127.18,124],[104,76.97,68],[244,209.17,205],[77,70.7,74]]],"ast":[[[115014,1138.47,1057],[8001,1131.66,1256],[4567,1113.17,1257],[2989,1028.96,1199],[1874,830.94,903],[1351,734.83,788],[754,484.75,520],[342,252.32,267],[58,47.52,41],[0,0,0]],[[8,0.39,0],[3,0.38,0],[7,1.91,1],[2,0.61,0],[6,2.75,2],[1,0.56,0],[9,5.83,4],[3,2.15,1],[6,5.17,4],[2,1.8,2]]],"fg3m":[[[110888,1029.21,1764],[9257,1324.11,1548],[5954,1454.1,1558],[3699,1267.91,1263],[1588,695.98,624],[480,256.98,235],[61,38.23,28],[0,0,0],[0,0,0],[0,0,0]],[[5,0.24,0],[8,1.13,0],[0,0,0],[9,3.14,1],[0,0,0],[0,0,0],[8,5.38,4],[2,1.48,0],[0,0,0],[0,0,0]]]},"s42":{"pts":[[[179205,704.71,1288],[5865,833.52,898],[3551,869.2,873],[2394,825.52,769],[1806,804.31,767],[1477,805.02,758],[1156,745.34,699],[753,559.01,523],[433,364.33,347],[131,121.47,121]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"reb":[[[151241,1063.14,1251],[7615,1071.14,1170],[4002,973.89,1065],[2726,940.7,1041],[1835,814.74,903],[1228,667.1,708],[627,403.24,420],[298,220.68,225],[49,40.46,42],[0,0,0]],[[28,0.61,0],[6,0.82,0],[7,1.73,2],[3,1.04,1],[6,2.64,1],[0,0,0],[7,4.54,1],[4,2.84,3],[7,5.91,4],[2,1.9,2]]],"ast":[[[124418,888.39,879],[5374,752.15,841],[2515,608.89,726],[1343,459.68,508],[689,303.21,328],[326,175.66,201],[88,55.92,63],[11,7.9,7],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"fg3m":[[[120978,853.93,1280],[6670,944.28,1035],[3039,726.92,754],[935,313.91,300],[181,78.21,72],[16,8.55,8],[1,0.62,0],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]]}};
/**
* Coefficients from the built-in lessons plus whatever this phone has graded since (dev = patEmpty()
* sums). With nothing new graded this is exactly the built-in set.
*/
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
const out = { v: 2, acc: sum.acc || null, cal: sum.cal || null, g: {} };
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
const startKnown = st.phase === 'live' ? el > 0.5 : startT.size >= 8;
if (st.phase === 'live') { startT.clear(); for (const r of Object.values(now.players)) if ((r.team === v || r.team === h) && r.stints && r.stints[0] && r.stints[0][0] < 0.05) startT.add(+r.pid); }
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
const drift = (marginMkt != null && TUNE.mktSpreadW > 0
? (1 - TUNE.mktSpreadW) * TUNE.drift * marginModel + TUNE.mktSpreadW * marginMkt
: TUNE.drift * marginModel) * (toQ3 / 48);
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
usgS: p.usgBase, lu, mg: (p.tm === v ? 1 : -1) * (st.vs - st.hs), on: !!r.on, dnp: !!r.dnpYet, sitting: !r.on && lastS0 ? el - lastS0[1] : 0, el, fade: p.sit ? p.sit.fade : null, d1, tdMkt: tdF[p.tm].mkt, tdLive: tdF[p.tm].live });
const Fm = patB.min && !(r.ejected || r.pf >= 6) ? patApply(patB.min, patX.min, TUNE.patCapMin, 0, TUNE.patCapMinUp > 0 ? TUNE.patCapMinUp : null) : { f: 1, z: 0, parts: null };
p.lu = lu; p.pat = { g: patG, x: patX, F: { min: Fm } };
p.minPlain = mean(p.mins);
if (Fm.f !== 1) for (let i = 0; i < N; i++) p.mins[i] = Math.min(left, p.mins[i] * Fm.f);
}
// a team can't play more than 5 x the time left (it can play fewer of the players we track: deep bench in garbage time)
if (patOn && patB.min) for (const tm of [v, h]) {
const ps = players.filter((p) => p.tm === tm);
const amNow = Math.abs(st.vs - st.hs);
const close = st.phase === 'live' ? 1 - clamp(Math.max(pBlow, (amNow - 8) / 15), 0, 1) : 1;
const give = TUNE.refill * close;
for (let i = 0; i < N; i++) {
let tot = 0; for (const p of ps) tot += p.mins[i];
if (tot > 5 * left && tot > 0) { const k = (5 * left) / tot; for (const p of ps) p.mins[i] *= k; }
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
let vWin = 0;
for (let i = 0; i < N; i++) if (st.vs + teamPts[v][i] > st.hs + teamPts[h][i]) vWin++;
const projScore = { [v]: st.vs + mean(Array.from(teamPts[v])), [h]: st.hs + mean(Array.from(teamPts[h])) };
return {
state: st, patG, players: results, projScore, winProb: { [v]: vWin / N, [h]: 1 - vWin / N },
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

/** 2-leg plus-edge tickets at a payout multiple (default 3x ≈ +200). */ function buildCombos(picks, opts = {}) { const payout = opts.payout || 3; const be = 1 / payout; const legs = picks.slice().sort((a, b) => b.prob - a.prob).slice(0, 40); const pairs = []; for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) { const a = legs[i], b = legs[j]; if (a.pid === b.pid) continue; const same = a.gameId === b.gameId; const joint = a.prob * b.prob * (same ? 0.97 : 1); if (joint < be) continue; pairs.push({ legs: [a, b], joint, ev: joint * payout - 1, sameGame: same }); } pairs.sort((x, y) => (x.sameGame - y.sameGame) || y.ev - x.ev); const max = opts.max || 6; const repeats = pairs.slice(0, max); const once = []; const used = new Set(); for (const c of pairs) { if (c.legs.some((l) => used.has(l.pid))) continue; once.push(c); c.legs.forEach((l) => used.add(l.pid)); if (once.length >= max) break; } return { once, repeats, breakEven: be, payout }; } return { LEAGUE, TUNE, LADDERS, STAT_LABEL, makeSampler, clockSec, elapsedSec, norm, gameState, isBlowout, clockLabel, onBetween, boxFromPlays, logEntry, slimStats, mergePrior, teamContext, slimTeams, gameLineConsensus, slimGameLogs, shotZone, profileOf, coachHabits, projectGame, probAtLeast, probOver, consensusLines, picksForGame, buildCombos, contextItems, edgeTier, TIER_RANK, PAT_STATS, PAT_F, PAT_GROUPS, patFeatures, patEmpty, patAdd, patGrade, patScore, patSolve, patApply, patGroup, patBeta, patMinOnly, rowByName, liveUsage, PAT_LEARN, PAT_IX, PAT_PRIOR, patPack, patUnpack, playsFromEspn, fadeCheck, liveAlerts, calEmpty, calAdd, calTable, calTableFrom, calP, calProb, calLevel, CAL_STATS, SIT_CATS, scoringEvents, scorerRace, teamStar, sitAgg, sitCurve, sitPriorOf, sitPriorParse, sitProfile, sitFactor, }; });
