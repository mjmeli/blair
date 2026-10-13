import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBabies } from '../../frontend/src/services/api.ts';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  },
});
Object.defineProperty(globalThis, 'window', {
  value: { location: { pathname: '/', href: '/' } },
});

function seedTokens() {
  values.set('blair_access_token', 'old-access');
  values.set('blair_refresh_token', 'old-refresh');
}

test('simultaneous expired requests use one rotating refresh token', async () => {
  seedTokens();
  let refreshes = 0;
  globalThis.fetch = async (input, init) => {
    if (input === '/api/auth/refresh') {
      refreshes++;
      assert.deepEqual(JSON.parse(String(init?.body)), {
        access_token: 'old-access', refresh_token: 'old-refresh',
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', token: 'new-token' });
    }
    const auth = (init?.headers as Record<string, string>).Authorization;
    if (auth === 'Bearer old-access') return new Response(null, { status: 401 });
    assert.equal(auth, 'Bearer new-access');
    return Response.json({ babies: [] });
  };

  await Promise.all([getBabies(), getBabies(), getBabies()]);
  assert.equal(refreshes, 1);
  assert.equal(values.get('blair_access_token'), 'new-access');
  assert.equal(values.get('blair_refresh_token'), 'new-refresh');
});

test('temporary refresh failures retain tokens for a later retry', async () => {
  seedTokens();
  globalThis.fetch = async input => input === '/api/auth/refresh'
    ? new Response(null, { status: 502 })
    : new Response(null, { status: 401 });

  await assert.rejects(getBabies(), /Could not refresh session/);
  assert.equal(values.get('blair_access_token'), 'old-access');
  assert.equal(values.get('blair_refresh_token'), 'old-refresh');
});

test('rejected refresh token clears the session', async () => {
  seedTokens();
  globalThis.fetch = async input => input === '/api/auth/refresh'
    ? new Response(null, { status: 401 })
    : new Response(null, { status: 401 });

  await assert.rejects(getBabies(), /Session expired/);
  assert.equal(values.has('blair_access_token'), false);
  assert.equal(values.has('blair_refresh_token'), false);
});
