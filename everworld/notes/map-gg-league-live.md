# Map: GG Winner real-league live totals model (`league-live.js`)

Read-only map of the LIVE code (baseline, v3.9.0 per `sw.js:2`). Files:
- `baseline/gg/league-live.js` (382 lines, no long lines). Working copy `gg/static/league-live.js` is byte-identical today.
- `baseline/gg/app.js` lines 1520-1752 ("leagues" section) plus 7-10, 42-56, 80-92, 259, 1804-1808.
- Server: `notes/gg-server.pretty.js` (pretty print of `baseline/gg/server/gg.mjs`); line numbers below with prefix `S:` refer to it.
- Everything marked **(verified)** was reproduced by running the baseline file in Node (probes only, nothing written to the lab).

## 1. What it is, in one paragraph
A points-per-minute model that runs on the phone. Rest-of-game scoring rate = blend of the live rate so far and the rate implied by a starting total (`T0`). The projection is points so far + rate x minutes left x a learned late-game shape + a small expected overtime add-on. There are **no possessions and no points-per-possession anywhere in `league-live.js`** (the only possession/PPP code is the server `snapshot`, section 9, which the app never reads). It needs only one `/api/games` row.

## 2. Loading it in Node
UMD wrapper (23-26): CommonJS gets `module.exports = factory()`, browsers get `window.LeagueLive`. No dependencies, no DOM.
```js
const LL = require('/home/claude/work/baseline/gg/league-live.js');
const row = { leagueId: 'nba', status: 'in_progress', period: 2, clock: '6:00', statusDetail: 'Q2',
  home: { score: 45, qScores: [28, 17] }, away: { score: 40, qScores: [25, 15] }, fdTotal: { line: 229.5 } };
const r = LL.project(row, { prior: 228, lines: { game: 229.5, half1: '', half2: '', quarter: { 2: 57.5 } }, minEdge: 3 });
// r.full, r.half1, r.half2, r.periods[], r.markets[], r.why[], r.math, r.progress, r.where
```
Only `whereText` touches the wall clock (`Date.now()`, `toLocaleTimeString`, pre-game state only).

## 3. Exports (line 381)
| Function | In | Out |
|---|---|---|
| `profileFor(game)` 45-50 | `leagueId`, `leagueName` | `{clock:{periods,periodMinutes,otMinutes,usesHalves}, total, blowout, regulation}` |
| `leagueLabel(game)` 53-59 | row | short chip label ("Sweden - Ligan" -> "Sweden", women -> "Spain W") |
| `leagueKey(game)` 61-63 | row | `leagueId`, or `x:<leagueName lowercased>` when id is `other`/missing |
| `parseClock(clock)` 65-75 | `"m:ss"` or number string | minutes as float, `null` for `''`/`'--'`. **No colon = minutes** (bug, section 11) |
| `quarterSums(game)` 79-86 | `home.qScores`, `away.qScores` | combined points per period, length = shorter array |
| `isWomen(game)` 41-43 | `leagueName`, `leagueId` | boolean (`WOMEN_RE` line 35, or id `wnba`/`ncaaw`) |
| `isLive(g)` 77 | `status` | `in_progress` or `halftime` |
| `phi(z)` 180-185 | z | standard normal CDF (Abramowitz-Stegun) |
| `liveWeight(f, fromLine)` 170-177 | game fraction 0..1, whether T0 is a book line | weight on live pace |
| `progress(game, {prior})` 95-167 | row | where the game is (section 5) |
| `project(game, {prior, lines, minEdge=3})` 219-379 | row, starting total, lines `{game, half1, half2, quarter:{n: line}}` (numbers or strings) | full projection + calls (sections 6-8) |

`blowout` in the profile is defined but **never used** by the model.

## 4. League constants (27-34, 45-50)
| leagueId | periods x minutes | regulation | OT min | default total | usesHalves |
|---|---|---|---|---|---|
| `nba` | 4 x 12 | 48 | 5 | 228 | no |
| `gleague` | 4 x 12 | 48 | 5 | 230 | no |
| `wnba` | 4 x 10 (FIBA) | 40 | 5 | 164 | no |
| `ncaam` | 2 x 20 | 40 | 5 | 145 | yes |
| `ncaaw` | 4 x 10 | 40 | 5 | 135 | no |
| anything else | 4 x 10 (FIBA) | 40 | 5 | 160, or 140 if `isWomen` | no |

Server ids that fall into "anything else": `nbl, euroleague, eurocup, bbl, lkl, bcl, lnbp, fiba, other` (S:147-325). The default total is used only when there is no line at all.

## 5. `progress()`: clock and period logic (95-167)
Inputs read from the row: `home.score`, `away.score`, `home/away.qScores`, `status`, `period`, `clock`, `statusDetail`, `periodText`, `isHalftime`, `fdTotal.line`, plus option `prior`.

```
pts   = home.score + away.score
sums  = quarterSums(game); n = sums.length; sumQ = sum(sums)
T0    = num(prior) || num(game.fdTotal.line) || profile.total          (105)
rate0 = T0 / reg                                                        points per minute, both teams
priorFromLine = Boolean(num(prior) || num(game.fdTotal.line))           (107)
```
States:
- `final` (109): `elapsed = reg`, `remaining = 0`.
- `pre` (113): not live and `pts === 0`.
- `halftime` (116-120): `status==='halftime' || game.isHalftime || statusDetail` starts with `ht`/`half`, **only when the league does not use halves**: `current = periods/2 + 1`, `completed = periods/2`, `elapsed = reg/2`.
- `live` otherwise:
```
clockMin = parseClock(game.clock)
hasClock = clockMin != null && (clockMin > 0 || /^(Q|H|OT)\d*/i.test(statusDetail || periodText))     (123)
textQ    = digit after a leading "Q" in statusDetail
if n>0 && sumQ < pts:  completed = n;  current = max(period, n+1)          // list holds finished periods only
else if n>0:           current = max(period, n); completed = current-1      // list includes the period in play
     if !hasClock && current===n && textQ!==n && sums[n-1] >= 0.9*rate0*periodLen(n): completed = n; current = n+1   (135-138)
else:                  current = max(period, 1); completed = current-1
doneMinutes = sum of period lengths 1..completed  (periodLen: regulation length, or otMinutes past cfg.periods)
currentPts  = pts - sum(sums[0..completed))       (null if a needed quarter score is missing)
clock path:      inPeriod = clamp(len - min(clockMin, len), 0, len)                    clockSource 'clock'
estimated path:  r = (donePts/doneMinutes + rate0)/2 if doneMinutes>=1 else rate0
                 inPeriod = clamp(currentPts / r, min(0.5,len), max(len-0.5, 0.5))     clockSource 'estimated'   (157-161)
elapsed = doneMinutes + inPeriod;  inOt = current > cfg.periods
remaining = inOt ? max(len - inPeriod, 0) : max(reg - elapsed, 0)
```
So in no-clock leagues the minutes played in the current quarter are **inferred from the points scored in it** (hot quarter = "more time has passed").

## 6. `project()`: the number (219-282)
### 6.1 Blend ("learned live weights", "line-aware live pace")
```
obsRate = elapsed >= 1 ? pts/elapsed : rate0
fNow    = clamp(elapsed/reg, 0, 1)
w       = (state live or halftime) ? liveWeight(fNow, priorFromLine) : 0
rate    = w*obsRate + (1-w)*rate0                                          (228)
```
`liveWeight(f, fromLine)` (170-177):
- `fromLine = true` (v3.9, "1,223 NBA games with their closing lines"): `f < 0.70 -> 0.03`; `0.70 <= f < 0.75 -> 0.03 + (f-0.70)*1.0`; `f >= 0.75 -> min(0.42, 0.10 + (f-0.55)*0.9, 0.08 + (f-0.75)*2.5)`.
- `fromLine = false` (league default total): `f < 0.25 -> 0.4*f`; `0.25 <= f < 0.55 -> 0.10`; `f >= 0.55 -> min(0.42, 0.10 + (f-0.55)*0.9)`.

Values **(verified)**:
| f | 0 | 0.125 | 0.25 | 0.5 | 0.6 | 0.7 | 0.75 | 0.8 | 0.875 | 0.9056+ |
|---|---|---|---|---|---|---|---|---|---|---|
| no line | 0 | 0.05 | 0.10 | 0.10 | 0.145 | 0.235 | 0.28 | 0.325 | 0.3925 | 0.42 |
| line | 0.03 | 0.03 | 0.03 | 0.03 | 0.03 | 0.03 | 0.08 | 0.205 | 0.3925 | 0.42 |

In overtime `fNow = 1`, so `w = 0.42`.

### 6.2 Late-game shape (229-240)
```
diff  = |home.score - away.score|   (the margin right now)
mLop  = min(diff, 30) / 10
shape(f) = 1                                   f < 0.75
         = 0.886 + 0.033*mLop                  0.75   <= f < 0.875     (first half of the last quarter)
         = 0.870 + 0.038*mLop                  0.875  <= f < 0.9375
         = clamp(1.139 - 0.082*mLop, 0.9, 1.14)  f >= 0.9375            (last 3 min NBA, last 2.5 min in 40-min games)
CUTS = [0.75, 0.875, 0.9375, 1]
between(m0, m1) = sum over cut segments of rate * minutes * shape(segment midpoint / reg)
```
Tied game: 0.886 / 0.870 / 1.139. 30-point game: 0.985 / 0.984 / 0.9. The shape was learned on NBA and is applied unchanged to every league, and uses the current margin for the future last quarter even in the 1st quarter.

### 6.3 Inside-quarter bump (245)
`lateBump(i, into) = rate * len * 0.011 * min(1, u*12, (1-u)*12)`, `u = into/len`; only when the period is 12 minutes long, not the last period, not a halves league and `into > 0`. Peak = `0.132*rate` (about 0.6 points in the NBA), zero at quarter boundaries, so the full-game number saw-tooths by about 0.6-0.7 within each of the first three NBA quarters **(verified: 225.7 at 12:00, 226.4 mid-quarter)**.

### 6.4 Rest of a period, period values, halves (246-268)
```
restOf(i, into) = rate * (otLen - into) * 1.05                       if i is an overtime period
                = between(start_i + into, start_i + len_i) + lateBump(i, into)   otherwise
period value: final -> sums[i-1];  pre -> (T0/reg)*len (even split);  done -> sums[i-1] (or rate*len);
              now -> (currentPts ?? rate*inPeriod) + restOf(i, inPeriod);  next -> restOf(i, 0)
half1 = sum of the first periods/2 period values, half2 = the rest (null for halves leagues; null if any value is null)
```
### 6.5 Full game and overtime (269-282)
```
final -> pts;   pre -> T0
live/halftime -> full = round1( pts + sum(restOf for 'now' and 'next' periods) + pOt * rate * otMinutes * 1.05 )
pOt = 0                      already in overtime
    = 0.09                   fNow >= 0.8 and diff <= 6
    = 0.005                  fNow >= 0.8 and diff > 12
    = 0.034                  everything else (including fNow >= 0.8 with diff 7..12)
```
In overtime only the current OT period is projected (`rate*(5 - into)*1.05`), no further-OT term. Expected OT points in the NBA are about `4.75*5*1.05 = 24.9`, so the add-on is 0.85 (3.4%) or 2.2 (9%) points.

**Tip-off step (verified):** before the game `full = T0` (228). At 12:00 of the 1st quarter, tied, `full = 225.7` and the quarters are `57, 57, 57, 53.9`. The slower last quarter is subtracted but the first three quarters are not raised, so the live number starts about 1% under the line (0.990 x T0 for 48-minute games, 0.991 x T0 for 40-minute games).

## 7. Chance model and call rules (`price`, 284-331)
```
scale  = T0/160;   sdFull = 0.085*T0                                     (NBA 228: 19.4 points)
sd     = max(1.5, sdFull * sqrt(max(remMin, 0.25)/reg) * (estimated clock ? 1.3 : 1) * (pre ? 1.3 : 1))
chance = 1 - phi((L - mean)/sd)        when mean >= L
edgeNeed = round1(minEdge * scale * k),  k = 1 game, 0.67 half, 0.5 quarter   (NBA 228: 4.3 / 2.9 / 2.1 points)
```
`remMin` = minutes left in that market's window (`p.remaining` for the game). Normal curve only: overtime's long tail and FanDuel's price are not in the chance.

Gates, checked in this order (first match wins), each sets `m.pass` and a sentence in `m.text`:
1. `settled`: period/half/game finished.  2. `nodata`: no number.
3. `ot`: game is in overtime, no bet on any market.
4. `late`: live and `remMin < 1`.
5. `early`: live and `elapsed < reg/8` (6 min NBA, 5 min in 40-min games).
6. `pre`: not started, **game market only**.
7. `toofar`: live (not halftime) and `|mean - L| > (estimated ? 0.12 : 0.18) * T0 * windowShare` (windowShare 1 game, 0.5 half, periodLen/reg quarter; NBA game = 41 points).
8. `below`: `mean < L` -> "no play".
9. **Call**: `|gap| >= edgeNeed && chance >= 0.58` -> `m.call = 'Over'` (internal value; the screen prints "PLUS EDGE").
10. `close`: gap too small.

Market object: `{id: 'game'|'half1'|'half2'|'q<n>', label, line, ours, gap, call, chance, text, pass}`.
Because gate 6 covers only the game market, half and quarter markets **can be called before tip-off** from the even split (verified: T0 228, typed Q1 line 54 -> PLUS EDGE at 59%).

## 8. "Why" sentences and fade warning (347-365)
- Pace sentence: `pace = pts/elapsed*reg`, "faster/slower than" when more than 2 points from T0; always worded "FanDuel's line of T0".
- Trust sentence: "We trust the live pace w% and FanDuel's starting number (100-w)%".
- **Fade warning** (357): shown when `obsRate*reg - T0 >= 0.08*T0 && fNow < 0.8` (NBA: pace at least 18 points above the starting total, before the last ~10 minutes). Text only; the fade itself is the low `w`.
- Estimated-clock note (358); close-finish note when `fNow >= 0.9375 && diff <= 6`; lopsided note when `fNow >= 0.7 && diff >= 15`; slow-last-quarter note when `fNow >= 0.7`.
- `math` block returned for "Show the math": `prior` (T0), `rate0` (= T0 again), `liveWeight`, `livePace`, `blendedPace`, `elapsed`, `remaining`.

## 9. How the server feeds it
Routes (S:4822-4837): `GET /api/games` -> `listGames()` (S:2380-2433); `GET /api/games/<id>` -> `getGame()` (S:2434-2485). `POST /api/evaluate` (S:4838) exists but the app never calls it.

`/api/games` response: `{ games: [row], errors, apiBasketball: {enabled, skipped}, fanduelLive: {ok, liveCount, error, sources}, fetchedAt }`.
Row fields: `id, sourceId, source, leagueId, leagueName, leagueAbbrev, name, shortName, status ('scheduled'|'in_progress'|'halftime'|'final'), statusDetail, period, clock, isHalftime, date, home/away {abbrev, name, shortName, score, qScores[]}, periodText` and, **FanDuel rows only**, `fdTotal {line, over, under, status}`.

Row sources and their quirks:
| source (id prefix) | clock | qScores | notes |
|---|---|---|---|
| `fanduel` (`fd:<leagueId>:<eventId>`) S:1516-1572 | `periodRemainingTimeMilliseconds` -> `"m:ss"`, or `''` when FanDuel sends none | `pointsPerPeriod` | `statusDetail` = FanDuel period text (`Q2`, `HT`, `OT`) or `"Live"`; OT period = `4 + n` even for 2-half leagues (S:1419-1425); halftime sets `period: 2` (S:1411); `fdTotal` from market type `TOTAL_POINTS_(OVER/UNDER)` (S:1478-1497). Live games only. |
| `espn` (`espn:<leagueId>:<eventId>`) S:549-583 | ESPN `displayClock` (`"5:32"`, and seconds like `"45.2"` under a minute) | linescores incl. the period in play | `statusDetail` like `"8:32 - 2nd"`, `"End of 1st"`. **No `fdTotal`**, ESPN's own pregame total is not passed on. |
| `euroleague` (`euro:...`) S:804-833 | `''` while in progress | per-quarter from the official feed | always the estimated-clock path |
| `api-basketball` (`apib:...`) S:1048-1094 | `status.timer` | always 5 entries (zeros for unplayed) | switched off on the live server today (`/health`: `apiBasketball:false`) |

Merge (S:2370-2379): FanDuel live rows come first; a row from any other feed is dropped when its two team names (normalised) match a FanDuel live game. So a live NBA game normally appears as an `fd:` row, and as an `espn:` row before tip, after the final, or whenever FanDuel's live list fails.

Server caches: FanDuel in-play boards 6 s, live data 4 s, event page 6 s (S:1189-1191); ESPN scoreboard 15 s (S:590).

`/api/games/<id>` response: `{ game, snapshot, fdLines, league: {id, name, abbrev, clock}, fetchedAt }`. For `fd:` ids `fdLines` = `linesFromMarkets()` of the FanDuel event page (S:1685-1741, 1802-1811): `{game, half1, half2, quarters:{1..4}, homeTotal, awayTotal, spread, moneyline, ...}`, each line `{line, over, under, status, open, marketId}`. Market types: `TOTAL_POINTS_(OVER/UNDER)`, `1ST_HALF_TOTAL_POINTS`, `2ND_HALF_TOTAL_POINTS`, `1ST..4TH_QUARTER_TOTAL_POINTS`. For other sources `fdLines` is `null`.

`snapshot` (S:1905-1988, never read by app.js) is the only possession model: team possessions = `FGA + 0.44*FTA - ORB + TO` (needs `FGA+TO+FTA >= 8` for both teams), pace = possessions x reg / elapsed, PPP = points / combined possessions, both shrunk to league averages (`avgPace` 100 / `avgPPP` 1.14 NBA, 72 / 1.08 FIBA, S:119-146), late factor 0.92 blowout / 0.96 near-blowout / 1.03 close last period / 1.05 OT, `fairGameTotal = pts + pace*remaining/reg*factor*2*ppp`. Box stats exist only for ESPN and EuroLeague rows.

## 10. How app.js feeds it (1520-1752)
- `const LL = window.LeagueLive || null` (1524). Script order in `index.html:299-300`: research.js, league-live.js, profiles.js, app.js.
- `loadLeagues()` (1598-1610): `GET /api/games` -> `S.lg.games`, `S.lg.fdLive`; calls `lgRememberFirstLines(games)`; re-renders list and the open game.
- **Polling: every 30 s, only while the Leagues tab is visible** (1804-1808). The 4-8 s "poll" setting applies to the eBasketball board only.
- **The starting total (`prior`)**: `lgRememberFirstLines` (1533-1547) stores, per `g.id`, the first `g.fdTotal.line` this phone ever saw: localStorage key `lg-first-lines` = `{[gameId]: {line, at}}`, dropped after 2 days, capped at 300 games. `lgPrior(g)` (1548) reads it back. Fallbacks inside `progress()`: current `game.fdTotal.line`, then the league default total.
- **FanDuel's live line (what we compare with)**:
  - List rows, `lgRowCall` (1561-1568): only for live rows that have `fdTotal.line`: `LL.project(g, {prior: lgPrior(g), lines: {game: g.fdTotal.line}})`; shows `r.where` and a "PLUS EDGE" badge when the game market has a call.
  - Detail, `selectLeagueGame` (1612-1638): `GET /api/games/<id>`; `game = {...row, ...d.game, fdTotal: d.game.fdTotal || row.fdTotal}`, `fdLines = d.fdLines || d.game.fdLines`. A failing detail call is skipped for 5 minutes (1619-1631) and the list row is used alone.
  - Line boxes `lg_game, lg_half1, lg_half2, lg_q1..` (`lgBoxes` 1643-1650). Auto values (`lgAuto` 1653-1658): `fdLines.game.line ?? game.fdTotal.line`, `fdLines.half1.line`, `fdLines.half2.line`, `fdLines.quarters[n].line`. Typed values are saved in localStorage `lg-lines:<gameId>` and **win over the auto value until the box is cleared** (`lgFillAuto` 1669-1680).
  - `lgCompute` (1716-1752): `LL.project(D.game, {prior: lgPrior(D.game), lines})`, re-run on every keystroke and every refresh. `minEdge` is never passed (always 3; the Settings "edge" slider does not apply here).
- Rendering: `lgCallCard` (1709-1714) prints "PLUS EDGE <line>" for calls and "NO BET <line>" + `m.text` for every other market; then "Our projection" (full, halves, per-period strip), "Why we think so" (`r.why`), "Show the math" (`r.math`).
- `cls('Over') -> 'over'` (42) is a CSS class only; `api()` runs `plusOnly()` (47-56) on every server body.
- Line status is ignored: `fdTotal.status` and `fdLines.*.open` (suspended market) are never checked.

## 11. Bugs and traps found (all verified in Node unless marked)
1. **The "starting total" is usually a live line, not the pregame line.** FanDuel rows exist only for live games, so the first line a phone sees is whatever FanDuel shows when the tab is first opened. The 3% weights were fitted for closing lines. Example: NBA half-time score 130, pregame 228, FanDuel live 243.5. With `prior = 228` the model says 242.3 (below the line, no play). With `prior = 243.5` (first seen at half-time) it says 249.6 and prints a PLUS EDGE at 66%. The hot start is counted twice. Cold starts go the other way (201.5 instead of 209.3). In private mode `store.set` fails silently, so the prior is the current live line on every refresh.
2. **Clock under a minute on ESPN rows.** `parseClock("45.2")` returns 45.2 minutes, so `inPeriod = 0`: the last minute of every quarter is read as the start of that quarter (elapsed 12 instead of 23.25 in the test). `"5.3"` is read as 5.3 minutes left.
3. **Quarter breaks on ESPN rows.** Clock `0.0` with `statusDetail "End of 1st"` fails `hasClock`, so the estimated path runs: a 46-point 1st quarter gives `elapsed = 9.68` (should be 12), a normal one gives 12.5; the game is labelled "estimated" and the text says FanDuel shows no clock.
4. **League default called "FanDuel's line".** On ESPN rows there is no `fdTotal`; T0 is the flat default (NBA 228) even when the user types FanDuel's line in the box, and the sentences still say "FanDuel's line of 228" / "FanDuel starting total".
5. **Tip-off step of about -1%** (section 6.5).
6. **Pre-game half and quarter calls** from an even split (section 7).
7. **Quarter-finished guess misfires** when the list includes the quarter in play and there is no clock (EuroLeague feed rows): a 2nd quarter that reaches `0.9*rate0*10` points is treated as finished (elapsed jumps to 20.5).
8. **API-Basketball rows are always "in overtime"**: 5 qScores entries -> `current = 5` (dormant: feed is off).
9. **College men at half-time on a FanDuel row** (not confirmed against a real payload): FanDuel half-time sets `period: 2` and halves leagues skip the half-time branch; with clock `0:00` the model reads `elapsed = 40` and projects the half-time score as the final.
10. `WOMEN_RE` misses Spanish "Femenina" (the server regex has it): default total 160 instead of 140 when no line.
11. Step in `pOt` at `fNow = 0.8` (0.034 -> 0.09 for close games, about +1.4 NBA points in one tick) and a 9% flat rate no matter how close or how late.

## 12. Tracker of graded games and refitting the blend
- **There is no tracker for real-league games.** Nothing records the model's number, FanDuel's line or the final for NBA/Europe games, on the phone (only `lg-first-lines` and `lg-lines:<id>`) or on the server.
- The server tracker (S:3771-4380; keys `track/state`, `track/ev/<eventId>`, `track/graded/<YYYY-MM-DD>`, `model/params`, `model/context`; store `supabase-kv`; read via `GET /api/eb/graded?days=1..14` and `/api/eb/performance?days=`) covers **eBasketball only** (its board is filtered by `/e-?basketball|h2h\s*gg/i`, S:1624). Sample cached at `data/eb/probe/graded-14d.json`.
- All league-live weights are hard-coded constants (sections 6-7). The header's evidence ("469 NBA games replayed ... checked on 146 newer", "1,223 NBA games with their closing lines") is not stored anywhere in the repo.
- Refit path that the lab already supports (NBA only):
  - `data/derived/games-{2025,2026,2027}.json.gz`: 1306 + 1316 + 154 games (2024-10-22 .. 2026-11-09), each `{g (quarter scores, final), market: {total = closing total, ...}, espnId}`; all but one have `market.total`.
  - `data/plays/<g.id>.json.gz`: every play with `period`, `clock` (`"m:ss"`, seconds like `"12.0"` under a minute), `home_score`, `away_score`, `wallclock`. All 2776 games have plays.
  - Replay: at each minute (or each scoring play) build a row `{leagueId:'nba', status:'in_progress', period, clock:'m:ss', statusDetail:'Q'+period, home:{score,qScores}, away:{score,qScores}}`, call `project(row, {prior: market.total})`, compare `full` with the final total (overtime included). Same tool, two engines: `baseline/gg/league-live.js` vs `gg/static/league-live.js`.
  - Best weight per game-fraction bucket in closed form: with `x = (obsRate - rate0) * effective minutes left` and `y = final - pts - rate0 * effective minutes left - OT term`, `w* = sum(x*y)/sum(x*x)` (same idea as the server's eBasketball `modelWeight`, S:4195-4212).
  - Split by date. Caution: the live constants were fitted on NBA games up to about Nov 9, 2026, so the baseline may already have seen every game in the cache; only games after the fit date are unseen for both sides.
  - Put any new caches under `data/ll/` (does not exist yet).
- Not possible today: anything that needs FanDuel's **live** line history or non-NBA leagues (no data stored). A server-side log of `{time, score, clock, FanDuel line, our number}` per `fd:` game plus the final is the missing piece.

## 13. Product-rule notes
- Rule 1: no standalone "over"/"under" in any league-live sentence. The word "Overtime" appears (period name 188, sentences 304 and 359). Internal values `'Over'`/`'Under'` and CSS classes `over`/`under` are not shown. **But** the detail screen prints our number against FanDuel's line when we are below it: "NO BET <line>" card with "We expect about X, below FanDuel's line of L ... no play" (320-322, app.js 1713), and the `early` (310), `toofar` (316-318), `ot` (304) sentences and the pace sentence (354) print both numbers whichever side we are on.
- Rule 2: the `toofar` sentence names factors that are not in the number ("injury, foul trouble, a rested star"); the estimated-clock note says "treat these numbers as a little rougher".
- Rule 3: 30-second refresh on the Leagues tab, not every play.
- Rule 4/6: "FanDuel's line of 228" when 228 is the league default; accuracy for non-NBA leagues was never measured (NBA-only fit applied to all).
