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
patLamLineup: 0.1, patLamAnchor: 0.1, // pull toward "no effect" for the lineup inputs, relative to the other inputs (1 = same; lower lets rare, strong signals through)
condMin: 1, // before tip-off, player minutes stay "if he plays" numbers and the team total is scaled to five players' worth instead
teamCal: 2, // apply the learned team check (TEAM_PRIOR) to team totals: 0 = off, 1 = every stage, 2 = during games only (before tip-off the scoring level moves between seasons)
teamCalW: 0.5, // share of the check applied during games (with teamCal 2), fading to none from 33 to 42 minutes in. Measured Nov 11: live totals ran 2.5 to 5.7 points low on two unseen sets; half the check brought the total 2 to 3% closer through Q3 on 592 games and 0 to 2% on 121, the full check went past the middle on the smaller set
// team load (also v15, lab name "v16"): how crowded tonight's rotation is, and which side is expected to win big, as learned inputs
loadIn: 1, loadMid: 0.06, // team load = the usual minutes of everyone available tonight, added up, vs the 240 a team can play; loadMid = a typical night
favIn: 1, // expected winning margin by role (starters of a team expected to win or lose big, bench of a team expected to lose big)
loadStats: 0, // 0 = the team load only teaches minutes (who plays), 1 = it also teaches points, rebounds, assists and threes
ctxUntil: 33, // game minute from which the team load and expected margin sit out (by then the live score and rotation say more)
refillSoft: 1, // refill eligibility: 0 = fixed cut-off, 1 = smooth ramp (no jumps when a factor sits at the cut-off)
refillMax: 0.2, refillMaxLive: 0, // most the refill can add to one player, as a share of his own minutes still to come, before tip-off and live (0 = no limit). Before tip-off a badly short-handed team handed one player all 48 minutes; live a limit of 0.35 changed nothing early and cost 0.8% on minutes in the last three minutes, where one closer really does take what is left
startOn: 1, // live: a posted starter the play-by-play has not named yet has been on the floor since the tip (1), or counts as not checked in (0, old)
thinK: 30, // minutes of bench-average rates mixed into the rebound and assist rates of a player with no season line (0 = his raw rates, old)
patHalf: 0, // minutes lessons between halftime and 30 minutes in: 0 = nearest stage (jumps at 27:00), 1 = the 30-minute lessons once the third quarter is on
// Nov 11 research (four researchers on 1,177 unseen games): with real minutes the per-minute numbers are within 0-3% of an
// oracle at every stage, so what is left is minutes. The minutes numbers were too spread out everywhere (real = a + b x number
// with b 0.70 to 0.90) and the learned layer could only multiply, not pull a number toward what a role normally plays.
anchIn: 1, // anchor inputs for minutes: anchor / remaining minutes (a flat number of minutes once multiplied), for everyone, by role, on the floor, his pace tonight, lopsided scores, his own average, his season average
flagIn: 1, // late game: who is on the floor in a decided game (the unit's usual minutes), deep bench in lopsided games, a starter's long stint
condLive: 1, // a player who has not checked in yet keeps an "if he plays" number during the game too (a pick on a player who never plays is no action): never-in players are not learned from and team totals are scaled instead of squeezing every player
patCapMinLate: 0.95, // most the layer can cut remaining minutes from 36 minutes in (a regular on the bench of a decided game is done for the night)
refillRep: 0, // refill before the lineup is posted: 0 = off (measured: none of those handed-out minutes are played), 1 = as at tip-off
deepRep: 1, // before the lineup is posted, deep-bench players of the recent window who are not listed out get a number too (they were 2 of 3 players with no number who went on to play 10+)
benchRes: 1, // the 'benched' discount (sitting through minutes he usually plays) is for tonight's starters only; a reserve's usual pattern comes from other roles
foulEdge: 1, // a foul-trouble seat still counts as one at the exact end of its rest window (halftime with 3 fouls)
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
// tied when the fourth quarter (or an overtime) ends: five more minutes are certain, so the break already counts as the start of overtime
if (phase === 'live' && period >= 4 && clockSec(clock) === 0 && vs === hs && vs + hs > 0) { period += 1; clock = '5:00'; }
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
// the scoreboard is already in a new period but none of its events has arrived: until one says otherwise, the five who closed
// the last period are still on the floor (the same picture as the break)
if (pers.length && !byPer.has(curPeriod) && curPeriod > pers[pers.length - 1]) for (const id of prevEnd) onNow.add(id);
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
'loadS', 'loadB', 'loadBd', 'loadBq', 'favS', 'dogS', 'dogB',
// anchors and late-game floor picture (Nov 11): minutes only
'aAll', 'aS', 'aB', 'aOn', 'aPace', 'aLop', 'aOwn', 'aLong', 'lopTier', 'flagOff', 'flagOn', 'deepLop', 'stintLong'];
const PAT_MINONLY = ['aAll', 'aS', 'aB', 'aOn', 'aPace', 'aLop', 'aOwn', 'aLong', 'lopTier', 'flagOff', 'flagOn', 'deepLop', 'stintLong'];
const PAT_D = PAT_F.length;
const PAT_IX = Object.fromEntries(PAT_F.map((k, i) => [k, i]));
// How hard each input is pulled toward "no effect" when the lessons are solved, relative to the others (1 = the usual pull).
// The lineup inputs are rare but strong (about one reserve a game starts), so the usual pull would flatten them.
// how hard each input is held near zero while learning (1 = the usual hold; lineup and anchor inputs get a light one)
const patLamOf = (k) => (TUNE.patLamLineup > 0 && ['startUp', 'startDown', 'fresh', 'deep'].includes(k) ? TUNE.patLamLineup : TUNE.patLamAnchor > 0 && PAT_MINONLY.includes(k) ? TUNE.patLamAnchor : 1);
const PAT_LAMF = PAT_F.map(patLamOf);
// stages of the game: pregame, then every 6 game minutes (the learned trust in live data changes with each)
// 'rep' (v15) = before the lineups are posted, when only the injury report is known: the app knows less then, so it learns that moment separately
const PAT_GROUPS = ['pre', 's6', 's12', 's18', 's24', 's30', 's36', 's42', 'rep'];
// features that describe a shift of shots between teammates (shared inside the team when TUNE.shiftCenter is on)
const PAT_SHIFT = ['track', 'shooting', 'uReal', 'luck', 'recent', 'fadeHist'];
// The number we show. The average of the simulations is pulled up by rare big finishes; the middle of them is where a player
// most often lands. How much of the middle to show at each stage was learned on last season (595 games) and checked on this
// season's 123 games: average miss from the end of Q3 fell 3% on points, 13% on assists, 22% on threes (6 minutes left: 12%, 23%, 32%).
// (Nov 11: a quarter of the middle for points in the first quarter too, fitted on 592 unseen games with the minutes-pace input
// coming in from 6:00: points 4.416 -> 4.407 and 4.148 -> 4.137; on this season's 121 games 4.332 -> 4.324 and 4.133 -> 4.123)
const LAND = { pre: { fg3m: 1 }, s6: { pts: 0.25, fg3m: 1 }, s12: { pts: 0.25, ast: 0.25, fg3m: 1 }, s18: { ast: 0.5, fg3m: 1 }, s24: { pts: 0.25, ast: 1, fg3m: 1 },
s30: { pts: 0.75, reb: 0.25, ast: 1, fg3m: 1 }, s36: { pts: 1, reb: 1, ast: 1, fg3m: 1 }, s42: { pts: 1, reb: 1, ast: 1, fg3m: 1, min: 1 }, rep: { fg3m: 1 } };
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
// back from a layoff: once he is on the floor or has played he is no longer an unknown; and the 6-minute lesson ("still not in
// after six minutes: he is probably not playing") comes on gradually from the tip instead of at the first second
b[PAT_IX.fresh] = f.fresh && !(live && (f.on || f.min > 0)) ? (live && f.el < 6 ? clamp(f.el / 6, 0.15, 1) : 1) : 0; b[PAT_IX.deep] = f.deep ? 1 : 0;
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
// anchors: an input equal to (anchor minutes) / (his remaining minutes) becomes a flat number of minutes once the layer multiplies
// it by his remaining minutes, so the layer can pull a number toward the anchor instead of only scaling it
if (TUNE.anchIn > 0 && f.rem >= 0.25) {
const L = live ? 0.5 * Math.max(f.left || 0, 0) : 24; // half of the time left (24 before tip-off)
const a = clamp(L / f.rem, 0, 6);
const startsT = f.sT != null ? f.sT === 1 : !!f.starter;
b[PAT_IX.aAll] = a; b[PAT_IX.aS] = startsT ? a : 0; b[PAT_IX.aB] = f.mpg < 18 ? a : 0;
if (live) {
b[PAT_IX.aOn] = f.on ? a : 0;
// his minutes pace tonight (first-half minutes once the half is over) carried over the time left
const first = f.el <= 24 ? f.min : f.minH1;
// (from 6:00 on, where the 12-minute lesson that carries this input starts to blend in: held back until 12:00 it left minutes
// about a minute low through the back half of Q1 and made them jump at the horn)
b[PAT_IX.aPace] = f.el > 6 && first != null ? clamp((first * (f.left || 0)) / Math.min(f.el, 24) / f.rem, 0, 6) : 0;
const lop = clamp((Math.abs(f.mg || 0) - 8) / 10, 0, 2.5);
b[PAT_IX.aLop] = clamp(lop * (a - 1), -2.5, 6);
b[PAT_IX.lopTier] = f.el >= 18 ? lop * clamp((f.mpg - 24) / 8, -2, 1.5) : 0;
} else {
// before the game: how far the simulation moved him from his own recent average, and his season-long average against the recent one
b[PAT_IX.aOwn] = clamp(f.mpg / f.rem - 1, -0.6, 1.5);
b[PAT_IX.aLong] = f.longMin != null ? clamp((f.longMin - f.mpg) / f.rem, -1.5, 1.5) : 0;
}
}
// late game: the floor picture. A bench unit on the floor of a decided game means the regulars are done (white flag)
if (TUNE.flagIn > 0 && live && f.el >= 30) {
const am2 = Math.abs(f.mg || 0);
const flag = f.unitMin != null ? clamp((am2 - 10) / 10, 0, 1) * clamp((24 - f.unitMin) / 8, 0, 1.5) : 0;
b[PAT_IX.flagOff] = !f.on && f.min > 0 && f.mpg >= 14 ? flag : 0;
b[PAT_IX.flagOn] = f.on && f.mpg < 24 ? flag : 0;
b[PAT_IX.deepLop] = f.mpg < 14 && f.min > 0 ? clamp((am2 - 10) / 10, 0, 2) : 0;
b[PAT_IX.stintLong] = f.starter && f.on && f.stint != null ? clamp((f.stint - 4) / 8, -0.5, 1) : 0;
}
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
else { if (!(TUNE.loadStats > 0)) { x[PAT_IX.loadS] = 0; x[PAT_IX.loadB] = 0; x[PAT_IX.loadBd] = 0; x[PAT_IX.loadBq] = 0; } for (const k of PAT_MINONLY) x[PAT_IX[k]] = 0; } // how crowded the rotation is, and the anchors, only say who plays
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
if (!a || !(a.min > 0)) { if (!live || TUNE.condLive > 0) continue; a = { min: p.now.min, pts: p.now.pts, reb: p.now.reb, ast: p.now.ast, fg3m: p.now.fg3m }; }
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
const topNames = new Set(Object.values(rows).filter((r) => r.pts === top).map((r) => norm(r.name)));
A.g++; if (best.some((p) => ids.has(+p.pid) || (+p.pid < 0 && topNames.has(norm(p.name))))) A.top3++;
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
// everyone who really played 10+ minutes, on the same rule as the built-in report: a player we had no number for counts
// as a full miss (so the phone's own table cannot look better by leaving the hard cases out)
const seen = new Set();
for (const p of proj.players) {
const a = rows[p.pid] || rowByName(rows, p);
if (!a) continue;
seen.add(a);
if (!(a.min >= 10)) continue;
A.n++;
for (const s of PAT_STATS) A[s] += Math.abs(p.proj[s] - a[s]);
}
for (const a of Object.values(rows)) {
if (seen.has(a) || !(a.min >= 10) || (a.team !== proj.state.v && a.team !== proj.state.h)) continue;
A.n++;
for (const s of PAT_STATS) A[s] += Math.abs(a[s] || 0);
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
PAT_F.forEach((k, i) => { PAT_LAMF[i] = patLamOf(k); });
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
const PAT_PRIOR = {"pre":{"min":{"b":[-0.09697,-0.02393,-0.01434,-0.00213,-0.02492,-0.0183,0.0076,0.00972,0.0051,0.00098,0.0043,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.01405,0,0,0,-0.02911,0,0,0,0,0.22695,-0.09642,-0.14482,0.10887,0.02968,0.02079,0.00235,-0.02943,-0.00937,-0.02143,-0.05567,0.0042,-0.01913,-0.00111,0.01081,0.07809,0.13104,-0.0111,0,0,0,0.64688,0.20747,0,0,0,0,0],"d":[43800000,35900000,2830000,7770000,23700000,3130000,13000000,8860000,7320000,21800000,6580000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,17800000,0,0,0,45100000,0,0,0,0,641000,1280000,373000,165000,11700000,10800000,2320000,2280000,52000000,13200000,3090000,1030000,19000000,18300000,4460000,40300000,20700000,10300000,0,0,0,929000,1330000,0,0,0,0,0],"n":72065,"w":43800000},"pts":{"b":[0.00377,-0.00094,0.0044,-0.00644,-0.00645,-0.00351,-0.01828,-0.00998,0.00672,-0.00143,0.00166,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02798,0,0,0,0.02613,0,0,0.14521,0,-0.01952,0.03588,-0.08471,-0.05461,0.00641,-0.00616,0.00472,-0.00635,0,0,0,0,-0.00341,0.00153,0.00391,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[11700000,9950000,599000,2080000,6040000,828000,2950000,2240000,1970000,5880000,1770000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7310000,0,0,0,13800000,0,0,1070000,0,265000,152000,86700,69500,2940000,2520000,622000,636000,0,0,0,0,5790000,4290000,991000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":72043,"w":11700000},"reb":{"b":[-0.03502,-0.01964,0.01966,-0.00958,0.03069,0.00273,-0.00319,0.01578,-0.00478,-0.0038,-0.00681,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.00044,0,0,0,0.01585,0,0,0.09581,0,-0.01782,-0.028,-0.02583,-0.02281,-0.00111,-0.0195,0.01615,-0.00688,0,0,0,0,0.02257,-0.00656,-0.0189,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[1850000,1390000,178000,327000,988000,130000,519000,353000,286000,922000,278000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,780000,0,0,0,1860000,0,0,169000,0,71000,34000,11300,16000,378000,441000,97100,101000,0,0,0,0,762000,632000,255000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":71654,"w":1850000},"ast":{"b":[-0.04575,-0.00095,-0.00644,-0.02246,0.05912,-0.00687,0.00108,0.0542,-0.01468,0.01482,0.01994,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.00982,0,0,0,0.01764,0,0,0.07848,0,0.03525,-0.03561,0.03447,-0.01443,0.00126,-0.01608,-0.00853,-0.01163,0,0,0,0,0.0283,-0.01657,-0.01325,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[741000,628000,37500,130000,350000,51500,182000,109000,123000,368000,113000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,427000,0,0,0,877000,0,0,71200,0,14100,10800,4540,3390,188000,154000,40600,38300,0,0,0,0,353000,255000,59600,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":70042,"w":741000},"fg3m":{"b":[-0.00884,-0.00892,-0.01991,-0.01231,-0.01454,0.00409,-0.00679,-0.05624,0.0111,0.01516,0.01228,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02522,0,0,0,0.02356,0,0,0.13585,0,-0.02154,0.03552,-0.07763,-0.1,0.00228,-0.00287,-0.00052,-0.0477,0,0,0,0,-0.0058,0.00991,0.00833,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[149000,117000,11000,26800,78000,10600,41600,35800,24300,74400,22500,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65900,0,0,0,153000,0,0,13600,0,4670,2720,1130,1270,46800,34800,8140,8310,0,0,0,0,66300,54800,16700,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":60612,"w":149000}},"s6":{"min":{"b":[-0.22877,-0.08653,0.00137,0,-0.01915,-0.03082,0.01429,0.00958,0.00588,-0.00527,-0.00124,0.01573,0.00694,-0.00079,-0.00739,-0.01957,0.00188,-0.01345,-0.00469,0.01859,0.0167,-0.00186,-0.12486,-0.02089,-0.00445,0.02085,0.01627,0.00092,0.00146,0.0459,0,0.00151,0,0,0.10612,-0.0066,-0.14133,0.02778,0.01659,0.02746,0.00234,-0.04961,0.00045,0.03325,-0.06042,0.0474,-0.01228,-0.0071,0.00518,0.31497,-0.02137,-0.05549,0.19392,0,0.04841,0,0,0,0,0,0,0],"d":[33000000,26300000,2460000,0,18000000,1600000,9830000,7160000,5330000,16400000,4960000,32300000,565000,66100000,12600000,1580000,5270000,12300000,17000000,365000,365000,225000,22500000,139000,6330000,13200000,10900000,51500000,12000000,33500000,0,167000,0,0,562000,866000,117000,104000,8950000,8160000,1730000,1760000,38900000,11000000,2480000,923000,13700000,13500000,3700000,30900000,15900000,7930000,15900000,0,119000,0,0,0,0,0,0,0],"n":72148,"w":33000000},"pts":{"b":[-0.02452,-0.00662,0.00952,0,-0.00921,-0.04783,-0.01901,-0.00415,0.00885,-0.00013,0.00373,0.00713,0.03085,-0.00022,0.00407,-0.01621,0.00554,-0.01084,-0.01176,-0.03216,0.04142,0.00221,-0.00754,-0.00103,-0.01769,-0.02545,0.00728,-0.02858,-0.00522,0.03544,0,-0.02541,0.14306,-0.04465,-0.02348,0.01272,-0.07768,-0.08786,0.01139,-0.0058,0.00669,-0.02507,0,0,0,0,-0.00158,0.00767,0.01453,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[8550000,7030000,545000,0,4370000,411000,2200000,1740000,1390000,4290000,1290000,9240000,148000,17000000,3250000,320000,1990000,3400000,5170000,117000,80700,50800,6160000,36800,1240000,5210000,4310000,13200000,3350000,9960000,0,46800,925000,2400000,162000,147000,22300,49100,2140000,1860000,455000,485000,0,0,0,0,4100000,3000000,819000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":72113,"w":8550000},"reb":{"b":[-0.06453,-0.02379,0.02463,0,0.03614,0.00657,-0.00338,0.01329,-0.0068,-0.00182,-0.0031,-0.00249,0.01572,0.00945,0.00383,0.00794,0.01154,-0.01337,-0.01298,0.00174,0.01352,-0.01233,-0.01277,0.0013,-0.00693,0.00678,-0.00282,-0.02708,0.01631,0.02514,0,-0.01677,0.08421,-0.00863,-0.02145,-0.00411,-0.05218,-0.02653,0.00687,-0.01876,0.02354,-0.0205,0,0,0,0,0.02081,-0.01236,-0.01708,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[1360000,969000,160000,0,726000,63700,390000,278000,198000,676000,204000,547000,27500,2710000,512000,63900,224000,520000,622000,14600,11600,12100,914000,6120,272000,563000,466000,2090000,509000,1370000,0,6400,149000,394000,44900,32200,3740,10700,280000,329000,71100,79000,0,0,0,0,521000,445000,209000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":71683,"w":1360000},"ast":{"b":[-0.07213,-0.00319,0.00592,0,0.05875,0.0002,0.00301,0.0543,-0.02138,0.01255,0.02092,-0.01169,0.01316,0.01116,-0.00055,0.02612,0.00803,0.0013,0.00132,0.01119,-0.00214,0.00812,-0.02277,-0.02025,-0.01954,0.00929,0.00206,-0.02345,0.00353,0.0167,0,0.01214,0.06026,-0.02219,0.00504,-0.00268,0.04313,-0.065,0.00387,-0.01783,-0.00689,-0.01086,0,0,0,0,0.03273,-0.01716,-0.01655,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[541000,443000,33900,0,255000,24400,136000,84900,87500,269000,82300,212000,8830,1070000,202000,20100,104000,216000,311000,6600,5300,3210,389000,2160,79000,303000,252000,841000,212000,632000,0,2580,61300,150000,8570,10400,1150,2380,138000,114000,29600,29000,0,0,0,0,245000,180000,49900,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":70083,"w":541000},"fg3m":{"b":[-0.07202,-0.02396,-0.01407,0,-0.01085,-0.02534,-0.00766,-0.03994,0.01478,0.02105,0.01457,0.03395,0.00753,-0.00018,0.00608,-0.01314,0.00214,-0.00411,0.00064,-0.02851,0.02984,0.00058,0.00768,0.0012,0.01279,-0.02276,0.00475,-0.02865,-0.01859,0.03156,0,-0.00612,0.13623,-0.05149,-0.03684,0.03807,-0.12157,-0.14118,0.00169,-0.00126,-0.00364,-0.06014,0,0,0,0,-0.00103,0.02099,0.01957,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[112000,84600,9990,0,58000,5560,31900,27900,17700,56000,16900,19700,1690,223000,43200,5640,19800,38400,62900,1440,1010,939,75400,406,23700,47700,39400,177000,37600,113000,0,615,12100,32000,2770,2620,387,874,34600,26500,6130,6580,0,0,0,0,48000,39000,14000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":60464,"w":112000}},"s12":{"min":{"b":[-0.27048,-0.06519,-0.03084,0,-0.01476,-0.03238,0.01269,0.0061,0.01,-0.00649,-0.00217,0.01252,-0.00857,-0.00205,-0.01513,-0.02311,-0.00781,0.0036,0.00774,0.01289,0.0309,-0.01855,-0.10409,0.00607,-0.03802,0.02335,0.00576,0.00276,-0.01757,0.02291,-0.00393,-0.00264,0,0,0.1438,-0.08128,-0.13525,-0.00831,0.01467,0.02577,0.00371,-0.04501,0.00056,0.0286,-0.03072,0.03213,-0.01238,-0.00839,0.00415,0.24025,0.0999,-0.02663,0.13969,0.06163,0.12082,0,0,0,0,0,0,0],"d":[24400000,19600000,1810000,0,13200000,1710000,7130000,4990000,4000000,12100000,3660000,32700000,1390000,38800000,19200000,907000,10100000,14500000,19000000,1350000,1380000,894000,13000000,4760000,550000,9720000,6360000,52100000,13000000,25100000,321000,688000,0,0,442000,639000,34400,45500,6950000,5940000,1280000,1350000,27600000,7930000,2070000,580000,10100000,9970000,2690000,22800000,11900000,5950000,11700000,31100000,463000,0,0,0,0,0,0,0],"n":71948,"w":24400000},"pts":{"b":[-0.04998,0.00712,0.00205,0,-0.00915,-0.06237,-0.01279,-0.00397,0.01549,-0.00033,0.00443,0.00986,0.02777,-0.00169,0.01232,-0.05704,-0.00686,0.00236,-0.00715,-0.06947,0.05493,0.01603,0.00731,0.01317,0.0043,-0.02487,-0.0032,-0.01873,-0.01707,0.02707,-0.0065,-0.01728,0.15199,-0.03862,-0.02696,0.00316,-0.06146,-0.05638,0.01167,-0.00242,0.00961,-0.0152,0,0,0,0,-0.00474,0.00774,0.01912,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[6400000,5360000,383000,0,3240000,438000,1610000,1210000,1070000,3210000,965000,8990000,372000,9970000,4970000,209000,3450000,3890000,5510000,448000,292000,179000,3430000,1200000,95500,3980000,2610000,13600000,3470000,7550000,58200,187000,842000,1840000,154000,85100,3990,18300,1690000,1370000,342000,365000,0,0,0,0,3150000,2250000,566000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":71883,"w":6400000},"reb":{"b":[-0.08562,-0.01587,0.00985,0,0.03162,0.00053,-0.0045,0.0154,-0.00026,0.00065,-0.00281,0.00081,0.01604,0.01422,-0.00497,-0.03154,0.00361,0.00497,-0.00664,-0.00082,0.00699,0.00338,0.01061,0.01762,-0.00865,0.00104,-0.00453,-0.01709,0.00108,0.01721,0.00867,-0.02149,0.07506,-0.00132,-0.01445,-0.02119,-0.07412,-0.01175,0.00922,-0.01339,0.0176,-0.00572,0,0,0,0,0.01973,-0.01024,-0.01195,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[1030000,755000,113000,0,547000,68600,289000,197000,155000,511000,154000,618000,67600,1620000,787000,40700,420000,616000,713000,53700,45200,45100,510000,235000,23400,430000,285000,2140000,558000,1050000,11600,25400,139000,307000,43000,19000,776,4050,223000,245000,54300,60200,0,0,0,0,406000,344000,147000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":71366,"w":1030000},"ast":{"b":[-0.10201,-0.00197,-0.00568,0,0.05337,0.00252,0.0107,0.05161,-0.02422,0.00999,0.02263,0.00474,0.01223,0.01449,0.0164,-0.0145,0.00625,-0.00096,-0.00314,-0.01204,-0.02717,-0.00204,-0.00032,0.0036,-0.01298,0.006,-0.01029,-0.0175,0.00578,0.01289,-0.03283,0.01005,0.04567,-0.02472,0.02956,0.00435,0.04785,-0.03451,0.01078,-0.0181,-0.0045,0.00348,0,0,0,0,0.02934,-0.01372,-0.01966,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[409000,342000,23800,0,192000,25800,101000,59800,67800,203000,62200,227000,22200,630000,306000,12400,203000,248000,347000,24600,19300,11200,215000,78400,6030,233000,155000,880000,221000,485000,4620,10800,55900,115000,7800,6060,205,941,110000,85300,22500,22100,0,0,0,0,189000,138000,34300,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":69317,"w":409000},"fg3m":{"b":[-0.07184,-0.00563,-0.01615,0,-0.01442,-0.02518,-0.0013,-0.04252,0.01823,0.02161,0.01612,0.06318,0.0167,-0.00406,0.01097,-0.06355,-0.00861,0.00094,-0.00819,-0.05325,0.03231,0.00188,-0.01826,-0.02591,0.00618,-0.01257,-0.01947,-0.02435,-0.02999,0.02669,-0.00438,0.0117,0.13123,-0.04125,-0.01621,0.02341,-0.07568,-0.10976,0.0006,-0.00067,-0.00595,-0.0576,0,0,0,0,-0.00858,0.02124,0.03325,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[82100,63500,6970,0,42200,5880,22900,19400,13300,41100,12400,27100,4500,127000,65200,3390,36500,48600,72900,5290,3670,3310,44900,15200,1800,35900,23500,178000,43500,84800,996,2350,10800,24100,2690,1490,77.1,306,26800,19200,4510,4870,0,0,0,0,36400,28800,9610,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":58870,"w":82100}},"s18":{"min":{"b":[-0.1861,-0.06725,-0.046,0,0.00849,-0.01995,0.01724,0.00666,-0.00517,-0.01341,-0.00239,0.02268,-0.01302,-0.00057,-0.0326,-0.02852,-0.00756,-0.0113,0.00492,0.01147,0.01941,-0.01372,-0.06617,0.03657,-0.00408,0.02886,0.00514,-0.00368,-0.00012,0.01587,-0.00446,0.00259,0,0,0.09566,-0.08266,0,0,0.00227,0.02188,-0.00029,-0.02934,0.00351,0.02881,-0.01866,0.00668,-0.01909,-0.01772,-0.00117,0.02774,0.08213,0.02243,0.18805,0.13653,0.17059,0,0,-0.00313,0,0,0,0],"d":[6440000,4860000,579000,0,1410000,500000,1450000,1190000,718000,3210000,1040000,9610000,104000,7330000,6940000,198000,3790000,3830000,5840000,585000,604000,605000,3850000,1090000,34100,2480000,1480000,15800000,3560000,5620000,88100,197000,0,0,130000,175000,0,0,2190000,1250000,317000,386000,5810000,3010000,863000,20500,2330000,2200000,943000,5850000,2920000,1600000,2920000,6670000,178000,0,0,1570000,0,0,0,0],"n":26126,"w":6440000},"pts":{"b":[-0.0369,0.00966,-0.00617,0,0.00291,-0.02228,-0.01931,-0.00334,0.00257,0.00691,0.01384,0.0157,-0.0024,-0.00775,-0.00498,-0.04458,-0.01381,-0.01003,-0.00914,-0.06251,0.05812,0.0173,0.01865,0.0277,0.00955,-0.02321,0.00535,-0.01371,-0.02114,0.03137,-0.00272,0.01288,0.07961,-0.05302,0.00189,-0.02419,0,0,0.00955,0.00089,0.00738,-0.01407,0,0,0,0,-0.00467,0.00042,0.00449,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[1620000,1330000,100000,0,343000,118000,315000,272000,185000,811000,265000,2470000,22600,1830000,1660000,40000,1120000,965000,1550000,199000,117000,98000,1040000,238000,3710,996000,607000,4030000,909000,1660000,14900,51800,200000,397000,36200,23200,0,0,509000,278000,81000,99700,0,0,0,0,743000,493000,170000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":26114,"w":1620000},"reb":{"b":[-0.06059,-0.02834,-0.01807,0,0.0415,-0.00771,-0.00352,0.0247,-0.01115,-0.00033,0.00549,0.00747,-0.01242,0.01293,-0.00463,-0.03228,-0.00235,0.01488,-0.00383,0.00496,0.03608,-0.00827,0.00063,0.00183,-0.00419,0.01422,-0.00954,-0.01473,-0.01385,0.0091,0.00986,-0.00964,0.05293,-0.00258,0.00835,-0.00749,0,0,0.00717,-0.01429,0.01828,0.00309,0,0,0,0,0.01796,-0.01187,-0.01402,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[254000,181000,29100,0,54800,17900,56400,42600,27100,126000,40400,182000,4400,290000,255000,8570,154000,161000,213000,20800,18200,24100,159000,41400,1030,104000,64400,608000,146000,220000,3220,6650,32200,64900,10400,4720,0,0,66300,48900,12200,15500,0,0,0,0,89200,72000,41300,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":26039,"w":254000},"ast":{"b":[-0.12444,-0.01634,-0.01177,0,0.05258,0.03827,0.01487,0.07168,-0.02082,0.0189,0.02492,0.00993,-0.00484,0.00832,0.00307,-0.01857,0.00569,0.00657,0.00521,0.02483,0.02868,0.01308,0.01295,0.03608,-0.00086,-0.00857,0.03398,-0.01251,-0.00466,0.0203,-0.04072,0.01357,0.04404,-0.03669,0.0459,0.00023,0,0,0.02404,-0.02065,0.00196,-0.0002,0,0,0,0,0.00718,-0.01725,0.00191,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[109000,88300,6810,0,22700,7170,22000,14700,12300,53600,17800,73300,1410,122000,106000,2610,70600,62500,103000,10500,8780,6290,69800,15300,271,59400,36800,270000,59000,112000,1220,2750,13800,26900,2470,1710,0,0,35500,19200,5510,6270,0,0,0,0,45000,34200,12300,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":25112,"w":109000},"fg3m":{"b":[-0.07883,0.00514,-0.00916,0,0.02279,0.00152,-0.00135,-0.07292,0.01888,0.02432,0.00757,0.09108,0.009,-0.01113,0.00286,-0.06361,-0.00799,-0.03033,-0.0285,-0.02624,0.01565,0.0155,0.00247,0.01793,-0.00269,-0.02925,-0.0083,-0.0097,-0.02055,0.04852,-0.01028,0.0087,0.07121,-0.05045,0.01608,-0.03835,0,0,0.03178,0.00486,-0.05288,-0.04218,0,0,0,0,-0.02322,0.01857,0.02738,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[19900,15200,1720,0,4390,1530,4190,4200,2160,9990,3390,8340,289,22400,21200,616,12400,11700,20800,2310,1400,1690,12600,3060,55.8,9240,5600,50000,11300,17900,257,651,2500,5000,555,374,0,0,7330,3620,1070,1290,0,0,0,0,8050,5730,2710,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":20900,"w":19900}},"s24":{"min":{"b":[-0.1761,-0.06312,-0.04523,0,0.0161,-0.01707,0.01664,0.00994,-0.00199,-0.01195,-0.00039,0.01647,-0.01098,0.00067,-0.03634,-0.00844,-0.01206,-0.00251,0.00924,0.01447,0.00807,-0.01871,-0.05735,0.00096,0,0.02255,0.00615,0.02086,0.00023,0.01385,-0.00211,0.00667,0,0,0.07768,-0.05733,0,0,0.00709,0.01797,-0.00153,-0.02571,0.0084,0.03431,-0.02293,0.00099,-0.02288,-0.01785,0.00565,-0.05139,0.01618,0.03239,0.06679,0.32272,0.23391,0,0,-0.0267,0,0,0,0],"d":[4260000,3080000,431000,0,937000,416000,985000,781000,460000,2130000,689000,6770000,260000,4240000,6050000,159000,2810000,2780000,4150000,550000,560000,740000,2790000,1260000,0,1620000,854000,9980000,2400000,3660000,52000,188000,0,0,91600,117000,0,0,1230000,837000,211000,261000,4270000,2450000,661000,2790,1480000,1380000,694000,3650000,1860000,928000,1870000,4310000,131000,0,0,1530000,0,0,0,0],"n":25391,"w":4260000},"pts":{"b":[-0.0514,0.01913,-0.00486,0,0.00686,-0.01127,-0.02113,-0.00755,0.01105,0.00418,0.00091,0.01821,0.00985,-0.00687,-0.00818,-0.04686,-0.01295,-0.02588,-0.01808,-0.0617,0.05373,0.02339,0.00321,0.01504,0,-0.03654,0.00669,-0.02059,-0.00595,0.03629,-0.0008,0.01605,0.06882,-0.05475,0.00565,-0.04728,0,0,0.01604,0.00165,0.0061,-0.01358,0,0,0,0,-0.00381,-0.00826,0.01226,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[1020000,823000,69900,0,214000,85500,201000,171000,115000,513000,168000,1670000,61400,1010000,1310000,30800,711000,668000,1030000,179000,95700,102000,747000,189000,0,618000,344000,2360000,590000,1030000,8100,43400,141000,221000,24000,15800,0,0,274000,177000,51400,64200,0,0,0,0,457000,299000,115000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":25386,"w":1020000},"reb":{"b":[-0.08481,-0.02551,-0.01327,0,0.05245,-0.00423,0.00417,0.03988,0.00102,0.00113,0.00198,0.00835,0.00321,0.01224,0.00011,-0.0255,-0.00936,0.00292,0.0013,0.00873,0.01462,-0.01199,0.00584,0.01209,0,0.01053,-0.00884,-0.00953,0.00221,0.01899,-0.00567,-0.00911,0.03795,-0.00454,0.02667,-0.03108,0,0,0.01116,-0.01668,0.01183,0.00275,0,0,0,0,0.009,-0.01236,-0.00466,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[163000,113000,20200,0,35100,13300,36800,26900,17100,80800,26100,133000,11000,161000,207000,6900,112000,112000,147000,18900,14900,25200,105000,43600,0,66300,36700,364000,93100,140000,1820,5660,23200,35700,6770,3240,0,0,36700,31600,7970,10000,0,0,0,0,56000,43900,28300,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":25328,"w":163000},"ast":{"b":[-0.12275,-0.00919,-0.01411,0,0.03221,0.02491,0.00701,0.05277,-0.02788,0.01864,0.0232,0.01902,-0.00002,0.01157,0.01931,0.00878,0.00733,0.00459,0.00497,0.01152,0.01483,0.02723,0.00182,-0.01656,0,-0.01348,0.02619,0.00035,0.00758,0.01558,-0.0341,0.02923,0.03982,-0.0314,0.03906,0.02761,0,0,0.0344,-0.0278,-0.005,0.01972,0,0,0,0,0.00415,-0.02617,0.0068,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[69000,55200,4770,0,14300,5100,14200,9320,7720,34200,11400,52500,3870,67500,83000,2020,47800,43900,69500,9260,7200,6240,50100,12800,0,37200,21400,161000,38400,70500,690,2410,9820,14700,1670,1150,0,0,19300,12300,3560,4040,0,0,0,0,28000,21000,8400,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":24282,"w":69000},"fg3m":{"b":[-0.08605,0.01854,-0.01407,0,0.02307,0.02839,-0.00076,-0.04853,0.02991,0.01324,0.00636,0.10731,0.01952,-0.02241,-0.01831,-0.05846,0.00714,-0.03216,-0.05885,-0.01312,0.02712,0.03404,-0.01187,0.01136,0,-0.03652,0.01426,-0.02137,-0.02184,0.04818,0.0098,0.01023,0.04568,-0.02446,0.01891,-0.09448,0,0,0.02542,0.01351,-0.03792,-0.03114,0,0,0,0,-0.02503,0.01455,0.05188,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[12700,9430,1190,0,2770,1130,2710,2640,1340,6390,2180,6450,770,12500,17000,486,8460,8120,14100,2080,1160,1750,8720,3060,0,5800,3220,29800,7380,11300,140,527,1780,2840,363,255,0,0,4020,2320,686,836,0,0,0,0,4980,3460,1830,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":19638,"w":12700}},"s30":{"min":{"b":[-0.19419,-0.0478,-0.05603,0,0.01683,-0.00951,0.01575,0.01384,0.00067,-0.01311,0.0088,0.01997,-0.05404,0.00104,-0.0548,-0.04285,-0.00098,-0.00529,0.00568,0.01099,0.00493,-0.02514,-0.09573,-0.02938,0,0.02929,0.0091,0.01228,0.00408,0.07417,-0.00333,0.00928,0,0,-0.05338,0.06775,0,0,0.01121,0.02087,-0.00078,-0.02117,-0.00399,0.01792,-0.04875,0.00119,-0.02918,-0.01272,0.01145,0.06779,-0.30098,0.04882,0.17311,0.34045,0.13666,0,0,-0.09135,-0.09789,0.02701,0.05148,-0.05127],"d":[2370000,1520000,331000,0,523000,294000,573000,597000,238000,1190000,383000,3760000,55300,2190000,4210000,148000,1450000,1610000,2360000,348000,380000,779000,1400000,1560000,0,857000,413000,6110000,1280000,1990000,27000,139000,0,0,64600,57100,0,0,709000,484000,117000,155000,2080000,1650000,447000,2670,714000,685000,485000,2050000,1040000,529000,1050000,2420000,129000,0,0,1230000,11400,13400,85900,618000],"n":25411,"w":2370000},"pts":{"b":[-0.05727,0.02557,0.00522,0,0.01347,0.002,-0.02033,-0.00164,0.00998,0.00219,0.00324,0.01652,-0.04349,-0.0037,0.01028,-0.04271,-0.0074,-0.01436,-0.01503,-0.07819,0.04457,0.02556,-0.01035,-0.00137,0,-0.04392,0.03092,-0.01539,-0.0188,0.06064,0.00788,0.0221,0.07721,-0.07515,0.01367,-0.08005,0,0,0.02907,0.00849,-0.00142,-0.02706,0,0,0,0,0.00747,-0.00692,0.02273,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[520000,375000,57900,0,110000,49300,108000,121000,55300,260000,85300,840000,10700,473000,783000,24900,321000,353000,544000,94200,51400,113000,346000,244000,0,287000,157000,1330000,280000,519000,3840,24600,99500,98600,7350,13800,0,0,143000,92900,26700,37500,0,0,0,0,197000,135000,80700,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":25397,"w":520000},"reb":{"b":[-0.07233,-0.00075,-0.01976,0,0.05146,0.01067,-0.00902,0.02,-0.01199,-0.00835,0.00212,0.01569,-0.02573,0.01197,-0.0116,-0.01635,0.00548,0.0077,-0.01282,0.00405,0.0112,0.00467,-0.00072,0.01005,0,0.01,-0.02323,-0.00886,-0.0046,0.03169,-0.01929,-0.0079,0.02687,-0.01041,0.04533,-0.0613,0,0,0.02683,-0.0052,0.01313,-0.00295,0,0,0,0,0.00917,-0.01698,0.00855,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[86700,50500,16500,0,18700,8450,20300,19500,8130,43100,13800,72600,1890,79600,133000,5680,54800,60800,80000,10000,7960,26200,52600,55900,0,33600,17700,219000,47100,77700,919,3160,17100,17000,1930,2830,0,0,20200,17300,4290,6170,0,0,0,0,23900,19900,19500,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":25324,"w":86700},"ast":{"b":[-0.13286,-0.02711,-0.00908,0,0.03712,0.03389,-0.00443,0.05469,-0.03308,0.01641,0.0326,0.02967,-0.04036,0.0159,0.03509,0.02289,-0.0108,0.00814,0.01957,0.01546,0.01705,0.02381,-0.02978,-0.02732,0,-0.01472,0.03312,-0.00517,0.00552,0.01548,-0.04416,0.03889,0.02163,-0.05433,-0.01979,0.08524,0,0,0.02323,-0.00599,-0.0041,0.00476,0,0,0,0,0.01261,-0.02504,0.01635,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[35800,25500,3890,0,7410,2950,7790,6760,3800,17700,5870,28100,677,32700,49700,1660,22000,24000,37000,4800,3850,6960,23800,17600,0,17500,9950,91900,19300,35400,363,1400,7050,6760,528,993,0,0,10700,6620,1840,2350,0,0,0,0,12100,9860,6010,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":23830,"w":35800},"fg3m":{"b":[-0.09365,0.01449,-0.00399,0,0.00924,0.00637,0.00774,-0.01855,0.02067,-0.00835,-0.00106,0.09281,-0.05504,-0.01841,0.01118,-0.09373,0.02195,-0.02058,-0.06095,-0.03161,-0.00553,0.03335,0.00691,0.00836,0,-0.03663,0.02773,-0.00272,-0.04104,0.05059,0.03463,0.04816,0.03229,-0.04126,0.00877,-0.11882,0,0,0.0153,0.02523,-0.02604,-0.03971,0,0,0,0,0.00225,0.01849,0.06836,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[6830,4400,977,0,1490,716,1530,1890,660,3420,1160,3760,126,6240,11000,405,4090,4570,7850,1160,611,1960,4290,4200,0,2790,1470,18200,3800,6000,71.1,319,1330,1330,110,224,0,0,2180,1300,373,525,0,0,0,0,2220,1580,1300,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":18011,"w":6830}},"s36":{"min":{"b":[-0.20908,-0.0307,-0.0837,0,0.02063,-0.04459,0.02011,0.01692,0.00767,-0.02131,0.00435,0.02232,-0.03981,0.00285,-0.06494,-0.03718,-0.0072,0.00241,0.01639,-0.01142,0.02959,-0.04032,-0.12488,0.01317,0,0.02041,0.01471,0.02467,-0.00945,0.09264,-0.00771,0.01349,0,0,0.00278,-0.01637,0,0,0.01825,0.02573,-0.00916,-0.02563,0,0,0,0,0,0,0,0.04598,-0.04522,0.05144,0.22329,0.24209,0.09178,0,0,-0.15192,-0.2345,0.03379,0.08324,-0.17461],"d":[1090000,715000,154000,0,239000,194000,261000,322000,111000,545000,175000,1790000,54100,926000,2280000,64400,699000,794000,1130000,172000,215000,516000,613000,397000,0,382000,176000,2840000,630000,961000,10700,73500,0,0,28600,29000,0,0,318000,223000,54200,76600,0,0,0,0,0,0,0,915000,461000,239000,466000,1070000,104000,0,0,802000,26300,31300,73500,87600],"n":25571,"w":1090000},"pts":{"b":[-0.05733,0.03096,0.00535,0,0.00607,-0.01635,-0.01794,-0.02676,0.00503,0.01186,0.00721,0.02487,-0.03993,-0.00131,0.02371,-0.04795,-0.01276,-0.016,-0.02332,-0.11355,0.03163,0.03425,-0.00886,0.01348,0,-0.04842,0.02136,-0.01462,0.00374,0.04902,-0.00575,0.02162,0.0555,-0.08242,-0.05363,-0.04083,0,0,0.00396,0.00812,0.02341,-0.02001,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[228000,174000,22800,0,46600,25500,45900,58500,25400,114000,37200,377000,11900,190000,362000,9970,135000,165000,242000,38500,24300,64400,132000,64800,0,124000,70200,577000,132000,234000,1390,9910,66100,38100,4500,4350,0,0,63800,40600,11700,16100,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":25511,"w":228000},"reb":{"b":[-0.07643,-0.01553,-0.02145,0,0.04808,0.01627,-0.01157,-0.00553,0.00282,-0.00294,-0.00417,0.01059,-0.00928,0.00764,-0.01881,0.00271,0.00458,0.01517,-0.00655,0.01902,0.02141,0.01223,0.00259,0.03665,0,0.00603,-0.00974,-0.01163,-0.00046,0.02665,-0.01738,-0.0195,0.00144,-0.00921,0.03821,-0.08611,0,0,0.01296,-0.01285,0.01532,0.0029,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[39600,25700,6330,0,8430,4760,8990,9790,4060,19700,6250,35800,2400,33700,65600,2240,27000,29700,38400,4320,4120,15100,21700,14000,0,15200,8170,97100,23100,35900,352,1450,11800,6840,1240,953,0,0,9160,7840,1980,2700,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":25079,"w":39600},"ast":{"b":[-0.15217,-0.04095,-0.03042,0,0.0344,0.00132,-0.00258,0.04154,-0.00698,0.0185,0.03268,0.02383,-0.03247,0.00459,0.0554,0.02056,0.00345,0.02891,0.01301,0.00685,0.00843,0.02576,-0.01522,-0.0153,0,-0.02312,0.0442,0.00449,-0.02813,0.01683,-0.03153,0.00913,-0.00581,-0.06951,0.00753,0.04712,0,0,0.00492,0.00139,0.00326,0.02333,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[16400,12500,1510,0,3300,1500,3450,3200,1830,8070,2650,14000,836,13800,23500,651,9880,11600,17100,1910,1840,4020,9460,4570,0,7810,4530,41400,9360,16500,132,576,4880,2690,297,340,0,0,4730,3000,879,1040,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":21083,"w":16400},"fg3m":{"b":[-0.08106,0.00302,0.00476,0,-0.00841,-0.00512,-0.02001,-0.01864,0.01472,-0.00393,-0.02018,0.10863,-0.04659,-0.01108,0.0295,-0.07497,-0.00565,-0.02815,-0.05735,-0.03325,-0.02144,0.03931,0.03339,-0.00889,0,-0.03623,0.01513,0.01398,-0.00054,0.06519,0.00634,0.01048,-0.00225,-0.04872,-0.13899,-0.13043,0,0,-0.00195,0.01192,0.01009,-0.008,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[2720,1930,331,0,580,341,576,872,281,1350,468,1680,130,2260,4560,147,1580,1930,3210,404,227,1030,1660,766,0,1140,647,7090,1580,2530,22.1,112,796,466,64.5,61.9,0,0,893,511,153,203,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":12500,"w":2720}},"s42":{"min":{"b":[-0.38276,0.01572,-0.08481,0,-0.00489,0.05788,0.00654,0.00772,-0.01694,-0.02046,0.01712,0.01958,-0.07279,0.0029,-0.13574,0.01687,0.00843,-0.00409,-0.00028,0.04616,0.07157,0.07636,-0.12042,-0.06573,0,0.0011,0.06395,0.003,0.00202,0.11384,-0.02067,0.04115,0,0,-0.03467,-0.10445,0,0,0.02047,0.00234,0.00291,-0.00877,0,0,0,0,0,0,0,0.01039,0.0768,0.10887,0.84044,0.0614,0.1052,0,0,-0.09096,-0.38413,0.15316,0.0824,-0.06214],"d":[910000,660000,116000,0,511000,215000,277000,285000,136000,455000,136000,1600000,15100,1260000,2320000,58600,562000,825000,984000,233000,325000,470000,689000,186000,0,356000,143000,2450000,585000,1010000,8920,129000,0,0,26900,22100,0,0,249000,236000,48100,65600,0,0,0,0,0,0,0,597000,322000,140000,322000,772000,180000,0,0,1300000,30800,58500,117000,119000],"n":67062,"w":910000},"pts":{"b":[-0.08748,0.10611,0.14346,0,-0.02529,-0.0161,-0.00982,-0.02987,-0.00045,0.01177,0.03062,0.02064,-0.00346,-0.00136,-0.00452,-0.05969,-0.0127,0.01835,0.00327,-0.17113,-0.0456,0.14216,-0.12774,0.01615,0,-0.01412,0.10133,-0.03636,0.02416,0.08505,-0.00724,0.00347,0.13799,-0.10537,-0.06233,-0.06598,0,0,0.01685,0.02238,0.00914,-0.01158,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[200000,162000,18900,0,96800,31900,49800,51300,31200,100000,30300,349000,2460,247000,385000,9200,107000,176000,214000,43600,32700,76700,183000,9750,0,121000,63100,531000,130000,251000,1180,17200,79000,36700,4350,2610,0,0,48600,43600,11300,13200,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":58296,"w":200000},"reb":{"b":[-0.08198,0.08358,0.0599,0,0.02189,0.01247,0.01455,0.00223,-0.00221,0.01104,0.03012,0.02647,-0.02479,0.01595,-0.04686,-0.0184,-0.00296,0.00454,0.00806,-0.01642,-0.06377,0.10015,-0.0829,0.03675,0,-0.02837,0.04572,-0.0054,0.0238,0.0475,0.01841,-0.05688,0.03312,-0.0126,-0.03022,-0.09159,0,0,0.01131,0.00761,0.01698,0.05413,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[37000,26500,5300,0,19400,6460,10200,9950,5380,18400,5580,35600,626,48800,76000,2200,25800,32900,36200,6090,6250,19300,34100,1800,0,15200,7490,93600,23500,41500,307,2850,15400,7380,1250,608,0,0,7410,8860,2020,2560,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":46461,"w":37000},"ast":{"b":[-0.14535,0.02783,0.03191,0,0.03628,-0.03211,-0.00352,0.03332,-0.01096,0.03571,0.0511,0.03643,-0.02968,0.01383,0.00261,-0.021,-0.01278,0.00235,0.02584,-0.01374,-0.05032,0.09559,-0.12662,0.0248,0,-0.00065,0.06924,-0.01282,0.02842,0.01058,-0.03649,0.00145,-0.03845,-0.06199,-0.0682,-0.01077,0,0,0.00329,-0.00235,0.01985,-0.00259,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[14200,11900,1050,0,6460,1850,3480,2680,2290,7100,2160,13200,159,17200,24200,552,7800,12600,15500,2620,2240,4130,13300,406,0,8090,4340,38100,9210,17800,104,1120,5760,2400,243,186,0,0,3500,3020,811,840,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":32972,"w":14200},"fg3m":{"b":[-0.0877,0.02864,0.07868,0,0.00834,0.04822,0.01761,0.01318,-0.00532,0.02133,0.04662,0.07942,-0.01589,-0.00271,-0.06702,-0.05168,-0.00804,-0.00071,-0.01784,-0.08162,-0.02559,0.11112,-0.06116,-0.00581,0,0.04874,0.05212,-0.02211,0.00105,0.06251,0.00122,-0.00953,0.03261,-0.08195,-0.13988,-0.11161,0,0,-0.0371,0.01943,0.02269,-0.00739,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[1960,1480,243,0,938,350,518,692,301,976,297,1370,17.9,2360,4020,117,968,1700,2330,384,205,1110,1900,21.2,0,913,485,5430,1280,2340,14.8,163,763,365,59.9,27.9,0,0,609,441,114,141,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":14164,"w":1960}},"rep":{"min":{"b":[-0.06259,-0.01964,-0.00147,0.00214,0.00161,-0.00896,0.01127,0.01322,0.00034,-0.004,-0.0011,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.01556,0,0,0,-0.00197,0,0,0,0,0,0,0,0.00633,0.0387,0.02659,-0.00333,-0.02942,-0.00835,-0.03258,-0.03372,-0.0016,-0.01355,-0.0104,-0.0085,0.06669,0.03683,-0.02028,0,0,0,0.62661,0.28544,0,0,0,0,0],"d":[47900000,37900000,3700000,8550000,27500000,3440000,14900000,12400000,7820000,23900000,7200000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,19200000,0,0,0,49200000,0,0,0,0,0,0,0,304000,13500000,12400000,2510000,2230000,64800000,22900000,5960000,370000,19600000,20400000,6140000,40200000,21600000,10500000,0,0,0,1120000,1350000,0,0,0,0,0],"n":71291,"w":47900000},"pts":{"b":[0.00805,-0.00028,-0.00102,-0.00845,-0.00672,0.0003,-0.01944,-0.00788,0.00801,-0.00343,0.00276,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02944,0,0,0,0.02094,0,0,0.13643,0,0,0,0,-0.07776,0.00593,-0.01039,0.00425,0.00263,0,0,0,0,-0.00171,-0.00037,0.00308,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[11700000,9950000,579000,2070000,6060000,825000,2990000,2610000,1990000,5860000,1770000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,7280000,0,0,0,13900000,0,0,1040000,0,0,0,0,70500,2900000,2530000,617000,547000,0,0,0,0,5790000,4290000,965000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":71281,"w":11700000},"reb":{"b":[-0.0289,-0.01591,0.01357,-0.01027,0.0354,0.00883,-0.00308,0.01497,-0.00299,-0.00521,-0.00643,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.00401,0,0,0,0.01538,0,0,0.08947,0,0,0,0,-0.03889,0.00176,-0.01873,0.01604,-0.00286,0,0,0,0,0.0232,-0.00758,-0.0205,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[1800000,1360000,171000,318000,973000,127000,509000,404000,281000,899000,272000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,760000,0,0,0,1830000,0,0,161000,0,0,0,0,16100,362000,431000,94900,88000,0,0,0,0,746000,614000,245000,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":70997,"w":1800000},"ast":{"b":[-0.04667,0.00141,0.00362,-0.02283,0.05247,-0.00387,0.00185,0.04884,-0.01514,0.01398,0.02057,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.00864,0,0,0,0.01328,0,0,0.07302,0,0,0,0,-0.00331,0.00395,-0.01653,-0.00737,-0.00781,0,0,0,0,0.02974,-0.01605,-0.00985,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[731000,622000,35400,129000,344000,50700,180000,118000,123000,363000,111000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,421000,0,0,0,870000,0,0,68800,0,0,0,0,3170,182000,152000,39500,33100,0,0,0,0,350000,249000,56100,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":69526,"w":731000},"fg3m":{"b":[-0.00589,-0.01567,-0.01783,-0.01145,-0.01262,0.00809,-0.00593,-0.04722,0.01009,0.0133,0.01244,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-0.02225,0,0,0,0.0238,0,0,0.12859,0,0,0,0,-0.10323,0.0025,-0.00634,0.00084,-0.04579,0,0,0,0,-0.00529,0.00764,0.00693,0,0,0,0,0,0,0,0,0,0,0,0,0],"d":[149000,118000,10700,26800,78900,10600,42300,41200,24600,74600,22400,0,0,0,0,0,0,0,0,0,0,0,0,0,0,65700,0,0,0,154000,0,0,13300,0,0,0,0,1270,45900,35200,8070,7230,0,0,0,0,66600,55300,16300,0,0,0,0,0,0,0,0,0,0,0,0,0],"n":60262,"w":149000}}};
// How often the simulated chances really came in over those games: [count, sum of chances, sum of hits] per 10% bin.
const CAL_PRIOR = {"pre":{"pts":[[[222500,2199.34,2383],[18115,2573.67,2807],[10284,2557.83,2807],[9997,3472.88,3827],[5018,2238.1,2353],[5815,3200.86,3346],[6777,4400.34,4697],[3554,2587.5,2718],[27,21.85,19],[0,0,0]],[[150691,4298.91,1572],[43133,6228.8,3785],[29427,7197.94,5981],[20797,7205.95,7115],[21281,9521.41,10518],[17872,9782.13,11288],[15478,10012.52,11612],[18397,13848.46,15422],[23497,19961.86,21386],[26213,24889.12,25581]]],"reb":[[[118882,1427.55,1586],[9556,1393.4,1664],[7780,1863.74,2134],[3093,1080.78,1263],[4342,1958.87,2189],[5538,3035.13,3501],[969,595.13,663],[0,0,0],[0,0,0],[0,0,0]],[[183965,4852.59,2293],[50330,7221.2,5111],[32767,8105.53,7015],[28798,9972.61,9946],[22734,10151.93,10834],[19033,10416.04,11560],[22503,14613.64,16408],[23539,17613.9,19593],[23137,19623.28,21216],[19810,18737.11,19324]]],"ast":[[[213797,2934.31,2195],[21252,3065.62,2923],[14088,3417.57,3631],[8984,3129.87,3543],[7976,3565.69,3982],[6700,3658.02,4081],[1151,707.78,762],[0,0,0],[0,0,0],[0,0,0]],[[53468,1893.5,949],[21860,3124.89,2201],[13791,3430.54,2939],[13137,4540.72,4495],[9756,4349.05,4544],[7549,4137.29,4534],[11219,7291.68,8165],[10818,8087.4,8911],[9910,8410.42,9067],[7126,6693.14,6940]]],"fg3m":[[[177899,2429.89,3919],[19224,2684.92,3388],[13298,3316.37,3989],[7352,2493.9,2870],[6432,2896.56,3188],[7987,4397.18,4785],[4607,2889.59,3108],[3,2.11,2],[0,0,0],[0,0,0]],[[58842,2704.16,2302],[32561,4759.67,4291],[19989,4874.1,4691],[17685,6183.29,6415],[14734,6564.77,6896],[10153,5524.72,5795],[12155,7967.39,8443],[15556,11622.26,12174],[11504,9707.57,10012],[2601,2398.98,2437]]]},"s6":{"pts":[[[255018,2523.23,2856],[20278,2890.77,3204],[12364,3060.36,3431],[10760,3725.79,4062],[6799,3042.45,3293],[6900,3782.01,3979],[7515,4877.51,5132],[4161,3059.29,3183],[2195,1867.99,1930],[1247,1164.09,1169]],[[132222,3640.45,1432],[35153,5071.13,3295],[23829,5842.19,5025],[17090,5928.68,5903],[16994,7601.32,8332],[14295,7831.66,8902],[12807,8290.29,9307],[15134,11386.83,12488],[17936,15226.5,16167],[27979,26819.34,27245]]],"reb":[[[141026,1694.07,1879],[11806,1717.26,2045],[9043,2173.09,2449],[4349,1531.56,1885],[5181,2327.59,2671],[6608,3622.92,4186],[1289,800.62,925],[804,612.25,685],[612,502.85,557],[0,0,0]],[[173740,4412.32,2076],[44288,6334.43,4712],[28500,7055.55,6394],[24605,8501.57,8576],[19458,8689.31,9167],[16086,8811.27,9643],[20108,13059.75,14478],[19158,14314.82,15692],[18918,16069.09,17119],[19802,18782.54,19248]]],"ast":[[[231854,3154.81,2282],[23168,3333.56,3175],[15791,3856.26,4165],[10324,3585.59,3834],[7387,3291.15,3653],[5960,3260.07,3691],[2395,1531.4,1739],[2028,1522.85,1627],[804,660.11,705],[0,0,0]],[[42990,1533.87,821],[17286,2468.07,1741],[11324,2812.34,2461],[9756,3367.81,3324],[7842,3507.97,3716],[6381,3491.03,3825],[8517,5535.48,6158],[7477,5584.31,6088],[7937,6745.38,7249],[7691,7260.23,7480]]],"fg3m":[[[196381,2793.56,4402],[22079,3066.72,3836],[15664,3901.49,4652],[8526,2885.81,3230],[7578,3411.24,3771],[9840,5418.2,5872],[5738,3602.29,3814],[3,2.12,1],[0,0,0],[0,0,0]],[[49831,2233.2,1767],[25733,3783.97,3357],[14872,3602.87,3414],[14556,5112.58,5215],[11776,5231.95,5343],[6882,3738.26,3844],[10103,6659.1,6976],[13206,9846.45,10115],[7599,6382.33,6495],[871,800.26,820]]]},"s12":{"pts":[[[302274,2884.81,3080],[23108,3303.55,3611],[14722,3618.4,3964],[11517,3996.42,4257],[8791,3930.4,4166],[7687,4201.21,4499],[6944,4500.67,4695],[6257,4667.93,4817],[5881,4989.45,5045],[3408,3180.29,3172]],[[97969,2729.39,1128],[26108,3755.91,2578],[17272,4247.26,3818],[13209,4576.68,4557],[11922,5328.51,5770],[10631,5834.4,6485],[10203,6608.76,7410],[10933,8205.97,8935],[12428,10561.85,11167],[23897,22911.11,23188]]],"reb":[[[191094,2227.2,2207],[16756,2406.02,2624],[11113,2697.75,3105],[7768,2718.16,3125],[6434,2871.64,3383],[6555,3589.03,4079],[2557,1635,1861],[3787,2855.56,3182],[1756,1441.68,1555],[0,0,0]],[[135880,3480.7,1664],[34270,4920.2,3687],[22587,5577.4,5045],[18151,6263.56,6228],[15879,7107.11,7592],[12941,7078.03,7694],[15263,9910.69,10822],[13497,10076.28,11020],[16108,13723.8,14472],[16772,15853.93,16210]]],"ast":[[[250217,3279.63,2301],[25341,3639.56,3455],[15788,3847.51,4005],[9956,3449.06,3753],[6839,3046.71,3473],[6329,3466.87,3885],[3770,2428.05,2681],[3523,2639.73,2879],[1398,1147.4,1228],[0,0,0]],[[31430,1168.71,590],[12891,1859.19,1327],[8680,2149.4,1863],[6907,2381.04,2356],[6365,2849.11,3001],[5152,2818.24,3088],[6010,3903.45,4358],[5196,3879.05,4195],[6625,5650.16,6058],[5964,5600.15,5759]]],"fg3m":[[[221350,3190.59,4685],[25148,3512.94,4255],[17825,4423.47,5068],[10212,3473.47,3847],[8991,4051.6,4456],[11117,6110.42,6546],[6053,3799.98,3875],[4,2.81,4],[0,0,0],[0,0,0]],[[34737,1551.18,1210],[17883,2659.7,2390],[9639,2316.58,2141],[10996,3883.49,3959],[8069,3574.02,3618],[4233,2297.02,2327],[7519,4981.17,5135],[9943,7398.53,7559],[4227,3529.52,3546],[263,241.03,247]]]},"s18":{"pts":[[[128182,1136.06,1295],[9314,1338.71,1460],[5902,1445.99,1518],[4355,1507.4,1665],[3569,1596.96,1681],[3276,1792.21,1891],[2946,1911.38,1927],[2814,2101.11,2155],[2833,2403.03,2381],[1854,1732.31,1726]],[[23937,655.69,229],[6156,884.74,648],[4030,991.98,902],[3116,1080.33,1074],[2796,1253.52,1348],[2405,1319.32,1443],[2428,1574.93,1702],[2634,1975.03,2134],[2870,2441.86,2578],[5849,5609.48,5651]]],"reb":[[[87095,997.75,857],[7863,1128.53,1162],[5000,1220.46,1337],[3818,1334.04,1474],[2695,1201.41,1383],[2771,1523.23,1730],[1807,1164.86,1277],[2174,1633.95,1763],[983,808.27,852],[0,0,0]],[[36132,931.74,466],[9038,1299.83,977],[5878,1452.92,1323],[4495,1546.95,1552],[4305,1930.78,2049],[3335,1822.71,1973],[3899,2530.6,2724],[3268,2440.14,2600],[4524,3859.2,4064],[3978,3745.14,3812]]],"ast":[[[95210,1259.65,870],[9830,1402.86,1359],[5602,1365.38,1368],[3912,1357.36,1535],[2782,1242.41,1378],[2567,1408.33,1578],[1749,1124.57,1232],[1550,1162.1,1273],[569,467.14,488],[0,0,0]],[[7670,295.61,134],[3370,490.21,363],[2257,557.79,500],[1757,606.44,606],[1768,791.93,813],[1251,682.41,757],[1606,1043.84,1121],[1285,957.31,1023],[1844,1575.31,1692],[1488,1393.59,1423]]],"fg3m":[[[91400,1283.86,1755],[10226,1446.51,1672],[7327,1813.08,2028],[4487,1535.67,1615],[4014,1801.84,1861],[4163,2282.32,2373],[2004,1260.68,1294],[3,2.11,2],[0,0,0],[0,0,0]],[[6650,293.82,206],[3550,529.39,484],[1762,421.02,372],[2340,828.66,837],[1601,709.6,717],[656,352.78,339],[1567,1045.69,1070],[2205,1634.29,1635],[566,468.59,457],[19,17.33,18]]]},"s24":{"pts":[[[140668,1196.78,1342],[10060,1443.46,1532],[6180,1514.49,1648],[4677,1622.16,1705],[4028,1803.11,1884],[3550,1944.92,1975],[3252,2105.16,2163],[3249,2430.48,2437],[3222,2733.73,2684],[2170,2026.04,1983]],[[10870,310.72,154],[3001,429.92,323],[1897,466.4,421],[1573,545.85,555],[1264,565.13,591],[1155,631.67,701],[1225,794.89,859],[1228,917.71,1006],[1383,1177.53,1224],[2831,2711.18,2740]]],"reb":[[[102849,1177.28,936],[9344,1336.26,1339],[5860,1432.21,1537],[4310,1501.47,1645],[3239,1443.12,1641],[3379,1854.81,2043],[2504,1616.08,1787],[2589,1941.26,2069],[1091,895.98,945],[0,0,0]],[[20213,551.23,254],[5399,780.8,564],[3431,849.79,764],[2734,940.51,937],[2541,1139.09,1204],[1891,1032.73,1096],[2439,1584.85,1689],[1840,1367.77,1456],[2797,2392.42,2496],[1979,1851.98,1892]]],"ast":[[[99122,1295.64,843],[9999,1424.74,1365],[5448,1333.84,1371],[3996,1384.15,1507],[3059,1363.81,1575],[2628,1436.08,1595],[1801,1159.91,1300],[1499,1119.47,1248],[561,460.8,489],[0,0,0]],[[3291,137.19,58],[1694,243.85,167],[1187,295.94,253],[858,293.61,287],[933,420.18,424],[634,345.33,387],[865,563.13,600],[614,457.44,491],[1024,876.98,926],[584,542.76,567]]],"fg3m":[[[95863,1305.03,1703],[10802,1534.63,1776],[7222,1783.97,1938],[4994,1723.04,1835],[4645,2078.68,2178],[3718,2029.74,2076],[1586,996.65,980],[0,0,0],[0,0,0],[0,0,0]],[[2144,99.17,76],[1341,205.42,161],[515,120.06,93],[1052,372.35,353],[600,262.24,230],[120,64.05,60],[791,529.56,523],[880,647.37,633],[99,81.88,82],[1,0.91,1]]]},"s30":{"pts":[[[155522,1233.46,1517],[9951,1426.92,1635],[6332,1553.88,1639],[4804,1667.61,1734],[3952,1769.19,1818],[3574,1954.88,1963],[3471,2247.5,2190],[3192,2388.11,2338],[2929,2481.39,2402],[1495,1395.06,1372]],[[1982,66.58,32],[685,97.81,76],[460,113.49,117],[349,120.81,127],[313,140,145],[304,166.57,171],[261,169.47,182],[285,213.76,223],[351,298.25,297],[594,568.07,576]]],"reb":[[[121524,1376.6,1140],[10879,1557.28,1550],[6753,1653.06,1780],[4855,1686.28,1894],[3964,1771.75,1919],[3769,2068.3,2277],[2994,1934.8,2091],[2439,1820.65,1908],[790,648.79,657],[0,0,0]],[[6987,201.66,99],[2104,304.31,231],[1342,335.21,294],[955,327.3,311],[1097,491.84,491],[622,337.64,351],[1007,654.53,667],[641,475.17,490],[1213,1039.05,1072],[450,416.8,423]]],"ast":[[[106387,1322.82,840],[9832,1395.17,1397],[5481,1345.02,1422],[4132,1432,1586],[2997,1334.2,1451],[2277,1243.66,1398],[1549,999.04,1106],[1073,800.06,858],[312,256.51,273],[0,0,0]],[[382,17.18,10],[265,39.16,25],[189,47.38,33],[143,48.02,39],[188,84.59,96],[91,49.49,42],[186,121.39,129],[77,56.76,61],[219,187.87,192],[69,63.29,67]]],"fg3m":[[[102032,1263.71,1641],[9982,1425.32,1618],[7097,1756.47,1817],[5878,2033.92,2143],[4048,1798.82,1822],[2099,1138.52,1078],[600,376.18,357],[0,0,0],[0,0,0],[0,0,0]],[[307,14.55,8],[224,34.26,24],[51,11.21,7],[230,81.26,66],[66,28.3,20],[7,3.79,2],[199,133.53,134],[113,82.67,70],[5,4.03,3],[0,0,0]]]},"s36":{"pts":[[[165181,1026.16,1591],[8148,1162.54,1302],[5139,1262.27,1324],[3932,1366.33,1398],[3326,1489.7,1437],[2990,1639.28,1557],[2708,1752.11,1609],[2121,1579.38,1503],[1438,1214.07,1153],[557,518.78,513]],[[32,1.37,0],[15,2.34,0],[10,2.41,4],[9,3.15,1],[7,3.05,1],[9,5.03,5],[5,3.25,1],[9,6.72,6],[6,5.03,5],[17,16.28,17]]],"reb":[[[135509,1346.72,1225],[10395,1477.47,1549],[6073,1489.53,1630],[4812,1671.93,1781],[3715,1655.85,1738],[2964,1616.85,1670],[2012,1296.93,1377],[1222,908.55,909],[268,220.28,215],[0,0,0]],[[743,27.15,14],[338,49.8,41],[215,53.62,54],[174,59.16,57],[201,90.72,90],[92,49.43,54],[206,133.99,133],[106,78.19,80],[238,204.76,211],[53,48.55,49]]],"ast":[[[112757,1190.51,895],[7983,1137.62,1155],[4934,1207.65,1328],[3111,1072.8,1154],[2031,902.93,1032],[1350,737.1,814],[800,514.7,542],[332,244.81,262],[42,34.59,37],[0,0,0]],[[10,0.28,0],[8,1.22,1],[6,1.56,1],[1,0.32,0],[8,3.54,4],[2,1.1,0],[9,5.84,6],[1,0.79,0],[7,5.94,5],[1,0.9,1]]],"fg3m":[[[108199,1051.13,1502],[9478,1380.91,1514],[6618,1618.14,1679],[3834,1312.59,1287],[1663,731.43,684],[470,251.93,244],[64,40.09,33],[0,0,0],[0,0,0],[0,0,0]],[[8,0.4,0],[12,1.83,0],[2,0.47,1],[10,3.54,2],[3,1.33,1],[0,0,0],[10,6.67,5],[4,2.96,3],[1,0.8,1],[0,0,0]]]},"s42":{"pts":[[[448352,1929.96,3027],[16050,2299.5,2405],[9394,2300.4,2279],[6735,2330.73,2276],[5318,2378.65,2228],[4538,2481.98,2342],[3437,2219.69,2085],[2267,1687.32,1624],[1347,1134.8,1076],[383,354.85,340]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"reb":[[[379652,2862.49,2663],[20545,2915.05,2932],[10806,2643.23,2846],[7631,2638.81,2919],[5505,2452.35,2646],[3459,1884.12,2034],[1837,1181.22,1231],[873,647.15,691],[166,136.29,140],[0,0,0]],[[44,1.11,0],[10,1.58,1],[12,3.1,1],[5,1.73,1],[14,6.06,7],[5,2.84,1],[15,9.73,8],[3,2.16,1],[20,17.21,18],[2,1.88,2]]],"ast":[[[318764,2399.45,1748],[14308,2025.56,2203],[6770,1644.56,1926],[3740,1288.15,1457],[2055,908.2,984],[805,434.49,484],[186,118.13,141],[32,23.28,24],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]],"fg3m":[[[301067,2240.04,3015],[18163,2617.26,2899],[9660,2325.97,2351],[3180,1073.45,1043],[611,264.75,250],[79,42.23,45],[6,3.7,3],[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]]]},"rep":{"pts":[[[217086,2075.9,2350],[17475,2483.54,2730],[9717,2420.04,2657],[9823,3413.31,3696],[4836,2151.52,2305],[5462,3002.36,3045],[6815,4428.5,4629],[4175,3055.07,3168],[47,38.05,31],[0,0,0]],[[153548,4260.48,1691],[41806,6042.24,3815],[28781,7036.8,6004],[20201,7007.59,6990],[20586,9206.4,10119],[17707,9693.22,11149],[15078,9755.7,11164],[17649,13284.46,14781],[23342,19826.28,21064],[27521,26161.48,26772]]],"reb":[[[112003,1319.27,1501],[8848,1295.08,1533],[7334,1756.23,2006],[2846,997.3,1127],[4048,1824.46,2024],[5291,2904.3,3293],[1030,633.28,701],[0,0,0],[0,0,0],[0,0,0]],[[187766,4871.1,2489],[49676,7124.94,5217],[32181,7960.69,6994],[28480,9870.55,9816],[22306,9963.93,10522],[18602,10184.71,11152],[22210,14428.61,15997],[23353,17482.02,19214],[23243,19710.81,21106],[21143,20010.01,20551]]],"ast":[[[209945,2862.09,2183],[21040,3030.35,2895],[13775,3340.08,3526],[9031,3144.86,3483],[8184,3658.81,4058],[6542,3574.99,3932],[1231,758.56,799],[0,0,0],[0,0,0],[0,0,0]],[[54067,1885.23,996],[21618,3084.15,2227],[13582,3382.35,2997],[13005,4500.03,4479],[9383,4180.38,4377],[7487,4100.85,4461],[10872,7072.45,7899],[10691,7988.9,8770],[9879,8378.57,8973],[7438,6993.15,7213]]],"fg3m":[[[175041,2352.03,3814],[18937,2634.44,3377],[13164,3275.89,3930],[7500,2538.27,2888],[6051,2724.85,2980],[7984,4395.24,4787],[4963,3122.55,3359],[6,4.22,6],[0,0,0],[0,0,0]],[[59043,2678.68,2329],[31926,4668.64,4212],[19366,4714.02,4601],[17457,6105.68,6352],[14598,6507.14,6728],[10002,5449.02,5682],[11756,7709.28,8165],[15459,11549.36,12004],[11740,9911.97,10178],[2777,2563.79,2592]]]}};
/**
* Coefficients from the built-in lessons plus whatever this phone has graded since (dev = patEmpty()
* sums). With nothing new graded this is exactly the built-in set.
*/
// How each team's points still to come really ran against the sum of our player numbers, per stage:
// [team-games graded, sum of our points still to come, sum of the real ones]. Learned with every other lesson applied.
const TEAM_PRIOR = {"pre":[7418,833818,831601],"s6":[2596,254576,262030],"s12":[2596,217573,223466],"s18":[2596,183243,188043],"s24":[2596,143421,148622],"s30":[2596,106528,111110],"s36":[2596,69750,73039],"s42":[2596,36891,38293],"rep":[7418,839406,831601]};
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
if (!r.on && !r.dnpYet && !ri.foulSit && ri.benched < 0.5) out.push({ icon: '🪑', text: `Out of the rotation: he's been on the bench for ${fmtMin(ri.sitFor)}, when he'd normally have played ${ri.missed.toFixed(1)} of those minutes. Either he's hurt or the coach has gone away from him.`, so: `${cuts(minEffect(c, dmin))} Only ${remPlayed.toFixed(1)} more minutes projected.`, effect: 'down' });
else if (!r.on && !r.dnpYet && !ri.foulSit && ri.missed >= 2) out.push({ icon: '🪑', text: `Longer rest than usual: ${fmtMin(ri.sitFor)} on the bench. Watch whether he checks back in.`, so: dmin < -0.3 ? cuts(minEffect(c, dmin)) : 'His number assumes he comes back on his normal schedule.', effect: 'down' });
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
aAll: ['players overall', 'players overall'], aS: ["tonight's starters", ''], aB: ['light-minute players', ''], aOn: ['players on the floor right now', ''], aPace: ['players getting more minutes than usual tonight', ''],
aLop: ['players in a lopsided game', ''], aOwn: ['players the lineup news moved away from their usual minutes', 'players the lineup news moved away from their usual minutes'], aLong: ['players whose season-long minutes are higher than their recent ones', 'players whose season-long minutes are lower than their recent ones'],
lopTier: ['heavy-minute players in a lopsided game', 'light-minute players in a lopsided game'], flagOff: ['regulars on the bench with the reserves finishing a decided game', ''], flagOn: ['reserves finishing a decided game', ''],
deepLop: ['deep-bench players in a lopsided game', ''], stintLong: ['starters who have been on the floor a long stretch', 'starters who just checked back in'],
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
else if (c.lineup && c.lineup.confirmed && c.inList && (pre || !r.dnpYet)) out.push({ icon: '✅', key: 'status', chip: 'CONFIRMED', effect: 'info', text: `Confirmed in tonight's lineup${c.lineup.source ? ` (${c.lineup.source})` : ''}.`, so: 'No guesswork on whether he plays.' });
// during the game a player still waiting to check in keeps the same kind of number as before tip-off
if (!pre && r.dnpYet && TUNE.condLive > 0) out.push({ icon: '⏳', key: 'notin', effect: 'info', text: `${lastName(r.name)} has not checked in yet.`, so: 'These numbers are what he does if he gets in tonight.' });
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
const up = d.filter((x) => !x.p.dnpYet && x.d >= 2 && x.p.shift.baseRem > 0 && x.d / Math.max(x.p.shift.baseRem * k, 2) >= 0.15).sort((a, b) => b.d - a.d)[0];
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
const deepIn = TUNE.actDeep > 0 && ((lineup.confirmed && availIn.has(+pid) && (st.phase === 'pre' || el <= 12.5)) || (TUNE.deepRep > 0 && st.phase === 'pre' && !lineup.confirmed));
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
const postedStarters = startT.size;
if (st.phase === 'live') for (const r of Object.values(now.players)) if ((r.team === v || r.team === h) && r.stints && r.stints[0] && r.stints[0][0] < 0.05) startT.add(+r.pid);
// known = the posted lineup named them (8 of 10 is enough: names can fail to match), or the play-by-play has found all ten.
// With no posted lineup and only 8 or 9 found so far, the missing one or two are starters the play-by-play has not named
// yet, not benched players (they were being flagged NOT STARTING at minutes 3 to 6).
const startKnown = postedStarters >= 8 || startT.size >= 10;
// a posted starter with no line in the box yet has had no shot, rebound, foul or substitution: he has been out there since the tip
if (TUNE.startOn > 0 && st.phase === 'live' && st.period <= 4 && postedStarters >= 8) for (const r of Object.values(roster)) {
if (!r.dnpYet || !startT.has(+r.pid) || (now.players[r.pid] && now.players[r.pid].min > 0)) continue;
r.dnpYet = false; r.on = true; r.min = el; r.stints = [[0, el]];
r.qmin = {}; for (let q = 1; q <= 4; q++) { const m = clamp(el - (q - 1) * 12, 0, 12); if (m > 0) r.qmin[q] = m; }
}
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
else if (usgCur != null && TUNE.thinK > 0) { const wc = a.on / (a.on + TUNE.usgPriorK); usg = wc * usgCur + (1 - wc) * 0.16; }
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
else if (cur != null && TUNE.thinK > 0) base = (cur * a.min + BENCH_RATE[k] * TUNE.thinK) / (a.min + TUNE.thinK); // no season line: a few garbage minutes are not a rate
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
if (r.pf >= k && pfT.length >= k && pfT[k - 1] < FR[k][0] && (TUNE.foulEdge > 0 ? el <= FR[k][1] : el < FR[k][1])) { restEnd = FR[k][1]; lvl = k; break; }
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
// (Before tip-off nobody is on the floor, so there is nothing to match: the plain rotK stays. Tried with the schedule:
// the before-lineups stage came out 1.7% worse on minutes on 121 unseen games.)
const rk = TUNE.rotKEarly > 0 && st.phase === 'live' ? (el <= TUNE.rotKFrom ? TUNE.rotKEarly : el >= TUNE.rotKTo ? TUNE.rotKLate : TUNE.rotKEarly * Math.pow(TUNE.rotKLate / TUNE.rotKEarly, (el - TUNE.rotKFrom) / (TUNE.rotKTo - TUNE.rotKFrom))) : TUNE.rotK;
const wm = match.length / (match.length + Math.max(rk, 0.05));
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
const foulSit = (TUNE.foulEdge > 0 ? restEnd >= el && restEnd > 0 : restEnd > el) && !r.on && sts.length && pfAt.length && sts[sts.length - 1][1] >= pfAt[pfAt.length - 1] - 0.1;
const missed = r.on || foulSit ? 0 : mean(rotG.map((x) => onBetween(x.st, el - sitFor, el)));
// (tonight's reserves are exempt: their usual pattern often comes from games in another role, and measured they come back)
const reserveTonight = TUNE.benchRes > 0 && startKnown && !startT.has(+r.pid);
const benched = TUNE.benchM50 > 0 && !reserveTonight ? 1 / (1 + Math.exp((missed - TUNE.benchM50) / TUNE.benchS)) : 1;
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
// long memory: his minutes over the whole season so far, with five games of last season mixed in (the recent window forgets)
let longMin = null;
// (o.noLong leaves it out: for a replay whose season table already holds the game being replayed. The phone does not need
// it: it replays finished games with a dated copy of the table saved before the game, see snapFor in app.js)
if (!o.noLong) { const kN = norm(r.name), cs = cur[kN], ls = last[kN];
if (cs && cs.gp >= 3 && cs.mpg > 0) longMin = ls && ls.gp >= 10 && ls.mpg > 0 ? (cs.mpg * cs.gp + 5 * ls.mpg) / (cs.gp + 5) : cs.mpg;
else if (ls && ls.gp >= 10 && ls.mpg > 0) longMin = ls.mpg; }
players.push({ longMin, lineupF, sT, startShare, sit, qRem, ratePM, usgBase: usg, p2fA: p2f, r, tm, opp, usg: usgB, usgSeason: usgCur, usgTonight: r.min > 0 ? usgT : null, mix, r3, p3, p2, ft, rate, mins, mpg, mpgFlat, qavg, starter, n, rotInfo, lp, gl, zone, recent3: n ? mean(hs.slice(-3).map((x) => x.min)) : null });
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
for (const tm of [v, h]) { let s = 0; for (const p of players) if (p.tm === tm) s += +p.mpg || 0; loadT[tm] = s / 240 - 1; }
// the five on the floor right now, as their usual minutes (a bench unit out there late in a decided game = white flag)
const unitT = {};
for (const tm of [v, h]) { let s2 = 0, n2 = 0; for (const p of players) if (p.tm === tm && p.r.on) { s2 += +p.mpg || 0; n2++; } unitT[tm] = st.phase === 'live' && n2 >= 4 ? s2 / n2 : null; }
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
if (s2 === 'min' && lo === 24 && TUNE.patInterp < 2) { patB[s2] = (TUNE.patHalf > 0 ? b2 || a : (o.patterns[patG] || {}).min || a || b2) || null; continue; }
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
usgS: p.usgBase, lu, mg: (p.tm === v ? 1 : -1) * (st.vs - st.hs), on: !!r.on, dnp: !!r.dnpYet, sitting: !r.on && lastS0 ? el - lastS0[1] : 0, el, fade: p.sit ? p.sit.fade : null, d1, tdMkt: tdF[p.tm].mkt, tdLive: tdF[p.tm].live, load: loadT[p.tm], favBy: (p.tm === v ? 1 : -1) * expV48,
rem: mean(p.mins), left, sT: p.sT, longMin: p.longMin, unitMin: unitT[p.tm], minH1: r.qmin ? (r.qmin[1] || 0) + (r.qmin[2] || 0) : null,
stint: r.on && lastS0 ? el - lastS0[0] : null });
const Fm = patB.min && !(r.ejected || r.pf >= 6) ? patApply(patB.min, patX.min, st.phase === 'live' && el >= 36 && TUNE.patCapMinLate > 0 ? TUNE.patCapMinLate : TUNE.patCapMin, 0, TUNE.patCapMinUp > 0 ? TUNE.patCapMinUp : null) : { f: 1, z: 0, parts: null };
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
// (the ramp is for games in progress. Before tip-off the fixed cut-off stays: with the ramp the before-lineups stage came out
// 1.7% worse on minutes on 1,177 games, z 5.9, whichever lessons were used.)
const refillW = (p) => (p.r.ejected || p.r.pf >= 6 ? 0 : TUNE.refillSoft > 0 && st.phase === 'live' ? clamp((p.pat.F.min.f - 0.9) / 0.1, 0, 1) : p.pat.F.min.f >= 0.97 ? 1 : 0);
if (patOn && patB.min) for (const tm of [v, h]) {
const ps = players.filter((p) => p.tm === tm);
const amNow = Math.abs(st.vs - st.hs);
const close = st.phase === 'live' ? 1 - clamp(Math.max(pBlow, (amNow - 8) / 15), 0, 1) : 1;
const give = TUNE.refill * close * (patG === 'rep' && !(TUNE.refillRep > 0) ? 0 : 1);
const cond = TUNE.condMin > 0 && (st.phase === 'pre' || TUNE.condLive > 0);
if (cond) teamK[tm] = new Float64Array(N).fill(1);
for (let i = 0; i < N; i++) {
let tot = 0; for (const p of ps) tot += p.mins[i];
if (tot > 5 * left && tot > 0) { const k = (5 * left) / tot; if (cond) teamK[tm][i] = k; else for (const p of ps) p.mins[i] *= k; }
else if (give > 0 && tot < 5 * left) {
// close game: minutes taken from one player are played by his teammates (those the layer did not cut)
let room = 0;
for (const p of ps) { const w = refillW(p); if (w > 0) room += w * p.mins[i] * Math.max(left - p.mins[i], 0); }
if (room > 0) { const add = give * (5 * left - tot); for (const p of ps) { const w = refillW(p); if (w > 0) { const g2 = (add * w * p.mins[i] * Math.max(left - p.mins[i], 0)) / room; const cap = st.phase === 'live' ? TUNE.refillMaxLive : TUNE.refillMax; p.mins[i] = Math.min(left, p.mins[i] + (cap > 0 ? Math.min(g2, cap * p.mins[i]) : g2)); } } }
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
// minutes late in a game are two-valued (he comes back or he is done): the middle of the simulations says which is likelier
{ const srt = Array.from(p.mins).sort((x, y) => x - y); let m = 0, c = 0; for (let q = Math.floor(N * 0.4); q <= Math.min(N - 1, Math.floor(N * 0.6)); q++) { m += srt[q]; c++; } mid.min = r.min + (c ? m / c : minSum / N); }
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
proj: { ...shown, min: landW && landW.min > 0 ? (1 - landW.min) * (r.min + minSum / N) + landW.min * mid.min : r.min + minSum / N }, mean: { ...avg, min: r.min + minSum / N }, mid,
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
const tF0 = patOn && TUNE.teamCal > 0 && o.patterns.team && !(TUNE.teamCal === 2 && st.phase === 'pre') ? (o.patterns.team[patG] != null ? o.patterns.team[patG] : patG === 'rep' && o.patterns.team.pre != null ? o.patterns.team.pre : 1) : 1;
// during games only a share of the check is applied, fading out over the fourth quarter: late totals are lopsided (overtime,
// fouling), so the full check would lift the number past where games most often land
const tF = TUNE.teamCal === 2 ? 1 + (tF0 - 1) * TUNE.teamCalW * clamp((42 - el) / 9, 0, 1) : tF0;
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
