#!/usr/bin/env node
/* early-03: point-in-time rotation-timing features for every projected player-game, for the 6- and 12-minute moments.
 * History = the team's last 8 complete games inside 21 days BEFORE the game date (what the phone's recent logs hold).
 * Tonight = the player's stints cut at the moment (what the live play-by-play has shown by then).
 * Writes data/research/early-feat-<season>.json.gz : { "<gameId>:<pid>": {...} }
 *   node tools/research/early-03-feat.js 2026 */
'use strict';
const L = require('../lib');
const R = require('../replay');
const season = process.argv[2] || '2026';
const G = L.readJSON(`${L.ROOT}/data/derived/games-${season}.json.gz`).filter((it) => it.log && it.log.rows);
G.sort((a, b) => String(a.g.date).localeCompare(String(b.g.date)) || a.g.id - b.g.id);
const byId = new Map(G.map((it) => [it.g.id, it]));
const teamGames = {}; // team -> [it] in date order (complete games only)
for (const it of G) { if (!R.boxOk(it)) continue; for (const tm of [it.g.visitor_team.abbreviation, it.g.home_team.abbreviation]) (teamGames[tm] = teamGames[tm] || []).push(it); }
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').replace(/\s+(jr|sr|ii|iii|iv)$/,'').trim();
const onBetween = (st, a, b) => { let s = 0; for (const [i, o] of st) { const x = Math.max(i, a), y = Math.min(o, b); if (y > x) s += y - x; } return s; };
const onAt = (st, t) => st.some(([i, o]) => i <= t && o > t);
const med = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const r2 = (x) => (x == null ? null : +(+x).toFixed(2));

const rows = L.readJSON(`${L.ROOT}/data/runs/research-${season}.rows.json.gz`);
const need = new Map(); // id:tm -> Map(pid -> {nm, sT})
for (const r of rows) {
  if (r.un || r.g !== 's6') continue;
  const k = r.id + ':' + r.tm; let m = need.get(k); if (!m) need.set(k, (m = new Map()));
  m.set(r.pid, { nm: r.nm, sT: r.sT, mpg: r.mpg });
}
const out = {};
let nTG = 0, noHist = 0;
for (const [k, players] of need) {
  const [idS, tm] = k.split(':'); const id = +idS; const it = byId.get(id); if (!it) continue;
  const date = it.g.date;
  const list = teamGames[tm] || [];
  const hist = []; // most recent first
  for (let i = list.length - 1; i >= 0 && hist.length < 8; i--) { const h = list[i]; if (!(h.g.date < date)) continue; if (days(h.g.date, date) > 21) break; hist.push(h); }
  nTG++; if (hist.length < 2) noHist++;
  const nT = hist.length;
  // tonight's rows for this team, by pid and by name
  const ton = {}; const tonByName = {};
  for (const [pid, a] of Object.entries(it.log.rows)) if (a.team === tm) { ton[pid] = a; tonByName[norm(a.name)] = a; }
  // per player history
  const feats = new Map();
  for (const [pid, info] of players) {
    const nk = norm(info.nm);
    const hs = []; // his rows in history games (played)
    for (const h of hist) {
      let a = h.log.rows[pid];
      if (!a || a.team !== tm) { a = null; for (const b of Object.values(h.log.rows)) if (b.team === tm && norm(b.name) === nk) { a = b; break; } }
      if (a && a.min > 0 && Array.isArray(a.st) && a.st.length) hs.push(a);
    }
    const nP = hs.length;
    const ci = hs.map((a) => a.st[0][0]);
    const started = hs.filter((a) => a.st[0][0] < 0.05);
    const f = { nT, nP, sT: info.sT, mpg: info.mpg };
    f.startShare = nP ? r2(started.length / nP) : null;
    f.ciMed = r2(med(ci)); f.ciMean = r2(mean(ci)); f.ciMin = nP ? r2(Math.min(...ci)) : null; f.ciMax = nP ? r2(Math.max(...ci)) : null;
    // bench-role check-in times only (games he did not start)
    const ciB = hs.filter((a) => a.st[0][0] >= 0.05).map((a) => a.st[0][0]);
    f.nB = ciB.length; f.ciBMed = r2(med(ciB)); f.ciBMax = ciB.length ? r2(Math.max(...ciB)) : null;
    for (const el of [6, 12]) {
      f['pIn' + el] = nP ? r2(ci.filter((t) => t <= el).length / nP) : null;          // of games he played: checked in by now
      f['pInT' + el] = nT ? r2(ci.filter((t) => t <= el).length / nT) : null;         // of team games: checked in by now
      f['pInB' + el] = ciB.length ? r2(ciB.filter((t) => t <= el).length / ciB.length) : null; // of games he came off the bench
      f['pOn' + el] = nP ? r2(hs.filter((a) => onAt(a.st, el - 0.001)).length / nP) : null; // on the floor at this minute
      f['pOnS' + el] = started.length ? r2(started.filter((a) => onAt(a.st, el - 0.001)).length / started.length) : null; // same, games he started
      f['exp' + el] = nP ? r2(mean(hs.map((a) => onBetween(a.st, 0, el)))) : null;
      f['rem' + el] = nP ? r2(mean(hs.map((a) => onBetween(a.st, el, 48)))) : null;
      // conditional maps: his remaining minutes in games where he had / had not checked in by now, was / was not on the floor now
      const inBy = hs.filter((a) => a.st[0][0] <= el), notIn = hs.filter((a) => a.st[0][0] > el);
      f['remNotIn' + el] = notIn.length ? r2(mean(notIn.map((a) => onBetween(a.st, el, 48)))) : null; f['nNotIn' + el] = notIn.length;
      const onG = hs.filter((a) => onAt(a.st, el - 0.001)), offG = hs.filter((a) => !onAt(a.st, el - 0.001) && a.st[0][0] <= el);
      f['remOn' + el] = onG.length ? r2(mean(onG.map((a) => onBetween(a.st, el, 48)))) : null;
      f['remOff' + el] = offG.length ? r2(mean(offG.map((a) => onBetween(a.st, el, 48)))) : null;
    }
    f.out1Med = started.length ? r2(med(started.map((a) => a.st[0][1]))) : null; // usual first sub-out when he starts
    f.minP = nP ? r2(mean(hs.map((a) => a.min))) : null;
    // games (most recent first) played flags, e.g. "11010110"
    f.lastPlayed = hist.map((h) => { let a = h.log.rows[pid]; if (!a || a.team !== tm) { a = null; for (const b of Object.values(h.log.rows)) if (b.team === tm && norm(b.name) === nk) { a = b; break; } } return a && a.min > 0 ? 1 : 0; }).join('');
    // tonight, cut at 6 and 12
    const a = ton[pid] || tonByName[nk];
    const st = a && Array.isArray(a.st) ? a.st : [];
    for (const el of [6, 12]) {
      const cut = st.filter(([i]) => i < el).map(([i, o]) => [i, Math.min(o, el)]);
      f['tIn' + el] = cut.length ? r2(cut[0][0]) : null;                 // tonight's first check-in, if before now
      f['tOut' + el] = cut.length && cut[0][1] < el ? r2(cut[0][1]) : null; // tonight's first sub-out, if before now
      f['tOn' + el] = cut.length && cut[cut.length - 1][1] >= el ? 1 : 0;
      f['tMin' + el] = r2(cut.reduce((s, [i, o]) => s + o - i, 0));
      f['tPf' + el] = a && Array.isArray(a.pfAt) ? a.pfAt.filter((t) => t < el).length : 0;
      f['tPfLast' + el] = a && Array.isArray(a.pfAt) && a.pfAt.filter((t) => t < el).length ? r2(Math.max(...a.pfAt.filter((t) => t < el))) : null;
    }
    feats.set(pid, f);
  }
  // team-level tonight: bench players in by el, order of usual check-in
  const bench = [...feats.entries()].filter(([, f]) => f.sT === 0);
  const starters = [...feats.entries()].filter(([, f]) => f.sT === 1);
  for (const el of [6, 12]) {
    const inNow = bench.filter(([, f]) => f['tIn' + el] != null);
    const nIn = inNow.length;
    const firstSub = inNow.length ? Math.min(...inNow.map(([, f]) => f['tIn' + el])) : null;
    const stPf2 = starters.filter(([, f]) => f['tPf' + el] >= 2).length;
    const stOff = starters.filter(([, f]) => !f['tOn' + el]).length;
    // usual order off the bench: rank by usual bench check-in (median), among tonight's bench players with history
    const order = bench.filter(([, f]) => f.ciBMed != null || f.ciMed != null).map(([pid, f]) => [pid, f.ciBMed != null ? f.ciBMed : f.ciMed + 48 * 0]).sort((x, y) => x[1] - y[1]);
    const rank = new Map(order.map(([pid], i) => [pid, i + 1]));
    for (const [pid, f] of feats) {
      f['nBenchIn' + el] = nIn; f['firstSub' + el] = r2(firstSub); f['stPf2_' + el] = stPf2; f['stOff' + el] = stOff;
      if (f.sT === 0) {
        f.rankB = rank.get(pid) || null;
        const my = f.ciBMed != null ? f.ciBMed : f.ciMed;
        // passed over: bench mates who usually come in at least 1.5 min later than him and are already in, while he is not
        f['passed' + el] = my != null && f['tIn' + el] == null ? inNow.filter(([q, g]) => q !== pid && (g.ciBMed != null ? g.ciBMed : g.ciMed) != null && (g.ciBMed != null ? g.ciBMed : g.ciMed) >= my + 1.5).length : 0;
        // not yet due: bench mates who usually come in before him and are not in yet either
        f['ahead' + el] = my != null ? bench.filter(([q, g]) => q !== pid && g['tIn' + el] == null && (g.ciBMed != null ? g.ciBMed : g.ciMed) != null && (g.ciBMed != null ? g.ciBMed : g.ciMed) < my - 0.5 && g.nP / Math.max(g.nT, 1) >= 0.5).length : 0;
      }
    }
  }
  for (const [pid, f] of feats) out[id + ':' + pid] = f;
}
L.writeJSON(`${L.ROOT}/data/research/early-feat-${season}.json.gz`, out);
console.log(`season ${season}: ${nTG} team-games, ${noHist} with fewer than 2 history games, ${Object.keys(out).length} player-games written`);
