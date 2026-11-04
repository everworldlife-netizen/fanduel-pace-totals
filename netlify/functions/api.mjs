import { getStore } from '@netlify/blobs';
import storeModule from '../../src/store.js';
import apiModule from '../../src/api.js';

let configured = false;

export default async (req) => {
  if (!configured) {
    storeModule.configure(getStore);
    configured = true;
  }
  const url = new URL(req.url);
  let body = null;
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      body = null;
    }
  }
  const out = await apiModule.handle({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    body,
  });
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};

export const config = {
  path: '/api/*',
};
