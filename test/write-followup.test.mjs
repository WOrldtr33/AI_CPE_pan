import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFollowUp } from '../src/write-followup.mjs';

const readTools = ['t830_get_ping_result', 't830_get_wifi_rt', 't830_get_signal_records', 't830_get_workmode'];
function fakeMcp(responses) {
  const calls = [];
  const next = (name, args) => { calls.push({ name, args }); const queue = responses[name]; return queue.length > 1 ? queue.shift() : queue[0]; };
  return {
    calls,
    definitions: readTools.map(name => ({ type: 'function', function: { name } })),
    writeTools: new Set(['t830_set_wifi_scan_list']),
    call: async (name, args) => next(name, args),
    executeApprovedWrite: async (name, args) => next(name, args),
  };
}
const waits = [];
const wait = async ms => { waits.push(ms); };

test('Ping is polled with read_ping until the device reports completion', async () => {
  const mcp = fakeMcp({ t830_get_ping_result: [
    { status: 'device_warning', data: { code: '1', data: '' } },
    { status: 'returned', data: { code: '0', data: '4 packets transmitted, 4 received, 0% packet loss' } },
  ] });
  const followUp = await collectFollowUp({ name: 't830_set_net_probe', args: { type: 'PING', addr: '8.8.8.8' }, result: { status: 'submitted', data: { code: '0' } }, mcp, wait });
  assert.deepEqual(mcp.calls.map(c => c.args), [{ addr: 'read_ping' }, { addr: 'read_ping' }]);
  assert.equal(followUp.steps[0].complete, true);
  assert.equal(followUp.steps[0].attempts, 2);
  assert.match(followUp.steps[0].result.data.data, /0% packet loss/);
});

test('Traceroute that never finishes stops at its limit and is reported incomplete', async () => {
  const mcp = fakeMcp({ t830_get_ping_result: [{ status: 'device_warning', data: { code: '1', data: '' } }] });
  const followUp = await collectFollowUp({ name: 't830_set_net_probe', args: { type: 'Traceroute', addr: '8.8.8.8' }, result: { status: 'submitted', data: { code: '0' } }, mcp, wait });
  assert.equal(followUp.steps[0].complete, false);
  assert.equal(followUp.steps[0].attempts, mcp.calls.length);
  assert(mcp.calls.length > 5 && mcp.calls.length < 100);
});

test('Probe rejected by the device is not polled', async () => {
  const mcp = fakeMcp({ t830_get_ping_result: [{ status: 'returned', data: { code: '0' } }] });
  const followUp = await collectFollowUp({ name: 't830_set_net_probe', args: { type: 'PING', addr: 'x' }, result: { status: 'device_warning', data: { code: '2' } }, mcp, wait });
  assert.equal(mcp.calls.length, 0);
  assert.deepEqual(followUp.steps, []);
});

test('Confirmed upstream WiFi scan fetches the scan list without a second proposal', async () => {
  const mcp = fakeMcp({ t830_set_wifi_scan_list: [
    { status: 'submitted', data: { code: 0, data: { scanlist_5g: [], scanlist_2g: [] } } },
    { status: 'submitted', data: { code: 0, data: { scanlist_5g: [{ ssid: 'office', rssi: '-60' }], scanlist_2g: [] } } },
  ] });
  const followUp = await collectFollowUp({ name: 't830_set_wifi_scan_start', args: { async: '1', state: '1' }, result: { status: 'submitted', data: { code: 0 } }, mcp, wait });
  assert.deepEqual(mcp.calls.map(c => c.args), [{ state: '2' }, { state: '2' }]);
  assert.equal(followUp.steps[0].complete, true);
  assert.equal(followUp.steps[0].result.data.data.scanlist_5g[0].ssid, 'office');
});

test('Upstream WiFi connect keeps polling through a dropped response until it has an IP', async () => {
  const mcp = fakeMcp({ t830_get_wifi_rt: [
    { status: 'error', error: 'UBUS_ERROR_5_NO_DATA' },
    { status: 'returned', data: { data: { info: { enabled: '1', ap_ssid: 'office' }, status: { status: 'connected', ip: '10.0.0.8' } } } },
  ] });
  const followUp = await collectFollowUp({ name: 't830_set_wifi_router_connect', args: { ap_ssid: 'office' }, result: { status: 'error', error: 'DEVICE_UNREACHABLE' }, mcp, wait });
  assert.equal(followUp.steps[0].complete, true);
  assert.equal(followUp.steps[0].result.data.data.status.ip, '10.0.0.8');
});

test('Submitted writes with a readback interface are read once; verified and no-readback writes are not', async () => {
  const mcp = fakeMcp({ t830_get_signal_records: [{ status: 'returned', data: { data: [{ index: '3', sigal: '-82 dBm' }] } }] });
  const read = await collectFollowUp({ name: 't830_set_signal_start', args: {}, result: { status: 'submitted', data: { code: '0', sigal: '-82 dBm' } }, mcp, wait });
  assert.equal(read.steps.length, 1);
  assert.equal(read.steps[0].tool, 't830_get_signal_records');
  assert.equal(read.steps[0].attempts, 1);
  mcp.calls.length = 0;
  assert.deepEqual((await collectFollowUp({ name: 't830_set_wifi_config', args: {}, result: { status: 'verified_fields' }, mcp, wait })).steps, []);
  assert.deepEqual((await collectFollowUp({ name: 't830_set_reboot', args: { reboot: '1' }, result: { status: 'submitted' }, mcp, wait })).steps, []);
  assert.equal(mcp.calls.length, 0);
});

test('Work mode change is polled until the readback shows the requested mode', async () => {
  const mcp = fakeMcp({ t830_get_workmode: [
    { status: 'returned', data: { data: { workmode: 0 } } },
    { status: 'returned', data: { data: { workmode: 5 } } },
  ] });
  const followUp = await collectFollowUp({ name: 't830_set_workmode', args: { workmode: 5, bonding: '0' }, result: { status: 'submitted' }, mcp, wait });
  assert.equal(followUp.steps[0].complete, true);
  assert.equal(followUp.steps[0].attempts, 2);
});
