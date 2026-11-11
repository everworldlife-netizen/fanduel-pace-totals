/* Runs projections off the UI thread. */
importScripts('engine.js');
try { importScripts('sitprior.js'); } catch (e) { /* season prior is optional */ }

const STATS = ['pts', 'reb', 'ast', 'fg3m', 'pra'];

self.onmessage = (ev) => {
const { id, payload } = ev.data;
try {
if (payload.grade) {
// nightly learning: project finished games at each checkpoint with the plain model and grade them
const acc = Engine.patEmpty();
let games = 0;
for (const j of payload.grade) {
for (const cp of j.cps) {
// minutes are graded first; the stats and the chances are graded on top of the learned minutes, as they are used live
// (payload.priors and payload.teams are the tables as the app had them BEFORE this game: see snapFor in app.js)
const base = { game: cp.game, plays: cp.plays, logs: j.logs, priors: payload.priors, injuries: [], nsims: payload.nsims || 300, seed: cp.game.id, overrides: { in: [], out: [] }, teams: payload.teams || null,
// the lineup that was posted for this game (active list and starters), same as the live app had from tip-off on
avail: j.avail || null,
// the game's pregame line as the phone saved it: the top-down team check learns from the same input it uses live (no line saved → that input sits out)
market: j.market || null, tdOff: !j.market };
const P = Engine.projectGame({ ...base, patterns: Engine.patMinOnly(payload.patterns || Engine.patBeta(null)) });
Engine.patGrade(P, j.rows, acc);
// how the full app (everything it has learned so far) did on this game: the running accuracy report
if (payload.patterns) Engine.patScore(Engine.projectGame({ ...base, patterns: payload.patterns }), j.rows, acc);
}
games++;
}
self.postMessage({ id, ok: true, acc, games });
return;
}
const proj = Engine.projectGame(payload);
const lines = Engine.consensusLines(payload.props || []);
const picks = Engine.picksForGame(proj, lines, { minP: payload.minP });
// attach book lines + model chance to each player, then drop the raw simulations
for (const p of proj.players) {
p.market = {};
for (const s of STATS) {
const L = lines[p.pid + ':' + s];
if (L) p.market[s] = { line: L.line, book: L.fairOver, model: Engine.calProb(p, s, Engine.probOver(p._sims[s], L.line)), books: L.books };
}
delete p._sims; delete p.laddersRaw;
}
self.postMessage({ id, ok: true, proj, picks });
} catch (err) {
self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
}
};
