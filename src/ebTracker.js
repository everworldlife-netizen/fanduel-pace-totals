/**
 * Collector + grader. Runs on a schedule (Netlify scheduled function) so every
 * FanDuel eBasketball game is tracked even when the app is closed:
 *   1. snapshot score + FanDuel lines, capture the closing pregame lines (game / 1H / Q1)
 *   2. record the model's calls at 0 / 25 / 50 / 75 % of the game
 *   3. grade every call against the official H2H final (and 1H from quarter splits)
 *   4. keep the rolling H2H finals + quarter splits fresh and rebuild ratings hourly
 *
 * The collector is the only writer of track/* keys (Blobs is last-write-wins).
 */

const store = require('./store');
const fdEb = require('./feeds/fanduelEb');
const h2h = require('./feeds/h2h');
const { evaluateLive, americanToDecimal } = require('./model/ebModel');
const { normPlayer } = require('./model/ebRatings');
const ctxMod = require('./ebContext');

const MIN = 60000;
const SCHEDULE_EVERY = 8 * MIN;
const REBUILD_EVERY = 60 * MIN;
const TIMELINES_PER_RUN = 3;
const GRADE_GIVE_UP = 8 * 60 * MIN;
const CHECKPOINTS = [0, 25, 50, 75];

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function compactLine(m) {
  return m ? { line: m.line, over: m.over, under: m.under, open: m.open } : null;
}

function newTrace(g, now) {
  return {
    eventId: g.eventId,
    name: g.name,
    away: { team: g.away.team, player: g.away.player },
    home: { team: g.home.team, player: g.home.player },
    scheduledMs: g.scheduledMs,
    tipMs: g.tipMs,
    firstSeen: now,
    pre: null,
    close: null,
    pregame: null,
    snaps: [],
    checkpoints: {},
    signals: [],
    lastSeen: now,
  };
}

function signalFrom(m, ev, ctxNote) {
  return {
    market: m.id,
    label: m.label,
    side: m.call,
    line: m.line,
    odds: m.call === 'Over' ? m.overOdds : m.underOdds,
    mean: m.mean,
    gap: m.gap,
    ev: m.ev,
    f: ev.progress.f,
    at: Date.now(),
    note: ctxNote || null,
  };
}

async function trackBoard(now, ctx, report) {
  const board = await fdEb.listBoard();
  report.board = board.length;
  const state = (await store.getJSON('track/state')) || { active: {}, ended: {}, lastSchedAt: 0, lastBuildAt: 0 };
  state.active = state.active || {};
  state.ended = state.ended || {};
  const seen = new Set();
  for (const g of board) {
    seen.add(g.eventId);
    const key = `track/ev/${g.eventId}`;
    const tr = (await store.getJSON(key)) || newTrace(g, now);
    tr.lastSeen = now;
    tr.tipMs = g.tipMs || tr.tipMs;
    let lines = g.lines;
    if (g.status === 'pre') {
      // Closing pregame lines incl. 1H / Q1 from the event page.
      try {
        const full = await fdEb.eventLines(g.eventId);
        lines = { ...full.lines, game: full.lines.game || g.lines.game };
        g.lines = lines;
      } catch (err) {
        report.errors.push(`event ${g.eventId}: ${err.message}`);
      }
      tr.pre = {
        at: now,
        game: compactLine(lines.game),
        half1: compactLine(lines.half1),
        q1: compactLine(lines.quarters?.[1]),
        awayTotal: compactLine(lines.awayTotal),
        homeTotal: compactLine(lines.homeTotal),
      };
    } else if (!tr.close) {
      tr.close = tr.pre || { at: now, game: compactLine(lines.game), late: true };
    }
    const opening = tr.close?.game?.line ?? tr.pre?.game?.line ?? null;
    const ev = evaluateLive(g, { ...ctx, openingTotal: g.total === 0 ? null : opening }, { now });
    if (!tr.pregame) {
      const h1 = ev.markets.find((m) => m.id === 'half1');
      tr.pregame = { model: ev.pregame.model, expected: ev.pregame.expected, last10Half: h1?.last10 || null, half1Mean: h1?.mean ?? null };
    }
    const snap = [now, g.away.score, g.home.score, lines.game?.line ?? null, lines.game?.over ?? null, lines.game?.under ?? null, lines.game?.open ? 1 : 0, ev.progress.f];
    const last = tr.snaps[tr.snaps.length - 1];
    if (!last || last[1] !== snap[1] || last[2] !== snap[2] || last[3] !== snap[3]) tr.snaps.push(snap);
    if (tr.snaps.length > 60) tr.snaps = tr.snaps.slice(-60);

    const pct = Math.round(ev.progress.f * 100);
    const bucket = g.status === 'pre' ? 0 : [...CHECKPOINTS].reverse().find((c) => pct >= c && c > 0);
    if (bucket != null && !tr.checkpoints[bucket] && (g.status === 'pre' || bucket > 0)) {
      tr.checkpoints[bucket] = {
        at: now,
        f: ev.progress.f,
        score: [g.away.score, g.home.score],
        markets: ev.markets
          .filter((m) => m.line != null && m.mean != null)
          .map((m) => ({ id: m.id, line: m.line, mean: m.mean, gap: m.gap, call: m.call, ev: m.ev, over: m.overOdds, under: m.underOdds })),
      };
    }
    for (const m of ev.markets) {
      if (!m.call || m.call === 'Pass' || m.id.startsWith('q')) continue;
      const already = tr.signals.find((s) => s.market === m.id && Math.abs(s.f - ev.progress.f) < 0.2);
      if (!already && tr.signals.filter((s) => s.market === m.id).length < 3) {
        tr.signals.push(signalFrom(m, ev, g.status === 'pre' ? 'pregame' : `live ${pct}%`));
      }
    }
    await store.setJSON(key, tr);
    state.active[g.eventId] = { scheduledMs: tr.scheduledMs, players: [tr.away.player, tr.home.player], lastSeen: now };
    report.written += 1;
  }
  for (const [id, info] of Object.entries(state.active)) {
    if (!seen.has(id) && now - (info.lastSeen || 0) > 90 * 1000) {
      state.ended[id] = { ...info, endedAt: now };
      delete state.active[id];
      report.ended += 1;
    }
  }
  return state;
}

function matchFinal(tr, finals) {
  const want = [normPlayer(tr.away.player), normPlayer(tr.home.player)].sort().join('|');
  let best = null;
  for (const r of finals) {
    const g = ctxMod.rowToGame(r);
    const key = [normPlayer(g.a), normPlayer(g.b)].sort().join('|');
    if (key !== want) continue;
    const dt = Math.abs((g.t || 0) - (tr.scheduledMs || 0));
    if (dt > 6 * MIN) continue;
    if (!best || dt < best.dt) best = { g, dt };
  }
  if (!best) return null;
  const g = best.g;
  const awayIsA = normPlayer(g.a) === normPlayer(tr.away.player);
  return { id: g.id, away: awayIsA ? g.sa : g.sb, home: awayIsA ? g.sb : g.sa, awayIsA };
}

function gradeSide(side, line, actual) {
  if (actual == null || line == null) return null;
  if (actual === line) return 'P';
  const over = actual > line;
  return (side === 'Over') === over ? 'W' : 'L';
}

function profit(result, odds) {
  if (result === 'W') return Math.round(((americanToDecimal(odds) || 1.909) - 1) * 1000) / 1000;
  if (result === 'L') return -1;
  return 0;
}

function gradeTrace(tr, fin, quarters) {
  const total = fin.away + fin.home;
  const q = quarters?.[fin.id];
  let half1 = null;
  if (Array.isArray(q) && q.length === 8) half1 = q[0] + q[1] + q[2] + q[3];
  const actualFor = (market) => {
    if (market === 'game') return total;
    if (market === 'half1') return half1;
    if (market === 'awayTotal') return fin.away;
    if (market === 'homeTotal') return fin.home;
    return null;
  };
  const signals = tr.signals.map((s) => {
    const result = gradeSide(s.side, s.line, actualFor(s.market));
    return { ...s, actual: actualFor(s.market), result, units: result ? profit(result, s.odds) : null };
  });
  const checkpoints = {};
  for (const [k, cp] of Object.entries(tr.checkpoints || {})) {
    const gm = (cp.markets || []).find((m) => m.id === 'game');
    const h1 = (cp.markets || []).find((m) => m.id === 'half1');
    checkpoints[k] = {
      f: cp.f,
      game: gm ? { line: gm.line, mean: gm.mean, call: gm.call, errModel: Math.round((gm.mean - total) * 10) / 10, errLine: Math.round((gm.line - total) * 10) / 10 } : null,
      half1: h1 && half1 != null ? { line: h1.line, mean: h1.mean, call: h1.call, errModel: Math.round((h1.mean - half1) * 10) / 10, errLine: Math.round((h1.line - half1) * 10) / 10 } : null,
    };
  }
  return {
    eventId: tr.eventId,
    h2hId: fin.id,
    name: tr.name,
    away: tr.away,
    home: tr.home,
    scheduledMs: tr.scheduledMs,
    final: { away: fin.away, home: fin.home, total, half1 },
    close: tr.close,
    pregame: tr.pregame,
    checkpoints,
    signals,
    gradedAt: Date.now(),
  };
}

async function refreshHistory(now, state, report) {
  if (now - (state.lastSchedAt || 0) < SCHEDULE_EVERY) return null;
  state.lastSchedAt = now;
  const days = [dayKey(now)];
  if (new Date(now).getUTCHours() < 2) days.push(dayKey(now - 86400000));
  let rows = [];
  for (const d of days) {
    try {
      rows = rows.concat(await h2h.schedule(d));
    } catch (err) {
      report.errors.push(`h2h schedule ${d}: ${err.message}`);
    }
  }
  if (!rows.length) return null;
  const finals = ctxMod.mergeFinals(await ctxMod.loadFinals(), rows, now);
  await store.setJSON('data/finals', finals);
  report.finals = finals.length;
  return finals;
}

async function fetchQuarterSplits(finals, report) {
  const quarters = await ctxMod.loadQuarters();
  const missing = (finals || [])
    .slice()
    .reverse()
    .filter((r) => !quarters[r[0]] && !(quarters._skip || []).includes(r[0]))
    .slice(0, TIMELINES_PER_RUN);
  let changed = false;
  for (const r of missing) {
    try {
      const tl = await h2h.timeline(r[0]);
      const parsed = h2h.parseTimeline(tl, { teamAScore: r[6], teamBScore: r[7] });
      if (parsed) {
        quarters[r[0]] = parsed.q.flat();
        report.timelines += 1;
      } else {
        quarters._skip = [...(quarters._skip || []).slice(-200), r[0]];
      }
      changed = true;
    } catch (err) {
      report.errors.push(`timeline ${r[0]}: ${err.message}`);
      if (err.status === 429) break;
    }
  }
  if (changed) {
    const cutoff = Date.now() - ctxMod.KEEP_DAYS * 86400000;
    const keep = new Set(finals.filter((r) => r[1] >= cutoff).map((r) => r[0]));
    for (const k of Object.keys(quarters)) if (k !== '_skip' && !keep.has(k)) delete quarters[k];
    await store.setJSON('data/quarters', quarters);
  }
  return quarters;
}

async function gradeEnded(now, state, finals, quarters, report) {
  if (!finals) finals = await ctxMod.loadFinals();
  if (!quarters) quarters = await ctxMod.loadQuarters();
  const byDay = new Map();
  for (const [id, info] of Object.entries(state.ended || {})) {
    const tr = await store.getJSON(`track/ev/${id}`);
    if (!tr) {
      delete state.ended[id];
      continue;
    }
    const fin = matchFinal(tr, finals);
    const needsHalf = tr.signals.some((s) => s.market === 'half1') || (tr.checkpoints?.[0]?.markets || []).some((m) => m.id === 'half1');
    const haveHalf = fin && Array.isArray(quarters[fin.id]);
    const waited = now - (info.endedAt || now);
    if (!fin && waited < GRADE_GIVE_UP) continue;
    if (fin && needsHalf && !haveHalf && waited < GRADE_GIVE_UP) continue;
    if (fin) {
      const graded = gradeTrace(tr, fin, quarters);
      const day = dayKey(tr.scheduledMs || now);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(graded);
      report.graded += 1;
    }
    await store.del(`track/ev/${id}`);
    delete state.ended[id];
  }
  for (const [day, list] of byDay) {
    const key = `track/graded/${day}`;
    const existing = (await store.getJSON(key)) || [];
    const ids = new Set(existing.map((g) => g.eventId));
    await store.setJSON(key, existing.concat(list.filter((g) => !ids.has(g.eventId))));
  }
}

/**
 * Least-squares weight on our projection vs FanDuel's line:
 *   final - line = w * (ours - line)  =>  w = sum((F-L)(P-L)) / sum((P-L)^2)
 */
function fitModelWeight(graded) {
  let num = 0;
  let den = 0;
  let n = 0;
  for (const g of graded) {
    const F = g.final?.total;
    if (!Number.isFinite(F)) continue;
    for (const [k, cp] of Object.entries(g.checkpoints || {})) {
      if (k === '0' || !cp.game) continue;
      const P = cp.game.mean;
      const L = cp.game.line;
      if (!Number.isFinite(P) || !Number.isFinite(L)) continue;
      num += (F - L) * (P - L);
      den += (P - L) ** 2;
      n += 1;
    }
  }
  if (n < 60 || den <= 0) return null;
  return { modelWeight: Math.round(Math.min(0.8, Math.max(0.1, num / den)) * 1000) / 1000, n };
}

async function refitParams(now, report) {
  const graded = [];
  for (let i = 0; i < 7; i += 1) {
    const list = await store.getJSON(`track/graded/${dayKey(now - i * 86400000)}`);
    if (Array.isArray(list)) graded.push(...list);
  }
  const fit = fitModelWeight(graded);
  if (fit) {
    await store.setJSON('model/params', { ...fit, at: new Date(now).toISOString() });
    report.modelWeight = fit.modelWeight;
  }
}

async function collect({ now = Date.now() } = {}) {
  const report = { at: new Date(now).toISOString(), board: 0, written: 0, ended: 0, graded: 0, timelines: 0, rebuilt: false, errors: [] };
  const ctx = await ctxMod.getContext({ maxAgeMs: 30 * MIN });
  let state;
  try {
    state = await trackBoard(now, ctx, report);
  } catch (err) {
    report.errors.push(`board: ${err.message}`);
    state = (await store.getJSON('track/state')) || { active: {}, ended: {}, lastSchedAt: 0, lastBuildAt: 0 };
  }
  const finals = await refreshHistory(now, state, report);
  let quarters = null;
  if (finals) quarters = await fetchQuarterSplits(finals, report);
  await gradeEnded(now, state, finals, quarters, report);
  if (now - (state.lastBuildAt || 0) > REBUILD_EVERY) {
    const [f, q] = await Promise.all([ctxMod.loadFinals(), ctxMod.loadQuarters()]);
    if (f.length) {
      const built = ctxMod.buildContext(f, q, now);
      await store.setJSON('model/context', built);
      await refitParams(now, report);
      ctxMod.setMemoryContext(built);
      state.lastBuildAt = now;
      report.rebuilt = true;
    }
  }
  state.lastRun = report;
  await store.setJSON('track/state', state);
  return report;
}

/** Aggregate graded results for the Performance tab. */
async function performance({ days = 7, now = Date.now() } = {}) {
  const graded = [];
  for (let i = 0; i < days; i += 1) {
    const list = await store.getJSON(`track/graded/${dayKey(now - i * 86400000)}`);
    if (Array.isArray(list)) graded.push(...list);
  }
  const markets = {};
  const buckets = {};
  const err = {};
  const recent = [];
  for (const g of graded) {
    for (const s of g.signals || []) {
      if (!s.result) continue;
      const m = markets[s.market] || { market: s.market, n: 0, w: 0, l: 0, p: 0, units: 0 };
      m.n += 1;
      m[s.result.toLowerCase()] += 1;
      m.units += s.units || 0;
      markets[s.market] = m;
      const gap = Math.abs(s.gap || 0);
      const b = gap >= 8 ? '8+' : gap >= 6 ? '6-8' : '4-6';
      const bk = buckets[b] || { bucket: b, n: 0, w: 0, l: 0, p: 0, units: 0 };
      bk.n += 1;
      bk[s.result.toLowerCase()] += 1;
      bk.units += s.units || 0;
      buckets[b] = bk;
      recent.push({ ...s, name: g.name, scheduledMs: g.scheduledMs, final: g.final });
    }
    for (const [k, cp] of Object.entries(g.checkpoints || {})) {
      for (const mk of ['game', 'half1']) {
        const c = cp[mk];
        if (!c) continue;
        const key = `${mk}@${k}`;
        const e = err[key] || { market: mk, checkpoint: Number(k), n: 0, model: 0, line: 0 };
        e.n += 1;
        e.model += Math.abs(c.errModel);
        e.line += Math.abs(c.errLine);
        err[key] = e;
      }
    }
  }
  const fin = (o) => ({ ...o, units: Math.round(o.units * 100) / 100, winPct: o.w + o.l ? Math.round((o.w / (o.w + o.l)) * 1000) / 10 : null, roi: o.n ? Math.round((o.units / o.n) * 1000) / 10 : null });
  recent.sort((a, b) => (b.scheduledMs || 0) - (a.scheduledMs || 0));
  const state = await store.getJSON('track/state');
  return {
    days,
    games: graded.length,
    markets: Object.values(markets).map(fin),
    gapBuckets: Object.values(buckets).map(fin).sort((a, b) => a.bucket.localeCompare(b.bucket)),
    accuracy: Object.values(err)
      .map((e) => ({ market: e.market, checkpoint: e.checkpoint, n: e.n, modelMae: Math.round((e.model / e.n) * 10) / 10, lineMae: Math.round((e.line / e.n) * 10) / 10 }))
      .sort((a, b) => a.market.localeCompare(b.market) || a.checkpoint - b.checkpoint),
    recent: recent.slice(0, 30),
    tracking: state ? { active: Object.keys(state.active || {}).length, awaitingGrade: Object.keys(state.ended || {}).length, lastRun: state.lastRun || null } : null,
  };
}

module.exports = { collect, performance, gradeTrace, matchFinal, gradeSide, profit, newTrace, fitModelWeight };
