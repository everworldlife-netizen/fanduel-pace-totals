const express = require('express');
const router = express.Router();
const games = require('./games');
const apib = require('./feeds/apiBasketball');

router.get('/health', (req, res) => {
  res.json({ ok: true, apiBasketball: apib.enabled() });
});

router.get('/leagues', (req, res) => {
  res.json({
    leagues: games.coverage(),
    apiBasketballEnabled: apib.enabled(),
    notes: {
      espn: 'Primary free feed. Confirmed slugs: nba, wnba, nbl, mens-college-basketball, womens-college-basketball, fiba (World Cup), nba-development, euroleague (often empty). No BBL / LKL / BCL / LNBP.',
      euroleague: 'api-live.euroleague.net — free official EuroLeague + EuroCup scoreboard and box stats.',
      apiBasketball: 'Optional. Set API_BASKETBALL_KEY for German BBL, LKL, FIBA Champions League, LNBP. Cached ≥5 min.',
    },
  });
});

router.get('/games', async (req, res) => {
  try {
    const data = await games.listGames();
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('games list', err);
    res.status(502).json({ error: 'Unable to load scoreboards', details: err.message });
  }
});

router.get('/games/:id', async (req, res) => {
  try {
    const data = await games.getGame(req.params.id);
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (err) {
    const status = err.code === 'VIRTUAL' ? 400 : 502;
    res.status(status).json({ error: err.message });
  }
});

router.post('/evaluate', async (req, res) => {
  try {
    const { gameId, lines } = req.body || {};
    if (!gameId) return res.status(400).json({ error: 'gameId is required' });
    if (!lines || lines.gameTotal == null || lines.gameTotal === '') {
      return res.status(400).json({ error: 'Paste a FanDuel game total. This app never invents lines.' });
    }
    const data = await games.evaluateGame(gameId, lines);
    res.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
