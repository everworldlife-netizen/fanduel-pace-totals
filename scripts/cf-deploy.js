#!/usr/bin/env node
/**
 * One-command Cloudflare deploy for GG Winner.
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run cf:deploy
 * Creates the KV namespace on first run (and writes its id into wrangler.toml),
 * runs the tests, deploys the Worker + static app, and sets an admin key for
 * /api/admin/collect (printed once).
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOML = path.join(ROOT, 'wrangler.toml');
const PLACEHOLDER = '00000000000000000000000000000000';

function wrangler(args, { inherit = false, input } = {}) {
  return execFileSync('npx', ['-y', 'wrangler@4', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    stdio: inherit ? 'inherit' : [input == null ? 'ignore' : 'pipe', 'pipe', 'inherit'],
  });
}

function ensureKv() {
  const toml = fs.readFileSync(TOML, 'utf8');
  if (!toml.includes(PLACEHOLDER)) return;
  let id = null;
  try {
    const list = JSON.parse(wrangler(['kv', 'namespace', 'list']));
    id = (list.find((n) => /GG_STORE/.test(n.title)) || {}).id || null;
  } catch {
    id = null;
  }
  if (!id) {
    const out = wrangler(['kv', 'namespace', 'create', 'GG_STORE']);
    id = (out.match(/"?id"?\s*[:=]\s*"([0-9a-f]{32})"/) || [])[1] || null;
  }
  if (!id) throw new Error('Could not create the GG_STORE KV namespace');
  fs.writeFileSync(TOML, toml.replace(PLACEHOLDER, id));
  console.log(`KV namespace GG_STORE: ${id}`);
}

function main() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error('Set CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) first.');
    process.exit(1);
  }
  execFileSync('node', ['--test', ...fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`)], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  ensureKv();
  wrangler(['deploy'], { inherit: true });
  if (process.argv.includes('--admin-key')) {
    const key = crypto.randomBytes(18).toString('base64url');
    wrangler(['secret', 'put', 'COLLECT_KEY'], { input: key });
    console.log(`Admin key for /api/admin/collect?key=...: ${key}`);
  }
}

main();
