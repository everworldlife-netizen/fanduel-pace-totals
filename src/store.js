/**
 * Tiny key/value JSON store.
 *  - On Netlify: Netlify Blobs (the function injects `getStore` via configure()).
 *  - On Cloudflare: a document store over Workers KV (the Worker injects it via useBackend()).
 *  - Locally / Docker: in-memory, optionally persisted to STORE_DIR as JSON files.
 */

const fs = require('fs');
const path = require('path');

// Store name kept from the first deploy so tracked games and graded results carry over.
const STORE_NAME = 'courtside-eb';
let blobStore = null;
let custom = null; // { getJSON, setJSON, del, listKeys, flush, name }
const memory = new Map();

/** Plug in a custom backend (e.g. the Cloudflare KV document store). */
function useBackend(backend) {
  custom = backend || null;
}

function configure(getStore) {
  if (typeof getStore !== 'function') return;
  try {
    blobStore = getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch (err) {
    console.log(`[store] Blobs unavailable, using memory: ${err.message}`);
    blobStore = null;
  }
}

function fileDir() {
  return process.env.STORE_DIR || null;
}

function filePath(key) {
  return path.join(fileDir(), `${key.replace(/[^a-zA-Z0-9._-]+/g, '__')}.json`);
}

async function getJSON(key) {
  if (custom) return custom.getJSON(key);
  if (blobStore) {
    try {
      return await blobStore.get(key, { type: 'json' });
    } catch (err) {
      console.log(`[store] get ${key}: ${err.message}`);
      return null;
    }
  }
  if (memory.has(key)) return memory.get(key);
  if (fileDir()) {
    try {
      const v = JSON.parse(fs.readFileSync(filePath(key), 'utf8'));
      memory.set(key, v);
      return v;
    } catch {
      return null;
    }
  }
  return null;
}

async function setJSON(key, value) {
  if (custom) return custom.setJSON(key, value);
  if (blobStore) {
    await blobStore.setJSON(key, value);
    return;
  }
  memory.set(key, value);
  if (fileDir()) {
    fs.mkdirSync(fileDir(), { recursive: true });
    fs.writeFileSync(filePath(key), JSON.stringify(value));
  }
}

async function del(key) {
  if (custom) return custom.del(key);
  if (blobStore) {
    await blobStore.delete(key);
    return;
  }
  memory.delete(key);
  if (fileDir()) {
    try {
      fs.unlinkSync(filePath(key));
    } catch {
      /* missing is fine */
    }
  }
}

async function listKeys(prefix) {
  if (custom) return custom.listKeys(prefix);
  if (blobStore) {
    const { blobs } = await blobStore.list({ prefix });
    return blobs.map((b) => b.key);
  }
  return [...memory.keys()].filter((k) => k.startsWith(prefix));
}

/** Persist buffered writes (only the document store buffers; the others write through). */
async function flush(opts) {
  if (custom && typeof custom.flush === 'function') return custom.flush(opts);
  return { writes: 0, written: [], errors: [] };
}

function backend() {
  if (custom) return custom.name || 'custom';
  return blobStore ? 'netlify-blobs' : fileDir() ? 'file' : 'memory';
}

module.exports = { configure, useBackend, getJSON, setJSON, del, listKeys, flush, backend, STORE_NAME };
