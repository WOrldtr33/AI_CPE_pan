import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { T830, DeviceError } from '../src/t830.mjs';
import { OperationQueue } from '../src/queue.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const error = (code, queue) => Object.assign(new Error(code), { details: { queue } });
const metadata = (id) => ({ operationId: id });

test('bounded capacity excludes active task, rejects overflow, preserves FIFO', async () => {
  const q = new OperationQueue({ maxPending: 1, waitTimeoutMs: 1000, error });
  const gate = deferred();
  const order = [];
  const first = q.enqueue(
    async () => {
      order.push(1);
      await gate.promise;
    },
    { metadata: metadata(1) },
  );
  const second = q.enqueue(
    async () => {
      order.push(2);
    },
    { metadata: metadata(2) },
  );
  await assert.rejects(
    q.enqueue(async () => order.push(3), { metadata: metadata(3) }),
    /QUEUE_FULL/,
  );
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, [1, 2]);
});
test('wait timeout removes entry and frees capacity immediately', async () => {
  const q = new OperationQueue({ maxPending: 1, waitTimeoutMs: 30, error });
  const gate = deferred();
  let ran = false;
  const first = q.enqueue(() => gate.promise, { metadata: metadata(1) });
  await assert.rejects(
    q.enqueue(
      () => {
        ran = true;
      },
      { metadata: metadata(2) },
    ),
    (e) => e.message === 'QUEUE_WAIT_TIMEOUT' && e.details.queue.state === 'not_started',
  );
  const next = q.enqueue(() => 42, { metadata: metadata(3) });
  gate.resolve();
  await first;
  assert.equal(await next, 42);
  assert.equal(ran, false);
});
test('queued cancellation removes entry, never runs it, and frees its slot', async () => {
  const q = new OperationQueue({ maxPending: 1, waitTimeoutMs: 1000, error });
  const gate = deferred(),
    c = new AbortController();
  let ran = false;
  const first = q.enqueue(() => gate.promise, { metadata: metadata(1) });
  const cancelled = q.enqueue(
    () => {
      ran = true;
    },
    { metadata: metadata(2), signal: c.signal },
  );
  const check = assert.rejects(cancelled, /CALL_CANCELLED/);
  c.abort();
  await check;
  const next = q.enqueue(() => 42, { metadata: metadata(3) });
  gate.resolve();
  await first;
  assert.equal(await next, 42);
  assert.equal(ran, false);
});
test('already-cancelled task is never admitted; zero waiting capacity is supported', async () => {
  const q = new OperationQueue({ maxPending: 0, waitTimeoutMs: 1000, error });
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    q.enqueue(() => 42, { metadata: metadata(1), signal: c.signal }),
    /CALL_CANCELLED/,
  );
  const gate = deferred(),
    first = q.enqueue(() => gate.promise, { metadata: metadata(2) });
  await assert.rejects(
    q.enqueue(() => 42, { metadata: metadata(3) }),
    /QUEUE_FULL/,
  );
  gate.resolve();
  await first;
});
async function fixture(fn, { holdLogin = false } = {}) {
  const entered = deferred(),
    release = deferred(),
    loginEntered = deferred(),
    loginRelease = deferred();
  const calls = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const part of req) text += part;
    const body = text ? JSON.parse(text) : {};
    const path = new URL(req.url, 'http://local').pathname,
      method = body.params?.[2];
    calls.push(method || path);
    res.setHeader('Content-Type', 'application/json');
    const send = (data) => res.end(JSON.stringify(data));
    if (path.includes('action_login')) {
      loginEntered.resolve();
      if (holdLogin) await loginRelease.promise;
      res.setHeader('Set-Cookie', 'sysauth_http=test; Path=/');
      return send({ code: 0, sessionid: 'test' });
    }
    if (method === 'hold' || path.includes('get_easymesh_switch')) {
      entered.resolve();
      await release.promise;
    }
    if (path.includes('get_easymesh_switch'))
      return send({ code: 0, data: { easymesh_switch: '0' } });
    if (path.includes('upgrade-set'))
      return send({ data: { version: 'test' }, dataCode: 200 });
    send({ result: [0, { value: method }] });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    T830_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    T830_PASSWORD: 'test-only',
    T830_COOKIE_MODE: 'always',
    T830_TIMEOUT_MS: '500',
  };
  try {
    await fn({ env, calls, entered, release, loginEntered, loginRelease });
  } finally {
    release.resolve();
    loginRelease.resolve();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
test('queued adapter call cancelled before start does not reach CPE and queue continues', () =>
  fixture(async ({ env, calls, entered, release }) => {
    const d = new T830(env),
      c = new AbortController();
    const first = d.rpc('test', 'hold');
    await entered.promise;
    const cancelled = d.rpc('test', 'cancelled', {}, { signal: c.signal });
    const check = assert.rejects(
      cancelled,
      (e) =>
        e.message === 'CALL_CANCELLED' &&
        e.details.diagnosticSummary.executionState === 'not_started',
    );
    c.abort();
    await check;
    const next = d.rpc('test', 'next');
    release.resolve();
    await first;
    assert.equal((await next).status, 'returned');
    assert(!calls.includes('cancelled'));
  }));
test('active read cancellation aborts local HTTP wait, skips retries, and releases queue', () =>
  fixture(async ({ env, calls, entered }) => {
    const d = new T830(env),
      c = new AbortController();
    const active = d.rpc('test', 'hold', {}, { signal: c.signal });
    const check = assert.rejects(
      active,
      (e) => e.message === 'CALL_CANCELLED' && e.details.remoteExecution === 'unknown',
    );
    await entered.promise;
    const next = d.rpc('test', 'next');
    c.abort();
    await check;
    assert.equal((await next).status, 'returned');
    assert.equal(calls.filter((x) => x === 'hold').length, 1);
  }));
test('cancellation during shared login waits for login to settle and never dispatches cancelled business request', () =>
  fixture(
    async ({ env, calls, loginEntered, loginRelease }) => {
      const d = new T830(env),
        c = new AbortController();
      const active = d.rpc('test', 'cancelled', {}, { signal: c.signal });
      const check = assert.rejects(active, /CALL_CANCELLED/);
      await loginEntered.promise;
      c.abort();
      const next = d.rpc('test', 'next');
      assert(!calls.includes('next'));
      loginRelease.resolve();
      await check;
      await next;
      assert(!calls.includes('cancelled'));
      assert.equal(calls.filter((x) => x.includes('action_login')).length, 1);
    },
    { holdLogin: true },
  ));
test('cancellation during transport retry delay prevents retry', async () => {
  const d = new T830({}),
    c = new AbortController(),
    entered = deferred();
  d.token = 'test';
  let count = 0;
  d.rawRpc = async () => {
    count++;
    entered.resolve();
    throw new DeviceError('DEVICE_TIMEOUT');
  };
  const active = d.rpc('test', 'fail', {}, { signal: c.signal });
  const check = assert.rejects(active, /CALL_CANCELLED/);
  await entered.promise;
  await delay(10);
  c.abort();
  await check;
  assert.equal(count, 1);
});
test('cancelled mock write is never retried and reports remote execution as unknown', () =>
  fixture(async ({ env, calls, entered }) => {
    const d = new T830({ ...env, T830_ENABLE_WRITES: '1' }),
      c = new AbortController();
    const active = d.run(
      {
        key: 'mock_write',
        kind: 'write',
        transport: 'ubus',
        service: 'test',
        method: 'hold',
      },
      {},
      { signal: c.signal },
    );
    const check = assert.rejects(
      active,
      (e) => e.message === 'CALL_CANCELLED' && e.details.remoteExecution === 'unknown',
    );
    await entered.promise;
    c.abort();
    await check;
    assert.equal(calls.filter((x) => x === 'hold').length, 1);
  }));
test('queue environment bounds are validated', () => {
  for (const env of [
    { T830_QUEUE_MAX_PENDING: '-1' },
    { T830_QUEUE_MAX_PENDING: '1.2' },
    { T830_QUEUE_WAIT_MS: '0' },
    { T830_QUEUE_WAIT_MS: 'NaN' },
  ])
    assert.throws(() => new T830(env));
});
test('MCP client cancellation reaches queued and active tools; a later read completes', () =>
  fixture(async ({ env, calls, entered, release }) => {
    const client = new Client({ name: 'cancel-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        env: { ...process.env, ...env },
        stderr: 'inherit',
      }),
    );
    try {
      const activeC = new AbortController(),
        queuedC = new AbortController();
      const active = client.callTool(
        { name: 't830_get_mesh_status', arguments: {} },
        undefined,
        { signal: activeC.signal },
      );
      const activeCheck = assert.rejects(active);
      await entered.promise;
      const queued = client.callTool(
        { name: 't830_get_version', arguments: {} },
        undefined,
        { signal: queuedC.signal },
      );
      const queuedCheck = assert.rejects(queued);
      queuedC.abort();
      await queuedCheck;
      // 同一传输按发送顺序处理；这个响应用于确认前面的取消通知已被处理。
      await client.callTool({ name: 't830_list_capabilities', arguments: {} });
      activeC.abort();
      await activeCheck;
      const next = await client.callTool({ name: 't830_get_version', arguments: {} });
      assert(!next.isError);
      assert.equal(calls.filter((x) => x.includes('upgrade-set')).length, 1);
    } finally {
      release.resolve();
      await client.close();
    }
  }));
test('MCP reports queue overflow and wait expiry as structured errors without device dispatch', () =>
  fixture(async ({ env, calls, entered, release }) => {
    const client = new Client({ name: 'queue-bounds-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        env: {
          ...process.env,
          ...env,
          T830_QUEUE_MAX_PENDING: '1',
          T830_QUEUE_WAIT_MS: '100',
        },
        stderr: 'inherit',
      }),
    );
    try {
      const active = client.callTool({ name: 't830_get_mesh_status', arguments: {} });
      await entered.promise;
      const waiting = client.callTool({ name: 't830_get_version', arguments: {} });
      const capabilities = await client.callTool({
        name: 't830_list_capabilities',
        arguments: {},
      });
      assert.equal(capabilities.structuredContent.queuePolicy.maxPending, 1);
      const overflow = await client.callTool({ name: 't830_get_version', arguments: {} });
      assert(overflow.isError);
      assert.equal(overflow.structuredContent.error, 'QUEUE_FULL');
      const expired = await waiting;
      assert(expired.isError);
      assert.equal(expired.structuredContent.error, 'QUEUE_WAIT_TIMEOUT');
      assert.equal(
        expired.structuredContent.details.diagnosticSummary.executionState,
        'not_started',
      );
      assert(!calls.some((x) => x.includes('upgrade-set')));
      const next = client.callTool({ name: 't830_get_version', arguments: {} });
      release.resolve();
      await active;
      assert(!(await next).isError);
    } finally {
      release.resolve();
      await client.close();
    }
  }));
test('MCP client timeout cancels queued work so it cannot execute later', () =>
  fixture(async ({ env, calls, entered, release }) => {
    const client = new Client({ name: 'timeout-cancel-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        env: { ...process.env, ...env },
        stderr: 'inherit',
      }),
    );
    try {
      const active = client.callTool({ name: 't830_get_mesh_status', arguments: {} });
      await entered.promise;
      await assert.rejects(
        client.callTool({ name: 't830_get_version', arguments: {} }, undefined, {
          timeout: 50,
        }),
      );
      await client.callTool({ name: 't830_list_capabilities', arguments: {} });
      release.resolve();
      await active;
      const next = await client.callTool({ name: 't830_get_version', arguments: {} });
      assert(!next.isError);
      assert.equal(calls.filter((x) => x.includes('upgrade-set')).length, 1);
    } finally {
      release.resolve();
      await client.close();
    }
  }));
test('write helper passes cancellation into the queue and never dispatches cancelled write', () =>
  fixture(async ({ env, calls, entered, release }) => {
    const d = new T830({ ...env, T830_ENABLE_WRITES: '1' }),
      c = new AbortController();
    const first = d.rpc('test', 'hold');
    await entered.promise;
    const write = d.write(
      'wifi_switch',
      { name: '5G', action: 'up' },
      { signal: c.signal },
    );
    const check = assert.rejects(write, /CALL_CANCELLED/);
    c.abort();
    await check;
    release.resolve();
    await first;
    assert(!calls.includes('set_wifi_switch'));
  }));
