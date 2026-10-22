import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads, writeByKey } from '../src/catalog.mjs';
import { redact } from '../src/t830.mjs';

if (!process.argv.includes('--apply')) throw new Error('REQUIRES_APPLY');
const path = new URL('../reports/live/systematic-writes-2026-10-20/crud.json', import.meta.url);
const report = { at: new Date().toISOString(), mode: 'real-device-crud', tag: 'codex-' + randomBytes(5).toString('hex'), records: [], cases: [], pendingCleanup: [] };
const save = () => writeFile(path, JSON.stringify(redact(report), null, 2));
const mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
const data = output => output.data?.data ?? output.data;
const ack = output => output.status === 'submitted' || (['verified_field', 'verified_fields'].includes(output.status) && output.submissionOutcome === 'acknowledged');
async function call(key, args = {}, write = false) {
  const name = `t830_${write ? 'set' : 'get'}_${key}`;
  let output;
  try { output = write ? await mcp.executeApprovedWrite(name, args) : await mcp.call(name, args); }
  catch (error) { output = { status: 'error', error: error.message }; }
  const privateData = /^phonebook/.test(key);
  report.records.push({ name, args, write, output: privateData ? { status: output.status, error: output.error, warnings: output.warnings, dataKeys: Object.keys(output.data || {}) } : output });
  await save();
  console.log(`${name}: ${output.status}${output.error ? ' / ' + output.error : ''}`);
  return output;
}
function list(value) {
  if (typeof value === 'string') {
    if (value === '') return [];
    try { return list(JSON.parse(value)); } catch { return undefined; }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['list', 'data', 'records', 'book_list', 'phonebook_list', 'urlfilter_list']) if (key in value) return list(value[key]);
    const values = Object.values(value);
    if (values.length && values.every(entry => entry && typeof entry === 'object')) return values;
  }
  return undefined;
}
async function currentValue(key, section, fields) {
  const before = await call(section);
  const payload = data(before);
  const args = Object.fromEntries(fields.map(field => [field, payload?.[field]]));
  if (before.status !== 'returned' || !writeByKey[key].schema.safeParse(args).success) return report.cases.push({ key, status: 'blocked_baseline' });
  const sent = await call(key, args, true);
  const after = await call(section);
  const unchanged = after.status === 'returned' && fields.every(field => String(data(after)?.[field]) === String(args[field]));
  report.cases.push({ key, kind: 'same-value-only', acknowledged: ack(sent), unchanged, passed: ack(sent) && unchanged });
  if (!unchanged) throw new Error('STOP_BASELINE_CHANGED_' + key);
}
try {
  const baseline = await call('device_info');
  if (baseline.status !== 'returned') throw new Error('DEVICE_UNAVAILABLE');
  await currentValue('network_mode', 'network_mode', ['ratMode']);
  await currentValue('sim_slot', 'sim_slot', ['sim_type']);
  const schedule = await call('reboot_schedule');
  if (schedule.status === 'returned' && data(schedule)?.action === 'Disable') {
    const config = data(schedule);
    const sent = await call('reboot_schedule', { action: 'Disable', schweek: config.schweek ?? '', schTime: config.schTime }, true);
    const final = await call('reboot_schedule');
    report.cases.push({ key: 'reboot_schedule', status: sent.status, businessOutcome: sent.businessOutcome, unchanged: final.status === 'returned' && data(final)?.action === config.action && data(final)?.schTime === config.schTime });
  }
  const apn = await call('apn');
  const apns = apn.data?.manual?.apn_list;
  const slot = Array.isArray(apns) && ['APN4', 'APN3', 'APN2'].find(key => !apns.some(row => row.config_file === key));
  if (apn.status === 'returned' && slot) {
    const args = { config_file: slot, apn_name: report.tag + '.invalid', ip_version: 'IPv4v6', auth_pref: 'none' };
    const record = { key: 'apn_save/apn_remove', slot, created: false, restored: false };
    report.cases.push(record);
    report.pendingCleanup.push({ key: 'apn_remove', args: { config_file: slot }, identity: args.apn_name });
    await save();
    try {
      const sent = await call('apn_save', args, true);
      const after = await call('apn');
      const rows = after.data?.manual?.apn_list;
      record.created = ack(sent) && Array.isArray(rows) && rows.some(row => row.config_file === slot && row.apn_name === args.apn_name);
    } finally {
      const current = await call('apn');
      const rows = current.data?.manual?.apn_list;
      if (current.status !== 'returned' || !Array.isArray(rows)) throw new Error('APN_CLEANUP_READ_UNAVAILABLE');
      const owned = rows.find(row => row.config_file === slot);
      if (owned && owned.apn_name !== args.apn_name) throw new Error('APN_CLEANUP_CONFLICT');
      if (owned) {
        const removed = await call('apn_remove', { config_file: slot }, true);
        record.deleteAcknowledged = ack(removed);
      }
      const final = await call('apn');
      record.restored = final.status === 'returned' && JSON.stringify(final.data?.manual?.apn_list) === JSON.stringify(apns);
      if (!record.restored) throw new Error('APN_RESTORE_NOT_CONFIRMED');
      report.pendingCleanup = report.pendingCleanup.filter(row => row.key !== 'apn_remove');
      await save();
    }
  }
  const url = await call('url_filter');
  const urls = data(url)?.urlfilter_list;
  if (url.status === 'returned' && Array.isArray(urls)) {
    const args = { name: report.tag, url: report.tag + '.invalid', operate: 'add' };
    const record = { key: 'url_filter_rule', created: false, restored: false };
    report.cases.push(record);
    report.pendingCleanup.push({ key: 'url_filter_rule', args: { ...args, operate: 'del' } });
    await save();
    try {
      const sent = await call('url_filter_rule', args, true);
      const after = await call('url_filter');
      record.created = ack(sent) && data(after)?.urlfilter_list?.some(row => row.name === args.name && row.url === args.url);
    } finally {
      const current = await call('url_filter');
      const rows = data(current)?.urlfilter_list;
      if (current.status !== 'returned' || !Array.isArray(rows)) throw new Error('URL_CLEANUP_READ_UNAVAILABLE');
      const owned = rows.filter(row => row.name === args.name);
      if (owned.length > 1 || owned.some(row => row.url !== args.url)) throw new Error('URL_CLEANUP_CONFLICT');
      if (owned.length) await call('url_filter_rule', { ...args, operate: 'del' }, true);
      const final = await call('url_filter');
      record.restored = final.status === 'returned' && JSON.stringify(data(final)?.urlfilter_list) === JSON.stringify(urls);
      if (!record.restored) throw new Error('URL_RESTORE_NOT_CONFIRMED');
      report.pendingCleanup = report.pendingCleanup.filter(row => row.key !== 'url_filter_rule');
      await save();
    }
  }
  const signals = await call('signal_records');
  const original = list(data(signals));
  if (signals.status === 'returned' && Array.isArray(original)) {
    const started = await call('signal_start', {}, true);
    report.cases.push({ key: 'signal_start', acknowledged: ack(started), functionalVerified: false });
    const args = { ...Object.fromEntries(['index', 'name', 'sigal', 'time', 'qos'].map(key => [key, String(started.data?.[key])])), position: 'codex-systematic-test' };
    if (!ack(started) || !writeByKey.signal_record.schema.safeParse(args).success) throw new Error('SIGNAL_MEASUREMENT_UNAVAILABLE');
    if (original.some(row => String(row.index) === args.index || row.name === args.name)) throw new Error('SIGNAL_MEASUREMENT_IDENTITY_CONFLICT');
    const record = { key: 'signal_record/signal_record_edit/signal_record_delete', created: false, restored: false };
    report.cases.push(record);
    report.pendingCleanup.push({ key: 'signal_record_delete', identity: args.name, index: args.index });
    await save();
    try {
      const sent = await call('signal_record', args, true);
      const after = await call('signal_records');
      const rows = list(data(after));
      const owned = rows?.filter(row => row.name === args.name);
      record.created = ack(sent) && owned?.length === 1;
      if (record.created && owned[0].index !== undefined) {
        const edit = await call('signal_record_edit', { index: String(owned[0].index), name: args.name, position: 'codex-systematic-test-edited' }, true);
        const edited = await call('signal_records');
        record.edited = ack(edit) && list(data(edited))?.some(row => row.name === args.name && (row.local ?? row.position) === 'codex-systematic-test-edited');
      }
    } finally {
      const current = await call('signal_records');
      const rows = list(data(current));
      if (current.status !== 'returned' || !Array.isArray(rows)) throw new Error('SIGNAL_CLEANUP_READ_UNAVAILABLE');
      const owned = rows.filter(row => row.name === args.name);
      if (owned.length > 1) throw new Error('SIGNAL_CLEANUP_CONFLICT');
      if (owned.length) {
        if (owned[0].index === undefined) throw new Error('SIGNAL_INDEX_UNKNOWN');
        await call('signal_record_delete', { index: String(owned[0].index) }, true);
      }
      const final = await call('signal_records');
      record.restored = final.status === 'returned' && JSON.stringify(list(data(final))) === JSON.stringify(original);
      if (!record.restored) throw new Error('SIGNAL_RESTORE_NOT_CONFIRMED');
      report.pendingCleanup = report.pendingCleanup.filter(row => row.key !== 'signal_record_delete');
      await save();
    }
  }
  const checked = await call('backup_check', writeByKey.backup_check.sample, true);
  report.cases.push({ key: 'backup_check', acknowledged: ack(checked), functionalVerified: false, note: '必须结合 exit code 判断，不能把 submitted 视为有效备份' });
  await call('device_info');
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await save();
  await mcp.close();
  console.log(JSON.stringify({ cases: report.cases, pendingCleanup: report.pendingCleanup, error: report.error }));
}
