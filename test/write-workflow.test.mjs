import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeReport } from '../src/artifacts.mjs';
import { T830, redact } from '../src/t830.mjs';
import { reads, writes } from '../src/catalog.mjs';
import { writeProfiles } from '../src/write-profiles.mjs';
const reports = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function fixture(fn, plan = {}) {
  const state = JSON.parse(
    await readFile(new URL('./fixtures/read-responses.json', import.meta.url), 'utf8'),
  );
  state.wifi_night = { action: 'Disable', openTime: '', closeTime: '', code: 200 };
  state.roaming = { action: 'Disable', code: 200 };
  state.gps = { data: { gps_switch: 'disable' }, code: 0 };
  // 此场景明确模拟无 SIM 的统计告警，不依赖共享样本当前是否插卡。
  if (plan.mode === 'unit_equivalent') state.traffic.stats.code = '206';
  for (const band of ['5G', '2.4G'])
    Object.assign(state.wifi[band], {
      ssid: `original-${band}`,
      wpapsk: 'original-secret',
    });
  for (const band of ['Guest', 'Guest5G'])
    Object.assign(state.guest[band], {
      ssid: `original-${band}`,
      wpapsk: 'original-secret',
    });
  let generation = 0,
    writesSeen = 0,
    readsAfterWrite = 0,
    upnpReads = 0,
    pending;
  const calls = [],
    entered = deferred(),
    release = deferred();
  const apply = (key, args) => {
    if (key === 'wifi_switch') state.wifi[args.name].state = args.action;
    if (key === 'guest_switch') state.guest[args.name].state = args.action;
    if (key === 'wifi_config')
      for (const band of ['5G', '2.4G']) Object.assign(state.wifi[band], args[band]);
    if (key === 'guest_config')
      for (const band of ['Guest', 'Guest5G'])
        Object.assign(state.guest[band], args[band]);
    if (key === 'wifi_night') Object.assign(state.wifi_night, args);
    if (key === 'roaming') Object.assign(state.roaming, args);
    if (key === 'apn_save') {
      const list = state.apn.manual.apn_list;
      const i = list.findIndex((r) => r.config_file === args.config_file);
      if (i < 0) list.push({ ...args });
      else list[i] = { ...args };
    }
    if (key === 'upnp') state.upnp.data.upnp_switch = args.upnp_switch;
    if (key === 'dns') state.dns.data = args.rebind_protection;
    if (key === 'gps')
      state.gps.data.gps_switch = args.gps_switch === '1' ? 'enable' : 'disable';
    if (key === 'traffic') Object.assign(state.traffic.cfgs, args);
  };
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    const path = new URL(req.url, 'http://mock').pathname,
      service = body.params?.[1],
      method = body.params?.[2],
      args = body.params?.[3] || body;
    const writer = path.endsWith('action_login') || path.endsWith('action_logout') ? undefined : writes.find((d) =>
      d.transport === 'ubus'
        ? d.service === service && d.method === method && d.schema.safeParse(args).success
        : d.path === path && d.schema.safeParse(body).success,
    );
    const reader = reads.find((d) =>
      d.transport === 'ubus'
        ? d.service === service && d.method === method
        : d.path === path,
    );
    calls.push({
      key: writer?.key || reader?.key || method || 'login',
      kind: writer ? 'write' : 'read',
      args,
    });
    res.setHeader('Content-Type', 'application/json');
    const send = (x) => res.end(JSON.stringify(x));
    if (path.includes('action_login')) {
      generation++;
      res.setHeader('Set-Cookie', `sysauth_http=test-${generation}; Path=/`);
      return send({ code: 0, sessionid: `test-${generation}` });
    }
    if (service === 'session' && method === 'access')
      return send({
        result: [
          0,
          {
            access:
              body.params[0] === `test-${generation}` &&
              !(plan.mode === 'denied' && args.function === 'set_wifi_switch'),
          },
        ],
      });
    if (path === '/ubus/' && body.params[0] !== `test-${generation}`)
      return send({ error: { code: -32002, message: 'Access denied' } });
    if (writer) {
      writesSeen++;
      entered.resolve();
      if (plan.mode === 'hold') await release.promise;
      if (plan.mode === 'denied')
        return send({ error: { code: -32002, message: 'Access denied' } });
      if (plan.mode === 'auth_once' && writesSeen === 1) {
        generation++;
        res.statusCode = 403;
        res.setHeader('x-luci-login-required', 'yes');
        return send({});
      }
      if (plan.mode === 'cgi_forbidden') {
        res.statusCode = 403;
        return send({});
      }
      if (plan.mode === 'warning') return send({ code: 206 });
      if (plan.mode === 'not_modified') return send({ result: [0, { code: 409 }] });
      if (plan.mode === 'advanced_partial')
        return send({ result: [0, { wmm_state: '409', '5G': { code: '409' }, '2.4G': { code: '409' }, isolate: '200', base_code: '409' }] });
      if (plan.mode === 'advanced_busy') return send({ result: [0, { result: '500' }] });
      if (plan.mode === 'advanced_unchanged')
        return send({ result: [0, { wmm_state: '409', '5G': { code: '409' }, '2.4G': { code: '409' }, isolate: '409', base_code: '409' }] });
      if (plan.mode === 'lost_unapplied') {
        res.destroy();
        return;
      }
      if (
        plan.mode === 'never_apply' ||
        (plan.mode === 'ack_unchanged_once' && writesSeen === 1)
      ) {
      } else if (plan.mode === 'delayed') pending = () => apply(writer.key, args);
      else apply(writer.key, args);
      if (plan.mode === 'partial') state.wifi['2.4G'].ssid = 'external-name';
      if (plan.mode === 'lost_applied') {
        res.destroy();
        return;
      }
      if (['wifi_partial_busy', 'wifi_always_busy'].includes(plan.mode) && writer.key === 'wifi_config')
        return send({ result: [0, { '2.4G_code': '200', '5G_code': '409' }] });
      return send(
        writer.transport === 'ubus' ? { result: [0, { code: 200 }] } : { code: 0 },
      );
    }
    if (reader) {
      if (reader.key === 'upnp') {
        upnpReads++;
        if (plan.mode === 'pre_conflict' && upnpReads === 2)
          state.upnp.data.upnp_switch = '1';
        if (plan.mode === 'before_retry_conflict' && upnpReads === 5)
          state.upnp.data.upnp_switch = '1';
      }
      if (writesSeen) {
        readsAfterWrite++;
        if (pending && readsAfterWrite >= 2) {
          pending();
          pending = null;
        }
      }
      if (reader.key === 'wifi' && writesSeen && (plan.mode === 'wifi_always_busy' || (plan.mode === 'wifi_partial_busy' && readsAfterWrite <= 2)))
        return send({ result: [0, { result: '500' }] });
      if (plan.mode === 'unknown_readback' && writesSeen)
        return send(
          reader.transport === 'ubus' ? { result: [0, { code: 0 }] } : { code: 0 },
        );
      if (plan.mode === 'masked' && reader.key === 'wifi')
        for (const b of ['5G', '2.4G']) state.wifi[b].wpapsk = '********';
      if (plan.mode === 'bad_schema' && reader.key === 'dns')
        return send({ code: 0, data: { unknown: 1 } });
      if (plan.mode === 'unit_equivalent' && reader.key === 'traffic' && writesSeen) {
        state.traffic.cfgs.day_limit = '1024MB';
        state.traffic.cfgs.month_limit = '2147483648';
      }
      return send(
        reader.transport === 'ubus'
          ? { result: [0, state[reader.key]] }
          : state[reader.key],
      );
    }
    send({ code: 0 });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    T830_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    T830_PASSWORD: 'test-only',
    T830_ENABLE_WRITES: '1',
    T830_COOKIE_MODE: 'always',
    T830_TIMEOUT_MS: '500',
    T830_WRITE_READBACK_ATTEMPTS: '3',
    T830_WRITE_READBACK_INTERVAL_MS: '5',
    T830_WRITE_BUSY_POLL_MS: '5',
    ...(plan.mode === 'wifi_always_busy' ? { T830_WRITE_BUSY_WAIT_MS: '50' } : {}),
  };
  try {
    await fn({ device: new T830(env), calls, state, entered, release, env });
  } finally {
    release.resolve();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
for (const def of writes.filter((d) => writeProfiles[d.key])) {
  test(`write ${def.key}: ordinary entry executes preflight, submits, and verifies mapped fields`, () =>
    fixture(async ({ device, calls }) => {
      const result = await device.write(def.key, def.sample);
      assert.equal(result.status, 'verified_fields');
      assert.equal(result.verification.state, 'applied');
      assert.equal(result.writeAttempts, 1);
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
      assert(
        result.diagnostics.some(
          (t) => t.step === 'readback' && t.phase === 'before_write',
        ),
      );
      reports.push({ section: def.key, mode: 'mock', result });
    }));
}
test('GPS without position fix (code -1) still verifies the switch field', () =>
  fixture(async ({ device, calls, state }) => {
    state.gps.code = -1;
    const result = await device.write('gps', { gps_switch: '1' });
    assert.equal(result.status, 'verified_fields');
    assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
  }));
test('GPS with another warning code stops before writing', () =>
  fixture(async ({ device, calls, state }) => {
    state.gps.code = -2;
    await assert.rejects(device.write('gps', { gps_switch: '1' }), /WORKFLOW_READ_WARNING/);
    assert.equal(calls.filter((c) => c.kind === 'write').length, 0);
  }));
test('lost response after applied write succeeds by readback without duplicate write', () =>
  fixture(
    async ({ device, calls }) => {
      const result = await device.write('upnp', { upnp_switch: '1' });
      assert.equal(result.status, 'verified_fields');
      assert.equal(result.submissionOutcome, 'error_but_state_confirmed');
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
      reports.push({ section: 'upnp', scenario: 'lost_response_applied', result });
    },
    { mode: 'lost_applied' },
  ));
test('lost response with unchanged readback remains unknown and is not resent', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(device.write('upnp', { upnp_switch: '1' }), (e) => {
        assert.equal(e.message, 'WRITE_RESULT_UNKNOWN');
        assert.equal(e.details.writeAttempts, 1);
        reports.push({
          scenario: 'lost_response_unapplied',
          error: e.message,
          details: e.details,
        });
        return true;
      });
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'lost_unapplied' },
  ));
test('acknowledged unchanged absolute setting gets one bounded retry and succeeds', () =>
  fixture(
    async ({ device, calls }) => {
      const result = await device.write('upnp', { upnp_switch: '1' });
      assert.equal(result.writeAttempts, 2);
      assert(result.diagnostics.some((t) => t.step === 'retry_reason'));
      assert.equal(calls.filter((c) => c.kind === 'write').length, 2);
      reports.push({ scenario: 'acknowledged_unchanged_retry', result });
    },
    { mode: 'ack_unchanged_once' },
  ));
test('delayed effectiveness polls before considering another write', () =>
  fixture(
    async ({ device, calls }) => {
      const result = await device.write('upnp', { upnp_switch: '1' });
      assert.equal(result.writeAttempts, 1);
      assert.equal(
        result.diagnostics.filter(
          (t) => t.step === 'readback' && t.phase === 'verification',
        ).length,
        2,
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'delayed' },
  ));
test('bounded retries stop at configured attempt count', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(
        device.write('upnp', { upnp_switch: '1' }),
        (e) => e.message === 'WRITE_VERIFICATION_FAILED' && e.details.writeAttempts === 2,
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 2);
    },
    { mode: 'never_apply' },
  ));
test('full WiFi configuration is not resent just because it remains unchanged', () =>
  fixture(
    async ({ device, calls }) => {
      const def = writes.find((d) => d.key === 'wifi_config');
      await assert.rejects(
        device.write(def.key, def.sample),
        /WRITE_VERIFICATION_FAILED/,
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'never_apply' },
  ));
test('confirmed auth rejection can recover session and retry after readback', () =>
  fixture(
    async ({ device, calls }) => {
      const result = await device.write('upnp', { upnp_switch: '1' });
      assert.equal(result.writeAttempts, 2);
      assert.equal(calls.filter((c) => c.key === 'login').length, 2);
      assert(
        result.diagnostics.some((t) => t.step === 'write_diagnosis' && t.authRejected),
      );
    },
    { mode: 'auth_once' },
  ));
test('permanent UBUS write denial logs target and control access and never retries', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(
        device.write('wifi_switch', { name: '5G', action: 'down' }),
        (e) => {
          assert.equal(e.message, 'RPC_ERROR_-32002');
          assert.equal(e.details.confirmedReason, 'target_permission_denied');
          assert(
            e.details.diagnostics.some(
              (t) => t.purpose === 'target_write_permission' && t.data.access === false,
            ),
          );
          reports.push({
            scenario: 'write_permission_denied',
            error: e.message,
            details: e.details,
          });
          return true;
        },
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'denied' },
  ));
test('CGI 403 without auth evidence is recorded and not guessed into a login retry', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(device.write('upnp', { upnp_switch: '1' }), /HTTP_403/);
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
      assert.equal(calls.filter((c) => c.key === 'login').length, 1);
    },
    { mode: 'cgi_forbidden' },
  ));
test('failed write business code still triggers readback and retains warning', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(
        device.write('upnp', { upnp_switch: '1' }),
        (e) =>
          e.message === 'WORKFLOW_WRITE_WARNING' &&
          e.details.verification.state === 'unchanged_observed',
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
      assert(calls.filter((c) => c.key === 'upnp' && c.kind === 'read').length >= 3);
    },
    { mode: 'warning' },
  ));
test('unavailable readback stops resubmission and returns unknown', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(
        device.write('upnp', { upnp_switch: '1' }),
        /WRITE_RESULT_UNKNOWN/,
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'unknown_readback' },
  ));
test('unsupported baseline schema fails before device write', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(
        device.write('dns', { rebind_protection: '1' }),
        (e) =>
          e.message === 'INVALID_BUSINESS_RESPONSE' &&
          e.details.validation.status === 'failed',
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 0);
    },
    { mode: 'bad_schema' },
  ));
test('external write before submission stops without overriding it', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(device.write('upnp', { upnp_switch: '1' }), /CONFIG_CONFLICT/);
      assert.equal(calls.filter((c) => c.kind === 'write').length, 0);
    },
    { mode: 'pre_conflict' },
  ));
test('partial WiFi change or external interference is not repaired by repeating write', () =>
  fixture(
    async ({ device, calls }) => {
      const def = writes.find((d) => d.key === 'wifi_config');
      await assert.rejects(
        device.write(def.key, def.sample),
        (e) =>
          e.message === 'WRITE_VERIFICATION_FAILED' &&
          e.details.verification.state === 'conflict_or_partial',
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'partial' },
  ));
test('sensitive fields compare raw in memory; results show passwords while reports stay redacted', () =>
  fixture(async ({ device }) => {
    const config = structuredClone(writes.find((d) => d.key === 'wifi_config').sample);
    for (const band of ['5G', '2.4G'])
      Object.assign(config[band], {
        ssid: 'private-network',
        authmode: 'WPA2PSK',
        wpapsk: 'private-password',
      });
    const result = await device.write('wifi_config', config);
    assert.equal(result.status, 'verified_fields');
    assert(JSON.stringify(result).includes('private-password'));
    const json = JSON.stringify(redact(result));
    assert(!json.includes('private-password'));
    assert(!json.includes('original-secret'));
    reports.push({ scenario: 'sensitive_fields', result });
  }));
test('masked password cannot be claimed verified and cannot cause an unsafe repeat', () =>
  fixture(
    async ({ device, calls }) => {
      const config = structuredClone(writes.find((d) => d.key === 'wifi_config').sample);
      for (const band of ['5G', '2.4G'])
        Object.assign(config[band], { authmode: 'WPA2PSK', wpapsk: 'private-password' });
      await assert.rejects(
        device.write('wifi_config', config),
        (e) =>
          e.message === 'WRITE_RESULT_UNKNOWN' &&
          e.details.verification.comparisons.unknown.length === 2,
      );
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'masked' },
  ));
test('traffic config can be verified without SIM, including byte/MB/GB equivalence', () =>
  fixture(
    async ({ device }) => {
      const result = await device.write('traffic', {
        day_limit: '1GB',
        month_limit: '2GB',
        start_day: '1',
      });
      assert.equal(result.status, 'verified_fields');
      assert(result.steps.some((s) => s.output.status === 'device_warning'));
    },
    { mode: 'unit_equivalent' },
  ));
test('concurrent different writes complete as whole FIFO workflows', () =>
  fixture(
    async ({ device, calls, entered, release }) => {
      const first = device.write('upnp', { upnp_switch: '1' });
      await entered.promise;
      const second = device.write('dns', { rebind_protection: '1' });
      release.resolve();
      const results = await Promise.all([first, second]);
      assert(results.every((r) => r.status === 'verified_fields'));
      const firstDns = calls.findIndex((c) => c.key === 'dns');
      const lastUpnp = calls.map((c) => c.key).lastIndexOf('upnp');
      assert(firstDns > lastUpnp);
    },
    { mode: 'hold' },
  ));
test('cancelled write workflow does not run later phases or duplicate submission', () =>
  fixture(
    async ({ device, entered, calls }) => {
      const c = new AbortController();
      const active = device.write('upnp', { upnp_switch: '1' }, { signal: c.signal });
      const check = assert.rejects(active, /CALL_CANCELLED/);
      await entered.promise;
      c.abort();
      await check;
      assert.equal(calls.filter((c) => c.kind === 'write').length, 1);
    },
    { mode: 'hold' },
  ));
test('documented 409 no-change response is distinguished from uncertain submission', () =>
  fixture(async ({ device, calls }) => {
    const result = await device.write('wifi_night', { action: 'Disable' });
    assert.equal(result.status, 'verified_fields');
    assert.equal(result.submissionOutcome, 'not_modified');
    assert.equal(result.alreadyMatchedBeforeWrite, true);
    assert.equal(calls.filter(call => call.kind === 'write').length, 1);
  }, { mode: 'not_modified' }));
const advancedArgs = { country_code: 'ZA', trans_power: '2', isolate: '1', wmm_state: '1', '5G': { wireless_mode: '23', band_width: '3', channel: '0' }, '2.4G': { wireless_mode: '22', band_width: '1', channel: '0' } };
test('advanced WiFi per-field 200 with other parts 409 is reported as modified, not unchanged', () =>
  fixture(async ({ device }) => {
    const result = await device.write('wifi_advanced', advancedArgs);
    assert.equal(result.status, 'submitted');
    assert.equal(result.businessOutcome, 'modified');
    assert.deepEqual(result.appliedParts, ['isolate']);
    assert.deepEqual(result.unchangedParts.sort(), ['2.4G.code', '5G.code', 'base_code', 'wmm_state']);
    assert.deepEqual(result.warnings, []);
  }, { mode: 'advanced_partial' }));
test('advanced WiFi with every part 409 stays not_modified', () =>
  fixture(async ({ device }) => {
    const result = await device.write('wifi_advanced', advancedArgs);
    assert.equal(result.status, 'device_warning');
    assert.equal(result.businessOutcome, 'not_modified');
    assert.equal(result.warnings.length, 5);
  }, { mode: 'advanced_unchanged' }));
const ssidArgs = {
  '2.4G': { hidden: '0', ssid: 'renamed-24', state: 'up', authmode: 'WPA2PSK', wpapsk: 'original-secret' },
  '5G': { hidden: '0', ssid: 'original-5G', state: 'up', authmode: 'WPA2PSK', wpapsk: 'original-secret' },
};
test('WiFi config per-band 200/409 counts as modified and readback waits out device busy', () =>
  fixture(async ({ device, state, calls }) => {
    for (const band of ['5G', '2.4G']) state.wifi[band].authmode = 'WPA2PSK';
    const result = await device.write('wifi_config', ssidArgs);
    assert.equal(result.status, 'verified_fields');
    assert.equal(result.submissionOutcome, 'acknowledged');
    assert.equal(result.diagnostics.filter(step => step.step === 'device_busy_wait').length, 2);
    assert.equal(calls.filter(call => call.kind === 'write').length, 1);
  }, { mode: 'wifi_partial_busy' }));
test('WiFi config readback busy past the wait limit is reported as unknown, not retried', () =>
  fixture(async ({ device, state, calls }) => {
    for (const band of ['5G', '2.4G']) state.wifi[band].authmode = 'WPA2PSK';
    await assert.rejects(device.write('wifi_config', ssidArgs), /WRITE_RESULT_UNKNOWN/);
    assert.equal(calls.filter(call => call.kind === 'write').length, 1);
  }, { mode: 'wifi_always_busy' }));
test('WiFi SSID-only patch is completed from raw readback without the model supplying passwords', () =>
  fixture(async ({ device, state, calls }) => {
    const result = await device.write('wifi_config', { '5G': { ssid: '我爱上班1' } });
    assert.equal(result.status, 'verified_fields');
    assert.deepEqual(result.verification.fields, ['5G.ssid']);
    const [submitted] = calls.filter((call) => call.kind === 'write');
    assert.deepEqual(submitted.args, {
      '2.4G': { hidden: '0', ssid: 'original-2.4G', state: 'up', authmode: 'WPA2PSKWPA3PSK', wpapsk: 'original-secret' },
      '5G': { hidden: '0', ssid: '我爱上班1', state: 'up', authmode: 'WPA2PSKWPA3PSK', wpapsk: 'original-secret' },
    });
    assert.equal(state.wifi['5G'].ssid, '我爱上班1');
    assert(!JSON.stringify(redact(result)).includes('original-secret'));
  }));
test('WiFi patch stops before writing when the existing password readback is masked', () =>
  fixture(
    async ({ device, calls }) => {
      await assert.rejects(device.write('wifi_config', { '5G': { ssid: 'renamed' } }), (e) => {
        assert.equal(e.message, 'WRITE_BASELINE_INCOMPLETE');
        assert.deepEqual(e.details.fields, ['2.4G.wpapsk', '5G.wpapsk']);
        return true;
      });
      assert.equal(calls.filter((call) => call.kind === 'write').length, 0);
    },
    { mode: 'masked' },
  ));
test('WiFi patch rejects empty requests before touching the device', () =>
  fixture(async ({ device, calls }) => {
    const def = writes.find((d) => d.key === 'wifi_config');
    assert(!def.schema.safeParse({ '5G': {} }).success);
    assert(def.schema.safeParse({ '5G': { ssid: 'x' } }).success);
    await assert.rejects(device.write('wifi_config', {}), /WRITE_NO_FIELDS/);
    assert.equal(calls.length, 0);
  }));
test('advanced WiFi busy result=500 is a device warning, not a submission', () =>
  fixture(async ({ device }) => {
    const result = await device.write('wifi_advanced', advancedArgs);
    assert.equal(result.status, 'device_warning');
    assert.equal(result.businessOutcome, undefined);
    assert.deepEqual(result.warnings, [{ field: 'result', value: '500' }]);
  }, { mode: 'advanced_busy' }));

test('write policy settings reject invalid ranges', () => {
  for (const env of [
    { T830_WRITE_MAX_ATTEMPTS: '0' },
    { T830_WRITE_MAX_ATTEMPTS: '4' },
    { T830_WRITE_READBACK_ATTEMPTS: '6' },
    { T830_WRITE_READBACK_INTERVAL_MS: '-1' },
  ])
    assert.throws(() => new T830(env));
});
test('save representative mock write outcomes without credentials', async () => {
  await writeReport(
    'mock/write-mock-results.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: 'mock-only',
        realDeviceModified: false,
        records: reports,
      },
      null,
      2,
    ),
  );
  const saved = await readFile(new URL('../reports/mock/write-mock-results.json', import.meta.url), 'utf8');
  assert(saved.includes('private-network'));
  assert(!saved.includes('private-password'));
  assert(!saved.includes('original-secret'));
});
