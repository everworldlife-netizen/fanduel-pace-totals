# Feed probe

Probed ESPN Site API on 2026-09-20.

| Slug | HTTP | League | Events | Samples |
|---|---|---|---|---|
| `nba` | 200 | National Basketball Association | 1 | MIA @ TOR |
| `wnba` | 200 | Women's National Basketball Association | 3 | PHX @ DAL, CHI @ ATL, SEA @ GS |
| `nbl` | 200 | National Basketball League | 2 | HWK @ NZL, CNS @ SYD |
| `mens-college-basketball` | 200 | NCAA Men's Basketball | 2 | ND VS VILL, HPU VS LIB |
| `womens-college-basketball` | 200 | NCAA Women's Basketball | 1 | ND VS VILL |
| `fiba` | 200 | FIBA World Cup | 2 | ESP VS GER, USA VS FRA |
| `euroleague` | 200 | Euroleague | 0 | — |
| `nba-development` | 200 | NBA G League | 10 | WES @ MNE, LIN @ GBO, CAP @ DEL |
| `acb` | 200 | ACB Copa del Rey | 0 | — |
| `bbl` | 400 | — | 0 | — |
| `lkl` | 400 | — | 0 | — |
| `lnbp` | 400 | — | 0 | — |
| `champions-league` | 400 | — | 0 | — |
| `fiba-champions-league` | 400 | — | 0 | — |
| `eurocup` | 400 | — | 0 | — |
| `mens-olympics-basketball` | 200 | Olympics Men's Basketball | 2 | GER VS SRB, FRA VS USA |

## Interpretation

- **Works for FanDuel boards:** `nba`, `wnba`, `nbl`, `mens-college-basketball`.
- **Euroleague slug exists** but is often empty; use `api-live.euroleague.net` instead.
- **Does not exist on ESPN (HTTP 400):** German BBL, LKL, LNBP, FIBA Champions League. Use API-Basketball with `API_BASKETBALL_KEY`.
- ESPN `fiba` is **World Cup**, not Basketball Champions League.
