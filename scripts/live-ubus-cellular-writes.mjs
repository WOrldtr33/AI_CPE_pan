import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { redact } from '../src/t830.mjs';

// 实机：蜂窝/WPS/短信写工具。每项都"读原值→改值→回读→恢复→回读→确认上联"，报告经 redact。
if (!process.argv.includes('--apply') || !process.argv.includes('--wired-management-confirmed'))
  throw new Error('REQUIRES_APPLY_AND_WIRED_MANAGEMENT');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const smsTo = process.argv.find(arg => arg.startsWith('--sms-to='))?.slice(9);
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) || 'cellular-writes';
const directory = new URL('../reports/live/ubus-writes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
// 发短信等操作不可重复：同一时间只允许一个实例运行。
const lockFile = new URL('.cellular-writes.lock', directory);
await (await open(lockFile, 'wx')).close();
const report = { at: new Date().toISOString(), mode: 'change-readback-restore', management: 'wired-route-verified', records: [], cases: [] };
const save = async () => {
  for (let attempt = 1; ; attempt++) {
    try { return await writeFile(new URL(`${label}.json`, directory), JSON.stringify(redact(report), null, 2)); }
    catch (error) { if (attempt >= 5) throw error; await delay(200 * attempt); }
  }
};
const mcp = await connectTools(['wps', 'wps_run', 'network_mode', 'sim_slot', 'sim', 'band_lock', 'sms_all', 'sms_thread', 'status'], process.env, { enableWrites: true });

async function call(key, args = {}, write = false) {
  let output;
  try { output = write ? await mcp.executeApprovedWrite('t830_set_' + key, args) : await mcp.call('t830_get_' + key, args); }
  catch (error) { output = { status: 'error', error: error.message }; }
  report.records.push({ at: new Date().toISOString(), key, args, write, output });
  await save();
  console.log(`${write ? 'SET' : 'GET'} ${key}: ${output.status}${output.error ? ' / ' + output.error : ''}${write ? ' / ' + JSON.stringify(output.data).slice(0, 300) : ''}`);
  return output;
}
const accepted = output => output.status === 'submitted';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function until(check, seconds, step = 5) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await delay(step * 1000);
  }
}
const uplink = async () => (await call('status')).reading?.uplink;
const waitUplink = seconds => until(async () => await uplink() === 'connected', seconds);

// 改值后无条件提交原值；蜂窝改动生效慢，回读与上联等待都放宽。
async function changeAndRestore({ key, observe, original, target, apply, settleSeconds = 60 }) {
  const record = { key, original, target, changed: false, restored: false };
  report.cases.push(record);
  try {
    const sent = await apply(target);
    record.submission = sent.status;
    record.response = sent.data;
    record.changed = accepted(sent) && await until(async () => same(await observe(), target), 30);
    record.uplinkWhileChanged = await waitUplink(settleSeconds) ? 'connected' : await uplink();
  } finally {
    if (record.submission !== undefined) {
      record.restoreSubmissions = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt) await delay(10000);
        const back = await apply(original);
        record.restoreSubmissions.push(back.status);
        if (accepted(back)) break;
      }
    }
    record.restored = await until(async () => same(await observe(), original), 60);
    record.uplinkAfterRestore = await waitUplink(180) ? 'connected' : await uplink();
    await save();
    if (!record.restored || record.uplinkAfterRestore !== 'connected') throw new Error('RESTORE_UNCONFIRMED_' + key);
  }
  console.log(`CASE ${key}: changed=${record.changed} restored=${record.restored} uplink=${record.uplinkAfterRestore}`);
  return record;
}
const wants = key => !only || only.includes(key);

// WPS 没有取消接口：网页以 WscStatus=Start WSC Process 为进行中，其余为结束（未配对约 2 分钟超时）。
const wpsRunning = 'Start WSC Process';
async function wpsCase(key, args) {
  const record = { key, args: { ...args, pincode: args.pincode && '[TEST_PIN]' }, statuses: [] };
  report.cases.push(record);
  const info = async () => (await call('wps_run', { name: args.name, obj: args.obj })).data?.[args.obj]?.[args.name]?.WPS_info;
  record.before = (await info())?.WscStatus;
  if (!record.before || record.before === wpsRunning) throw new Error(`WPS_NOT_READY_${key}_${record.before}`);
  const sent = await call(key, args, true);
  record.submission = sent.status;
  record.code = sent.data?.[args.obj]?.[args.name]?.code;
  record.started = accepted(sent) && record.code === '200';
  if (record.started) record.ended = await until(async () => {
    const now = await info();
    if (record.statuses.at(-1) !== now?.WscStatus) record.statuses.push(now?.WscStatus);
    record.result = now?.WscResult;
    return record.statuses.includes(wpsRunning) && now?.WscStatus !== wpsRunning;
  }, 180, 5);
  await save();
  console.log(`CASE ${key}: started=${record.started} statuses=${JSON.stringify(record.statuses)} ended=${record.ended} result=${record.result}`);
}

try {
  report.startUplink = await uplink();
  if (report.startUplink !== 'connected') throw new Error('UPLINK_NOT_CONNECTED_AT_START');
  if (wants('band_lock')) {
    const observe = async () => { const d = (await call('band_lock')).data; return d && { args: d.args, multi_band: { '3G': d.multi_band['3G'], '4G': d.multi_band['4G'], '5G': d.multi_band['5G'] } }; };
    const before = await observe();
    const args = { type: before.args.type, state: before.args.state, band: before.args.band, arfcn: before.args.arfcn, pci: before.args.pci, multi_band: { list_3G: before.multi_band['3G'], list_4G: before.multi_band['4G'], list_5G: before.multi_band['5G'] } };
    const sent = await call('band_lock', args, true);
    const after = await observe();
    report.cases.push({ key: 'band_lock', mode: 'resubmit-current', original: before, submission: sent.status, code: sent.data?.code, unchanged: same(before, after), uplink: await waitUplink(120) ? 'connected' : await uplink() });
    await save();
  }
  if (wants('network_mode')) {
    const observe = async () => (await call('network_mode')).data?.ratMode;
    const original = await observe();
    if (original === '21')
      await changeAndRestore({ key: 'network_mode', observe, original, target: '19', apply: ratMode => call('network_mode', { ratMode }, true), settleSeconds: 90 });
  }
  if (wants('sim_slot')) {
    const observe = async () => (await call('sim_slot')).data?.sim_type;
    const original = await observe();
    if (original === '1') {
      const record = await changeAndRestore({ key: 'sim_slot', observe, original, target: '2', apply: sim_type => call('sim_slot', { sim_type }, true), settleSeconds: 45 });
      record.simAfterRestore = (await call('sim')).reading?.state;
    }
  }
  if (wants('plmn')) {
    // 无读取接口，且锁定在重启/重新插卡后才生效：锁到当前运营商再立即解锁，以解锁作为最终持久状态。
    const plmn = (await call('status')).data?.data?.MSI?.slice(0, 5);
    if (!/^\d{5}$/.test(plmn || '')) throw new Error('PLMN_UNKNOWN');
    const record = { key: 'plmn', plmn };
    report.cases.push(record);
    try {
      const locked = await call('plmn_lock', { plmn_array: [plmn] }, true);
      record.lock = { submission: locked.status, code: locked.data?.code };
    } finally {
      const unlocked = await call('plmn_unlock', {}, true);
      record.unlock = { submission: unlocked.status, code: unlocked.data?.code };
      record.uplink = await uplink();
      await save();
    }
  }
  if (wants('wps_pbc')) await wpsCase('wps_pbc', { name: '2.4G', obj: 'host' });
  if (wants('wps_pin')) await wpsCase('wps_pin', { name: '2.4G', obj: 'host', pincode: '12345670' });
  if (wants('sms') && smsTo) {
    const record = { key: 'sms', to: smsTo, sent: false, found: false, deleted: false };
    report.cases.push(record);
    const thread = async () => { const d = (await call('sms_thread', { addr: smsTo })).data; return d?.code === '0' && d.data && typeof d.data === 'object' ? Object.values(d.data) : []; };
    record.before = (await thread()).length;
    const text = `T830 MCP live test ${new Date().toISOString()}`;
    const content = Buffer.from(text, 'utf8').toString('base64');
    const sent = await call('sms_send', { addr: smsTo, content, format: '2', myContent: content }, true);
    record.submission = sent.status;
    record.code = sent.data?.code;
    record.sent = accepted(sent) && record.code === '0';
    let mine;
    await until(async () => {
      const rows = await thread();
      mine = rows.find(row => Buffer.from(String(row.content || ''), 'base64').toString('utf8') === text || row.content === text);
      record.rowShape = rows[0] && Object.keys(rows[0]);
      return !!mine;
    }, 60);
    record.found = !!mine;
    if (mine) {
      record.index = mine.index;
      const removed = await call('sms_delete', { content: `${smsTo}[${mine.index}` }, true);
      record.deleteSubmission = removed.status;
      record.deleteCode = removed.data?.code;
      record.deleted = await until(async () => !(await thread()).some(row => row.index === mine.index), 30);
      record.after = (await thread()).length;
    }
    await save();
    console.log(`CASE sms: sent=${record.sent} found=${record.found} deleted=${record.deleted} shape=${JSON.stringify(record.rowShape)}`);
  }
  report.finalUplink = await uplink();
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  await save();
  await mcp.close();
  await rm(lockFile, { force: true });
  console.log(JSON.stringify({ cases: report.cases.map(({ key, changed, restored, uplinkAfterRestore, started, ended, sent, found, deleted, lock, unlock, unchanged, code }) => ({ key, changed, restored, uplinkAfterRestore, started, ended, sent, found, deleted, lock, unlock, unchanged, code })), finalUplink: report.finalUplink, error: report.error }));
}
