# Map: GG Winner server bundle (`baseline/gg/server/gg.mjs`)

Read-only map, written 2026-11-11. Line numbers refer to the pretty-printed copy
`notes/gg-server.pretty.js` (5028 lines, made with prettier from the 2-line bundle).
`gg.cjs.js` is the same code as CommonJS (`module.exports = {...}`); `gg.mjs` adds a
`createRequire` shim and `export default`. The working copy `gg/static/server/*` is byte-identical
to baseline. Tags: **[live]** = checked against the live data server on 2026-11-11,
**[inferred]** = deduced, not read in code.

## 0. Module index (minified name -> meaning)

| Lines | Module | Contents |
|---|---|---|
| 19-117 | `ye` store | key/value JSON store with 4 backends |
| 118-357 | `le` leagues | real-league clock configs (NBA_48, FIBA_40), 13 leagues |
| 358-387 | `we` | in-memory TTL cache (default 15 s), `get/set/wrap` |
| 388-416 | `je` | `fetchJSON(url, cacheKey, ttl)`, 8 s timeout, UA `PaceTotals/1.0` |
| 417-436 | `ae` | `isVirtualGame` regex (keeps eBasketball out of real-league lists) |
| 437-516 | `ve` | clock helpers (elapsed / remaining minutes, period label) |
| 517-1178 | `hn wn En Nt` | ESPN scoreboard + summary, EuroLeague, API-Basketball feeds |
| 1179-1376 | `Ke` | FanDuel client (in-play, sport page, livedata, event page) |
| 1377-1620 | `Pt` | FanDuel live real-league games (`fdTotal`) |
| 1621-1822 | `Xe` | **GG League board from FanDuel** (`listBoard`, `eventLines`, `linesFromMarkets`) |
| 1823-2305 | `sa Lt ma` | real-league possessions, snapshot model, `/evaluate` advice |
| 2306-2513 | `Ma` | real-league games service (`listGames`, `getGame`, `evaluateGame`) |
| 2514-2629 | `xt` | **H2H GG League feed client** (`schedule`, `timeline`, `parseTimeline`) |
| 2630-2900 | `Pe` | **ratings**: `fitRatings`=`Vo`, `predictGame`=`Oa`, `gamesFromSchedule`=`Ko` |
| 2901-3508 | `st` | **live model**: `pregame`=`Da`, `evaluateLive`=`zo`, `priceMarket`=`Ge`, `estimateProgress`=`Fa` |
| 3509-3581 | `Ha` | `buildProfiles`=`ti`, `buildPairs`=`ni` |
| 3582-3712 | `Ut` | context: `mergeFinals`, `buildContext`=`Ya`, `getContext`=`li`, `RATING_OPTS` |
| 3713-4384 | `ut` | **tracker**: `collect`=`Ei`, grading, `performance`=`Oi`, `gradedRaw`, `fitPhaseWeights`=`rs` |
| 4385-4740 | `hs` | eb service: `board`=`Di`, `game`=`Ci`, `matchup`=`Gi`, `players`=`Ri` |
| 4741-4882 | `ws` | router `handle`=`Qi` |
| 4883-5024 | `ks` | `createDocStore` (packs keys into a few KV documents) |
| 5025-5028 | export | `{ store, api, tracker, docStore }` |

## 1. Exported handler and how to call it from Node

```js
const gg = require('/home/claude/work/baseline/gg/server/gg.cjs.js');   // or: (await import('.../gg.mjs')).default
// gg.api.handle({ method = 'GET', path = '/', query = {}, body = null }) -> Promise<{ status, body }>
globalThis.__GG_SEEDS = { 'seed-finals': finalsRows, 'seed-quarters': quartersMap /*, 'seed-context': ctx */ };
const r = await gg.api.handle({ method: 'GET', path: '/api/eb/matchup', query: { a: 'PUNISHER', b: 'ORDER', teamA: 'Boston Celtics', teamB: 'Denver Nuggets' } });
```

- `handle` (4858-4880) strips a leading `/api` and trailing slashes, matches the route table (4758-4857),
  returns `{status:200, body}`; on throw `{status: err.status || (err.code==='VIRTUAL' ? 400 : 502), body:{error}}`;
  no match -> `{status:404, body:{error:'No route GET /x'}}`. Query values are strings.
- Other exports: `gg.api.parseQuarterStart`, `gg.tracker.{collect, performance, gradedRaw, gradeTrace,
  regradeFinal, matchFinal, gradeSide, profit, newTrace, fitModelWeight, fitPhaseWeights}`,
  `gg.store.{configure, useBackend, getJSON, setJSON, del, listKeys, flush, backend, STORE_NAME}`,
  `gg.docStore.{createDocStore, dayKey}`. `fitRatings`, `predictGame`, `evaluateLive` are NOT exported.
- Tested offline (no network): with no backend the store is `memory`; `/eb/players` and `/eb/matchup`
  build the context from `__GG_SEEDS` finals in about 130 ms for 5246 games.
- **Point-in-time replay trap**: `buildContext` uses `Date.now()` for recency weights and for the 21-day
  pair window. Replaying old games needs `Date.now` patched to the cut-off time AND a fresh module
  instance (`delete require.cache[...]`) because the context is cached in memory for 5 min. Do not pass
  `seed-context` (it is prebuilt, see 7). Simpler for the lab: copy lines 2630-2900, 2901-3508, 3509-3581
  into a lab module and call `fitRatings(games, {...RATING_OPTS, now})` directly.
- Env vars read: `STORE_DIR`, `FANDUEL_SB_AK`, `FANDUEL_REGION` (NJ default; NJ/IL/PA), `API_BASKETBALL_KEY`
  or `APISPORTS_KEY`, `SKIP_NCAAB`.

## 2. HTTP routes (all under the server base, `/api` prefix optional)

| Route | Params | Response |
|---|---|---|
| `GET /health` | - | `{ok, app:'gg-winner', store, apiBasketball, fanduelLive, time}`. [live]: `store:'supabase-kv'`, `apiBasketball:false` |
| `GET /eb/board` | `edge` (pts, default 2), `ev` (default 0.03) | `{updatedAt, live[], upcoming[], schedule{ok,count,error?}, picks[<=3], model{builtAt, games, quarterGames, players, modelWeight, modelWeightFit}, params{edgeMin, evMin}}` |
| `GET /eb/game/<FanDuel eventId digits>` | `qs=<quarter>:<total score when that quarter began>`, `edge`, `ev` | `{updatedAt, game{...boardEvent, opening, linesSource}, eval, shares[4], gamers{away,home}, h2h, trace}`; 404 once the game leaves FanDuel's board |
| `GET /eb/matchup` | `a`, `b` (gamers, required), `teamA`, `teamB`, `line`, `half1`, `edge` | `{pregame, half1, last10Half, quarters[4], shares[4], priceGame, priceHalf, gamers{a,b}, h2h}`; 400 `Pick two gamers` |
| `GET /eb/players` | - | `{builtAt, mu, totalSd, players[{name, n, avgFor, avgAgainst, avgTotal, off, def, paceIndex(=off+def), vsAvgTotal, last10Half, bestQuarter, qFor[4], last}]}` sorted by `n` |
| `GET /eb/graded` | `days` 1-14 (default 2) | `{days, games, graded[gradedTrace]}` raw graded games (see 8) |
| `GET /eb/performance` | `days` 1-30 (default 7) | `{days, games, markets[], gapBuckets[], accuracy[], recent[<=30], tracking}` (see 8) |
| `GET /leagues` | - | `{leagues[{id,name,fanduelPriority,espn,euroleagueApi,apiBasketball,fanduelLive}], apiBasketballEnabled}` |
| `GET /games` | - | `{games[], errors[], apiBasketball{enabled,skipped}, fanduelLive{ok,liveCount,error,sources}, fetchedAt}` |
| `GET /games/<id>` | id = `espn:<league>:<eventId>` / `euro:<league>:<seasonCode>:<gameCode>` / `apib:<league>:<id>` / `fd:<league>:<eventId>` | `{game, snapshot, fdLines, league{id,name,abbrev,clock}, fetchedAt}`; virtual games -> 400 |
| `POST /evaluate` | body `{gameId, lines{gameTotal (required), quarterTotal, halfTotal, awayTotal, homeTotal}}` | `{game, snapshot, league, advice{snapshot, confidence, flags, markets[], why, risks[], disclaimer}}` (legacy, the app does not call it) |

- **`/h2h/*` and any DataBallr relay are NOT in this bundle.** They live in the Edge Function wrapper
  (`index.ts`, Supabase function `gg-winner`, version 3, created 2026-11-09T00:57Z, `verify_jwt:false`),
  whose source is not in the repo. [live] `/h2h/v1/schedule/nba?date=...` returns the upstream body
  byte-for-byte, passes upstream status through (a bad id gave `400 {"detail":"Invalid ID"}`), and adds
  `access-control-allow-origin: *`, `cache-control: no-store`. No DataBallr code or host appears in the bundle.
- Shapes. `boardEvent` (1772-1785): `{id:'eb:<eventId>', eventId, competition, name, away{team, player, score},
  home{...}, total, scheduledMs, tipMs, status:'live'|'pre', videoAvailable, lines}`. `lines` (1720-1740):
  `{game, half1, half2, quarters{1..4}, homeTotal, awayTotal, spread, moneyline, quarterHint, quarterState{q,h,t,w},
  hasHalfMarket}`, each total = `{line, over, under, status, open, marketId}` (American odds ints).
  `upcoming[]` (4461-4479): `{id:'h2h:<externalId>', status:'started'|'scheduled', scheduledMs, away, home, stream,
  lines:{}, eval}` = league games in [now-35 min, now+75 min] not on FanDuel's board; always priced as pregame.
- `eval` (4416-4425): `{modelWeight, progress{f, minutes, source, window, quarter, overtime}, pregame{model,
  expected, away, home, known, minGames, pair{n, avgTotal, adj}, blendNote}, rate{total, away, home, pacePer20},
  confidence{score, level, notes[]}, markets[], best}`. `markets[]` item (3142-3161): `{id:'game'|'half1'|'q<N>'|
  'awayTotal'|'homeTotal', label, line, overOdds, underOdds, open, mean, fair, sd, gap, rawGap, weight, pOver,
  fdOver, evOver, evUnder, side, ev, call, reason, score}`; half1 adds `last10{away,home,avg,n}`; quarter adds
  `quarter, full, soFar, note`. `gamers.x` (4546-4578): `{player, rating, profile, recent[<=10], last10Total}`;
  `h2h` (4579-4597): `{meetings, avgTotal, games[<=8]{t,a,b,total}}`.

## 3. Upstream feeds

### 3.1 H2H GG League (lines 2514-2629)
- Base `https://api-h2h.cdn-hudstats.com/`. Timeout 9 s. First try sends browser-like headers (2517-2524):
  `User-Agent` = an Android Chrome 130 string, `Accept: application/json, text/plain, */*`,
  `Accept-Language: en-US,en;q=0.9`, `Origin: https://h2hggl.com`, `Referer: https://h2hggl.com/`. On any
  failure except 404 it retries once with only `User-Agent` + `Accept: application/json` (2546-2553).
  Non-JSON body -> error `H2H sent a non-JSON page`.
- **Schedule** (2557-2570): `GET v1/schedule/nba?date=<YYYY-MM-DD>T00:00:00+00:00` (URL-encoded). Returns an
  array, newest first, of every game that starts on that UTC day. Cache key `h2h:sched:<day>`: 3 min for
  today or later, 6 h for past days. Row (12 fields) [live]:
  `{externalId:'NB207091126', startDate:'2026-11-09T23:59:00Z', isCancelled:false, teamAName:'Boston Celtics',
  teamBName:'New York Knicks', participantAName:'JETT', participantBName:'BLADE', streamName:'Ebasketball 5',
  tournamentName:'Ebasketball H2H GG League', matchStatus:'MATCH_ENDED', teamAScore:55, teamBScore:63}`.
  `externalId` = `NB` + 3-digit sequence + `DDMMYY`. Statuses seen: `MATCH_ENDED`, `PERMANENT_BET_SUSPEND`
  (abandoned, partial score such as 27-11). Final scores include overtime.
- **Timeline** (2571-2577): `GET v1/timeline/?external_id=<externalId>`, cache 30 min. Returns
  `{incidents[], matchSummary}` [live]. `matchSummary`: `{sport, startDate, externalId, streamName, invertedTeams,
  finalScore{teamA,teamB}, halfTimeScore{teamA,teamB}, teamA{teamName, teamAbbreviation, participantName}, teamB{...}}`
  (`halfTimeScore` is flipped when `invertedTeams:1`; `finalScore` and `runningScore` follow schedule A/B).
  Incident: `{messageType, time (ms left in quarter), payload, period{type, id}, runningScore{team_a, team_b},
  team:'TEAM_A'|'TEAM_B', timestamp (sequence number, not a clock), inPlayClockSeconds}`. `messageType`:
  `NBA_PERIOD_CHANGE` (payload.phase `STARTED|ENDED`; period.type `MATCH_STARTED|QUARTER|OVERTIME|MATCH_ENDED`),
  `NBA_GOAL` (payload `{type:'TWO_POINTER'|'THREE_POINTER'|'FREE_THROW', value}`), `NBA_FREE_THROW`, `NBA_FOUL`,
  `NBA_VIOLATION`, `NBA_TIP_OFF_WINNER`. Quarters are 5:00 (`inPlayClockSeconds` starts at 300); about 67
  incidents per game, 15 KB.
- `parseTimeline(tl, {teamAScore, teamBScore})` (2578-2621): running score at each
  `NBA_PERIOD_CHANGE / phase ENDED / period.type QUARTER` (ids 1-4, OVERTIME -> key 5); needs all four, else
  null. Per-quarter `[A,B]` = differences. If the last running score equals the schedule final reversed, A/B
  are swapped. Returns `{q:[[a1,b1]..[a4,b4]], half:[a,b], final:[a,b], ot}`; only `q.flat()` (8 numbers) is stored.

### 3.2 Recipe: historical finished GG League games (tested)

1. One request per UTC day through the data server's relay (the app's own path):
   `GET https://pjthpontugjihnjsxxry.supabase.co/functions/v1/gg-winner/h2h/v1/schedule/nba?date=YYYY-MM-DDT00%3A00%3A00%2B00%3A00`
   (`tools/lib.js getJSON(url)` works as is). Keep rows the way the bundle does (`gamesFromSchedule`, 2869-2891):
   `!isCancelled && matchStatus==='MATCH_ENDED' && finite scores && teamAScore+teamBScore >= 40`. Map:
   `id=externalId, t=Date.parse(startDate), a=participantAName, b=participantBName, teamA=teamAName,
   teamB=teamBName, sa=teamAScore, sb=teamBScore, stream=streamName`.
2. Quarter scores: one request per game, `.../h2h/v1/timeline/?external_id=<externalId>`, then the
   `parseTimeline` rule above (Q1+Q2 = first half). Ids missing from a finished day's sequence are not games
   (`NB003101026` -> 400 Invalid ID).
3. [live] results: relay 2026-11-09 -> 193 games (200, 64,743 bytes), identical to upstream. Direct upstream:
   2026-10-10 -> 257 rows, 09-25 -> 256, 09-17 -> 250, 09-13 -> 260, **09-10 -> `[]`**, 08-01 -> `[]`, 01-15 -> `[]`.
   **History is a rolling window of about 60 days** (oldest day with data lies between 09-11 and 09-13 as seen on
   11-11), about 250 games/day, so roughly 15,000 games. Fetch the oldest days first, they drop off daily.
4. Politeness: upstream answered **429 `{}`** on the sixth request inside about a minute (2 s apart) and recovered
   after about 3 minutes; it sends `cache-control: max-age=600`. Use one request at a time, 8-10 s apart, back off
   on 429, cache every finished day forever under `data/eb/` (a day is final about 1 h after 23:59 UTC). The relay
   shares the production server's upstream quota (the tracker stops fetching timelines on a 429), so never
   hammer it. All quarter data = 15,000 timeline calls (about 40 h at that pace): sample or run slowly.
5. Direct upstream needs the browser-like headers of 3.1 (that is what the server sends). In this session my
   direct calls with those headers were stopped by the permission guard as bot-check circumvention after a
   few probes, so I did not continue; whether the plain fallback headers alone are accepted is untested. Use the
   relay unless the owner decides otherwise.
6. Saved probes: `data/eb/probe/` (`up-sched-<day>.json` for the 5 days above, `relay-sched-2026-11-09.json`,
   `relay-timeline-NB001091126.json`, `graded-14d.json`, `performance-7d.json`, `board.json`, `players.json`).
- League facts from those days: 6 streams (`Ebasketball 1`..`6`), one game per stream every 32 min; a session is
  3 gamers playing round-robin, each on one fixed NBA team (16 teams in use); 54-60 gamers per day; mean total
  drifted 106.1 (Sep 13) -> 107.3 -> 109.0 -> 110.7 (Oct 10) -> 111.0 (Nov 9); spread of totals within a day
  SD about 15.5; A side vs B side 55.4 vs 55.2 (no side advantage). The schedule hides a game while it is being
  played (app.js 528-531); it reappears once ended.

### 3.3 FanDuel (lines 1179-1376; GG League mapping 1621-1822)
- Headers (1197-1218): `User-Agent: Mozilla/5.0 (compatible; GGWinner/3.0)`, `Accept: application/json, text/plain, */*`,
  `Origin: https://sportsbook.fanduel.com`, `Referer: https://sportsbook.fanduel.com/live?tab=basketball`. Timeout 9 s.
  `_ak` = `FANDUEL_SB_AK` or the web key hard-coded at line 1181. Hosts tried in order nj, il, pa.
- `https://sbapi.<st>.sportsbook.fanduel.com/api/in-play?_ak=&timezone=&exchangeLocale=en_US&includePrices=true`
  (and the same with `&eventTypeId=7522`), `.../api/content-managed-page?_ak=&page=SPORT&eventTypeId=7522&timezone=`,
  merged into `attachments{events, competitions, markets, eventTypes}` (`basketballBoard`, cache 6 s).
- `https://api.sportsbook.fanduel.com/ips/inplayservice/v1.0/livedata?eventIds=<up to 40>&_ak=&channel=WEB` (cache 4 s)
  -> `[{eventId, modelType, basketballDetails{home{score, pointsPerPeriod}, away{...}, period, currentPeriod,
  periodRemainingTimeMilliseconds}}]`. Only the scores are used for GG League.
- `.../api/event-page?_ak=&eventId=&tab=popular&timezone=` (cache 6 s) -> all markets of one game.
- GG League events: `eventTypeId 7522` and competition or event name matches `/e-?basketball|h2h\s*gg/i`.
  Event name `Away Team (GAMER) @ Home Team (GAMER)` -> `{team, player (upper case)}` (1629-1645).
  Markets by `marketType` (1685-1741): `TOTAL_POINTS_(OVER/UNDER)`, `1ST_HALF_TOTAL_POINTS`, `2ND_HALF_TOTAL_POINTS`,
  `<1ST|2ND|3RD|4TH>_QUARTER_TOTAL_POINTS|_HANDICAP|_WINNER`, `HOME|AWAY_TEAM_TOTAL_(INCL_OVERTIME)` or `_TEAM_TOTAL_POINTS`,
  `MATCH_HANDICAP_(2-WAY)`, `MONEY_LINE`. Line = runner `handicap`, odds = `winRunnerOdds.americanDisplayOdds.americanOddsInt`,
  `open = marketStatus==='OPEN'`. `quarterHint` = highest quarter with any quarter market; `quarterState{q,h,t,w}` =
  open/suspended state of that quarter's handicap/total/winner markets.
- Times (1742-1752, 1770): `scheduledMs = openDate`; `tipMs = max(marketTime)`; `live` when score > 0 or
  (`tipMs > scheduledMs` and now >= tipMs). Events that are not in-play and still 0-0 are dropped, so a game is
  seen pregame only if FanDuel already lists it in-play.
- Other feeds (real leagues): ESPN `site.api.espn.com/apis/site/v2/sports/basketball/<slug>/scoreboard` and
  `/summary?event=`; EuroLeague `api-live.euroleague.net/v2/competitions/<E|U>/seasons/<code>/games[...]` and
  `live.euroleague.net/api/Boxscore`; API-Basketball `v1.basketball.api-sports.io` (header `x-apisports-key`, off live).

## 4. Ratings model (lines 2630-2900, options 3588-3595)

"Opponent-adjusted gamer ratings with gamer-with-team and head-to-head effects":

- Data: finals rows `[id, tMs, a, b, teamA, teamB, sa, sb]`, last `KEEP_DAYS = 28` days (3586, 3637-3642).
  Names: gamer upper-cased (`normPlayer`), team lower-cased (`normTeam`).
- Two rows per game (one per side). Points scored by a side:
  `pts = mu + off[scorer] + def[opponent] + teamOff[scorer team] + teamDef[opponent team] + gt[scorer|team] + pair[scorer>opponent]`.
  `def` is "points this gamer lets opponents score above average" (positive = leaky). `pair` is directed.
- Row weight `w = 0.5 ^ (days since game / halfLifeDays)`, with `now` = build time.
- Objective: weighted least squares with a ridge penalty per effect, solved by backfitting (2735-2755):
  30 sweeps; each sweep sets `mu = sum w*(y - effects) / sum w`, then for each group in the order off, def,
  teamOff, teamDef, gt, pair: `v[k] = sum w*(residual without v[k]) / (sum w + lambda)`.
- **Live constants (`RATING_OPTS`)**: `halfLifeDays 14, ridgePlayer 3, ridgeTeam 20, ridgeGamerTeam 8, ridgePair 8,
  useTeams true, iterations 30`. Module defaults (2631-2639, used only if a caller passes nothing): `10, 6, 40, 0, 0`.
  Lambdas are in weighted-game units.
- Output `ratings` (2798-2821): `{mu, players{NAME:{off, def, n, avgFor, avgAgainst, avgTotal, last}}, teams{name:{off, def}},
  gt{'NAME|team': v}, pair{'A>B': v}, cfg, totalSd, games, updatedAt}`. `gt`/`pair` keep only |v| >= 0.15.
  `n`/`avg*` are unweighted over the 28 days. `totalSd` = in-sample RMSE of the game total (fallback 14).
  [live] `mu 55.01, totalSd 10.78`, 129 gamers, 5857 games.
- `predictGame(ratings, {a, b, teamA, teamB})` (2830-2868): `a = mu + off_a + def_b + teamOff_A + teamDef_B + gt + pair`,
  same for `b`; returns `{a, b, total, margin, known (0-2 gamers found), minGames}`. No home/away term.
- `buildProfiles` (3517-3561): only games that have quarter data, newest first, quarter total >= 40. Per gamer:
  `last10Half{avg, n, values}` (first-half totals of the newest 10 such games), and over the newest 40:
  `qShare[4]` (mean share of the game's points per quarter), `qFor[4]`, `qAgainst[4]`, `bestQuarter`, `n`.
- `buildPairs` (3562-3579), games of the last 21 days: key `A|B` sorted -> `{n, resSum (actual total - predicted, in sample),
  totalSum, last[<=6][t, A, sa, B, sb]}`.
- `buildContext(finals, quarters, now)` (3643-3675) -> `{builtAt, games, quarterGames, lastGameAt, ratings, profiles, pairs}`.

## 5. Matchup projection and live blend (lines 2901-3508)

Constants `DEFAULT_PARAMS` (2902-2931): `n0 6, sdStart 12.2, sdEnd 4.5, quarterShare [0.2546, 0.2467, 0.2425, 0.2486],
regulationMinutes 26.3 (wall-clock length of a game), modelWeight 0.5, phaseWeights [0.85, 0.45, 0.6, 0.35, 0.9],
lineWeight 1, pairShrink 15, edgeMin 2, maxRawGap 10, evMin 0.03, maxProgressForSignal 0.85, defaultMu 54.9`,
`knots` = wall minutes since tip -> share of game done: `(0,0) (0.5,.032) (2.5,.119) (5.5,.241) (8.5,.35) (12.5,.5)
(15.5,.617) (18.5,.729) (20.5,.775) (23.5,.905) (25.5,.981) (26.3,1)`.

- **Pregame** `pregame(ctx, game, {openingTotal})` (3176-3222): `predictGame` with a = away gamer, b = home gamer.
  If neither gamer is known: total = `2*mu`. Pair bonus `resSum/(n+15)` applies only when `n >= 3` AND the ratings
  have no `pair` object, so it is dead with the current fit (live shows `adj: 0`) but active with the bundled
  `seed-context`. Opener blend only when `openingTotal > 50`: weight on ratings = `lineWeight (1)` if both gamers
  known with `minGames >= 15`, else 0.25. Returns `{model, expected, away, home, known, minGames, pair, blendNote}`.
- **Quarter shares** `pairShares` (3223-3238): league shares worth 20 games + each gamer's `qShare * n` (n <= 40), renormalised.
  `windowShare(f1, f2)` (3069-3081) = share of game points between two progress points (quarters = equal 0.25 slices).
- **Matchup route** (4641-4697): `half1 = expected * windowShare(0, .5)`; `quarters[i] = expected * windowShare((i-1)/4, i/4)`;
  `priceGame` / `priceHalf` use odds -110/-110, sd `12.2` and `12.2*sqrt(0.5)`, and weight 0.5 (not the pregame 0.85).
- **Progress** `estimateProgress` (3028-3068), the server never sees a game clock: time estimate from `knots`
  (minutes since `tipMs`), score estimate `score / max(expected, 60)`, combined by precision
  (time sd `0.025 + 0.0015*min`, or 0.2 when the real tip is unknown; score sd `sqrt(2.4*score)/expected + 0.1*scoreF`).
  Then clamped into a window read from which FanDuel quarter markets are open (`quarterBounds`, 2995-3027;
  q0 = (q-1)/4): handicap open -> [q0+.03, q0+.13]; total+winner open -> [q0+.09, q0+.165]; total only -> [q0+.13, q0+.225];
  winner only -> [q0+.04, q0+.2]; handicap suspended and no others -> [q0+.17, q0+.33]; else `quarterHint` -> [q0+.03, q/4+.08].
  `progress.source`: `pregame | clock-estimate | score-estimate | market-confirmed | market-corrected | quarter-* | overtime`.
- **Live mean** (3266-3279): full-game scoring rate updated from the score,
  `rate = (n0*expected + score) / (n0 + windowShare(0, f))`, same per side; `game mean = score + rate * windowShare(f, 1)`.
  With `n0 = 6` the score so far moves the remaining rate very little (a game 10 points hot at half adds about 9.8).
- **SD** `sdAt(f)` (3087-3093): `sqrt(sdEnd^2*min(1, 4(1-f)) + (sdStart^2 - sdEnd^2)(1-f))`, x1.08 when progress is
  only clock/score estimated, floor 1.2; team totals use segment 0.5 and x1.05; half/quarter use
  `12.2*sqrt(share of window)*sqrt(remaining fraction)` (x1.08 / x1.1), floor 1.5.
- **Blend with the book line** `priceMarket` (3103-3163): `weight = clamp(phaseWeight, .05, .95)`;
  `fair = weight*mean + (1-weight)*line`; `rawGap = mean - line`; `gap = fair - line`;
  `pOver = 1 - Phi((line - fair)/(0.92*sd))`; `ev = p*(decimal-1) - (1-p)`.
  **Model weight by progress** `phaseWeight` (3164-3175): pregame 0.85; f < 0.25 -> 0.45; f < 0.75 -> 0.6;
  f < 0.9 -> 0.35; else 0.9. Overridden by stored `model/params.phaseWeights` ([live] refit 2026-11-11 01:07Z:
  `[0.85, 0.45, 0.22, 0.51, 0.9]`).
- **Call rule** (3127-3141): market open, signals allowed (`f <= 0.85`, not overtime), `|rawGap| <= 10`,
  `|gap| >= edgeMin` (quarters `max(1.5, .75*edgeMin)`, team totals `.75*edgeMin`), fair above the line,
  `ev >= evMin`; then `call = 'Over'`, otherwise `'Pass'` with a `reason`. Half1 needs `f < 0.42`; quarter needs
  more than 15% of the quarter left. If confidence is LOW every call becomes Pass.
- **Quarter market** (3322-3371): current quarter `D = floor(4f)+1`; needs the score at quarter start from the
  client (`qs=` param), else only when within 1% of the quarter start; otherwise `mean: null`, reason
  `Need quarter start score`. `full` = whole-quarter expectation.
- **Overtime flag** (3270-3275): more than 26.9 wall minutes, margin <= 12, game line > score + 1.5 -> no calls;
  extra periods are not priced.
- **Confidence** (3447-3487): start 50; +12 both gamers known; +10 `minGames >= 40` (+5 if >= 15); live: +8 market/quarter
  confirmed progress, -6 score-estimate, -20 if f > 0.92, -40 overtime, -8 close late; clamp 20-92; HIGH >= 70, MED >= 55.
- `evaluateLive` returns the `eval` object of section 2 plus `id`, `shares`. `best` = call with the top
  `score = |gap| * (1 + 4*ev)`.

## 6. Tracker (`collect`, lines 4226-4268) and what triggers it

Each run: (1) FanDuel GG board -> per game trace, lines, checkpoints, signals (3771-3882); games gone from the
board for 4.5 min move to `ended`. (2) At most every 8 min: league schedule for today (plus yesterday only when
the UTC hour is 0 or 1) merged into `data/finals` (3986-4001). (3) Up to 3 timelines for the newest finals
without quarters -> `data/quarters` (4002-4029). (4) Grade ended games (4049-4095): final = league final with
the same two gamers and start within 6 min; else FanDuel's last score if unchanged for 3 min, total >= 40 and
23+ min after tip; give up after 8 h. (5) At most hourly: rebuild `model/context`, refit `model/params`.
[live][inferred] `collect` is driven by incoming requests with a throttle of about 5 min, not by a clock: the
last run was 00:04:40Z, my first request at 01:07:52Z started the next one (`lastRun.at` and `model.builtAt`
both equal that instant), and run times in the graded data show gaps up to hours.

## 7. Stored state and caches

Store keys (backend: custom `supabase-kv` live; else Netlify Blobs `courtside-eb`, `STORE_DIR` files, or memory):

| Key | Content |
|---|---|
| `data/finals` | rows `[id, tMs, a, b, teamA, teamB, sa, sb]`, 28 days, ascending. [live] 5857 rows |
| `data/quarters` | `{<id>: [a1,b1,a2,b2,a3,b3,a4,b4], _skip:[ids without usable timeline, last 200]}`. [live] 834 games |
| `model/context` | output of `buildContext` |
| `model/params` | `{phaseWeights[5], n, at}` |
| `track/state` | `{active{eventId:{scheduledMs, players, lastSeen}}, ended{eventId:{..., endedAt, fdCand?}}, lastSchedAt, lastBuildAt, lastRun}` |
| `track/ev/<eventId>` | live trace `{eventId, name, away, home, scheduledMs, tipMs, firstSeen, pre, close, pregame, snaps[<=60], checkpoints, signals, lastSeen}`; deleted once graded |
| `track/graded/<YYYY-MM-DD>` | array of graded traces, keyed by the UTC day of `scheduledMs`; never pruned |

- `createDocStore(kv{get,put}, opts)` (4888-5022) packs keys into KV documents `doc:live` (all `track/*` plus graded
  days from yesterday on), `doc:graded:<day>`, `doc:history` (`data/*`, flushed at most hourly), `doc:model`, `doc:misc`;
  reads cached 20 s (live) / 600 s (others); `flush({force})` writes dirty docs.
- Seeds: `globalThis.__GG_SEEDS['seed-finals' | 'seed-quarters' | 'seed-context']` (3598-3611), used when the store
  is empty. Bundled seeds: 5246 finals 2026-10-14..11-04 19:15Z, 773 games with quarters (Nov 1-4 only), and a
  `seed-context` built 2026-11-04 with OLD settings (`halfLifeDays 10, ridgePlayer 3, ridgeTeam 20`, no `gt`/`pair`).
- `getContext({maxAgeMs = 5 min})` (3676-3696): memory -> `model/context` -> `seed-context` -> build from finals;
  then merges `model/params.phaseWeights`. The tracker uses a 30 min memory age.
- Memory TTL cache keys: `h2h:sched:<day>` 3 min / 6 h, `h2h:tl:<id>` 30 min, `fd:*` 4-6 s, `trace:<eventId>` 60 s,
  `finals:mem` 5 min, `espn:sb:<league>` 15 s, `espn:box:*` 20 s, `euro:season:*` 15 min, `apib:*` 1-5 min / 24 h.

## 8. FanDuel lines for GG League: what is read and what history is kept

- Lines are read live only (section 3.3). Per tracked game the trace keeps: `pre` = last pregame capture
  `{at, game, half1, q1, awayTotal, homeTotal}` each `{line, over, under, open}`; `close` = that capture, or for a
  game first seen after tip the first live line with `late: true`; `snaps` = up to 60 rows
  `[t, awayScore, homeScore, gameLine, over, under, open(0/1), f]` added when score or line changes;
  `checkpoints` at progress 0 (pregame), 25, 50, 75% with every priced market `{id, line, mean, gap, call, ev, over, under}`;
  `signals` = calls made, at most 3 per market per game and 0.2 progress apart, quarter markets excluded:
  `{market, label, side, line, odds, mean, gap, ev, f, at, note:'pregame'|'live NN%'}`.
- On grading (`gradeTrace`, 3915-3985) `snaps` are thrown away. What survives per game (`gradedTrace`):
  `{eventId, h2hId, finalSource:'h2h'|'fanduel', pendingHalf, name, away, home, scheduledMs, final{away, home, total, half1},
  close, pregame{model, expected, last10Half, half1Mean}, checkpoints{'0'|'25'|'50'|'75': {f, game{line, mean, call,
  errModel (= mean - final), errLine (= line - final)}, half1{...}}}, signals[... + actual, result 'W'|'L'|'P', units], gradedAt}`.
  `units`: win = decimal odds - 1 (1.909 if odds missing), loss = -1, push = 0.
- **So the only FanDuel line history is `track/graded/<day>`: closing or first-seen game line plus the line at up
  to 4 checkpoints per game.** [live] it starts 2026-11-09 (function created that day): 118 graded games over
  3 days (65 / 48 / 5). 111 have a game line; 94 of those are `late` (first seen after tip); only 24 have a
  pregame checkpoint; 17 have pregame half/Q1 lines; none have team-total lines; 42 have a first-half result.
  `/eb/graded?days=14` returns all of it today; days older than 14 are reachable only in the KV (`doc:graded:<day>`).
- `/eb/performance` (4269-4362): `markets[{market, n, w, l, p, units, winPct, roi}]` and `gapBuckets` (`2-3`, `3-4`, `4+`
  by |gap|) over graded signals (below-the-line sides dropped); `accuracy[{market, checkpoint, n, modelMae, lineMae}]`;
  `recent[<=30]` = signal + `name, scheduledMs, final`; `tracking{active, awaitingGrade, lastRun}`.
  [live] 7 days: game-total calls 20-14, +2.26 units (pregame 4-2, live 16-12). Mean absolute error model vs line:
  pregame 12.0 vs 12.2 (n 23), 25% 7.6 vs 7.1 (n 41), 50% 5.9 vs 6.1 (n 43), 75% 5.5 vs 5.0 (n 45).
  From the raw file: at 75% the model runs 2.8 points high on average (line -0.1); pregame model RMSE 12.7 over
  118 games. These are 3 days of data, too few to rank anything.
- Weight refit `fitPhaseWeights` (4162-4189): over the last 7 graded days, per bucket (checkpoint 0 -> index 0;
  25 and 50 -> index 2; 75 -> index 3) `w = sum (final-line)(mean-line) / sum (mean-line)^2`, needs n >= 40, clamp 0.15-0.95.
  Indexes 1 and 4 are never refit. `fitModelWeight` (4190-4213) is exported but unused.

## 9. Real-league part in one paragraph

`/games` merges ESPN, EuroLeague, API-Basketball and FanDuel-live games (FanDuel live wins on a team-name match)
for `nba wnba nbl euroleague eurocup bbl lkl bcl lnbp ncaam`. Game row: `{id, sourceId, source, leagueId, leagueName,
leagueAbbrev, name, shortName, status, statusDetail, period, clock, isHalftime, date, home{id, abbrev, name, shortName,
logo, score, record, qScores[]}, away{...}, isVirtual, periodText, fdTotal?{line, over, under, status}}`. `/games/<id>`
adds `snapshot` (`buildSnapshot`, 1905-1988): pace and points per possession from the box score when both teams
have `fga+to+fta >= 8`, else from score and clock, shrunk to league averages, `fairGameTotal = score + remaining
possessions * 2 * ppp` with blowout / close-late factors 0.92 / 0.96 / 1.03 and 1.05 in overtime. The phone app
runs its own model on the `/games` row (see `map-gg-league-live.md`).

## 10. Problems found (details and ideas in the structured result)

1. Results-day holes in `data/finals`: only today's schedule is merged (yesterday only at UTC hour 0-1) and runs
   depend on traffic. [live] no gamer has a last game on Nov 5-7: about 3 days are missing from the ratings.
2. After each hourly rebuild the fitted `phaseWeights` are dropped from the memory context (`setMemoryContext`
   gets the context without params). [live] board at 01:08Z used 0.6 / 0.35 while `model/params` held 0.22 / 0.51.
3. Two model versions in production paths: bundled `seed-context` (old settings + pair bonus) vs rebuilt context.
4. Weights are refit on the same games they are applied to (n >= 40, no unseen-games check).
5. "Opener" for thin-history pairs can be a live line (`close.late`), mixing in-game information into the pregame number.
6. Quarter data is sparse (3 timelines per run): `last10Half` is "newest 10 games that have quarter data", and most
   first-half calls are never graded (`pendingHalf` expires after 8 h).
7. `pOver` uses sd 11.2 pregame (12.2 x 0.92) while measured pregame error is about 12.7 RMSE.
8. Text: the server returns `call`/`side` values `Over`/`Under` and reasons like `Edge under 2 pts`; the app hides most
   of them but `app.js:1498` prints `s.side` in the Results list.
