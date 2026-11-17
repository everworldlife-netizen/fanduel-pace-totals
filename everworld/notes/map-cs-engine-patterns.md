# Courtside Arcade — engine map: learned patterns (PAT_*), calibration (CAL_*), liveUsage, situational (sit*), LADDERS

Source (read-only, pristine): `/home/claude/work/baseline/cs/engine.js` lines 650-1160, plus `/home/claude/work/baseline/cs/sitprior.js`.
Callers quoted for context: `engine.js` `projectGame` (1472-2160), `worker.js`, `app.js` 205-275, `data.js` 128-140 and 337-372.
All line numbers are `engine.js` unless another file is named. Everything below was read from the code; the numeric summaries of the shipped tables were produced by parsing the literals (not by guessing).

Contents
1. Quick facts and how to load this in Node
2. Constants: PAT_STATS, PAT_LEARN, PAT_F, PAT_D, PAT_IX, PAT_GROUPS, PAT_SHIFT, LAND, patGroup
3. patFeatures: every learned input
4. The learning math: patEmpty, patAdd, patGrade, patScore, solveLin, patSolve
5. PAT_PRIOR, patBeta, patApply, patShiftPart, and where the factors act in projectGame
6. `proj` (most-likely finish) vs `mean` (plain average): LAND
7. Calibration: CAL_*
8. patPack / patUnpack / patMinOnly
9. liveUsage
10. Situational scoring: SIT_CATS, teamStar, sitAgg, sitCurve, sitPriorOf, sitPriorParse, sitPriorShipped, sitProfile, sitFactor
11. sitprior.js format
12. LADDERS
13. Tunables used by this region
14. How production runs the learning loop, and a leak-free refit recipe for a backtest
15. Bugs, leaks, inconsistencies, weaknesses (improvement ideas)
16. Open questions

---

## 1. Quick facts and how to load this in Node

- `engine.js` is a UMD module (lines 19-23): `const E = require('/home/claude/work/baseline/cs/engine.js')` works in Node.
- Exported from this region (return statement on the last line, 2292): `PAT_STATS, PAT_F, PAT_GROUPS, PAT_LEARN, PAT_IX, PAT_PRIOR, patFeatures, patEmpty, patAdd, patGrade, patScore, patSolve, patApply, patGroup, patBeta, patMinOnly, patPack, patUnpack, liveUsage, calEmpty, calAdd, calTable, calTableFrom, calP, calProb, calLevel, CAL_STATS, SIT_CATS, teamStar, sitAgg, sitCurve, sitPriorOf, sitPriorParse, sitProfile, sitFactor, LADDERS, TUNE`.
- NOT exported (private to the closure): `PAT_D` (use `E.PAT_F.length` = 34), `PAT_SHIFT`, `LAND`, `solveLin`, `patShiftPart`, `calObs`, `CAL_PRIOR`, `CAL_LEVEL`, `SIT_PRIOR_CATS`, `sitPriorShipped`, `addDaysStr`.
- `E.TUNE` and `E.PAT_PRIOR` are the live objects (same references the engine reads at call time), so a harness can change a tunable (`E.TUNE.patLam = 16`) or swap the built-in pattern prior in place (`E.PAT_PRIOR.pre.pts = { b, d, n, w }`). `CAL_PRIOR` and `LAND` cannot be changed from outside; use `calTableFrom(dev, myPrior)` and `TUNE.landOn = 0` instead.
- Node gotcha (1092-1093): `sitPriorShipped()` reads `self.SIT_PRIOR_TXT`. In Node `self` is undefined, so the shipped situational prior is silently EMPTY and the empty result is cached for the life of the process. Always pass `o.sitPrior` to `projectGame` (1477: `const sitPrior = o.sitPrior || sitPriorShipped()`), built with `E.sitPriorParse(text)`; pass `{}` for "no prior".
- Number of learned inputs: `PAT_D = 34`.
- Stages: 8 (`pre`, then one every 6 game minutes). Learned stats: 5 (`min` + 4 box stats). So 40 coefficient vectors of length 34.

---

## 2. Constants

| name | line | value |
|---|---|---|
| `PAT_STATS` | 656 | `['pts','reb','ast','fg3m']` |
| `PAT_LEARN` | 658 | `['min','pts','reb','ast','fg3m']` (minutes first, then each stat "on top of the corrected minutes") |
| `PAT_F` | 659-663 | 34 feature names, see table below |
| `PAT_D` | 664 | `PAT_F.length` = 34 |
| `PAT_IX` | 665 | name → index map |
| `PAT_GROUPS` | 667 | `['pre','s6','s12','s18','s24','s30','s36','s42']` |
| `PAT_SHIFT` | 669 | `['track','shooting','uReal','luck','recent','fadeHist']` (indices 11, 16, 17, 18, 28, 30): the "shots moving between teammates" features |
| `LAND` | 673-674 | per stage, weight on the middle of the simulations for the SHOWN number (section 6) |

`PAT_F` in order:

| # | name | # | name | # | name |
|---|---|---|---|---|---|
| 0 | base | 12 | fouls | 24 | dnp |
| 1 | starter | 13 | livePace | 25 | usgHi |
| 2 | bench | 14 | margin | 26 | closeStar |
| 3 | b2b | 15 | minTrack | 27 | pfX |
| 4 | pace | 16 | shooting | 28 | recent |
| 5 | blowout | 17 | uReal | 29 | mpgC |
| 6 | roleTrend | 18 | luck | 30 | fadeHist |
| 7 | matesOut | 19 | leadS | 31 | leadProof |
| 8 | proof | 20 | trailS | 32 | tdMkt |
| 9 | home | 21 | lopB | 33 | tdLive |
| 10 | softD | 22 | on | | |
| 11 | track | 23 | sitLong | | |

`patGroup(st)` (675): `'pre'` if `st.phase === 'pre'`; otherwise `k = clamp(Math.round(st.elapsed / 6), 1, 7)` and the group is `'s' + 6k`. `st.elapsed` is elapsed game minutes from `gameState` (207-236). Resulting bands (verified by running it): elapsed `[0, 9)` → `s6`, `[9, 15)` → `s12`, `[15, 21)` → `s18`, `[21, 27)` → `s24`, `[27, 33)` → `s30`, `[33, 39)` → `s36`, `>= 39` (incl. overtime and phase `final`) → `s42`.

Where PAT_D (34) matters:
- Sizes: every sufficient-statistics table is `A` = 34x34 = 1156 numbers (row-major) and `b` = 34 numbers (728). `PAT_PRIOR[g][s].b` and `.d` are length 34 (833).
- Length guards that silently DROP data of another size: `patAdd` (737: `m.A.length !== PAT_D * PAT_D` → skip), `patBeta` (848: device table ignored), `patUnpack` (931: packed upper triangle must be `34*35/2 = 595` long, else that table stays empty).
- Storage: `app.js:213` stores the phone's sums under `'pat:v3:sum'` (pack format `v: 2`) and only grades dates `>= PAT_FROM = '2026-11-10'`. The comment there says the key was bumped because two inputs were added. Any change to PAT_F means: append at the END only (indices 0-16 and 11 are hard-coded as numbers in `patFeatures`), regenerate PAT_PRIOR at the new length, bump the storage key and PAT_FROM. `patBeta` tolerates a shorter prior (`P0.d[i] || 0`, `P0.b[i] || 0`): a new feature then starts at coefficient 0 with ridge-only confidence.
- Stale doc: the `patSolve` comment (812) still says `[..17]`.
- `PAT_WORDS` (1274-1285, outside this region) holds the plain-language label per feature; `tdMkt` and `tdLive` have no entry (they are never named in the explanation chips).

---

## 3. patFeatures(f) — lines 677-724

Returns `{ min: x, pts: x, reb: x, ast: x, fg3m: x }`, each `x` an array of 34 numbers. One shared base vector `b` is built, then copied per stat with two per-stat differences:
- `x[11]` (`track`) is per stat (live only).
- For `min`, `x[32]` (`tdMkt`) and `x[33]` (`tdLive`) are forced to 0 (715: "a team's scoring level says nothing about who plays").

`live = f.phase !== 'pre'`. Features marked L are 0 pregame.

The input object `f` is built in exactly one place, `projectGame` 1937-1941. The right-hand column says what the caller passes.

| # | name | formula in patFeatures | what `projectGame` passes (1932-1941) |
|---|---|---|---|
| 0 | base | `1` | |
| 1 | starter | `f.starter ? 1 : 0` | `p.starter` = `mpg >= 24` (1804; `mpg` is the recency-weighted minutes average, `TUNE.minDecay` 0.85) |
| 2 | bench | `f.mpg < 18 ? 1 : 0` | `p.mpg` |
| 3 | b2b | `f.b2b ? 1 : 0` | `b2b[p.tm] && st.phase === 'pre'` → only ever non-zero pregame |
| 4 | pace | `clamp((f.pace - 99) / 5, -2, 2)` | `seasonPace` (average of the two teams' pace, blended 35% with the books' total, 1592-1600) |
| 5 | blowout | `clamp(f.pBlow, 0, 1)` | `pBlow` = share of simulations with abs(margin at end of Q3) >= 20 (1640-1642) |
| 6 | roleTrend | `clamp(f.roleTrend / 5, -2, 2)` | `p.recent3 - p.mpgFlat` (last-3-games minutes minus the flat season average), 0 if no games |
| 7 | matesOut | `clamp((f.scale - 1) * 10, 0, 2)` | `p.uMul ?? scale[p.tm]`: the team usage renormalization factor, itself clamped 0.85..1.2 (1889-1902). Only the "usage scaled up" side is used |
| 8 | proof | `f.proof ? 1 : 0` | starter AND `coachHabits` flagged him blowout-proof (645) |
| 9 | home | `f.home ? 1 : 0` | `p.tm === h` |
| 10 | softD | `clamp((f.zoneF2 - 1) * 10, -2, 2)` | `p.zone ? p.zone.f2 : 1`; `f2` is clamped 0.88..1.12 (1721), so softD is within ±1.2 |
| 25 | usgHi | `clamp((usgS - 0.2) * 10, -1.5, 2.5)`, `usgS = f.usgS > 0 ? f.usgS : 0.2` | `p.usgBase` (season usage prior, before tonight's blend) |
| 29 | mpgC | `clamp((f.mpg - 24) / 8, -2, 1.5)` | `p.mpg` |
| 32 | tdMkt | `f.tdMkt \|\| 0` (not for `min`) | `tdF[tm].mkt` = `clamp(ln(priorRem / bu) * 5, -2, 2)` (1921): `bu` = bottom-up sum of the team's expected remaining player points (+ `otherPM` 0.4 pts/min for untracked minutes), `priorRem` = team's implied full-game points from the books' total and spread (or team ratings when no line) × `min(left, 48) / 48`. 0 when `TUNE.tdOn = 0`, `o.tdOff`, final, or either side <= 1 |
| 12 L | fouls | `f.foulTrouble ? 1 : 0` | `r.pf >= min(period + 1, 5)` and not fouled out / ejected |
| 13 L | livePace | `clamp((f.livePace - f.pace) / 5, -2, 2)` | `livePace` = possessions so far × 48 / elapsed (1602) |
| 14 L | margin | `clamp(abs(mg) / 10, 0, 3)`, `mg = f.mg \|\| 0` | `mg` = current score margin from his team's side |
| 15 L | minTrack | `clamp(f.minTrack - 1, -1, 1)` | `(r.min + 6) / (rotInfo.expSoFar + 6)` or 1 with no rotation map |
| 16 L | shooting | `f.fga >= 4 ? clamp((f.fgm / f.fga - 0.47) * 5, -2, 2) : 0` | tonight's FG |
| 17 L | uReal | `lu && lu.onPlays >= 4 ? clamp((lu.plays - usgS*lu.onPlays) / sqrt(usgS*lu.onPlays + 1), -2.5, 2.5) : 0` | `lu` from `liveUsage` (section 9) |
| 18 L | luck | `lu && lu.shots >= 2 ? clamp((f.now.pts - lu.xPts) / sqrt(lu.xPts + 1), -2.5, 2.5) : 0` | `lu.xPts = fg3a*3*p3 + (fga - fg3a)*2*p2 + fta*ft` with the model's shrunk percentages (1934) |
| 19 L | leadS | `f.starter ? clamp((mg - 8) / 10, 0, 2.5) : 0` | |
| 20 L | trailS | `f.starter ? clamp((-mg - 8) / 10, 0, 2.5) : 0` | |
| 21 L | lopB | `f.starter ? 0 : clamp((abs(mg) - 8) / 10, 0, 2.5)` | |
| 22 L | on | `f.on ? 1 : 0` | `!!r.on` (on the floor now) |
| 23 L | sitLong | `!f.on && !f.dnp ? clamp((f.sitting \|\| 0) / 6, 0, 2) : 0` | `sitting` = minutes since his last stint ended |
| 24 L | dnp | `f.dnp ? 1 : 0` | `!!r.dnpYet` (rostered, has not checked in) |
| 26 L | closeStar | `abs(mg) <= 8 ? usgHi : 0` | |
| 27 L | pfX | `clamp((f.now.pf \|\| 0) - 1 - f.el / 16, -2, 2.5)` | fouls vs a "1 + elapsed/16" pace |
| 28 L | recent | `lu && lu.minR >= 3 && lu.onPlaysR >= 3 ? clamp((lu.playsR - usgS*lu.onPlaysR) / sqrt(usgS*lu.onPlaysR + 1), -2.5, 2.5) : 0` | his last 6 on-court minutes |
| 30 L | fadeHist | `f.fade != null && f.d1 != null ? clamp(f.fade * f.d1, -1, 1) : 0` | `fade` = `p.sit.fade` (section 10); `d1 = clamp(r.pts / r.min / p.sit.base - 1, -1, 2)` only when live, `r.min >= 6`, `el >= 10` |
| 31 L | leadProof | `f.proof ? leadS + trailS : 0` | |
| 33 L | tdLive | `f.tdLive \|\| 0` (not for `min`) | `clamp(ln(max(ptsNow, 1) / (full * el / 48)) * 5 * (el / (el + 12)), -2, 2)` when live and `el >= 3` (1923) |
| 11 L | track (per stat) | `k = (s === 'min' ? 'pts' : s)`; `exp = f.ratePM[k] * f.min`; `x[11] = f.min >= 4 && exp > 0.3 ? clamp((f.now[k] - exp) / sqrt(exp + 1), -2, 2.5) : 0` | `ratePM` = season per-minute rate shrunk with 60 prior minutes (1831-1832); `f.min` = minutes played tonight; `f.now` = tonight's box row |

Unused field: the caller also passes `absMargin`, which `patFeatures` never reads.

All features are known at projection time; nothing in `patFeatures` itself looks at the future. Leaks, where they exist, come from the caller's inputs (section 15).

---

## 4. The learning math

### patEmpty() — 726-733
```
{ pre..s42: { min|pts|reb|ast|fg3m: { A: number[1156] (zeros), b: number[34] (zeros), n: 0, w: 0 } },
  acc: { pre..s42: { n, pts, reb, ast, fg3m, g, top3 } }   // running accuracy (patScore)
  cal: calEmpty() }                                        // calibration counts (section 7)
```

### patAdd(acc, more, wt = 1) — 734-747
Adds `wt * more` into `acc`, table by table (`A`, `b`, `n`, `w`), then `cal` (via `calAdd`) and `acc.acc`. Tables whose `A` is not 1156 long are skipped. Returns `acc`. Sufficient statistics are plain sums, so nights and devices add up.

### patGrade(proj, rows, acc, opts) — 752-783
`proj` = `projectGame()` output; `rows` = `logEntry(game, plays).rows` of the finished game (keyed by pid, only players with `min > 0`, fields `min, pts, reb, ast, fg3m, ...`, 423-440); `acc` = `patEmpty()`; `opts.only` = optional list of stats to grade ("the fit runs in two passes").

For each `p` of `proj.players`:
1. Skip if `p.pat` is missing (it is always set by `projectGame`, 1943 / 2131).
2. Final line `a = rows[p.pid]`. If there is no row or `a.min` is not > 0:
   - pregame (`proj.state.phase === 'pre'`): the player is SKIPPED ("pregame we assume lineups are known").
   - live: he counts as a real miss, his final line is what he already had: `a = { min: p.now.min, pts: p.now.pts, reb, ast, fg3m }`.
3. `S = acc[p.pat.g]` (the stage table).
4. For each `s` of `PAT_LEARN` (filtered by `opts.only`):

```js
const f0  = s === 'min' && p.pat.f && p.pat.f.min ? p.pat.f.min : 1;        // 767
const rem = ((p.mean || p.proj)[s] - p.now[s]) / f0;                        // 768  projected amount still to come
if (!(rem >= 0.25)) continue;                                               // 769
const y = Math.min(a[s] - (p.now[s] + rem), rem * 4 + (s === 'min' ? 14 : s === 'pts' ? 10 : 5));   // 771
const x = p.pat.x[s];
T.b[i]            += rem * y * x[i];                                        // 773
T.A[i*PAT_D + j]  += rem * rem * x[i] * x[j];
T.n++; T.w += rem * rem;                                                    // 774
```

What this means, exactly:
- Projection used: `p.mean` (the plain average of the simulations), falling back to `p.proj` only if `mean` is absent. The LAND-blended "most-likely finish" is NOT what is graded. Good.
- `rem` = projected remaining amount = `mean[s] - now[s]`. For `min` it is divided by the learned minutes factor that was applied (`p.pat.f.min`), to "back out" the correction and grade minutes against the plain projection. For the four stats `f0 = 1`, i.e. they are graded against whatever projection was passed in (in production: plain stats on top of learned minutes).
- Target: `y = final[s] - (now[s] + rem)` = final minus the mean projection: the plain miss, in raw units (minutes, points, ...). It is CAPPED FROM ABOVE at `4*rem + c` with `c` = 14 (min), 10 (pts), 5 (reb, ast, fg3m). No lower cap. The comment (770) says the older cap at +200% "cut off big nights for small roles and taught the layer to aim low"; a one-sided cap still exists.
- Inclusion: every projected player with a final row (pregame) or any projected player (live), per stat only when `rem >= 0.25`. Player-moments projected for less than 0.25 more of a stat never enter the regression for that stat.
- Regression being accumulated: minimize `Σ (y - rem · x·β)²`, equivalently a weighted regression of the RELATIVE miss `y/rem` on `x` with weight `rem²`. So `1 + x·β` is the multiplicative factor on the remaining amount, and the loss is squared error in raw units (stars with a lot still to come dominate).
- `n` = player-moments, `w` = `Σ rem²`.

5. Calibration counting (777-780), only when `acc.cal` exists, `p.laddersRaw` exists and (`opts.only` is absent or includes `'pts'`): for each `s` of `CAL_STATS`, `lvl = calLevel(s, (p.mean || p.proj)[s] - p.now[s])`, and for every ladder rung `L1` of `p.laddersRaw[s]` with `L1.t > p.now[s]`: `calObs(acc.cal, p.pat.g, s, lvl, L1.p, a[s] >= L1.t ? 1 : 0)`. This is not filtered by `rem >= 0.25`. The chance graded is the RAW simulated chance.

Note on the docstring (749): it says `proj` is "made with patW 0". Production does not do that: `worker.js:20` passes `patterns: Engine.patMinOnly(...)`, i.e. learned minutes ON and learned stat factors OFF, and relies on `f0` to back the minutes factor out.

### patScore(proj, rows, acc) — 785-801 (the running accuracy report)
- Bucket: `acc.acc[patGroup(proj.state)]`.
- "Top scorer in top 3": `top` = the highest actual `pts` among ALL rows of the game (both teams); `ids` = everyone tied at that number; `best` = our three highest `p.proj.pts` across both teams. `A.g++` per graded projection; `A.top3++` if any of our three is in `ids`.
- "Average miss": for every projected player whose FINAL row has `min >= 10`: `A.n++` and `A[s] += abs(p.proj[s] - a[s])` for pts, reb, ast, fg3m. Average miss = `A[s] / A.n`. It uses `p.proj` (the SHOWN number, LAND-blended), not `p.mean`, and the population is chosen by the outcome (actual minutes).

### solveLin(A, b, d) — 802-811
Gauss-Jordan with partial pivoting on a copy; a pivot below 1e-12 is skipped and that coefficient returns 0. Not exported.

### patSolve(acc, lam) — 813-829
```js
L = lam ?? TUNE.patLam            // 32
for each group g, stat s:
  T = acc[g][s];  if (!T || T.n < 200) → null
  avg = T.w / T.n                 // mean rem²
  A_ii += L * avg * 25            // ridge = 800 × mean(rem²) on every diagonal, INCLUDING the intercept
  β = solveLin(A, T.b, 34), rounded to 5 decimals
out = { n: max T.n, pre: { min: [34]|null, pts: ..., ... }, ..., s42: {...} }
```
Ridge shrinks toward 0 (no correction). Relative to the intercept's own information (`A_00 = w = n·avg`) the ridge is `800 / n` (about 3% at n = 25,000; 19% for `s42.fg3m`, n = 4,276). `patSolve` output has NO `.cal` field (add one yourself, section 14).

---

## 5. PAT_PRIOR, patBeta, patApply, patShiftPart

### PAT_PRIOR — line 833 (18,439 characters, one line)
Comment (830-832): "What 1,314 finished games taught the live role engine (1,191 from all of last season + 123 from Oct 21 - Nov 9 this season), projected with the same inputs the live app has (season-to-date stats, team ratings, closing lines, lineups): coefficients per stage and stat (b), how much evidence sits behind each (d = diagonal weight, n = player-moments graded)."

Shape: `PAT_PRIOR[group][stat] = { b: number[34], d: number[34], n: int, w: number }` for all 8 groups × 5 stats. Sample:
```
PAT_PRIOR.s24.pts = { b: [-0.0353, 0.0232, -0.0239, 0, 0.011, -0.0066, ...], d: [982000, 790000, 71600, 0, 561000, 78100, ...], n: 25655, w: 982500 }
```
- `b` = the shipped coefficients (4 decimals). `patBeta(null)` returns exactly these (checked: max abs difference 0).
- `d` = the diagonal of the training `A` (i.e. `Σ rem² x_i²`), 3 significant digits. Check: `d[0] / w` is 0.996-1.004 everywhere (feature 0 is the constant 1). The off-diagonal of `A` is NOT shipped.
- `n`, `w` as in `patGrade`.
- `d[i] = 0` and `b[i] = 0` where the feature never fired in training: all live features in `pre`; `b2b` in every live group; `dnp` from `s24` on; `fadeHist` in `s6`; `tdMkt`/`tdLive` for `min`; `tdLive` in `pre`.

Evidence per table (`n` / root-mean-square of `rem` / ridge as a share of the intercept's information):

| group | min | pts | reb | ast | fg3m |
|---|---|---|---|---|---|
| pre | 24939 / 25.06 / 3.2% | 24939 / 12.15 / 3.2% | 24921 / 4.90 / 3.2% | 24548 / 3.22 / 3.3% | 21440 / 1.47 / 3.7% |
| s6 | 28934 / 20.63 / 2.8% | 28928 / 9.95 / 2.8% | 28852 / 4.06 / 2.8% | 27972 / 2.66 / 2.9% | 23676 / 1.24 / 3.4% |
| s12 | 29100 / 17.75 / 2.7% | 29054 / 8.66 / 2.8% | 28816 / 3.51 / 2.8% | 27066 / 2.36 / 3.0% | 22353 / 1.11 / 3.6% |
| s18 | 28196 / 15.36 / 2.8% | 28038 / 7.47 / 2.9% | 27562 / 3.03 / 2.9% | 25681 / 2.08 / 3.1% | 20817 / 0.97 / 3.8% |
| s24 | 25692 / 13.10 / 3.1% | 25655 / 6.19 / 3.1% | 25519 / 2.52 / 3.1% | 24227 / 1.70 / 3.3% | 19496 / 0.80 / 4.1% |
| s30 | 25689 / 9.82 / 3.1% | 25632 / 4.38 / 3.1% | 25441 / 1.84 / 3.1% | 23581 / 1.23 / 3.4% | 17659 / 0.61 / 4.5% |
| s36 | 25786 / 6.69 / 3.1% | 25460 / 2.92 / 3.1% | 24475 / 1.25 / 3.3% | 19972 / 0.90 / 4.0% | 11792 / 0.47 / 6.8% |
| s42 | 25802 / 3.52 / 3.1% | 22390 / 1.70 / 3.6% | 17506 / 0.82 / 4.6% | 11851 / 0.64 / 6.8% | 4276 / 0.37 / 18.7% |

Shipped coefficients ×1000 (a value of 80 means "+8% of the remaining amount per unit of the feature"; `·` = no evidence, coefficient 0).

`min`:

| # | feature | pre | s6 | s12 | s18 | s24 | s30 | s36 | s42 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | base | 19 | 16 | -17 | -45 | -15 | -58 | -38 | -185 |
| 1 | starter | -35 | -86 | -51 | -47 | -5 | 8 | 48 | 82 |
| 2 | bench | -12 | -40 | -10 | -22 | 7 | 23 | 19 | 61 |
| 3 | b2b | 5 | · | · | · | · | · | · | · |
| 4 | pace | -11 | -4 | -2 | 8 | 11 | 18 | 20 | 27 |
| 5 | blowout | 0 | -14 | -25 | -27 | -36 | -34 | -54 | -18 |
| 6 | roleTrend | 11 | 34 | 31 | 32 | 25 | 18 | 28 | 22 |
| 7 | matesOut | -59 | -40 | -20 | -11 | 0 | 3 | 3 | 3 |
| 8 | proof | -12 | 2 | -1 | 0 | 2 | 15 | 20 | 2 |
| 9 | home | -2 | 1 | -4 | -5 | -3 | -8 | -8 | -23 |
| 10 | softD | -3 | -1 | -3 | -3 | -3 | -1 | 1 | 17 |
| 11 | track | · | 10 | 14 | 20 | 16 | 24 | 26 | 25 |
| 12 | fouls | · | 21 | 14 | -1 | 17 | -38 | -6 | -51 |
| 13 | livePace | · | -1 | 0 | -3 | -1 | -2 | -3 | 4 |
| 14 | margin | · | 0 | -9 | -16 | -22 | -41 | -58 | -112 |
| 15 | minTrack | · | -60 | 49 | 51 | 58 | -86 | -37 | -72 |
| 16 | shooting | · | 5 | -4 | -8 | -12 | -6 | -10 | 17 |
| 17 | uReal | · | -7 | -9 | -14 | -3 | -9 | -2 | -1 |
| 18 | luck | · | 1 | 7 | 10 | 15 | 10 | 15 | -2 |
| 19 | leadS | · | 1 | 3 | 4 | 7 | -10 | -45 | -92 |
| 20 | trailS | · | -5 | -1 | -1 | -16 | -31 | -50 | -97 |
| 21 | lopB | · | -3 | -14 | -7 | -27 | -10 | 9 | 121 |
| 22 | on | · | 37 | 39 | 85 | 5 | 42 | 5 | 340 |
| 23 | sitLong | · | 17 | 104 | 63 | -1 | 17 | 32 | -118 |
| 24 | dnp | · | -112 | -237 | -165 | · | · | · | · |
| 25 | usgHi | 28 | -5 | 21 | 23 | 19 | 18 | 13 | -6 |
| 26 | closeStar | · | 15 | 7 | 9 | 17 | 21 | 36 | 81 |
| 27 | pfX | · | -14 | 2 | -5 | 7 | -12 | 8 | 2 |
| 28 | recent | · | -4 | -1 | 4 | 0 | 1 | -13 | 8 |
| 29 | mpgC | -19 | -23 | -16 | -5 | -13 | -47 | -17 | -30 |
| 30 | fadeHist | · | · | -7 | -9 | -6 | -8 | -15 | -7 |
| 31 | leadProof | · | 0 | -4 | -12 | -12 | -16 | -24 | -15 |
| 32-33 | tdMkt, tdLive | · | · | · | · | · | · | · | · |

`pts`:

| # | feature | pre | s6 | s12 | s18 | s24 | s30 | s36 | s42 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | base | 24 | 16 | -2 | -11 | -35 | -22 | -35 | -106 |
| 1 | starter | 13 | 1 | 14 | 26 | 23 | 43 | 36 | 80 |
| 2 | bench | -24 | 12 | -7 | -11 | -24 | -24 | -13 | 114 |
| 3 | b2b | 10 | · | · | · | · | · | · | · |
| 4 | pace | -10 | -1 | 3 | 6 | 11 | 13 | 19 | 26 |
| 5 | blowout | 4 | -2 | -30 | -17 | -7 | 0 | -28 | 40 |
| 6 | roleTrend | -24 | -45 | -25 | -25 | -36 | -18 | -27 | -34 |
| 7 | matesOut | -61 | -20 | 0 | 5 | 1 | 13 | -26 | 31 |
| 8 | proof | 2 | 14 | 17 | 12 | 14 | 16 | 11 | 23 |
| 9 | home | 3 | 1 | -1 | 3 | 8 | 7 | 7 | 29 |
| 10 | softD | 14 | 18 | 14 | 18 | 6 | 4 | 11 | 29 |
| 11 | track | · | -2 | 7 | 6 | 0 | -2 | 2 | 31 |
| 12 | fouls | · | 16 | 12 | 4 | 1 | -41 | -47 | -27 |
| 13 | livePace | · | -3 | -4 | -8 | -4 | -4 | 0 | 14 |
| 14 | margin | · | 2 | 3 | -4 | -1 | 17 | 24 | -21 |
| 15 | minTrack | · | -8 | -22 | -20 | -19 | -6 | -25 | -11 |
| 16 | shooting | · | -4 | -14 | -12 | -9 | -17 | -16 | -15 |
| 17 | uReal | · | 5 | -4 | -3 | -22 | -2 | -13 | 14 |
| 18 | luck | · | -22 | -13 | -10 | -27 | -5 | -22 | -27 |
| 19 | leadS | · | -4 | -38 | -39 | -40 | -60 | -66 | -105 |
| 20 | trailS | · | 8 | 21 | 27 | 14 | -12 | 1 | -25 |
| 21 | lopB | · | 4 | 5 | 26 | 36 | 53 | 60 | 97 |
| 22 | on | · | -30 | -13 | -5 | 0 | -19 | -8 | 18 |
| 23 | sitLong | · | 21 | -12 | 9 | 5 | -21 | -26 | -49 |
| 24 | dnp | · | -41 | -76 | -55 | · | · | · | · |
| 25 | usgHi | -41 | -55 | -36 | -33 | -58 | -48 | -57 | -21 |
| 26 | closeStar | · | 26 | -1 | 8 | -3 | 13 | -9 | 132 |
| 27 | pfX | · | 3 | -7 | -5 | -14 | 5 | -6 | -34 |
| 28 | recent | · | -7 | -7 | -20 | 1 | -15 | 14 | -5 |
| 29 | mpgC | 20 | 48 | 33 | 37 | 59 | 83 | 65 | 96 |
| 30 | fadeHist | · | · | -7 | -2 | 3 | 5 | -6 | -16 |
| 31 | leadProof | · | 1 | 2 | 10 | 13 | 15 | 15 | -5 |
| 32 | tdMkt | 80 | 104 | 101 | 94 | 84 | 85 | 79 | 48 |
| 33 | tdLive | · | -21 | -23 | -30 | -36 | -56 | -54 | -67 |

Intercepts (`base`, ×1000) of the other stats by stage, pre → s42: reb `-8 -21 -54 -42 -59 -39 -29 -69`; ast `-31 -33 -73 -86 -97 -102 -110 -129`; fg3m `-2 -27 -37 -42 -49 -51 -81 -78`. The full tables are in `E.PAT_PRIOR`.

### patBeta(dev, lam) — 840-861
Combines the built-in prior with the phone's own sums. `dev` = `patEmpty()`-shaped sums (or null).
```js
L = lam ?? TUNE.patLam                        // 32
for each g, s:
  P0 = PAT_PRIOR[g][s]          → if missing: out[g][s] = null
  T  = dev[g][s] (ignored unless T.A.length === 1156)
  A = T ? copy of T.A : zeros;  b = T ? copy of T.b : zeros
  avg0 = P0.w / max(P0.n, 1)
  for i: di = (P0.d[i] || 0) + L * avg0 * 25;  A_ii += di;  b_i += di * (P0.b[i] || 0)     // 853
  out[g][s] = solveLin(A, b, 34), 5 decimals
  out.n = max(out.n, P0.n + T.n);  out.graded = max(out.graded, T.n)
out.cal = calTable(dev && dev.cal)             // built-in CAL_PRIOR + phone counts
```
In words: the prior is a DIAGONAL Gaussian prior centred on the shipped coefficients `P0.b`, with confidence `d_i + 800·mean(rem²)` per coefficient; the phone's own full `A` and `b` are added on top; one linear solve. With nothing graded on the phone the result is exactly `P0.b`. The phone's sums come from residuals of the projection WITHOUT stat corrections (section 14), so they are on the same footing as the prior and adding them is coherent.

Output shape: `{ n, graded, pre: { min: [34], pts: [34], reb, ast, fg3m }, ..., s42: {...}, cal: { group: { stat: [mapLvl0, mapLvl1] } } }`. This object is what `projectGame` takes as `o.patterns`.

### patApply(beta, x, cap, shift) — 863-871
```js
z = Σ beta[i] * x[i];   parts[i] = beta[i] * x[i]
zz = z - (shift || 0)
c = cap ?? TUNE.patCap                         // 0.3
return { f: 1 + TUNE.patW * clamp(zz, -c, c), z: zz, parts, shift: shift || 0 }
```
`f` is the multiplicative factor on the remaining amount. Caps: ±30% for stats (`TUNE.patCap`), ±60% for minutes (`TUNE.patCapMin`, passed by the caller at 1942).

### patShiftPart(beta, x) — 873
`Σ beta[i] * x[i]` over the six `PAT_SHIFT` features only. Not exported.

### Where the factors act in projectGame
- 1927-1929: `patOn = !!(o.patterns && TUNE.patW > 0)`; `patB = o.patterns[patGroup(st)] || {}`.
- 1942 minutes: `Fm = patB.min && !(ejected || pf >= 6) ? patApply(patB.min, patX.min, TUNE.patCapMin) : { f: 1 }`; 1944 stores `p.minPlain = mean(p.mins)` BEFORE the factor; 1945 `p.mins[i] = min(left, p.mins[i] * Fm.f)` for every simulation.
- 1948-1963 (only when learned minutes are on): team cap at 5 × time left; in close games minutes the layer took away are handed to teammates the layer did not cut (`TUNE.refill`, players with `F.min.f >= 0.97`).
- 1965-1980: overtime minutes are added after that.
- 1983-1987 usage-shift centring, live only, points only: `shiftT[tm] = TUNE.shiftCenter * Σ_p w_p * patShiftPart(patB.pts, x_p.pts) / Σ_p w_p`, `w_p = mean(p.mins) * p.usg`.
- 1989: `p.pat.F[s] = patApply(patB[s], x[s], TUNE.patCap, s === 'pts' ? shiftT[tm] : 0)` for pts, reb, ast, fg3m.
- 1999: points: `usg = p.usg * (uMul or scale) * patF.pts.f` (the factor multiplies his usage, i.e. his plays).
- 2030: threes: `r3P = clamp(p.r3 * patF.fg3m.f / patF.pts.f, 0, 0.95)` (share of his shots that are threes; the points factor cancels, so made threes scale with `fg3m.f`).
- 2053-2054: rebounds and assists: the per-minute rate is multiplied by `patF.reb.f` / `patF.ast.f`.
- Output per player (2131): `pat: { g, x: {min,pts,reb,ast,fg3m}, f: {min,pts,reb,ast,fg3m} (numbers), parts (null when patterns off), shift }`. `x` is always present, even with patterns off, so `patGrade` always works.

---

## 6. `proj` (most-likely finish) vs `mean` (plain average): LAND — 670-674, applied 2074-2086, 2124

```js
LAND = { pre: { fg3m: 1 }, s6: { fg3m: 1 }, s12: { ast: 0.25, fg3m: 1 }, s18: { ast: 0.5, fg3m: 1 },
         s24: { pts: 0.25, ast: 1, fg3m: 1 }, s30: { pts: 0.75, reb: 0.25, ast: 1, fg3m: 1 },
         s36: { pts: 1, reb: 1, ast: 1, fg3m: 1 }, s42: { pts: 1, reb: 1, ast: 1, fg3m: 1 } }
```
- `avg[k]` = plain mean of the simulations (2062).
- `mid[k]` = mean of the sorted simulations from index `floor(0.4 N)` to `min(N-1, floor(0.6 N))` inclusive (2077): the middle fifth, not the single median.
- Shown: `shown[k] = max(now[k], (1 - lw) * avg[k] + lw * mid[k])` for pts/reb/ast/fg3m with `lw = LAND[group][k] || 0`, only when `TUNE.landOn > 0`, not final, time left > 0 (2085-2086).
- Output (2124): `proj = { ...shown, min }` and `mean = { ...avg, min }`. Keys in both: `pts, reb, ast, fg3m, fga, fg3a, fta, pra, min`. `pra` and `min` are never LAND-blended (so `proj.pra` is the mean while its three parts may be the middle).
- Who uses which: `patGrade` learns from `mean` (768, 778). `patScore` and the ACCURACY report grade `proj`. Team score (`projScore`, 2146) is the mean of simulated team points. Picks compare `p.proj[stat]` with the line (2264).
- Comment (670-672): LAND weights were "learned on last season (595 games) and checked on this season's 123 games".

---

## 7. Calibration of the chances — 874-918

Constants: `CAL_STATS = ['pts','reb','ast','fg3m']` (877; no `pra`). `CAL_LEVEL = { pts: 9, reb: 2.5, ast: 2.5, fg3m: 1.2 }` (878). `calLevel(s, rem) = rem >= CAL_LEVEL[s] ? 1 : 0` (879): level 1 = "a lot still to come", level 0 = "a little".

Count structure (`calEmpty()`, 880): `cal[group][stat] = [level0, level1]`, each level = 10 bins, each bin = `[count, sum of simulated chances, sum of hits]`.

`calObs(acc, g, s, lvl, p, y)` (881, not exported): bin = `min(9, floor(p * 10))`; `count++`, `sumP += p`, `hits += y`.

`calAdd(acc, more, wt = 1)` (882-885): adds counts bin by bin.

`CAL_PRIOR` (835, 11,416 characters): same shape as `calEmpty()` with the counts "over those games" (the 1,314 PAT_PRIOR games). Sample: `CAL_PRIOR.s24.pts[0][0..2] = [[143069, 1163.46, 1612], [9816, 1398.03, 1595], [6147, 1503.29, 1720]]`. Rung-observations for pts (level 0 / level 1): pre 98,991 / 125,460; s12 171,007 / 82,802; s24 182,967 / 27,014; s36 197,926 / 113; s42 196,771 / 0. Late-game level-1 tables are empty, so their maps are the identity.

`calTable(dev)` = `calTableFrom(dev, CAL_PRIOR)` (887). `calTableFrom(dev, prior)` (888-909), per group, stat, level:
```js
for bin i in 0..9:
  a = prior bin, b = device bin;  n = a[0] + b[0];  if (n < 30) skip the bin
  x = (a[1] + b[1]) / n                         // mean simulated chance in the bin
  y = ((a[2] + b[2]) + 40 * x) / (n + 40)       // hit rate, shrunk toward "as simulated" with K = 40 pseudo-observations
then pool neighbours that run backwards (count-weighted average, step back two and re-check)
map = [[0, x..., 1], [0, y..., 1]]              // 4 decimals
```
Passing `prior = null` gives a device-only table (`{}` prior). With nothing at all, every map is `[[0,1],[0,1]]` (identity).

`calP(map, p)` (911-916): returns `p` unchanged if there is no map or `p <= 0` or `p >= 1`; otherwise straight-line interpolation between the map points.

`calProb(player, stat, p)` (918): `player.cal[stat] ? calP(player.cal[stat], p) : p`. `pra` and anything without a map stay as simulated.

Use in `projectGame` (2065-2082): `calT = patOn && o.patterns.cal ? o.patterns.cal[group] : null`; per stat `cal[k] = calT[k][calLevel(k, avg[k] - now[k])]` (one map per player-stat, chosen by expected remaining amount); `laddersRaw[k]` = simulated chance per rung; `ladders[k]` = calibrated for rungs above what he has (rungs already reached keep the raw value); the 80% range (`range`) is found from calibrated chances. Picks: `calProb(p, stat, probOver(p._sims[stat], line))` (2263; `worker.js:38`).

What the built-in maps look like (simulated → calibrated), read from `patBeta(null).cal`:
- `pre.pts` level 1 (9+ points to come): 0.10 → 0.062, 0.30 → 0.284, 0.50 → 0.562, 0.70 → 0.785, 0.90 → 0.930 (raw simulations are too spread out for big roles).
- `pre.pts` level 0 (under 9 to come): 0.10 → 0.131, 0.30 → 0.362, 0.50 → 0.563, 0.70 → 0.722 (small roles reach rungs more often than simulated).
- `s36.pts` level 0: 0.55 → 0.52, 0.74 → 0.68, 0.84 → 0.79 (late, the simulations are over-confident at the high end).

---

## 8. patPack / patUnpack / patMinOnly — 919-940

- `patPack(sum)` (920-925): `{ v: 2, acc, cal, g: { group: { stat: { u: upper triangle of A (595 numbers, row by row, j >= i), b: [34], n, w } } } }`, numbers at 5 significant digits; tables with `n = 0` are omitted.
- `patUnpack(pk)` (926-938): returns `patEmpty()` if `pk.v !== 2`; restores the symmetric `A`; tables whose `u` is not 595 long are left empty; `acc` and `cal` are added via `patAdd`.
- `patMinOnly(beta)` (940): `{ n, graded, minOnly: true, group: { min: beta[group].min } }` for every group. No stat coefficients and NO `.cal`, so a projection made with it has learned minutes, plain stats, and uncalibrated ladders.

---

## 9. liveUsage(plays, box, el) — 942-967

Inputs: `plays` = play-by-play (DataBallr shape: `team.abbreviation`, `shooting_play`, `text`, `type`, `period`, `clock`, `participants`); `box` = `boxFromPlays(...).players` (rows with `pid, team, stints, fga, fta, tov`); `el` = elapsed game minutes. Called once per live projection (1656); `{}` pregame.

1. Team play events: for every play with a team: weight `w` = 1 for a shooting play, 0.44 if its text includes `'free throw'`, 1 if `type` includes `'Turnover'`, otherwise the play is ignored. Stored per team as `[elapsed minutes, w, participants[0]]`.
2. Per box row: walk his stints backwards to find `cut`, the game minute where his last 6 on-court minutes begin (`need` = minutes still missing if he has played less than 6).
3. Every team event inside one of his stints (±0.02 min) adds `w` to `onPlays`; if it is at or after `cut` it adds to `onPlaysR`, and to `playsR` when `participants[0] === r.pid`.

Output per pid: `{ onPlays, onPlaysR, playsR, minR: 6 - need, plays: r.fga + 0.44*r.fta + r.tov, shots: r.fga + r.fta }`.

`xPts` is NOT produced here; `projectGame` adds it at 1934: `xPts = fg3a*3*p3 + (fga - fg3a)*2*p2 + fta*ft`. These feed `uReal`, `luck`, `recent` (section 3). The projection output echoes them as `p.live` (2133).

---

## 10. Situational scoring tendencies — 970-1151

Idea (970-974): from each recent game's scoring timeline, a player's points per on-court minute in each situation relative to his own normal rate, shrunk toward 1.

### Log entry shape these functions need (from `logEntry`, 423-440)
`{ id, date, v, h, len (48 + 5 per overtime), margin: { [team]: final margin }, rows: { pid: { name, team, min, pts, ..., st: [[in, out], ...] in elapsed game minutes } }, sc: [[elapsed minute, side (0 = visitor, 1 = home), points, scorer pid], ...] }`.

### SIT_CATS — 975
`['q1','q2','q3','q4','ahead','close','behind','clutch','starOn','starOff','home','away','b2b','rest']` (14).

### teamStar(logs, tm) — 977-987
Sums `pts`, `min`, games per player over log rows with `team === tm` and `min > 0`. The star is the highest points-per-game player with `g >= 3` and `min/g >= 20`. Returns `{ pid, name, ppg, mpg }` or `null`.

### sitAgg(logs, pid, o) — 994-1048
`o.team`: his team (string) or `null` to follow him across teams; `o.starOf(team)` → star pid; star on/off is only counted on `o.starTeam`.
Returns `{ c: { cat: [points, minutes] }, P, M, halves: [[pts1, min1, pts2, min2], ...], games: [[pts, min], ...] }`.

Per game (logs sorted by date; skipped unless the row has `st` and the log has `sc`):
- Running margin from his team's side, stored AFTER each scoring event; `mAt(u)` = margin after the last event at time `<= u` (1009-1010).
- Star: the team star unless that is the player himself; `starOn(u)` = the star's stint covers `u`. If the star did not play that game, all his minutes count as `starOff`.
- Back-to-back: this game's date is the day after the team's previous game in the same `logs` (1016-1017).
- `catsAt(u)` (1019-1025): quarter `q = min(4, floor(u/12) + 1)` (overtime counts as q4); `ahead` if margin `>= 12`, `behind` if `<= -12`, else `close`; `clutch` if `u >= len - 5` and `abs(margin) <= 5`; `starOn`/`starOff` when a star is defined.
- Minutes: each stint is stepped in 0.25-minute slices; each slice's minutes go to the categories at the slice midpoint and to the game categories (`home`/`away`, `b2b`/`rest`); first half = midpoint < 24.
- Points: each scoring event where he is the scorer, on his side, and on the floor (±0.1 min): the points go to `catsAt(event time)` and the game categories; first half = time < 24.
- `P`, `M` = total points and minutes counted this way; one `halves` and one `games` entry per game with minutes.

### sitCurve(A, base) — 1050-1064
Returns `[sxy, sxx, gxy, gxx]`.
- Halves (both halves >= 6 minutes): `d1 = clamp(pts1/min1/base - 1, -1, 2)`, `d2` likewise for the second half, `w = min(min1, min2) / 12`; `sxy += w*d1*d2`, `sxx += w*d1²`.
- Game → next game (consecutive played games, both >= 10 minutes): `gxy += d1*d2`, `gxx += d1²`.

### sitPriorOf(logs, pid, starOf) — 1066-1077 (builder for the shipped prior)
Main team = most minutes. `A = sitAgg(logs, pid, { team: null, starTeam: main, starOf })`. Returns `null` unless `A.M >= 200` and `A.P/A.M > 0.05`. Result: `{ t: main, s: star pid or null, P, M (1 decimal), c: 14 [pts, min] pairs, cv: sitCurve (3 decimals) }`. The shipped text keeps only part of this (section 11).

### sitPriorParse(txt) — 1079-1091
`SIT_PRIOR_CATS = 10`. Splits on `;` then `,`, all numbers. A record is kept only if it has at least 26 fields and field 3 (`M`) > 0.
```
out[a[0]] = { s: a[1] || null, P: a[2], M: a[3],
              c: 14 pairs, the first 10 from a[4 + 2i], a[5 + 2i]; home, away, b2b, rest = [0, 0],
              cv: [0, 0, a[24], a[25]] }          // half-to-half sums are not shipped; only game → next game
```

### sitPriorShipped() — 1092-1093
Lazily parses `self.SIT_PRIOR_TXT` once and caches it; `{}` when `self` or the text is missing (always the case in plain Node).

### sitProfile(logs, pid, tm, star, prior) — 1094-1123
Called per player at 1833: `sitProfile(logs, r.pid, tm, stars[tm], sitPrior[r.pid] || null)` unless `TUNE.sitOn === 0` (`sitOn` is not defined in TUNE, so it is on).
```js
A    = sitAgg(logs, pid, { team: tm, starTeam: tm, starOf: () => star ? star.pid : null })
pr   = prior with M > 0, else null;   lam = pr ? TUNE.sitPriorW : 0          // 0.5
bCur = A.M >= 30 && A.P > 0 ? A.P / A.M : null;   bPr = pr ? pr.P / pr.M : null
if both null → return null
sc   = bCur != null && bPr ? bCur / bPr : 1          // puts last season's points on this season's level
M = A.M + lam * pr.M;   P = A.P + lam * pr.P * sc;   if (M < 30) return null
base = P / M;   if (!(base > 0.05)) return null
```
(When he has 30+ minutes this season, `base` equals this season's rate exactly: the prior only adds minutes at that rate.)
- Categories: `c[k] = [A.c[k][0] + lam * pr.c[k][0] * sc, A.c[k][1] + lam * pr.c[k][1]]`; the prior is used for a category only if it has data there, and for `starOn`/`starOff` only if last season's star is the same player (`pr.s === starId`).
- Ratio: `ratio[k] = clamp((c[k][0] + K*base) / ((c[k][1] + K) * base), 0.6, 1.6)` with `K = TUNE.sitK` = 150 minutes of "his normal rate".
- `fade = (cv[0] + lam*pc[0]) / (cv[1] + lam*pc[1] + TUNE.sitFadeK)` (K = 3); with the shipped prior `pc[0] = pc[1] = 0`, so fade uses this season only.
- `streak = (cv[2] + lam*pc[2]) / (cv[3] + lam*pc[3] + TUNE.sitStreakK)` (K = 3).
- `lastDev` = his last game's rate vs `base`, `clamp(.., -1, 2)`, 0 if that game had under 10 minutes.
- `offShare` = share of his minutes with the star off the floor, or null.
Returns `{ base, min: M, games, c, ratio, fade, streak, lastDev, star (the star object or null), offShare, prior: !!pr }`.

### sitFactor(S, o) — 1125-1151 (one multiplier per simulated game script)
`o = { qRem: { 1..4: his remaining minutes by quarter }, m0: margin now (his side), m3: simulated margin at end of Q3 (his side), clutchShare, home, b2b, starOffShift, d1 }`, built at 2016-2021.
```js
parts.q     = Σ qRem[q] * R['q'+q] / Σ qRem[q]                     (1 if no minutes left)
st(mm)      = mm >= 12 ? R.ahead : mm <= -12 ? R.behind : R.close
pre         = share of his remaining minutes before the 4th;  q4 = 1 - pre
q4f         = abs(m3) <= 6 ? (1 - cl) * R.close + cl * R.clutch : st(m3),   cl = min(clutchShare, 1)
parts.state = pre * st((m0 + m3) / 2) + q4 * q4f
parts.home  = o.home ? R.home : R.away
parts.rest  = o.b2b ? R.b2b : R.rest
parts.star  = (f*R.starOff + (1-f)*R.starOn) / (h*R.starOff + (1-h)*R.starOn),  h = S.offShare, f = clamp(h + starOffShift, 0, 1)   (1 if no star)
parts.fade  = d1 != null ? clamp(1 + S.fade * d1, 0.8, 1.25) : 1
parts.streak= clamp(1 + S.streak * S.lastDev, 0.88, 1.12)
f = q^sitQW * state^sitStateW * home^sitHomeW * rest^sitRestW * star^sitStarW * fade^sitFadeW * streak^sitStreakW
return { f: clamp(f, 0.7, 1.35), parts }
```
With today's weights (`sitQW 1, sitStateW 1, sitHomeW 0, sitRestW 0, sitStarW 0.5, sitFadeW 0, sitStreakW 0.5`) the live factor is `q × state × sqrt(star) × sqrt(streak)`; home/away, rest and fade are switched off (fade still feeds the `fadeHist` learned input and the fade warning).
Where it acts: 2037, `lam = plays × usg × usageShock × sitArr[i]`: it multiplies his plays (so points and threes), simulation by simulation. It does not touch rebounds or assists, and it is applied after the team usage renormalization (it is not re-normalized across teammates).
`clutchShare` (2016): `5/12` pregame and before the 4th; in the 4th `5/left` (1 once 5 minutes or fewer remain). `starOffShift` (2005-2015): 1 if the star is out/ejected/fouled out, else `clamp((normal remaining minutes - projected remaining minutes) / max(left, 1), -0.5, 1)`.

---

## 11. sitprior.js format

Two lines, 42,687 bytes:
1. `/* Last season's situational scoring per player (built from 2025-26 play-by-play, 980 games). */`
2. `self.SIT_PRIOR_TXT = "<records>";` — one string, records separated by `;`, fields by `,`.

Each record has exactly 26 numeric fields (verified for all 418 records, 418 distinct pids):

| index | field |
|---|---|
| 0 | player id |
| 1 | his team's top scorer that season (pid); 0 = none (29 records) |
| 2 | P: total points counted |
| 3 | M: total on-court minutes |
| 4-11 | points, minutes for q1, q2, q3, q4 |
| 12-17 | points, minutes for ahead, close, behind |
| 18-19 | points, minutes for clutch |
| 20-21 | points, minutes with the star on |
| 22-23 | points, minutes with the star off |
| 24-25 | game → next game sums: `gxy`, `gxx` (1 decimal) |

Example: `3,140,145,508,53,143,36,132,38,140,18,93,29,119,114,384,2,5,0,18,107,366,38,141,2.1,9.3` → pid 3, star 140, 145 points in 508 minutes, q1 53/143 ... starOff 38/141, streak sums 2.1 / 9.3. Quarter sums and state sums each add back to P and M (0 mismatching records). Values 2-23 are whole numbers. M ranges 301-2378 (average 1088).

League-wide ratios in this file (category rate ÷ overall rate, minute share): q1 1.016, q2 1.004, q3 1.015, q4 0.964; ahead 1.228 (14.8% of minutes), close 0.991 (70.7%), behind 0.811 (14.6%); clutch 0.998 (3.0%). League-wide game → next game slope `Σgxy / Σgxx` = 0.0086 (187 of 418 players have a negative `gxy`).

To load in Node: read the file, take the text between the quotes on line 2, `E.sitPriorParse(text)`, and pass the result as `o.sitPrior`.

---

## 12. LADDERS — 1153-1159
```js
{ pts: [5,10,15,20,25,30,35,40,45], reb: [2,4,6,8,10,12,14,16], ast: [2,4,6,8,10,12], fg3m: [1,2,3,4,5,6],
  pra: [10,15,20,25,30,35,40,45,50,55,60] }
```
Used at 2069-2072 (`laddersRaw[k] = steps.map(t => ({ t, p: probAtLeast(sims[k], t) }))`), for calibration counting (779) and for the "safest rung" picks (2273-2282).

---

## 13. Tunables used by this region (all in `TUNE`, lines 28-97, or inline)

| constant | value | where used | meaning |
|---|---|---|---|
| `TUNE.patW` | 1 | 870, 1927 | 1 = apply learned corrections; 0 = off (`patOn` false) |
| `TUNE.patCap` | 0.3 | 865, 1989 | most a learned stat factor can move the remaining amount |
| `TUNE.patCapMin` | 0.6 | 1942 | same for remaining minutes |
| `TUNE.patLam` | 32 | 814, 841 | ridge; the diagonal gets `patLam × 25 × mean(rem²)` |
| inline `25` | 25 | 823, 853 | ridge multiplier (with patLam 32 → 800) |
| inline `200` | 200 | 820 | minimum player-moments for `patSolve` to return coefficients |
| inline `0.25` | 0.25 | 769 | minimum projected remaining amount to enter the regression |
| inline `4`, `14 / 10 / 5` | | 771 | upper cap on the target: `4·rem + 14` (min), `+10` (pts), `+5` (others) |
| `TUNE.shiftCenter` | 1 | 1983-1986 | share of the team's average usage-shift taken back out of each player's points factor |
| `TUNE.refill` | 1 | 1952 | learned minute cuts are handed to teammates in close games |
| `TUNE.landOn` | 1 | 2085 | show the LAND blend instead of the plain mean |
| `LAND` | section 6 | 2085-2086 | per-stage weight of the middle |
| `TUNE.tdOn` | 1 | 1907 | top-down team check feeds `tdMkt` / `tdLive` |
| `TUNE.otherPM` | 0.4 | 1918, 2140-2142 | points per minute for untracked minutes |
| `CAL_LEVEL` | pts 9, reb 2.5, ast 2.5, fg3m 1.2 | 879 | "a lot still to come" threshold |
| inline `30` | 30 | 899 | minimum observations for a calibration bin |
| inline `K = 40` | 40 | 900-901 | calibration shrink toward "as simulated" |
| `TUNE.sitK` | 150 | 1113-1115 | minutes of his normal rate mixed into every situational ratio |
| `TUNE.sitPriorW` | 0.5 | 1098 | weight of last season's situational totals |
| `TUNE.sitFadeK` | 3 | 1118 | shrink of the half-to-half slope |
| `TUNE.sitStreakK` | 3 | 1119 | shrink of the game-to-game slope |
| `TUNE.sitQW` | 1 | 1148 | exponent on the quarter part |
| `TUNE.sitStateW` | 1 | 1148 | exponent on the score-state part |
| `TUNE.sitHomeW` | 0 | 1148 | off |
| `TUNE.sitRestW` | 0 | 1148 | off |
| `TUNE.sitStarW` | 0.5 | 1149 | exponent on the star on/off part |
| `TUNE.sitFadeW` | 0 | 1149 | off |
| `TUNE.sitStreakW` | 0.5 | 1149 | exponent on the streak part |
| `TUNE.sitOn` | undefined | 1833 | only `=== 0` turns situational off |
| inline sit thresholds | ±12 ahead/behind; clutch = last 5 min and within 5; `DT` 0.25; halves >= 6 min; games >= 10 min; ratio clamp 0.6-1.6; factor clamp 0.7-1.35; fade clamp 0.8-1.25; streak clamp 0.88-1.12; q4 "close" band `abs(m3) <= 6` | 1002-1146 | |
| teamStar thresholds | 3+ games, 20+ mpg | 985 | |
| sitPriorOf thresholds | 200+ minutes, rate > 0.05 | 1072 | |
| liveUsage | FT weight 0.44, 6-minute recent window, ±0.02 stint tolerance | 947-964 | |
| feature gates | `onPlays >= 4`, `shots >= 2`, `minR >= 3 && onPlaysR >= 3`, `fga >= 4`, `min >= 4 && exp > 0.3` | 694-719 | |

---

## 14. How production runs the learning loop, and a leak-free refit recipe

### Production (phone)
- `app.js:213-275` `learnRecent()`: once a day, for each of the last 5 days not yet done and `>= '2026-11-10'`, for every final game: `plays` → `act = E.logEntry(g, plays)`; `logs = DB.teamLogs([v, h], d)` (last 8 finished games per team within 21 days before `d`, `data.js:337`); the saved pregame line; four checkpoints `CPS = [null, 1, 2, 3]` = pregame, end of Q1 (elapsed 12 → `s12`), half (`s24`), end of Q3 (`s36`). Groups `s6, s18, s30, s42` are never graded on the phone.
- `worker.js:10-28` per checkpoint:
```js
base = { game, plays, logs, priors: payload.priors, injuries: [], nsims: 300, seed: cp.game.id,
         overrides: { in: [], out: [] }, teams, market: j.market || null, tdOff: !j.market };
P = Engine.projectGame({ ...base, patterns: Engine.patMinOnly(payload.patterns || Engine.patBeta(null)) });
Engine.patGrade(P, j.rows, acc);                                   // all 5 stats + calibration, one pass
if (payload.patterns) Engine.patScore(Engine.projectGame({ ...base, patterns: payload.patterns }), j.rows, acc);
```
- The day's sums are added to the stored sums (`E.patAdd(patSum() || E.patEmpty(), dayAcc)`), packed (`E.patPack`), and the live coefficients are rebuilt with `E.patBeta(patSum())` (`app.js:215-219`).
- The live projection (`app.js:169-170`) additionally passes `injuries`, `avail` (lineups), `gameLogs`, `props`; the learning run passes none of these.

### Leak-free refit for a backtest (all functions are exported)
The shipped `PAT_PRIOR` / `CAL_PRIOR` were fit on every game through 2026-11-09, `LAND` on last season, and `sitprior.js` on all of 2025-26. Scoring the shipped engine on any of those games is in-sample. To prove a gain on unseen games, refit on the training fold only:
```js
// pass 1: minutes against the plain model
acc1 = E.patEmpty();
for each training game, checkpoint: P = E.projectGame({ ...inputs, patterns: null, sitPrior });   E.patGrade(P, rows, acc1, { only: ['min'] });
bMin = E.patSolve(acc1);                                   // { group: { min: [34], pts: null, ... } }
// pass 2: stats (and chances) on top of the learned minutes
acc2 = E.patEmpty();
for each ...: P = E.projectGame({ ...inputs, patterns: E.patMinOnly(bMin), sitPrior });           E.patGrade(P, rows, acc2, { only: ['pts','reb','ast','fg3m'] });
bSt = E.patSolve(acc2);
patterns = { n: bSt.n }; for (g of E.PAT_GROUPS) patterns[g] = { min: bMin[g].min, pts: bSt[g].pts, reb: bSt[g].reb, ast: bSt[g].ast, fg3m: bSt[g].fg3m };
patterns.cal = E.calTableFrom(acc2.cal, null);             // device-only calibration, no built-in prior
```
Notes: `patSolve` returns `null` for any table with fewer than 200 player-moments (then that stat gets factor 1). To mimic "prior + phone" exactly, overwrite `E.PAT_PRIOR[g][s] = { b, d: diagonal of A, n, w }` from the training sums, call `E.patBeta(devSums)`, then replace `.cal` with `E.calTableFrom(devSums.cal, trainCal)`. `projectGame` returns `_sims` and `laddersRaw` (only `worker.js` deletes them), so a harness can compute its own middle/quantiles. Score `mean` for bias, squared error and team totals; score `proj` for average miss.

Published baseline (app.js:12, `ACCURACY.after`, 123 held-out games, players with 10+ actual minutes): pregame average miss pts 4.77, reb 1.93, ast 1.43, fg3m 0.89, min 4.33; after Q3 pts 2.18, reb 0.94, ast 0.56, fg3m 0.30, min 2.75.

---

## 15. Bugs, leaks, inconsistencies, weaknesses (improvement ideas)

Ordered roughly by how much they matter for "closer to real results, proven on unseen games".

1. In-sample tables (leak for any backtest). `PAT_PRIOR` and `CAL_PRIOR` (833, 835) contain every game through 2026-11-09; `sitprior.js` contains all of 2025-26; `LAND` was fit on last season. A backtest that uses the shipped tables on those games grades the model on games it trained on. Use the refit recipe in section 14 and `o.sitPrior` built only from earlier seasons (or `{}`).

2. Phone learning grades old games with today's season stats (leak into the learning target). `app.js:266` passes `priors: state.priors` and `teams: state.teamsDb`; `data.js:128` shows the current-season priors are the season-to-date table as of today. A game from 1-5 days ago is therefore projected with stats that already include that game (and later ones), so the residual the layer learns from is smaller and biased toward the outcome. Early in a season one game is about a tenth of the sample. Fix: project graded games with as-of stats (keep a dated snapshot per day) or derive them from the logs.

3. Train/serve mismatch in the phone learning inputs. The learning run (`worker.js:17`) uses `injuries: []`, no `avail`, no `gameLogs`; the live run has all three (`app.js:169-170`). The comment on PAT_PRIOR says the built-in lessons were made "with ... lineups". So the phone's own lessons come from projections that do not know who is out, while pregame DNPs are dropped from grading (759), which can make their teammates look under-projected. Those lessons are then applied to projections that DO know the lineup. Fix: save the lineup/injury snapshot with the tip-off projection and replay with it.

4. Score-state ratios count a basket in the state it creates. In `sitAgg` the margin array is stored after each event (1009) and a player's points are filed under `catsAt(e[0])` (1038), which reads the margin INCLUDING his own basket. A three that takes a lead from 10 to 13 is filed as "ahead"; a basket from -13 to -11 is filed as "close", not "behind". On top of that, being ahead and scoring at the same moment are the same event seen twice. Verified by running `E.sitAgg` on a synthetic game: a three at minute 5 that moves the lead from 10 to 13 came back as `ahead: [3 pts, 7 min]`, and a basket that cuts a 13-point deficit to 11 came back under `close` with `behind: [0 pts, 0.5 min]`. The shipped prior shows the result: league-wide "ahead" ratio 1.228, "behind" 0.811; after the 150-minute shrink the average player's prior-only ratio is still 1.08 ahead and 0.95 behind. `sitStateW = 1` applies these to the rest of the game for players on a leading/trailing team (through `st((m0 + m3)/2)` and `st(m3)`), and the learned layer then pushes the other way: the points coefficient on `leadS` is negative at every live stage (-0.038 at s12 to -0.105 at s42). Fixes to test on held-out games: file points by the margin BEFORE the scoring play (or the margin one possession earlier); divide each player's state ratio by the league state ratio; or set `sitStateW = 0` and let `leadS/trailS/lopB/margin` carry the game script. Refit the layer after each.

5. The learning target is still capped on one side (771): `y <= 4·rem + 14/10/5`. Any one-sided cap pulls the learned corrections down. It binds only for very small projections with very big finishes (for points: more than `4·rem + 10` above the projection), so the effect is probably small, but the brief's rule is "never train on a trimmed target". Count how many rows hit the cap per stage; remove it (or, if outliers hurt, use a symmetric rule and say so).

6. Players projected for under 0.25 more of a stat never enter the regression (769), and the correction is purely multiplicative. A deep-bench player projected for about nothing who ends up with garbage-time minutes cannot be learned or corrected by a factor on about nothing. The minutes "refill" (1948-1963) covers part of it. An additive term for near-zero roles (keyed on `lopB`, `dnp`, `blowout`) is the missing piece.

7. Calibration is counted on one kind of simulation and applied to another. The phone counts chances from the minutes-only run at 300 simulations (`worker.js:20-21`, `patMinOnly` has no stat factors) and applies the map to full-pattern simulations at the user's simulation count (2065-2071). Whether CAL_PRIOR was counted the same way is not visible in the repo. Count the chances from the same projection that will be shown (full patterns, same simulation count); with 300 simulations the chance itself is noisy (about ±3 points at 50%), which flattens the map.

8. `pra` is never calibrated. `CAL_STATS` has no `pra`, so `calProb` returns the raw chance for PRA lines (2263) and PRA ladders/ranges stay raw, even though the raw chances for the parts are visibly off (pre, points, big roles: said 14% → happened 9%; said 65% → happened 73%). Add `pra` (with its own "a lot" threshold, e.g. around 13) to the calibration.

9. The calibration tables say the simulated spread is wrong by role, which also moves the shown number. Small roles (under 9 points to come) reach every rung more often than simulated (25% → 32% pregame); big roles are too spread out. The map repairs the ladders, but `mid`/LAND (the shown number), the 80% range search and PRA use the raw simulations. Fixing the spread at the source (minutes uncertainty for bench roles up, usage shock for big roles down; `TUNE.usgShock`, `TUNE.minShock` are single league-wide numbers) should be tested, then LAND refit.

10. Game-to-game "streak" is noise at player level but is applied. League-wide slope in the shipped prior is 0.0086; raw per-player slopes range -1.4 to +0.6, with `gxx` typically 5-11 (median 7.5) behind them and a shrink of only 3 (`sitStreakK`). After that shrink the prior-only slopes still spread evenly around zero (5th to 95th percentile: -0.16 to +0.15), which is what noise looks like. `sitStreakW = 0.5` then moves a player's scoring by up to about ±6% after an extreme game. Shrink toward the league slope with a much larger K, or set `sitStreakW = 0`; verify on held-out pregame points.

11. Situational ratios are built from very little data. Live `logs` are at most 8 games per team (`data.js:337`), plus half of last season; with `sitK = 150` a per-quarter ratio keeps roughly half of what is mostly noise (a quarter split is about 60 current minutes + about 135 prior-weighted minutes). In the shipped prior alone, the shrunk per-player ratios have a spread (standard deviation) of about 0.07 in every category, the 4th quarter included. `sitQW = 1`, `sitStateW = 1` apply them at full strength. Test `sitK` of 400-1000, or weights below 1, on held-out live checkpoints.

12. Minutes are graded against an approximate "plain" number. 767-768 divide the corrected remaining minutes by `f0`, but after the factor the engine also clips at time left, rescales the team to 5 × time left, refills minutes to teammates and adds overtime (1945-1980). For teammates who received refill minutes `f0` is about 1 yet their minutes went up, so their "plain" projection is overstated and the next fit pushes them down. The exact plain value is already in the output (`minPlain`, 1944/2133). Use `rem = p.minPlain - p.now.min` for `min`. In a two-pass refit with `patterns: null` this does not arise.

13. Usage-shift centring is applied but not trained (1983-1989 vs 773). Coefficients for `track/shooting/uReal/luck/recent/fadeHist` are fit on raw features; at run time the team's usage-weighted average of their combined effect is subtracted (points only). If a whole team shoots hot, the learned "luck" correction is partly cancelled. Train on the same centred quantity, or validate `shiftCenter` 0 vs 1 on held-out games.

14. `patBeta` keeps only the diagonal of the prior's information (853). The built-in evidence is treated as if the 34 inputs were unrelated, though many move together (`base`, `starter`, `on`, `mpgC`, `usgHi`). The phone's lessons are therefore mis-weighted against the built-in ones in exactly the directions that matter (shared level vs contrasts). Ship the full table (595 numbers per stage/stat) or the raw sums and solve once.

15. Regression weighting and penalty. The fit minimizes raw squared error (weight `rem²` on the relative miss), so big roles dominate; count data has variance roughly proportional to `rem`, so weight `rem` would be the efficient choice and gives small roles a fairer say. The ridge also shrinks the intercept toward "no correction". Both are cheap to test: the weights only change what `patGrade` accumulates.

16. What the shipped coefficients reveal about the base model (fix at the source, then the layer has less to undo): `tdMkt` on points is +0.08 to +0.10 at every stage (the player numbers lag the books' team total by about 40% of the gap); assists/rebounds/threes intercepts drift negative during games (assists -7% at s12 to -13% at s42: remaining assists are over-projected live); minutes at s42 need `on` +0.34 and intercept -0.19 (who finishes the game is poorly modelled); `usgHi` is -0.04 to -0.06 and `mpgC` +0.02 to +0.10 on points (high-usage players over-projected, heavy-minute players under-projected); `roleTrend` is positive for minutes and negative for points.

17. The accuracy report filters on the outcome and scores the shown number. `patScore` (796) only counts players who actually played 10+ minutes and grades `p.proj`. Players we projected who got hurt or sat are left out; players never projected are invisible. For proof, fix the population before the game (e.g. everyone projected for 10+ minutes plus everyone who played), report misses on `mean` and on `proj` separately, and keep team totals on `mean`.

18. Smaller items.
- Phone learning touches only `pre, s12, s24, s36`; `s6, s18, s30, s42` stay at the built-in values forever (`app.js:222`).
- Overtime games: "clutch" is the last 5 minutes of the whole game (`len - 5`), so the end of regulation in an overtime game is not clutch (1022); overtime is filed under q4.
- `proj.pra` is the plain mean while `proj.pts/reb/ast` may be the middle (2086), so the shown PRA does not equal the shown parts.
- `patGrade` docstring says "made with patW 0" but production grades a minutes-corrected projection (`worker.js:20`).
- `patSolve` docstring still says 17 inputs.
- The Q4 quarter ratio (league 0.964) and `TUNE.q4Pace = 0.94` may both be taking the 4th-quarter slowdown out of scoring (possible double count; the simulation side is outside this region).
- `xPts` uses `p.p3/p.p2/p.ft`, which may already contain a little of tonight's shooting (`TUNE.tonightW`), slightly understating "luck".
- The monotone pooling in `calTableFrom` re-pools already pooled neighbours with their combined counts (weights are double-counted in runs of three or more); harmless at these sample sizes.

---

## 16. Open questions

1. How exactly was `PAT_PRIOR` built? The comment credits `scripts/backtest.js`, which is not in the Space. Assumed from the numbers: `b` = `patSolve` at `patLam` 32 after the two-pass fit, `d` = diagonal of `A` (supported by `d[0] ≈ w`). Whether situational factors, LAND, `gameLogs` and lineups were on during that fit is stated only in a comment.
2. Was `CAL_PRIOR` counted from minutes-only or full-pattern simulations, and at how many simulations?
3. The PAT comment says 1,191 games from last season, the LAND comment says 595, and `sitprior.js` says 980. Are these different subsets, and which games exactly?
4. On turnover plays, is `participants[0]` always the player who lost the ball (needed for `playsR` in `liveUsage`)? Not verifiable from the code alone.
5. Do the player ids in `sitprior.js` (including the "star" field) use the same id space as today's logs for every player? 29 records have star 0.
6. Is `TUNE.sitOn` meant to be undefined (situational on) or was a default intended?
7. Was dropping home/away, rest and the half-to-half sums from the shipped prior deliberate (their weights are 0 today), or a size saving that should be revisited if those weights are ever turned on?
8. `lg.date` format and time zone: the back-to-back test in `sitAgg` compares the first 10 characters of the date strings; if dates are UTC timestamps, late games could be filed on the next day.
9. In production the phone fetches at most 8 logs per team in a 21-day window. Should a backtest pass exactly that window (to match the live app) or more history (which changes `teamStar`, `sitProfile` and everything else that reads `logs`)?
