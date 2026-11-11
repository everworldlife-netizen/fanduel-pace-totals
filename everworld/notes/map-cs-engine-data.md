# Courtside Arcade — `engine.js` lines 1–650: constants, samplers, helpers and the data layer

Source (read-only): `/home/claude/work/baseline/cs/engine.js` (2292 lines; no indentation; lines 833, 835 and 2292 are very long).
Supporting call sites read for context: `/home/claude/work/baseline/cs/data.js`, `/home/claude/work/baseline/cs/app.js`, `/home/claude/work/baseline/cs/worker.js`.

How to read the confidence labels:
- **(read)** — taken from the code, line by line.
- **(run)** — also executed in Node 22 on synthetic inputs.
- **(measured)** — run read-only over the real cache in `/home/claude/work/data` (2,607 regular-season games with play-by-play across DataBallr seasons 2025, 2026, 2027; official player game logs in `glog/`). The audit scripts are in `/tmp/claude-0/-home-user-fanduel-pace-totals/28a5c7d6-3c97-5567-a250-2d21e1c3cd93/scratchpad/csmap/` (`a1.js` feed audit, `a2.js` engine box vs official box, `a3.js` name joins, `a4.js` three-point rules, `a5.js` feed quality by season). They only read; nothing under `baseline`, `cs` or `gg` was touched.

**The three findings that matter most (details in §6.7 and §15):**
1. `boxFromPlays` counts a three only when the play text contains "three point". In the current feed about one made three in ten has no such text. Play-derived 3PM is **10% below the official count in 2026-27 and 8% below in 2025-26**; 3PA likewise. Adding `made && score_value === 3` reproduces official 3PM exactly (100.0% of player-games).
2. `/odds?date=` returns, for a finished game, each book's **last in-game line** (stamped two or more hours after tip), which is close to the final score. `gameLineConsensus` without `before` on a past game is a direct leak; with `before = tip` it returns nothing, and for older dates the endpoint is empty. Past games therefore have no usable DataBallr market line.
3. The 2024-25 play-by-play is not usable as is: 3.6% of shots and 12% of substitutions have no player ids, so play-derived points fall short of the scoreboard in 56% of games. 2025-26 and 2026-27 are clean (minutes within 0.25 min of official for 99.6% of player-games in 2026-27).

Contents
1. Loading the module in Node, and the export list
2. `LEAGUE`, `TUNE` (every key), `BENCH_RATE`, `VAR_K`, `addDaysStr`
3. RNG and samplers
4. Small helpers
5. `gameState`, `isBlowout`
6. `boxFromPlays` (+ `shotZone`), including what was measured on real games
7. `scoringEvents`, `logEntry` — the log-entry shape
8. `profileOf`, `slimStats`, `mergePrior`
9. `slimTeams`
10. `gameLineConsensus`
11. `slimGameLogs`
12. `teamContext`
13. `coachHabits`
14. Harness recipe: how `projectGame` consumes all of this, and what must be as-of-date
15. Bugs, leaks, inconsistencies, modelling weaknesses
16. Open questions

---

## 1. Loading in Node, and the exports

UMD wrapper, lines 19–23: in Node `module.exports = api`; in the browser / worker `self.Engine = api`.

```js
const Engine = require('/home/claude/work/baseline/cs/engine.js');   // 72 exports (run)
```

Things a harness must know:

- `Engine.TUNE` and `Engine.LEAGUE` are the live, **mutable, unfrozen** objects the engine reads at call time. A harness can set `Engine.TUNE.tonightW = 0.2`, run, and restore.
- Four TUNE keys are **read but not defined** in the literal, i.e. they are hidden override hooks: `TUNE.sitOn` (line 1833, `!== 0` means on), `TUNE.usgTonightW` (1695, falls back to `tonightW`), `TUNE.varReb` / `TUNE.varAst` (2053–2054, fall back to `VAR_K`).
- The header comment (line 27) says the tunables were "chosen by scripts/backtest.js; see README Accuracy". Neither that script nor that README section is in the baseline folder (README.md is 219 bytes).
- The shipped situational prior is read from `self.SIT_PRIOR_TXT` (line 1093). In Node `self` is undefined (run, v22), so `projectGame` silently runs with an empty prior unless the harness passes `o.sitPrior`, or does `globalThis.self = globalThis; require('.../sitprior.js')` **before the first `projectGame` call** (the result is cached in `SIT_PRIOR_CACHE`, including the empty one).

Export list (line 2292), one line each. "(region)" = defined in lines 1–650 and documented in this map.

| Export | What it is |
|---|---|
| `LEAGUE` | League-average constants (region, §2) |
| `TUNE` | All tunables (region, §2) |
| `LADDERS` | Line 1153: alt-line rungs per stat: pts 5..45 by 5, reb 2..16 by 2, ast 2..12 by 2, fg3m 1..6, pra 10..60 by 5 |
| `STAT_LABEL` | Line 2222: `{pts:'PTS', reb:'REB', ast:'AST', fg3m:'3PM', pra:'PRA'}` |
| `makeSampler(seed)` | Seeded RNG + normal / poisson / binomial / gamma / negbin (region, §3) |
| `clockSec(clock)` | Clock string → seconds left (region, §4) |
| `elapsedSec(period, clock)` | Game seconds elapsed (region, §4) |
| `norm(name)` | Player-name normaliser used as the join key everywhere (region, §4) |
| `gameState(g)` | DataBallr live-games row → clean state (region, §5) |
| `isBlowout(st, any=15, second=12)` | Blowout rule on a state (region, §5) |
| `clockLabel(m)` | Game minute → "6:00 Q2" (region, §4) |
| `onBetween(stints, a, b)` | Minutes on court between two game minutes (region, §4) |
| `boxFromPlays(plays, curPeriod, curClock)` | Box score, minutes, stints, fouls, zones from play-by-play (region, §6) |
| `logEntry(game, plays)` | Finished game → compact cached log entry (region, §7) |
| `slimStats(rows)` | DataBallr season player stats → per-player prior (region, §8) |
| `mergePrior(last, cur)` | Blend last season's and this season's prior (region, §8) |
| `teamContext(logs, abbr)` | Team pace / defence / environment from log entries (region, §12) |
| `slimTeams(j)` | DataBallr team stats → slim per-team object (region, §9) |
| `gameLineConsensus(rows, gameId, before)` | Median spread / total / no-vig win chance across books (region, §10) |
| `slimGameLogs(rows, keep=10)` | DataBallr player game logs → last games + averages (region, §11) |
| `shotZone(txt, three)` | Shot text → 'rim' / 'mid' / 'three' (region, §6) |
| `profileOf(r)` | Display-only profile numbers from a season row (region, §8) |
| `coachHabits(logs, abbr)` | Starters' 4th-quarter minutes in blowouts vs close games (region, §13) |
| `projectGame(o)` | Line 1472: the Monte Carlo projection (inputs listed in §14) |
| `probAtLeast(arr, t)` | Line 2186: share of simulations ≥ t |
| `probOver(arr, line)` | Line 2192: P(over a posted line), half-point aware |
| `consensusLines(props)` | Line 2200: player-prop rows → consensus line per `pid:stat` |
| `picksForGame(proj, lines, opts)` | Line 2253: plus-edge picks from a projection and lines |
| `buildCombos(picks, opts)` | Line 2292: 2-leg tickets at a payout multiple |
| `contextItems(p, r, c)` | Line 1321: explanation items for the player sheet (text only) |
| `edgeTier(p, k, phase)` | Line 2228: STRONG / SOLID / SLIGHT / UNSURE tier for a pick |
| `TIER_RANK` | Line 2250: `{strong:0, solid:1, slight:2, unsure:3}` |
| `PAT_STATS` | Line 656: `['pts','reb','ast','fg3m']` |
| `PAT_F` | Lines 659–663: the 34 learned-pattern feature names |
| `PAT_GROUPS` | Line 667: `['pre','s6','s12','s18','s24','s30','s36','s42']` game stages |
| `patFeatures(f)` | Line 677: feature rows for one player at one moment |
| `patEmpty()` | Line 726: empty sufficient statistics for the nightly learning |
| `patAdd(acc, more, wt=1)` | Line 734: add sufficient statistics |
| `patGrade(proj, rows, acc, opts)` | Line 752: grade a projection against `logEntry().rows` |
| `patScore(proj, rows, acc)` | Line 785: running accuracy of a full projection |
| `patSolve(acc, lam)` | Line 813: ridge solve → coefficients per stage and stat |
| `patApply(beta, x, cap, shift)` | Line 863: correction factor `1 + patW * clamp(z, -cap, cap)` |
| `patGroup(st)` | Line 675: state → stage name |
| `patBeta(dev, lam)` | Line 840: built-in lessons (`PAT_PRIOR`) + what the phone graded |
| `patMinOnly(beta)` | Line 940: keep only the minutes coefficients |
| `liveUsage(plays, box, el)` | Line 942: tonight's on-court plays / own plays / last 6 on-court minutes |
| `PAT_LEARN` | Line 658: `['min','pts','reb','ast','fg3m']` |
| `PAT_IX` | Line 665: feature name → index |
| `PAT_PRIOR` | Line 833 (18 KB literal): built-in learned coefficients |
| `patPack(sum)` / `patUnpack(pk)` | Lines 920 / 926: compact storage of the learning sums |
| `playsFromEspn(summary, nameToPid)` | Line 1382: ESPN summary → DataBallr-shaped plays |
| `fadeCheck(p, r, c, avg, patF)` | Line 1401: "hot start will cool" warning |
| `liveAlerts(players, st, absent)` | Line 1426: usage-shift alerts |
| `calEmpty` / `calAdd` / `calTable` / `calTableFrom` / `calP` / `calProb` / `calLevel` / `CAL_STATS` | Lines 877–918: learned probability calibration |
| `SIT_CATS` | Line 975: the 14 situational categories |
| `scoringEvents(plays)` | Scoring timeline from plays (region, §7) |
| `scorerRace(players, N)` | Line 2161: top-scorer shares from the simulations |
| `teamStar(logs, tm)` | Line 977: team's top scorer in the logs (≥3 games, ≥20 mpg) |
| `sitAgg` / `sitCurve` / `sitPriorOf` / `sitPriorParse` / `sitProfile` / `sitFactor` | Lines 994–1151: situational scoring tendencies (consume `log.sc`, `row.st`) |

Not exported (module-private) but defined in the region: `mulberry32`, `periodLen`, `clamp`, `fmtMin`, `onAt`, `mean`, `num`, `medianOf`, `pctN`, `addDaysStr`, `BENCH_RATE`, `VAR_K`, the four play regexes.

---

## 2. Constants

### 2.1 `LEAGUE` (line 26)

`{ p2: 0.545, p3: 0.36, ft: 0.78, ortg: 114.5, pace: 99, usg: 0.2 }`

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `p2` | 0.545 | League 2-point % | 1706: 2P% prior when the player has no season prior |
| `p3` | 0.36 | League 3-point % | 592, 597 (`teamContext` opp 3P% fallback and `p3f`); 1647 (league zone fallback for threes); 1704–1705 (3P% prior and its 60-attempt shrink target) |
| `ft` | 0.78 | League FT % | 1707: FT% prior fallback |
| `ortg` | 114.5 | League points per 100 possessions | 591, 598 (`teamContext` drtg fallback and `p2f`); 1490 (`lgOrtg` fallback when DataBallr league row is missing) |
| `pace` | 99 | League possessions per 48 | 595 only: `teamContext.pace` when a team has no games in the logs |
| `usg` | 0.2 | League usage | **Never read** (dead; `TUNE.usgTarget` is used instead) |

For reference (measured, DataBallr league rows): 2026-27 to date pace 99.47, ortg 113.83, 3P% .348, 2P% .541; 2025-26 pace 99.38, ortg 116.18, 3P% .358, 2P% .548.

### 2.2 `TUNE` (lines 28–97) — all 73 keys

Line numbers are every place the key is read in `engine.js` (grep done by script). `el` = elapsed game minutes, `left` = minutes left, `N` = simulations.

**Tonight vs season, shrinkage**

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `tonightW` | 0.1 | Weight on tonight's own rate once fully ramped | 1694: `wt = tonightW * min(1, r.min / tonightRamp)`; reb/ast rate = `(1-wt)*base*env + wt*tonightRate` (1740). 1695: default for the usage weight `wu` |
| `tonightRamp` | 15 | Minutes played tonight before `tonightW` is fully on | 1694, 1695 |
| `usgPriorK` | 80 | On-court team plays (from logs) at which this season's usage gets half weight vs the prior | 1684: `wc = a.on / (a.on + 80)` |
| `p3K` | 120 | Attempts of prior mixed into 3P% | 1727: `(fg3m + p3prior*120) / (fg3a + 120)` |
| `p2K` | 200 | Attempts of prior mixed into 2P% | 1728 |
| `ftK` | 60 | Attempts of prior mixed into FT% | 1729 |
| `paceK` | 30 | Minutes before live pace gets half weight | 1603: `w = el / (el + 30)`; 1359 (same formula in the explanation text) |
| `qShareTonight` | 0.4 | Weight of tonight's share of the current quarter vs the season quarter pattern | 1759 (only used when the rotation map is unavailable, see `rot`) |
| `minDecay` | 0.85 | Recency weight per game back for minutes and the quarter pattern | 1744: `w = 0.85^(games back)` |
| `shotEff` | 0.93 | Global multiplier on 2P% and 3P% ("early-season makes vs last season's rates") | 1727, 1728 (not applied to FT%) |

**Availability**

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `absentMinMpg` | 20 | A player averaging this many minutes (last 3 logged games) who missed his team's most recent logged game is presumed out, when no injury report is supplied | 1567 |
| `b2bRestAge` | 0 | Pregame: on the 2nd night of a back-to-back, starters at least this old are presumed out (0 = off, flag only) | 1550 |
| `liveOutMin` | 10 | Live: a 24+ mpg player not checked in by this game minute is out (14+ mpg by minute 18 is hard-coded) | 1580 |
| `liveConfirmedOut` | 1 | Live: with a confirmed, complete lineup, anyone not on the active list is out (pregame always) | 1559 |

**Minutes model**

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `closeQ4` | true | Quarter-minute pattern is taken from games with final abs(margin) < 15 (needs ≥2 such games) | 1749 |
| `minShock` | 0.4 | Per-simulation multiplicative minutes noise: `clamp(N(1, 0.4), 0.4, 1.5)` | 1818 |
| `closerQ4` | 0 | If the simulated end-of-Q3 margin is under 8, starters get at least this many Q4 minutes (0 = off) | 1817 |
| `rot` | 1 | Use the rotation map (stints from logged games) for live remaining minutes; needs ≥2 logged games with stints | 1765 |
| `rotK` | 2 | Pseudo-games of the unconditioned map when conditioning on "on court / sitting right now" | 1780: `wm = match / (match + 2)` |
| `rotTonight` | 0.25 | Exponent on tonight's minutes-so-far vs the map's expectation | 1785: `((min + K) / (expSoFar + K))^0.25`, only when `el >= 3` |
| `rotTonightK` | 6 | Minutes of shrink in that ratio | 1785 |
| `benchM50` | 7 | Sitting through this many of his usual on-court minutes = 50% he is done for the night | 1793: `1 / (1 + exp((missed - 7) / 1.2))` |
| `benchS` | 1.2 | Steepness of that curve | 1793 |
| `foulRest` | `{2:[0.7,0.4], 3:[0.7,0.4], 4:[1,1], 5:[0.7,0.4]}` | By foul count: share of usual minutes until the foul-rest point, `[if on the floor now, if sitting]`. The rest windows are hard-coded at 1769: `FR = {2:[12,18], 3:[24,24], 4:[36,39], 5:[42,42]}` (foul # → [picked up before minute, rests until minute]) | 1774; 1190 (text) |
| `foulAfter` | 0.95 | With 4+ fouls, share of usual minutes after the rest point | 1776 |
| `fillByMin` | 2 | How unclaimed team minutes are handed out: `=== 2` → one pass over the whole roster; any other value → bench first, then starters. Truthy also switches on the `fillPow` weight | 1876, 1877 |
| `fillPow` | 0 | Extra weight `(projected minutes / left + 0.02)^fillPow` on top of "room left × availability × position weight" (0 = no extra weight) | 1876 |
| `fillPos` | 0.1 | Pregame: freed minutes favour the position group of the missing players: weight `1 + 0.1 * 3 * share of missing minutes in his group` | 1875 |
| `b2bMin` | 0.03 | Pregame, 2nd night of a back-to-back: starters' minutes × 0.97 | 1808; 1371 (text) |
| `blowPlayer` | 1 | Use each player's own blowout habit (from `coachHabits().players`) instead of the coach's | 1807 |
| `blowPK` | 4 | Pseudo-games of the coach's habit mixed into a player's own blowout record | **630 (region, `coachHabits`)** |
| `immuneLead` | 0.6 | "Blowout-proof" needs own lead ratio ≥ this | **645 (region, `coachHabits`)** |
| `patCapMin` | 0.6 | Most the learned layer can move remaining minutes (±60%) | 1942 |
| `refill` | 1 | Minutes the learned layer removes from one player go back to teammates in close games | 1952 |
| `otSim` | 1 | Simulate overtime (+5 minutes) in close simulations | 1966 |

**Pace, margin path, team strength, market**

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `drift` | 2 | Multiplier on the model margin (net-rating gap minus home court) in the margin path; note it also doubles `homeAdv` | 1637, 1638 |
| `homeAdv` | 2.5 | Home-court points per 48 | 1634: `marginModel = (net_v - net_h)/100 * seasonPace - 2.5` (visitor perspective) |
| `marginK` | 2 | Live margin random walk sd per sqrt(minute) to the end of Q3 | 1639 |
| `preQ3Sd` | 16 | Pregame sd of the margin at the end of Q3 | 1639 |
| `q4Pace` | 0.94 | 4th-quarter possessions per minute relative to the rest | 1605 |
| `blowAhead` | 0 | Live: minutes of margin drift still ahead when judging garbage time (0 = margin at end of Q3) | 1630 |
| `dbTeamW` | 0.5 | Weight of DataBallr season team stats vs `teamContext` from logs: `wd = (c.games ? 0.5 : 1) * d.g/(d.g+4)` applied to pace, net and `p2f` | 1496 |
| `mktTotalW` | 0.35 | Weight of the books' total, converted to a pace (clamped 88–112), in the pace prior | 1596, 1600 |
| `mktSpreadW` | 0.5 | Weight of the books' spread in the margin drift | 1636, 1637 |
| `tdOn` | 1 | Top-down team check feeds the learned layer (features `tdMkt`, `tdLive`) | 1907 |
| `otherPM` | 0.4 | Points per minute for team minutes not covered by tracked players | 1918, 2140, 2142 |

**Usage, rates, variance**

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `usgTarget` | 0.2 | Minutes-weighted on-floor usage each team is renormalised to: `scale = clamp(0.2 / avg, 0.85, 1.2)` | 1894 |
| `usgRedistPow` | 0 | When the floor is short of usage, higher-usage players absorb more (0 = proportional) | 1896, 1899 |
| `glUsgW` | 0.3 | Weight of DataBallr game-log usage: `wg = 0.3 * n/(n+3)`, needs `n >= 2` and `0.03 < avg.usg < 0.5` | 1687, 1688 |
| `usgShock` | 0.3 | Per-simulation lognormal sd of a player's usage | 2036 |
| `rebShock` | 0.2 | Per-simulation lognormal sd of his rebound rate | 2051 |
| `astShock` | 0 | Same for assists (off) | 2052 |
| `envW` | 0 | Exponent on the rebound / assist environment factor (0 = off) | 1626 |
| `envK` | 30 | Minutes before tonight's environment gets half weight | 1609 |
| `zoneW` | 0 | Weight of the opponent's allowed FG% by zone vs the flat `p2f` (0 = off) | 1725 |
| `zoneK` | 60 | League-average attempts mixed into each opponent zone | 1715 |
| `b2bEff` | 0 | Pregame back-to-back shooting trim (off) | 1726 |
| `shiftCenter` | 1 | Learned usage shifts are centred inside the team | 1983, 1986 (668 comment) |

**Situational scoring (`sitProfile` / `sitFactor`)**

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `sitK` | 150 | Minutes of shrinkage of each situational ratio toward 1 | 1113 |
| `sitPriorW` | 0.5 | Weight of the shipped last-season situational prior | 1098 |
| `sitFadeK` | 3 | Shrink on the half-to-half curve | 1118 |
| `sitStreakK` | 3 | Shrink on the game-to-game curve | 1119 |
| `sitQW` | 1 | Exponent on the by-quarter factor | 1148 (as `W.sitQW`), 1255 |
| `sitStateW` | 1 | Exponent on the ahead / close / behind / clutch factor | 1148, 1242–1248 |
| `sitHomeW` | 0 | Exponent on home / away (off) | 1148, 1257 |
| `sitRestW` | 0 | Exponent on back-to-back / rest (off) | 1148, 1258 |
| `sitStarW` | 0.5 | Exponent on star on / off | 1149, 1238 |
| `sitFadeW` | 0 | Exponent on hot / cold start carry-over (off) | 1149, 1263 |
| `sitStreakW` | 0.5 | Exponent on last-game carry-over | 1149, 1268 |

**Learned layer, display**

| Key | Value | Meaning | Used at |
|---|---|---|---|
| `patW` | 1 | Apply learned corrections (0 = off) | 870, 1927 |
| `patCap` | 0.3 | Most a learned pattern can move a stat (±30%) | 865 (default cap), 1989 |
| `patLam` | 32 | Ridge strength when solving patterns | 814, 841 |
| `landOn` | 1 | Show the blended "most likely landing" number (`LAND`, line 673) instead of the plain mean | 2085 |

**Hooks read but not present in the literal:** `sitOn` (1833), `usgTonightW` (1695), `varReb` (2053), `varAst` (2054).

### 2.3 Other constants in the region

- `addDaysStr(s, n)` (line 98): `YYYY-MM-DD` ± n days, computed at 12:00 UTC. Used at 1017 (situational b2b) and 1540 (`b2b[tm]`: a log dated exactly the day before `gameDate`).
- `BENCH_RATE = { pts: 0.4, reb: 0.17, ast: 0.09, fg3m: 0.04 }` (line 99): per-minute fallback rates when a player has neither logs nor a prior. Used at 1737 (reb / ast base) and 1832 (`ratePM`; points use 0.42 there, not 0.4).
- `VAR_K = { reb: 1.5, ast: 1.6 }` (line 100): variance-to-mean ratio of the negative binomial for rebounds and assists (2053–2054).

---

## 3. RNG and samplers (lines 103–158)

`mulberry32(seed)` (103): 32-bit PRNG, returns a function giving uniforms in [0, 1). The seed is coerced with `>>> 0`.

`makeSampler(seed)` (114) → `{ u, normal, poisson, binomial, gamma, negbin }`; `seed || 1`, so seed 0 becomes 1. `projectGame` uses `makeSampler(o.seed || st.id || 7)` (1476), so a run is fully deterministic for a given seed and call order.

| Method | Behaviour |
|---|---|
| `u()` | Uniform [0, 1) |
| `normal(mu=0, sd=1)` | Marsaglia polar; caches the spare standard normal for the next call |
| `poisson(lam)` | 0 if `!(lam > 0)`; `lam > 30` → `max(0, round(normal(lam, sqrt(lam))))`; else Knuth |
| `binomial(n, p)` | 0 if `n <= 0` or `p <= 0`; `n` if `p >= 1`; `n > 60` → rounded normal clamped to [0, n]; else Bernoulli loop (a non-integer `n` runs `ceil(n)` trials) |
| `gamma(shape, scale)` | Marsaglia–Tsang, with the `shape < 1` boost |
| `negbin(mean, k)` | 0 if `!(mean > 0)`; else `poisson(gamma(mean/(k-1), k-1))`: mean = `mean`, variance = `k * mean`. Requires `k > 1`. (run: `negbin(4, 1.5)` gave mean 3.99, variance 5.96) |

---

## 4. Helpers (lines 161–204)

- `clockSec(clock)` (161): `null`/empty → 0. With a colon: `minutes*60 + seconds` (both `parseFloat`; `":30"` → 30; `"0:05.2"` → 5.2). Without a colon: `parseFloat` as **seconds** (`"45.3"` → 45.3; a number is treated as seconds). Non-numeric text → 0. (run) The real feed uses `"11:37"` above a minute and `"59.8"` below (measured).
- `periodLen(p)` (172): 720 for periods 1–4, 300 for overtime periods.
- `elapsedSec(period, clock)` (173): sum of earlier period lengths + `periodLen(period) − clockSec(clock)`. `elapsedSec(4,'0:00')` = 2880, `elapsedSec(5,'5:00')` = 2880, `elapsedSec(6,'0:00')` = 3480. (run)
- `norm(name)` (178): NFKD, strip combining marks U+0300–U+036F, lower-case, delete `.` `'` `-`, delete whole-word `jr sr ii iii iv`, collapse spaces, trim. Examples (run): `Luka Dončić` → `luka doncic`; `De'Aaron Fox` → `deaaron fox`; `Karl-Anthony Towns` → `karlanthony towns` (hyphen removed, not replaced by a space); `Jaren Jackson Jr.` → `jaren jackson`; `P.J. Washington` → `pj washington`. Not handled: curly apostrophes, suffix `V`, nicknames. This string is the **only join key** between priors (`slimStats`), game logs (`slimGameLogs`), ESPN availability and the play-by-play rosters.
- `clamp(x, lo, hi)` (185).
- `onBetween(stints, a, b)` (187): total overlap, in minutes, of `[[in, out], ...]` with `[a, b]`.
- `clockLabel(m)` (193): game minute → `"6:00 Q2"`, quarter capped at 4.
- `fmtMin(m)` (199): minutes → `"mm:ss"`.
- `onAt(stints, t)` (200): true when `in <= t < out` for some stint.
- `mean(arr)` (204): 0 for an empty array.

---

## 5. `gameState(g)` (lines 207–235) and `isBlowout` (238–241)

### Fields read from a DataBallr live-games row

`g.visitor_team.abbreviation`, `g.home_team.abbreviation` (both required, no null guard), `g.visitor_team.full_name`, `g.home_team.full_name`, `g.visitor_team_score`, `g.home_team_score`, `g.status_state`, `g.display_status`, `g.period`, `g.time`, `g.id`, `g.is_clutch`, `g.datetime`, `g.visitor_q1..q4`, `g.home_q1..q4`.
(`g.date` is not read here; it is read by `logEntry` and `projectGame`.)

A real finished row (measured, `/v1/nba/live/games/<date>` → `.data[]`): `date: "2026-11-09"` (US game date), `datetime: "2026-11-10T00:00:00.000Z"` (UTC tip), `status_state: "final"`, `display_status: "final"`, `status: "Final"`, `time: "Final"`, `period: 4` (5 or 6 after overtime), `id: 21718066`, plus `home_ot1..3`, `visitor_ot1..3`, `postseason`, `season` (start year, e.g. 2026 for 2026-27, unlike the stats endpoints which use the end year). A pregame row has `status_state` not final, `period: 0`, `display_status: "7:30 PM ET"`.

### Logic

1. `state = lower(g.status_state || g.display_status || '')`, `t = trim(g.time)`, defaults `clock = '12:00'`, `phase = 'pre'`, `period = g.period || 0`.
2. **final** if `state === 'final'`, or if `status_state` is absent and `time` or `display_status` matches `/final/i`. Then `clock = '0:00'`, `period = max(period, 4)`.
3. Else **live** if `period > 0`:
   - `time` matches `/half/i` → `period = 2`, `clock = '0:00'` (even if the row says period 3);
   - `time` matches `/^end/i` → `clock = '0:00'`;
   - else if `time` is non-empty → `clock` = last whitespace-separated token (`"Q3 5:23"` → `"5:23"`);
   - empty `time` → clock stays `'12:00'`.
4. Else **pre**.
5. `elapsed` (minutes) = 0 pregame, else `elapsedSec(period, clock) / 60`.
6. `left` = 0 if final; if `period > 4` the minutes left **in the current overtime period**; else `max(48 − elapsed, 0)`.
7. `label` = `display_status` pregame, `'FINAL'`, `'HALF'`, or `time`.

### Return value

```
{ id, v, h,                 // game id, visitor and home abbreviations
  vs, hs,                   // scores (0 if missing)
  period, clock, phase,     // phase: 'pre' | 'live' | 'final'
  elapsed, left, label,
  margin: |vs − hs|,        // absolute
  isClutch: !!g.is_clutch,
  tip: g.datetime,
  vName, hName,
  lines: { v: [q1,q2,q3,q4], h: [q1,q2,q3,q4] } }   // quarter scores as the feed gives them
```

Synthetic rows (run):

| Input | Result |
|---|---|
| `status_state:'scheduled', period:0` | pre, elapsed 0, left 48 |
| `'in', period 3, time 'Q3 5:23'` | live, clock `5:23`, elapsed 30.617, left 17.383 |
| `'in', period 2, time 'Half'` and `period 3, 'Halftime'` | live, period 2, clock `0:00`, elapsed 24 |
| `'in', period 1, 'End of 1st'` | elapsed 12, left 36 |
| `'in', period 4, 'Q4 45.3'` | elapsed 47.245, left 0.755 |
| `'in', period 5, 'OT 2:10'` | elapsed 50.83, left 2.167 |
| `'in', period 5, time ''` | clock `12:00` → **elapsed 41, left 12** (wrong; see §15) |
| `'final', period 5` | elapsed 53, left 0 |
| `status_state:'post', period 4, 'Final'` | **phase 'live'**, clock `'Final'` → 0 s, elapsed 48, left 0 (only the literal `'final'` state is recognised) |
| `'in', period 3, time '5:23 - 3rd'` | clock `'3rd'` → 3 seconds (format not supported) |

Formats the app itself produces (`data.js` 108–111, `app.js` 225–228): `'Final'`, `'Half'`, `` `End of ${ord}` ``, `` `Q${per} ${clock}` ``, and for pregame replays `status_state:'scheduled', period:0, time:''`. The exact `time` string of a real in-progress DataBallr row was not sampled.

### `isBlowout(st, any = 15, second = 12)`

False pregame. Otherwise `st.margin >= any || (st.period >= 3 && st.margin >= second)`. Only used for the `blowout.now` flag in the projection output (2149).

---

## 6. `boxFromPlays(plays, curPeriod, curClock)` (lines 258–404)

### 6.1 Play row shape

A real row (measured, `/v1/nba/games/<id>/plays` → `.data[]`):

```
{ order, period (number), period_display, clock ("11:37" or "59.8"), type (ESPN play-type text), text,
  participants: [BallDontLie player id, ...],
  team: { abbreviation, id, full_name, ... } | null,
  shooting_play (bool), scoring_play (bool), score_value (2 | 3 | 1 | null),
  away_score, home_score, coordinate_x, coordinate_y, game_id, wallclock }
```

Fields **consumed** by `boxFromPlays`: `period`, `clock`, `type`, `text`, `participants`, `team.abbreviation`, `shooting_play`, `score_value`. Nothing else (the shot coordinates and `scoring_play` are ignored).

Id spaces (measured): `participants` and the keys of `rows` are BallDontLie ids (Shai Gilgeous-Alexander = 175); game ids are BallDontLie game ids. Season stats use NBA.com ids (`nba_id` 1628983 for the same player). The player game-logs feed carries both (`bdl_player_id`, `nba_id`, `bdl_game_id`).

Regexes (244–247):
- `SHOT  = /^(.*?) (makes|misses) /`
- `BLOCK = /^.*? blocks (.*?)'s /`
- `REB   = /^(.*?) (offensive|defensive) rebound/`
- `SUB   = /^(.*?) enters the game for (.*)$/`

On a blocked shot the feed puts the **shooter first** and the blocker second, and `team` is the shooter's team (measured), which is what the code assumes. The current feed writes `"X blocks Y 's 26-foot ..."` with a space before `'s`, so `BLOCK` captures the shooter's name with a trailing space; it is only used when the player has no name yet, and a later substitution line overwrites it.

### 6.2 `shotZone(txt, three)` (250–256)

1. `three` → `'three'`.
2. `d` = first `(\d+)-foot` in the text.
3. Text matches `layup|dunk|tip|alley|putback|finger roll|hook` (case-insensitive, anywhere in the text, including names) **and** (no distance or distance ≤ 6) → `'rim'`.
4. Else distance ≤ 4 → `'rim'`.
5. Else `'mid'` (so a two with no distance and no keyword is `'mid'`; a 7-foot driving layup is `'mid'`; a 9-foot hook is `'mid'`). (run)

Only the text is examined, never `p.type`. Many layups carry the generic text "X makes two point shot" while the type says "Driving Finger Roll Layup"; 16–25% of shots whose type is a layup, dunk or tip are labelled `'mid'` (measured). Inert today because `zoneW = 0`.

### 6.3 Pass 1 — counting stats (268–330), in feed order

For every play: it is appended to `byPer[p.period]`; `txt = trim(text)`, `parts = participants || []`, `typ = type || ''`, `abbr = team.abbreviation`.

Player records are created lazily by id with all counters at 0. Each record keeps a tally `teams[abbr]` of how often it was tagged with each team; the player's team is the **most-tagged** abbreviation.

| Branch (first match wins, then `continue`) | Condition | Effect |
|---|---|---|
| Substitution | `typ === 'Substitution'` | If `SUB` matches and there are ≥2 participants: `parts[0]` = entering player (name = group 1), `parts[1]` = leaving player (name = group 2); names are **overwritten**; both tagged with `abbr`. No stats. |
| Ejection | text matches `/ejected/i` and has a participant | `parts[0].ejected = true` (does not `continue`; the play can still fall into a branch below) |
| Shot or free throw | `p.shooting_play` and has a participant | Shooter = `parts[0]`. Name from `SHOT` group 1, else from `BLOCK` group 1. Tagged with `abbr`. `made` = text (space-padded) contains `" makes "` (line 290). **`three` = text contains `"three point"` (line 291).** If text contains `"free throw"`: `fta++`, `ftm++` if made, team `fta++`. Else: `fga++`, `fgm++` if made, team `fga++`, zone tally `z[zone] = [attempts, makes]`, and if three: `fg3a++`, team `fg3a++`. If made: `pts += score_value || 0` (player and team), team `fgm++` (non-FT), `fg3m++` (player and team) if three; if text matches `/\((.*?) assists\)/` and there are ≥2 participants: `parts[1].ast++`, named, tagged, team `ast++`. |
| Rebound | `typ` contains `'Rebound'` | Team `oreb++` if `typ` contains `'Offensive'`, else team `dreb++` (this includes **team rebounds with no participant**). If there is a participant and `REB` matches: player `reb++`, `oreb++` if offensive, named, tagged. |
| Turnover | `typ` contains `'Turnover'` | Team `tov++`; `parts[0].tov++` if present (**no name, no team tag**). |
| Foul | `typ` contains `'Foul'` and has a participant | If `typ` contains `'Technical'` or text matches `/technical/i`: `tech++` unless text matches `/3-seconds/i`. Otherwise `parts[0].pf++` and `pfAt.push(elapsed minutes, 2 dp)`. No name, no tag. |

Consequences:
- A shot with no participants is skipped entirely, including its points.
- Blockers, stealers and players who draw fouls get **no record** from those plays.
- A record becomes "real" only once it has both a name (shot, block-as-shooter, assist, rebound, substitution) and a team tag. A player whose only events are turnovers or fouls is dropped from the output while the team totals still include his turnover. (run)
- Player points come only from `score_value` on made shooting plays.
- Real play types that slip through the string tests (measured over 2,607 games): `"Offensive Charge"` (1,652 plays, a personal foul that is **not counted**), `"Traveling"` (3,035 plays, a turnover that is **not counted**), `"Double Personal Foul"` (50, only the first player is charged). Team rebounds arrive as `"Offensive Rebound"` / `"Defensive Rebound"` with an empty `participants` and text like `"Rockets offensive team rebound"`.

### 6.4 Pass 2 — who was on the floor (337–383)

Done per period, periods in ascending order. Within a period the plays are **re-sorted by clock, descending, stable on feed order** (342), because "feeds sometimes list a period's plays slightly out of clock order".

**Step A, period-start five (343–366).**
Walk the period's plays in that order keeping `entered` (players who came in by a substitution this period) and `seen` (ordered list):
- substitution with ≥2 participants: the leaving player `parts[1]` is added to `seen` if he has not `entered` this period (he must have been on since the period started); then the entering player `parts[0]` is added to `entered`;
- any other play: each of the **first two participants** is added to `seen` if he has not `entered`.

Then per team (team = most-tagged abbreviation; records without a team are skipped): take the first **five** `seen` players. If a team has fewer than five, top up from `prevEnd` (the players on the floor when the previous period ended, in insertion order), skipping anyone who `entered` by substitution this period or is already in. Nothing guarantees five.

**Step B, replay (367–380).**
`on` = Map(player → clock seconds at check-in), initialised to `periodLen(per)` (720 or 300) for the period-start players. For each substitution in clock order, with `c = clockSec(p.clock)`:
- if the leaving player is in `on`: `q[per] += max(checkIn − c, 0)` seconds, a stint `[elapsed(checkIn), elapsed(c)]` is pushed (minutes, 2 dp, only if `checkIn > c`), and he is removed;
- the entering player is **always** set `on` at `c` (even if the leaving player was not tracked, and overwriting an earlier check-in if he was wrongly assumed on).

At the end of the period: `endC = clockSec(curClock)` if `per === curPeriod` (strict equality), else 0. Everyone still on gets `max(checkIn − endC, 0)` and a closing stint. `prevEnd` = everyone still on. If `per === curPeriod`, those players are flagged `on: true`.

**Minutes are purely inferred**: there is no official minutes field anywhere in this path.

### 6.5 What happens with missing or odd substitutions

- **Silent quarter-break changes** (the normal case: the feed does not list them): handled by Step A. A player who starts a quarter without a substitution line is picked up the first time he appears in a play, or when he is subbed out. (run)
- **A player who plays a stretch from the period start without any recorded event and is never subbed out in that period** is invisible to `seen`. He only gets the period if he finished the previous period on the floor and a slot is left.
- **A missing "out" line mid-period**: the player stays `on` to the end of the period (over-credited) and is carried into the next period through `prevEnd` unless five others are seen first.
- **A missing "in" line mid-period**: if the player then appears in a play he is treated as on since the period start, and the team may have more than five `seen`; only the first five are kept, so a quiet genuine starter of that period can lose his whole stint.
- **A substitution line with fewer than two participants** gives no names in pass 1 and moves nobody in Step B, but Step A (line 350–351) treats its lone participant like any play participant, i.e. assumes he was on the floor since the period started.
- **Bench technicals / ejections** have participants, so a bench player with a named record can be wrongly put in the period-start five.
- **No normalisation**: team minutes are never forced to 5 × period length, and nothing checks that exactly five are on.
- **Scoreboard period ahead of the plays** (state says period 3 at 12:00, no period-3 play yet): `per === curPeriod` never fires, so **every player comes back `on: false`** and no minutes accrue for the new period. (run)
- **Plays from a period later than `curPeriod`** (feed ahead of the scoreboard) are credited to the end of that period (`endC = 0`).
- `curPeriod` must be the same type as `p.period` (number).

### 6.6 Output

```
{ players: { [pid]: {
      pid, name, team,                 // team = most-tagged abbreviation
      pts, reb, oreb, ast, fg3m, fg3a, fga, fgm, fta, ftm, tov, pf, tech,
      ejected,                         // bool
      pfAt: [minute, ...],             // elapsed game minute of each personal foul, 2 dp, in feed order
      z: { rim:[att,made], mid:[att,made], three:[att,made] },   // only zones with attempts
      min,                             // total minutes (float)
      qmin: { '1': minutes, '2': ..., '5': ... },   // only periods he played; overtime periods are '5', '6', ...
      on,                              // on the floor at (curPeriod, curClock)
      stints: [[inMinute, outMinute], ...]   // elapsed game minutes, sorted; stints that touch (gap < 0.02 min) are merged, so a player on the floor across a quarter break has one stint
  } },
  teams: { [abbr]: { fga, fta, oreb, dreb, tov, pts, fg3a, fg3m, fgm, ast, poss } } }
```

- Only records with a name and a team are returned. Players with 0 minutes are returned here (they are dropped later by `logEntry`).
- `poss = fga + 0.44*fta − oreb + tov` (402), where `oreb` includes team offensive rebounds.
- `teams` has one key per abbreviation seen on any counted play (never a third key in the cached games).
- The internal fields `teams` (tag tally), `q`, `st` are deleted from each player.

Call sites: live `boxFromPlays(o.plays, st.period, st.clock)` (1505); finished game `boxFromPlays(plays, st.period, '0:00')` (425); nightly checkpoints `E.boxFromPlays(plays.filter(p => p.period <= k), k, '0:00')` (`app.js` 227).

### 6.7 Measured on the cached games

**Play-derived box (`logEntry().rows`) against the official DataBallr player game logs, per player-game** (`a2.js`). "Ratio" = engine total ÷ official total over all matched player-games.

| Stat | 2026-27 (154 games, 3,057 player-games) | 2025-26 (1,231 games, 25,992) | 2024-25 (1,222 games, 23,560) |
|---|---|---|---|
| minutes | ratio 0.9998; within 0.25 min: 99.6% | 0.9998; within 1 min: 99.7% (official minutes are whole numbers for part of this season) | 1.0207; off by 3+ min: 12.8% |
| points | 0.9999; exact 100.0% | 1.0003; exact 99.8% | 1.0236; off by 2+: 8.0% |
| rebounds | 1.0000; exact 99.3% | 1.0001; 99.2% | 1.0001; 99.3% |
| assists | 0.9996; exact 99.5% | 0.9993; 99.5% | 0.9590; 91.8% |
| **3PM** | **0.9011; exact 89.3%** | **0.9175; exact 91.1%** | 1.0056; 92.1% |
| **3PA** | **0.8976; exact 73.7%** | **0.9213; exact 79.4%** | 0.9813; 86.0% |
| FGA | 1.0052; exact 95.5% | 1.0053; 95.5% | 1.0149; 89.7% |
| FTA | 1.0000; exact 99.9% | 1.0000; 99.9% | 1.0000; 100.0% |
| **turnovers** | **0.9587; exact 94.3%** | **0.9616; 95.0%** | 0.9828; 90.8% |
| offensive rebounds | 1.0000; 99.7% | 1.0001; 99.7% | 1.0000; 99.8% |
| players in the official box but missing from `rows` | 0 | 12 | 1,977 (15.6 min each on average) |

**Feed audit** (`a1.js`, `a5.js`):

| Measure | 2026-27 | 2025-26 | 2024-25 |
|---|---|---|---|
| made threes (`score_value === 3`) whose text lacks "three point" | 10.1% | 8.3% | 3.3% |
| missed shots from 23+ ft whose text lacks "three point", as a share of missed threes | 7.6% | 4.9% | 0.5% |
| team-games where player minutes differ from 5 × game length by > 0.5 min | 1.9% | 0.8% | 32.0% (mean error 8.7 min) |
| games where the plays' points differ from the scoreboard | 0 of 154 | 19 of 1,231 | 684 of 1,222 |
| shooting plays with no participants | 0 | 97 of 278,268 | 9,804 of 271,007 (3.6%) |
| substitutions with fewer than 2 participants | 0 | 149 of 76,588 | 8,648 of 70,035 (12.3%) |
| team offensive rebounds per team-game | 6.96 | 6.49 | 6.42 |
| … of which right after a non-final free throw (dead ball) | 2.60 | 2.54 | 2.36 |
| "Offensive Charge" per team-game (uncounted fouls) | 0.35 | 0.30 | 0.33 |
| "Traveling" per team-game (uncounted turnovers) | 0.64 | 0.53 | 0.63 |
| league pace per 48 as `teamContext` computes it | 95.1 | 95.5 | 91.4 |
| DataBallr league `Pace` for the same season | 99.5 | 99.4 | not checked |

**Which three-point rule recovers the official count** (`a4.js`):

| Rule for "is a three" | 2026-27 3PM ratio / exact | 2026-27 3PA ratio / exact | 2025-26 3PM ratio / exact | 2025-26 3PA ratio / exact |
|---|---|---|---|---|
| text contains "three point" (today, line 291) | 0.9011 / 89.3% | 0.8976 / 73.7% | 0.9174 / 91.1% | 0.9212 / 79.3% |
| … or made with `score_value === 3` | 1.0000 / 100.0% | 0.9321 / 80.6% | 1.0002 / 99.9% | 0.9509 / 85.5% |
| … or missed from 23+ ft | 1.0000 / 100.0% | 0.9810 / 93.2% | 1.0002 / 99.9% | 0.9813 / 92.7% |
| … or missed from 22+ ft | 1.0000 / 100.0% | 0.9881 / 93.0% | 1.0002 / 99.9% | 0.9877 / 92.5% |

The remaining ~2% of 3PA are missed threes whose text has no distance at all (e.g. "misses running pullup jump shot"); `coordinate_x` / `coordinate_y` are in the row and were not tested.

---

## 7. `scoringEvents(plays)` (407–420) and `logEntry(game, plays)` (423–440)

### `scoringEvents`

For each play with `shooting_play`, text containing `" makes "`, a truthy `score_value` and a team abbreviation:
`[ elapsedMinutes (2 dp), teamAbbr, points, scorerId ]` with `scorerId = +participants[0]` or `null`. Sorted by time.

### `logEntry(game, plays)` — the object the phone caches per finished game, and what `projectGame` takes as `o.logs`

`st = gameState(game)`; `{players, teams} = boxFromPlays(plays, st.period, '0:00')`.

```
{
  id:     st.id,                         // game id
  date:   game.date,                     // "YYYY-MM-DD" US game date, straight from the game row
  v, h:   st.v, st.h,                    // visitor / home abbreviations from the game row
  len:    48 + 5 * max(0, st.period − 4),      // game length in minutes (58 for a double-overtime game; matched the plays in all but 1 cached game)
  margin: { [v]: vs − hs, [h]: hs − vs },      // FINAL margin from the scoreboard row, signed per team
  teams:  { [abbr]: { fga, fta, oreb, dreb, tov, pts, fg3a, fg3m, fgm, ast, poss } },   // from the plays
  rows:   { [pid]: {                     // only players with min > 0
      name, team,
      min,                               // 2 dp
      qmin: { '1': .., '2': .., ... },   // 2 dp
      pts, reb, ast, fg3m, fg3a, fga, fta, ftm, tov, pf,
      oreb, fgm,
      st:   [[in, out], ...],            // the merged stints (elapsed game minutes)
      pfAt: [minute, ...],
      z:    { rim:[att,made], mid:[..], three:[..] } | undefined   // dropped by JSON when undefined
  } },
  sc:     [[minute, side, points, scorerPid], ...]    // side 0 = visitor, 1 = home; sorted by time
}
```

Not stored: `tech`, `ejected`, `on`, per-play detail, the date-time, the quarter scores.

Who reads what downstream:

| Key | Read by |
|---|---|
| `v`, `h` | 1478 (keep logs involving either of tonight's teams); 1006 (`sitAgg` side) |
| `date` | 1511 (history order), 1534 (most recent game per team → "missed last game"), 1540 (back-to-back), 999–1017 (`sitAgg`) |
| `margin[team]` | 1512 (copied into each history row as `margin`), 1534/1540 (`tm in l.margin` = "this team played"), 618–639 (`coachHabits` buckets), 1749 (close-game quarter pattern, abs(margin) < 15) |
| `len` | 581, 585 (`teamContext` minutes), 1006 (`sitAgg` clutch window) |
| `teams[abbr]` | 577–585 (`teamContext`), 1668–1673 (player usage: team plays while he was on) |
| `rows[pid]` | everything per player: `min`, `qmin`, `st`, `pfAt`, `z`, counting stats; `patGrade` uses `rows` of the finished game as the truth |
| `sc` | `sitAgg` only (1005–1040); `e[3] !== +pid` means pids must be numeric |

Cache key on the phone: `log:v5:<gameId>` (`data.js` 361). The live app passes, per team, up to **8** finished games from the **21 days strictly before** the slate date (`data.js` `teamLogs`, 337–354; a team can get a 9th when its opponent still needs games).

---

## 8. Player priors (lines 444–491)

`num(x)` (444): `null` for `null`, `''` or non-finite; else `+x`.

### `profileOf(r)` (446–454) — display only

`{ ts: TS_pct, sq: adj_shot_quality, rim: RimFGPerc, smid: ShortMidFGPerc, lmid: LongMidFGPerc, potAst100: 'PASSING_Potential Assists/100', potAstMin: PASSING_POT_AST_PER_MIN, onBall: 'PASSING_on-ball-time%', stl100: Steals_100, blk: Blocks_PG, orb: OffFGReboundPct, drb: DefFGReboundPct, onoff: netrtg_on_off, pts75: Pts75, creation: creation_TSA, dRim: d_AtRimFGA_PerGame, dSmid: d_ShortMidRangeFGA_PerGame, dLmid: d_LongMidRangeFGA_PerGame, d3: d_FG3A_PerGame }` (all through `num`).
The only engine read is `lp.prof.rim != null` at 1719, where both branches give 0.45, so it has **no effect** on numbers.

### `slimStats(rows)` (456–474)

Input: the **bare array** from `/v1/nba/players/stats?year=<end year>&playoffs=0&limit=1000` (measured: 462 rows × 454 fields for 2027, 500 rows for 2026, one row per player, no duplicate normalised names). Rows without a truthy `GamesPlayed`, `MPG` or `Name` are skipped. Output is keyed by `norm(r.Name)`; a later row with the same normalised name would overwrite the earlier one (run).

DataBallr fields read: `Name`, `TeamAbbreviation`, `GamesPlayed`, `MPG`, `OffPoss`, `3PA_100`, `3P_PERC`, `2P_PERC`, `FT_PERC`, `basic_PPG`, `basic_REB`, `basic_APG`, `TSA100`, `basic_TOVPG`, `3PR`, `FTR`, `Age`, `nba_id`, `RowId`, `Pos2`, `Offensive Archetype`, plus the `profileOf` fields.

Output per player:

| Key | Formula | Used by the engine |
|---|---|---|
| `name`, `team` | `Name`, `TeamAbbreviation` | display |
| `gp`, `mpg` | `GamesPlayed`, `MPG` | `gp`: merge weight, turnover rate; `mpg`: minutes when the player has no logs (1746) |
| `pts` | `basic_PPG / MPG` (points per minute) | 1832 `ratePM` |
| `reb` | `basic_REB / MPG` | 1734 (reb rate prior), 1832 |
| `ast` | `basic_APG / MPG` | 1734, 1832 |
| `fg3a` | `3PA_100 * OffPoss / 100` (season total 3PA) | 1705: weight of his own 3P% vs 60 league attempts |
| `fg3m` | `fg3a * 3P_PERC / gp / mpg` (threes per minute) | 1832 |
| `p3`, `p2`, `ft` | `3P_PERC`, `2P_PERC`, `FT_PERC` (fractions in the real feed, e.g. 0.399) | 1705–1707 shooting priors |
| `tsa100` | `TSA100` (true shot attempts per 100 **on-court team possessions**) | 1679–1681 usage prior |
| `tovpg` | `basic_TOVPG` | 1680 |
| `offPoss` | `OffPoss` (season on-court offensive possessions; 769 for a 36-mpg player after 10 games) | 1679–1680 |
| `r3`, `ftr` | `3PR`, `FTR` | 1701: shot mix when the logs hold fewer than 8 plays for him |
| `age` | `Age` (**null for every row of the current-season file**, present in last season's) | 1548 / 1550 back-to-back rest flags |
| `nba_id` | `nba_id || RowId || null` (NBA.com id) | key for fetching game logs (`app.js` 132–136) |
| `pos` | `Pos2` (`PG`, `SG`, `SF`, `PF`, `C`, `PF-C`) | 1838–1849 position group: contains `C` → C, `PF`/`SF` → F, else G |
| `arch` | `'Offensive Archetype'` | display |
| `prof` | `profileOf(r)` | display |

Usage prior built from this at 1679–1681: `usgPrior = (tsa100 + 100 * tovpg / (offPoss / gp)) / 100`. This is plays per **team possession**, not a share of team plays: its possession-weighted league mean is 0.227–0.229, i.e. five players sum to 1.14, not 1.00 (measured; see §15 W1).

Name join quality (measured, `a3.js`): of all minutes played in 2026-27 games, 0.1% belong to players with no row in this season's file by `norm(name)`, 10.0% to players with no row in last season's file (rookies and newcomers), 0.0% to players in neither. For 2025-26: 0.7%, 13.4%, 0.37%.

### `mergePrior(last, cur)` (477–491)

```
if (!cur || cur.gp < 3)  return last || null        // this season ignored until 3 games; a rookie with <3 games has no prior at all
if (!last)               return cur                  // no shrink toward league for a first-year player
w = cur.gp / (cur.gp + 12)                           // 3 gp → 0.20, 6 → 0.33, 12 → 0.50, 24 → 0.67, 41 → 0.77
out = { ...last }
for k in [pts, reb, ast, fg3m, mpg, p3, p2, ft, tsa100, r3, ftr]:
    out[k] = cur[k] == null ? last[k] : last[k] == null ? cur[k] : w*cur[k] + (1−w)*last[k]
out.fg3a = (cur.fg3a || 0) + (last.fg3a || 0)        // SUM of both seasons' attempts
tovRate(x) = x.tovpg / (x.offPoss / x.gp)            // turnovers per own on-court possession
tr = w*tovRate(cur) + (1−w)*tovRate(last)   (or tovRate(last) if either is missing)
out.tovpg = tr * (last.offPoss / last.gp)            // re-expressed on LAST season's possessions-per-game
for k in [nba_id, pos, arch, prof, team]: if cur[k] != null, out[k] = cur[k]
```

Kept from `last` untouched: `name`, `gp`, `offPoss`, `age`. (run)

Called once per rostered player at 1662: `mergePrior(last[norm(name)], cur[norm(name)])`.

---

## 9. `slimTeams(j)` (lines 498–528)

Input: the JSON of `/v1/nba/teams/stats?year=<end year>`. Real shape (measured): `{ team: {stat_type:'team', season, team_data:[30 rows × ~225 fields], league_avg, updated_at, leverage_filter}, opponent: {stat_type:'opponent', ...}, season, is_batch, leverage }`.

Candidate blocks, in order: `j.team`, `j` itself, `j.opponent`; a block qualifies if it has an array `team_data`. The first block whose `stat_type !== 'opponent'` is used, else the first block (run: if only the opponent block exists it is used as if it were the team's own numbers; `statType` in the output shows it).

Returns `{ teams: { ABBR: T }, league: T(block.league_avg), statType, season }`, or `{ teams: {}, league: null }` when no block qualifies. The result carries the `season` the server answered for, so a harness can assert it got the season it asked for (one sample file in the scratchpad named for 2026 held `season: 2027`; the request behind it is not known).

`T` for one row `r` (all through `num`):

| Key | Formula |
|---|---|
| `name` | `r.Name` |
| `g` | `SecondsPlayed / 2880` if present, else `OffPoss / Pace`, else 0; 2 dp |
| `pace` | `Pace` or null |
| `ortg` | `100 * Points / OffPoss` |
| `drtg` | `100 * OpponentPoints / DefPoss` |
| `efg`, `ts`, `fg2`, `fg3` | `EfgPct`, `TsPct`, `Fg2Pct`, `Fg3Pct` |
| `tov100` | `100 * Turnovers / OffPoss` |
| `ast`, `stl`, `blk` | `Assists / g`, `Steals / g`, `Blocks / g` |
| `orb`, `drb` | `OffFGReboundPct`, `DefFGReboundPct` |
| `rimF`, `rimA` | `AtRimFrequency`, `AtRimAccuracy` |
| `smidF`, `smidA` | `ShortMidRangeFrequency`, `ShortMidRangeAccuracy` |
| `lmidF`, `lmidA` | `LongMidRangeFrequency`, `LongMidRangeAccuracy` |
| `c3F`, `c3A`, `a3F`, `a3A` | `Corner3Frequency`, `Corner3Accuracy`, `Arc3Frequency`, `Arc3Accuracy` |
| `fta` | `FTA / (FG2A + FG3A)` |
| `sq` | `ShotQualityAvg` |
| `secOff`, `secDef` | `SecondsPerPossOff`, `SecondsPerPossDef` |

`g` is not a count of games: full-season 2025-26 teams come out at about 72.7 (of 82), so DataBallr's team numbers leave out roughly 11% of game time (the block carries a `leverage_filter`). `g` is only used as a shrink weight.

**The engine only reads `g`, `pace`, `ortg`, `drtg`** (and `league.ortg`): 1494–1501 (blend into `teamContext` pace / net / p2f with `dbTeamW`), 1597–1599 (market total → pace), 1908 / 1919 (top-down team points). Everything else is display.

---

## 10. `gameLineConsensus(rows, gameId, before)` (lines 531–549)

Input rows: `/v1/nba/odds?date=<date>` → `.data`. Real row (measured): `{ id, game_id, vendor, total_value: "239.5" (string), spread_home_value: "-2.5" (string), spread_away_value, moneyline_home_odds (number), moneyline_away_odds, total_over_odds, total_under_odds, spread_home_odds, spread_away_odds, updated_at: "2026-11-10T02:40:00.539Z", deeplinks }`. **Exactly one row per (game, book)**, 11–12 books (polymarket, kalshi, fanduel, fanatics, rebet, draftkings, betway, betparx, betrivers, ballybet, caesars, betmgm). `updated_at` was present on all 95 sampled rows.

Fields read: `game_id`, `updated_at`, `total_value`, `spread_home_value`, `moneyline_away_odds`, `moneyline_home_odds`, `vendor`.

Row filter (534): `+x.game_id === +gameId` (all games if `gameId == null`), and, when `before` is given, `!x.updated_at || String(x.updated_at) <= before` — a **string comparison**, and a row **without `updated_at` always passes**.

Per row:
- total kept if `180 <= total <= 280`;
- home spread kept if `|spread| <= 30`;
- moneylines kept if both `|odds| >= 100` and the implied probabilities sum to between 0.95 and 1.2; `pAway = ia / (ia + ih)` with `implied(o) = o > 0 ? 100/(o+100) : −o/(−o+100)` (line 2199);
- a row that passed at least one check contributes its `vendor` and `updated_at`.

Returns `null` if no row passed anything, else:

```
{ total: median, spreadHome: median, pAway: median,        // each null if no book had it
  books: distinct vendor count, vendors: [...],
  updated: max updated_at (string), totalRange: [min,max] | null, spreadRange: [min,max] | null }
```

Sign convention: `spreadHome` is the home team's line (negative = home favoured) and is used directly as the expected **visitor** margin (1635).

**What the endpoint holds for a finished date (measured on 2026-11-09, fetched the next day):** every row of all eight games was last updated between 2 h 12 min and 3 h after tip, i.e. it is the last in-game line. Examples: LAL @ ATL finished 124–114 (total 238, visitor +10) and the unfiltered consensus is total 241, `spreadHome` +9.5; CLE @ CHA finished 112–124 (total 236, visitor −12) and the consensus is 238.5, −11.5. With `before` = tip the function returns `null` for all eight games. For 2025-10-21, 2026-03-01 and 2026-10-21 the endpoint returned an empty list.

How the app calls it (`data.js` 184–195): pregame `gameLineConsensus(rows, game.id)` and the result is saved on the phone (`glines:<id>`); once the game has tipped the saved pregame read is reused; only if nothing was saved does it call `gameLineConsensus(rows, game.id, new Date(game.datetime).toISOString())`, which the measurement above shows returns `null`. The nightly learning passes `market` only if it has a total (`app.js` 257–258) and sets `tdOff` otherwise (`worker.js`). So the app is protected by `before`, and learns with a market line only for games the phone happened to see pregame.

---

## 11. `slimGameLogs(rows, keep = 10)` (lines 552–570)

Input rows: `/v1/nba/players/game-logs?nba_id=<id>&year=<end year>&limit=20` → `.data`. Real row (measured): official box and advanced numbers per game — `MIN` (decimal minutes), `PTS`, `REB`, `OREB`, `DREB`, `AST`, `FGM`, `FGA`, `FG3M`, `FG3A`, `FTM`, `FTA`, `STL`, `BLK`, `TOV`, `PLUS_MINUS`, `POSS`, `USG_PCT` (fraction, e.g. 0.368), `TS_PCT`, `REB_PCT`, `SCREEN_AST`, `TeamAbbreviation`, `OpponentAbbreviation`, **`date` as a number `20261107`**, `bdl_game_id`, `bdl_player_id`, `nba_id`, `player_name`, `playoffs`, `year`. No personal fouls. The tracking fields (`POTENTIAL_AST`, `TIME_OF_POSS`, `CATCH_SHOOT_*`, `PULL_UP_*`) were `null` and listed under `unsupported_fields` in the sample.

1. Keep rows with `MIN > 0`; sort by `String(date)` descending; take the first `keep`.
2. Per game: `{ date (String(date).slice(0,10), so "20261107"), opp: OpponentAbbreviation, team: TeamAbbreviation, min: MIN, pts: PTS, reb: REB, ast: AST, fg3m: FG3M, fg3a: FG3A, fga: FGA, stl: STL, blk: BLK, tov: TOV, pm: PLUS_MINUS, usg: pctN(USG_PCT), ts: pctN(TS_PCT), potAst: POTENTIAL_AST, top: TIME_OF_POSS, poss: POSS, cs3a: CATCH_SHOOT_FG3A, cs3p: pctN(CATCH_SHOOT_FG3_PCT), pu3a: PULL_UP_FG3A, pu3p: pctN(PULL_UP_FG3_PCT), rebPct: pctN(REB_PCT), scrAst: SCREEN_AST }`; `pctN(x)` divides by 100 when `x > 1.5`.
3. Returns `{ n, games (newest first), avg }` where `avg` has plain means of non-null values for `min, pts, reb, ast, fg3m, potAst, top, cs3a, pu3a, scrAst` and **minutes-weighted** means for `usg, ts, cs3p, pu3p, rebPct`.

**There is no as-of-date argument.** The engine reads only `gl.n` and `gl.avg.usg` (1687–1689). `USG_PCT` is the official usage (share of team plays while on the floor), the same scale as the engine's log usage. `app.js` 165 also uses `games[0].team` to decide which game a player's log belongs to. `projectGame` expects `o.gameLogs = { [norm(name)]: slimGameLogs(...) }`, keyed by the play-by-play name.

The play-by-play name and this feed's `player_name` differ after `norm()` for a few players (measured): Ace Bailey / Airious Bailey, Bones Hyland / Nah'Shon Hyland, Nic Claxton / Nicolas Claxton, Alex Sarr / Alexandre Sarr, Yang Hansen / Hansen Yang, Nigel Hayes-Davis / Nigel Hayes. The app avoids this by fetching logs by `nba_id` and keying them by the projection's own name.

---

## 12. `teamContext(logs, abbr)` (lines 573–607)

Loops over every log where `lg.teams[abbr]` exists; the opponent is the first other key of `lg.teams`. With `M` = own team totals, `O` = opponent totals:

Accumulators: `g` games; `poss += (M.poss + O.poss)/2`; `mins += lg.len || 48`; `oppPts`, `oppPoss`; opponent `fg3a`, `fg3m`, `fga`; `plays += M.fga + 0.44*M.fta + M.tov`; `ownPoss`, `ownPts`; `reb += M.oreb + M.dreb + O.oreb + O.dreb`; assists for and against (only when both sides have `ast`); zone attempts / makes of every opponent player row with `z`.

Output (run on synthetic logs):

| Key | Formula | Default with no games |
|---|---|---|
| `games` | `g` | 0 |
| `pace` | `(Σ avg possessions / Σ game minutes) * 48` | `LEAGUE.pace` = 99 |
| `drtg` | `100 * Σ oppPts / Σ oppPoss` | 114.5 |
| `opp3p` | opponents' 3PM / 3PA | 0.36 |
| `p3f` | `1 + k * 0.5 * (opp3p / 0.36 − 1)`, `k = g / (g + 8)` | 1 |
| `p2f` | `1 + k * 0.5 * (drtg / 114.5 − 1)` | 1 |
| `playsPerPoss` | `clamp(Σ plays / Σ ownPoss, 1.03, 1.2)` | 1.1 |
| `net` | `g/(g+10) * 100 * (ownPts − oppPts) / max((ownPoss + oppPoss)/2, 1)` | 0 |
| `rebPM` | rebounds by both teams per game minute | null |
| `astPM`, `astAllowPM` | own / allowed assists per game minute | null |
| `oppZone` | `{ rim:[att,made], mid:[att,made], three:[att,made] }` allowed, summed | null |
| `zoneGames` | games where an opponent row had `z` | 0 |

Because `poss` subtracts dead-ball team rebounds and misses travelling turnovers, this `pace` runs about 4% below DataBallr's (95.1–95.5 vs 99.4–99.5 league-wide, measured), `drtg` about 4% above, and `playsPerPoss` high enough to hit the 1.2 clamp for some teams (one real game: 1.12 and 1.204).

Downstream:
- `pace` → `seasonPace = (pace_v + pace_h)/2` (1592), then blended with the market pace and the live pace.
- `net` → margin drift (1634).
- `p2f`, `p3f` of the **opponent** multiply the player's 2P% and 3P% (1725–1728).
- `playsPerPoss` → plays per remaining possession (1916, 2037).
- `rebPM`, `astPM`, `astAllowPM` → environment factors, currently neutralised by `envW = 0`.
- `oppZone`, `zoneGames` → zone matchup, currently neutralised by `zoneW = 0`.
- Before use, `projectGame` overwrites `pace`, `net`, `p2f` with a blend toward DataBallr team stats (1492–1503) and keeps the originals in `paceLogs`, `netLogs`.

---

## 13. `coachHabits(logs, abbr)` (lines 610–648)

1. `mins[name]` = that player's `min` in every log row with `team === abbr` (keyed by **name**).
2. `starters` = names with mean minutes ≥ 24.
3. For each log where the team played (`abbr in lg.margin`): `m` = the team's **final** margin; `s` = the Q4 minutes (`qmin[4] || 0`) of the starters who played; bucket: `|m| <= 10` → close, `m >= 18` → lead, `m <= −18` → trail, otherwise ignored. The bucket gets `mean(s)`.
4. Coach level:
   - `close` = mean of the close bucket, default **8** minutes;
   - `lead` = `clamp(mean(lead bucket) / max(close, 1), 0.02, 1.1)`, default **0.3**;
   - `trail` = `clamp(mean(trail bucket) / max(close, 1), 0.1, 1.2)`, default **0.75**.
5. Player level, for every name with mean minutes ≥ 20: own Q4 minutes in close (`pc`), lead (`pl`) and trail (`pt`) games he played in.
   - `base = max( pc.length ? (pc.length*mean(pc) + 2*close) / (pc.length + 2) : close, 1 )`
   - `sh(xs, prior) = xs.length ? (xs.length * clamp(mean(xs)/base, 0, 1.3) + K*prior) / (xs.length + K) : prior`, `K = TUNE.blowPK = 4`
   - `players[name] = { lead: sh(pl, lead), trail: sh(pt, trail), nLead, nTrail, q4Lead: mean(pl) | null, q4Close: base, proof }`
   - `proof = (nLead + nTrail >= 1) && lead >= TUNE.immuneLead (0.6) && trail >= 0.75`
6. Returns `{ lead, trail, players, samples: { close, lead, trail } }` (sample counts).

How it is applied (1804–1816): `starter = mpg >= 24`; `hab` = the player's own entry if `blowPlayer` and it exists, else the coach's. Per simulation, with `am = |mQ3|` (simulated margin at the **end of Q3**) and `lead` = sign for his team:
- `am >= 20`: starters `q4 * (leading ? hab.lead : hab.trail)`; non-starters `q4 * (leading ? 1.9 : 1.3)`;
- `15 <= am < 20`: starters `q4 * (leading ? (1 + hab.lead)/2 : 0.9)`; non-starters `q4 * 1.15`.

Example (run, 5 synthetic games): close Q4 9 and 10, one +22 with Q4 2, one −25 with Q4 4 → `lead 0.2105`, `trail 0.4211`, `q4Close 9.5`.

---

## 14. Harness recipe

```js
const Engine = require('/home/claude/work/baseline/cs/engine.js');

// one log entry per finished game (pure function of that game)
const entry = Engine.logEntry(gameRow, playsOfThatGame);

// a checkpoint of a finished game, exactly as the app's nightly learning builds it (app.js 224–229)
function gameAt(g, plays, k) {            // k: null = pregame, 1 = end of Q1, 2 = half, 3 = end of Q3
  if (k == null) return { game: { ...g, status_state: 'scheduled', period: 0, time: '', visitor_team_score: 0, home_team_score: 0 }, plays: [] };
  const ps = plays.filter((p) => p.period <= k);
  const bx = Engine.boxFromPlays(ps, k, '0:00');
  const v = g.visitor_team.abbreviation, h = g.home_team.abbreviation;
  return { game: { ...g, status_state: 'in', period: k, time: k === 2 ? 'Half' : `End of ${k === 1 ? '1st' : '3rd'}`,
                   visitor_team_score: (bx.teams[v] || {}).pts || 0, home_team_score: (bx.teams[h] || {}).pts || 0 }, plays: ps };
}

const proj = Engine.projectGame({
  game, plays,                               // from gameAt()
  logs,                                      // logEntry[] — see rules below
  priors: { last: Engine.slimStats(prevSeasonRows), cur: Engine.slimStats(thisSeasonRowsAsOf) },
  injuries: [],                              // DataBallr injury rows: { status, player: { id } }
  nsims: 2000, seed: game.id,
  overrides: { in: [], out: [] },
  teams: Engine.slimTeams(teamStatsJsonAsOf),              // optional
  market: null, tdOff: true,                 // no pregame DataBallr line exists for past games (§10)
  gameLogs: { [Engine.norm(playName)]: Engine.slimGameLogs(rowsBeforeGameDate) },   // optional
  avail: null,                               // ESPN lineup report { in, out, doubt, confirmed, complete, report, source }
  patterns: null,                            // learned layer; null = plain model
  sitPrior: {},                              // pass explicitly; see rules below
});
```

Truth: the app grades itself against `Engine.logEntry(game, allPlays).rows[pid]` (`patGrade`), i.e. its **own play-derived box**. That box is exact for points, rebounds and assists but 8–10% short on threes (§6.7). A harness that wants to match how props settle should grade against the official game logs (`PTS`, `REB`, `AST`, `FG3M`, joined on `bdl_game_id` + `bdl_player_id`).

What `projectGame` does **not** do for you:

1. **`logs` are not date-filtered.** Line 1478 only keeps logs involving either team. Pass only games strictly before the game date. To reproduce the live app, pass at most 8 most recent games per team within the previous 21 days. Passing a longer history changes the model: minutes and the quarter pattern are recency-weighted (`minDecay`), but usage, shooting, rebound / assist rates and `teamContext` are plain sums over everything passed.
2. **`priors.cur` and `teams` are season-to-date snapshots at fetch time.** For a past game they contain that game and everything after it. Rebuild them as-of the game date (the official game logs make that possible for the counting stats) or leave them out (`cur: {}`, `teams: null`).
3. **`gameLogs`**: filter the raw rows to dates before the game **before** calling `slimGameLogs` (the `date` field is a number like `20261107`).
4. **`market`**: never call `gameLineConsensus` on a past date without `before`; with it you get `null` (§10).
5. **`sitPrior`**: `sitprior.js` says it was "built from 2025-26 play-by-play, 980 games". Using it on 2025-26 games is in-sample.
6. Built-in learned constants (`PAT_PRIOR` line 833, `CAL_PRIOR` line 835, `LAND` line 673) and the TUNE values were fitted on past games (comments cite "Nov 8 backtest, 77 games", "last season (595 games)", "this season's 123 games"); any test on those same games is in-sample.
7. Player ids must be numeric and consistent between `plays[].participants` and `logs[].rows` keys (the engine does `+pid` everywhere). Priors and game logs are joined by `norm(name)` only.
8. **Do not build logs from 2024-25 plays without repair** (§6.7): a third of team-games have wrong minutes and missing players.

---

## 15. Bugs, leaks, inconsistencies, weaknesses

Each item says how it is known. "Measured" numbers are in §6.7 unless given here.

### Bugs confirmed on real data

- **B1. Three-pointers are undercounted by 8–10%** (line 291, measured). `three` is true only when the text contains "three point". Running jumpers, running pull-ups and bank shots are written without it ("makes 24-foot running jump shot", `score_value: 3`). Effects: (a) every player's logged `fg3a` / `fg3m` and tonight's running count are short, so the 3PA share `r3` (1700) and the projected 3PM are biased low against the official number; (b) the truth the app grades and learns 3PM against has the same hole, so the learned layer cannot see it; (c) each mislabelled make is booked as 1.5 two-point makes on one attempt (`f2m = (pts − 3·fg3m − ftm)/2`, 1708), which keeps points roughly whole but inflates 2P%; (d) the zone tallies put those shots in `mid`. Fix shown to work: `three = text has "three point" || (made && score_value === 3) || (!made && distance >= 23)` → 3PM exact in 100.0% of player-games, 3PA within 2%.
  Indicative size on projections (`a6.js`; pregame, 106 games of 2026-27, logs strictly before the date, last-season priors only, no market, no team stats, learned layer off, 400 sims; the 1,667 player-games with ≥ 10 official minutes, which is a selection that pushes every ratio below 1): mean simulated 3PM = 0.81 × official, against 0.93 for points, 0.98 for rebounds and 0.99 for assists. The 3PM number shown to the user (the simulations' middle, `LAND`) = 0.62 × official. Average miss of the shown 3PM: 0.886 against the app's own play-derived truth, 0.979 against the official box. With the built-in learned layer on the 3PM figures are the same (0.80, 0.61, 0.889, 0.982). This run is not the live configuration (no current-season line, no market, no game logs) and has not been repeated with the fix applied.
- **B2. Travelling is not counted as a turnover** (line 321, measured): type `"Traveling"` has no "Turnover" in it. 0.5–0.6 per team-game; play-derived turnovers are 4% below official. Lowers each ball-handler's plays (usage) slightly and team possessions by about 0.6 per game.
- **B3. Charges are not counted as personal fouls** (line 326, measured): type `"Offensive Charge"`, about 0.33 per team-game. `"Double Personal Foul"` charges only the first player. `pf` and `pfAt` drive the foul-rest logic (1768–1776), the `foul` multiplier (1809), foul-outs and the `fouls` / `pfX` learned features.
- **B4. Dead-ball team rebounds are subtracted from possessions** (lines 314, 402, measured): 2.4–2.6 "offensive team rebounds" per team-game follow a missed first free throw and are not rebounds. With B2 this accounts for about 3.2 of the 4.4 possessions per 48 by which the engine's count sits under DataBallr's.

### Bugs seen in the code or on synthetic input (not yet measured on live moments)

- **B5. Scoreboard period ahead of the plays → everyone `on: false`** (379–382, run). At the first seconds of a quarter the rotation model sees every player as sitting, which feeds `match`, `sitFor`, `missed`, `benched` (1779–1793).
- **B6. `gameState` with an empty `time` assumes 12:00 left** (213, 220). In overtime that gives elapsed 41 and left 12 (run). `status_state: 'post'` is not treated as final.
- **B7. A player with no name-giving event is dropped, and so are his minutes** (387). Early in a live game a starter whose only events are fouls or turnovers is missing from the box.
- **B8. `logEntry` drops players with `min <= 0` even if they have stats** (428). Rare in the two recent seasons (0 and 12 missing player-games).
- **B9. `mergePrior` keeps last season's `age`** (482–489) and the current-season file has no ages at all, so the back-to-back rest flags (1548 / 1550) use an age one year stale and never fire for players without a last-season row.

### Leaks of future information

- **L1. Past odds are in-game odds** (measured, §10). Unfiltered, `gameLineConsensus` on a finished date returns a line within a few points of the final score. The app guards with `before`; a harness must too.
- **L2. Nightly learning grades past games with today's priors and team stats** (`app.js` 266 → `worker.js`). `priors.cur` (weight `gp/(gp+12)` in `mergePrior`) and the team ratings already contain the graded game (1–5 days old). The learned corrections are fitted on projections slightly better informed than live ones. A backtest that reuses a current snapshot has the same leak, far larger for older games.
- **L3. `slimGameLogs` has no as-of filter** (554–555).
- **L4. `gameLineConsensus` passes rows with no `updated_at` when `before` is set and compares timestamps as strings** (534). Not triggered in the sample (all rows stamped, same format as `toISOString()`), but nothing enforces it.
- **L5. `sitprior.js` and the baked constants** (§14 items 5–6).
- **L6. `projectGame` trusts the caller for `logs` dates** (1478).
- **L7. Train / serve mismatch rather than a leak:** the nightly learning runs without `gameLogs`, `avail` or `injuries` and usually without `market` (`worker.js` grade job), while live projections use all four.

### Inconsistencies and modelling weaknesses

- **W1. The usage prior is on a different scale from the usage it is blended with** (1679–1685, measured). `usgPrior = (TSA100 + TOV per 100 possessions)/100` is plays per team possession; its league mean is 0.227–0.229 (five players sum to 1.14). Log usage and DataBallr `USG_PCT` are shares of team plays (five sum to 1.00; mean log usage in a real game 0.198). Example: Shai Gilgeous-Alexander 2026-27 prior 0.416 vs official usage 0.350. The team renormalisation to 0.2 (clamped 0.85–1.2) removes the common part, but a player who leans on the prior (few logged games: back from injury, traded, opening weeks) gets up to ~14% more usage than teammates whose usage comes from logs.
- **W2. Blowout habits are learned on the final margin but applied to the end-of-Q3 margin, with different cut-offs.** `coachHabits` buckets by final margin (close ≤ 10, lead/trail ≥ 18, 11–17 ignored; 618–623). The simulation applies the habit to `mQ3` at ≥ 20 (full) and 15–20 (half) (1815–1816). A game that was +22 after three and finished +9 is filed as "close" with tiny starter Q4 minutes; a game tied after three that finished +18 is filed as "lead" with full starter minutes. The log entry already has the scoring timeline (`sc`), so the margin at minute 36 is available. The same final-margin test selects the "close game" quarter pattern (1749).
- **W3. Tiny samples for blowout habits.** With about 8 games per team there are usually 0–2 lead or trail games, so the output is mostly the hard-coded defaults (0.3 / 0.75) and `blowPK = 4` pseudo-games.
- **W4. Two possession scales are mixed** (measured). Log pace (≈95) is blended 50/50 with DataBallr `Pace` (≈99.5) at 1498 and with a market pace on the DataBallr scale (1599–1600), then live pace on the log scale takes over with weight `el/(el+30)` (1603). `playsPerPoss` comes from the log scale (≈4% high, clamp at 1.2 can bind). Net effect, derived from those league levels rather than measured on projections: pregame plays are overstated by roughly 1.5–2.5%, and the implied tempo drifts down during a game for no basketball reason. Log `drtg` works out near 119–121 (league points over the lower possession count) and is compared with the constant 114.5 at 598, so an average defence gets `p2f` ≈ +1% before blending.
- **W5. Defence factors use fixed league constants** (`LEAGUE.ortg` 114.5, `LEAGUE.p3` 0.36; 597–598) rather than the league level measured the same way from the same logs (as is done for zones at 1645–1647). `shotEff = 0.93` is a global haircut of the kind a level error upstream would call for; W1, W4 and this item are candidates, none proven to be the cause.
- **W6. No opponent or venue adjustment in `teamContext`.** Eight games, raw sums, shrunk by `g/(g+8)` (and `g/(g+10)` for net).
- **W7. `mergePrior` blends percentages by games, not attempts** (480–483), and gives a first-year player with ≥ 3 games his raw line with no shrink (479). Three games already move last season's line by 20%. 10–13% of minutes go to players with no last-season row.
- **W8. Minutes are inferred and never reconciled.** In practice this is accurate on clean feeds (99.6% of player-games within 0.25 min in 2026-27) and badly wrong when participant ids are missing (2024-25). Nothing in the engine detects the bad case.
- **W9. `shotZone` ignores the play type** (253, measured: 16–25% of layups / dunks / tips labelled `mid`). No effect today (`zoneW = 0`); it would have to be fixed before the zone matchup is switched on.
- **W10. Name joins** are the only bridge between id spaces. Measured miss rate against the season files is small (0.1–0.7% of minutes), but nothing reports a miss: usage falls back to 0.16, rates to `BENCH_RATE`, position to null.
- **W11. Dead or inert pieces:** `LEAGUE.usg` is never read; `profileOf` has no numeric effect (1719 has identical branches); `envW`, `zoneW`, `astShock`, `b2bEff`, `usgRedistPow`, `closerQ4`, `blowAhead`, `b2bRestAge`, `sitHomeW`, `sitRestW`, `sitFadeW`, `fillPow` are 0, so those code paths are off.
- **W12. `drift = 2` doubles `homeAdv`** as well as the net-rating gap (1634–1638), giving an effective home edge of 5 points per 48 in the model part of the margin path.

---

## 16. Open questions

1. What exactly is wrong with the 2024-25 plays (3.6% of shots and 12% of substitutions without participant ids)? Is it a fixed set of players whose ids are missing, and can they be recovered from the text plus the official game logs?
2. How does DataBallr define `Pace` / `OffPoss` (the `leverage_filter` drops about 11% of game time)? After removing dead-ball rebounds and adding travelling, the engine's count is still about 1 possession per 48 below it.
3. What does the `time` field of a real in-progress DataBallr row look like (the samples only had finished and pregame rows), and can `status_state` take values other than `final` for a finished game?
4. Can `/players/stats` and `/teams/stats` be queried as-of a date? If not, as-of priors have to be rebuilt from the game logs.
5. Is there any source of true pregame lines for past games (the cache has an `espn/odds` folder that was not examined here)?
6. For missed threes whose text has no distance, do `coordinate_x` / `coordinate_y` separate threes from twos reliably?
7. FGA from plays is 0.5% above official in both recent seasons; which play kinds account for it?
8. How often does B5 (period ahead of the plays) happen on live polls, and for how long?
9. Where is the original `scripts/backtest.js` that chose the TUNE values, and on which games?
