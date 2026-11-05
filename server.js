const fs = require('fs');
const path = require('path');
const express = require('express');
const routes = require('./src/routes');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', routes);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GG Winner http://0.0.0.0:${PORT} (store: ${require('./src/store').backend()})`);
  startCollector();
});

/**
 * On a VPS / Docker the server runs the collector itself (no platform cron needed):
 * tracks every FanDuel eBasketball game, grades calls, refreshes ratings.
 * COLLECT_EVERY_SEC (default 120) sets the pace; COLLECTOR_ENABLED=0 turns it off.
 */
function startCollector() {
  if (process.env.COLLECTOR_ENABLED === '0' || process.env.NODE_ENV === 'test') return;
  const every = Math.max(30, Number(process.env.COLLECT_EVERY_SEC) || 120) * 1000;
  const tracker = require('./src/ebTracker');
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await tracker.collect();
      console.log(`[collector] board ${r.board} graded ${r.graded} rebuilt ${r.rebuilt}${r.errors.length ? ` errors ${r.errors.length}` : ''}`);
    } catch (err) {
      console.log(`[collector] failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  setTimeout(run, 15 * 1000);
  setInterval(run, every);
  console.log(`[collector] every ${every / 1000}s`);
}
