#!/usr/bin/env node
/* Who really played, against what was known before the tip (recorded by tools/proprec.js and tools/appsnap.js).
 *   node tools/availgrade.js [--date YYYY-MM-DD ...] [--min 15] [--quiet]
 * Needs the finished games' play-by-play on disk (node tools/fetch.js <date> <date>). For every finished game of the date:
 *   A. ESPN's injury list as it stood at the last snapshot before the tip: the status field the app reads today, and the
 *      wording of the note it does not read ("listed as doubtful", "ruled out for Friday's game"), against who played.
 *   B. The app's own rows at its last capture before the tip: players it gave minutes who never played, players who played
 *      and were not shown.
 *   C. The books' player lines as a who-plays signal: a rotation player with no line anywhere close to the tip.
 * Several --date add up (the tallies are what count: one night is a handful of cases).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const E = require(path.join(L.ROOT, 'cs/build/engine.js'));
const argv = process.argv.slice(2);
const dates = argv.map((a, i) => (a === '--date' ? argv[i + 1] : null)).filter(Boolean);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MINP = +arg('--min', 15), QUIET = argv.includes('--quiet');
if (!dates.length) { const d = new Date(Date.now() - 30 * 3600000); dates.push(d.toISOString().slice(0, 10)); }
const norm = E.norm;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const etDay = (ms) => DAYS[new Date(ms - 5 * 3600000).getUTCDay()]; // Eastern standard time is close enough for a weekday

/**
 * What a beat note says about tonight: 'out' | 'doubtful' | 'questionable' | 'probable' | 'in' | null.
 * The same function is meant for the app, so it only reads plain wording and takes the LAST verdict in the note
 * ("was questionable but has been ruled out").
 */
function noteVerdict(note) {
  const s = String(note || '');
  const rules = [
    ['out', /\b(ruled out|is out\b|listed as out|will not play|won't play|will not return|won't return|will miss|will be sidelined|will sit out|is sitting out|will not suit up|won't suit up|out for (the )?(season|remainder)|is not expected to play|not with the team|downgraded to out|has been shut down)/gi],
    ['doubtful', /\b(listed as doubtful|is doubtful|doubtful (for|to play)|downgraded to doubtful)/gi],
    ['questionable', /\b(listed as questionable|is questionable|questionable (for|to play)|game-time (decision|call)|upgraded to questionable|downgraded to questionable)/gi],
    ['probable', /\b(listed as probable|is probable|probable (for|to play)|upgraded to probable)/gi],
    ['in', /\b(is available|will be available|listed as available|will play\b|will start\b|will return (for|on|to action|against|Mon|Tue|Wed|Thu|Fri|Sat|Sun)|has been cleared|is off the injury report|not on the injury report|is good to go|will suit up|upgraded to available|is active)/gi],
  ];
  let best = null, at = -1;
  for (const [k, re] of rules) { let m; while ((m = re.exec(s))) if (m.index > at) { at = m.index; best = k; } }
  return best;
}
/** Is the note about this game? It names the game's weekday (or "tonight"), and it is not older than the day before. */
function noteIsForGame(row, tipMs) {
  const s = String(row.note || '');
  const age = row.date ? (tipMs - Date.parse(row.date)) / 3600000 : Infinity;
  if (!(age < 36)) return false;
  const other = DAYS.filter((d) => d !== etDay(tipMs)).some((d) => new RegExp(`\\b${d}\\b`).test(s));
  if (new RegExp(`\\b${etDay(tipMs)}\\b`).test(s) || /\btonight\b/i.test(s)) return true;
  return !other && age < 14; // no weekday at all, written the day of the game
}
module.exports = { noteVerdict, noteIsForGame };
if (require.main !== module) return;

const T = { bucket: {}, status: {}, note: {}, ghosts: [], missing: [], line: { yes: [0, 0], no: [0, 0] }, lineBy: {}, games: 0, noTruth: 0 };
const add = (o, k, played) => { const r = (o[k] = o[k] || [0, 0, []]); r[played ? 0 : 1]++; return r; };
for (const date of dates) {
  const dir = path.join(L.DATA, 'props', date);
  if (!fs.existsSync(dir)) { console.log(`${date}: nothing recorded`); continue; }
  const files = fs.readdirSync(dir);
  const snaps = (prefix) => files.filter((f) => f.startsWith(prefix)).map((f) => L.readJSON(path.join(dir, f))).filter((s) => s && s.at).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const slates = snaps('slate-'), inj = snaps('espn-injuries-'), apps = snaps('app-');
  if (!slates.length) continue;
  const games = slates[slates.length - 1].games || [];
  for (const g0 of games) {
    const pp = path.join(L.DATA, 'plays', `${g0.id}.json.gz`);
    const v = g0.visitor_team.abbreviation, h = g0.home_team.abbreviation, tip = Date.parse(g0.datetime);
    if (!L.exists(pp)) { T.noTruth++; if (!QUIET) console.log(`\n${v} at ${h}: not finished or not fetched yet`); continue; }
    T.games++;
    const log = E.logEntry({ ...g0, status_state: 'final' }, L.readJSON(pp));
    const mins = new Map(); // normalized name -> minutes played
    for (const r of Object.values(log.rows)) if (r.team === v || r.team === h) mins.set(`${r.team}:${norm(r.name)}`, r.min || 0);
    const playedMin = (tm, nm) => mins.get(`${tm}:${norm(nm)}`) || 0;
    const full = { [g0.visitor_team.full_name]: v, [g0.home_team.full_name]: h };
    const before = (list) => { const b = list.filter((s) => Date.parse(s.at) < tip); return b.length ? b[b.length - 1] : null; };
    if (!QUIET) console.log(`\n${v} at ${h} (tip ${new Date(tip).toISOString().slice(11, 16)} UTC, ${etDay(tip)})`);

    // A. the injury list
    const I = before(inj), listed = new Map();
    if (I) {
      for (const r of I.rows) {
        const tm = full[r.team]; if (!tm) continue;
        const forGame = noteIsForGame(r, tip), verdict = forGame ? noteVerdict(r.note) : null;
        const m = playedMin(tm, r.name), played = m > 0;
        const st = /^out/i.test(r.status) || /suspend/i.test(r.status) ? 'Out' : r.status;
        listed.set(`${tm}:${norm(r.name)}`, { st, verdict });
        add(T.status, st, played);
        add(T.note, `${st} | note: ${verdict || (forGame ? 'no verdict' : 'not about this game')}`, played)[2].push(`${r.name} ${tm} ${played ? Math.round(m) + "'" : 'DNP'}`);
        if (!QUIET && (st !== 'Out' || played)) console.log(`  report ${Math.round((tip - Date.parse(I.at)) / 60000)} min before: ${r.name} (${tm}) ${r.status}, note says ${verdict || '—'}${forGame ? '' : ' (older note)'} → ${played ? 'played ' + Math.round(m) + "'" : 'did not play'}`);
      }
    }

    // B. the app's rows, C. the lines
    const A = before(apps);
    const lineSnaps = files.map((f) => /^(\d+)-(\d{4})\.json\.gz$/.exec(f)).filter((m) => m && +m[1] === g0.id).map((m) => L.readJSON(path.join(dir, m[0]))).filter((s) => s && Date.parse(s.at) < tip && Array.isArray(s.rows) && s.rows.length).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const C = lineSnaps.length ? E.consensusLines(lineSnaps[lineSnaps.length - 1].rows) : null;
    const hasLine = (pid) => !!C && ['pts', 'reb', 'ast', 'fg3m'].some((k) => C[`${pid}:${k}`]);
    if (A) {
      const rows = A.rows.filter((r) => r.id === g0.id);
      const shown = new Set(rows.map((r) => `${r.tm}:${norm(r.nm)}`));
      for (const r of rows) {
        const m = playedMin(r.tm, r.nm), L0 = listed.get(`${r.tm}:${norm(r.nm)}`) || {};
        if (C && r.min >= 6) {
          const b = `${r.min < 12 ? 'app  6-11 min' : r.min < 18 ? 'app 12-17 min' : r.min < 24 ? 'app 18-23 min' : 'app 24+ min  '} | ${hasLine(r.pid) ? 'line   ' : 'no line'}`;
          const x = (T.bucket[b] = T.bucket[b] || { n: 0, played: 0, app: 0, real: 0 });
          x.n++; x.played += m > 0 ? 1 : 0; x.app += r.min; x.real += m;
        }
        if (C && r.min >= MINP) {
          T.line[hasLine(r.pid) ? 'yes' : 'no'][m > 0 ? 0 : 1]++;
          const k = `${hasLine(r.pid) ? 'line' : 'no line'} | ${L0.st ? 'on the report (' + L0.st + ')' : 'not on the report'}`;
          add(T.lineBy, k, m > 0)[2].push(`${r.nm} ${r.tm} app ${r.min}' → ${m > 0 ? Math.round(m) + "'" : 'DNP'}`);
        }
        if (r.min >= MINP && !(m > 0)) T.ghosts.push({ date, g: `${v}@${h}`, nm: r.nm, tm: r.tm, min: r.min, pts: r.pts, st: L0.st || null, verdict: L0.verdict || null, line: C ? hasLine(r.pid) : null });
      }
      for (const [k, m] of mins) if (m >= MINP && !shown.has(k)) T.missing.push({ date, g: `${v}@${h}`, who: k, min: Math.round(m), line: null });
      if (!QUIET) console.log(`  app ${Math.round((tip - Date.parse(A.at)) / 60000)} min before: ${rows.length} players shown; lines ${C ? Math.round((tip - Date.parse(lineSnaps[lineSnaps.length - 1].at)) / 60000) + ' min before' : 'none'}`);
    }
  }
}

const pct = (a, b) => (a + b ? Math.round((100 * a) / (a + b)) + '%' : '—');
console.log(`\n==== ${dates.join(', ')}: ${T.games} finished games graded${T.noTruth ? `, ${T.noTruth} not finished or not fetched` : ''} ====`);
console.log('\nA. ESPN\'s injury list before the tip, by the status field (what the app reads today)');
for (const [k, [p, n]] of Object.entries(T.status).sort()) console.log(`  ${k.padEnd(12)} ${String(p + n).padStart(3)} listed: played ${p}, did not play ${n} (played ${pct(p, n)})`);
console.log('\n   …and split by what the note says about this game (what the app does not read yet)');
for (const [k, [p, n, who]] of Object.entries(T.note).sort()) console.log(`  ${k.padEnd(44)} played ${p}, did not ${n}${k.startsWith('Out |') && !p ? '' : '   ' + who.join('; ')}`);
console.log(`\nB. Players the app gave ${MINP}+ minutes before the tip who never played: ${T.ghosts.length}`);
for (const x of T.ghosts) console.log(`  ${x.g} ${x.nm} (${x.tm}) app ${x.min}' ${x.pts} pts | report: ${x.st || 'not listed'}${x.verdict ? ', note says ' + x.verdict : ''} | books: ${x.line == null ? '?' : x.line ? 'had a line' : 'no line'}`);
console.log(`   Players who played ${MINP}+ minutes and were not shown by the app: ${T.missing.length}`);
for (const x of T.missing) console.log(`  ${x.g} ${x.who} ${x.min}'`);
console.log(`\nC. The books' lines as a who-plays signal (players the app gave ${MINP}+ minutes, lines at the last snapshot before the tip)`);
console.log(`  with a line:    played ${T.line.yes[0]}, did not play ${T.line.yes[1]} (played ${pct(...T.line.yes)})`);
console.log(`  with no line:   played ${T.line.no[0]}, did not play ${T.line.no[1]} (played ${pct(...T.line.no)})`);
for (const [k, [p, n, who]] of Object.entries(T.lineBy).sort()) console.log(`  ${k.padEnd(40)} played ${p}, did not ${n}${k.startsWith('line | not') ? '' : '   ' + who.join('; ')}`);
console.log('\n   By the minutes the app gave him (all players shown, line or not): how many played, and the minutes they really got');
for (const [k, x] of Object.entries(T.bucket).sort()) console.log(`  ${k}: ${String(x.n).padStart(3)} players, played ${String(x.played).padStart(3)} (${pct(x.played, x.n - x.played)}), app gave ${(x.app / x.n).toFixed(1)}' on average, they got ${(x.real / x.n).toFixed(1)}'`);
