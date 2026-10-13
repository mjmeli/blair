import { test } from 'node:test';
import assert from 'node:assert/strict';
import authRoutes from '../src/routes/auth.ts';

const refreshHandler = (authRoutes as any).stack
  .find((layer: any) => layer.route?.path === '/refresh').route.stack[0].handle;

async function callRefresh(status: number | 'network') {
  globalThis.fetch = async () => {
    if (status === 'network') throw new TypeError('fetch failed');
    return new Response(null, { status });
  };
  let actualStatus = 0;
  let body: any;
  const res = {
    status(code: number) { actualStatus = code; return this; },
    json(value: unknown) { body = value; return this; },
  };
  await refreshHandler({ body: { access_token: 'old-access', refresh_token: 'old-refresh' } }, res);
  return { status: actualStatus, body };
}

for (const status of [400, 401, 403, 404, 422]) {
  test(`Nanit refresh rejection ${status} requires a new login`, async () => {
    const result = await callRefresh(status);
    assert.equal(result.status, 401);
    assert.equal(result.body.error, 'refresh_failed');
  });
}

for (const status of [429, 500, 503, 'network'] as const) {
  test(`temporary Nanit refresh failure ${status} remains retryable`, async () => {
    const result = await callRefresh(status);
    assert.equal(result.status, 502);
    assert.equal(result.body.error, 'refresh_unavailable');
  });
}
