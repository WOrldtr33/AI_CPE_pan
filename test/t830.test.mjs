import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { T830, redact } from '../src/t830.mjs';
import { reads, writes, toolName } from '../src/catalog.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { deviceReading, validateResponse } from '../src/response.mjs';
import { readFile } from 'node:fs/promises';
import { writeReport } from '../src/artifacts.mjs';
import { createHash } from 'node:crypto';

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
  let probeStarted = false, probeReads = 0;
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const c of req) text += c;
    const contentType = String(req.headers['content-type'] || '');
    const b = text && contentType.includes('application/json') ? JSON.parse(text) : {};
    const url = new URL(req.url, 'http://localhost');
    calls.push({ path: url.pathname, search: url.search, cookie: req.headers.cookie, body: b, contentType });
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
    if (options.nativeAuth && url.pathname === '/ubus/' && b.params?.[1] === 'session' && b.params?.[2] === 'login') {
      generation++;
      return send(options.rejectNative ? { result: [6] } : { result: [0, { ubus_rpc_session: `secret-${generation}`, timeout: 300 }] });
    }
    const cgiWrite = writes.find((d) => d.path === url.pathname && d.schema.safeParse(b).success);
    if (cgiWrite) {
      applyWrite(cgiWrite.key, b);
      return send({ code: 0 });
    }
    if (url.pathname === '/ubus/') {
      if (b.method === 'list' && options.serviceList) return send({ jsonrpc: '2.0', id: b.id, result: options.serviceList });
      if (options.ubusSessionExpiry && (expire || options.alwaysDenyUbus || b.params[0] !== `test-session-${generation}`)) {
        return send(options.ubusPermissionCode === 6
          ? { result: [6] }
          : { error: { code: -32002, message: 'Access denied' } });
      }
      const [, service, method, args] = b.params;
      if (options.probeWorkflow && service === 'netApp' && method === 'start') {
        if (args.addr !== 'read_ping') { probeStarted = true; return send({ result: [0, { code: '0' }] }); }
        probeReads++;
        return send({ result: [0, !probeStarted || probeReads === 1 ? { code: '1', data: '' }
          : { code: '0', data: '6 packets transmitted, 6 packets received, 0% packet loss' }] });
      }
      if (service === 'uci' && method === 'get' && options.stationValues) return send({ result: [0, { values: options.stationValues }] });
      if (options.developerAuth && service === 'gen.attr' && method === 'check_asymmetric_verify')
        return send({ result: [0, options.rejectDeveloperKey ? { code: 403 } : { code: 200, passwd: 'mock-elevated-password' }] });
      if (options.denyAfterRenew === method && generation >= 3)
        return send({ error: { code: -32002, message: 'Access denied' } });
      const writeDef = writes.find(
        (d) => d.transport === 'ubus' && d.service === service && d.method === method && d.schema.safeParse(args).success,
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
        (d) => (d.transport === 'ubus' && d.service === service && d.method === method) || (d.readFallback?.service === service && d.readFallback?.method === method),
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
      assert.equal(e.details.diagnosticSummary.failure.category, 'permission_denied');
      assert.equal(e.details.diagnosticSummary.failure.retrySameRequest, false);
      assert(e.details.diagnostics.some((t) => t.data?.access === false));
      return true;
    });
    assert.equal(calls.filter((c) => c.body.params?.[2] === 'denied').length, 1);
    await assert.rejects(d.rpc('web_api', 'get_wifi_router', { noData: true }), (e) => {
      assert.equal(e.message, 'UBUS_ERROR_5_NO_DATA');
      assert.equal(e.details.diagnosticSummary.failure.category, 'no_data');
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

test('documented APIs are registered and fixed file commands stay closed', async () => {
  const md = await readFile(new URL('../docs/api/API_DOC.md', import.meta.url), 'utf8');
  const missing = [...md.matchAll(/^### (\d+)\. /gm)].map((m) => Number(m[1])).filter((n) => ![...reads, ...writes].some((d) => d.api === n));
  assert.deepEqual(missing, []);
  const keys = [...reads, ...writes].map((d) => `${d.kind}:${d.key}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(writes.find((d) => d.key === 'backup_restore').schema.safeParse({ command: '/bin/sh', params: ['-c', 'id'] }).success, false);
  assert.equal(writes.find((d) => d.key === 'backup_delete').schema.safeParse({ path: '/tmp/other' }).success, false);
});

test('cellular, WPS and SMS schemas follow the vendor web contracts', () => {
  const ok = (key, args, kind = 'write') => [...reads, ...writes].find((d) => d.kind === kind && d.key === key).schema.safeParse(args).success;
  assert.equal(ok('wps_run', { name: '2.4G', obj: 'host' }, 'read'), true);
  assert.equal(ok('wps_run', { name: 'ra0', obj: 'host' }, 'read'), false);
  assert.equal(ok('wps_pbc', { name: 'ra0', obj: 'host' }), false);
  assert.equal(ok('wps_pin', { name: '5G', obj: 'guest', pincode: '12345670' }), true);
  assert.equal(ok('network_mode', { ratMode: '19' }), true);
  assert.equal(ok('network_mode', { ratMode: 'auto' }), false);
  const band = { type: 'NR', state: 'FULL', band: 'n41', arfcn: '504990', pci: '850', multi_band: { list_3G: [], list_4G: [], list_5G: [] } };
  assert.equal(ok('band_lock', band), true);
  assert.equal(ok('band_lock', { ...band, state: 'PCI', arfcn: undefined }), false);
  assert.equal(ok('band_lock', { ...band, pref: '1' }), false);
  assert.equal(ok('band_lock', { type: 'band', state: '0', band: '1' }), false);
  assert.equal(ok('plmn_lock', { plmn_array: ['46001'] }), true);
  const text = Buffer.from('测试 test', 'utf8').toString('base64');
  assert.equal(ok('sms_send', { addr: '15000000000', content: text, format: '2', myContent: text }), true);
  assert.equal(ok('sms_send', { addr: '15000000000', content: 'test', format: '2', myContent: 'test' }), false);
  assert.equal(ok('sms_send', { addr: '15000000000', content: text, format: '2', myContent: 'dGVzdA==' }), false);
  assert.equal(ok('sms_send', { addr: '15000000000', content: '//8=', format: '2', myContent: '//8=' }), false);
  assert.equal(ok('sms_delete', { content: '15000000000[1' }), true);
  assert.equal(ok('sms_delete', { content: '15000000000[ALL,10086[3' }), true);
  assert.equal(ok('sms_delete', { content: '10086[0]' }), false);
  for (const d of writes) assert.equal(d.schema.safeParse(d.sample).success, true, d.key);
});

test('unprofiled write submits once without readback', () =>
  fixture(async ({ env, calls }) => {
    const writer = new T830({ ...env, T830_ENABLE_WRITES: '1' });
    const result = await writer.write('reboot', { reboot: '1' });
    assert.equal(result.status, 'submitted');
    assert.equal(result.validation.status, 'passed');
    assert.equal(calls.filter((c) => c.path.endsWith('/set_reboot')).length, 1);
  }));

test('one-shot CGI write displaced by another login renews once and resends once', () =>
  fixture(async ({ env, calls }) => {
    const writer = new T830({ ...env, T830_ENABLE_WRITES: '1' });
    await writer.write('mac_filter_mode', { mode: '1' });
    await new T830(env).login();
    const result = await writer.write('mac_filter_mode', { mode: '1' });
    assert.equal(result.status, 'submitted');
    assert.equal(calls.filter((c) => c.path.endsWith('/set_macfilter_mode')).length, 3);
    assert.equal(calls.filter((c) => c.path.includes('action_login')).length, 3);
    assert(result.diagnostics.some((t) => t.reason === 'login_required_renew_session'));
  }));

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
        else if (def.encoding === 'multipart')
          assert.match(expected.contentType, /multipart\/form-data/);
        else if (def.kind === 'write') assert.deepEqual(expected.body, def.sample);
        if (def.flag) assert.match(expected.search, new RegExp(`[?&]flag=${def.flag}(?:&|$)`));
        for (const [key, value] of Object.entries(def.search || {}))
          assert.match(expected.search, new RegExp(`[?&]${key}=${value}(?:&|$)`));
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
        assert.equal(e.details.diagnosticSummary.failure.category, 'object_not_found');
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
  assert.equal(deviceReading('sim_presence', { data: { simcard_inslot: '21' } }).state, 'present');
  assert.equal(deviceReading('sim_presence', { data: { simcard_inslot: '0' } }).state, 'absent');
  assert.equal(deviceReading('sim_presence', { data: { simcard_inslot: '3' } }).state, 'unavailable');
  assert.equal(deviceReading('sim_presence', { data: { simcard_inslot: '9' } }).state, 'abnormal');
  assert.equal(deviceReading('status', { data: { wanstat: 'true,false', SimStatus: '1' } }).uplink, 'connected');
  assert.equal(deviceReading('status', { data: { wanstat: 'false,false', SimStatus: '0' } }).uplink, 'not_connected');
  assert.equal(deviceReading('status', { data: { wanstat: 'false,ccmni', SimStatus: '3' } }).pin, 'pin_required');
  assert.equal(deviceReading('status', { data: { wanstat: 'false,ccmni', SimStatus: '4' } }).pin, 'puk_required');
  const registered = deviceReading('device', { code: '200', PS_eAct: 'NR', plmn: '46001' });
  assert.equal(registered.state, 'registered');
  assert.equal(registered.radio, 'NR');
  assert.equal(registered.provesUplink, false);
  assert.equal(deviceReading('device', { code: '206', Warn: 'Mobile Network registration failed', PS_eAct: 'UMTS' }).state, 'not_registered');
  const ready = deviceReading('sim', { sim: { status: 'READY', lock: '0', remain: { pin1: '3' } } });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.pinLock, 'disabled');
  assert.equal(ready.pinAttempts, '3');
  assert.equal(deviceReading('sim', { sim: { status: 'READY', lock: '1' } }).pinLock, 'enabled');
  assert.equal(deviceReading('status', { data: { wanstat: 'true,ccmni', SimStatus: '21', SignalValue: '-78 dBm', long_eons: 'ChinaUnicom', NR_or_LTE: '5G' } }).signal, '-78 dBm');
  assert.equal(redact({ SIM: '8610000000000', SimStatus: '21' }).SIM, '[REDACTED]');
  assert.equal(redact({ SIM: '8610000000000', SimStatus: '21' }).SimStatus, '21');
  assert.equal(deviceReading('wifi', { data: {} }), undefined);
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
        assert.equal(result.structuredContent.failure.category, 'object_not_found');
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

test('CGI requests use the firmware webpage flag rather than section keys', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_ENABLE_WRITES: '1' });
  try {
    await device.query('mesh_role');
    await device.query('dns');
    await device.query('version');
    await device.write('dns', { rebind_protection: '1' });
    const flags = path => calls.filter(call => call.path === path).map(call => new URLSearchParams(call.search).get('flag'));
    assert.deepEqual(flags('/cgi-bin/luci/admin/jt_easymesh/get_role'), ['get_mesh_role', 'get_mesh_role']);
    assert(flags('/cgi-bin/luci/admin/jt_dns/get_dns').every(flag => flag === 'get_dns_protection'));
    assert.deepEqual(flags('/cgi-bin/luci/admin/jt_dns/set_dns'), ['set_dns_protection']);
    assert.deepEqual(flags('/cgi-bin/upgrade-set.lua'), ['upgradeSet']);
  } finally { await device.close(); }
}));

test('HTTP forbidden diagnosis keeps uncertainty and never fabricates UBUS permission', () => fixture(async ({ env }) => {
  const device = new T830({ ...env, T830_COOKIE_MODE: 'never' });
  try {
    await assert.rejects(device.run({ ...reads.find(def => def.key === 'gps'), readFallback: undefined }), error => {
      const summary = error.details.diagnosticSummary;
      assert.equal(error.message, 'HTTP_403');
      assert.equal(summary.rootCause, 'unknown');
      assert.equal(summary.failure.category, 'http_forbidden');
      assert.equal(summary.failure.evidence, 'observation');
      assert.equal(summary.permissionCheck.status, 'not_applicable');
      return true;
    });
  } finally { await device.close(); }
}));

test('Explicit admin selection ignores developer keys loaded from configuration', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_AUTH_MODE: 'admin', T830_DEVELOPER_KEY: 'bW9jay1rZXk=' });
  try {
    await device.query('wifi');
    assert.equal(device.developerAuthenticated, false);
    assert.deepEqual(calls.filter(c => c.path.includes('action_login')).map(c => c.body.username), ['admin']);
    assert.equal(calls.some(c => c.body.params?.[2] === 'check_asymmetric_verify'), false);
  } finally { await device.close(); }
}, { developerAuth: true }));

test('Explicit developer key verifies then logs in superadmin; renewal repeats the same flow', () => fixture(async ({ env, calls }) => {
  const key = 'bW9jay1kZXZlbG9wZXIta2V5';
  const device = new T830({ ...env, T830_DEVELOPER_KEY: key });
  try {
    await device.query('wifi');
    assert.equal(device.developerAuthenticated, true);
    assert.deepEqual(calls.filter(c => c.path.includes('action_login')).map(c => c.body.username), ['admin', 'superadmin']);
    const verification = calls.find(c => c.body.params?.[2] === 'check_asymmetric_verify');
    assert.deepEqual(verification.body.params[3], { reply: 'superpasswd', base64: key });
    const { createHash } = await import('node:crypto');
    const elevated = calls.find(c => c.body.username === 'superadmin').body;
    assert.equal(elevated.password, createHash('sha256').update(elevated.salt + ':mock-elevated-password').digest('hex'));
    await device.renew();
    assert.equal(device.developerAuthenticated, true);
    assert.deepEqual(calls.filter(c => c.path.includes('action_login')).map(c => c.body.username), ['admin', 'superadmin', 'admin', 'superadmin']);
    assert.equal(calls.filter(c => c.body.params?.[2] === 'check_asymmetric_verify').length, 2);
    assert.equal(redact({ T830_DEVELOPER_KEY: key }).T830_DEVELOPER_KEY, '[REDACTED]');
  } finally { await device.close(); }
}, { developerAuth: true }));

test('Rejected developer key fails closed and never dispatches requested device query', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_DEVELOPER_KEY: 'bW9jay1rZXk=' });
  try {
    await assert.rejects(device.query('wifi'), error => {
      assert.equal(error.message, 'DEVELOPER_VERIFICATION_FAILED');
      assert(!JSON.stringify(error.details).includes('mock-elevated-password'));
      return true;
    });
    assert.equal(device.developerAuthenticated, false);
    assert.equal(device.token, null);
    await assert.rejects(device.query('wifi'), /DEVELOPER_VERIFICATION_FAILED/);
    assert.equal(calls.filter(c => c.body.username === 'superadmin').length, 0);
    assert.equal(calls.filter(c => c.body.params?.[2] === 'get_ssidPage_info').length, 0);
  } finally { await device.close(); }
}, { developerAuth: true, rejectDeveloperKey: true }));

test('Explicit native UBUS developer authentication supports RPC, CGI cookies and renewal without broken CGI login', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_AUTH_TRANSPORT: 'ubus', T830_DEVELOPER_KEY: 'bW9jay1rZXk=' });
  try {
    const result = await device.query('mesh_status');
    assert.equal(result.status, 'returned');
    assert.equal(device.developerAuthenticated, true);
    assert.equal(calls.filter(c => c.path.includes('action_login')).length, 0);
    const native = () => calls.filter(c => c.body.params?.[1] === 'session' && c.body.params?.[2] === 'login');
    assert.deepEqual(native().map(c => c.body.params[3].username), ['admin', 'superadmin']);
    assert.equal(native()[0].body.params[3].password, 'test-only');
    assert.equal(native()[1].body.params[3].password, 'mock-elevated-password');
    assert(calls.some(c => c.path.includes('get_easymesh_switch') && c.cookie === 'sysauth_http=secret-2'));
    assert(!JSON.stringify(result).includes('secret-2'));
    await device.renew();
    assert.deepEqual(native().map(c => c.body.params[3].username), ['admin','superadmin','admin','superadmin']);
    assert.equal((await device.query('mesh_status')).status, 'returned');
  } finally { await device.close(); }
}, { nativeAuth: true, developerAuth: true }));

test('Native login rejection stops without CGI fallback or leaking native session credentials', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_AUTH_TRANSPORT: 'ubus' });
  try {
    await assert.rejects(device.query('wifi'), error => {
      assert.equal(error.message, 'UBUS_LOGIN_FAILED');
      assert(!JSON.stringify(error.details).includes('test-only'));
      return true;
    });
    assert.equal(calls.filter(c => c.path.includes('action_login')).length, 0);
    assert.equal(calls.filter(c => c.body.params?.[2] === 'get_ssidPage_info').length, 0);
  } finally { await device.close(); }
}, { nativeAuth: true, rejectNative: true }));

test('Native login requires a raw supplied password and rejects unknown transports', async () => {
  assert.throws(() => new T830({ T830_AUTH_TRANSPORT: 'invalid' }), /INVALID_AUTH_TRANSPORT/);
  const device = new T830({ T830_AUTH_TRANSPORT: 'ubus', T830_PASSWORD_HASH: 'a'.repeat(64), T830_SALT: 'salt' });
  try { await assert.rejects(device.login(), /UBUS_LOGIN_REQUIRES_PLAINTEXT_PASSWORD/); }
  finally { await device.close(); }
});

test('failed initial authentication can recover on a subsequent explicit request', async () => {
  const device = new T830({ T830_PASSWORD: 'mock-only' });
  let attempts = 0;
  device.performLogin = async () => {
    attempts++;
    if (attempts === 1) throw new Error('HTTP_500');
    device.token = 'recovered';
  };
  try {
    await assert.rejects(device.login(), /HTTP_500/);
    assert.equal(device.loginPromise, null);
    await device.login();
    assert.equal(device.token, 'recovered');
    assert.equal(attempts, 2);
  } finally { await device.close(); }
});

test('explicit native login and logout tools respect configured authentication transport', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_ENABLE_WRITES: '1', T830_AUTH_TRANSPORT: 'ubus' });
  const salt = 'mock-salt';
  const args = { username: 'admin', salt, password: createHash('sha256').update(salt + ':' + env.T830_PASSWORD).digest('hex') };
  try {
    const signedIn = await device.write('login', args);
    assert.equal(signedIn.status, 'submitted');
    assert.equal(signedIn.data.sessionid, '[REDACTED]');
    assert.equal((await device.write('logout')).status, 'submitted');
    assert.equal(device.token, null);
    assert(calls.some(call => call.body.params?.[1] === 'session' && call.body.params?.[2] === 'destroy'));
    assert.equal(calls.filter(call => call.path.includes('action_login') || call.path.includes('action_logout')).length, 0);
    const before = calls.length;
    await assert.rejects(device.write('login', { ...args, password: 'a'.repeat(64) }), /NATIVE_LOGIN_CREDENTIALS_MISMATCH/);
    assert.equal(calls.length, before);
  } finally { await device.close(); }
}, { nativeAuth: true }));

test('write contracts require measured signal fields, complete phonebook fields and device time format', () => {
  const contract = key => writes.find(def => def.key === key).schema;
  assert.equal(contract('signal_record').safeParse({ name: 'spot', position: 'lab' }).success, false);
  assert.equal(contract('phonebook_write').safeParse({ name: 'home', device: '1', type: '0' }).success, false);
  const contact = writes.find(def => def.key === 'phonebook_write').sample;
  assert.equal(contract('phonebook_write').safeParse({ ...contact, flag: '1' }).success, false);
  assert.equal(contract('phonebook_write').safeParse({ ...contact, flag: '1', index: '1' }).success, true);
  assert.equal(contract('reboot_schedule').safeParse({ action: 'Disable' }).success, false);
  assert.equal(contract('reboot_schedule').safeParse({ action: 'Disable', schweek: '', schTime: '00;00' }).success, true);
  assert.equal(contract('reboot_schedule').safeParse({ action: 'Enable', schweek: '', schTime: '00;00' }).success, false);
  assert.equal(contract('reboot_schedule').safeParse({ action: 'Enable', schweek: '1|2', schTime: '00:00' }).success, false);
});

test('signal measurement receives a longer default deadline while explicit timeout stays authoritative', async () => {
  for (const explicit of [false, true]) {
    const device = new T830({ T830_ENABLE_WRITES: '1', ...(explicit ? { T830_TIMEOUT_MS: '500' } : {}) });
    device.token = 'mock-only';
    let timeout;
    device.rawRpc = async (...args) => { timeout = args[6]; return { code: 0 }; };
    try {
      assert.equal((await device.write('signal_start')).status, 'submitted');
      assert.equal(timeout, explicit ? undefined : 20000);
      assert.equal(device.timeout, explicit ? 500 : 10000);
    } finally { await device.close(); }
  }
});

test('native logout rejection preserves local session state and does not claim logout succeeded', async () => {
  const device = new T830({ T830_ENABLE_WRITES: '1', T830_AUTH_TRANSPORT: 'ubus' });
  device.token = 'mock-session';
  device.rawRpc = async () => { throw new Error('RPC_ERROR_-32002'); };
  try {
    await assert.rejects(device.write('logout'), /RPC_ERROR_-32002/);
    assert.equal(device.token, 'mock-session');
  } finally { await device.close(); }
});

test('phonebook numbers, email and native session identifiers are redacted', () => {
  assert.deepEqual(redact({ numb: '1234567', numb_house: '7654321', numb_work: '1234568', email: 'test@example.invalid', ubus_rpc_session: 'session-secret', index: '1' }), {
    numb: '[REDACTED]', numb_house: '[REDACTED]', numb_work: '[REDACTED]', email: '[REDACTED]', ubus_rpc_session: '[REDACTED]', index: '1',
  });
});

test('GPS and setup use only their declared read fallback on forbidden CGI, retaining original evidence', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_COOKIE_MODE: 'never' });
  try {
    for (const section of ['gps', 'setup']) {
      const result = await device.query(section);
      assert.equal(result.status, 'returned');
      assert.equal(result.diagnostics.filter(d => d.step === 'queue').length, 1);
      assert(result.diagnostics.some(d => d.step === 'attempt' && d.error === 'HTTP_403'));
      assert(result.diagnostics.some(d => d.step === 'read_fallback'));
      assert.equal(calls.filter(c => c.body.params?.[1] === 'web_api' && c.body.params?.[2] === `get_${section}`).length, 1);
    }
  } finally { await device.close(); }
}));

test('Phonebook query and selection keep their distinct documented type conventions', async () => {
  const book = reads.find(d => d.key === 'phonebook');
  const select = reads.find(d => d.key === 'phonebook_select');
  assert.deepEqual(book.schema.parse({ device: '1', type: 'ALL' }), { device: '1', type: 'ALL' });
  assert.deepEqual(select.schema.parse({ device: '1' }), { device: '1', type: '', name: '' });
  assert.equal(select.schema.safeParse({ device: '1', type: 'ALL' }).success, false);
  assert.equal(deviceReading('phonebook', { code: '0', data: '' }).state, 'empty');
  assert.equal(deviceReading('phonebook_select', { code: '5' }).state, 'unknown');
});

test('GPS position and Ping progress are interpreted without turning incomplete states into success', () => {
  const gps = deviceReading('gps', { code: -1, data: { gps_switch: 'enable', number: '1', is_good: '0' } });
  assert.equal(gps.enabled, true); assert.equal(gps.fix, 'not_fixed'); assert.equal(gps.provesLocation, false);
  assert.equal(deviceReading('ping_result', { code: '1', data: '' }).state, 'pending');
  const done = deviceReading('ping_result', { code: '0', data: '6 packets transmitted, 6 packets received, 0% packet loss' });
  assert.equal(done.state, 'complete'); assert.equal(done.lossPercent, 0); assert.equal(done.provesInternet, false);
});

test('Disabled upstream WiFi is diagnosed from authorized UCI state without exposing station keys', () => fixture(async ({ env }) => {
  const device = new T830(env);
  try {
    await assert.rejects(device.rpc('web_api', 'get_wifi_router', { noData: true }), error => {
      assert.equal(error.message, 'UBUS_ERROR_5_NO_DATA');
      assert.equal(error.details.diagnosticSummary.rootCause, 'upstream_wifi_disabled');
      assert.equal(error.details.diagnosticSummary.failure.category, 'precondition_not_met');
      assert(!JSON.stringify(error.details).includes('sta-private-key'));
      return true;
    });
  } finally { await device.close(); }
}, { stationValues: { sta0: { mode: 'sta', disabled: '1', key: 'sta-private-key' }, sta1: { mode: 'sta', disabled: '1' } } }));

test('A published service list confirms missing Share service while preserving the original RPC error', () => fixture(async ({ env, calls }) => {
  const device = new T830(env);
  try {
    await assert.rejects(device.query('share'), error => {
      assert.equal(error.message, 'RPC_ERROR_-32000');
      assert.equal(error.details.diagnosticSummary.rootCause, 'service_not_registered');
      assert.equal(error.details.diagnosticSummary.failure.category, 'service_unavailable');
      return true;
    });
    assert.equal(calls.filter(c => c.body.method === 'list').length, 1);
    assert.equal(calls.filter(c => c.body.params?.[2] === 'get_101share_status').length, 1);
  } finally { await device.close(); }
}, { shareMissing: true, serviceList: { web_api: { get_setup: {} } } }));

test('Network diagnostic starts exactly once before result polling and uses vendor flags for each phase', () => fixture(async ({ env, calls }) => {
  const device = new T830({ ...env, T830_ENABLE_WRITES: '1' });
  try {
    const start = await device.write('net_probe', { type: 'PING', addr: '127.0.0.1', time: '1' });
    assert.equal(start.status, 'submitted');
    const pending = await device.query('ping_result', { addr: 'read_ping' });
    assert.equal(pending.reading.state, 'pending');
    const done = await device.query('ping_result', { addr: 'read_ping' });
    assert.equal(done.reading.state, 'complete'); assert.equal(done.reading.lossPercent, 0);
    const requests = calls.filter(c => c.body.params?.[1] === 'netApp');
    assert.deepEqual(requests.map(c => c.body.params[3].addr), ['127.0.0.1', 'read_ping', 'read_ping']);
    assert.deepEqual(requests.map(c => new URLSearchParams(c.search).get('flag')), ['netAppStar1', 'netAppStar2', 'netAppStar2']);
  } finally { await device.close(); }
}, { probeWorkflow: true }));
