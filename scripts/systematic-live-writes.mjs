import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads, writes, toolName } from '../src/catalog.mjs';
import { redact } from '../src/t830.mjs';

const directory = new URL('../reports/live/systematic-writes-2026-10-20/', import.meta.url);
const report = { at: new Date().toISOString(), mode: 'live', records: [], cases: [], coverage: writes.map(def => ({ tool: toolName(def), live: 'pending', reason: '需要完整基线、有效测试数据和恢复条件' })) };
await mkdir(directory, { recursive: true });
const save = () => writeFile(new URL('independent-mcp.json', directory), JSON.stringify(redact(report), null, 2));
const mark = (key, live, reason) => Object.assign(report.coverage.find(row => row.tool === 't830_set_' + key), { live, reason });
const payload = result => result?.data?.data ?? result?.data;
const acknowledged = result => result.status === 'submitted' || (['verified_field', 'verified_fields'].includes(result.status) && result.submissionOutcome === 'acknowledged');
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ ordinaryWrites: writes.length, required: ['--apply', 'T830_PASSWORD'], optional: ['T830_DEVELOPER_KEY'], reboot: 'append --reboot to execute once after recoverable writes', tools: report.coverage }, null, 2));
  process.exit(0);
}
if (!process.env.T830_PASSWORD) throw new Error('T830_PASSWORD_REQUIRED_USE_POWERSHELL_LAUNCHER');
let mcp;
async function call(key, args = {}, write = false) {
  const name = `t830_${write ? 'set' : 'get'}_${key}`;
  let result;
  try { result = write ? await mcp.executeApprovedWrite(name, args) : await mcp.call(name, args); }
  catch (error) { result = { status: 'error', error: error.message }; }
  report.records.push({ name, write, args, output: result });
  await save();
  console.log(`${name}: ${result.status}${result.error ? ' / ' + result.error : ''}`);
  return result;
}
async function sameValue(key, section, build, select = payload) {
  const before = await call(section);
  if (!['returned', 'device_warning'].includes(before.status)) return mark(key, 'blocked_baseline', before.error || before.status);
  const args = build(before);
  if (!writes.find(def => def.key === key).schema.safeParse(args).success) return mark(key, 'blocked_baseline', '基线字段无法按写 schema 完整表达');
  const sent = await call(key, args, true);
  const after = await call(section);
  const unchanged = ['returned', 'device_warning'].includes(after.status) && JSON.stringify(select(before)) === JSON.stringify(select(after));
  report.cases.push({ key, kind: 'same-value-only', acknowledged: acknowledged(sent), unchanged });
  mark(key, acknowledged(sent) && unchanged ? 'same_value_only' : 'failed', sent.error || sent.status);
  if (!unchanged) throw new Error('STOP_BASELINE_CHANGED_' + key);
}
async function toggle(key, field, select) {
  const before = await call(key);
  const original = String(select(before));
  if (before.status !== 'returned' || !['0', '1'].includes(original)) return mark(key, 'blocked_baseline', before.error || '原值无效');
  const target = original === '0' ? '1' : '0';
  const record = { key, kind: 'change-and-restore', restored: false, changed: false };
  report.cases.push(record);
  try {
    const sent = await call(key, { [field]: target }, true);
    const after = await call(key);
    record.changed = acknowledged(sent) && after.status === 'returned' && String(select(after)) === target;
  } finally {
    const current = await call(key);
    if (current.status !== 'returned') throw new Error('RESTORE_READ_FAILED_' + key);
    if (String(select(current)) === target) await call(key, { [field]: original }, true);
    else if (String(select(current)) !== original) throw new Error('RESTORE_CONFLICT_' + key);
    const final = await call(key);
    record.restored = final.status === 'returned' && String(select(final)) === original;
    await save();
    if (!record.restored) throw new Error('RESTORATION_UNCONFIRMED_' + key);
  }
  mark(key, record.changed ? 'changed_and_restored' : 'failed', record.changed ? '修改、回读和恢复已完成' : '提交后未确认更改生效');
}
try {
  mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
  const initial = await call('device_info');
  if (initial.status !== 'returned') throw new Error('INITIAL_DEVICE_OR_AUTH_UNAVAILABLE');
  await toggle('upnp', 'upnp_switch', result => result.data?.data?.upnp_switch);
  await toggle('dns', 'rebind_protection', result => result.data?.data);
  await toggle('gps', 'gps_switch', result => ({ enable: '1', disable: '0' })[result.data?.data?.gps_switch] ?? result.data?.data?.gps_switch);
  for (const [section, bands] of [['wifi', ['2.4G', '5G']], ['guest', ['Guest', 'Guest5G']]]) {
    for (const band of bands) await sameValue(section + '_switch', section, result => ({ name: band, action: result.data?.[band]?.state }));
  }
  await sameValue('roaming', 'roaming', result => ({ action: result.data?.action }));
  await sameValue('wifi_night', 'wifi_night', result => Object.fromEntries(['action', 'openTime', 'closeTime'].filter(key => result.data?.[key] !== undefined).map(key => [key, result.data[key]])));
  await sameValue('traffic', 'traffic', result => {
    const config = result.data?.cfgs;
    const limit = value => /^\d+(MB|GB)$/.test(String(value)) ? String(value) : Number.isSafeInteger(Number(value)) && Number(value) % 1048576 === 0 ? `${Number(value) / 1048576}MB` : undefined;
    return { day_limit: limit(config?.day_limit), month_limit: limit(config?.month_limit), start_day: String(config?.start_day) };
  }, result => result.data?.cfgs);
  for (const [key, section, field] of [['mac_filter_mode', 'mac_filter', 'mode'], ['ip_filter_mode', 'ip_filter', 'mode'], ['port_forward_switch', 'port_forward', 'switch'], ['port_map_switch', 'port_map', 'switch']]) {
    await sameValue(key, section, result => ({ [field]: field === 'switch' ? Number(payload(result)?.[field]) : payload(result)?.[field] }));
  }
  await sameValue('wifi_advanced', 'wifi_ad', result => {
    const config = result.data?.page_info || {};
    const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
    const args = Object.fromEntries(['country_code', 'trans_power', 'isolate', 'wmm_state'].map(key => [key, scalar(config[key])]));
    for (const band of ['5G', '2.4G']) args[band] = Object.fromEntries(['wireless_mode', 'band_width', 'channel'].map(key => [key, scalar(config[band]?.[key])]));
    return args;
  }, result => result.data?.page_info);
  const probe = await call('net_probe', { type: 'PING', addr: '127.0.0.1', time: '1' }, true);
  let probeVerified = false;
  if (acknowledged(probe)) for (let poll = 0; poll < 10; poll++) {
    await delay(1000);
    const result = await call('ping_result', { addr: 'read_ping' });
    if (result.status !== 'returned') continue;
    const text = result.data?.data;
    const stats = typeof text === 'string' && text.match(/(\d+) packets transmitted, (\d+) packets received, ([\d.]+)% packet loss/);
    probeVerified = !!stats && Number(stats[1]) > 0 && stats[1] === stats[2] && Number(stats[3]) === 0 && text.includes('Complete');
    break;
  }
  mark('net_probe', probeVerified ? 'functional_loopback_only' : 'failed', '仅本机 Ping；未验证 Traceroute/外网');
  if (process.env.T830_DEVELOPER_KEY) {
    const result = await call('developer_verify', { reply: 'superpasswd', base64: process.env.T830_DEVELOPER_KEY }, true);
    mark('developer_verify', acknowledged(result) ? 'acknowledged_only' : 'failed', result.error || result.status);
  }
  if (process.argv.includes('--reboot')) {
    const before = await call('device_info');
    const uptime = Number(payload(before)?.up_second);
    if (before.status !== 'returned' || !Number.isFinite(uptime)) mark('reboot', 'blocked_baseline', '无法取得启动时间');
    else {
      const started = Date.now();
      const sent = await call('reboot', { reboot: '1' }, true);
      let verified = false;
      if (sent.status !== 'error' || ['DEVICE_UNREACHABLE', 'DEVICE_TIMEOUT'].includes(sent.error)) {
        await mcp.close();
        mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
        for (let poll = 0; poll < 36; poll++) {
          await delay(5000);
          const after = await call('device_info');
          const current = Number(payload(after)?.up_second);
          if (after.status === 'returned' && Number.isFinite(current) && current < uptime + (Date.now() - started) / 1000 - 10) { verified = true; break; }
          if (after.status !== 'returned') {
            await mcp.close();
            mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
          }
        }
      }
      mark('reboot', verified ? 'reboot_observed' : 'failed_or_unconfirmed', sent.error || sent.status);
    }
  }
  const salt = randomBytes(16).toString('hex');
  const login = await call('login', { username: process.env.T830_USERNAME || 'admin', salt, password: createHash('sha256').update(salt + ':' + process.env.T830_PASSWORD).digest('hex') }, true);
  mark('login', acknowledged(login) ? 'acknowledged_only' : 'failed', login.error || login.status);
  const logout = await call('logout', {}, true);
  mark('logout', acknowledged(logout) ? 'acknowledged_only' : 'failed', logout.error || logout.status);
  await call('device_info');
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  for (const row of report.coverage.filter(row => row.live === 'pending')) row.live = 'blocked_prerequisites';
  report.summary = report.coverage.reduce((counts, row) => ({ ...counts, [row.live]: (counts[row.live] || 0) + 1 }), {});
  await save();
  await mcp?.close();
  console.log(JSON.stringify(report.summary));
}
