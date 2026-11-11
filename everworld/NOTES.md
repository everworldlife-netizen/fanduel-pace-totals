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
- ESPN ADDS RULED-OUT PLAYERS TO A GAME'S BOX AFTER THE GAME (injury text, "NOT WITH TEAM", rest, suspension as the
  did-not-play reason). While a game is on they are not in the box: checked live on Nov 10, 2026, 23 of 23 players
  listed Out on the injury report were missing from 10 live or just-finished team boxes. Archived boxes of past
  seasons carry 0.33 to 0.52 of them per team. So a "posted lineup" rebuilt from an archived box must leave them
  out (`ruledOut` in `tools/replay.js`; the phone's `espnLists` in data.js does the same for the nightly learning).
  Players who sat by coach's decision were dressed and stay on the list.
- ESPN's live "did not play" flag only means "has not checked in yet": recorded on Nov 10 (`tools/espnwatch.js`,
  `data/espn/livecheck/20261110.jsonl`), flagged players checked in later in the same game (three cases in three
  games). It is NOT a sign that a player is out. Nothing to use there.

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

### Courtside v15: what changed and what it measured

Changes in `cs/build/engine.js`, each behind a TUNE switch (shipped setting in brackets):
- `actDeep` [1], `actNew` [1]: with the lineup posted, project deep-bench players (weighted by how often they have
  been getting in) and players back from a layoff (from their season line; they get a negative id until they
  check in). Kept until the end of Q1.
- Eight new learned inputs: `startUp`, `startDown`, `fresh`, `deep`, `vacPos`, `lastMin`, `rest3`, `missShare`
  (PAT_F is now 42 long: `PAT_KEY`/`PAT_DATES` in app.js bumped to `pat:v4`). Starters come from the posted lineup;
  during live play the play-by-play only adds to it (early on it has not named every starter).
- `repGroup` [1]: "before lineups are posted" is its own learning stage (`rep`), because the app knows less then.
- `patCapMinUp` [1.5]: the learned layer may raise remaining minutes by more than it may cut them.
- `patLamLineup` [0.1]: lighter ridge for the rare, strong lineup inputs.
- `condMin` [1]: before tip-off, player minutes are "if he plays" numbers (a pick on a player who sits is no
  action), so they may add up to more than 240; the TEAM total is scaled to five players' worth of minutes.
- `patInterp` [1]: between two learning stages, blend their lessons by game minute. Exception: minutes lessons do
  not blend between halftime and the next stage.
- `patYCap` [0]: the learning target is the plain miss (the old one-sided cap is off).
- `teamCal` [0, OFF]: a learned team-total factor per stage. TRIED, DID NOT WIN (see below).
- `sitPre` [0, untested]: situational scoring files a basket under the score before it.
- Usual starter left out of the posted five gets a status flag (his picks are hidden until confirmed, like other
  shaky statuses) and a plain note; a reserve who starts gets a "STARTS TONIGHT" note.

Fold A (lessons from 2023-24 + 2024-25 = 2,387 games; tested on 1,199 unseen 2025-26 games; `real10` = everyone
who really played 10+ minutes, a missing projection counts as a full miss):

| moment | PTS miss, live engine → v15 | MIN miss | game total miss (bias) |
|---|---|---|---|
| before lineups | 5.001 → 5.004 (no change) | 5.56 → 5.55 | 15.17 (-4.1) → 15.14 (-4.1) |
| tip-off | 4.999 → 4.860 (-2.8%, z -11.3) | 5.55 → 4.98 (-10.3%, z -22) | 15.17 (-4.1) → 14.96 (-1.1) |
| 6 min in | 4.707 → 4.624 (-1.8%, z -10.0) | 5.51 → 5.11 (-7.3%, z -20) | 15.70 (-8.6) → 14.94 (-4.5) |
| 9 min in | 4.498 → 4.389 (-2.4%, z -12.1) | 5.39 → 4.78 (-11.4%, z -32) | 14.29 → 14.48 (n.s.) |
| end Q1 | 4.240 → 4.199 (-1.0%, z -6.4) | 4.74 → 4.47 (-5.7%, z -18) | 13.82 (-6.1) → 13.22 (-3.2) |
| half | 3.410 → 3.400 (-0.3%, z -2.3) | 3.66 → 3.65 | 11.47 → 11.56 (n.s.) |
| end Q3 | 2.316 → 2.310 (-0.3%, z -2.8) | 2.94 → 2.92 (-0.7%, z -6) | 8.34 → 8.30 |
| 6:00 left | 1.254 → 1.253 (no change) | 1.62 → 1.61 | 6.29 → 6.32 |

Runs: `data/lessons/A2-base.json`, `A2-v15d.json`; `tools/exp2.sh A2-v15d cs/build "<switches>" 2024,2025 2026`.
(The table is the run with `teamCal` off, `data/runs/A2-v15d-noteam.json`, which is what shipped.)

Fold B, the final exam (lessons from 2023-24 + 2024-25 + 2025-26 = 3,586 games; tested ONCE on the 123 games of
2026-27, Oct 21 to Nov 9, which no setting was chosen on; "before" = the live engine refit on the same 3,586 games,
`data/lessons/B-base.json`; `node tools/cmp.js data/runs/B-base.json data/runs/ship-holdout.json`):

| moment | PTS miss, live engine → v15 | MIN miss | game total miss |
|---|---|---|---|
| before lineups | 4.832 → 4.845 (n.s.) | 5.05 → 5.05 | 13.91 → 13.96 (n.s.) |
| tip-off | 4.832 → 4.725 (-2.2%, z -4.0) | 5.05 → 4.52 (-10.5%, z -6.7) | 13.91 → 13.97 (n.s.) |
| 6 min in | 4.518 → 4.442 (-1.7%, z -3.7) | 5.15 → 4.70 (-8.7%, z -7.1) | 14.82 → 13.47 (-9.1%, z -2.1) |
| 9 min in | 4.385 → 4.337 (-1.1%, z -2.0) | 4.89 → 4.48 (-8.4%, z -6.4) | 14.01 → 13.12 (-6.4%, z -2.1) |
| end Q1 | 4.132 → 4.142 (n.s.) | 4.44 → 4.32 (-2.6%, z -3.0) | 13.92 → 12.65 (-9.2%, z -3.3) |
| 21 min in | 3.522 → 3.480 (-1.2%, z -2.5) | 3.90 → 3.69 (-5.3%, z -6.4) | 12.09 → 12.01 (n.s.) |
| half | 3.263 → 3.258 (n.s.) | 3.56 → 3.50 (-1.8%, z -2.7) | 10.99 → 11.09 (n.s.) |
| 33 min in | 2.573 → 2.567 (n.s.) | 3.12 → 3.06 (-2.1%, z -3.2) | 8.86 → 8.68 (n.s.) |
| end Q3 | 2.203 → 2.182 (-0.9%, z -3.5) | 2.87 → 2.84 (-1.0%, z -2.6) | 7.87 → 7.87 |
| 6:00 left | 1.234 → 1.234 | 1.61 → 1.61 | 6.79 → 6.83 (n.s.) |
| 3:00 left | 0.701 → 0.702 (n.s.) | 0.787 → 0.794 (+0.9%, z 4.3: real but 0.007 of a minute) | 5.64 → 5.65 |

Same direction and about the same size as Fold A everywhere it matters, so the gains are not a one-season fluke.
Assists also moved: -1.1 to -1.7% in the first half (z -2.4 to -3.8). Rebounds and threes: no real change.
Top scorer in our top 3 at tip-off: 79% → 79%; end of Q1: 85% → 82% (123 games, about one sigma; watch it).

Chances (how often a stated chance came in). Before tip-off only players who went on to play are counted (a pick on
a player who sits is no action). Fold A, 1,199 games: v15 said 65% → came in 64.1%, said 85% → 84.9%; the live
engine: 68% and 88% (average gap 0.51% vs 1.37%). Fold B, 123 games: 85% at tip-off came in 83% (before 85%), 65%
came in 62% (before 64%); 85% at halftime 84% (84%); 65% at halftime 65% (68%); 65% after Q3 65% (66%). On 123 games
a 2 to 3 point gap is inside the noise.

What the phone gets: the in-app report shows exactly the Fold B table above. The engine that ships then learns from
every final game in the cache as well (see Publishing: "refit on everything"), like v14 did.

Blending lessons between stages (`patInterp`, 400 unseen games, in-between moments only): 15 min in: minutes -8.6%
(z -17.7), points -1.2% (z -4.3); 9 min: minutes -1.9%, points -0.5%; 21 min: minutes -2.1%; 33 min: minutes -2.4%;
39 min: minutes -5.0%; points unchanged from 27 min on. Blending the minutes lessons across halftime made minutes
2% WORSE at 27 min (z 5.2), so those do not blend there (confirmed on a second slice of 252 games: 0.0%).

### Correction to the test itself, and v16 (team load): supersedes the two tables above

The two tables above were measured with tip-off lists rebuilt from archived ESPN boxes AS THEY WERE: they included
the players ESPN adds after the game (ruled out: injury, rest, not with team). The phone never sees those players
on the list (see "Facts about the feeds"). `tools/replay.js` now leaves them out (`LAB_LISTS=all` gives the old
behaviour). Effect on 1,199 unseen games with the lessons unchanged: both engines measure about 1% closer on points
and 4 to 5% closer on minutes at tip-off, simply because the lab now knows what the phone knows. All lessons were
refit on the corrected lists (`A3-*`, `B3-*`, `C3-*`); lessons learned on the old lists carried a blanket "+14% if he
plays" on minutes that partly existed to make up for listed players who were never going to play.

How the missing context was found: `node tools/ctxcheck.js --dump <bt2 --dump rows>` regresses what is left of the
miss on schedule, travel, spread and total situations (unit = one team in one game). On 1,199 unseen games:
- NO real signal: back-to-backs by travel, 3 games in 4 nights, 4 in 6, altitude, time zones, early tips, road
  trips, home stands, rest edge (all inside what luck gives for 230 checks, once the two items below are in).
- The books' total looked strong (minutes +0.7 per player per 10 points of total, z 9.5) but it was standing in for
  who is available: it vanishes (z 0.3) once the team load is in.
- TEAM LOAD is real and large. Load = the usual minutes of everyone available tonight, added up, against 240
  (5th to 95th percentile: 200 to 300 minutes). The simulation shares minutes out by its own rules; reality differs
  a lot for the bench. Regular bench players (18 to 24 minutes a game): when the load was 300+ the plain engine gave
  them 10.8 minutes and they played 17.4; when it was under 228 it gave 24.9 and they played 25.0, and the learned
  layer then pushed that to 29.8. Load alone explained 30% of the team-to-team swing of their miss (z 28).
- EXPECTED MARGIN by role is real but small: starters of a team favored by 10 play about a minute less than the
  number (z -5.7), starters of a 10-point dog too (z -3.7), the dog's bench more (z 6.7).

v16 inputs (PAT_F is 49 long): `loadS`, `loadB`, `loadBd`, `loadBq` (load by role, deeper bench, and a curved term)
and `favS`, `dogS`, `dogB`. Switches: `loadIn` 1, `loadMid` 0.06, `favIn` 1, `loadStats` 0 (the load teaches
minutes only), `ctxUntil` 33 (both sit out from 33 minutes in).

Fold A on corrected lists (lessons from 2,387 games of 2023-25, tested on 1,199 games of 2025-26, every engine
refit the same way; `real10` population):

| moment | PTS miss, live engine → v16 | MIN miss | game total miss |
|---|---|---|---|
| before lineups | 4.963 → 4.945 (-0.4%, z -2.3) | 5.65 → 5.28 (-6.6%, z -21.8) | 15.94 → 15.22 (-4.6%, z -6.1) |
| tip-off | 4.961 → 4.761 (-4.0%, z -15.5) | 5.64 → 4.54 (-19.4%, z -39.7) | 15.94 → 14.89 (-6.6%, z -6.1) |
| 6 min in | 4.643 → 4.549 (-2.0%, z -12.1) | 5.29 → 4.74 (-10.4%, z -31.6) | 15.03 → 14.71 (-2.1%, z -2.0) |
| 9 min in | 4.458 → 4.341 (-2.6%, z -13.8) | 5.21 → 4.47 (-14.3%, z -40.7) | 14.22 → 13.97 (-1.8%, z -2.2) |
| end Q1 | 4.226 → 4.180 (-1.1%, z -7.5) | 4.71 → 4.35 (-7.7%, z -25.4) | 13.76 → 13.25 (-3.7%, z -3.8) |
| 21 min in | 3.638 → 3.605 (-0.9%, z -5.6) | 3.95 → 3.74 (-5.3%, z -16.7) | 12.19 → 12.00 (-1.5%, z -2.5) |
| half | 3.410 → 3.400 (-0.3%, z -2.2) | 3.66 → 3.61 (-1.2%, z -4.9) | 11.47 → 11.53 (n.s.) |
| 33 min in | 2.674 → 2.654 (-0.8%, z -5.1) | 3.22 → 3.09 (-3.9%, z -17.9) | 9.27 → 9.23 (n.s.) |
| end Q3 | 2.316 → 2.310 (-0.3%, z -2.8) | 2.94 → 2.92 (-0.8%, z -6.8) | 8.34 → 8.30 (n.s.) |
| 6:00 left | 1.254 → 1.253 | 1.62 → 1.62 | 6.29 → 6.32 (+0.5%, z 2.1) |
| 3:00 left | 0.708 → 0.708 | 0.743 → 0.747 (+0.4%, z 5.9: 0.004 of a minute) | 4.92 → 4.92 |

At tip-off rebounds, assists and threes are each about 1.5% closer too (z -7). Top scorer in our top 3: 74.1% →
74.8% at tip-off, 81.3% → 82.4% at the end of Q1. Chance gap: 0.61% → 0.64% at tip-off (same), 0.42% → 0.32% at Q1.

What v16 adds on top of v15 (both refit on corrected lists): tip-off minutes -3.9% (z -17.4), points -0.5%
(z -4.4); before lineups minutes -5.7% (z -19.2), points -0.5%, total -2.4% (z -3.4); 6 to 33 minutes in:
minutes -0.8 to -2.5% (z -5 to -11); identical from the end of Q3 on.

TRIED, DID NOT WIN (v16): the load teaching points, rebounds and assists too, and staying on all game
(`loadStats` 1, `ctxUntil` 0): same player numbers, but the game total got worse mid-game (21 min: 12.03 → 12.30,
z 3.5; 6:00 left z 2.8) and minutes a hair worse late. Minutes-only and off after 33 minutes keeps the gain
without that.

Season shift to remember when reading totals: in 2025-26 and 2026-27 teams score more in the time left than the
sum of our player numbers (bias -2 to -5 points a game at live stages; unbiased on 2023-25). Anything that
lifts numbers looks good on those seasons for that reason alone, so judge changes on the fixed-population player
columns and on z, not on the total's bias. The live total running low is an open item.

TRIED, DID NOT WIN:
- First version of `actDeep` (deep bench at their per-appearance minutes): game totals at tip-off ran 15 points
  high. Fixed by weighting by how often they get in, and by `condMin`.
- Learning pregame lessons while squeezing "if he plays" minutes into 240: the points lessons learned a blanket
  +10% to undo the squeeze, which inflated team totals by 13 to 16 points (found on the TRAINING season too, so it
  was a pipeline flaw, not a season shift). Fixed by `condMin`.
- `teamCal` (learned team-total factor per stage): on the training seasons the factor was 0.974 at tip-off and
  about 1.00 live; on the unseen season it made the tip-off total WORSE (15.17 → 15.69, bias -7) because scoring
  levels move between seasons. Without it: 14.96, bias -1.1. Left off. A factor tied to the books' line might work.
- The paired `PTS` and `MIN` columns of `cmp.js` (players that were projected) look worse for v15 at tip-off
  (MIN 4.99 → 4.93 is flat; an earlier version showed +8%) only because v15 projects more hard cases. Use `real10`.

### Traps found this session

- Ridge strength `patLam` = 32 means about 800 "ghost observations" per input. Inputs that fire rarely (a new
  starter is about one player a game) get flattened to a third of their real size. Use a lighter pull for them.
- A change that alters who is projected changes the "10+ real minutes, projected" population. Judge it on the
  `real10` and all-in columns, and on game totals.
- Training and testing must use the same lineup inputs: lessons learned with the posted lineup must not be used
  before lineups are posted (that is why `rep` exists).
- The phone's nightly learning ran without any lineup input and only at 4 of the 8 stages. Fixed in the working
  copy: it now fetches the posted lineup of each finished game from ESPN and replays all 8 stages.

## GG Winner

### Real-league live totals model (`gg/static/league-live.js`, v3.10)

Test: `node tools/ggbt.js --model <league-live.js> --seasons 2024,2025 --out data/ll/x.json`, compare with
`node tools/ggbt.js --cmp A.json B.json`. It replays NBA games minute by minute from the scoring timeline with the
closing total as the starting number. `--prior live:<minute>` plays "the phone first opened this game at that minute
and the first line it saw was a live line" (the live line is simulated as score so far + closing-line pace; no history
of real FanDuel live lines exists anywhere).

Live model as found (2,619 NBA games from 2023-25, which its settings never saw): it ran 2 to 3.5 points LOW through
three quarters and was no better than "score so far + closing-line pace" until the last 3 minutes.

| what | result on unseen games |
|---|---|
| Starting rate adds up to the line (the last quarter's slowdown and overtime were being taken off twice) | bias -2.2..-3.5 → -0.5..-1.8; miss 0.5 to 1.3% smaller through three quarters (z -2.4 to -5.9, 2,619 games); late game unchanged |
| A line first seen during the game is spread over the time left, not the whole game | opened at end of Q1: miss 7.5% smaller 3 minutes later, 4.5% at 27 min; opened at half: 8.8% at 27 min, 3.4% at 39 min; opened after Q3: 3.9% (all z below -7, 4,088 games, simulated live line) |
| Clocks under a minute (`"45.2"`) read as seconds; quarter breaks (`"End of 1st"`) read as a known clock | unit tests (`gg/tests/league-live.test.js`); real feed samples were not captured |
| No calls before tip-off on halves/quarters; league default total no longer called "FanDuel's line" | unit tests |

The app now stores, with the first line seen, the score and game minute at that moment (`lg-first-lines` in
localStorage gets `pts`, `el`, `diff`) and passes it as `priorSeen` to `LeagueLive.project`.

Not fixed / still open: live weights (`liveWeight`) and the late-game shape were left as they are (they test fine);
the model is still NBA-tuned (no data for other leagues); there is no tracker for real-league games (needs a
server-side log of time, score, clock, FanDuel line, our number, final).

### GG League gamer ratings (`gg/static/profiles.js`)

Test: `node tools/eb/browser_wf.js` (walk-forward on the 5,246 bundled league games, Oct 14 to Nov 4: every game
projected from games that finished before it; ratings refit every 50 games). Live settings: total miss 9.29 on 3,216
games (league average alone 11.46), winner picked 58%. This matches the app's own claim (9.31, 59%).

TRIED, DID NOT WIN: `node tools/eb/browser_wf.js --grid` tried 432 settings (half-life 7 to 21 days, player /
team / gamer-with-team / head-to-head shrink). The best on the tuning block (half-life 7, gamer-with-team 16: 9.400 →
9.360) was WORSE on the unseen block (9.181 → 9.217). The live settings stay. More games are needed before retuning
(the bundled seed stops Nov 4; the server keeps 14 days at `/api/eb/graded?days=14`, and a fetch tool for the H2H
feed still has to be written: `tools/ebfetch.js` does not exist yet).

### Wording rule fixes (both parts of GG Winner)

"Plus edges only" was broken in sentences that printed our number against a line we were below ("GG expects 104,
below FanDuel's 108..."). Fixed in `league-live.js`, `app.js` (three places), `research.js`: a line our number is not
ahead of now gets "Our number is not ahead of this line" and no number. "points a game over the last N" in the
gamer notes became "across the last N". The word "Overtime" is still used as a period name.

Not done: the server bundle (`gg/static/server/*`) was not touched (no source in the Space; the server map agent
did not finish). The late-game blend against FanDuel's live line for GG League games lives there.

## Test suites (run all before publishing)

```
node cs/tests/engine.test.js          # engine on two real games: sanity, plus-edges-only, lineup inputs, learning sums, wording
node cs/tests/app.test.js             # boots the real app in a simulated phone browser: screens, wording rules, edge record
node gg/tests/league-live.test.js     # real-league model: clocks, quarter breaks, first-seen lines, plus-edges-only wording
node tools/livecheck.js --local cs    # working copy in a phone-sized browser with tonight's real games (also --local gg)
node tools/livecheck.js               # both LIVE links (after publishing)
```
(After changing the engine or the fixture date: `node tools/mkfixture.js`.)

## Publishing

How the Courtside release is built (in this order, so the in-app report stays honest):
1. `tools/ship.sh <holdout lessons> <before run> "<switches>" <train games> cs/accuracy-findings.json <date>` writes
   the hold-out lessons into `cs/build/engine.js`, replays this season with them (`data/runs/ship.json`; keep a copy
   as `ship-holdout.json`), writes the in-app report from that run, runs every test and builds the release folder.
2. Refit on everything: `node tools/fit2.js --engine <frozen copy> --seasons 2024,2025,2026,2027 --no-playoffs
   --out data/lessons/C-v15d.json`, then `node tools/mkengine.js --engine cs/build/engine.js --lessons
   data/lessons/C-v15d.json`. Do NOT rerun `ship.sh` or `mkaccuracy.js` after this (the run would be in-sample).
   Set `PAT_FROM` in `cs/build/app.js` to the day after the last game in the lessons, so the phone's own nightly
   learning picks up from there (it only looks back 5 days).
3. Tests, `node tools/mkrelease.js --date <date>`, `node tools/livecheck.js --local cs` and `--local gg`.
4. After uploading: `node tools/mkrelease.js --verify release-<date>` (byte-for-byte against the live files) and
   `node tools/livecheck.js` (both live links in a phone-sized browser).

Release `release-2026-11-11/` (Courtside v15 `ca-shell-v15`, GG Winner v3.10.0 `gg-winner-v3.10.0`) is built and
checked locally. STATUS: NOT PUBLISHED YET. No Hugging Face write access existed in the cloud session (the
connector is read-only, and no token was available). To publish from a session: a write token for huggingface.co
must be provided through the session's secure credential form (never pasted into chat), or the changed files are
uploaded by hand at
`https://huggingface.co/spaces/everworldlife/courtside-arcade/upload/main` and
`https://huggingface.co/spaces/everworldlife/gg-winner/upload/main` (`release-2026-11-11/UPLOAD.md` lists them).
Never the Gridiron Arcade Space.

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
6. End of Q1 points did not move on the 123-game exam (4.13 → 4.14) though it won on 1,199 games (-1.0%), and the
   top-scorer-in-top-3 rate there dipped 85% → 82%. Re-measure when 300+ games of this season exist.
7. The edge record (`ledger:v1` on the phone) is the first real out-of-sample record of the picks themselves.
   Once a few hundred edges are graded, read it: if results sit well short of our chance, shrink shown chances
   toward the book's.
8. Other leagues in GG Winner (WNBA, college): the model is NBA-tuned and no data was collected for them.
9. `tools/ebfetch.js` (H2H feed history beyond the bundled seed) so the gamer ratings can be retuned on more games.
