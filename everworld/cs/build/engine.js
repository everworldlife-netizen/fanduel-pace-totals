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
rotKEarly: 8, rotKLate: 0.25, rotKFrom: 39, rotKTo: 42, // rotK by game minute: rotKEarly until rotKFrom, sliding to rotKLate by rotKTo (rotKEarly 0 = the single rotK above all game)
rotTonightEarly: 0.1, // rotTonight for the first 18 minutes (0 = same as the rest of the game)
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
// team load (also v15, lab name "v16"): how crowded tonight's rotation is, and which side is expected to win big, as learned inputs
loadIn: 1, loadMid: 0.06, // team load = the usual minutes of everyone available tonight, added up, vs the 240 a team can play; loadMid = a typical night
favIn: 1, // expected winning margin by role (starters of a team expected to win or lose big, bench of a team expected to lose big)
loadStats: 0, // 0 = the team load only teaches minutes (who plays), 1 = it also teaches points, rebounds, assists and threes
ctxUntil: 33, // game minute from which the team load and expected margin sit out (by then the live score and rotation say more)
refillSoft: 1, // refill eligibility: 0 = fixed cut-off, 1 = smooth ramp (no jumps when a factor sits at the cut-off)
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
// tonight's crowd (v15, lab name "v16"): how over- or under-booked the team's minutes are (full bench vs short-handed), by role; and the expected margin by role
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
const PAT_PRIOR = {"pre":{"min":{"b":[0.09527,-0.07121,-0.00241,0.00811,-0.02171,0.01727,0.00001,0.0046,-0.00347,0.00289,0.00208,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.02677,0,0,0,-0.03505,0,0,0,0,0.35644,-0.2375,-0.14128,0.29495,0.01215,0.02048,0.00607,-0.01543,0.00878,0.09516,0.01212,0.11537,-0.01547,-0.01116,0.01879],"d":[43800000,35900000,2830000,7770000,23700000,3130000,13000000,8870000,7320000,21800000,6580000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,17800000,0,0,0,45100000,0,0,0,0,641000,1280000,373000,165000,11700000,10800000,2320000,2280000,52000000,13200000,3090000,1030000,19000000,18300000,4460000],"n":72065,"w":43800000},"pts":{"b":[0.01984,-0.02175,-0.00868,-0.0035,-0.00765,-0.00692,-0.01702,-0.00922,0.00704,-0.00491,0.00246,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02786,0,0,0,0.0299,0,0,0.14801,0,-0.01181,0.01712,-0.09375,-0.06825,0.00825,-0.00526,0.00286,-0.00017,0,0,0,0,-0.00453,0.0042,-0.00209],"d":[11600000,9940000,588000,2050000,5990000,824000,2950000,2240000,1970000,5860000,1760000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7290000,0,0,0,13700000,0,0,1070000,0,268000,148000,87300,64000,2920000,2520000,622000,620000,0,0,0,0,5820000,4250000,977000],"n":71927,"w":11600000},"reb":{"b":[-0.0074,-0.04142,0.00498,-0.00966,0.03124,0.00218,-0.00428,0.00983,-0.00588,-0.00705,-0.00699,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.00142,0,0,0,0.01676,0,0,0.0939,0,-0.01621,-0.04316,-0.02097,-0.04693,-0.00499,-0.0199,0.01516,-0.01432,0,0,0,0,0.02345,-0.00701,-0.02647],"d":[1820000,1390000,173000,323000,975000,129000,518000,353000,285000,911000,274000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,773000,0,0,0,1840000,0,0,167000,0,73000,32700,11200,14900,378000,438000,95800,99000,0,0,0,0,758000,630000,250000],"n":71265,"w":1820000},"ast":{"b":[-0.03009,-0.01767,-0.02029,-0.02163,0.05708,-0.00847,0.00172,0.05438,-0.01474,0.01133,0.01945,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.01041,0,0,0,0.01912,0,0,0.07797,0,0.04274,-0.04848,0.0326,-0.02753,0.00401,-0.01392,-0.01263,-0.00737,0,0,0,0,0.02753,-0.01582,-0.01788],"d":[734000,626000,36600,129000,347000,51100,181000,108000,123000,367000,111000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,423000,0,0,0,871000,0,0,70800,0,14300,10500,4510,2980,186000,154000,40700,37200,0,0,0,0,354000,252000,58100],"n":69177,"w":734000},"fg3m":{"b":[0.00836,-0.03447,-0.02355,-0.01201,-0.01406,-0.00212,-0.00714,-0.0559,0.00777,0.01253,0.01263,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02363,0,0,0,0.03225,0,0,0.13596,0,-0.00883,0.01877,-0.08497,-0.11294,0.00334,-0.00247,0.00044,-0.05029,0,0,0,0,-0.00695,0.01277,0.00056],"d":[148000,118000,10800,26700,77900,10600,41800,35900,24500,74400,22300,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65400,0,0,0,152000,0,0,13500,0,4660,2670,1150,1160,46700,34900,8130,8200,0,0,0,0,67000,54700,16700],"n":59855,"w":148000}},"s6":{"min":{"b":[0.05794,-0.09835,-0.06522,0,-0.01117,-0.01212,0.01928,0.00131,0.00303,0.00028,-0.00198,0.01735,0.05346,-0.0007,0.00289,-0.1437,0.00103,-0.01477,-0.00576,0.01238,0.00411,-0.00715,0.03199,0.00097,-0.02521,0.01459,0.01487,-0.01835,0.00115,-0.02638,0,-0.00531,0,0,0.12012,0.11721,-0.86239,-0.03471,0.01629,0.03541,0.00378,-0.10623,0.00987,0.05524,-0.08754,0.04818,-0.00933,-0.00893,-0.00433],"d":[34900000,26700000,3370000,0,19500000,1720000,10100000,7630000,5330000,17400000,5210000,32700000,570000,70100000,13400000,1720000,5380000,12600000,17400000,371000,373000,282000,22900000,136000,7860000,13700000,11300000,54800000,12300000,35400000,0,166000,0,0,740000,840000,1400000,157000,9780000,8390000,1830000,3160000,39900000,13700000,3160000,1450000,13800000,13900000,4910000],"n":87610,"w":34900000},"pts":{"b":[0.0428,-0.02475,-0.01876,0,0.00991,-0.03447,-0.01957,-0.01844,0.00541,-0.00861,-0.0021,0.00038,0.0185,-0.00055,0.00357,-0.0419,0.00191,-0.00915,-0.00816,-0.03545,0.04564,0.00647,-0.01657,0.0038,-0.0566,-0.02417,0.0064,-0.01275,-0.00106,0.02141,0,-0.02923,0.12966,-0.0334,-0.01396,-0.02611,-0.65332,-0.16436,0.00469,-0.01348,0.00927,-0.00204,0,0,0,0,0.00229,-0.00174,-0.00779],"d":[8640000,7210000,510000,0,4580000,415000,2290000,1770000,1440000,4360000,1300000,9350000,147000,17300000,3290000,321000,2040000,3460000,5280000,118000,83800,48200,6270000,36100,1260000,5300000,4380000,13400000,3410000,10200000,0,48200,940000,2450000,157000,146000,43200,36900,2210000,1910000,456000,475000,0,0,0,0,4160000,3140000,827000],"n":86616,"w":8640000},"reb":{"b":[0.01041,-0.05414,-0.00148,0,0.05595,0.02959,-0.00588,-0.01115,-0.00657,-0.01094,-0.00636,-0.00498,0.00196,0.00877,0.00369,-0.01543,0.00842,-0.01451,-0.0163,0.00024,0.01561,-0.00872,-0.01469,0.01043,-0.05768,0.00727,-0.00206,-0.01143,0.01693,0.01168,0,-0.01999,0.06917,-0.00061,-0.0195,-0.02741,-0.52514,-0.17687,0.0011,-0.02563,0.02714,-0.0257,0,0,0,0,0.02563,-0.01956,-0.03965],"d":[1360000,995000,150000,0,759000,63800,404000,287000,204000,683000,205000,552000,27200,2730000,512000,63500,229000,529000,632000,14800,11900,11500,920000,5940,276000,570000,472000,2120000,518000,1390000,0,6510,150000,399000,44000,31300,6260,9120,290000,337000,70600,77400,0,0,0,0,529000,467000,211000],"n":83929,"w":1360000},"ast":{"b":[-0.01507,-0.02039,-0.01642,0,0.07323,0.012,0.00369,0.03795,-0.0236,0.00772,0.01816,-0.01285,0.00842,0.01031,-0.00022,0.0027,0.00636,0.00095,-0.00052,0.01074,-0.00411,0.01072,-0.02959,-0.01794,-0.05451,0.01071,0.00325,-0.01,0.00534,0.00367,0,0.01035,0.0463,-0.01545,0.0138,-0.01969,-0.62119,-0.19501,0.00372,-0.02626,-0.00788,-0.00188,0,0,0,0,0.03493,-0.02346,-0.02754],"d":[544000,453000,31300,0,265000,24600,139000,86100,90200,272000,82600,214000,8610,1080000,203000,20000,106000,219000,316000,6690,5460,3030,394000,2130,79600,308000,256000,852000,216000,643000,0,2670,62000,153000,8240,10200,3290,1770,140000,117000,29700,29200,0,0,0,0,250000,186000,48700],"n":77621,"w":544000},"fg3m":{"b":[-0.00656,-0.04309,-0.03476,0,0.00583,-0.0127,-0.005,-0.05026,0.01187,0.01321,0.00847,0.02654,-0.00089,-0.00036,0.00805,-0.03434,-0.00112,-0.00506,0.00086,-0.03151,0.03287,0.00241,0.00371,0.01194,-0.02434,-0.01788,0.00197,-0.01286,-0.01776,0.01786,0,-0.00678,0.11678,-0.03835,-0.02322,0.01389,-0.64433,-0.20807,-0.00781,-0.00781,-0.00056,-0.06726,0,0,0,0,0.00324,0.00997,-0.00878],"d":[113000,86900,9230,0,60900,5620,32900,28400,18300,56800,17000,20200,1660,226000,43600,5610,20300,39200,64100,1460,1070,888,76300,398,24100,48200,39800,180000,38400,114000,0,642,12300,32700,2620,2640,822,586,35900,27200,6120,6640,0,0,0,0,48800,41100,14400],"n":64813,"w":113000}},"s12":{"min":{"b":[0.04053,-0.07964,-0.01264,0,-0.01747,-0.02475,0.01587,0.00189,0.00422,-0.00014,-0.00329,0.01162,0.02924,-0.00136,0.00117,-0.0333,-0.00766,0.00058,0.00978,0.00094,-0.00095,-0.01193,0.02967,0.0941,-0.28056,0.02411,0.00679,-0.01003,-0.01497,-0.02922,-0.00424,-0.01963,0,0,0.1767,-0.11367,-0.65527,-0.01554,0.01335,0.02904,0.00504,-0.07084,0.00921,0.07096,-0.0408,0.05045,-0.00895,-0.00762,0.00456],"d":[25900000,20000000,2510000,0,14400000,1850000,7270000,5290000,4010000,12900000,3860000,33200000,1400000,41700000,20600000,964000,10200000,14600000,19200000,1370000,1420000,1130000,13300000,4660000,1810000,10100000,6630000,56500000,13300000,26600000,327000,690000,0,0,573000,715000,1120000,83200,7620000,6090000,1360000,2510000,28300000,10000000,2650000,905000,10200000,10300000,3630000],"n":87264,"w":25900000},"pts":{"b":[0.00984,-0.01605,0.01144,0,0.01004,-0.05335,-0.01443,-0.01745,0.01184,-0.00931,-0.00042,0.00933,0.00582,-0.00056,0.01206,-0.08318,-0.00929,-0.00682,-0.01091,-0.066,0.0671,0.01399,-0.01266,-0.0132,-0.0825,-0.02551,-0.00331,-0.00671,-0.00553,0.0312,-0.00656,-0.01861,0.13805,-0.02672,-0.01387,-0.02205,-0.75186,-0.04421,0.00695,-0.008,0.0096,-0.00938,0,0,0,0,0.00105,-0.00251,0.00737],"d":[6540000,5530000,359000,0,3420000,444000,1680000,1240000,1110000,3300000,983000,9190000,384000,10300000,5050000,219000,3520000,4020000,5650000,449000,300000,175000,3540000,1230000,97500,4070000,2680000,14000000,3560000,7640000,59700,191000,868000,1900000,153000,88200,32900,9110,1770000,1410000,348000,387000,0,0,0,0,3210000,2380000,581000],"n":85893,"w":6540000},"reb":{"b":[-0.02511,-0.04203,0.015,0,0.05193,0.0129,-0.00657,-0.00447,-0.00325,-0.00761,-0.00668,-0.00073,-0.00289,0.01564,-0.00715,-0.05391,0.00385,0.00042,-0.01147,0.00397,0.02084,0.00987,0.00096,0.00198,-0.11476,-0.00389,-0.00566,-0.00643,0.00679,0.01848,0.01133,-0.02435,0.06033,0.00841,-0.00651,-0.0365,-0.60054,-0.09068,0.00254,-0.02111,0.02234,-0.00808,0,0,0,0,0.02541,-0.01969,-0.02844],"d":[1040000,782000,105000,0,577000,69000,298000,202000,161000,520000,156000,628000,69400,1670000,792000,42100,429000,633000,728000,54100,46200,42600,520000,242000,21500,439000,292000,2180000,570000,1040000,11800,26100,142000,314000,42700,18700,4850,2270,233000,251000,54100,62800,0,0,0,0,414000,366000,149000],"n":82416,"w":1040000},"ast":{"b":[-0.05247,-0.01953,-0.00166,0,0.06823,0.01089,0.0113,0.03745,-0.02666,0.0023,0.01982,0.00269,-0.00264,0.01441,0.01691,-0.0419,0.00471,-0.01104,-0.00716,-0.01151,-0.02223,-0.00394,-0.01439,-0.018,-0.09634,0.00828,-0.01253,-0.00792,0.01707,0.01438,-0.0311,0.00488,0.03026,-0.01484,0.04061,-0.00947,-0.65592,-0.12591,0.00899,-0.02222,-0.00628,0.0004,0,0,0,0,0.03146,-0.02381,-0.02918],"d":[417000,352000,22200,0,202000,26200,104000,62000,70200,208000,63300,230000,22700,648000,311000,12900,205000,255000,354000,24900,19700,11000,220000,80900,6790,237000,159000,902000,225000,489000,4710,11200,57500,118000,7810,6240,2620,490,114000,87000,22800,24000,0,0,0,0,193000,146000,34900],"n":74505,"w":417000},"fg3m":{"b":[-0.02181,-0.02807,-0.0092,0,0.00228,-0.01512,-0.00401,-0.04806,0.01325,0.01277,0.0115,0.06384,-0.0045,-0.0034,0.00858,-0.0862,-0.01322,-0.00836,-0.01073,-0.04714,0.0432,-0.00447,-0.03217,-0.03389,-0.07325,-0.00779,-0.02178,-0.01194,-0.01957,0.03027,-0.00791,0.01118,0.11594,-0.0292,-0.01101,0.00771,-0.7122,-0.10146,-0.00176,-0.00746,-0.00604,-0.06252,0,0,0,0,-0.00592,0.01133,0.01848],"d":[84100,66100,6430,0,44800,6000,23800,19800,13900,42400,12600,27800,4650,132000,66500,3540,37300,50300,74800,5340,3790,3280,46500,15600,1720,36600,24000,183000,44800,85000,1020,2410,11100,25000,2680,1570,618,96.4,28100,19700,4640,5270,0,0,0,0,37600,30600,9850],"n":60865,"w":84100}},"s18":{"min":{"b":[-0.02162,-0.05163,-0.02528,0,0.02268,-0.03221,0.01255,-0.00557,0.00626,-0.00816,-0.00515,0.0204,0.00068,0.00541,-0.00885,0.01979,-0.0104,-0.01233,0.0061,0.00619,-0.00843,-0.00565,0.09862,0.06823,-0.21292,0.0276,0.00991,-0.01013,0.00206,-0.00748,-0.01075,-0.0201,0,0,0.19957,-0.17647,0,0,0.01668,0.02097,0.00141,-0.05762,0.02569,0.07127,0.01499,0.01472,-0.00267,-0.01983,-0.00433],"d":[20200000,15800000,1740000,0,11600000,1820000,6100000,4610000,3190000,10100000,3030000,31400000,284000,31800000,23700000,788000,12100000,13900000,18600000,2130000,2390000,1740000,13000000,3280000,187000,8170000,4600000,50800000,12200000,21100000,310000,1090000,0,0,494000,500000,0,0,6430000,5140000,1060000,1180000,29700000,11200000,3120000,37600,7950000,8470000,2680000],"n":70897,"w":20200000},"pts":{"b":[-0.01085,-0.00575,0.0373,0,-0.0029,-0.03402,-0.02517,0.00092,0.0097,-0.00308,0.00548,0.00324,-0.00549,-0.00572,0.0112,-0.0364,-0.00665,0.00121,-0.01298,-0.06672,0.07374,0.02823,-0.05132,-0.00787,-0.05376,-0.03888,0.00508,-0.00103,-0.01426,0.0591,-0.00341,-0.00456,0.13537,-0.0323,-0.14141,0.01191,0,0,0.002,-0.01365,0.00864,0.02074,0,0,0,0,0.00128,0.00817,-0.00139],"d":[4780000,4110000,233000,0,2420000,374000,1220000,908000,809000,2410000,719000,7670000,50700,7060000,5150000,151000,3420000,3300000,4760000,638000,407000,228000,3320000,729000,9970,3120000,1820000,12300000,2960000,5710000,47200,255000,797000,1360000,166000,52400,0,0,1400000,1040000,256000,253000,0,0,0,0,2400000,1660000,404000],"n":70671,"w":4780000},"reb":{"b":[-0.03433,-0.028,0.02742,0,0.03707,-0.00354,-0.0175,0.00997,-0.00301,0.00074,0.00013,0.00064,-0.01947,0.01636,-0.00881,-0.0185,0.00838,0.00897,-0.01912,-0.00804,0.03844,0.02409,-0.03832,-0.0182,-0.1002,-0.01749,-0.01933,-0.00082,-0.0116,0.04097,0.00683,-0.00785,0.06418,0.01585,-0.12258,0.0228,0,0,-0.00204,-0.02853,0.0143,0.02886,0,0,0,0,0.02234,-0.00552,-0.02868],"d":[763000,583000,71800,0,414000,59000,220000,154000,118000,382000,114000,575000,10500,1170000,815000,31300,483000,534000,651000,76500,64900,59500,524000,132000,2830,336000,198000,1890000,466000,783000,10100,34900,133000,229000,47800,11200,0,0,189000,186000,40200,42000,0,0,0,0,311000,256000,108000],"n":69933,"w":763000},"ast":{"b":[-0.07994,-0.01463,0.01053,0,0.05141,0.036,-0.00022,0.04461,-0.02232,0.0085,0.02547,0.01281,-0.00803,0.01204,0.00027,-0.03064,0.00463,0.00052,-0.00691,0.01024,0.01945,0.01115,-0.04719,-0.00003,-0.05419,-0.01469,-0.00008,-0.00421,0.00154,0.03447,-0.03674,0.00598,0.03507,-0.02222,-0.07352,0.00245,0,0,0.00889,-0.02973,-0.00617,0.02944,0,0,0,0,0.0211,-0.0059,-0.0244],"d":[315000,271000,14400,0,148000,22500,78600,44900,52400,158000,47800,214000,3100,455000,324000,9100,214000,216000,312000,36000,27500,13900,220000,45900,572,188000,112000,820000,190000,379000,3800,14900,54200,86300,8790,3840,0,0,92600,66200,17300,15700,0,0,0,0,151000,104000,23700],"n":65924,"w":315000},"fg3m":{"b":[-0.06013,-0.0141,0.01975,0,-0.0008,0.00429,-0.01431,-0.02744,0.01156,0.01927,0.01594,0.07278,-0.00778,-0.00824,0.00166,-0.03423,0.00031,-0.01046,-0.034,-0.04036,0.04724,0.00856,-0.0353,0.00477,-0.0546,-0.01989,-0.01454,-0.00046,-0.03634,0.06148,0.01438,0.0045,0.10785,-0.03786,-0.1508,0.01165,0,0,0.01332,-0.00906,-0.01693,-0.02876,0,0,0,0,-0.0119,0.01996,0.00539],"d":[60300,48300,4160,0,31100,4940,17000,14500,10000,30300,9030,27800,643,89400,66700,2400,39000,41600,64900,7450,5110,4160,41600,9490,138,27700,16200,157000,37300,62600,846,3140,10100,17500,3090,913,0,0,21700,14200,3350,3340,0,0,0,0,27400,21100,6750],"n":54257,"w":60300}},"s24":{"min":{"b":[0.00245,-0.01941,-0.00679,0,0.01883,-0.04415,0.00746,-0.00539,0.00603,-0.00556,-0.0023,0.01496,0.00943,0.00749,-0.01198,0.06386,-0.01079,0.0008,0.00989,0.00735,-0.01862,-0.01877,0.01079,0.03541,0,0.02601,0.01035,0.00394,0.00197,0.00954,-0.01261,-0.01407,0,0,0.14891,-0.12587,0,0,0.02257,0.01523,0.00084,-0.04481,0.02135,0.05771,0.00442,0.00513,-0.00695,-0.01841,0.00289],"d":[13200000,10000000,1220000,0,7590000,1540000,4080000,3150000,2040000,6610000,1990000,22000000,675000,18300000,20900000,620000,8940000,10100000,13200000,2160000,2470000,2190000,9120000,3680000,0,5310000,2620000,31800000,7920000,13400000,183000,1100000,0,0,356000,321000,0,0,3620000,3410000,697000,782000,21000000,8670000,2170000,5170,5010000,5400000,1890000],"n":66466,"w":13200000},"pts":{"b":[-0.04368,-0.01707,0.02299,0,-0.00824,-0.02221,-0.01942,-0.00333,0.01196,-0.00131,0.00023,-0.00363,0.01544,-0.00732,0.00366,-0.04341,-0.00758,-0.00036,-0.01875,-0.0554,0.05021,0.03772,-0.01014,-0.02323,0,-0.05852,0.00405,-0.01492,-0.01225,0.04926,-0.00674,-0.01111,0.13458,-0.03669,-0.14084,0.0215,0,0,-0.00649,-0.0158,0.00502,0.01151,0,0,0,0,0.00584,0.01132,0.00141],"d":[3000000,2550000,163000,0,1500000,277000,770000,596000,510000,1510000,451000,5230000,158000,3830000,4100000,109000,2120000,2350000,3180000,602000,376000,256000,2250000,675000,0,1990000,1080000,7160000,1820000,3560000,26400,235000,561000,736000,104000,35100,0,0,762000,649000,163000,164000,0,0,0,0,1460000,1000000,269000],"n":66397,"w":3000000},"reb":{"b":[-0.07252,-0.04329,0.00338,0,0.03285,-0.0318,-0.01053,0.00601,-0.00435,0.00495,-0.00114,0.00845,-0.0032,0.0163,0.01773,-0.01801,0.00562,-0.00474,-0.01729,-0.00929,0.00282,0.00903,-0.00717,-0.0332,0,-0.03105,-0.01238,-0.00889,-0.00705,0.0287,-0.00156,-0.03521,0.05295,0.00903,-0.11963,0.01119,0,0,-0.00191,-0.02854,0.00887,0.02475,0,0,0,0,0.02179,-0.00657,-0.02438],"d":[482000,362000,50300,0,260000,45300,138000,102000,74700,241000,72200,407000,29700,640000,666000,23900,349000,378000,451000,73300,61500,66500,324000,147000,0,216000,116000,1100000,291000,496000,5750,33000,94600,125000,29500,7750,0,0,103000,117000,25500,27600,0,0,0,0,189000,158000,72800],"n":66096,"w":482000},"ast":{"b":[-0.10292,-0.02678,-0.00733,0,0.04318,0.01177,-0.00756,0.03611,-0.03157,0.00998,0.02158,0.02175,-0.02344,0.01289,0.01521,-0.01468,0.01288,-0.01009,-0.0178,0.00981,-0.00044,0.01214,0.00602,-0.03151,0,-0.03841,-0.00066,-0.00197,0.00939,0.01716,-0.04057,-0.00878,0.02172,-0.02775,-0.10308,0.01454,0,0,0.00326,-0.03853,-0.00536,0.03518,0,0,0,0,0.0226,-0.00891,-0.01602],"d":[200000,170000,10300,0,93000,16700,50200,30100,33700,100000,30300,159000,9540,247000,258000,6660,141000,154000,213000,34700,25000,15300,151000,41800,0,122000,67900,485000,119000,240000,2130,14500,38400,46700,5690,2590,0,0,51300,42000,11000,10300,0,0,0,0,92500,64300,16200],"n":63152,"w":200000},"fg3m":{"b":[-0.06537,-0.03054,0.00555,0,-0.00317,0.00633,-0.00844,-0.02161,0.01635,0.02425,0.00544,0.07329,0.01055,-0.01802,0.00575,-0.02546,0.01115,-0.02037,-0.06197,-0.01538,0.04784,0.0104,-0.02352,-0.0503,0,-0.04506,0.01034,-0.01164,-0.02784,0.05319,0.0084,-0.01472,0.09248,-0.03005,-0.15505,-0.00586,0,0,-0.00009,-0.01193,-0.01269,-0.03779,0,0,0,0,-0.01477,0.0257,0.01262],"d":[37800,29800,2860,0,19300,3700,10700,9500,6280,19000,5680,21500,1900,48300,53300,1790,25400,29700,43600,6890,4680,4630,26700,10200,0,17700,9520,92500,23200,39000,478,2870,7090,9460,1930,612,0,0,11900,8940,2140,2170,0,0,0,0,16600,12600,4510],"n":51023,"w":37800}},"s30":{"min":{"b":[-0.05829,-0.01043,0.00561,0,0.02014,-0.02571,0.01127,0.00426,0.01733,-0.01023,-0.00292,0.01963,-0.01575,0.00761,-0.0346,-0.03196,-0.00871,-0.01187,0.00927,0.00257,-0.02524,-0.00604,0.069,0.0278,0,0.03344,0.01443,-0.00631,0.01027,-0.02498,-0.0142,-0.01467,0,0,-0.12387,0.31861,0,0,0.02284,0.01986,-0.00255,-0.05842,0.01712,0.03676,-0.05308,-0.00079,-0.01137,-0.02233,-0.00075],"d":[7400000,5120000,893000,0,4260000,1080000,2320000,1980000,1080000,3700000,1110000,12400000,164000,9460000,14600000,505000,4700000,5940000,7650000,1430000,1800000,2270000,4870000,4220000,0,2870000,1290000,19400000,4230000,7300000,95500,760000,0,0,237000,146000,0,0,2080000,1940000,389000,462000,10900000,5630000,1400000,6330,2500000,2840000,1260000],"n":66426,"w":7400000},"pts":{"b":[-0.0248,0.01471,-0.02132,0,-0.00326,-0.01183,-0.01798,-0.00896,0.00745,0.00074,0.00674,-0.00315,-0.04342,-0.0062,0.00786,0.00039,-0.00636,0.02254,-0.01268,-0.08331,0.0077,0.07454,-0.04269,-0.04519,0,-0.04732,0.01828,-0.00534,-0.02975,0.08846,-0.00436,-0.00792,0.12036,-0.05944,-0.01345,-0.10085,0,0,0.0097,-0.00971,0.00275,-0.03379,0,0,0,0,0.0134,0.0077,0.01621],"d":[1480000,1130000,149000,0,744000,161000,399000,342000,237000,745000,224000,2520000,25000,1720000,2420000,73900,915000,1160000,1600000,334000,219000,279000,1050000,726000,0,894000,470000,3930000,838000,1710000,12200,133000,356000,321000,22400,34800,0,0,380000,334000,81300,94100,0,0,0,0,619000,457000,190000],"n":66297,"w":1480000},"reb":{"b":[-0.07677,-0.01932,-0.0395,0,0.04672,-0.01393,-0.00525,-0.00445,-0.00923,0.00226,0.00306,0.00895,-0.02796,0.01718,0.00256,0.03887,0.00916,0.00643,-0.01496,-0.01677,-0.03071,0.04812,-0.0189,-0.02194,0,-0.02287,-0.03242,-0.00737,-0.01842,0.0748,0.00478,-0.04371,0.03844,0.00753,0.00283,-0.08465,0,0,0.0185,-0.02036,0.02026,-0.01544,0,0,0,0,0.01671,-0.01432,-0.00762],"d":[257000,163000,46000,0,141000,28300,76600,62100,35200,129000,38700,220000,5320,317000,425000,17000,170000,202000,242000,40400,35900,70300,165000,183000,0,107000,54700,667000,149000,269000,2980,18500,64700,59000,6260,7930,0,0,55400,64100,13600,17700,0,0,0,0,81900,72900,52000],"n":65904,"w":257000},"ast":{"b":[-0.08822,-0.02433,-0.04628,0,0.06163,-0.00319,-0.00316,0.03117,-0.04158,0.00765,0.02103,0.02537,-0.02174,0.01816,0.03981,0.03931,-0.00132,0.0023,-0.00636,-0.00402,-0.04562,0.02118,-0.0533,-0.04426,0,-0.03592,0.02756,0.00428,-0.00349,0.03465,-0.06031,-0.01762,0.00087,-0.03993,-0.03739,-0.01412,0,0,0.00201,-0.03141,-0.00022,-0.00753,0,0,0,0,0.02738,-0.02054,-0.00439],"d":[100000,76900,9470,0,46700,9710,26600,18100,16100,50100,15300,82400,1510,113000,153000,4640,62200,77900,109000,19100,14600,17000,71600,47200,0,55600,30000,268000,55300,115000,1040,8230,24700,20600,1240,2550,0,0,26300,22000,5580,5910,0,0,0,0,39400,30100,11700],"n":61752,"w":100000},"fg3m":{"b":[-0.07842,0.00443,-0.03811,0,-0.00007,0.00591,-0.00063,-0.01524,0.00069,0.01409,0.0135,0.0695,-0.04938,-0.0128,0.01175,-0.01018,0.01445,-0.00396,-0.04696,-0.03873,-0.00734,0.05441,-0.04139,-0.02908,0,-0.01871,0.01374,-0.00473,-0.0399,0.07393,0.02886,0.02031,0.05417,-0.06255,-0.05426,-0.10245,0,0,0.00204,-0.00979,0.00696,-0.07868,0,0,0,0,-0.00263,0.01871,0.0321],"d":[19900,13700,2590,0,10100,2310,5850,5540,3060,10000,2990,11800,277,23000,34000,1270,11800,15600,23300,4020,2770,5100,13100,13000,0,8230,4180,55200,11600,20000,242,1740,4760,4400,399,591,0,0,6180,4850,1130,1320,0,0,0,0,7440,5840,3140],"n":47345,"w":19900}},"s36":{"min":{"b":[-0.06529,0.07508,0.01152,0,0.01548,-0.0271,0.01216,-0.00509,0.02616,-0.01187,0.00115,0.02133,0.00254,0.00666,-0.05091,-0.04258,-0.00657,-0.00261,0.01372,-0.02325,-0.03909,0.01512,-0.00917,0.02558,0,0.01998,0.03778,-0.00103,-0.02083,-0.01282,-0.01464,-0.02113,0,0,0.0138,-0.01918,0,0,0.02593,0.01692,-0.00055,-0.04985,0,0,0,0,0,0,0],"d":[3370000,2330000,441000,0,1930000,706000,1050000,1050000,490000,1690000,506000,5910000,162000,4280000,7940000,221000,2170000,2930000,3590000,749000,1030000,1540000,2130000,960000,0,1280000,533000,8960000,2110000,3420000,39900,420000,0,0,106000,86000,0,0,938000,887000,178000,225000,0,0,0,0,0,0,0],"n":66697,"w":3370000},"pts":{"b":[-0.07827,0.00361,0.0325,0,-0.01254,-0.07202,-0.01742,-0.03538,0.0187,-0.00161,0.01192,-0.008,-0.02785,0.00185,0.02404,-0.05016,-0.00828,0.01162,-0.00925,-0.09498,0.00826,0.06075,0.00967,0.00589,0,-0.05123,0.01274,-0.00328,0.02387,0.05391,-0.02077,0.00169,0.13148,-0.06999,-0.04049,-0.00657,0,0,0.00111,0.00582,0.00613,-0.01235,0,0,0,0,0,0,0],"d":[661000,541000,50300,0,328000,85900,171000,168000,110000,332000,99600,1180000,31500,756000,1140000,28800,391000,573000,737000,148000,114000,160000,398000,173000,0,406000,221000,1730000,409000,769000,4750,62700,237000,128000,13500,10600,0,0,170000,146000,37100,39400,0,0,0,0,0,0,0],"n":66000,"w":661000},"reb":{"b":[-0.09233,-0.04095,-0.0052,0,0.03695,-0.03901,-0.00663,-0.01584,-0.00143,0.00475,-0.00208,0.01539,-0.00406,0.01741,-0.01687,0.03069,0.0054,-0.00685,-0.0199,0.02375,-0.01122,0.02103,0.01406,-0.00647,0,-0.03661,-0.01068,-0.00658,0.02394,0.03917,-0.00608,-0.05178,0.0475,-0.00104,-0.01607,-0.01259,0,0,0.00609,-0.01805,0.02257,0.00773,0,0,0,0,0,0,0],"d":[116000,83800,14900,0,62800,16700,33200,31000,17800,58000,17500,108000,6810,141000,213000,6520,82100,99700,117000,19400,20700,40300,65300,39500,0,49200,25100,292000,71300,120000,1150,9410,43600,24200,3830,2400,0,0,24600,28100,6250,7280,0,0,0,0,0,0,0],"n":64127,"w":116000},"ast":{"b":[-0.1425,-0.04396,-0.02349,0,0.04978,-0.05077,-0.00883,0.02207,-0.02636,0.00888,0.03222,0.03243,-0.02614,0.01311,0.0391,0.00361,-0.00841,-0.00566,-0.00038,0.00881,-0.02962,0.01131,-0.00628,-0.00391,0,-0.03036,0.02918,0.00788,0.01815,0.00763,-0.04434,-0.01566,-0.0008,-0.04192,-0.03373,0.04737,0,0,-0.00551,-0.02297,0.00796,0.0177,0,0,0,0,0,0,0],"d":[46600,38700,3140,0,21600,5270,11900,8990,7960,23300,7080,41900,2100,51800,74600,1840,28200,40300,52700,8630,7930,9730,27700,11900,0,26400,14500,124000,28800,54300,416,3930,17100,8380,749,815,0,0,12100,10000,2640,2580,0,0,0,0,0,0,0],"n":53059,"w":46600},"fg3m":{"b":[-0.10528,-0.00742,0.00728,0,-0.0067,-0.01385,-0.00688,-0.01416,0.00161,-0.00491,0.01406,0.07644,-0.04381,-0.01572,0.00562,-0.03809,0.00481,-0.01271,-0.04492,-0.06001,0.00855,0.05419,0.02707,0.01918,0,0.0114,-0.02484,0.00777,-0.00345,0.05155,0.00668,0.03944,0.0216,-0.05828,-0.07091,-0.11374,0,0,-0.0216,0.00297,0.03617,-0.06468,0,0,0,0,0,0,0],"d":[8130,6220,786,0,4110,1180,2280,2590,1350,4080,1220,5500,341,9280,14900,452,4700,7090,10000,1630,1240,2790,5080,2200,0,3580,1920,22200,5030,8380,83.6,763,2900,1600,229,163,0,0,2560,1930,476,502,0,0,0,0,0,0,0],"n":33469,"w":8130}},"s42":{"min":{"b":[-0.26903,0.1111,0.05892,0,0.01844,0.04616,0.01275,-0.01143,-0.00175,-0.02052,0.0143,0.0204,-0.06215,0.01204,-0.14761,-0.06653,0.00811,-0.00782,-0.00189,0.01435,-0.02496,0.11938,0.48206,-0.10342,0,-0.00225,0.08149,0.00066,0.00858,-0.0343,-0.01955,-0.00736,0,0,0.00548,-0.17113,0,0,0.00892,0.00525,0.00986,-0.01966,0,0,0,0,0,0,0],"d":[891000,655000,110000,0,501000,210000,267000,262000,134000,446000,133000,1570000,14900,1240000,2270000,56100,552000,811000,965000,235000,324000,446000,644000,191000,0,352000,141000,2390000,574000,997000,8600,128000,0,0,28300,21400,0,0,243000,228000,47100,64800,0,0,0,0,0,0,0],"n":66788,"w":891000},"pts":{"b":[-0.11499,0.12878,0.16033,0,-0.02234,0.01702,-0.0132,-0.00125,0.00124,0.00569,0.02949,0.02411,0.00113,0.00288,-0.0239,-0.04863,-0.00937,0.01613,-0.00065,-0.1535,-0.05433,0.14227,-0.09776,0.01155,0,0.00321,0.09399,-0.02942,0.02535,0.08514,-0.00491,-0.01397,0.13669,-0.10188,-0.06741,-0.14507,0,0,0.01856,0.02501,0.00605,-0.01631,0,0,0,0,0,0,0],"d":[195000,159000,16700,0,95600,28200,49600,44000,31000,98200,29400,341000,2330,243000,358000,8900,105000,173000,210000,39500,32600,66800,178000,8740,0,118000,62000,518000,128000,242000,1140,17000,76600,36300,4240,2590,0,0,47300,43200,11000,12500,0,0,0,0,0,0,0],"n":58039,"w":195000},"reb":{"b":[-0.10847,0.0947,0.0634,0,0.02894,0.04067,0.00873,0.00025,0.00004,0.00698,0.02658,0.029,-0.01909,0.01901,-0.06557,-0.01497,0.00404,0.0064,0.00504,0.00535,-0.05611,0.11265,-0.03872,0.01651,0,-0.02251,0.04251,0.00417,0.02662,0.05116,0.01704,-0.06765,0.03998,-0.00798,-0.00007,-0.13431,0,0,0.01413,0.0086,0.02484,0.02519,0,0,0,0,0,0,0],"d":[35900,26200,4710,0,19200,5700,10100,8850,5330,18000,5400,34800,576,48000,70200,2140,25000,32400,35100,5560,6170,16500,33000,1640,0,14900,7380,90800,23000,39800,296,2800,14900,7310,1230,583,0,0,7170,8740,1950,2470,0,0,0,0,0,0,0],"n":46257,"w":35900},"ast":{"b":[-0.15113,0.02986,0.03547,0,0.03627,-0.01111,-0.00346,0.03958,-0.01017,0.0309,0.04806,0.03789,-0.02837,0.01416,-0.00641,-0.02014,-0.01279,0.00351,0.0289,-0.00394,-0.05092,0.07612,-0.11712,0.01435,0,0.00394,0.07109,-0.0116,0.0266,0.01587,-0.04498,-0.01741,-0.04604,-0.06631,-0.07497,-0.04873,0,0,0.0112,-0.00031,0.02224,-0.0162,0,0,0,0,0,0,0],"d":[14000,11700,939,0,6380,1630,3470,2280,2270,6990,2110,13000,154,17000,22700,541,7700,12500,15300,2370,2200,3620,13000,366,0,7900,4240,37300,9100,17400,101,1090,5650,2370,240,183,0,0,3400,3000,779,803,0,0,0,0,0,0,0],"n":31814,"w":14000},"fg3m":{"b":[-0.09768,0.02685,0.06437,0,0.00773,0.04998,0.00868,0.0167,-0.01411,0.01399,0.03729,0.07904,-0.00608,-0.00635,-0.06887,0.00286,-0.01485,-0.00353,-0.01403,-0.06918,-0.02511,0.09701,-0.04961,-0.01909,0,0.05989,0.04463,-0.00906,0.00662,0.07974,-0.0032,-0.01603,0.02936,-0.09405,-0.13112,-0.26276,0,0,-0.0328,0.02678,0.01562,-0.03372,0,0,0,0,0,0,0],"d":[1880,1450,199,0,924,276,513,561,299,946,280,1310,16.8,2310,3460,109,946,1670,2250,305,189,874,1830,15.5,0,880,476,5190,1240,2170,13.7,145,727,348,57.8,28,0,0,578,435,108,129,0,0,0,0,0,0,0],"n":13316,"w":1880}},"rep":{"min":{"b":[0.07375,-0.07586,-0.00272,0.00568,0.01363,0.01379,0.0035,-0.00173,-0.00492,-0.00529,-0.00382,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.03735,0,0,0,-0.01054,0,0,0,0,0,0,0,0,0.01123,0.0242,-0.0004,-0.02506,0.02792,0.09401,0.02046,0.04617,-0.00923,-0.02346,-0.00403],"d":[50000000,39200000,3920000,9070000,28700000,3600000,15600000,13600000,8110000,25000000,7540000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,20000000,0,0,0,50400000,0,0,0,0,0,0,0,0,14300000,13100000,2590000,2220000,79000000,29200000,4900000,224000,20400000,21000000,6440000],"n":66284,"w":50000000},"pts":{"b":[0.00574,-0.02462,-0.00138,-0.0096,-0.00335,-0.00722,-0.02026,-0.0072,0.0101,-0.00646,0.00353,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.075,0,0,0,0.045,0,0,0.13112,0,0,0,0,0,-0.00266,-0.03408,0.00612,0.03229,0,0,0,0,0.00579,0.01461,-0.01667],"d":[12100000,10400000,540000,2160000,6310000,856000,3180000,2660000,2070000,6120000,1840000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,8110000,0,0,0,14200000,0,0,1070000,0,0,0,0,0,3020000,2710000,639000,527000,0,0,0,0,6060000,4310000,1020000],"n":66284,"w":12100000},"reb":{"b":[-0.0293,-0.03428,0.01179,-0.01235,0.04219,-0.00446,-0.00378,0.01294,-0.00338,-0.00982,-0.00735,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.03679,0,0,0,0.03221,0,0,0.08091,0,0,0,0,0,-0.00863,-0.03601,0.01475,0.01388,0,0,0,0,0.03112,0.00061,-0.03782],"d":[1840000,1410000,161000,326000,1000000,130000,537000,411000,290000,923000,279000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,821000,0,0,0,1820000,0,0,165000,0,0,0,0,0,372000,458000,96800,82600,0,0,0,0,766000,620000,257000],"n":66261,"w":1840000},"ast":{"b":[-0.04752,-0.02181,-0.00419,-0.02414,0.05551,-0.0105,0.00238,0.04781,-0.01133,0.0109,0.01916,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.03398,0,0,0,0.03336,0,0,0.07468,0,0,0,0,0,-0.00321,-0.03673,-0.01025,0.02234,0,0,0,0,0.03495,-0.00305,-0.02235],"d":[756000,648000,33800,133000,357000,52300,190000,120000,127000,377000,115000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,464000,0,0,0,893000,0,0,70300,0,0,0,0,0,189000,162000,41100,32000,0,0,0,0,363000,249000,58500],"n":65710,"w":756000},"fg3m":{"b":[-0.00592,-0.03876,-0.01929,-0.01548,-0.00917,0.00043,-0.00752,-0.04158,0.01116,0.01014,0.01153,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.05784,0,0,0,0.04161,0,0,0.12654,0,0,0,0,0,-0.0053,-0.02437,-0.00017,-0.02717,0,0,0,0,0.00198,0.01893,-0.01205],"d":[152000,122000,9810,27500,80900,10900,44400,41800,25400,76400,22900,0,0,0,0,0,0,0,0,0,0,0,0,0,0,71100,0,0,0,153000,0,0,13600,0,0,0,0,0,46800,37000,8290,6780,0,0,0,0,68300,55400,16900],"n":57525,"w":152000}}};
// How often the simulated chances really came in over those games: [count, sum of chances, sum of hits] per 10% bin.
const CAL_PRIOR = {"pre":{"pts":[[[226751,2121.43,3060],[17632,2505.66,3007],[9792,2438.63,2953],[9642,3346.58,3836],[4785,2129.53,2348],[5334,2935.58,3162],[6692,4348.33,4580],[3603,2624.58,2755],[25,20.24,23],[0,0,0]],[[149658,4285.19,1572],[42628,6155.69,3763],[29391,7194.89,5970],[20668,7157.85,7036],[21127,9451.48,10399],[17832,9760.76,11256],[15348,9926.38,11378],[18285,13756.91,15334],[23363,19844.98,21138],[26317,24984.3,25647]]],"reb":[[[125211,1440.78,2179],[9595,1397.89,1976],[7898,1897.6,2369],[2981,1047.01,1341],[4207,1900.52,2255],[5551,3042.03,3556],[917,563.81,656],[0,0,0],[0,0,0],[0,0,0]],[[180886,4776.27,2385],[49557,7104.98,5111],[32223,7976.91,7043],[28370,9819.77,9792],[22247,9940,10650],[18797,10282.49,11254],[22223,14434.96,16126],[23235,17392.88,19304],[22933,19450.88,20874],[19945,18861.83,19429]]],"ast":[[[215717,2874.08,2489],[20877,3005.09,3013],[13752,3331.85,3693],[8573,2990.18,3386],[7887,3525.34,3972],[6662,3635,4013],[1140,701.23,772],[0,0,0],[0,0,0],[0,0,0]],[[53193,1874.28,957],[21861,3119.57,2213],[13814,3444.72,2965],[12957,4480.28,4498],[9702,4322.02,4478],[7549,4137.33,4529],[11034,7172.29,8015],[10838,8102.07,8902],[9954,8442.37,9099],[7072,6642.35,6868]]],"fg3m":[[[181034,2398.03,4315],[19156,2671.77,3670],[12983,3229.82,4035],[7354,2491.73,2930],[6205,2792.24,3202],[7970,4383.15,4809],[4514,2836.73,3086],[4,2.81,3],[0,0,0],[0,0,0]],[[57899,2653.31,2286],[32181,4707.28,4183],[19617,4779.47,4668],[17670,6183.26,6307],[14522,6480.58,6825],[10015,5461.08,5680],[12038,7900.27,8295],[15326,11453.1,11987],[11497,9706.3,10000],[2597,2395.39,2424]]]},"s6":{"pts":[[[404412,2950.07,4571],[22714,3230.76,3860],[13252,3267.58,3715],[10844,3754.91,4217],[6908,3089.48,3394],[6684,3663.58,3971],[6756,4385.77,4700],[4213,3104.43,3207],[2222,1890.06,1965],[1311,1222.92,1242]],[[126265,3473.38,1458],[33478,4838.24,3279],[22406,5489.48,4784],[16602,5758.08,5797],[15945,7132.45,7796],[13733,7517.92,8531],[12420,8038.31,8975],[14366,10806.74,11784],[17201,14601.5,15371],[28525,27365,27718]]],"reb":[[[276434,2542.75,3789],[17901,2580.92,2877],[11463,2753.7,3058],[5740,2010.26,2293],[6168,2768.08,3206],[6794,3725.3,4236],[1452,904.77,1027],[958,727.23,833],[652,535.84,590],[0,0,0]],[[163806,4097.84,2392],[40988,5874.25,4651],[26347,6534.82,6263],[22721,7857.02,8013],[18233,8145.47,8665],[14884,8148.2,8935],[18949,12313.85,13538],[18014,13473.23,14560],[17931,15233.42,16088],[20018,19009.77,19373]]],"ast":[[[327271,3687.93,3153],[25106,3597.78,3563],[15945,3878.73,4121],[10070,3491.91,3838],[7111,3165.19,3480],[5986,3279.18,3709],[2310,1475.33,1646],[1974,1479.87,1605],[836,687.75,728],[0,0,0]],[[41815,1489.04,835],[16572,2375.96,1739],[10809,2682.31,2444],[9336,3223.24,3184],[7684,3434.34,3630],[6116,3347.98,3670],[8153,5304.94,5842],[7285,5440.59,5887],[7753,6596.23,7043],[7834,7402.67,7617]]],"fg3m":[[[288342,3408.99,5525],[27176,3805.21,4316],[18065,4475.97,4775],[9795,3326,3482],[7913,3561.22,3786],[9666,5320.4,5688],[5724,3595.54,3783],[7,4.95,3],[0,0,0],[0,0,0]],[[46983,2095.15,1763],[24196,3563.61,3237],[14037,3399.92,3232],[13853,4865.24,5046],[11240,4998.35,5098],[6646,3619.11,3660],[9473,6242.52,6549],[12538,9351.46,9538],[7655,6436.84,6534],[983,904.4,909]]]},"s12":{"pts":[[[445357,3172.3,4577],[23877,3406,3885],[14154,3463.03,3941],[10389,3600.2,3973],[7957,3559.7,3976],[7071,3864.34,4224],[6638,4304.8,4583],[5949,4432.7,4596],[5750,4876.72,4945],[3411,3184.13,3187]],[[97778,2684.34,1176],[25635,3685.36,2574],[16873,4142.42,3708],[12932,4480.77,4515],[11629,5192.55,5605],[10443,5726.2,6295],[9992,6467.48,7150],[10772,8082.43,8688],[12461,10587.78,11096],[24423,23441.77,23648]]],"reb":[[[321178,2877.41,3895],[21204,3024.72,3264],[12126,2935.43,3273],[7763,2707.31,3223],[5882,2627.37,3120],[6162,3380.47,3911],[2656,1698.1,1996],[3724,2807.15,3163],[1814,1488.6,1600],[0,0,0]],[[130510,3301.83,1778],[32479,4666.14,3648],[21394,5282.71,4782],[17407,6015.09,6058],[15021,6724.77,7130],[12475,6821.17,7340],[14462,9391.55,10240],[12983,9693.35,10517],[15749,13422.48,14117],[17139,16221.23,16500]]],"ast":[[[345002,3727.71,3049],[25355,3615.19,3545],[15216,3706.05,3918],[9697,3360.11,3721],[6658,2968.11,3379],[6067,3326.2,3802],[3647,2346.67,2616],[3453,2588,2838],[1420,1165.68,1246],[0,0,0]],[[31234,1151.57,620],[12666,1827.06,1286],[8423,2084.77,1847],[6825,2349.74,2324],[6184,2770.34,2869],[5067,2771.45,3033],[5894,3827.81,4193],[5112,3817.36,4108],[6537,5578.58,5936],[6144,5774.15,5925]]],"fg3m":[[[312017,3651.93,5723],[29581,4146.28,4589],[19228,4753.95,5103],[10413,3535.43,3853],[8583,3859.6,4285],[10350,5688.98,6110],[6036,3796.24,3919],[9,6.35,7],[0,0,0],[0,0,0]],[[33343,1486.25,1140],[17171,2553.3,2286],[9466,2279.2,2087],[10388,3663.96,3726],[8021,3555.94,3536],[4265,2316.99,2321],[7031,4655.13,4794],[9790,7295.67,7361],[4416,3696.39,3738],[320,294.52,290]]]},"s18":{"pts":[[[343985,2819.67,4081],[22593,3232.89,3802],[14114,3464.25,3967],[10709,3715.67,4207],[8748,3918.1,4310],[7989,4371.84,4525],[7370,4778.46,4950],[7051,5267.64,5315],[7202,6111.9,6116],[4919,4602.84,4512]],[[68620,1849.19,922],[17681,2536.57,1922],[11605,2853.74,2624],[8949,3106.81,3158],[7928,3543.18,3720],[7145,3912.94,4259],[7105,4606.5,4932],[7607,5700.91,6002],[8643,7351.54,7644],[19251,18512.01,18503]]],"reb":[[[243773,2625.93,2930],[20296,2891.13,3373],[12688,3088.45,3637],[9436,3292.92,3896],[6807,3024.1,3547],[7011,3854,4435],[4572,2945.7,3389],[5494,4130.6,4492],[2827,2328.26,2439],[0,0,0]],[[95311,2408.48,1339],[23475,3384.68,2728],[15261,3776.59,3543],[12271,4233.77,4200],[11044,4956.97,5192],[8924,4874.11,5051],[10452,6788.55,7365],[9110,6793.81,7092],[11973,10219.01,10643],[12970,12264.58,12398]]],"ast":[[[266548,3267.89,2579],[24669,3516.02,3538],[14110,3434.62,3682],[9459,3284.97,3739],[6846,3048.61,3504],[6382,3495.71,3957],[4254,2741.17,3009],[3762,2817.58,3062],[1642,1352.15,1430],[1,0.9,1]],[[21288,800.75,405],[8743,1258.84,944],[5972,1476.43,1351],[4633,1593.17,1535],[4459,2002.48,2098],[3434,1873.69,2029],[4157,2704.09,2928],[3521,2625.1,2777],[4813,4117.26,4306],[4412,4146.1,4234]]],"fg3m":[[[243082,3254.66,4994],[26095,3676.34,4510],[18046,4463.87,5062],[10574,3613.68,4062],[9685,4352.63,4781],[10224,5606.94,5885],[5865,3696.14,3728],[16,11.27,12],[0,0,0],[0,0,0]],[[21235,934.59,735],[11100,1668.56,1503],[5566,1329.98,1217],[7279,2579.14,2599],[5224,2311.4,2247],[2400,1299.38,1274],[4655,3098.87,3133],[6999,5199.39,5182],[2651,2213.05,2145],[183,168.4,164]]]},"s24":{"pts":[[[353747,2966.26,4309],[24585,3525.33,4169],[15452,3800.52,4369],[11567,4008.57,4336],[10099,4518.61,4698],[8936,4890.64,5052],[8493,5505.05,5571],[8201,6137.05,6159],[8138,6905.45,6797],[5801,5431.32,5284]],[[34346,961.8,585],[9134,1310.58,992],[5971,1469.65,1340],[4778,1659,1649],[4045,1810,1888],[3673,2012.74,2144],[3743,2425.68,2549],[3984,2983.34,3103],[4507,3832.54,3943],[9864,9473.01,9436]]],"reb":[[[264961,2974.01,3229],[23581,3363.4,3815],[14854,3630.28,4231],[11250,3915.59,4495],[8279,3687.4,4299],[8405,4617.87,5312],[6162,3981.1,4439],[6747,5060.57,5452],[3146,2592.69,2702],[0,0,0]],[[53630,1439.49,775],[14158,2041.24,1574],[9299,2302.56,2060],[7169,2464.58,2484],[6906,3101.72,3130],[5228,2850.49,2916],[6479,4214.58,4398],[5264,3922.71,4074],[7438,6367.83,6554],[6585,6188.31,6201]]],"ast":[[[262647,3328.34,2618],[25400,3607.95,3584],[13942,3407.43,3750],[10039,3485.37,4089],[7806,3477.31,3941],[6470,3541.51,3986],[4345,2797,3117],[3742,2800.9,3055],[1611,1327.71,1403],[0,0,0]],[[8652,355.49,144],[4220,614.15,426],[2856,712.33,589],[2228,763,710],[2343,1052.95,1094],[1570,853.74,857],[2182,1422.82,1509],[1653,1228.59,1283],[2546,2185.88,2297],[1717,1602.3,1622]]],"fg3m":[[[242146,3327.58,5073],[27216,3856.22,4713],[18441,4550.79,5165],[12204,4203.2,4726],[11244,5038.35,5361],[10165,5555.68,5624],[4850,3057.23,3008],[14,9.9,10],[0,0,0],[0,0,0]],[[7984,356.69,260],[4711,718.62,598],[1887,444.84,340],[3493,1243.45,1192],[2178,957.36,875],[596,319.67,278],[2359,1583.26,1553],[3322,2455.27,2366],[594,493.47,476],[24,21.89,21]]]},"s30":{"pts":[[[396333,3098.09,4903],[25548,3660.81,4415],[16009,3928.81,4364],[12400,4301.51,4601],[10426,4659.22,4777],[9330,5108.87,5100],[8841,5730.68,5676],[8378,6267.66,6051],[8092,6857.41,6557],[4647,4343.45,4153]],[[6953,228.29,132],[2367,339.93,266],[1554,383.95,364],[1245,430.9,425],[1088,487.16,513],[992,542.81,559],[972,630.54,657],[1078,808.06,834],[1226,1044.16,1052],[2374,2276.44,2259]]],"reb":[[[314720,3468.05,3846],[27351,3899.13,4532],[16665,4071.24,4738],[12536,4354.23,5016],[9893,4411.87,5041],[9326,5113.82,5711],[7451,4810.08,5237],[6394,4778.88,5000],[2280,1878.08,1906],[0,0,0]],[[18863,550.24,292],[5631,822.65,597],[3657,912.83,778],[2763,947.58,889],[2951,1324.74,1246],[1920,1044.7,1013],[2783,1811.07,1821],[1964,1458.79,1449],[3183,2733.48,2718],[1892,1760.97,1723]]],"ast":[[[281983,3376.67,2709],[24469,3463.78,3512],[14027,3438.5,3837],[10318,3572.1,4024],[7211,3209.52,3576],[5535,3022.99,3337],[3758,2426.26,2665],[2715,2021.53,2152],[751,618.75,627],[0,0,0]],[[838,38.93,19],[585,86.59,42],[488,123.24,90],[302,102.53,101],[474,212.88,208],[208,113.3,102],[443,288.42,315],[208,153.47,164],[557,478.84,489],[191,176.23,178]]],"fg3m":[[[260627,3261.47,4963],[26169,3739.22,4453],[17929,4431.29,4890],[14319,4959.34,5233],[10819,4816.23,4838],[6647,3607.28,3413],[2104,1322.74,1229],[5,3.56,4],[0,0,0],[0,0,0]],[[1115,50.69,32],[848,130.47,99],[197,45.72,26],[801,284.01,238],[280,121.25,98],[44,23.51,16],[623,418.45,403],[534,390.78,372],[45,37.07,32],[1,0.92,1]]]},"s36":{"pts":[[[423061,2615.66,4860],[21233,3042.49,3757],[13296,3261.79,3633],[10346,3584.45,3744],[8771,3921.05,3854],[7862,4304.37,4113],[6824,4419.32,4040],[5953,4443.34,4084],[4395,3712.98,3401],[1988,1854.94,1769]],[[272,9.65,4],[124,18.08,12],[90,21.95,15],[72,25.19,20],[63,28.36,21],[70,38.29,30],[54,35.39,30],[70,52.19,46],[75,63.88,66],[169,161.73,154]]],"reb":[[[351510,3409.13,4148],[26108,3726.82,4342],[15711,3853.05,4426],[11787,4079.29,4668],[9010,4018.77,4332],[7680,4196.92,4436],[5239,3375.58,3460],[3179,2364.38,2307],[920,756.98,722],[0,0,0]],[[1993,73.12,29],[944,139.19,96],[632,158.79,127],[460,156.62,124],[602,270.4,264],[334,180.15,158],[552,360.78,350],[340,250.93,228],[674,580.34,572],[286,263.28,250]]],"ast":[[[298001,3008.81,2716],[20077,2859.69,3091],[11954,2918.71,3326],[7543,2598.33,2919],[4912,2184.7,2417],[3161,1723.15,1836],[1925,1236.51,1323],[769,567.52,568],[156,128.07,138],[0,0,0]],[[14,0.74,0],[18,2.99,2],[13,3.44,4],[14,4.61,5],[25,11.3,11],[6,3.3,3],[28,18.06,20],[12,8.6,6],[36,31.12,28],[3,2.76,3]]],"fg3m":[[[278043,2741.65,4547],[23538,3407.53,4077],[16372,4015.65,4264],[10571,3631.14,3567],[4826,2129.29,1968],[1632,874.73,803],[239,149.92,132],[0,0,0],[0,0,0],[0,0,0]],[[32,1.58,1],[40,6.1,5],[4,0.86,1],[49,17.27,14],[7,3.02,3],[0,0,0],[40,26.95,28],[25,18.27,14],[1,0.8,1],[0,0,0]]]},"s42":{"pts":[[[449866,1882.83,3400],[15546,2221.54,2447],[9351,2289.08,2238],[6707,2316.09,2230],[5146,2299.72,2220],[4154,2270.98,2139],[3245,2094.29,1970],[2249,1676.17,1585],[1371,1154.81,1102],[402,372.58,351]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"reb":[[[381953,2808.84,3093],[19755,2806.29,3030],[10673,2611.69,2911],[7092,2448.26,2721],[5120,2281.66,2465],[3209,1743.75,1830],[1771,1137.27,1199],[910,674.9,701],[179,146.44,154],[0,0,0]],[[42,1.03,0],[14,2.1,2],[9,2.37,0],[5,1.59,1],[16,7.02,7],[1,0.54,0],[22,14.28,11],[2,1.51,1],[19,16.14,14],[2,1.83,2]]],"ast":[[[319697,2338.81,1986],[14123,1989.25,2155],[6489,1575.55,1878],[3458,1188.88,1327],[1992,878.49,973],[803,433.91,472],[217,137.98,158],[23,16.75,18],[1,0.82,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"fg3m":[[[303075,2233.27,3368],[17489,2508.87,2863],[8686,2094.12,2088],[2995,1010.74,1009],[569,246.48,232],[83,44.17,40],[10,6.22,6],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]]},"rep":{"pts":[[[180773,1776.91,2230],[15036,2125.6,2531],[8645,2155.74,2585],[9032,3147.13,3637],[4391,1956.96,2145],[4838,2661.44,2806],[6468,4203.96,4447],[4269,3127.51,3238],[53,42.83,40],[0,0,0]],[[154547,4222.18,1875],[40522,5859.68,4067],[27598,6751.23,5939],[19615,6798.82,6957],[19883,8901.4,9866],[17282,9458.37,10702],[14604,9443.46,10631],[17140,12905.99,14133],[23133,19655.39,20700],[28727,27362.13,27809]]],"reb":[[[90087,1119.5,1371],[7200,1061.99,1420],[6556,1564.31,1903],[2390,840.24,1084],[3665,1655.66,1948],[5272,2897.28,3404],[1182,728.27,831],[0,0,0],[0,0,0],[0,0,0]],[[181531,4636.16,2678],[47261,6764.16,5308],[30676,7589.25,7013],[26976,9345.59,9469],[21269,9496.97,10072],[17798,9740.75,10628],[21036,13674.39,15051],[22547,16874.46,18476],[22787,19333.9,20488],[22039,20896.93,21321]]],"ast":[[[184522,2601.95,2032],[19047,2749.21,2733],[13216,3198.56,3538],[8339,2909.3,3341],[7884,3523.97,3920],[6570,3589.22,3956],[1292,796.13,853],[0,0,0],[0,0,0],[0,0,0]],[[54495,1867.16,1087],[21302,3033.15,2307],[13244,3311.18,3032],[12697,4390.53,4347],[8971,4000.34,4248],[7358,4028.14,4351],[10476,6816.59,7492],[10583,7908.18,8609],[9808,8318.4,8828],[7900,7452,7603]]],"fg3m":[[[152987,2118.42,3682],[16971,2352.99,3089],[11942,2976.67,3723],[6952,2347.94,2769],[5821,2620.26,3025],[7636,4208.09,4600],[5064,3185.04,3424],[11,7.73,7],[0,0,0],[0,0,0]],[[58058,2608.65,2383],[30957,4519.3,4186],[19006,4624.64,4546],[16788,5881,6098],[14278,6362.8,6553],[9816,5342.96,5539],[11344,7437.44,7797],[15220,11370.69,11806],[11730,9906.83,10102],[3123,2887.18,2895]]]}};
/**
* Coefficients from the built-in lessons plus whatever this phone has graded since (dev = patEmpty()
* sums). With nothing new graded this is exactly the built-in set.
*/
// How each team's points still to come really ran against the sum of our player numbers, per stage:
// [team-games graded, sum of our points still to come, sum of the real ones]. Learned with every other lesson applied.
const TEAM_PRIOR = {"pre":[7418,836509,831601],"s6":[7418,723451,727481],"s12":[7418,617682,621313],"s18":[7418,517815,523104],"s24":[7418,407485,413557],"s30":[7418,300767,308098],"s36":[7418,197931,202147],"s42":[7418,102992,106041],"rep":[7418,831574,831601]};
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
// how far to trust "games where he was also on the floor (or sitting) at this minute" over his plain rotation map:
// little early in the game (the coach's usual pattern says more), almost fully in the last six minutes (who is out there
// now is the closing group). Measured on finished games: one fixed value was a compromise that was wrong at both ends.
const rk = TUNE.rotKEarly > 0 ? (el <= TUNE.rotKFrom ? TUNE.rotKEarly : el >= TUNE.rotKTo ? TUNE.rotKLate : TUNE.rotKEarly * Math.pow(TUNE.rotKLate / TUNE.rotKEarly, (el - TUNE.rotKFrom) / (TUNE.rotKTo - TUNE.rotKFrom))) : TUNE.rotK;
const wm = match.length / (match.length + rk);
let rPre = wm * (match.length ? mean(match.map(pre)) : 0) + (1 - wm) * mean(rotG.map(pre));
let rQ4 = wm * (match.length ? mean(match.map(post)) : 0) + (1 - wm) * mean(rotG.map(post));
const expSoFar = mean(rotG.map((x) => onBetween(x.st, 0, el)));
let tonight = 1;
const rtE = TUNE.rotTonightEarly > 0 && el < 18 ? TUNE.rotTonightEarly : TUNE.rotTonight;
if (rtE > 0 && el >= 3) tonight = Math.pow((Math.max(r.min, 0) + TUNE.rotTonightK) / (Math.max(expSoFar, 0) + TUNE.rotTonightK), rtE);
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
// who takes the refill: teammates the layer did not cut. refillSoft 0 = the old fixed cut-off (a factor of 0.97 or more, all
// or nothing: a player sitting right at it flipped in and out, and his number jumped about a point with nothing happening);
// 1 = a ramp from 0.90 to 1.00
const refillW = (p) => (p.r.ejected || p.r.pf >= 6 ? 0 : TUNE.refillSoft > 0 ? clamp((p.pat.F.min.f - 0.9) / 0.1, 0, 1) : p.pat.F.min.f >= 0.97 ? 1 : 0);
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
for (const p of ps) { const w = refillW(p); if (w > 0) room += w * p.mins[i] * Math.max(left - p.mins[i], 0); }
if (room > 0) { const add = give * (5 * left - tot); for (const p of ps) { const w = refillW(p); if (w > 0) p.mins[i] = Math.min(left, p.mins[i] + (add * w * p.mins[i] * Math.max(left - p.mins[i], 0)) / room); } }
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
