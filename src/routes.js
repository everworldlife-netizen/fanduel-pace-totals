const express = require('express');
const api = require('./api');

const router = express.Router();

router.all('*', async (req, res) => {
  const out = await api.handle({
    method: req.method,
    path: req.path,
    query: req.query || {},
    body: req.body || null,
  });
  res.set('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
});

module.exports = router;
