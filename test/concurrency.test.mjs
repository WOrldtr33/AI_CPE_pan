import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { T830 } from '../src/t830.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(fn) {
  const stats = { logins: 0, active: 0, maxActive: 0, events: [] };
  let generation = 0;
  const server = createServer(async (req, res) => {
    stats.active++;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    const path = new URL(req.url, 'http://local').pathname;
    const method = body.params?.[2];
    stats.events.push(method || path);
    const finish = () => {
      stats.active--;
    };
    res.once('close', finish);
    res.setHeader('Content-Type', 'application/json');
    const send = (data) => res.end(JSON.stringify(data));
    if (path.includes('action_login')) {
      stats.logins++;
      generation++;
      const current = generation;
      await delay(30);
      res.setHeader('Set-Cookie', `sysauth_http=test-${current}; Path=/; HttpOnly`);
      return send({ code: 0, sessionid: `session-${current}` });
    }
    if (method === 'timeout') {
      await delay(180);
      return send({ result: [0, { value: 1 }] });
    }
    await delay(15);
    if (path.includes('get_easymesh_switch')) {
      if (req.headers.cookie !== `sysauth_http=test-${generation}`) {
        res.statusCode = 403;
        res.setHeader('x-luci-login-required', 'yes');
        return send({});
      }
      return send({ code: 0, data: { easymesh_switch: '0' } });
    }
    if (path === '/ubus/') {
      if (body.params[0] !== `session-${generation}`)
        return send({ error: { code: -32002, message: 'Access denied' } });
      if (method === 'denied')
        return send({ error: { code: -32002, message: 'Access denied' } });
      if (method === 'access')
        return send({ result: [0, { access: body.params[3].function !== 'denied' }] });
      return send({ result: [0, { value: method }] });
    }
    send({ value: 1 });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    T830_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    T830_PASSWORD: 'test-only',
    T830_COOKIE_MODE: 'always',
    T830_TIMEOUT_MS: '500',
  };
  try {
    await fn({
      env,
      stats,
      expire: () => {
        generation++;
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
test('concurrent tools share initial login and complete FIFO with at most one active HTTP request', () =>
  fixture(async ({ env, stats }) => {
    const d = new T830(env);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => d.rpc('test', `read-${i}`)),
    );
    assert.equal(stats.logins, 1);
    assert.equal(stats.maxActive, 1);
    assert.deepEqual(
      results.map((r) => r.data.value),
      Array.from({ length: 6 }, (_, i) => `read-${i}`),
    );
    assert.deepEqual(
      stats.events.filter((x) => x.startsWith('read-')),
      results.map((r) => r.data.value),
    );
    assert(results.every((r) => r.diagnostics[0].step === 'queue'));
  }));
test('simultaneous renew calls perform one login', () =>
  fixture(async ({ env, stats }) => {
    const d = new T830(env);
    await d.login();
    await Promise.all(Array.from({ length: 6 }, () => d.renew()));
    assert.equal(stats.logins, 2);
    assert.equal(stats.maxActive, 1);
    assert.equal((await d.rpc('test', 'after-renew')).status, 'returned');
  }));

test('Queued UBUS reads recover one invalid session even when access diagnostics are denied', () =>
  fixture(async ({ env, stats, expire }) => {
    const d = new T830(env);
    await d.login(); expire();
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => d.rpc('test', `read-${i}`)));
    assert(results.every(r => r.status === 'returned'));
    assert.equal(stats.logins, 2);
    assert.equal(stats.maxActive, 1);
    assert.equal(results.flatMap(r => r.diagnostics).filter(d => d.reason === 'access_probe_denied_renew_session_once').length, 1);
    await d.close();
  }));
test('expired session renews once and queued callers use the new session', () =>
  fixture(async ({ env, stats, expire }) => {
    const d = new T830(env);
    await d.login();
    expire();
    const results = await Promise.all(Array.from({ length: 4 }, () => d.getMeshStatus()));
    assert(results.every((r) => r.status === 'returned'));
    assert.equal(stats.logins, 2);
    assert.equal(stats.maxActive, 1);
    assert.equal(
      results
        .flatMap((r) => r.diagnostics)
        .filter((t) => t.reason === 'login_required_renew_session').length,
      1,
    );
  }));
test('permission failure and timeout release queue; later calls still finish', () =>
  fixture(async ({ env, stats }) => {
    const d = new T830({ ...env, T830_TIMEOUT_MS: '100' });
    const results = await Promise.allSettled([
      d.rpc('test', 'denied'),
      d.rpc('test', 'timeout'),
      d.rpc('test', 'after-failure'),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.message, 'DEVICE_TIMEOUT');
    assert.equal(results[2].status, 'fulfilled');
    assert.equal(results[2].value.data.value, 'after-failure');
    assert.equal(stats.events.filter((x) => x === 'timeout').length, 2);
  }));
test('concurrent MCP calls settle independently through the device queue', () =>
  fixture(async ({ env, stats }) => {
    const client = new Client({ name: 'concurrency-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        env: { ...process.env, ...env, T830_ENABLE_WRITES: '0' },
        stderr: 'inherit',
      }),
    );
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          client.callTool({ name: 't830_get_mesh_status', arguments: {} }),
        ),
      );
      assert(results.every((r) => !r.isError));
      assert.equal(stats.logins, 1);
      assert.equal(stats.maxActive, 1);
      const ids = results.map((r) => r.structuredContent.diagnostics[0].operationId);
      assert.equal(new Set(ids).size, 5);
    } finally {
      await client.close();
    }
  }));

test(
  'login failure settles every queued call without hanging',
  { timeout: 1000 },
  async () => {
    const d = new T830({});
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => d.rpc('test', 'read')),
    );
    assert(
      results.every(
        (r) => r.status === 'rejected' && r.reason.message === 'MISSING_CREDENTIALS',
      ),
    );
    assert(
      results.every((r) =>
        r.reason.details.diagnostics.some((t) => t.step === 'initialization_failed'),
      ),
    );
  },
);
