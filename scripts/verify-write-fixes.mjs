import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads } from '../src/catalog.mjs';
import { redact } from '../src/t830.mjs';

if (!process.argv.includes('--apply')) throw new Error('REQUIRES_APPLY');
const directory = new URL('../reports/live/write-fixes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { at: new Date().toISOString(), records: [], cases: [], pendingCleanup: [] };
const save = () => writeFile(new URL('verification.json', directory), JSON.stringify(redact(report), null, 2));
const mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
const rows = value => {
  if (value === '') return [];
  if (typeof value === 'string') { try { return rows(JSON.parse(value)); } catch { return undefined; } }
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' && Object.values(value).every(row => row && typeof row === 'object') ? Object.values(value) : undefined;
};
async function call(key, args = {}, write = false) {
  let output;
  try { output = write ? await mcp.executeApprovedWrite('t830_set_' + key, args) : await mcp.call('t830_get_' + key, args); }
  catch (error) { output = { status: 'error', error: error.message }; }
  report.records.push({ key, args, write, output });
  await save();
  console.log(`${key}: ${output.status}${output.error ? ' / ' + output.error : ''}${output.businessOutcome ? ' / ' + output.businessOutcome : ''}`);
  return output;
}
const submitted = output => output.status === 'submitted';
try {
  if (!process.argv.includes('--skip-signal')) {
  const before = await call('signal_records');
  const original = rows(before.data?.data);
  if (before.status === 'returned' && Array.isArray(original)) {
    const measured = await call('signal_start', {}, true);
    const info = measured.data;
    if (submitted(measured) && info?.index && info?.name && !original.some(row => row.index === info.index || row.name === info.name)) {
      const args = Object.fromEntries(['index', 'name', 'sigal', 'time', 'qos'].map(key => [key, String(info[key])]));
      args.position = 'codex-write-fix';
      const record = { key: 'signal_record', created: false, edited: false, restored: false };
      report.cases.push(record);
      report.pendingCleanup.push({ key: 'signal_record_delete', index: args.index, name: args.name });
      await save();
      try {
        const sent = await call('signal_record', args, true);
        const after = await call('signal_records');
        const owned = rows(after.data?.data)?.find(row => String(row.index) === args.index && row.name === args.name);
        record.created = submitted(sent) && !!owned && (owned.local ?? owned.position) === args.position;
        if (record.created) {
          const edit = await call('signal_record_edit', { index: args.index, name: args.name, position: 'codex-write-fix-edited' }, true);
          const edited = await call('signal_records');
          record.edited = submitted(edit) && rows(edited.data?.data)?.some(row => String(row.index) === args.index && (row.local ?? row.position) === 'codex-write-fix-edited');
        }
      } finally {
        const current = await call('signal_records');
        const list = rows(current.data?.data);
        if (current.status !== 'returned' || !list) throw new Error('SIGNAL_CLEANUP_UNAVAILABLE');
        const owned = list.find(row => String(row.index) === args.index);
        if (owned && owned.name !== args.name) throw new Error('SIGNAL_CLEANUP_CONFLICT');
        if (owned) await call('signal_record_delete', { index: args.index }, true);
        const final = await call('signal_records');
        record.restored = final.status === 'returned' && JSON.stringify(rows(final.data?.data)) === JSON.stringify(original);
        if (!record.restored) throw new Error('SIGNAL_RESTORE_UNCONFIRMED');
        report.pendingCleanup = report.pendingCleanup.filter(row => row.key !== 'signal_record_delete');
        await save();
      }
    }
  }
  }
  if (!process.argv.includes('--signal-only')) {
  const contacts = await call('phonebook', { device: '1', type: 'ALL' });
  const originalContacts = rows(contacts.data?.data);
  const name = 'codex-fix-' + Date.now();
  if (contacts.status === 'returned' && Array.isArray(originalContacts)) {
    const record = { key: 'phonebook_write', created: false, edited: false, restored: false };
    report.cases.push(record);
    report.pendingCleanup.push({ key: 'phonebook_delete', name });
    const args = { name, device: '1', type: '0', numb: '0000000000', numb_house: '', numb_work: '', email: '', flag: '0' };
    await save();
    try {
      const sent = await call('phonebook_write', args, true);
      const after = await call('phonebook', { device: '1', type: 'ALL' });
      const owned = rows(after.data?.data)?.filter(row => row.name === name);
      record.created = submitted(sent) && owned?.length === 1;
      if (record.created && owned[0].index !== undefined) {
        const edited = await call('phonebook_write', { ...args, index: String(owned[0].index), flag: '1', type: '1' }, true);
        const afterEdit = await call('phonebook', { device: '1', type: 'ALL' });
        record.edited = submitted(edited) && rows(afterEdit.data?.data)?.some(row => row.name === name && String(row.type) === '1');
      }
    } finally {
      const current = await call('phonebook', { device: '1', type: 'ALL' });
      const list = rows(current.data?.data);
      if (current.status !== 'returned' || !list) throw new Error('PHONEBOOK_CLEANUP_UNAVAILABLE');
      const owned = list.filter(row => row.name === name);
      if (owned.length > 1 || owned.some(row => row.index === undefined)) throw new Error('PHONEBOOK_CLEANUP_CONFLICT');
      if (owned.length) await call('phonebook_delete', { device: '1', index: String(owned[0].index) }, true);
      const final = await call('phonebook', { device: '1', type: 'ALL' });
      record.restored = final.status === 'returned' && JSON.stringify(rows(final.data?.data)) === JSON.stringify(originalContacts);
      if (!record.restored) throw new Error('PHONEBOOK_RESTORE_UNCONFIRMED');
      report.pendingCleanup = report.pendingCleanup.filter(row => row.key !== 'phonebook_delete');
      await save();
    }
  }
  const schedule = await call('reboot_schedule');
  const config = schedule.data?.data ?? schedule.data;
  if (schedule.status === 'returned' && config?.action === 'Disable') {
    const args = { action: 'Disable', schweek: config.schweek ?? '', schTime: config.schTime };
    const sent = await call('reboot_schedule', args, true);
    const final = await call('reboot_schedule');
    const value = final.data?.data ?? final.data;
    report.cases.push({ key: 'reboot_schedule', status: sent.status, businessOutcome: sent.businessOutcome, unchanged: final.status === 'returned' && value.action === config.action && value.schTime === config.schTime });
  }
  const night = await call('wifi_night');
  if (night.status === 'returned') {
    const args = Object.fromEntries(['action', 'openTime', 'closeTime'].filter(key => night.data?.[key] !== undefined).map(key => [key, night.data[key]]));
    const sent = await call('wifi_night', args, true);
    report.cases.push({ key: 'wifi_night', status: sent.status, submissionOutcome: sent.submissionOutcome });
  }
  const salt = 'codex-' + Date.now();
  const login = await call('login', { username: process.env.T830_USERNAME || 'admin', salt, password: createHash('sha256').update(salt + ':' + process.env.T830_PASSWORD).digest('hex') }, true);
  const logout = await call('logout', {}, true);
  report.cases.push({ key: 'native_login_logout', login: login.status, logout: logout.status });
  }
  const status = await call('status');
  report.finalOnline = status.status === 'returned' && status.reading?.uplink === 'connected';
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally { await save(); await mcp.close(); console.log(JSON.stringify({ cases: report.cases, pendingCleanup: report.pendingCleanup, finalOnline: report.finalOnline, error: report.error })); }
