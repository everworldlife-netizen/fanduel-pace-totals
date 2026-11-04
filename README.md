# CourtSide Pace — FanDuel live totals

Live projections for **FanDuel eBasketball (H2H GG League, 4×5-minute quarters)**: game, 1st-half, quarter and team totals, priced against FanDuel’s live lines. There’s also a **Real leagues** tab (NBA, WNBA, NBL, EuroLeague, BBL, LKL and more) using the possession/pace model. Installable on your phone as an app (PWA), deployed on Netlify.

It doesn’t place bets. Projections are analytical estimates, not guarantees.

## What it does

| Tab | What you get |
|---|---|
| **Board** | **Focus Now:** the 2–3 games where our number and FanDuel’s line are furthest apart and the price still leaves value. Also every in-play eBasketball game (score, estimated quarter, FD total, our projection, gap, call) and a pre-game check of the next 75 minutes (our game and 1H numbers, last-10 1H method, head-to-head). |
| **Game** | Every market FanDuel has up (game, 1st half, current quarter, team totals), each showing FanDuel line and juice, our number, gap, model probability, FanDuel no-vig probability, EV and an **Over / Under / Pass** call. Plus why the number is what it is, head-to-head history, and both gamers’ profiles (scores/allows, last-10 1H, points by quarter, last games). |
| **Lab** | Matchup calculator: pick two gamers, type the line(s), see the gap. Also a sortable gamer table. |
| **Results** | Automatic track record. Every game is graded against the official final: W-L-P, units, ROI by market and by gap size, and our average miss vs FanDuel’s line at pregame, 25%, 50% and 75%. |
| **Leagues** | The original real-basketball pace model. FanDuel’s live game total fills in automatically when it’s on the board. |

Settings (⚙): minimum gap (default **4 pts**), minimum EV (default **3%**) and refresh rate.

## The playbook, automated

1. **60-second pre-game check.** Each gamer’s last-10 first-half points, averaged, against FanDuel’s 1H line. The model’s own 1H number is shown next to it, and the Lab says when the two agree.
2. **Head-to-head.** Pairs with 3+ recent meetings get a small, shrunk adjustment.
3. **Quarter profiles.** Each gamer’s points by quarter (strongest quarter highlighted). Quarter totals are priced from the pair’s quarter shape.
4. **Let volume work.** Only games clearing the gap + value filter make Focus Now.

## Model (calibrated Nov 2026)

Data: 5,246 official H2H GG League finals (3 weeks) plus play-by-play quarter splits, and live FanDuel samples (score + lines every 12 s).

- **Pregame number.** Recency-weighted ridge ratings: each gamer’s offense and defense plus the NBA 2K team effect. Out-of-sample RMSE on 1,025 held-out games is **12.2** vs **15.2** for the league average. If FanDuel’s opening line was captured, it’s blended in.
- **Live update.** Bayesian rate: `rate = (n0·pregame + points) / (n0 + share played)` with **n0 = 1.5 games**. Live pace is weak information in this league: pure pace misses by 17 pts at 25% played, the blend by 10.5.
- **Game clock.** FanDuel posts no clock for eBasketball, so progress comes from:
  - the real tip time (`marketTime`), using calibrated quarter starts at 7.9 / 14.4 / 21.0 min after tip and a regulation end at about 26.8 min;
  - clamped to whichever quarter FanDuel has markets open for;
  - blended with the score when the tip time isn’t posted yet.
- **Pricing.** P(over) and EV blend our number with FanDuel’s line (default 35% ours / 65% FanDuel, since the book sees the real clock). The collector re-fits that weight from graded games, and the gap shown is the raw difference.
- **Pass rules.** A call needs the gap ≥ your minimum, the market open, positive EV, not the last ~8% of the game, and no overtime.

Quarter shares: Q1 25.5%, Q2 24.7%, Q3 24.3%, Q4 24.9%.

## Data sources

- **FanDuel public sportsbook JSON** (server-side): in-play board, event page markets (1H, quarters, team totals), IPS live scores.
- **H2H GG League public stats** (`api-h2h.cdn-hudstats.com`): schedule, finals and play-by-play. Used for history and grading only. Their live feed is CDN-delayed, so it’s never used as a clock.
- Real leagues: ESPN, EuroLeague API, FanDuel live scoreboard, optional API-Basketball.

## Netlify

- `netlify/functions/api.mjs` serves `/api/*`.
- `netlify/functions/collector.mjs` runs **every 2 minutes**. It tracks every FanDuel eBasketball game, captures closing pregame lines, records calls at 0/25/50/75%, grades them against official finals, fetches quarter splits, rebuilds ratings hourly and re-fits the model weight.
- State lives in **Netlify Blobs** (store `courtside-eb`).
- `data/seed-*.json` is bundled history, so a fresh deploy has ratings and profiles right away. Refresh it with `npm run seed`.
- Env vars (optional): `COLLECTOR_ENABLED=0` pauses the collector. `FANDUEL_REGION` (default `NJ`) picks the FanDuel state host. `API_BASKETBALL_KEY` adds box stats for BBL/LKL/BCL/LNBP.

## Install on your phone

Open the site.
- **Android (Chrome):** tap the ⇩ install button or *Add to Home screen*.
- **iPhone (Safari):** Share → *Add to Home Screen*.

It launches full-screen like a native app, and live numbers always come fresh from the network.

## Run locally

```bash
npm install
npm test          # 61 tests
npm run dev       # http://localhost:3000 (Express; memory store, or STORE_DIR=.store to persist)
npm run collect   # one collector pass locally
```

Docker (`docker compose up -d --build`) still works for a VPS.

## API

- `GET /api/eb/board?edge=4&ev=0.03` — live board, upcoming, Focus Now picks
- `GET /api/eb/game/:eventId?qs=3:67` — full markets (`qs` = quarter start score tracked by the app)
- `GET /api/eb/matchup?a=GENERAL&b=SILVER&line=105.5&half1=52.5`
- `GET /api/eb/players` · `GET /api/eb/performance?days=7`
- Real leagues: `GET /api/games`, `GET /api/games/:id`, `POST /api/evaluate`, `GET /api/leagues`, `GET /api/health`
