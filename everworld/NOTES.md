# Everworld sports apps: lab notes

Memory between sessions. Read this before trying anything; add to it at the end of every session.

Last updated: 2026-11-11 (session 1 in this repo). Status lines marked WIP are still being measured.

## Where everything is

This folder (`everworld/` in the `fanduel-pace-totals` repo) is the lab. On a machine set up like the brief,
link it so the brief's paths work: `ln -s <repo>/everworld /home/claude/work`.

| Path | What |
|---|---|
| `baseline/cs`, `baseline/gg` | Pristine copy of what was LIVE on the two Spaces on 2026-11-10 (Courtside v14 `ca-shell-v14`, GG Winner v3.9.0). Never edit. "Live engine" in every comparison means this. |
| `cs/build` | Courtside working copy (engine.js, app.js, worker.js, data.js, sw.js, sitprior.js). |
| `gg/static` | GG Winner working copy. |
| `cs/tests` | Courtside tests (see "Test suites"). |
| `tools/` | Lab tools (below). |
| `data/` | Cache. Only `data/derived` and `data/lessons` are in git; the rest is rebuilt with the fetch tools (about an hour, polite). |
| `notes/` | Code maps and the DataBallr API spec (`databallr-openapi.json`, 130 endpoints). |
| `nm/` | Test-time libraries. Run `npm install` there once (jsdom, esbuild). |

The original starter kit (`everworld-starter-kit.zip`, old `NOTES.md`, `tools/bt2.js`...) was NOT available in the
cloud session. Everything here was rebuilt from the live Space code and re-validated against the app's own
accuracy report (see "Is the lab right?").

## Data: what exists and how to refresh it

Seasons are labelled by the year they end (2025-26 = 2026), like DataBallr.

```
node tools/fetch.js 2023-10-24 2026-11-10        # DataBallr slates + play-by-play, ESPN scoreboards + game summaries
node tools/fetchstats.js 2024 2025 2026 2027     # season tables, per-game player logs, team logs, tracking logs (add --refresh for the current season)
node tools/prep.js                               # per-season game files (logs, closing line, posted lineup) in data/derived
node tools/espnlines.js && node tools/prep.js    # closing lines for games whose ESPN summary has none (older games), then fold them in
```

Collected so far: 4,089 NBA games with play-by-play (2023-24, 2024-25, 2025-26, 2026-27 through Nov 9), all with a
closing line and all but 4 with ESPN's posted lineup (active list + starters).

Facts about the feeds worth knowing:
- DataBallr needs no key. `GET /docs/openapi.json` lists everything. Beyond what the apps use, it has per-game
  logs from its play-by-play engine: `/v1/nba/pbp/player-log?person_id=<nba id>&season=<Y>`,
  `/v1/nba/pbp/team-log?team_id=<nba team id>&season=<Y>`, `/v1/nba/pbp/season-totals?season=<Y>`. These make
  "stats as of that date" possible (the season tables only show today).
- `/v1/nba/teams/stats` takes `season=`, not `year=` (the app sends `year=`, which is ignored; it works only because
  the current season is the default). Its numbers leave out garbage time (`leverage: clutch`), so they differ a
  little from full-game team logs.
- `/v1/nba/players/stats` returns at most 500 players. `Age` is empty in the 2026-27 table.
- `/v1/nba/odds?date=` and props have NO history (recent days only). Injuries by date are not historical either.
- ESPN game summaries keep the closing line (`pickcenter`) only for recent games; older ones come from
  `sports.core.api.espn.com/v2/.../events/<id>/competitions/<id>/odds` (tools/espnlines.js).
- ESPN posts the lineup (active list, starters) only when the game actually tips (checked live on Nov 10: nothing
  18 and 3 minutes before the scheduled tip; real tips run about 10 minutes late). Players ruled out are left off the
  list. So before tip the app only has the injury report; from tip on it knows the active list and the starters.
- New players have very large play-by-play ids (above 1,000,000,000). Never use an id range as a marker.

## Courtside tools

| Tool | What it does |
|---|---|
| `tools/bt2.js` | THE test. Replays finished games at chosen moments (0 = tip-off with posted lineup, `rep` = before lineups with a perfect injury report, 12/24/36 = quarter ends, 42 = 6:00 left, any minute in between) with what the live app knew then. Prints average miss for players with 10+ real minutes (the app's rule), an all-in view, top scorer in our top 3, game-total miss and bias, chance calibration. `--out` saves per-game sums. |
| `tools/cmp.js A B` | Paired comparison of two bt2 runs, game by game, with z. Beyond about ±2 is unlikely to be luck. `real10` columns = everyone who really played 10+, projected or not (fixed population: use these when a change alters WHO is projected). |
| `tools/fit2.js` | Learns PAT_PRIOR / CAL_PRIOR from games: pass 1 minutes, pass 2 stats on corrected minutes, pass 3 calibration with everything applied. Targets are plain averages, untrimmed. |
| `tools/exp2.sh` | One experiment on a frozen engine copy: fit on some seasons, test on others. |
| `tools/mkengine.js` | Writes learned lessons and switch settings into an engine file. |
| `tools/mksit.js` | Builds `sitprior.js` from a finished season with the engine's own builder. |
| `tools/mkfixture.js` | Builds the two-game fixture the tests run on. |
| `tools/pit.js`, `tools/replay.js`, `tools/lib.js` | Point-in-time inputs, replay core, helpers. |

Rules of use:
- Always compare two engines with the same flags on the same games (`cmp.js`).
- Fit on earlier seasons, test on later ones. Fold A: fit 2024+2025, test 2026. Fold B: fit 2024+2025+2026, test 2027.
- The shipped lessons in the live engine were fit on every game through Nov 9, so running the live engine with its
  built-in lessons on those games is in-sample. For a fair "before", refit the live engine's lessons on the same
  training seasons (`--lessons <file>`).
- For games of season S the situational prior must come from season S-1 (`--sit auto` does this); the shipped
  `sitprior.js` is from 2025-26 and is only honest for 2026-27 games.

## Is the lab right? (validation done on Nov 11)

- `bt2` on this season with the live engine and built-in lessons uses the same 123 games as the in-app report and
  lands on the same numbers: points miss at tip-off 4.755 (report 4.77), end Q1 4.131 (4.12), half 3.232 (3.22),
  end Q3 2.175 (2.18), 6:00 left 1.234 (1.23); top scorer in top 3: 78.9 / 84.6 / 89.4 / 94.3 / 97.6% (report 78.9 /
  83.7 / 89.4 / 94.3 / 97.6).
- Rebuilt season-to-date stat lines match DataBallr's real table within about 0.1 to 1% (median) per field.
- `fit2` on 2025-26 + this season relearns the shipped lessons (cosine similarity 0.95 to 0.999 at live stages) and
  gives the same accuracy on this season.
- The patched engine with every new switch off reproduces the live engine exactly.

## What was measured

### Live engine, honest baseline (lessons from 2024-25 only, tested on 1,199 unseen 2025-26 games)

| moment | PTS miss | MIN miss | all-in MIN | total miss (bias) |
|---|---|---|---|---|
| before lineups | 4.868 | 4.91 | 6.63 | 15.12 (-3.5) |
| tip-off | 4.869 | 4.91 | 6.63 | 15.12 (-3.5) |
| 6 min in | 4.640 | 5.12 | 6.00 | 15.73 (-8.3) |
| 9 min in | 4.448 | 5.01 | 5.41 | 14.14 (-4.4) |
| end Q1 | 4.213 | 4.48 | 4.78 | 13.43 (-4.6) |
| half | 3.387 | 3.52 | 3.70 | 11.28 (-2.5) |
| end Q3 | 2.302 | 2.88 | 2.94 | 8.27 (-1.9) |
| 6:00 left | 1.258 | 1.62 | 1.62 | 6.27 (-1.4) |

Findings:
- Early in games is the weak spot nobody had tested: at 6 minutes in, minutes are projected WORSE than at tip-off,
  and game totals run about 8 points low. Same pattern in the app as shipped on this season's games (minutes miss
  4.64 at 6 minutes vs 4.41 at tip; total bias -4.5).
- At tip-off about 20% of all minutes error is players projected for 10+ minutes who never play (about 1.5 a game),
  and about 10% is players who play 10+ with no projection at all (about 0.8 a game: deep bench on short-handed
  nights, and players back from a layoff).
- Tonight's starting five is a strong signal the live engine ignores (2025-26, 1,183 games): a usual bench player
  who starts plays 27.6 minutes against a recent average of 20.6 (deep reserves: 24.4 vs 11.0). A usual starter who
  is on the active list but not in the starting five plays 9.8 minutes against 26.3.

### v15 work (WIP: see the end of this file for the final numbers once the runs finish)

Changes in `cs/build/engine.js`, each behind a TUNE switch:
- `actDeep`, `actNew`: with the lineup posted, project deep-bench players (weighted by how often they have been
  getting in) and players back from a layoff (from their season line; they get a negative id until they check in).
- Eight new learned inputs: `startUp`, `startDown`, `fresh`, `deep`, `vacPos`, `lastMin`, `rest3`, `missShare`
  (PAT_F is now 42 long: `PAT_KEY`/`PAT_DATES` in app.js bumped to `pat:v4`).
- `repGroup`: "before lineups are posted" is its own learning stage (`rep`), because the app knows less then.
- `patCapMinUp`: the learned layer may raise remaining minutes by more than it may cut them.
- `patLamLineup`: lighter ridge for the rare, strong lineup inputs.
- `patInterp`: between two learning stages, blend their lessons by game minute.
- `sitPre`: situational scoring files a basket under the score before it (the old code filed it after, which
  pushed baskets into "ahead").
- `patYCap`: 0 = learning target is the plain miss (the old one-sided cap is off).

First run (lessons from 2024-25, 1,199 unseen 2025-26 games, tip-off): points miss for everyone who really played
10+ minutes 4.989 → 4.840 (-3.0%, z -12); at 6 minutes in -1.3% (z -7). BUT game totals at tip-off ran 15 points
high: deep-bench players were getting small phantom minutes every night. Fixed by weighting a deep-bench player's
minutes by how often he has been getting in. Lesson: any change that adds players must be checked on team totals.

### Traps found this session

- Ridge strength `patLam` = 32 means about 800 "ghost observations" per input. Inputs that fire rarely (a new
  starter is about one player a game) get flattened to a third of their real size. Use a lighter pull for them.
- A change that alters who is projected changes the "10+ real minutes, projected" population. Judge it on the
  `real10` and all-in columns, and on game totals.
- Training and testing must use the same lineup inputs: lessons learned with the posted lineup must not be used
  before lineups are posted (that is why `rep` exists).
- The phone's nightly learning ran without any lineup input and only at 4 of the 8 stages. Fixed in the working
  copy: it now fetches the posted lineup of each finished game from ESPN and replays all 8 stages.

## GG Winner (WIP)

Map of the real-league live model: `notes/map-gg-league-live.md` (bugs verified in Node, not yet fixed):
1. The "starting total" is the first FanDuel line the phone saw, usually a LIVE line, so hot starts count twice.
2. ESPN clocks under a minute (`"45.2"`) are read as 45.2 minutes.
3. Quarter breaks on ESPN rows fall into the estimated-clock path.
4. The league default total is worded as "FanDuel's line".
5. The live number starts about 1% under the line at tip-off.
6. Half and quarter calls can fire before tip-off from an even split.
7. Rule check: the detail screen prints our number against FanDuel's line when we are BELOW it ("NO BET ... below
   FanDuel's line"). That breaks "plus edges only" as written.

There is no tracker for real-league games anywhere (the server tracker is eBasketball only).

## Test suites (run all before publishing)

```
node cs/tests/engine.test.js      # engine on two real games: sanity, plus-edges-only, lineup inputs, learning sums, wording
node cs/tests/app.test.js         # boots the real app in a simulated phone browser: screens, wording rules, edge record
```
(After changing the engine or the fixture date: `node tools/mkfixture.js`.)

## Publishing

No Hugging Face write access existed in the cloud session (the connector is read-only). To publish from a session:
a write token for huggingface.co must be provided through the session's secure credential form, or the changed
files are uploaded by hand at
`https://huggingface.co/spaces/everworldlife/courtside-arcade/upload/main` and
`https://huggingface.co/spaces/everworldlife/gg-winner/upload/main`. Never the Gridiron Arcade Space.

## Ideas not yet tested (ranked)

1. Teammate-out usage tables from season-long on/off data (DataBallr `/v1/nba/wowy/*`, `POST /v1/nba/pbp/player-wowy`),
   shipped as a small file like `sitprior.js`. The engine only knows "top scorer on/off" today.
2. Refit `LAND` (how much of the middle finish to show per stage) on the larger game set, and add PRA to the
   calibration (PRA chances are raw today).
3. `sitStreakW` 0 and `sitK` 400+ (the game-to-game streak factor looks like noise; situational ratios keep about
   half of a mostly-noise split).
4. `shiftCenter` 0 vs 1 (usage-shift centring is applied but was not trained).
5. A real-league tracker on the GG server (time, score, clock, FanDuel line, our number, final) so the late-game
   blend can be refit against FanDuel's live line.
