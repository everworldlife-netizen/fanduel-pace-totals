/* Runs projections off the UI thread. */
importScripts('engine.js');

const STATS = ['pts', 'reb', 'ast', 'fg3m', 'pra'];

self.onmessage = (ev) => {
  const { id, payload } = ev.data;
  try {
    const proj = Engine.projectGame(payload);
    const lines = Engine.consensusLines(payload.props || []);
    const picks = Engine.picksForGame(proj, lines, { minP: payload.minP });
    // attach book lines + model chance to each player, then drop the raw simulations
    for (const p of proj.players) {
      p.market = {};
      for (const s of STATS) {
        const L = lines[p.pid + ':' + s];
        if (L) p.market[s] = { line: L.line, book: L.fairOver, model: Engine.probOver(p._sims[s], L.line), books: L.books };
      }
      delete p._sims;
    }
    self.postMessage({ id, ok: true, proj, picks });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
