# GG Winner — FanDuel live totals

Live: **https://gg-winner.netlify.app** (installable on Android/iPhone).

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

Settings (⚙): minimum edge (default **2 pts**, GG projection vs FanDuel line), minimum EV (default **3%**) and refresh rate.

## The playbook, automated

1. **60-second pre-game check.** Each gamer’s last-10 first-half points, averaged, against FanDuel’s 1H line. The model’s own 1H number is shown next to it, and the Lab says when the two agree.
2. **Head-to-head.** Pairs with 3+ recent meetings get a small, shrunk adjustment.
3. **Quarter profiles.** Each gamer’s points by quarter (strongest quarter highlighted). Quarter totals are priced from the pair’s quarter shape.
4. **Let volume work.** Only games clearing the gap + value filter make Focus Now.

## Model (recalibrated Nov 5, 2026)

Data: 5,246 official H2H GG League finals (3 weeks) plus play-by-play quarter splits, live FanDuel snapshots replayed against official finals, and the app's own graded record.

- **Pregame number.** Recency-weighted ridge ratings: each gamer's offense and defense plus the NBA 2K team effect. Out-of-sample RMSE on 1,025 held-out games is **12.2** vs **15.2** for the league average. On the live replay it beat FanDuel's opening line (average miss 8.4 vs 9.5).
- **Live update.** `rate = (n0·pregame + points) / (n0 + share played)` with **n0 = 6 games**. FanDuel's live line overreacts to hot or cold starts; the gamers' scoring level holds up better. The stronger prior beat the old pace-heavy setting (n0 = 1.5) at every stage of the game.
- **GG projection (the number shown).** Our model blended with FanDuel's line, trusting each by how accurate it has been at that stage: pregame 85% ours, Q1 45%, mid-game 60%, Q4 35%, final minutes 90%. The blend beats both inputs (replay RMSE 10.0 vs 10.5 ours / 10.6 FanDuel). The collector refits these weights from graded games.
- **Game clock.** FanDuel posts no clock for eBasketball, so progress comes from:
  - the real tip time (`marketTime`), mapped with a curve aligned to the official play-by-play clock (25% played at about 6.3 min after tip, 50% at 12.5, 75% at 19.5, final at about 25.5–26);
  - FanDuel's quarter-market state (which of spread / total / winner is open);
  - the score, when the tip time isn't posted yet.
- **Calls.** Edge = GG projection − FanDuel line. A call needs an edge of **2+ points** (adjustable), the market open, and positive EV. It never fires after ~85% played, in overtime, or when the raw model disagrees with FanDuel by 10+ points (that usually means the ratings are off for the pair). On the replay, these rules went 57–18 (76%), up from 47–23 (67%). On a fresh out-of-sample check (19 new games, Nov 5 08:00–10:00 UTC) they went 33–25 (57%, +2.6 units): strongest pregame (7–2) and after halftime (14–7), weakest in Q1 (5–9), where FanDuel's line was the better guide.
- **Grading.** Finals come from official H2H results. A FanDuel score only counts once it stops changing late in the game, and any FanDuel-sourced final is replaced by the official one.

Quarter shares: Q1 25.5%, Q2 24.7%, Q3 24.3%, Q4 24.9%.

## Data sources

- **FanDuel public sportsbook JSON** (server-side): in-play board, event page markets (1H, quarters, team totals), IPS live scores.
- **H2H GG League public stats** (`api-h2h.cdn-hudstats.com`): schedule, finals and play-by-play. Used for history and grading only. Their live feed is CDN-delayed, so it’s never used as a clock.
- Real leagues: ESPN, EuroLeague API, FanDuel live scoreboard, optional API-Basketball.

## Netlify

- `netlify/functions/api.mjs` serves `/api/*`.
- `netlify/functions/collector.mjs` runs **every 5 minutes**. It tracks every FanDuel eBasketball game, captures closing pregame lines, records calls at 0/25/50/75%, grades game and team totals from the final score (official H2H, or FanDuel’s own final if H2H is slow), back-fills 1st-half grades once the official quarter split lands, fetches quarter splits, rebuilds ratings hourly and re-fits the model weight.
- State lives in **Netlify Blobs** (store `courtside-eb`, named before the rename and kept so tracked data carries over).
- `data/seed-*.json` is bundled history, so a fresh deploy has ratings and profiles right away. Refresh it with `npm run seed`.
- Env vars (optional): `COLLECTOR_ENABLED=0` pauses the collector. `FANDUEL_REGION` (default `NJ`) picks the FanDuel state host. `API_BASKETBALL_KEY` adds box stats for BBL/LKL/BCL/LNBP.

## Cloudflare (alternative host)

Same app on Cloudflare Workers with static assets (Cloudflare's recommended successor to Pages for apps with an API and cron):

- `cloudflare/worker.mjs` serves `/api/*` through the shared router and everything else from `./public`.
- State lives in **Workers KV** (`GG_STORE`) through `src/docStore.js`, which packs all keys into a few JSON documents, so a collector pass costs ~1 KV write (about 300–600 writes/day, inside the free 1,000/day).
- The collector runs on a **cron trigger every 5 minutes**.
- Deploy: set `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers") and `CLOUDFLARE_ACCOUNT_ID`, then `npm run cf:deploy`. It creates the KV namespace on first run, deploys to `gg-winner.<your-subdomain>.workers.dev`, and prints an admin key for `/api/admin/collect?key=…`.
- Plan: a board refresh uses ~25 ms CPU and the hourly ratings rebuild ~450 ms, so the **Workers Paid** plan ($5/month, 30 s CPU) is the reliable choice. The free plan caps CPU at 10 ms per request.
- Local run in Cloudflare's runtime: `npm run cf:dev` → http://localhost:8787

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
