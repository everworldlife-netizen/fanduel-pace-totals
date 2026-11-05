/**
 * Groups the app's keys into a few JSON documents on a plain key/value backend
 * (Cloudflare KV, or anything with get/put of strings). A collector run then
 * costs one or two writes instead of one per key, which keeps free-tier write
 * limits in reach.
 *
 *   live        track/state, track/ev/*, track/_meta, graded games from today and yesterday
 *   graded:DAY  graded games from older days (moved out of "live" once, then rarely touched)
 *   history     data/finals, data/quarters (flushed at most hourly unless forced)
 *   model       model/context, model/params
 *
 * Reads are cached in memory. Writes stay in memory until flush().
 */

const DAY_MS = 86400000;
const GRADED = 'track/graded/';

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function createDocStore(backend, opts = {}) {
  const now = opts.now || (() => Date.now());
  const prefix = opts.prefix || 'doc:';
  const ttl = { live: 20 * 1000, default: 10 * 60 * 1000, ...(opts.ttl || {}) };
  const lazyFlushMs = { history: 60 * 60 * 1000, ...(opts.lazyFlushMs || {}) };
  const docs = new Map();

  function docFor(key) {
    if (key.startsWith(GRADED)) {
      const day = key.slice(GRADED.length);
      return day >= dayKey(now() - DAY_MS) ? 'live' : `graded:${day}`;
    }
    if (key.startsWith('track/')) return 'live';
    if (key.startsWith('data/')) return 'history';
    if (key.startsWith('model/')) return 'model';
    return 'misc';
  }

  async function load(name, { fresh = false } = {}) {
    const cur = docs.get(name);
    const maxAge = ttl[name] ?? ttl.default;
    if (cur && !cur.failed && (cur.dirty || (!fresh && now() - cur.loadedAt < maxAge))) return cur;
    let next;
    try {
      const raw = await backend.get(prefix + name);
      const data = raw ? JSON.parse(raw) : {};
      const again = docs.get(name);
      if (again && again.dirty && !again.failed) return again; // local changes landed while we were reading
      if (again && again.failed) {
        // Earlier read failed: keep what was set locally since, on top of the stored doc.
        next = { data: Object.assign(data, again.data), loadedAt: now(), dirty: again.dirty, flushedAt: again.flushedAt, failed: false };
      } else {
        next = { data, loadedAt: now(), dirty: false, flushedAt: cur?.flushedAt || 0, failed: false };
      }
    } catch (err) {
      console.log(`[docStore] load ${name}: ${err.message}`);
      if (cur) return cur;
      // Never write a doc we could not read: it would wipe what is stored.
      next = { data: {}, loadedAt: 0, dirty: false, flushedAt: 0, failed: true };
    }
    docs.set(name, next);
    return next;
  }

  async function getJSON(key) {
    const name = docFor(key);
    const d = await load(name);
    let v = d.data[key];
    if (v === undefined && name.startsWith('graded:')) {
      const live = await load('live');
      v = live.data[key];
    }
    return v === undefined ? null : v;
  }

  async function setJSON(key, value) {
    const name = docFor(key);
    const d = await load(name);
    d.data[key] = value;
    d.dirty = true;
    if (name.startsWith('graded:')) {
      const live = await load('live');
      if (key in live.data) {
        delete live.data[key];
        live.dirty = true;
      }
    }
  }

  async function del(key) {
    const d = await load(docFor(key));
    if (key in d.data) {
      delete d.data[key];
      d.dirty = true;
    }
  }

  async function listKeys(keyPrefix) {
    const out = new Set();
    for (const name of ['live', 'history', 'model', 'misc']) {
      const d = await load(name);
      for (const k of Object.keys(d.data)) if (k.startsWith(keyPrefix)) out.add(k);
    }
    return [...out];
  }

  /** Move graded days that aged out of "live" into their own docs. */
  async function migrate() {
    const live = docs.get('live');
    if (!live || live.failed) return;
    for (const k of Object.keys(live.data)) {
      if (!k.startsWith(GRADED) || docFor(k) === 'live') continue;
      const target = await load(docFor(k));
      if (target.failed) continue;
      const have = Array.isArray(target.data[k]) ? target.data[k] : [];
      const ids = new Set(have.map((g) => g && g.eventId));
      const add = (live.data[k] || []).filter((g) => !ids.has(g && g.eventId));
      target.data[k] = have.concat(add);
      target.dirty = true;
      delete live.data[k];
      live.dirty = true;
    }
  }

  function wouldFlush(name, d, force) {
    if (!d.dirty || d.failed) return false;
    const lazy = lazyFlushMs[name];
    return force || !lazy || !d.flushedAt || now() - d.flushedAt >= lazy;
  }

  /** How many writes the next flush() would make. */
  async function pending({ force = false } = {}) {
    await migrate();
    return [...docs.entries()].filter(([n, d]) => wouldFlush(n, d, force)).length;
  }

  async function flush({ force = false } = {}) {
    await migrate();
    const written = [];
    const errors = [];
    for (const [name, d] of docs.entries()) {
      if (!wouldFlush(name, d, force)) continue;
      try {
        await backend.put(prefix + name, JSON.stringify(d.data));
        d.dirty = false;
        d.flushedAt = now();
        d.loadedAt = now();
        written.push(name);
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
      }
    }
    return { writes: written.length, written, errors };
  }

  return { getJSON, setJSON, del, listKeys, flush, pending, docFor, name: opts.name || 'doc-store' };
}

module.exports = { createDocStore, dayKey };
