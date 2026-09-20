# Pace Totals — FanDuel companion

Live basketball **game / quarter / half / team totals** from pace and shot volume. Paste FanDuel **lines** yourself — the app never scrapes or invents odds. Live **scores, period, and clock** for boards FanDuel is showing in-play come from FanDuel’s public sportsbook JSON. It does not place bets. Not gambling advice.

Target boards FanDuel carries internationally: **NBA, WNBA, Australian NBL, EuroLeague, German BBL, Lithuania LKL, FIBA Champions League, Mexico LNBP**. eBasketball / virtual / sim games are dropped.

## Run

```bash
cd fanduel-pace-totals
npm install
npm test
npm run build    # syntax check + unit tests (also used as the Docker build step)
npm run dev
```

Open http://localhost:3000

- `npm start` — production process (`node server.js`, listens on `0.0.0.0:${PORT:-3000}`)
- `npm run build` — `node --check` on `server.js` + `src/routes.js`, then `npm test`
- `npm run probe` — re-hit ESPN slugs and refresh `docs/feeds.md`

From the Projections repo root you can also `npm run dev:totals` / `npm run test:totals` (existing `npm run dev` is still the NBA player-projection dashboard).

## Docker (Hostinger VPS)

Ubuntu 24.04 + Docker. From this folder on the VM (alongside your other compose projects):

```bash
cd fanduel-pace-totals
docker compose up -d --build
```

Then open `http://<VPS-IP>:3000`. Optional BBL/LKL/BCL/LNBP:

```bash
export API_BASKETBALL_KEY=your_key
docker compose up -d --build
```

Or put the key in a `.env` next to `docker-compose.yml` (`API_BASKETBALL_KEY=...`). Do not commit `.env`.

Image: multi-stage Node 22 Alpine. Builder runs `npm ci` + `npm run build`. Runtime runs `node server.js` as user `node` on port 3000, `restart: unless-stopped`. Traefik labels are commented in `docker-compose.yml` — uncomment and set `Host(...)` when you put it behind the existing proxy.

Stop: `docker compose down`

## How to use

1. Pick a game from the left rail (Live / league chips).
2. Confirm score, clock, period, and the pace strip (possessions, pace per 40 or 48, PPP, projected fair total).
3. **Paste** the FanDuel game total (required). Optionally paste current-period, 1st-half, or team totals.
4. Evaluate. You get **Over / Under / Pass**, fair number vs **your** line, edge in points, confidence, a short why, and risks.

Pass when `|edge| < 1.5`, confidence is LOW, the game is eBasketball, garbage time, or OT.

Lines stick per game in `localStorage`. They are not fetched.

## Model

- Possessions (when the box exists): `FGA + 0.44×FTA − ORB + TO`. Game possessions = average of both teams.
- Live pace = possessions × regulation minutes / minutes elapsed.
- PPP = points / combined possessions. First 8 minutes shrink toward league-average PPP.
- Fair game total = current score + remaining combined possessions × blended PPP.
- No box → score+clock only, **LOW** confidence.
- Confidence: HIGH after ~24 NBA minutes (or ~20 on 40-minute leagues) with a stable box; MED in the middle; LOW early / missing stats / heaves.

Regulation: NBA 48 (4×12). WNBA, NBL, Euro, BBL, LKL, BCL, LNBP: 40 (4×10). NCAA men: 40 (2×20).

## Which free feed covers which league

Probed 2026-09-20 against ESPN Site API `https://site.api.espn.com/apis/site/v2/sports/basketball/{slug}/scoreboard`:

| League | FanDuel target | Feed | Notes |
|---|---|---|---|
| NBA | yes | ESPN `nba` | Box + live clock |
| WNBA | yes | ESPN `wnba` | Box + live clock |
| Australian NBL | yes | ESPN `nbl` | Box uses hyphenated FG `29-72` — parser handles it |
| NCAA men | yes | ESPN `mens-college-basketball` | Halves. Set `SKIP_NCAAB=1` to hide |
| EuroLeague | yes | **api-live.euroleague.net** (free, no key) | ESPN `euroleague` slug exists but is often empty |
| EuroCup | extra | same EuroLeague API (`U`) | |
| German BBL | yes | **FanDuel live scoreboard** (no key) + optional API-Basketball box | ESPN has **no** `bbl` slug (HTTP 400) |
| Lithuania LKL | yes | **FanDuel live scoreboard** (no key) + optional API-Basketball box | ESPN has **no** `lkl` slug |
| FIBA Champions League | yes | **FanDuel live scoreboard** when listed in-play + optional API-Basketball | ESPN `fiba` is World Cup, not BCL |
| Mexico LNBP | yes | **FanDuel live scoreboard** when listed in-play + optional API-Basketball | ESPN has **no** `lnbp` slug |
| Other live FanDuel basketball | extra | **FanDuel live scoreboard** | Real in-play hoops FanDuel is showing (Nordic, etc.). eBasketball / GG League / H2H GG / ACE / JUDGEMENT sims are dropped |
| FIBA World Cup | extra | ESPN `fiba` | Off-cycle most of the year |
| G League / summer / Olympics | extra | ESPN | Off by default in the rail |

### FanDuel live scoreboard (scores / clock only)

When `API_BASKETBALL_KEY` is unset, live German BBL / LKL (and any other real basketball FanDuel has in-play) still appear. The feed is `src/feeds/fanduelLive.js`:

1. Discover live basketball events from FanDuel’s public in-play JSON (`https://sportsbook.fanduel.com/live?tab=basketball` → `sbapi.{state}.sportsbook.fanduel.com/api/in-play`).
2. Attach score, period, and remaining clock from `api.sportsbook.fanduel.com/ips/inplayservice/v1.0/livedata`.
3. Merge into `/api/games` **ahead of ESPN/Euro rows** for the same matchup so the UI matches FanDuel’s live board.

This feed **does not** read totals, spreads, or moneylines. Pace for these games is score+clock (LOW confidence) until you set `API_BASKETBALL_KEY` for a box. `/api/health` reports `fanduelLive: true`.

See `docs/feeds.md` after `npm run probe`.

## Optional env

Copy `.env.example` to `.env`:

| Variable | Required | What it does |
|---|---|---|
| `PORT` | no | Default `3000` |
| `API_BASKETBALL_KEY` | for BBL / LKL / BCL / LNBP **box stats** | [API-Sports](https://dashboard.api-sports.io/) Basketball product. Live scores for those leagues still come from the FanDuel in-play board without a key. Free tier ~100 calls/day. Scoreboard cached **5 minutes**. Stats fetched only when you open a game. |
| `ODDS_API_KEY` | unused in v1 | Reserved; FanDuel totals stay paste-only |
| `SKIP_NCAAB` | no | `1` to skip college boards |

API-Basketball league ids are resolved via `GET /leagues` (name + country) and fall back to documented ids (BBL `40`, LKL `110`, BCL `117`, LNBP `83`). If a fallback is wrong, rename in `src/leagues.js` or let `/leagues` match.

## API

- `GET /api/games` — merged scoreboard (virtuals stripped)
- `GET /api/games/:id` — live box + pace snapshot
- `POST /api/evaluate` — `{ gameId, lines: { gameTotal, quarterTotal, halfTotal, awayTotal, homeTotal } }`
- `GET /api/leagues` — coverage JSON
- `GET /api/health`

Game ids look like `espn:nba:401809123`, `euro:euroleague:E2026:12`, `apib:bbl:99`, `fd:bbl:36086255`.

## Tests

`npm test` covers possessions, clock (NBA / FIBA / NCAAM / OT), fair total, edge, Pass rules, shrinkage, virtual filter (including GG / ACE / JUDGEMENT sims), the NBL hyphenated box parser, and the FanDuel live mapper (scores/clock only — no odds).
