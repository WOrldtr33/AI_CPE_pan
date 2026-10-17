import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { T830 } from '../src/t830.mjs';
import { reads, writes, toolName } from '../src/catalog.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { validateResponse } from '../src/response.mjs';
import { readFile } from 'node:fs/promises';
import { writeReport } from '../src/artifacts.mjs';

async function fixture(fn, options = {}) {
  const samples = JSON.parse(
    await readFile(new URL('./fixtures/read-responses.json', import.meta.url), 'utf8'),
  );
  samples.wifi_night = { action: 'Disable', openTime: '', closeTime: '', code: 200 };
  samples.roaming = { action: 'Disable', code: 200 };
  samples.gps = { data: { gps_switch: 'disable' }, code: 0 };
  const applyWrite = (key, args) => {
    if (key === 'wifi_switch') samples.wifi[args.name].state = args.action;
    if (key === 'guest_switch') samples.guest[args.name].state = args.action;
    if (key === 'wifi_config')
      for (const band of ['5G', '2.4G']) Object.assign(samples.wifi[band], args[band]);
    if (key === 'guest_config')
      for (const band of ['Guest', 'Guest5G'])
        Object.assign(samples.guest[band], args[band]);
    if (key === 'wifi_night') Object.assign(samples.wifi_night, args);
    if (key === 'roaming') Object.assign(samples.roaming, args);
    if (key === 'apn_save') {
      const list = samples.apn.manual.apn_list;
      const index = list.findIndex((x) => x.config_file === args.config_file);
      if (index < 0) list.push(args);
      else list[index] = args;
    }
    if (key === 'upnp') samples.upnp.data.upnp_switch = args.upnp_switch;
    if (key === 'dns') samples.dns.data = args.rebind_protection;
    if (key === 'gps')
      samples.gps.data.gps_switch = args.gps_switch === '1' ? 'enable' : 'disable';
    if (key === 'traffic') Object.assign(samples.traffic.cfgs, args);
  };
  const calls = [];
  let generation = 0;
  let expire = false;
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const c of req) text += c;
    const b = text ? JSON.parse(text) : {};
    const url = new URL(req.url, 'http://localhost');
    calls.push({ path: url.pathname, cookie: req.headers.cookie, body: b });
    res.setHeader('Content-Type', 'application/json');
    const send = (data) => res.end(JSON.stringify(data));
    if (url.pathname.includes('action_login')) {
      generation++;
      res.setHeader('Set-Cookie', `sysauth_http=secret-${generation}; Path=/; HttpOnly`);
      return send({ code: 0, sessionid: options.ubusSessionExpiry ? `test-session-${generation}` : 'test-session' });
    }
    if (
      url.pathname.includes('/cgi-bin/luci/admin/') &&
      !req.headers.cookie?.includes(`secret-${generation}`)
    ) {
      res.statusCode = 403;
      res.setHeader('x-luci-login-required', 'yes');
      return send({ error: 'login required' });
    }
    const cgiWrite = writes.find((d) => d.path === url.pathname);
    if (cgiWrite) {
      applyWrite(cgiWrite.key, b);
      return send({ code: 0 });
    }
    if (url.pathname === '/ubus/') {
      if (options.ubusSessionExpiry && (expire || options.alwaysDenyUbus || b.params[0] !== `test-session-${generation}`)) {
        return send(options.ubusPermissionCode === 6
          ? { result: [6] }
          : { error: { code: -32002, message: 'Access denied' } });
      }
      const [, service, method, args] = b.params;
      if (options.denyAfterRenew === method && generation >= 3)
        return send({ error: { code: -32002, message: 'Access denied' } });
      const writeDef = writes.find(
        (d) => d.transport === 'ubus' && d.service === service && d.method === method,
      );
      if (writeDef) {
        applyWrite(writeDef.key, args);
        return send({ result: [0, { code: 200 }] });
      }
      if (service === 'session' && method === 'access')
        return send({
          result: [
            0,
            options.invalidAccess
              ? { access: 'false' }
              : { access: args.function !== 'denied' && !(options.denyAfterRenew === args.function && generation >= 3) },
          ],
        });
      if (
        options.shareMissing &&
        service === 'cpe-ctrl' &&
        method === 'get_101share_status'
      )
        return send({ error: { code: -32000, message: 'Object not found' } });
      if (options.incompleteWifi && method === 'get_ssidPage_info')
        return send({ result: [0, { code: 200, '5G': {}, '2.4G': {} }] });
      if (method === 'denied')
        return send({ error: { code: -32002, message: 'Access denied' } });
      if (method === 'get_wifi_router' && args.noData) {
        return send({ result: [5] });
      }
      if (method === 'get_workmode')
        return send({ result: [0, { code: 0, data: { workmode: 4 } }] });
      if (method === 'warning')
        return send({
          result: [0, { '5G_code': '206', wpapsk: 'secret', data: { imei: 'private' } }],
        });
      if (method === 'country_code')
        return send({ result: [0, { code: 0, data: { country_code: 'ZA' } }] });
      if (method === 'write_failure') {
        res.statusCode = 503;
        return send({ error: 'unknown execution state' });
      }
      const def = reads.find(
        (d) => d.transport === 'ubus' && d.service === service && d.method === method,
      );
      const sample = samples[def?.key];
      return send({ result: [0, sample || { code: 200, mock: true }] });
    }
    if (url.pathname.includes('get_easymesh_switch')) {
      if (expire) {
        expire = false;
        generation++;
        res.statusCode = 403;
        res.setHeader('x-luci-login-required', 'yes');
        return send({});
      }
      return send({ code: 0, data: { easymesh_switch: '0' } });
    }
    if (url.pathname.includes('get_simcard_inslot_stat'))
      return send({ dataCode: 200, data: { simcard_inslot: '0' } });
    const def = reads.find((d) => d.path === url.pathname);
    const sample = samples[def?.key];
    return send(sample || { code: 0, data: { mock: true } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    T830_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    T830_PASSWORD: 'test-only',
    T830_TIMEOUT_MS: '500',
  };
  try {
    await fn({
      env,
      calls,
      expire: () => {
        if (options.ubusSessionExpiry) generation++;
        else expire = true;
      },
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

for (const section of ['device_info', 'status', 'wifi', 'workmode']) {
  for (const code of [-32002, 6]) {
    test(`${section}: expired UBUS session rejecting access probe recovers once (${code})`, () =>
      fixture(async ({ env, calls, expire }) => {
        const d = new T830(env);
        assert.equal((await d.query(section)).status, 'returned');
        expire();
        const result = await d.query(section);
        assert.equal(result.status, 'returned');
        assert.equal(result.diagnosticSummary.attempts, 2);
        assert.deepEqual(result.diagnosticSummary.retries, ['access_probe_denied_renew_session_once']);
        assert.equal(result.diagnosticSummary.rootCause, 'not_applicable');
        assert.equal(calls.filter(c => c.path.includes('action_login')).length, 2);
        const attempts = result.diagnostics.filter(d => d.step === 'attempt');
        assert.deepEqual(attempts.map(a => a.withCookie), [false, true]);
        assert(result.diagnostics.some(d => d.step === 'diagnostic_failed' && d.method === 'access'));
        assert(!JSON.stringify(result).includes('test-session-'));
        assert(!JSON.stringify(result).includes('secret-'));
        await d.close();
      }, { ubusSessionExpiry: true, ubusPermissionCode: code }));
  }
}

test('Access denied after renewal remains bounded with unknown cause, not confirmed ACL denial', () =>
  fixture(async ({ env, calls }) => {
    const d = new T830(env);
    await assert.rejects(d.query('device_info'), error => {
      assert.equal(error.message, 'RPC_ERROR_-32002');
      assert.equal(error.details.diagnosticSummary.attempts, 2);
      assert.equal(error.details.diagnosticSummary.rootCause, 'unknown');
      assert.equal(error.details.diagnosticSummary.retries.length, 1);
      return true;
    });
    assert.equal(calls.filter(c => c.path.includes('action_login')).length, 2);
    assert.equal(calls.filter(c => c.body.params?.[2] === 'access').length, 2);
    await d.close();
  }, { ubusSessionExpiry: true, alwaysDenyUbus: true }));

test('After renewal a genuine target ACL denial is diagnosed and stopped', () =>
  fixture(async ({ env, calls, expire }) => {
    const d = new T830(env);
    await d.login(); expire();
    await assert.rejects(d.query('device_info'), error => {
      assert.equal(error.details.diagnosticSummary.rootCause, 'target_permission_denied');
      assert.equal(error.details.diagnosticSummary.attempts, 2);
      return true;
    });
    assert.equal(calls.filter(c => c.path.includes('action_login')).length, 2);
    await d.close();
  }, { ubusSessionExpiry: true, denyAfterRenew: 'devinfo_get' }));

test('Cookie never mode does not trigger new access-denied recovery or send cookies', () =>
  fixture(async ({ env, calls, expire }) => {
    const d = new T830({ ...env, T830_COOKIE_MODE: 'never' });
    await d.login(); expire();
    await assert.rejects(d.query('wifi'), /RPC_ERROR_-32002/);
    assert.equal(calls.filter(c => c.path.includes('action_login')).length, 1);
    assert(calls.every(c => !c.cookie));
    await d.close();
  }, { ubusSessionExpiry: true }));

test('Persistent MCP client recovers expired session and reads all four affected tools', () =>
  fixture(async ({ env, calls, expire }) => {
    const client = new Client({ name: 'session-recovery-regression', version: '1' });
    await client.connect(new StdioClientTransport({
      command: process.execPath, args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
      env: { ...process.env, ...env, T830_ENABLE_WRITES: '0' }, stderr: 'inherit',
    }));
    try {
      assert(!(await client.callTool({ name: 't830_get_device_info', arguments: {} })).isError);
      expire();
      for (const section of ['device_info', 'status', 'wifi', 'workmode']) {
        const response = await client.callTool({ name: `t830_get_${section}`, arguments: {} });
        assert(!response.isError, section);
        assert.equal(response.structuredContent.status, 'returned');
      }
      assert.equal(calls.filter(c => c.path.includes('action_login')).length, 2);
    } finally { await client.close(); }
  }, { ubusSessionExpiry: true }));

test('auto cookie recovers CGI, never reproduces 403, expired session renews once', () =>
  fixture(async ({ env, calls, expire }) => {
    const d = new T830(env);
    const mesh = await d.getMeshStatus();
    assert.equal(mesh.data.data.easymesh_switch, '0');
    assert.deepEqual(
      mesh.diagnostics.filter((x) => x.step === 'attempt').map((x) => x.withCookie),
      [false, true],
    );
    assert(!JSON.stringify(mesh).includes('secret-'));
    await assert.rejects(
      new T830({ ...env, T830_COOKIE_MODE: 'never' }).getMeshStatus(),
      /HTTP_403/,
    );
    const a = new T830({ ...env, T830_COOKIE_MODE: 'always' });
    await a.login();
    expire();
    assert.equal((await a.getMeshStatus()).status, 'returned');
    assert.equal(calls.filter((c) => c.path.includes('action_login')).length, 4);
    await assert.rejects(
      a.request('http://example.invalid/', undefined, 'x'),
      /CROSS_ORIGIN/,
    );
  }));

test('permission diagnostic does not retry an unauthorized target; NO_DATA collects mode', () =>
  fixture(async ({ env, calls }) => {
    const d = new T830(env);
    await assert.rejects(d.rpc('mtk.wifi', 'denied'), (e) => {
      assert(e.details.diagnostics.some((t) => t.reason === 'target_permission_denied'));
      assert(e.details.diagnostics.some((t) => t.data?.access === false));
      return true;
    });
    assert.equal(calls.filter((c) => c.body.params?.[2] === 'denied').length, 1);
    await assert.rejects(d.rpc('web_api', 'get_wifi_router', { noData: true }), (e) => {
      assert.equal(e.message, 'UBUS_ERROR_5_NO_DATA');
      assert(
        e.details.diagnostics.some((t) => t.workmode === 4 && t.confirmed === false),
      );
      return true;
    });
    const warning = await d.rpc('mtk.wifi', 'warning');
    assert.equal(warning.status, 'device_warning');
    assert.equal(warning.data.wpapsk, '[REDACTED]');
    assert.equal((await d.rpc('x', 'country_code')).status, 'returned');
  }));

test('bounded network retry and missing credentials', async () => {
  const d = new T830({ T830_BASE_URL: 'http://127.0.0.1:1', T830_TIMEOUT_MS: '100' });
  await assert.rejects(d.simStatus(), (e) => {
    assert.equal(e.details.diagnostics.filter((t) => t.step === 'attempt').length, 2);
    return true;
  });
  const noCredentials = new T830({});
  await assert.rejects(noCredentials.login(), /MISSING_CREDENTIALS/);
  await assert.rejects(noCredentials.login(), /MISSING_CREDENTIALS/);
});

test('write gate, parameter validation, and no automatic write retries', () =>
  fixture(async ({ env, calls }) => {
    const d = new T830(env);
    await assert.rejects(
      d.write('wifi_switch', { name: '5G', action: 'up' }),
      /WRITES_DISABLED/,
    );
    assert.equal(calls.length, 0);
    const writer = new T830({ ...env, T830_ENABLE_WRITES: '1' });
    await assert.rejects(writer.write('wifi_switch', { name: 'bad', action: 'up' }));
    assert.equal(calls.length, 0);
    await assert.rejects(
      writer.run({
        kind: 'write',
        transport: 'ubus',
        service: 'x',
        method: 'write_failure',
      }),
      /HTTP_503/,
    );
    assert.equal(calls.filter((c) => c.body.params?.[2] === 'write_failure').length, 1);
  }));

test('MCP handshake, all catalog callbacks and schemas against mock device (no real writes)', () =>
  fixture(async ({ env, calls }) => {
    const client = new Client({ name: 'mock-smoke', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        env: {
          ...process.env,
          ...env,
          T830_COOKIE_MODE: 'auto',
          T830_ENABLE_WRITES: '1',
        },
        stderr: 'inherit',
      }),
    );
    try {
      const list = await client.listTools();
      assert.equal(list.tools.length, reads.length + writes.length + 4);
      const verified = [];
      for (const def of [...reads, ...writes]) {
        const before = calls.length;
        const response = await client.callTool({
          name: toolName(def),
          arguments: def.sample,
        });
        assert(!response.isError, `${def.key}: ${JSON.stringify(response.content)}`);
        const expected = calls
          .slice(before)
          .find((c) =>
            def.transport === 'ubus'
              ? c.body.params?.[1] === def.service && c.body.params?.[2] === def.method
              : c.path === def.path,
          );
        assert(expected, `wrong endpoint: ${def.key}`);
        if (def.transport === 'ubus')
          assert.deepEqual(expected.body.params[3], def.sample);
        else if (def.kind === 'write') assert.deepEqual(expected.body, def.sample);
        verified.push({
          api: def.api,
          key: def.key,
          kind: def.kind,
          tool: toolName(def),
          status: 'passed_mock',
          endpointAndArgumentsVerified: true,
        });
      }
      assert(
        (await client.callTool({ name: 't830_query', arguments: { section: 'reboot' } }))
          .isError,
      );
      assert(
        (
          await client.callTool({
            name: 't830_set_wifi_switch',
            arguments: { name: 'bad', action: 'up' },
          })
        ).isError,
      );
      await writeReport(
        'mock/mock-smoke-results.json',
        JSON.stringify(
          {
            at: new Date().toISOString(),
            mode: 'mock-only',
            realDeviceModified: false,
            readCount: reads.length,
            writeCount: writes.length,
            records: verified,
          },
          null,
          2,
        ),
      );
    } finally {
      await client.close();
    }
  }));

test('default MCP registration excludes writes', () =>
  fixture(async ({ env }) => {
    const client = new Client({ name: 'readonly-check', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
        env: {
          ...process.env,
          ...env,
          T830_COOKIE_MODE: 'auto',
          T830_ENABLE_WRITES: '0',
        },
        stderr: 'inherit',
      }),
    );
    try {
      const list = await client.listTools();
      assert.equal(list.tools.length, reads.length + 3);
      assert(!list.tools.some((t) => t.name.startsWith('t830_set_')));
      assert(
        (
          await client.callTool({
            name: 't830_set_wifi_switch',
            arguments: { name: '5G', action: 'up' },
          })
        ).isError,
      );
    } finally {
      await client.close();
    }
  }));

test('share Object not found collects access without repeating target or changing root error', () =>
  fixture(
    async ({ env, calls }) => {
      const d = new T830(env);
      await assert.rejects(d.query('share'), (e) => {
        assert.equal(e.message, 'RPC_ERROR_-32000');
        assert.equal(e.details.response.error.message, 'Object not found');
        const probes = e.details.diagnostics.filter(
          (t) =>
            t.step === 'diagnostic' && t.service === 'session' && t.method === 'access',
        );
        assert.equal(probes.length, 1);
        assert.equal(probes[0].data.access, true);
        assert(
          !e.details.diagnostics.some((t) => t.reason === 'target_permission_denied'),
        );
        return true;
      });
      const accesses = calls.filter(
        (c) => c.body.params?.[1] === 'session' && c.body.params?.[2] === 'access',
      );
      assert.equal(accesses.length, 1);
      assert.deepEqual(accesses[0].body.params[3], {
        scope: 'ubus',
        object: 'cpe-ctrl',
        function: 'get_101share_status',
      });
      assert.equal(
        calls.filter((c) => c.body.params?.[2] === 'get_101share_status').length,
        1,
      );
    },
    { shareMissing: true },
  ));

test('response validation rejects incomplete or wrong-type data and preserves warnings and empty lists', () => {
  const check = (key, data, w = []) => validateResponse({ key, kind: 'read' }, data, w);
  assert.equal(check('wifi', {}).status, 'failed');
  assert.equal(check('wifi', { code: 0 }).status, 'failed');
  assert.equal(
    check('wifi', { '5G': {}, '2.4G': {} }).issues.some(
      (i) => i.reason === 'missing_field',
    ),
    true,
  );
  assert.equal(
    check('mesh_status', { data: { easymesh_switch: [] } }).issues[0].reason,
    'invalid_type',
  );
  assert.equal(check('cells', { serving: [], neighbour: [], extra: 1 }).status, 'passed');
  assert.equal(
    check('device', { code: 206, Warn: 'Not registered' }, [
      { field: 'code', value: 206 },
    ]).status,
    'skipped_business_warning',
  );
  assert.equal(check('unknown', { data: { x: 1 } }).coverage, 'basic');
  assert.equal(check('sim_presence', { data: { simcard_inslot: '0' } }).status, 'passed');
  assert.equal(check('wifi', []).status, 'failed');
});

test('diagnostics identify target and control, preserve uncertainty and reach MCP structured errors', () =>
  fixture(
    async ({ env }) => {
      const d = new T830(env);
      await assert.rejects(d.rpc('mtk.wifi', 'denied'), (e) => {
        const probes = e.details.diagnostics.filter((t) => t.step === 'diagnostic');
        assert.equal(probes[0].params.function, 'denied');
        assert.equal(probes[0].purpose, 'target_permission');
        assert.equal(probes[1].purpose, 'control_permission');
        assert.equal(e.details.diagnosticSummary.rootCause, 'target_permission_denied');
        return true;
      });
      await assert.rejects(d.query('share'), (e) => {
        assert.equal(e.details.diagnosticSummary.rootCause, 'unknown');
        assert.equal(e.details.diagnosticSummary.permissionCheck.access, true);
        return true;
      });
      const client = new Client({ name: 'structured-errors', version: '1' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
          env: { ...process.env, ...env },
          stderr: 'inherit',
        }),
      );
      try {
        const result = await client.callTool({ name: 't830_get_share', arguments: {} });
        assert(result.isError);
        assert.equal(result.structuredContent.error, 'RPC_ERROR_-32000');
        assert.equal(
          result.structuredContent.details.diagnosticSummary.rootCause,
          'unknown',
        );
      } finally {
        await client.close();
      }
    },
    { shareMissing: true },
  ));

test('malformed access result is recorded as failed diagnostic, never confirmed denial', () =>
  fixture(
    async ({ env }) => {
      await assert.rejects(new T830(env).rpc('mtk.wifi', 'denied'), (e) => {
        assert.equal(e.details.diagnosticSummary.permissionCheck.status, 'failed');
        assert.equal(e.details.diagnosticSummary.rootCause, 'unknown');
        assert(
          e.details.diagnostics.some(
            (t) =>
              t.step === 'diagnostic_failed' && t.error === 'INVALID_ACCESS_RESPONSE',
          ),
        );
        return true;
      });
    },
    { invalidAccess: true },
  ));

test('MCP reports incomplete WiFi fields as structured validation failure without retry', () =>
  fixture(
    async ({ env, calls }) => {
      const client = new Client({ name: 'response-validation', version: '1' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
          env: { ...process.env, ...env },
          stderr: 'inherit',
        }),
      );
      try {
        const result = await client.callTool({ name: 't830_get_wifi', arguments: {} });
        assert(result.isError);
        assert.equal(result.structuredContent.error, 'INVALID_BUSINESS_RESPONSE');
        assert.equal(result.structuredContent.details.validation.status, 'failed');
        assert(
          result.structuredContent.details.validation.issues.some(
            (i) => i.path.join('/') === '5G/Channel',
          ),
        );
        assert.equal(
          calls.filter((c) => c.body.params?.[2] === 'get_ssidPage_info').length,
          1,
        );
      } finally {
        await client.close();
      }
    },
    { incompleteWifi: true },
  ));
