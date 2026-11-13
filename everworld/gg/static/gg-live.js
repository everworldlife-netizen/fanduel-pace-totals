/* GG Winner: the number shown for GG League games while they are being played, and its report card (v3.11, Nov 13 2026).
 *
 * For every live game the data server sends its own raw number (player history + the score so far), FanDuel's line, and the
 * share of each that it trusts. Two things are done with that here, on the phone.
 *
 * 1. Late-game correction. The server works out how much of a game has been played from the wall clock, and late in a game
 *    that reading runs behind: on 296 graded readings (268 games, Nov 9 to 13) the points it still expected were right through
 *    70% of a game, but only 94% of them came between 70 and 80%, 77% between 80 and 90%, and 56% in the last tenth. The number
 *    on the board ran 1.8 points high between 75 and 90% of a game. So from 70% on only a share of the "points still to come"
 *    is kept: all of them at 70%, falling in a straight line to half at the horn. Each day checked with the setting fitted on
 *    the other four days: the average miss of the number shown over the last third of a game (141 readings) went from 4.17
 *    to 3.87 points, 7% closer. With the setting used here it is closer on each of the five days, and in the last tenth of a
 *    game the miss goes from 3.87 to 3.10. Before 70% nothing changes.
 *    A plus edge the server called stays only if the corrected number still clears the same bars; none is ever added.
 *
 * 2. The report card. The Results screen used to grade the server's raw number, not the number the app shows ("GG proj", a
 *    mix of the raw number and FanDuel's line), so "Ours" could read worse than FanDuel while the number on the board was
 *    closer. reportCard() grades the number the app shows, with the rules it uses today, at each checkpoint of every graded game.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GGLive = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LATE = { from: 0.7, k: 0.5 }; // share kept = 1 - k x (f - from) / (1 - from) once f is past `from`
  // The data server's own settings, needed only to work the score back out of its raw number in graded games (the graded record
  // keeps the raw number, the pregame number and the share played, but not the score at that moment).
  // phaseWeights: the share of our raw number in the number shown, by stretch of a game (before the tip, first quarter, 25 to 75%,
  // 75 to 90%, the last tenth). The server re-learns three of them from its graded games; these are its values on Nov 13, 2026,
  // used only until the phone has read the current ones off a live board (see phaseIndex and the app's saved copy).
  const SERVER = { n0: 6, quarterShare: [0.2546, 0.2467, 0.2425, 0.2486], phaseWeights: [0.68, 0.45, 0.15, 0.47, 0.9] };

  const num = (v) => v != null && v !== '' && Number.isFinite(Number(v));
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const r1 = (x) => Math.round(x * 10) / 10;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const cdf = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const p = 0.3989422804 * Math.exp(-x * x / 2) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x > 0 ? 1 - p : p; };
  const dec = (american) => { const o = Number(american); return !Number.isFinite(o) || o === 0 ? null : o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o); };

  /** Share of the server's "points still to come" that is kept, by share of the game played (1 = all of them). */
  function keepLate(f) {
    if (!num(f) || f <= LATE.from) return 1;
    return 1 - LATE.k * (Math.min(Number(f), 1) - LATE.from) / (1 - LATE.from);
  }

  // How far the number shown usually lands from the final (average miss), measured on the graded games of Nov 9 to 13, 2026 with
  // today's rules: 9.3 before the tip (268 games), 6.8 about a third of the way in (88 readings), 5.5 at about 60% (98), 3.6 at
  // about 87% (110), and about 3 from there to the horn (2.8 on 19 readings at 94%, 3.3 on 25 at 99%: overtime is still possible).
  // In between, a straight line.
  const USUAL = [[0, 9.3], [0.35, 6.8], [0.61, 5.5], [0.87, 3.6], [1, 3.0]];
  /** The usual miss of the number shown at a share of the game played (before the tip when the game is not being played). */
  function usualMiss(f, live) {
    const x = live && num(f) ? clamp(Number(f), 0, 1) : 0;
    for (let i = 1; i < USUAL.length; i += 1) if (x <= USUAL[i][0]) { const [x0, y0] = USUAL[i - 1], [x1, y1] = USUAL[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return USUAL[USUAL.length - 1][1];
  }

  /** The corrected raw number: what is on the board already, plus the kept share of what the server still expects. */
  function lateRaw(raw, soFar, f) {
    const keep = keepLate(f);
    if (!(keep < 1) || !num(raw) || !num(soFar) || !(Number(raw) > Number(soFar))) return num(raw) ? Number(raw) : raw;
    return Number(soFar) + keep * (Number(raw) - Number(soFar));
  }

  /**
   * One market of a live game, corrected in place. soFar = the points already scored that this market counts (the game total,
   * one side's points, or the points of this quarter). bars = { edge, ev }: the least gap and long-run return a plus edge needs.
   */
  function fixMarket(m, soFar, keep, bars) {
    if (!m || m.lateKeep != null || !(keep < 1) || !num(m.mean) || !num(soFar)) return m;
    const wGame = bars && num(bars.weight) ? clamp(Number(bars.weight), 0, 1) : 1; // the game's own share, when the market does not carry one
    const mean0 = Number(m.mean), sofar = Number(soFar);
    if (!(mean0 > sofar)) return m;
    const mean = sofar + keep * (mean0 - sofar);
    const hasLine = num(m.line), line = hasLine ? Number(m.line) : null;
    // the share of our raw number in the number shown: the server's, or read back from its two numbers when it is not sent
    let w = 1;
    if (hasLine) w = num(m.weight) ? clamp(Number(m.weight), 0, 1) : num(m.fair) && Math.abs(mean0 - line) > 0.2 ? clamp((Number(m.fair) - line) / (mean0 - line), 0, 1) : wGame;
    const fair = hasLine ? w * mean + (1 - w) * line : mean;
    m.serverMean = mean0; m.serverFair = num(m.fair) ? Number(m.fair) : null; m.lateKeep = r3(keep);
    // (rounded to a tenth like the server's numbers, and never above them: the correction only takes points away)
    m.mean = Math.min(r1(mean), mean0); m.fair = m.serverFair != null ? Math.min(r1(fair), m.serverFair) : r1(fair);
    // fewer points still to come means a narrower spread of finals, in step with the share kept
    if (num(m.sd)) m.sd = r1(Math.max(Number(m.sd) * Math.sqrt(keep), 1.2));
    if (!hasLine) return m;
    m.gap = r1(m.fair - line); m.rawGap = r1(m.mean - line);
    const p = num(m.sd) ? 1 - cdf((line - m.fair) / (Number(m.sd) * 0.92)) : null; // (the server's own chance formula, on the new numbers)
    const dO = dec(m.overOdds), dU = dec(m.underOdds);
    m.pOver = p == null ? null : r3(p);
    m.evOver = p != null && dO ? r3(p * (dO - 1) - (1 - p)) : null;
    m.evUnder = p != null && dU ? r3((1 - p) * (dU - 1) - p) : null;
    m.side = m.gap > 0 ? 'Over' : 'Under';
    m.ev = m.side === 'Over' ? m.evOver : m.evUnder;
    if (m.call === 'Over') {
      const edge = bars && num(bars.edge) ? Number(bars.edge) : 2, evMin = bars && num(bars.ev) ? Number(bars.ev) : 0.03;
      if (!(m.gap > 0)) { m.call = 'Pass'; m.reason = 'Below the line: plus edges only'; }
      else if (m.gap < edge) { m.call = 'Pass'; m.reason = `Edge under ${edge} pts`; }
      else if (m.evOver == null || m.evOver < evMin) { m.call = 'Pass'; m.reason = 'Price eats the edge'; }
    }
    m.score = m.call === 'Over' ? r1(Math.abs(m.gap) * (1 + (m.ev || 0) * 4)) : 0;
    return m;
  }

  /** Every market of one live game (the game total, each side's points, the quarter being played), and its best plus edge. */
  function fixEval(game, ev, opts) {
    if (!game || !ev || game.status !== 'live' || !ev.progress || !Array.isArray(ev.markets)) return ev;
    if (ev.progress.overtime) return ev; // overtime is a new period being played: the clock says nothing is left, and that is wrong
    const keep = keepLate(ev.progress.f);
    if (!(keep < 1)) return ev;
    const edge = opts && num(opts.edgeMin) ? Number(opts.edgeMin) : 2, evMin = opts && num(opts.evMin) ? Number(opts.evMin) : 0.03;
    const a = game.away && num(game.away.score) ? Number(game.away.score) : null, h = game.home && num(game.home.score) ? Number(game.home.score) : null;
    const total = a != null && h != null ? a + h : num(game.total) ? Number(game.total) : null;
    for (const m of ev.markets) {
      if (!m || !m.id) continue;
      const weight = ev.modelWeight;
      if (m.id === 'game') fixMarket(m, total, keep, { edge, ev: evMin, weight });
      else if (m.id === 'awayTotal') fixMarket(m, a, keep, { edge: edge * 0.75, ev: evMin, weight });
      else if (m.id === 'homeTotal') fixMarket(m, h, keep, { edge: edge * 0.75, ev: evMin, weight });
      else if (/^q[1-4]$/.test(m.id) && num(m.soFar)) fixMarket(m, m.soFar, keep, { edge: Math.max(1.5, edge * 0.75), ev: evMin, weight });
    }
    ev.lateKeep = r3(keep);
    ev.best = ev.markets.filter((m) => m && m.call && m.call !== 'Pass').sort((x, y) => (y.score || 0) - (x.score || 0))[0] || null;
    return ev;
  }

  /** A whole answer of the data server: the board (every live game and the picks) or one game's page. Changed in place. */
  function fix(body, opts) {
    if (!body || typeof body !== 'object') return body;
    const live = new Map();
    if (Array.isArray(body.live)) for (const g of body.live) if (g && g.eval) { fixEval(g, g.eval, opts); live.set(String(g.eventId), g); }
    if (body.game && body.eval) fixEval(body.game, body.eval, opts);
    if (Array.isArray(body.picks) && Array.isArray(body.live)) {
      // The picks are the strongest plus edges on the board, at most three (the server's own rule). The server sends them as
      // copies made before the correction, and only its top three: rebuilt here from the games themselves, so the list and the
      // cards always say the same thing, and a fourth plus edge moves up when a late one is gone.
      const plus = (g) => (g && g.eval && Array.isArray(g.eval.markets) ? g.eval.markets.filter((m) => m && m.call === 'Over').sort((x, y) => (y.score || 0) - (x.score || 0))[0] : null);
      body.picks = body.live.map((g) => ({ g, m: plus(g) })).filter((x) => x.m)
        .sort((x, y) => (y.m.score || 0) - (x.m.score || 0)).slice(0, 3)
        .map(({ g, m }) => ({ id: g.id, eventId: g.eventId, name: g.name, away: g.away, home: g.home, status: g.status, market: m }));
    }
    return body;
  }

  // ---------- the report card ----------
  const QSUM = SERVER.quarterShare.reduce((s, x) => s + x, 0);
  /** Share of a game's points scored between two shares of the game clock (the server's quarter shares). */
  function pointsShare(a, b) {
    let r = 0;
    for (let q = 0; q < 4; q += 1) { const lo = q / 4, hi = (q + 1) / 4, u = Math.max(0, Math.min(b, hi) - Math.max(a, lo)); r += SERVER.quarterShare[q] * (u / 0.25); }
    return r / QSUM;
  }
  /** The score at a checkpoint, worked back out of the server's raw number (its formula, solved for the score). */
  function scoreFromRaw(raw, expected, f) {
    const k0 = pointsShare(0, f), kr = pointsShare(f, 1), g = kr / (SERVER.n0 + k0);
    return (Number(raw) - SERVER.n0 * Number(expected) * g) / (1 + g);
  }
  /** Which of the server's five stretches a moment belongs to: 0 before the tip, then by share of the game played. */
  function phaseIndex(f, live) {
    if (!live) return 0;
    return f < 0.25 ? 1 : f < 0.75 ? 2 : f < 0.9 ? 3 : 4;
  }
  /** The server's share of our raw number at a share of the game played (pw = its phase weights; a missing one falls back). */
  function phaseWeight(f, pw) {
    const i = phaseIndex(Number(f), true), v = Array.isArray(pw) ? pw[i] : null;
    return num(v) && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : SERVER.phaseWeights[i];
  }
  /** The server's share of our number before the tip (the first of its five weights). */
  function preWeight(pw) {
    const v = Array.isArray(pw) ? pw[0] : null;
    return num(v) && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : SERVER.phaseWeights[0];
  }
  /** Read the weights the server is using right now off a board answer, into a saved list of five (unknown ones stay as they were). */
  function learnWeights(board, saved) {
    const out = Array.isArray(saved) ? saved.slice(0, 5) : [];
    while (out.length < 5) out.push(null);
    for (const list of [board && board.live, board && board.upcoming]) for (const g of Array.isArray(list) ? list : []) {
      const ev = g && g.eval, w = ev && ev.modelWeight;
      if (!ev || !ev.progress || !num(w) || Number(w) < 0 || Number(w) > 1 || ev.progress.overtime) continue;
      out[phaseIndex(Number(ev.progress.f) || 0, g.status === 'live')] = Number(w);
    }
    return out;
  }
  /** The number the app shows for the game total at a moment of a live game. */
  function shownLive({ f, raw, line, soFar, weight }) {
    const r = lateRaw(raw, soFar, f);
    return num(line) ? Number(weight) * r + (1 - Number(weight)) * Number(line) : r;
  }
  /**
   * Graded games (the server's /api/eb/graded list) -> how close the number shown landed at each checkpoint, next to FanDuel's
   * line at the same moment. Rows: { key, n, f (average share played), ours, fanduel, raw }.
   */
  function reportCard(graded, pw) {
    const acc = {};
    const add = (key, f, ours, fd, raw, fin) => { const a = acc[key] || (acc[key] = { key, n: 0, f: 0, ours: 0, fanduel: 0, raw: 0, nFd: 0 }); a.n += 1; a.f += f; a.ours += Math.abs(ours - fin); a.raw += Math.abs(raw - fin); if (num(fd)) { a.fanduel += Math.abs(Number(fd) - fin); a.nFd += 1; } };
    let games = 0;
    for (const g of Array.isArray(graded) ? graded : []) {
      const fin = g && g.final && num(g.final.total) ? Number(g.final.total) : null;
      if (fin == null) continue;
      games += 1;
      const exp = g.pregame && num(g.pregame.expected) ? Number(g.pregame.expected) : null;
      // before the tip the board shows the pregame number, or its mix with FanDuel's line once FanDuel has one up
      const c0 = g.checkpoints && g.checkpoints['0'] && g.checkpoints['0'].game, w0 = preWeight(pw);
      const pre = c0 && num(c0.mean) && num(c0.line) ? { raw: Number(c0.mean), line: Number(c0.line) } : null;
      if (pre) { const shown = w0 * pre.raw + (1 - w0) * pre.line; add('all', 0, shown, null, pre.raw, fin); add('pre', 0, shown, pre.line, pre.raw, fin); }
      else if (exp != null) add('all', 0, exp, null, exp, fin);
      for (const [cp, c] of Object.entries(g.checkpoints || {})) {
        const m = c && c.game;
        if (!m || !num(m.mean) || !num(m.line) || cp === '0') continue;
        if (!num(c.f) || exp == null || !['25', '50', '75'].includes(cp)) continue;
        const f = Number(c.f), raw = Number(m.mean);
        const soFar = clamp(scoreFromRaw(raw, exp, f), 0, raw);
        add(cp, f, shownLive({ f, raw, line: m.line, soFar, weight: phaseWeight(f, pw) }), m.line, raw, fin);
      }
    }
    const rows = ['all', 'pre', '25', '50', '75'].filter((k) => acc[k]).map((k) => { const a = acc[k]; return { key: k, n: a.n, f: a.f / a.n, ours: a.ours / a.n, fanduel: a.nFd === a.n ? a.fanduel / a.n : null, raw: a.raw / a.n }; });
    return { games, rows };
  }

  return { LATE, SERVER, USUAL, usualMiss, keepLate, lateRaw, fixMarket, fixEval, fix, pointsShare, scoreFromRaw, phaseIndex, phaseWeight, preWeight, learnWeights, shownLive, reportCard };
});
