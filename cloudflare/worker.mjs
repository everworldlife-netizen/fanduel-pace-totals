// GG Winner on Cloudflare Workers: static app from ./public (Workers static assets),
// /api/* served by the shared router, state in Workers KV, collector on a cron trigger.
import storeModule from '../src/store.js';
import apiModule from '../src/api.js';
import trackerModule from '../src/ebTracker.js';
import docStoreModule from '../src/docStore.js';

const PASS_ENV = ['FANDUEL_REGION', 'API_BASKETBALL_KEY', 'COLLECTOR_ENABLED'];
let ready = false;

function setup(env) {
  if (ready) return;
  ready = true;
  if (globalThis.process && process.env) {
    for (const k of PASS_ENV) if (typeof env[k] === 'string') process.env[k] = env[k];
  }
  if (env.GG_STORE) {
    const kv = env.GG_STORE;
    storeModule.useBackend(
      docStoreModule.createDocStore({ get: (k) => kv.get(k), put: (k, v) => kv.put(k, v) }, { name: 'cloudflare-kv' }),
    );
  }
}

async function runCollector({ force = false } = {}) {
  const t0 = Date.now();
  const report = await trackerModule.collect();
  await storeModule.setJSON('track/_meta', {
    lastRunAt: new Date().toISOString(),
    ms: Date.now() - t0,
    board: report.board,
    graded: report.graded,
    rebuilt: report.rebuilt,
    errors: (report.errors || []).slice(0, 5),
  });
  const flush = await storeModule.flush({ force });
  return { ...report, flush };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    setup(env);
    if (url.pathname === '/api/admin/collect') {
      if (!env.COLLECT_KEY || url.searchParams.get('key') !== env.COLLECT_KEY) return json(403, { error: 'forbidden' });
      return json(200, await runCollector({ force: true }));
    }
    let body = null;
    if (request.method === 'POST') {
      try {
        body = await request.json();
      } catch {
        body = null;
      }
    }
    const out = await apiModule.handle({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    });
    return json(out.status, out.body);
  },

  async scheduled(controller, env, ctx) {
    setup(env);
    if (env.COLLECTOR_ENABLED === '0') return;
    ctx.waitUntil(
      runCollector().then(
        (r) => console.log(JSON.stringify(r)),
        (err) => console.log(`collector failed: ${err.stack || err.message}`),
      ),
    );
  },
};
