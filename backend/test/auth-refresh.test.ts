import { test } from 'node:test';
import assert from 'node:assert/strict';
import authRoutes from '../src/routes/auth.ts';

const refreshHandler = (authRoutes as any).stack
  .find((layer: any) => layer.route?.path === '/refresh').route.stack[0].handle;

async function callRefresh(status: number) {
  globalThis.fetch = async () => new Response(null, { status });
  let actualStatus = 0;
  let body: any;
  const res = {
    status(code: number) { actualStatus = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await refreshHandler({ body: { access_token: 'old-access', refresh_token: 'old-refresh' } }, res);
  return { status: actualStatus, body };
}

test('Nanit rejects a refresh token as expired', async () => {
  const result = await callRefresh(401);
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'refresh_failed');
});

test('temporary Nanit refresh failure is not reported as an expired session', async () => {
  const result = await callRefresh(503);
  assert.equal(result.status, 502);
  assert.equal(result.body.error, 'refresh_unavailable');
});
