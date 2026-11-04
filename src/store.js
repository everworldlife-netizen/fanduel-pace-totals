/**
 * Tiny key/value JSON store.
 *  - On Netlify: Netlify Blobs (the function injects `getStore` via configure()).
 *  - Locally / Docker: in-memory, optionally persisted to STORE_DIR as JSON files.
 */

const fs = require('fs');
const path = require('path');

const STORE_NAME = 'courtside-eb';
let blobStore = null;
const memory = new Map();

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
  if (blobStore) {
    const { blobs } = await blobStore.list({ prefix });
    return blobs.map((b) => b.key);
  }
  return [...memory.keys()].filter((k) => k.startsWith(prefix));
}

function backend() {
  return blobStore ? 'netlify-blobs' : fileDir() ? 'file' : 'memory';
}

module.exports = { configure, getJSON, setJSON, del, listKeys, backend, STORE_NAME };
