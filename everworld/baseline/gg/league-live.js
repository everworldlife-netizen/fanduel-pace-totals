/* GG Winner: live projections for every real basketball league on FanDuel's live board
 * (NBA, EuroLeague, Sweden, Croatia, Spain women, Bahrain and anything else FanDuel lists).
 *
 * Works from the /api/games row alone (score, quarter scores, period, clock, FanDuel game
 * total), so it runs in the phone's browser and needs no server change. It gives the full
 * game, both halves and every quarter, and a PLUS EDGE / NO PLAY call in plain words for
 * every line it has (FanDuel's game total automatically, half and quarter lines when the
 * server sends them or you type them).
 *
 * Model: scoring rate per minute = blend of the live rate so far and the rate FanDuel's
 * line implied when we first saw the game.
 *
 * Nov 9 update, learned from 469 NBA games replayed minute by minute and checked on 146 newer ones:
 *  - The live pace says much less about the rest of the game than it looks. It earns about 3% of the
 *    weight after 6 minutes, 10% through the first half, 28% after three quarters and 40% late.
 *    (Before: 17%, 29-45%, 56%. Hot and cold starts were swinging the number too far.)
 *  - The last quarter is slower than the rest (about 11-13% fewer points a minute) until the final
 *    3 minutes, when close games speed up (fouls, free throws) and lopsided ones slow down.
 *    Lopsided games score a little MORE in the early 4th (benches run), not less.
 *  - Overtime: about 3 games in 100 overall, 9 in 100 when it's within 6 late. Its points are counted.
 *  - The swing around our number is tighter than we assumed (8.5% of the total, not 10%).
 *
 * v3.10 (Nov 11, 2026), measured on 4,088 NBA games with their closing lines (tools/ggbt.js):
 *  - The starting rate now adds up to the line (it used to sit about 1% under it from the tip): through three
 *    quarters the number ran 2 to 3 points low on 2,619 games from 2023-25; now within about 1.
 *  - A line first seen DURING a game (FanDuel lists games only once they are live) is no longer treated as a
 *    pregame line: only the points still to come are spread over the time left. Opened at the end of Q1 or at
 *    halftime, the number lands 4 to 9% closer (the live line in that test is simulated: no history of real ones exists).
 *  - Clocks under a minute ("45.2") and quarter breaks ("End of 1st") are read correctly.
 *  - Plus edges only, in every sentence: our number is never set against a line it is not ahead of. No calls before tip-off.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LeagueLive = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const FIBA = { periods: 4, periodMinutes: 10, otMinutes: 5, usesHalves: false };
  const PROFILES = {
    nba: { clock: { periods: 4, periodMinutes: 12, otMinutes: 5, usesHalves: false }, total: 228, blowout: 25 },
    gleague: { clock: { periods: 4, periodMinutes: 12, otMinutes: 5, usesHalves: false }, total: 230, blowout: 25 },
    wnba: { clock: FIBA, total: 164, blowout: 20 },
    ncaam: { clock: { periods: 2, periodMinutes: 20, otMinutes: 5, usesHalves: true }, total: 145, blowout: 22 },
    ncaaw: { clock: FIBA, total: 135, blowout: 22 },
  };
  // v3.10 constants (fit on 2,619 NBA games from 2023-25 with their closing lines, checked on 1,469 newer ones)
  const TYPICAL_LATE_MARGIN = 11; // points apart a game that is tied early is, on average, by the last quarter
  const OT_BASE = 0.034; // share of games that go to overtime, as seen from early in the game
  const WOMEN_RE = /\bwomen|\bwomens|\bfemale|\bladies|\bwnbl\b|\bfeminin|\bdamen|\bdam(?:er)?\b|\(w\)|\bw$/i;

  const round1 = (n) => Math.round(n * 10) / 10;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const num = (v) => { if (v == null || v === '') return null; const x = Number(typeof v === 'string' ? v.replace(',', '.') : v); return Number.isFinite(x) ? x : null; };

  function isWomen(game) {
    return WOMEN_RE.test(String(game.leagueName || '')) || game.leagueId === 'wnba' || game.leagueId === 'ncaaw';
  }

  function profileFor(game = {}) {
    const known = PROFILES[game.leagueId];
    if (known) return { ...known, regulation: known.clock.periods * known.clock.periodMinutes };
    const women = isWomen(game);
    return { clock: FIBA, total: women ? 140 : 160, blowout: 20, regulation: 40 };
  }

  /** Short name for filter chips and list rows: "Sweden - Ligan" -> "Sweden", "Spain - League - Women" -> "Spain W". */
  function leagueLabel(game = {}) {
    if (game.leagueId && game.leagueId !== 'other') return game.leagueAbbrev || game.leagueName || game.leagueId;
    const name = String(game.leagueName || 'Other').trim();
    let base = name.includes(' - ') ? name.split(' - ')[0].trim() : name;
    if (base.length > 14) base = base.split(/\s+/).slice(0, 2).join(' ');
    return isWomen(game) && !/\bW$/.test(base) ? `${base} W` : base;
  }

  function leagueKey(game = {}) {
    return game.leagueId && game.leagueId !== 'other' ? game.leagueId : `x:${String(game.leagueName || 'other').toLowerCase()}`;
  }

  function parseClock(clock) {
    if (clock == null) return null;
    const s = String(clock).trim();
    if (!s || s === '--') return null;
    if (s.includes(':')) {
      const [m, sec] = s.split(':').map(Number);
      return Number.isFinite(m) && Number.isFinite(sec) ? m + sec / 60 : null;
    }
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    // v3.10: with a decimal point and no colon it is seconds left in the period ("45.2" under a minute, "0.0" at the horn)
    return s.includes('.') ? n / 60 : n;
  }

  function isLive(g) { return g.status === 'in_progress' || g.status === 'halftime'; }

  function quarterSums(game) {
    const a = Array.isArray(game.away?.qScores) ? game.away.qScores : [];
    const h = Array.isArray(game.home?.qScores) ? game.home.qScores : [];
    const n = Math.min(a.length, h.length);
    const out = [];
    for (let i = 0; i < n; i += 1) out.push((Number(a[i]) || 0) + (Number(h[i]) || 0));
    // some feeds pad the list to four quarters from the tip: an empty quarter past the one in play has not started
    const per = Number(game.period) || 0;
    while (out.length > Math.max(per, 1) && out[out.length - 1] === 0) out.pop();
    return out;
  }

  function periodLen(i, cfg) { return i <= cfg.periods ? cfg.periodMinutes : cfg.otMinutes; }

  /**
   * Where the game is. Uses FanDuel's clock when it sends one. Some leagues (Sweden, Croatia)
   * come with no clock and a stale period, so the quarter comes from the quarter scores and
   * the minutes into it are estimated from the points scored in it.
   */
  function progress(game = {}, { prior } = {}) {
    const prof = profileFor(game);
    const cfg = prof.clock;
    const reg = prof.regulation;
    const pts = (Number(game.home?.score) || 0) + (Number(game.away?.score) || 0);
    const status = game.status;
    const sums = quarterSums(game);
    const n = sums.length;
    const sumQ = sums.reduce((s, v) => s + v, 0);
    const period = Number(game.period) || 0;
    const T0 = num(prior) || num(game.fdTotal?.line) || prof.total;
    const rate0 = T0 / reg;
    const base = { pts, sums, reg, cfg, prior: T0, priorFromLine: Boolean(num(prior) || num(game.fdTotal?.line)) };

    if (status === 'final') {
      const current = Math.max(period, n, cfg.periods);
      return { ...base, state: 'final', current, completed: current, inPeriod: 0, elapsed: reg, remaining: 0, currentPts: null, clockSource: 'final' };
    }
    if (!isLive(game) && pts === 0) {
      return { ...base, state: 'pre', current: 0, completed: 0, inPeriod: 0, elapsed: 0, remaining: reg, currentPts: 0, clockSource: 'pre' };
    }
    const halftime = status === 'halftime' || game.isHalftime || /^(ht|half)/i.test(String(game.statusDetail || ''));
    if (halftime && !cfg.usesHalves) {
      const half = cfg.periods / 2;
      return { ...base, state: 'halftime', current: half + 1, completed: half, inPeriod: 0, elapsed: reg / 2, remaining: reg / 2, currentPts: 0, clockSource: 'halftime' };
    }

    const clockMin0 = parseClock(game.clock);
    // v3.10: "End of 1st" (quarter break) is a known spot on the clock: that period is over, zero left in it
    const sdTxt = String(game.statusDetail || game.periodText || '');
    // ("End of 2OT" or "End of 1st OT" is the end of an overtime, not of the 2nd or 1st quarter: the period number rules there)
    const endIsOt = /^end of\b.*\bo(t|vertime)\b|^end of \d?\s*ot/i.test(sdTxt) || period > cfg.periods;
    const endOf = endIsOt ? 0 : Number((sdTxt.match(/^end of (\d)/i) || [])[1]) || 0;
    const clockMin = endOf ? 0 : clockMin0;
    // a clock with a decimal point ("0.0" at the horn) is a real clock even at zero; the "0:00" placeholder has a colon
    const hasClock = clockMin != null && (clockMin > 0 || endOf > 0 || /^(Q|H|OT)\d*/i.test(sdTxt) || String(game.clock == null ? '' : game.clock).includes('.'));
    // the quarter in play as the feed names it: "Q2" (FanDuel), "6:00 - 2nd" (ESPN), "H1"; "Live" tells us nothing.
    const textQ = Number((String(game.statusDetail || '').match(/^Q(\d+)/i) || sdTxt.match(/-\s*(\d)(?:st|nd|rd|th)\b/i) || sdTxt.match(/^H(\d)/i) || [])[1]) || 0;
    let current;
    let completed;
    if (endOf) { current = Math.max(endOf, 1); completed = current - 1; }
    // quarter scores that add up to less than the score mean the list holds finished quarters only, unless the feed
    // itself names the quarter in play and it is the last one listed (then the list is just a basket behind the score)
    else if (n > 0 && sumQ < pts && !(textQ && textQ === n)) { completed = n; current = Math.max(period, n + 1); }
    else if (n > 0) {
      current = Math.max(period, n);
      completed = current - 1;
      // Leagues with no clock usually list finished quarters only. If the last listed
      // quarter already holds a full quarter's worth of points, it's over and the next one
      // has just started.
      if (!hasClock && current === n && textQ !== n) {
        const len0 = periodLen(n, cfg);
        if (sums[n - 1] >= 0.9 * rate0 * len0) { completed = n; current = n + 1; }
      }
    } else { current = Math.max(period, 1); completed = current - 1; }

    let doneMinutes = 0;
    for (let i = 1; i <= completed; i += 1) doneMinutes += periodLen(i, cfg);
    let donePts = 0;
    let known = completed <= n;
    for (let i = 0; i < completed; i += 1) {
      if (sums[i] == null) { known = false; break; }
      donePts += sums[i];
    }
    const currentPts = known ? Math.max(pts - donePts, 0) : null;
    const len = periodLen(current, cfg);
    let inPeriod;
    let clockSource;
    if (hasClock) {
      inPeriod = clamp(len - Math.min(clockMin, len), 0, len);
      clockSource = 'clock';
    } else {
      const obsRate = doneMinutes >= 1 ? donePts / doneMinutes : null;
      const r = obsRate != null && known ? (obsRate + rate0) / 2 : rate0;
      inPeriod = currentPts != null ? currentPts / r : len / 2;
      inPeriod = clamp(inPeriod, Math.min(0.5, len), Math.max(len - 0.5, 0.5));
      clockSource = 'estimated';
    }
    const elapsed = doneMinutes + inPeriod;
    const inOt = current > cfg.periods;
    const remaining = inOt ? Math.max(len - inPeriod, 0) : Math.max(reg - elapsed, 0);
    return { ...base, state: 'live', current, completed, inPeriod, elapsed, remaining, currentPts, clockSource, inOt };
  }

  /** How much the live pace counts at this point of the game (0 = tip, 1 = end of regulation). Learned, see the header. */
  function liveWeight(f, fromLine) {
    // v3.9: when the starting total is a sportsbook line, tonight's pace adds almost nothing until late
    // (1,223 NBA games with their closing lines: best weight 0-4% through three quarters; the last six minutes keep the earlier, heavier weights)
    if (fromLine) return f < 0.7 ? 0.03 : f < 0.75 ? 0.03 + (f - 0.7) * 1.0 : Math.min(0.42, 0.1 + (f - 0.55) * 0.9, 0.08 + (f - 0.75) * 2.5);
    if (f < 0.25) return 0.4 * f;
    if (f < 0.55) return 0.1;
    return Math.min(0.42, 0.1 + (f - 0.55) * 0.9);
  }

  // Standard normal CDF (Abramowitz-Stegun).
  function phi(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  function periodName(i, cfg) {
    if (i > cfg.periods) return i - cfg.periods === 1 ? 'Overtime' : `Overtime ${i - cfg.periods}`;
    if (cfg.usesHalves) return i === 1 ? '1st half' : '2nd half';
    return ['1st quarter', '2nd quarter', '3rd quarter', '4th quarter'][i - 1];
  }

  function whereText(p, game, now = Date.now()) {
    const cfg = p.cfg;
    if (p.state === 'final') return 'Final';
    if (p.state === 'halftime') return 'Halftime';
    if (p.state === 'pre') {
      const t = Date.parse(game.date);
      if (!Number.isFinite(t)) return 'Not started';
      let hm = '';
      try { hm = new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { hm = ''; }
      return t > now ? `Starts ${hm}` : 'Starting soon';
    }
    const name = periodName(p.current, cfg);
    const len = periodLen(p.current, cfg);
    if (p.clockSource === 'clock') {
      const secs = Math.max(0, Math.round((len - p.inPeriod) * 60));
      return `${name} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left`;
    }
    return `${name} · about ${Math.max(1, Math.min(Math.round(p.inPeriod), Math.floor(periodLen(p.current, p.cfg)) - 1))} min in (estimated)`;
  }

  /**
   * Full projection: game, halves, quarters, and plain-words calls for each line given.
   * lines: { game, half1, half2, quarter: { [n]: line } }  (numbers or strings)
   */
  function project(game = {}, opts = {}) {
    const { prior, lines = {}, minEdge = 3 } = opts;
    const p = progress(game, { prior });
    const { cfg, reg, pts } = p;
    const prof = profileFor(game);
    const T0 = p.prior;
    const fNow = clamp(p.elapsed / reg, 0, 1);
    const diff = Math.abs((Number(game.home?.score) || 0) - (Number(game.away?.score) || 0));
    const lastIdx = cfg.periods;
    // The late-game shape depends on how lopsided the game is LATE. Early on, today's margin says little about that:
    // a tied game after one quarter still ends up about 10 apart on average. So the margin used for the last quarter
    // is today's margin plus the usual drift still ahead (v3.10; before, a tie in the 1st quarter was treated as a tight finish).
    const lateMargin = (f, d) => Math.sqrt(d * d + TYPICAL_LATE_MARGIN * TYPICAL_LATE_MARGIN * Math.max(0, 0.78 - f) / 0.78);
    const shapeAt = (f, ml) => (f < 0.75 ? 1 : f < 0.875 ? 0.886 + 0.033 * ml : f < 0.9375 ? 0.87 + 0.038 * ml : clamp(1.139 - 0.082 * ml, 0.9, 1.14));
    const CUTS = [0.75, 0.875, 0.9375, 1];
    // "effective minutes" between two game minutes: clock minutes weighted by the late-game shape
    const effBetween = (m0, m1, ml) => {
      let out = 0, a = m0;
      for (const c of CUTS) { const b = Math.min(m1, c * reg); if (b > a) { out += (b - a) * shapeAt((a + b) / 2 / reg, ml); a = b; } }
      if (m1 > a) out += (m1 - a) * shapeAt(0.99, ml);
      return out;
    };
    const mLop = Math.min(lateMargin(fNow, diff), 30) / 10;
    // The starting rate must add up to the line: a book's total already has the slow last quarter, the foul-filled final
    // minutes and the odd overtime inside it. (Before v3.10 the rate was total / minutes, so the live number sat about 1%
    // under the line from the opening tip.) A line first seen DURING a game is handled the same way from that moment on:
    // the points already scored then are taken out and the rest is spread across the time that was left.
    // (a snapshot is only used when it is believable: taken before the last tenth of regulation, not ahead of where the game
    // is now, and leaving a scoring rate for the rest of the game within 0.6 to 1.6 times the league's usual one)
    const seen0 = opts.priorSeen && num(opts.priorSeen.elapsed) != null && num(opts.priorSeen.pts) != null && opts.priorSeen.elapsed > 0.5 && opts.priorSeen.elapsed <= 0.9 * reg && opts.priorSeen.elapsed <= p.elapsed + 1 && opts.priorSeen.pts <= pts ? opts.priorSeen : null;
    let seen = null;
    const tipEff = effBetween(0, reg, Math.min(lateMargin(0, 0), 30) / 10) + OT_BASE * cfg.otMinutes * 1.05;
    let rate0 = T0 / tipEff;
    if (seen0 && p.priorFromLine) {
      const fS = clamp(seen0.elapsed / reg, 0, 1), dS = num(seen0.diff) != null ? Math.abs(seen0.diff) : 0;
      const effS = effBetween(seen0.elapsed, reg, Math.min(lateMargin(fS, dS), 30) / 10) + OT_BASE * cfg.otMinutes * 1.05;
      const rS = effS > 0.5 ? (T0 - seen0.pts) / effS : 0, usual = profileFor(game).total / reg;
      if (rS >= 0.6 * usual && rS <= 1.6 * usual) { rate0 = rS; seen = seen0; }
    }
    const obsRate = p.elapsed >= 1 ? pts / p.elapsed : rate0;
    const w = p.state === 'live' || p.state === 'halftime' ? liveWeight(fNow, p.priorFromLine) : 0;
    const rate = w * obsRate + (1 - w) * rate0;
    const between = (m0, m1) => rate * effBetween(m0, m1, mLop);
    let startOf = 0; const starts = {};
    for (let i = 1; i <= Math.max(cfg.periods, p.current || 0); i += 1) { starts[i] = startOf; startOf += periodLen(i, cfg); }
    // points still to come in period i from minute `into` of it (overtime: a touch faster than normal)
    // inside a 12-minute quarter the first minute is slow and the last is fast (fouls, two-for-ones): mid-quarter, a bit more than the clock's share is still to come (the last quarter has its own learned shape)
    const lateBump = (i, into) => { const len = periodLen(i, cfg); if (cfg.usesHalves || len !== 12 || into <= 0 || i >= lastIdx) return 0; const u = into / len; return rate * len * 0.011 * Math.min(1, u * 12, (1 - u) * 12); };
    const restOf = (i, into) => (i > lastIdx ? rate * Math.max(periodLen(i, cfg) - into, 0) * 1.05 : between(starts[i] + into, starts[i] + periodLen(i, cfg)) + lateBump(i, into));

    // Per-period numbers.
    const periods = [];
    const total = Math.max(cfg.periods, p.current || 0);
    for (let i = 1; i <= total; i += 1) {
      const len = periodLen(i, cfg);
      let value;
      let state;
      if (p.state === 'final') { value = p.sums[i - 1] ?? null; state = 'done'; }
      else if (p.state === 'pre') { value = rate0 * effBetween(starts[i], starts[i] + len, mLop) + (i === lastIdx ? rate0 * OT_BASE * cfg.otMinutes * 1.05 : 0); state = 'next'; }
      else if (i <= p.completed) { value = p.sums[i - 1] ?? rate * len; state = 'done'; }
      else if (i === p.current && p.state === 'live') {
        value = (p.currentPts ?? rate * p.inPeriod) + restOf(i, p.inPeriod);
        state = 'now';
      } else { value = restOf(i, 0); state = 'next'; }
      periods.push({ n: i, name: periodName(i, cfg), value: value == null ? null : round1(value), state, soFar: i === p.current && p.state === 'live' ? p.currentPts : null, remainingMin: state === 'now' ? Math.max(len - p.inPeriod, 0) : state === 'next' ? len : 0 });
    }
    const regPeriods = periods.filter((x) => x.n <= cfg.periods);
    const sum = (arr) => (arr.every((x) => x.value != null) ? round1(arr.reduce((s, x) => s + x.value, 0)) : null);
    const halfCount = cfg.usesHalves ? 1 : cfg.periods / 2;
    const h1 = sum(regPeriods.slice(0, halfCount));
    const h2 = sum(regPeriods.slice(halfCount));
    let full;
    if (p.state === 'final') full = pts;
    else if (p.state === 'pre') full = T0;
    else {
      // Points so far plus what's still to come in the current and later periods.
      let rest = 0;
      for (const per of periods) {
        if (per.state === 'now') rest += restOf(per.n, periodLen(per.n, cfg) - per.remainingMin);
        else if (per.state === 'next') rest += per.value;
      }
      // overtime happens in about 3 games in 100, and in about 9 in 100 when it's within 6 late
      const regOver = p.state === 'live' && !p.inOt && p.remaining <= 0.01;
      const pOt = p.inOt ? 0 : regOver ? (diff === 0 ? 1 : 0) : fNow >= 0.8 && diff <= 6 ? 0.09 : fNow >= 0.8 && diff > 12 ? 0.005 : OT_BASE;
      full = round1(pts + rest + pOt * rate * cfg.otMinutes * 1.05);
    }

    const remainingIn = (from, to) => periods.filter((x) => x.n >= from && x.n <= to).reduce((s, x) => s + x.remainingMin, 0);
    const scale = T0 / 160;
    const sdFull = 0.085 * T0;
    const estimated = p.clockSource === 'estimated';
    const markets = [];
    function price(id, label, mean, line, remMin, settledText, windowShare = 1) {
      const L = num(line);
      if (L == null || L <= 0) return;
      const m = { id, label, line: L, ours: mean, gap: mean == null ? null : round1(mean - L), call: null, chance: null };
      if (settledText) { m.text = settledText; m.pass = 'settled'; markets.push(m); return; }
      if (mean == null) { m.text = 'We can’t work this one out yet.'; m.pass = 'nodata'; markets.push(m); return; }
      const sd = Math.max(1.5, sdFull * Math.sqrt(Math.max(remMin, 0.25) / reg) * (estimated ? 1.3 : 1) * (p.state === 'pre' ? 1.3 : 1));
      const pOver = 1 - phi((L - mean) / sd);
      const edgeNeed = round1(minEdge * scale * (id === 'game' ? 1 : id.startsWith('half') ? 0.67 : 0.5));
      const absGap = Math.abs(mean - L);
      const side = mean > L ? 'Over' : 'Under';
      const chance = side === 'Over' ? pOver : 1 - pOver;
      m.chance = Math.round(chance * 100) / 100;
      if (side === 'Under' && p.state !== 'pre') {
        // plus edges only: our number is never set against a line it is not ahead of (checked before every other case,
        // so overtime and the last minute cannot print it either)
        m.text = 'Our number is not ahead of this line, so there is no plus edge here.';
        m.pass = 'below';
      } else if (p.inOt) {
        m.text = `We expect about ${round1(mean)}, but the game is in overtime, where anything goes. No bet.`;
        m.pass = 'ot';
      } else if (remMin < 1 && p.state === 'live') {
        m.text = `Less than a minute of this part of the game is left, so there’s nothing to bet on. It's heading for about ${round1(mean)}.`;
        m.pass = 'late';
      } else if (p.state === 'live' && p.elapsed < reg / 8) {
        m.text = `It's too early to trust the pace. We make calls once about ${Math.round(reg / 8)} minutes are played.`;
        m.pass = 'early';
      } else if (p.state === 'pre') {
        // v3.10: no calls on any line before tip-off (halves and quarters used to be called from an even split of the game total)
        m.text = id === 'game' ? `Before tip-off we use ${p.priorFromLine ? 'FanDuel’s own line' : 'the usual total for this league'} as our number. We'll make calls once the game starts.` : `We'll make calls on this line once the game starts.`;
        m.pass = 'pre';
      } else if (side === 'Under') {
        // plus edges only: our number is never set against a line it is not ahead of
        m.text = 'Our number is not ahead of this line, so there is no plus edge here.';
        m.pass = 'below';
      } else if (p.state === 'live' && absGap > (estimated ? 0.12 : 0.18) * T0 * windowShare) {
        m.text = estimated
          ? `We get about ${round1(mean)}, far ahead of FanDuel's ${L}. A gap that big with no game clock usually means our guess of the minutes played is off, so we sit this one out.`
          : `We get about ${round1(mean)}, far ahead of FanDuel's ${L}. A gap that big usually means the line carries news the score doesn't show yet, so we sit this one out.`;
        m.pass = 'toofar';
      } else if (absGap >= edgeNeed && chance >= 0.58) {
        m.call = side;
        m.text = `We expect about ${round1(mean)} points, ${round1(absGap)} ahead of FanDuel's line of ${L}. That's a plus edge: more points than FanDuel expects. Chance it beats ${L}: ${Math.round(chance * 100)}%.`;
      } else {
        m.text = `We expect about ${round1(mean)}, only ${round1(absGap)} ahead of FanDuel's ${L}. We need a gap of ${edgeNeed} or more to make a call.`;
        m.pass = 'close';
      }
      // a line our number is not ahead of carries no number of ours at all
      if (m.pass === 'below' || m.pass === 'early' || (m.pass === 'pre' && (id !== 'game' || side === 'Under'))) { m.ours = null; m.gap = null; m.chance = null; }
      markets.push(m);
    }

    const H = lines || {};
    const realSums = (from, to) => { for (let i = from; i <= to; i += 1) if (p.sums[i - 1] == null) return false; return true; };
    const doneText = (label, v, real = true) => (real && v != null ? `The ${label.toLowerCase()} has ended: it finished with ${v} points.` : `The ${label.toLowerCase()} has ended.`);
    price('game', 'Full game', full, H.game, p.remaining, p.state === 'final' ? `Final score total: ${pts} points.` : null);
    if (!cfg.usesHalves) {
      const h1Done = p.state !== 'pre' && p.completed >= halfCount;
      price('half1', '1st half', h1, H.half1, remainingIn(1, halfCount), h1Done ? doneText('1st half', h1, realSums(1, halfCount)) : null, 0.5);
      price('half2', '2nd half', h2, H.half2, remainingIn(halfCount + 1, cfg.periods), p.state === 'final' ? doneText('2nd half', h2, realSums(halfCount + 1, cfg.periods)) : null, 0.5);
    }
    const qLines = H.quarter || {};
    for (const per of regPeriods) {
      if (qLines[per.n] == null || qLines[per.n] === '') continue;
      price(`q${per.n}`, per.name, per.value, qLines[per.n], per.remainingMin, per.state === 'done' ? doneText(per.name, per.value, p.sums[per.n - 1] != null) : null, periodLen(per.n, cfg) / reg);
    }

    // Plain-words reasons.
    const why = [];
    if (p.state === 'live' || p.state === 'halftime') {
      const pace = p.elapsed >= 1 ? round1((pts / p.elapsed) * reg) : null;
      if (pace != null) {
        const vs = pace > T0 + 2 ? 'faster than' : pace < T0 - 2 ? 'slower than' : 'about the same as';
        const first = num(prior) != null && num(prior) !== num(game.fdTotal?.line);
        const startName = p.priorFromLine ? `FanDuel's line of ${T0}${first ? ' when we first saw this game' : ''}` : `the usual total for this league (${T0})`;
        why.push(`They've scored ${pts} points in about ${Math.round(p.elapsed)} minutes. That's a ${pace}-point pace for a full game, ${vs} ${startName}.`);
      }
      why.push(`We trust the live pace ${Math.round(w * 100)}% and ${p.priorFromLine ? 'FanDuel\'s starting number' : 'the usual total for this league'} ${100 - Math.round(w * 100)}%. Hot and cold starts mostly fade, so the live pace only counts for more late in the game.`);
      if (seen && p.priorFromLine) why.push(`We first saw this game with ${seen.pts} points already scored, so FanDuel's line then already had that start inside it. We only spread the points that were still to come.`);
      if (obsRate * reg - T0 >= 0.08 * T0 && fNow < 0.8) why.push(`Fade warning: this game is on pace for ${Math.round(obsRate * reg)}, well ahead of ${p.priorFromLine ? `FanDuel's ${T0}` : `the usual ${T0}`}. Fast starts like this give most of it back, so we expect ${Math.round(full)}.`);
      if (estimated) why.push('FanDuel doesn’t show a game clock for this league, so we work out how far into the quarter they are from the score. The chances we state are widened to match.');
      if (fNow >= 0.9375 && diff <= 6) why.push('It’s close in the final minutes, so we add points for fouls and free throws, and a small chance of overtime.');
      else if (fNow >= 0.7 && diff >= 15) why.push(`It's a ${diff}-point game. Lopsided games keep scoring with the benches in, then slow down in the final minutes.`);
      else if (fNow >= 0.7) why.push('Last quarters run slower than the rest of the game until the final 3 minutes. That is already in our number.');
    } else if (p.state === 'pre') {
      why.push(`Not started yet. We split ${p.priorFromLine ? `FanDuel's game total of ${T0}` : `the usual total for this league (${T0})`} across the ${cfg.usesHalves ? 'halves' : 'quarters, with the last quarter a little slower'}.`);
    }
    if (!markets.length && p.state !== 'final') why.push('No FanDuel line yet. Type one in to get a plus-edge call.');

    return {
      progress: { state: p.state, current: p.current, completed: p.completed, elapsed: round1(p.elapsed), remaining: round1(p.remaining), clockSource: p.clockSource, inOt: Boolean(p.inOt), currentPts: p.currentPts },
      where: whereText(p, game),
      full,
      half1: cfg.usesHalves ? null : h1,
      half2: cfg.usesHalves ? null : h2,
      periods,
      usesHalves: cfg.usesHalves,
      markets,
      why,
      math: { prior: T0, priorFromLine: p.priorFromLine, rate0: round1(T0), liveWeight: Math.round(w * 100) / 100, livePace: p.elapsed >= 1 ? round1((pts / p.elapsed) * reg) : null, blendedPace: round1(rate * reg), elapsed: round1(p.elapsed), remaining: round1(p.remaining) },
    };
  }

  return { profileFor, leagueLabel, leagueKey, progress, project, parseClock, quarterSums, isWomen, isLive, phi, liveWeight };
}));
