import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { T830, redact } from '../src/t830.mjs';

// 实机：UBUS 写工具"改值→回读→恢复→回读"。原始密码/MAC 只在内存中由原生会话读取，报告经 redact。
if (!process.argv.includes('--apply') || !process.argv.includes('--wired-management-confirmed'))
  throw new Error('REQUIRES_APPLY_AND_WIRED_MANAGEMENT');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const directory = new URL('../reports/live/ubus-writes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { at: new Date().toISOString(), mode: 'change-readback-restore', management: 'wired-route-verified', records: [], cases: [] };
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) || 'writes';
const save = async () => {
  for (let attempt = 1; ; attempt++) {
    try { return await writeFile(new URL(`${label}.json`, directory), JSON.stringify(redact(report), null, 2)); }
    catch (error) { if (attempt >= 5) throw error; await delay(200 * attempt); }
  }
};
const raw = new T830({ ...process.env, T830_AUTH_MODE: 'admin', T830_ENABLE_WRITES: '0' });
const mcp = await connectTools(['wifi', 'guest', 'wifi_ad', 'wifi_night', 'reboot_schedule', 'traffic', 'roaming', 'sms_center', 'clients', 'status', 'ping_result'], process.env, { enableWrites: true });

async function call(key, args = {}, write = false) {
  let output;
  try { output = write ? await mcp.executeApprovedWrite('t830_set_' + key, args) : await mcp.call('t830_get_' + key, args); }
  catch (error) { output = { status: 'error', error: error.message }; }
  report.records.push({ key, args, write, output });
  await save();
  console.log(`${write ? 'SET' : 'GET'} ${key}: ${output.status}${output.error ? ' / ' + output.error : ''}${output.submissionOutcome ? ' / ' + output.submissionOutcome : ''}${output.businessOutcome ? ' / ' + output.businessOutcome : ''}`);
  return output;
}
const accepted = output => ['submitted', 'verified_fields'].includes(output.status);
async function until(check, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return true;
    await delay(1500);
  }
  return false;
}
// 通用"改值并恢复"：observe 返回可比较的当前值；restore 总在 finally 中执行并必须回读确认。
async function changeAndRestore({ key, observe, original, target, apply }) {
  const record = { key, original: redact(original), target: redact(target), changed: false, restored: false };
  report.cases.push(record);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  try {
    const sent = await apply(target);
    record.submission = sent.status;
    record.businessOutcome = sent.businessOutcome;
    record.changed = accepted(sent) && await until(async () => same(await observe(), target));
  } finally {
    // 设备可能异步生效：只要已提交过改值，就无条件提交原值，不依赖某一次回读。
    // 生效期间（如无线重启）设备可能返回忙；提交原值是幂等的，被拒时间隔重试。
    if (record.submission !== undefined) {
      record.restoreSubmissions = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt) await delay(10000);
        const back = await apply(original);
        record.restoreSubmissions.push(back.status);
        if (accepted(back)) break;
      }
    }
    record.restored = await until(async () => same(await observe(), original));
    await save();
    if (!record.restored) throw new Error('RESTORE_UNCONFIRMED_' + key);
  }
  console.log(`CASE ${key}: changed=${record.changed} restored=${record.restored}`);
  return record;
}
const wants = key => !only || only.includes(key);

try {
  await raw.login();
  if (wants('developer_verify') && process.env.T830_DEVELOPER_KEY) {
    const out = await call('developer_verify', { reply: 'superpasswd', base64: process.env.T830_DEVELOPER_KEY }, true);
    report.cases.push({ key: 'developer_verify', submission: out.status, code: out.data?.code, passwordReturned: typeof out.data?.passwd === 'string' && out.data.passwd.length > 0, passed: out.status === 'submitted' && Number(out.data?.code) === 200 });
  }
  if (wants('net_probe')) {
    const sent = await call('net_probe', { type: 'Traceroute', addr: '127.0.0.1', jump: '3', time: '2' }, true);
    const record = { key: 'net_probe_traceroute', submission: sent.status, completed: false };
    report.cases.push(record);
    if (sent.status === 'submitted') for (let poll = 0; poll < 15 && !record.completed; poll++) {
      await delay(1000);
      const result = await call('ping_result', { addr: 'read_ping' });
      record.reading = result.reading;
      record.completed = result.status === 'returned' && result.reading?.state === 'complete';
      record.text = typeof result.data?.data === 'string' ? result.data.data.slice(0, 400) : undefined;
    }
  }
  if (wants('traffic')) {
    const observe = async () => { const out = await call('traffic'); const c = out.data?.cfgs; return c && { day_limit: c.day_limit, month_limit: c.month_limit, start_day: c.start_day }; };
    const original = await observe();
    if (original) await changeAndRestore({ key: 'traffic', observe, original, target: { ...original, day_limit: '1024MB', start_day: original.start_day === '2' ? '3' : '2' }, apply: args => call('traffic', args, true) });
  }
  if (wants('sms_center')) {
    const observe = async () => { const d = (await call('sms_center')).data; return d && { addr: d.addr, status: d.status, time: d.time }; };
    const original = await observe();
    if (original && ['0', '1'].includes(original.status))
      await changeAndRestore({ key: 'sms_center', observe, original, target: { ...original, status: original.status === '0' ? '1' : '0' }, apply: args => call('sms_center', args, true) });
  }
  if (wants('roaming')) {
    const observe = async () => (await call('roaming')).data?.action;
    const original = await observe();
    if (['Enable', 'Disable'].includes(original))
      await changeAndRestore({ key: 'roaming', observe, original, target: original === 'Enable' ? 'Disable' : 'Enable', apply: action => call('roaming', { action }, true) });
  }
  if (wants('wifi_night')) {
    const observe = async () => { const d = (await call('wifi_night')).data; return d && { action: d.action, openTime: d.openTime, closeTime: d.closeTime }; };
    const original = await observe();
    if (original?.action === 'Disable')
      await changeAndRestore({ key: 'wifi_night', observe, original, target: { action: 'Enable', openTime: '04;00', closeTime: '03;00' }, apply: args => call('wifi_night', args, true) });
  }
  if (wants('reboot_schedule')) {
    const observe = async () => { const d = (await call('reboot_schedule')).data; return d && { action: d.action, schweek: d.schweek ?? '', schTime: d.schTime }; };
    const original = await observe();
    if (original?.action === 'Disable')
      await changeAndRestore({ key: 'reboot_schedule', observe, original, target: { action: 'Enable', schweek: '7', schTime: '03;30' }, apply: args => call('reboot_schedule', args, true) });
  }
  if (wants('wifi_advanced')) {
    const observe = async () => { const p = (await call('wifi_ad')).data?.page_info; return p && { country_code: p.country_code, trans_power: p.trans_power, isolate: p.isolate, wmm_state: p.wmm_state, '5G': p['5G'], '2.4G': p['2.4G'] }; };
    const original = await observe();
    if (original && ['0', '1'].includes(original.isolate))
      await changeAndRestore({ key: 'wifi_advanced', observe, original, target: { ...original, isolate: original.isolate === '0' ? '1' : '0' }, apply: args => call('wifi_advanced', args, true) });
  }
  if (wants('client_name')) {
    const list = (await raw.rawRpc('jytl_api', 'ue_get', {}))?.data?.brlan_list || [];
    const self = list.find(row => row.ip === '192.168.0.220');
    if (self?.mac && self.name) {
      const observe = async () => ((await raw.rawRpc('jytl_api', 'ue_get', {}))?.data?.brlan_list || []).find(row => row.mac === self.mac)?.name;
      await changeAndRestore({ key: 'client_name', observe, original: self.name, target: 'codex-name-test', apply: name => call('client_name', { mac: self.mac, name, forbid: self.forbid }, true) });
    }
  }
  if (wants('guest_config')) {
    const pick = data => Object.fromEntries(['Guest', 'Guest5G'].map(band => {
      const b = data[band];
      return [band, { state: b.state, ssid: b.ssid, authmode: b.authmode, on_mode: b.on_mode, wpapsk: b.wpapsk ?? '' }];
    }));
    const observe = async () => pick(await raw.rawRpc('mtk.wifi', 'get_guestPage_info', {}));
    const original = await observe();
    if (original.Guest.ssid.length <= 28)
      await changeAndRestore({ key: 'guest_config', observe, original, target: { ...original, Guest: { ...original.Guest, ssid: original.Guest.ssid + '-cx' } }, apply: args => call('guest_config', args, true) });
  }
  if (wants('wifi_config')) {
    const pick = data => Object.fromEntries(['2.4G', '5G'].map(band => {
      const b = data[band];
      return [band, { hidden: b.hidden, ssid: b.ssid, state: b.state, authmode: b.authmode, ...(b.authmode !== 'Disable' ? { wpapsk: b.wpapsk } : {}) }];
    }));
    const observe = async () => pick(await raw.rawRpc('mtk.wifi', 'get_ssidPage_info', {}));
    const original = await observe();
    if (original['2.4G'].ssid.length <= 28)
      await changeAndRestore({ key: 'wifi_config', observe, original, target: { ...original, '2.4G': { ...original['2.4G'], ssid: original['2.4G'].ssid + '-cx' } }, apply: args => call('wifi_config', args, true) });
  }
  const status = await call('status');
  report.finalUplink = status.reading?.uplink;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  await save();
  await mcp.close();
  console.log(JSON.stringify({ cases: report.cases.map(c => ({ key: c.key, changed: c.changed, restored: c.restored, passed: c.passed, completed: c.completed, submission: c.submission })), finalUplink: report.finalUplink, error: report.error }));
}
