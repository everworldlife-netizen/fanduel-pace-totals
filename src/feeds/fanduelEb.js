/**
 * FanDuel eBasketball (H2H GG League 4x5 Mins) live board.
 *
 * FanDuel names these "Boston Celtics (GENERAL) @ Oklahoma City Thunder (SILVER)":
 * the team in front of "@" is the AWAY side, names in parentheses are the gamers.
 * IPS livedata gives the live score but no clock / period for eBasketball, so the
 * tip time comes from the market's in-play `marketTime` and the current quarter
 * from which quarter markets FanDuel has open on the event page.
 */

const fd = require('./fdClient');

const BASKETBALL = 7522;
const EB_RE = /e-?basketball|h2h\s*gg/i;

const odds = (r) => {
  const v = r?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt;
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

function parseSide(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return { team: m[1].trim(), player: m[2].trim().toUpperCase() };
  return { team: s, player: s.toUpperCase() };
}

function parseEventName(name) {
  const s = String(name || '');
  let parts = s.split(/\s+@\s+/);
  if (parts.length === 2) {
    return { away: parseSide(parts[0]), home: parseSide(parts[1]) };
  }
  parts = s.split(/\s+v(?:s\.?)?\s+/i);
  if (parts.length === 2) {
    return { home: parseSide(parts[0]), away: parseSide(parts[1]) };
  }
  return { away: parseSide(s), home: parseSide('') };
}

function runnerBy(m, type) {
  return (m?.runners || []).find((r) => String(r.result?.type || '').toUpperCase() === type);
}

function ouMarket(m) {
  if (!m) return null;
  const over = runnerBy(m, 'OVER') || (m.runners || []).find((r) => /^over/i.test(r.runnerName || ''));
  const under = runnerBy(m, 'UNDER') || (m.runners || []).find((r) => /^under/i.test(r.runnerName || ''));
  const line = Number(over?.handicap ?? under?.handicap);
  if (!Number.isFinite(line) || line <= 0) return null;
  return {
    line,
    over: odds(over),
    under: odds(under),
    status: m.marketStatus || null,
    open: String(m.marketStatus || '').toUpperCase() === 'OPEN',
    marketId: m.marketId,
  };
}

function sideMarket(m) {
  if (!m) return null;
  const home = runnerBy(m, 'HOME');
  const away = runnerBy(m, 'AWAY');
  if (!home && !away) return null;
  return {
    home: home ? { line: Number(home.handicap) || 0, odds: odds(home) } : null,
    away: away ? { line: Number(away.handicap) || 0, odds: odds(away) } : null,
    status: m.marketStatus || null,
    open: String(m.marketStatus || '').toUpperCase() === 'OPEN',
  };
}

const QUARTER_WORD = { 1: '1ST', 2: '2ND', 3: '3RD', 4: '4TH' };

/** Pull every totals-style market we care about out of a list of FanDuel markets. */
function linesFromMarkets(markets) {
  const by = new Map();
  for (const m of markets || []) {
    const t = String(m.marketType || '').toUpperCase();
    if (!by.has(t)) by.set(t, m);
  }
  const quarters = {};
  let currentQuarter = 0;
  let quarterState = null;
  const st = (m) => (!m ? null : String(m.marketStatus || '').toUpperCase() === 'OPEN' ? 'open' : 'susp');
  for (let q = 1; q <= 4; q += 1) {
    const w = QUARTER_WORD[q];
    const tot = ouMarket(by.get(`${w}_QUARTER_TOTAL_POINTS`));
    const present = [`${w}_QUARTER_TOTAL_POINTS`, `${w}_QUARTER_HANDICAP`, `${w}_QUARTER_WINNER`].some((k) => by.has(k));
    if (tot) quarters[q] = tot;
    if (present) {
      currentQuarter = Math.max(currentQuarter, q);
      // Which of spread / total / winner are listed and open tells where in the quarter we are.
      quarterState = {
        q,
        h: st(by.get(`${w}_QUARTER_HANDICAP`)),
        t: st(by.get(`${w}_QUARTER_TOTAL_POINTS`)),
        w: st(by.get(`${w}_QUARTER_WINNER`)),
      };
    }
  }
  const half1 = ouMarket(by.get('1ST_HALF_TOTAL_POINTS'));
  const half2 = ouMarket(by.get('2ND_HALF_TOTAL_POINTS'));
  return {
    game: ouMarket(by.get('TOTAL_POINTS_(OVER/UNDER)')),
    half1,
    half2,
    quarters,
    homeTotal: ouMarket(by.get('HOME_TEAM_TOTAL_(INCL_OVERTIME)') || by.get('HOME_TEAM_TOTAL_POINTS')),
    awayTotal: ouMarket(by.get('AWAY_TEAM_TOTAL_(INCL_OVERTIME)') || by.get('AWAY_TEAM_TOTAL_POINTS')),
    spread: sideMarket(by.get('MATCH_HANDICAP_(2-WAY)')),
    moneyline: sideMarket(by.get('MONEY_LINE')),
    // Quarter markets only exist for the quarter in play (plus Q1 pre-tip).
    quarterHint: currentQuarter || null,
    quarterState,
    hasHalfMarket: Boolean(by.get('1ST_HALF_TOTAL_POINTS') || by.get('1ST_HALF_HANDICAP')),
  };
}

function tipTime(event, markets) {
  // `marketTime` moves from the scheduled slot to the real in-play time at tip.
  const times = (markets || [])
    .map((m) => Date.parse(m.marketTime))
    .filter(Number.isFinite);
  const open = Date.parse(event.openDate);
  const best = times.length ? Math.max(...times) : open;
  return { scheduledMs: Number.isFinite(open) ? open : null, tipMs: Number.isFinite(best) ? best : open };
}

function mapBoard(inPlayJson, liveRows, now = Date.now()) {
  const atts = inPlayJson?.attachments || {};
  const comps = atts.competitions || {};
  const allMarkets = Object.values(atts.markets || {});
  const live = new Map((liveRows || []).map((r) => [Number(r.eventId), r]));
  const out = [];
  for (const e of Object.values(atts.events || {})) {
    if (Number(e.eventTypeId) !== BASKETBALL) continue;
    const compName = comps[e.competitionId]?.name || comps[String(e.competitionId)]?.name || '';
    if (!EB_RE.test(compName) && !EB_RE.test(e.name)) continue;
    const markets = allMarkets.filter((m) => Number(m.eventId) === Number(e.eventId));
    const sides = parseEventName(e.name);
    const d = live.get(Number(e.eventId))?.basketballDetails || {};
    const homeScore = Number(d.home?.score) || 0;
    const awayScore = Number(d.away?.score) || 0;
    const { scheduledMs, tipMs } = tipTime(e, markets);
    const started = homeScore + awayScore > 0 || (tipMs && tipMs > scheduledMs && now >= tipMs);
    out.push({
      id: `eb:${e.eventId}`,
      eventId: String(e.eventId),
      competition: compName,
      name: e.name,
      away: { ...sides.away, score: awayScore },
      home: { ...sides.home, score: homeScore },
      total: homeScore + awayScore,
      scheduledMs,
      tipMs,
      status: started ? 'live' : 'pre',
      videoAvailable: Boolean(e.videoAvailable),
      lines: linesFromMarkets(markets),
    });
  }
  out.sort((a, b) => (a.scheduledMs || 0) - (b.scheduledMs || 0));
  return out;
}

async function listBoard() {
  const ip = await fd.inPlay();
  const atts = ip?.attachments || {};
  const comps = atts.competitions || {};
  const ids = Object.values(atts.events || {})
    .filter((e) => Number(e.eventTypeId) === BASKETBALL)
    .filter((e) => EB_RE.test(comps[e.competitionId]?.name || '') || EB_RE.test(e.name))
    .map((e) => e.eventId);
  const rows = ids.length ? await fd.liveData(ids) : [];
  return mapBoard(ip, rows);
}

/** Full market list for one event (1H, quarter, team totals). */
async function eventLines(eventId) {
  const ep = await fd.eventPage(eventId);
  const markets = Object.values(ep?.attachments?.markets || {});
  const ev = Object.values(ep?.attachments?.events || {})[0] || null;
  return { lines: linesFromMarkets(markets), event: ev, marketTimes: markets.map((m) => m.marketTime).filter(Boolean) };
}

module.exports = {
  listBoard,
  eventLines,
  mapBoard,
  linesFromMarkets,
  parseEventName,
  parseSide,
  ouMarket,
  EB_RE,
};
