import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { T830 } from '../src/t830.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(fn, options = {}) {
  let value = '0',
    reads = 0,
    generation = 0;
  const calls = [],
    writeEntered = deferred(),
    release = deferred();
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const c of req) text += c;
    const body = text ? JSON.parse(text) : {};
    const path = new URL(req.url, 'http://local').pathname,
      method = body.params?.[2];
    calls.push(method || path);
    res.setHeader('Content-Type', 'application/json');
    const send = (x) => res.end(JSON.stringify(x));
    if (path.includes('action_login')) {
      generation++;
      res.setHeader('Set-Cookie', `sysauth_http=${generation}; Path=/`);
      return send({ code: 0, sessionid: `s${generation}` });
    }
    if (path === '/ubus/') {
      if (method === 'access')
        return send({ result: [0, { access: body.params[0] === `s${generation}` }] });
      if (body.params[0] !== `s${generation}`)
        return send({ error: { code: -32002, message: 'Access denied' } });
      if (method === 'get_upnp') {
        reads++;
        if (reads === 2 && options.preWriteConflict) value = '1';
        const current = value;
        if (reads === 1 && options.externalLogin) generation++;
        return send({
          result: [0, { code: 0, data: { upnp_switch: current, pf_rules: [] } }],
        });
      }
      if (method === 'get_workmode')
        return send({ result: [0, { code: 0, data: { workmode: 4 } }] });
      return send({ result: [0, { value: 1 }] });
    }
    if (path.includes('set_upnp')) {
      writeEntered.resolve();
      if (options.holdWrite) await release.promise;
      if (options.warning) {
        return send({ code: 206 });
      }
      if (req.headers.cookie !== `sysauth_http=${generation}`) {
        res.statusCode = 403;
        res.setHeader('x-luci-login-required', 'yes');
        return send({});
      }
      value = options.postWriteConflict ? '0' : body.upnp_switch;
      return send({ code: 0 });
    }
    send({ code: 0, data: { version: 'test' } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    T830_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    T830_PASSWORD: 'test-only',
    T830_COOKIE_MODE: 'always',
    T830_ENABLE_WRITES: '1',
    T830_TIMEOUT_MS: '1000',
  };
  try {
    await fn({ env, calls, writeEntered, release });
  } finally {
    release.resolve();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
test('verified write and readback cannot be interleaved by another local task', () =>
  fixture(
    async ({ env, calls, writeEntered, release }) => {
      const d = new T830(env);
      const flow = d.writeVerified(
        'upnp',
        { upnp_switch: '1' },
        { expectedCurrent: '0' },
      );
      await writeEntered.promise;
      const other = d.query('workmode');
      release.resolve();
      const result = await flow;
      await other;
      assert.equal(result.status, 'verified_field');
      assert.deepEqual(
        calls.filter((x) => !x.includes('login')),
        [
          'get_upnp',
          'get_upnp',
          '/cgi-bin/luci/admin/jt_nat/set_upnp',
          'get_upnp',
          'get_workmode',
        ],
      );
      assert.equal(
        new Set(result.steps.map((s) => s.output.diagnostics[0].operationId)).size,
        1,
      );
    },
    { holdWrite: true },
  ));
test('stale expected state stops before write', () =>
  fixture(async ({ env, calls }) => {
    await assert.rejects(
      new T830(env).writeVerified('upnp', { upnp_switch: '0' }, { expectedCurrent: '1' }),
      (e) => e.message === 'CONFIG_CONFLICT' && !e.details.writeStarted,
    );
    assert(!calls.some((x) => x.includes('set_upnp')));
  }));
test('external pre-write change is detected without overwriting it', () =>
  fixture(
    async ({ env, calls }) => {
      await assert.rejects(
        new T830(env).writeVerified(
          'upnp',
          { upnp_switch: '1' },
          { expectedCurrent: '0' },
        ),
        (e) => e.message === 'CONFIG_CONFLICT' && e.details.phase === 'before_write',
      );
      assert(!calls.some((x) => x.includes('set_upnp')));
    },
    { preWriteConflict: true },
  ));
test('unchanged readback permits only bounded retries and no automatic rollback', () =>
  fixture(
    async ({ env, calls }) => {
      await assert.rejects(
        new T830(env).writeVerified(
          'upnp',
          { upnp_switch: '1' },
          { expectedCurrent: '0' },
        ),
        (e) =>
          e.message === 'WRITE_VERIFICATION_FAILED' &&
          e.details.cause === 'unknown' &&
          e.details.automaticRollback === false,
      );
      assert.equal(calls.filter((x) => x.includes('set_upnp')).length, 2);
    },
    { postWriteConflict: true },
  ));
test('external login invalidating session recovers read step once without repeating write', () =>
  fixture(
    async ({ env, calls }) => {
      const result = await new T830(env).writeVerified(
        'upnp',
        { upnp_switch: '1' },
        { expectedCurrent: '0' },
      );
      assert.equal(result.status, 'verified_field');
      assert.equal(calls.filter((x) => x.includes('action_login')).length, 2);
      assert.equal(calls.filter((x) => x.includes('set_upnp')).length, 1);
    },
    { externalLogin: true },
  ));
test('warning write response stops workflow and does not claim verification', () =>
  fixture(
    async ({ env, calls }) => {
      await assert.rejects(
        new T830(env).writeVerified(
          'upnp',
          { upnp_switch: '1' },
          { expectedCurrent: '0' },
        ),
        /WORKFLOW_WRITE_WARNING/,
      );
      assert.equal(calls.filter((x) => x === 'get_upnp').length, 5);
    },
    { warning: true },
  ));
test('workflow cancellation after write started stops further steps with unknown remote state', () =>
  fixture(
    async ({ env, calls, writeEntered }) => {
      const c = new AbortController();
      const flow = new T830(env).writeVerified(
        'upnp',
        { upnp_switch: '1' },
        { expectedCurrent: '0', signal: c.signal },
      );
      const check = assert.rejects(
        flow,
        (e) =>
          e.message === 'CALL_CANCELLED' &&
          e.details.writeStarted &&
          e.details.remoteConfiguration === 'requires_readback',
      );
      await writeEntered.promise;
      c.abort();
      await check;
      assert.equal(calls.filter((x) => x === 'get_upnp').length, 2);
    },
    { holdWrite: true },
  ));
test('graceful close rejects pending/new calls, finishes active workflow, is idempotent', () =>
  fixture(
    async ({ env, calls, writeEntered, release }) => {
      const d = new T830(env),
        flow = d.writeVerified('upnp', { upnp_switch: '1' }, { expectedCurrent: '0' });
      await writeEntered.promise;
      const pending = d.query('workmode');
      const rejected = assert.rejects(pending, /SERVER_CLOSING/);
      const closing = d.close({ graceMs: 500 });
      assert.strictEqual(d.close(), closing);
      await rejected;
      await assert.rejects(d.query('workmode'), /SERVER_CLOSING/);
      release.resolve();
      assert.equal((await flow).status, 'verified_field');
      assert.equal((await closing).forced, false);
      assert(!calls.includes('get_workmode'));
    },
    { holdWrite: true },
  ));
test('grace timeout aborts active write locally and reports unknown remote state', () =>
  fixture(
    async ({ env, writeEntered }) => {
      const d = new T830(env),
        flow = d.writeVerified('upnp', { upnp_switch: '1' }, { expectedCurrent: '0' });
      const rejected = assert.rejects(
        flow,
        (e) =>
          e.message === 'SERVER_SHUTDOWN' &&
          e.details.remoteConfiguration === 'requires_readback',
      );
      await writeEntered.promise;
      const closed = await d.close({ graceMs: 30 });
      await rejected;
      assert.equal(closed.forced, true);
    },
    { holdWrite: true },
  ));
test('MCP verified write is gated and executes the protected workflow through SDK', () =>
  fixture(async ({ env }) => {
    const client = new Client({ name: 'workflow-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        env: { ...process.env, ...env },
        stderr: 'inherit',
      }),
    );
    try {
      const result = await client.callTool({
        name: 't830_set_upnp_verified',
        arguments: { upnp_switch: '1', expectedCurrent: '0' },
      });
      assert(!result.isError);
      assert.equal(result.structuredContent.status, 'verified_field');
    } finally {
      await client.close();
    }
  }));
test(
  'stdio EOF with active task closes child within shutdown grace instead of hanging',
  { timeout: 5000 },
  () =>
    fixture(
      async ({ env, writeEntered }) => {
        const child = spawn(
          process.execPath,
          [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
          {
            env: { ...process.env, ...env, T830_SHUTDOWN_GRACE_MS: '30' },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        let stderr = '';
        child.stderr.on('data', (b) => {
          stderr += b;
        });
        const exit = once(child, 'exit');
        const send = (x) => child.stdin.write(JSON.stringify(x) + '\n');
        let initialized = false;
        child.stdout.on('data', () => {
          if (initialized) {
            return;
          }
          initialized = true;
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 't830_set_upnp_verified',
              arguments: { upnp_switch: '1', expectedCurrent: '0' },
            },
          });
        });
        try {
          send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: 'exit-test', version: '1' },
            },
          });
          await writeEntered.promise;
          child.stdin.end();
          const [code] = await exit;
          assert.equal(code, 0);
          assert(stderr.includes('"forced":true'));
        } finally {
          child.kill();
        }
      },
      { holdWrite: true },
    ),
);

test('failed workflow releases queue and does not affect following read', () =>
  fixture(
    async ({ env }) => {
      const d = new T830(env);
      const results = await Promise.allSettled([
        d.writeVerified('upnp', { upnp_switch: '1' }, { expectedCurrent: '0' }),
        d.query('workmode'),
      ]);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[0].reason.details.phase, 'verification');
      assert.equal(results[1].status, 'fulfilled');
    },
    { postWriteConflict: true },
  ));
test('unsupported workflow and missing expected state cannot bypass write gate', async () => {
  await assert.rejects(
    new T830({}).writeVerified('upnp', { upnp_switch: '1' }, { expectedCurrent: '0' }),
    /WRITES_DISABLED/,
  );
  const d = new T830({ T830_ENABLE_WRITES: '1' });
  await assert.rejects(
    d.writeVerified('upnp', { upnp_switch: '1' }),
    /EXPECTED_CURRENT_REQUIRED/,
  );
  await assert.rejects(
    d.writeVerified('unregistered', { rebind_protection: '1' }, { expectedCurrent: '0' }),
    /UNSUPPORTED_VERIFIED_WRITE/,
  );
});
