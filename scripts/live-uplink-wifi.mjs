import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { timestamp } from '../src/time.mjs';
import { writeReport } from '../src/artifacts.mjs';
import { redact } from '../src/t830.mjs';

// 通过真实 MCP 调用测试上游 WiFi：扫描 → 切 WLAN router 模式 → 连接 → 回读 → 断开 → 恢复原工作模式。
// 上游密码只从 T830_UPLINK_PASSWORD 读取，报告中脱敏。
const ssid = process.argv[2];
const uplinkPassword = process.env.T830_UPLINK_PASSWORD;
if (!ssid || process.argv[3] !== '--apply' || !uplinkPassword)
  throw new Error('Usage: T830_UPLINK_PASSWORD=... node scripts/live-uplink-wifi.mjs <ssid> --apply');
const day = timestamp().slice(0, 10);
const reportPath = `live/uplink-wifi-${day}/result.json`;
const serverPath = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const report = { at: timestamp(), ssid, records: [], results: [] };
const client = new Client({ name: 'live-uplink-wifi', version: '1' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, T830_ENABLE_WRITES: '1', T830_UPLINK_PASSWORD: '' },
  stderr: 'inherit',
}));
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const text = response.content?.find((c) => c.type === 'text')?.text || '';
  let output = response.structuredContent;
  if (!output) try { output = JSON.parse(text); } catch { output = { error: text.slice(0, 300) }; }
  report.records.push({ at: timestamp(), tool: name, args: redact(args), isError: !!response.isError, output });
  return { ok: !response.isError, output, data: output.data };
};
const record = (step, outcome, detail = {}) => {
  report.results.push({ at: timestamp(), step, outcome, ...detail });
  console.log(outcome.padEnd(8), step, JSON.stringify(redact(detail)).slice(0, 400));
};
const poll = async (read, done, limitMs, intervalMs = 5000) => {
  const started = Date.now();
  let last;
  while (Date.now() - started < limitMs) {
    try { last = await read(); if (done(last)) return { ok: true, seconds: Math.round((Date.now() - started) / 1000), last }; } catch (e) { last = { error: e.message }; }
    await delay(intervalMs);
  }
  return { ok: false, seconds: Math.round((Date.now() - started) / 1000), last };
};
const readWorkmode = async () => {
  const r = await call('t830_get_workmode');
  if (!r.ok) throw new Error(r.output.error || 'READ_WORKMODE_FAILED');
  return r.data.data;
};
const readRouter = async () => {
  const r = await call('t830_get_wifi_rt');
  if (!r.ok && /NO_DATA/.test(r.output.error || '')) return { error: 'NO_DATA' };
  if (!r.ok) throw new Error(r.output.error || 'READ_WIFI_RT_FAILED');
  return r.data.data;
};
const routerSummary = (rt) => ({
  enabled: rt?.info?.enabled, ap_ssid: rt?.info?.ap_ssid, wifi_index: rt?.info?.wifi_index,
  status: rt?.status?.status, hasIp: !!rt?.status?.ip, error: rt?.error,
});
const setWorkmode = async (base, workmode) => {
  const w = await call('t830_set_workmode', {
    workmode, bonding: String(base.bonding),
    add_ccmni_to_bridge: String(base.add_ccmni_to_bridge), ip_passthrough: String(base.ip_passthrough),
  });
  const applied = await poll(readWorkmode, (m) => Number(m.workmode) === workmode, 90000);
  record(`t830_set_workmode -> ${workmode}`, w.ok && w.data?.code === 0 && applied.ok ? 'passed' : 'failed',
    { writeStatus: w.output.status, deviceCode: w.data?.code, writeError: w.output.error, appliedAfterSeconds: applied.seconds, readback: applied.last });
  return w.ok && applied.ok;
};
const scan = async (label) => {
  const start = await call('t830_set_wifi_scan_start', { async: '1', state: '1' });
  if (!start.ok || start.data?.code !== 0) {
    record(`${label} t830_set_wifi_scan_start`, 'failed', { writeStatus: start.output.status, deviceCode: start.data?.code, writeError: start.output.error });
    return null;
  }
  record(`${label} t830_set_wifi_scan_start`, 'passed', { deviceCode: start.data.code });
  for (let attempt = 1; attempt <= 4; attempt++) {
    await delay(attempt === 1 ? 8000 : 4000);
    const list = await call('t830_set_wifi_scan_list', { state: '2' });
    if (!list.ok || list.data?.code !== 0) continue;
    const entries = (key, index) => (Array.isArray(list.data.data?.[key]) ? list.data.data[key] : []).map((e) => ({ ...e, index }));
    const all = [...entries('scanlist_5g', '1'), ...entries('scanlist_2g', '2')].filter((e) => e.ssid);
    const target = all.find((e) => e.ssid === ssid);
    record(`${label} t830_set_wifi_scan_list`, all.length ? 'passed' : 'failed', {
      attempt, networks: all.length, count5g: entries('scanlist_5g', '1').length, count2g: entries('scanlist_2g', '2').length,
      target: target ? { channel: target.channel, index: target.index, encrypt: target.encrypt, auth: target.auth, rssi: target.rssi, mode: target.mode } : null,
    });
    if (all.length) return target || false;
  }
  record(`${label} t830_set_wifi_scan_list`, 'failed', { reason: 'no_networks_after_retries' });
  return null;
};

let baseline;
try {
  baseline = await readWorkmode();
  report.baselineWorkmode = baseline;
  report.baselineRouter = routerSummary(await readRouter());
  record('baseline', 'info', { workmode: baseline.workmode, router: report.baselineRouter });

  await scan(`mode${baseline.workmode}`);

  if (Number(baseline.workmode) !== 5 && !(await setWorkmode(baseline, 5))) throw new Error('SWITCH_TO_WLAN_ROUTER_FAILED');
  const target = await scan('mode5');
  if (!target) throw new Error(target === false ? 'TARGET_SSID_NOT_FOUND' : 'SCAN_FAILED');

  const connect = await call('t830_set_wifi_router_connect', {
    ap_ssid: target.ssid, ap_password: target.auth === 'OPEN' ? '' : uplinkPassword,
    channel: String(target.channel), wifi_index: target.index, encrypt: String(target.encrypt), auth: String(target.auth),
  });
  const connectCode = connect.data?.code;
  const transportError = ['DEVICE_TIMEOUT', 'DEVICE_UNREACHABLE'].includes(connect.output.error);
  if (!transportError && (!connect.ok || connectCode !== 0)) {
    record('t830_set_wifi_router_connect', 'failed', { writeStatus: connect.output.status, deviceCode: connectCode, writeError: connect.output.error, channelInterference: connectCode === 10 });
  } else {
    await delay(20000);
    const up = await poll(readRouter, (rt) => rt.info?.enabled === '1' && rt.status?.status === 'connected' && rt.info?.ap_ssid !== '' && !!rt.status?.ip, 120000);
    record('t830_set_wifi_router_connect', up.ok ? 'passed' : 'failed', { deviceCode: connectCode, writeError: connect.output.error, connectedAfterSeconds: up.ok ? up.seconds + 20 : null, router: routerSummary(up.last) });
    report.connectedRouterRaw = redact(up.last);

    const disconnect = await call('t830_set_wifi_router_disconnect', { connect: '0' });
    const down = await poll(readRouter, (rt) => rt.status?.status !== 'connected', 60000);
    record('t830_set_wifi_router_disconnect', disconnect.ok && disconnect.data?.code === 0 && down.ok ? 'passed' : 'failed',
      { writeStatus: disconnect.output.status, deviceCode: disconnect.data?.code, writeError: disconnect.output.error, disconnectedAfterSeconds: down.seconds, router: routerSummary(down.last) });
  }
} catch (e) {
  record('run', 'error', { error: e.message });
} finally {
  if (baseline && Number(baseline.workmode) !== 5) {
    try {
      const current = await readWorkmode().catch(() => null);
      if (!current || Number(current.workmode) !== Number(baseline.workmode)) await setWorkmode(baseline, Number(baseline.workmode));
      report.finalWorkmode = await readWorkmode();
      report.finalRouter = routerSummary(await readRouter());
      record('final', 'info', { workmode: report.finalWorkmode.workmode, router: report.finalRouter });
    } catch (e) { record('restore', 'error', { error: e.message }); }
  }
  await writeReport(reportPath, `${JSON.stringify(report, (k, v) => (k === 'bssid' && v ? '[REDACTED]' : v), 2)}\n`);
  console.log('report', reportPath);
  await client.close();
}
