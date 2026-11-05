const test = require('node:test');
const assert = require('node:assert/strict');
const { createDocStore } = require('../src/docStore');

function memKv() {
  const m = new Map();
  let puts = 0;
  return {
    m,
    get puts() {
      return puts;
    },
    async get(k) {
      return m.has(k) ? m.get(k) : null;
    },
    async put(k, v) {
      puts += 1;
      m.set(k, v);
    },
  };
}

const NOW = Date.parse('2026-11-05T12:00:00Z');

test('groups keys into a few documents and writes once per flush', async () => {
  const kv = memKv();
  const s = createDocStore(kv, { now: () => NOW });
  await s.setJSON('track/state', { active: {} });
  await s.setJSON('track/ev/1', { snaps: [1] });
  await s.setJSON('track/ev/2', { snaps: [2] });
  await s.setJSON('track/graded/2026-11-05', [{ eventId: 1 }]);
  await s.setJSON('model/params', { w: 1 });
  assert.equal(await s.pending(), 2);
  const r = await s.flush();
  assert.equal(r.writes, 2);
  assert.deepEqual(r.written.sort(), ['live', 'model']);
  assert.equal(kv.puts, 2);
  // Nothing dirty: no writes.
  assert.equal((await s.flush()).writes, 0);
  // A fresh instance reads the same values back.
  const s2 = createDocStore(kv, { now: () => NOW });
  assert.deepEqual(await s2.getJSON('track/ev/2'), { snaps: [2] });
  assert.deepEqual(await s2.getJSON('track/graded/2026-11-05'), [{ eventId: 1 }]);
  assert.equal(await s2.getJSON('track/ev/404'), null);
});

test('history flushes at most hourly unless forced', async () => {
  const kv = memKv();
  let t = NOW;
  const s = createDocStore(kv, { now: () => t });
  await s.setJSON('data/finals', [1]);
  assert.equal((await s.flush()).writes, 1); // first write goes out
  t += 10 * 60 * 1000;
  await s.setJSON('data/finals', [1, 2]);
  assert.equal((await s.flush()).writes, 0); // held back
  assert.equal((await s.flush({ force: true })).writes, 1);
  t += 61 * 60 * 1000;
  await s.setJSON('data/finals', [1, 2, 3]);
  assert.equal((await s.flush()).writes, 1);
});

test('graded days older than yesterday move out of the live document', async () => {
  const kv = memKv();
  let t = NOW;
  const s = createDocStore(kv, { now: () => t });
  await s.setJSON('track/graded/2026-11-04', [{ eventId: 'a' }]);
  await s.setJSON('track/state', { x: 1 });
  await s.flush();
  t += 2 * 86400000; // two days later 11-04 is no longer "recent"
  await s.setJSON('track/state', { x: 2 });
  const r = await s.flush();
  assert.ok(r.written.includes('graded:2026-11-04'));
  assert.ok(r.written.includes('live'));
  const s2 = createDocStore(kv, { now: () => t });
  assert.deepEqual(await s2.getJSON('track/graded/2026-11-04'), [{ eventId: 'a' }]);
  assert.equal(JSON.parse(kv.m.get('doc:live'))['track/graded/2026-11-04'], undefined);
});

test('a document that failed to load is never written over', async () => {
  const kv = memKv();
  await kv.put('doc:live', JSON.stringify({ 'track/state': { keep: true } }));
  let fail = true;
  const flaky = { get: async (k) => (fail ? Promise.reject(new Error('down')) : kv.get(k)), put: (k, v) => kv.put(k, v) };
  const s = createDocStore(flaky, { now: () => NOW });
  await s.setJSON('track/ev/9', { snaps: [] });
  const r = await s.flush();
  assert.equal(r.writes, 0);
  assert.deepEqual(JSON.parse(kv.m.get('doc:live')), { 'track/state': { keep: true } });
  fail = false;
  // Once reads work again, local changes merge onto the stored doc and get written.
  assert.deepEqual(await s.getJSON('track/state'), { keep: true });
  assert.equal((await s.flush()).writes, 1);
  assert.deepEqual(JSON.parse(kv.m.get('doc:live')), { 'track/state': { keep: true }, 'track/ev/9': { snaps: [] } });
});
