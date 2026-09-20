#!/usr/bin/env node
/**
 * Probe ESPN Site API basketball slugs and write docs/feeds.md
 */
const fs = require('fs');
const path = require('path');

const SLUGS = [
  'nba', 'wnba', 'nbl', 'mens-college-basketball', 'womens-college-basketball',
  'fiba', 'euroleague', 'nba-development', 'acb', 'bbl', 'lkl', 'lnbp',
  'champions-league', 'fiba-champions-league', 'eurocup', 'mens-olympics-basketball',
];

async function probe(slug) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${slug}/scoreboard`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch {
      return { slug, status: r.status, ok: false };
    }
    return {
      slug,
      status: r.status,
      league: data.leagues?.[0]?.name || null,
      events: (data.events || []).length,
      samples: (data.events || []).slice(0, 3).map((e) => e.shortName),
    };
  } catch (e) {
    return { slug, error: e.message };
  }
}

(async () => {
  const rows = [];
  for (const s of SLUGS) rows.push(await probe(s));
  const md = [];
  md.push('# Feed probe');
  md.push('');
  md.push(`Probed ESPN Site API on ${new Date().toISOString().slice(0, 10)}.`);
  md.push('');
  md.push('| Slug | HTTP | League | Events | Samples |');
  md.push('|---|---|---|---|---|');
  for (const r of rows) {
    md.push(`| \`${r.slug}\` | ${r.status || r.error} | ${r.league || '—'} | ${r.events ?? '—'} | ${(r.samples || []).join(', ') || '—'} |`);
  }
  md.push('');
  md.push('## Interpretation');
  md.push('');
  md.push('- **Works for FanDuel boards:** `nba`, `wnba`, `nbl`, `mens-college-basketball`.');
  md.push('- **Euroleague slug exists** but is often empty; use `api-live.euroleague.net` instead.');
  md.push('- **Does not exist on ESPN (HTTP 400):** German BBL, LKL, LNBP, FIBA Champions League. Use API-Basketball with `API_BASKETBALL_KEY`.');
  md.push('- ESPN `fiba` is **World Cup**, not Basketball Champions League.');
  const out = path.join(__dirname, '..', 'docs', 'feeds.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md.join('\n') + '\n');
  console.log(md.join('\n'));
  console.log('\nWrote', out);
})();
