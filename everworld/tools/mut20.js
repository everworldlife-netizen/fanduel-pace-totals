#!/usr/bin/env node
/* Broken copies of the version 20 build (the books' line inside the number): each change must make a test fail.
 *   node tools/mut20.js engine|app [part of a name]
 * Each copy of cs/build goes to a temporary folder, gets one change, and runs the engine suite (all of it) or the app
 * checks named in the entry (ONLY). Prints CAUGHT or MISSED per change. Engine: about 5 minutes; app: about 12. */
const fs = require('fs'), path = require('path'), { spawnSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), S = path.join(require('os').tmpdir(), 'mut20');
const ENGINE = [
  ['age ignored once the game is on', 'engine.js', "const w = lineW[k] * lineFade * lineAge(c.toTip != null ? lineLeadOf(c.toTip) : lineLead) * clamp((rem - 0.25) / 0.5, 0, 1);", "const w = lineW[k] * lineFade * (st.phase === 'pre' ? lineAge(c.toTip != null ? lineLeadOf(c.toTip) : lineLead) : 1) * clamp((rem - 0.25) / 0.5, 0, 1);"],
  ['a look of unknown age counts as fresh', 'engine.js', "? clamp((TUNE.lineFar - Math.max(lead, 0)) / Math.max(TUNE.lineFar - TUNE.lineNear, 1), 0, 1) : 0);", "? clamp((TUNE.lineFar - Math.max(lead, 0)) / Math.max(TUNE.lineFar - TUNE.lineNear, 1), 0, 1) : 1);"],
  ['whole counts multiplied instead of a change of rate', 'engine.js', "rescaleRate(a, base, kf, mulberry32(((o.seed || st.id || 7) ^ Math.imul(+r.pid | 0, 0x9e3779b1) ^ Math.imul(k.charCodeAt(0) + k.length, 0x85ebca6b)) >>> 0));", "{ let carry = 0; for (let i = 0; i < N; i++) { const x = (a[i] - base) * kf + carry, y = Math.max(0, Math.round(x)); carry = x - y; a[i] = base + y; } }"],
  ['the sheet is handed a target, not the number', 'engine.js', "for (const k of Object.keys(lineIn)) lineIn[k].to = +shown[k].toFixed(2);", "for (const k of Object.keys(lineIn)) lineIn[k].to = +(lineIn[k].from + lineIn[k].share * (lineIn[k].now - lineIn[k].from) + 0.3).toFixed(2);"],
  ['explanations read the number with the line inside', 'engine.js', "b2b: b2b[p.tm], proj: own, now: r,", "b2b: b2b[p.tm], proj: shown, now: r,"],
  ['usage shift reads the number with the line inside', 'engine.js', "const remPts = own.pts - r.pts", "const remPts = shown.pts - r.pts"],
  ['reasons say "his projection" with the line inside', 'engine.js', "const own1 = Object.values(lineIn).some((x) => Math.abs(x.to - x.from) >= 0.05) ? ownWords : (x) => x;", "const own1 = (x) => x;"],
  ['every player gets the app\'s-own wording', 'engine.js', "const own1 = Object.values(lineIn).some((x) => Math.abs(x.to - x.from) >= 0.05) ? ownWords : (x) => x;", "const own1 = ownWords;"],
  ['a held change is not marked', 'engine.js', "...(kf !== kfAsked ? { held: true } : {})", "...(false ? { held: true } : {})"],
  ['an ordinary change is marked as held', 'engine.js', "...(kf !== kfAsked ? { held: true } : {})", "...(true ? { held: true } : {})"],
  ['the LEARNED chip keeps the app\'s own points beside a lined number', 'engine.js', "if (typeof y.chip === 'string' && /^LEARNED .* PTS$/.test(y.chip)) y.chip = 'LEARNED';", ""],
  ['the per-minute sentence is not reworded', 'engine.js', ".replace(/ast for him\\./g, 'ast in the app\\'s own number.')", ""],
  ['a kept line with a blank age counts as fresh', 'engine.js', "lineAge(c.toTip != null ? lineLeadOf(c.toTip) : lineLead)", "lineAge(c.toTip != null ? +c.toTip : lineLead)"],
  ['one book is enough', 'engine.js', "if (!((c.n != null ? +c.n : +c.books || 1) >= TUNE.lineMinBooks)) continue; // one book alone can be a slip or another market", ""],
  ['first-quarter rows stay in the middle line', 'engine.js', "xs = xs.filter((x) => { const l = parseFloat(x.line_value); return !(top >= 3 && l < 0.5 * top) && !(q1 > 0 && l <= q1 + 0.5 && top > q1 + 0.5); });", ""],
  ['the share fades over 48 minutes', 'engine.js', "TUNE.lineLive > 0 && st.period <= 4 ? clamp(1 - el / TUNE.lineLive, 0, 1) : 0;", "TUNE.lineLive > 0 && st.period <= 4 ? clamp(1 - el / 48, 0, 1) : 0;"],
  ['the factor is not held', 'engine.js', "kf = clamp(kfAsked, 0.5, 2);", "kf = Math.max(0, kfAsked);"],
  ['a line\'s own age is ignored', 'engine.js', "lineAge(c.toTip != null ? lineLeadOf(c.toTip) : lineLead)", "lineAge(lineLead)"],
  ['no taper where next to nothing is to come', 'engine.js', " * clamp((rem - 0.25) / 0.5, 0, 1);\nif (!(w >= 0.02)) continue;", ";\nif (!(w >= 0.02)) continue;"],
  ['a share too small to print is used', 'engine.js', "if (!(w >= 0.02)) continue;", "if (!(w > 0)) continue;"],
  ['an absurd line is read', 'engine.js', "if (!c || typeof c !== 'object' || !(+c.line > 0) || !(+c.line < 100)) continue;", "if (!c || typeof c !== 'object' || !(+c.line > 0)) continue;"],
  ['extra units only go to nights that already had some', 'engine.js', "rho = v > m ? (v - m) / v : 0;", "rho = 1;"],
  ['books counted at the middle line only', 'engine.js', "n: new Set(xs.map((x) => x.vendor || '?')).size", "n: at.length"],
  ['thinning keeps too many', 'engine.js', "let need = Math.round(kf * T), seen = T;", "let need = Math.round(kf * T) + 3, seen = T;"],
];
const APP = [
  ['kept lines read by the day on screen', 'app.js', "const rec = plRead(gameDay(g))[g.id];", "const rec = plRead(state.date)[g.id];", "whatever day is on screen"],
  ['a shorter look wipes the others', 'app.js', "const P = plRead(day, true), m = { ...((P[g.id] && P[g.id].m) || {}) };", "const P = plRead(day, true), m = {};", "the kept look"],
  ['a look is kept after the scheduled tip', 'app.js', " || now > tip + 10 * 60000) return;", ") return;", "no look is kept"],
  ['a look is kept from a saved board', 'app.js', " || DB.slateSource() === 'saved' || now > tip", " || now > tip", "no look is kept"],
  ['the phone\'s own clock is believed', 'app.js', "if (clockOff == null) { clockSync(); return; }\nconst now = Date.now() + clockOff;\n// no look once", "const now = Date.now() + (clockOff || 0);\n// no look once", "no look is kept"],
  ['the age goes by now, not by when the line was seen', 'app.js', "toTip: (tip - +v[3]) / 60000 };", "toTip: (tip - (Date.now() + (clockOff || 0))) / 60000 };", "the kept look"],
  ['the memory of this copy is written over the phone', 'app.js', "const P = plRead(day, true), m = ", "const P = plRead(day), m = ", "the kept look"],
  ['memory is dropped when the phone is read again', 'app.js', "const P = plMerge(plCache.get(day), disk);", "const P = plMerge(null, disk);", "refuses to store"],
  ['every projection waits for the clock', 'app.js', "function clockFirst() { if (!clockOnce) clockOnce = Promise.race([clockSync(), new Promise((r) => setTimeout(r, 2500))]); return clockOnce; }", "function clockFirst() { return Promise.race([clockSync(), new Promise((r) => setTimeout(r, 2500))]); }", "never answers"],
  ['kept lines are cleared after two days', 'data.js', "if (m[1] < addDays(today, -5)) localStorage.removeItem(k); }", "if (m[1] < addDays(today, -2)) localStorage.removeItem(k); }", "dated keys"],
  ['a step is not explained', 'app.js', " : x.to < 4 ? ' (A number this small moves in steps.)' : ''", " : x.to < 0 ? ' (A number this small moves in steps.)' : ''", "sheet's rows"],
  ['a big number gets the small-number excuse', 'app.js', " : x.to < 4 ? ' (A number this small moves in steps.)' : ''", " : true ? ' (A number this small moves in steps.)' : ''", "sheet's rows"],
  ['a held change is not explained', 'app.js', "x.held ? ' (A line this far", "false ? ' (A line this far", "sheet's rows"],
  ['"so" is printed where the plain sum does not give the number', 'app.js', "${plainSum ? ', so' : ';'} the number shown", "${true ? ', so' : ';'} the number shown", "sheet's rows"],
  ['a late clock does not make the cards again', 'app.js', "state.proj.forEach((x) => { if (x && x.noClock) x.redo = true; });", "", "never answers"],
  ['the note prints the threes share whatever the settings', 'app.js', "['threes', T.lineW3]]) if (w > 0) {", "['threes', 0.45]]) if (w > 0) {", "sheet's rows"],
  ['the Scorers screen speaks of the line while it is off', 'app.js', "${E.TUNE.lineWPts > 0 ? '; in the last hours", "${true ? '; in the last hours", "as shipped"],
  ['the accuracy replay gets no lines (worker)', 'worker.js', "...(j.lines ? { lines: j.lines } : {}) }), j.rows, acc);", "}), j.rows, acc);", "own accuracy table grades"],
  ['the lessons learn from the number with the line inside', 'worker.js', "const P = Engine.projectGame({ ...base, patterns: Engine.patMinOnly(payload.patterns || Engine.patBeta(null)) });", "const P = Engine.projectGame({ ...base, ...(j.lines ? { lines: j.lines } : {}), patterns: Engine.patMinOnly(payload.patterns || Engine.patBeta(null)) });", "own accuracy table grades"],
  ['the replay job carries no lines (app)', 'app.js', "avail: av, lines: kept, cps:", "avail: av, cps:", "own accuracy table grades"],
  ['the Edges sentence shows at any share', 'app.js', "q.lineIn.pts.share >= 0.5", "q.lineIn.pts.share >= 0", "switched on"],
  ['unmoved rows are printed', 'app.js', " && Math.round(x.share * 100) >= 1 && Math.abs(x.to - x.from) >= 0.05;", ";", "sheet's rows"],
  ['the live row reads like the pre-game one', 'app.js', "${pre ? `the books' line is <b>${x.line}</b>` : `at the pace", "${true ? `the books' line is <b>${x.line}</b>` : `at the pace", "during a game"],
  ['junk kept lines are read', 'app.js', "const plRowOk = (v) => Array.isArray(v) && +v[0] > 0 && +v[0] < 100 && Number.isFinite(+v[3]) && +v[3] > 0;", "const plRowOk = (v) => Array.isArray(v) && +v[0] > 0;", "no look is kept"],
  ['the first projection does not wait for the clock', 'app.js', "if (s.phase === 'pre' && clockOff == null) { try { await clockFirst(); } catch { /* no clock: no look is kept this time */ } }", "", "switched on"],
  ['old pl: keys are never cleared', 'data.js', "if (m[1] < addDays(today, -5)) localStorage.removeItem(k); }", "}", "dated keys"],
];
const which = process.argv[2], filt = process.argv[3] || '';
const list = (which === 'engine' ? ENGINE : APP).filter((m) => m[0].includes(filt));
const runOne = (m, i) => new Promise((res) => {
  const dir = path.join(S, 'mut', `${which}-${i}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  spawnSync('cp', ['-r', path.join(ROOT, 'cs/build') + '/.', dir]);
  const f = path.join(dir, m[1]); const src = fs.readFileSync(f, 'utf8');
  const n = src.split(m[2]).length - 1;
  if (n !== 1) return res(`?? ${m[0]}: the text to change occurs ${n} times`);
  fs.writeFileSync(f, src.replace(m[2], m[3]));
  const env = { ...process.env, CS_BUILD: dir }; if (m[4]) env.ONLY = m[4];
  const c = spawn('node', [path.join(ROOT, 'cs/tests', which === 'engine' ? 'engine.test.js' : 'app.test.js')], { env });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  const t = setTimeout(() => c.kill(), 840000);
  c.on('exit', (code) => { clearTimeout(t); const fails = (out.match(/^FAIL  .*$/gm) || []).map((x) => x.slice(6, 86)); const oks = (out.match(/^  ok/gm) || []).length; res(`${code ? 'CAUGHT ' : 'MISSED '} ${m[0]}  →  ${fails.length} failed, ${oks} ok${fails.length ? ': ' + fails.slice(0, 2).join(' | ') : ''}${!code && !oks ? ' (no test ran!)' : ''}`); });
});
(async () => { const W = which === 'engine' ? 3 : 2; let i = 0; const out = []; await Promise.all(Array.from({ length: W }, async () => { while (i < list.length) { const k = i++; const r = await runOne(list[k], k); out[k] = r; console.log(r); } })); console.log(`\n${out.filter((x) => x.startsWith('CAUGHT')).length} of ${list.length} caught`); })();
