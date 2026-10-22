import { writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads, writeByKey } from '../src/catalog.mjs';
import { T830, redact } from '../src/t830.mjs';

if (!process.argv.includes('--apply')) throw new Error('REQUIRES_APPLY');
const path = new URL('../reports/live/systematic-writes-2026-10-20/remaining.json', import.meta.url);
const report = { at: new Date().toISOString(), mode: 'real-device-additional-tests', records: [], cases: [], metadata: [] };
const save = () => writeFile(path, JSON.stringify(redact(report), null, 2));
const mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
const device = new T830({ ...process.env, T830_ENABLE_WRITES: '0' });
const acknowledged = output => output.status === 'submitted';
async function call(key, args = {}, write = false) {
  const name = `t830_${write ? 'set' : 'get'}_${key}`;
  let output;
  try { output = write ? await mcp.executeApprovedWrite(name, args) : await mcp.call(name, args); }
  catch (error) { output = { status: 'error', error: error.message }; }
  const privateData = key.startsWith('phonebook');
  report.records.push({ name, write, args, output: privateData ? { status: output.status, error: output.error, warnings: output.warnings, dataType: typeof output.data?.data } : output });
  await save();
  console.log(`${name}: ${output.status}${output.error ? ' / ' + output.error : ''}`);
  return output;
}
function entries(value) {
  if (typeof value === 'string') {
    if (value === '') return [];
    try { return entries(JSON.parse(value)); } catch { return undefined; }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['data', 'list', 'book_list']) if (key in value) return entries(value[key]);
    const rows = Object.values(value);
    if (rows.every(row => row && typeof row === 'object')) return rows;
  }
  return undefined;
}
try {
  const baseline = await call('phonebook', { device: '1', type: 'ALL' });
  const original = entries(baseline.data?.data);
  if (baseline.status === 'returned' && Array.isArray(original)) {
    const name = 'codex-' + randomBytes(5).toString('hex');
    const record = { key: 'phonebook_write/phonebook_delete', created: false, restored: false };
    report.cases.push(record);
    try {
      const sent = await call('phonebook_write', { name, type: '0', device: '1', numb: '0000000000', numb_house: '', numb_work: '', email: '', flag: '0' }, true);
      const after = await call('phonebook', { device: '1', type: 'ALL' });
      record.created = acknowledged(sent) && entries(after.data?.data)?.some(row => row.name === name);
    } finally {
      const current = await call('phonebook', { device: '1', type: 'ALL' });
      const rows = entries(current.data?.data);
      if (current.status !== 'returned' || !Array.isArray(rows)) throw new Error('PHONEBOOK_CLEANUP_UNAVAILABLE');
      const owned = rows.filter(row => row.name === name);
      if (owned.length > 1 || owned.some(row => row.index === undefined)) throw new Error('PHONEBOOK_CLEANUP_IDENTITY_UNCERTAIN');
      if (owned.length) await call('phonebook_delete', { device: '1', index: String(owned[0].index) }, true);
      const final = await call('phonebook', { device: '1', type: 'ALL' });
      const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
      record.restored = final.status === 'returned' && hash(entries(final.data?.data)) === hash(original);
      if (!record.restored) throw new Error('PHONEBOOK_RESTORE_UNCONFIRMED');
      await save();
    }
  }
  for (const key of ['wifi_scan_start', 'wifi_scan_list']) {
    const output = await call(key, writeByKey[key].sample, true);
    report.cases.push({ key, acknowledged: acknowledged(output), functionalVerified: false });
  }
  await device.login();
  const listing = await device.request('/ubus/', { jsonrpc: '2.0', id: 100, method: 'list', params: [device.token, '*'] }, 'list', { cookie: true });
  const services = listing.result;
  if (services && typeof services === 'object') {
    for (const key of ['signal_record', 'phonebook_write', 'reboot_schedule', 'wifi_config']) {
      const def = writeByKey[key];
      const signature = services[def.service]?.[def.method];
      const fields = Object.keys(signature || {});
      let schema = def.schema;
      while (schema._def?.schema) schema = schema._def.schema;
      const exposed = new Set(Object.keys(schema.shape || {}));
      report.metadata.push({ key, service: def.service, method: def.method, deviceSignature: signature, catalogSampleFields: Object.keys(def.sample), omittedDeviceFields: fields.filter(field => !exposed.has(field)), note: 'UBUS 签名不说明字段是否必填；缺项只记为待核查，不直接判定根因' });
    }
  }
  await call('device_info');
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  await save();
  await mcp.close();
  await device.close();
  console.log(JSON.stringify({ cases: report.cases, metadata: report.metadata, error: report.error }));
}
