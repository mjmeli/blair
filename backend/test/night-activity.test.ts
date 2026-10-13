import test from 'node:test';
import assert from 'node:assert/strict';

// This must work without Firebase credentials or a Google Cloud project.
process.env.STORAGE_BACKEND = 'sqlite';
const { getWindowActivity } = await import('../src/services/night-activity.js');
const { store } = await import('../src/services/store.js');

test('completed activity is cached in SQLite and remains available when Nanit is offline', async () => {
  const originalFetch = globalThis.fetch;
  const end = Math.floor(Date.now() / 1000) - 7200;
  const start = end - 3600;
  let requests = 0;
  try {
    globalThis.fetch = async () => {
      requests++;
      return Response.json({ events: [
        { key: 'FELL_ASLEEP', time: start - 10 },
        { key: 'VISIT', time: start + 100 },
      ] });
    };
    const expected = { covered: true, events: [{ key: 'VISIT', time: start + 100 }] };
    assert.deepEqual(await getWindowActivity('token', 'activity-baby', start, end), expected);
    assert.deepEqual(await store.getCachedActivity('activity-baby', start, end), expected);
    globalThis.fetch = async () => { throw new Error('Nanit offline'); };
    assert.deepEqual(await getWindowActivity('token', 'activity-baby', start, end), expected);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uncovered activity is not persisted as a completed night', async () => {
  const originalFetch = globalThis.fetch;
  const end = Math.floor(Date.now() / 1000) - 7200;
  const start = end - 3600;
  try {
    globalThis.fetch = async () => Response.json({ events: [{ key: 'VISIT', time: start + 100 }] });
    assert.equal((await getWindowActivity('token', 'uncovered-baby', start, end)).covered, false);
    assert.equal(await store.getCachedActivity('uncovered-baby', start, end), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
