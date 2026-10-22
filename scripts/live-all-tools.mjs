import { writeFile, mkdir } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads, writes, toolName, readByKey } from '../src/catalog.mjs';
import { T830, redact } from '../src/t830.mjs';
const directory = new URL('../reports/live/all-tools-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { at: new Date().toISOString(), device: process.env.T830_BASE_URL || 'http://192.168.0.1', mode: process.argv.includes('--developer') ? 'live-developer-mcp-reads-and-write-preflight' : 'live-mcp-reads-and-write-preflight', reads: [], helpers: [], writes: [], controlledWrites: [] };
const save = () => writeFile(new URL(process.argv.includes('--developer') ? 'developer-full.json' : 'results.json', directory), JSON.stringify(redact(report), null, 2));
const summarize = (output, privateData = false) => privateData ? { status: output.status, error: output.error, warnings: output.warnings, validation: output.validation, dataKeys: Object.keys(output.data || {}), note: '短信和电话本正文不写入测试报告' } : output;
let mcp;
try {
  mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
  report.discovered = mcp.definitions.map(tool => tool.function.name);
  for (const def of reads) {
    const started = Date.now();
    let output;
    try { output = await mcp.call(toolName(def), def.sample); }
    catch (error) { output = { status: 'error', error: error.message }; }
    report.reads.push({ tool: toolName(def), section: def.key, api: def.api, parameterSource: 'catalog.sample; one parameter combination only', ms: Date.now() - started, output: summarize(output, ['sms', 'phonebook'].includes(def.group)) });
    console.log(`${toolName(def)}: ${output.status}${output.error ? ' / ' + output.error : ''}`);
    await save();
    if (['DEVICE_UNREACHABLE', 'DEVICE_TIMEOUT', 'LOGIN_FAILED_CHECK_CREDENTIALS'].includes(output.error)) throw new Error('DEVICE_UNAVAILABLE_STOP');
  }
  for (const [tool, args] of [['t830_list_capabilities', {}], ['t830_query', { section: 'version' }], ['t830_check_access', { section: 'wifi' }]]) {
    const output = await mcp.call(tool, args);
    report.helpers.push({ tool, output }); await save();
    console.log(`${tool}: ${output.status || 'returned'}`);
  }
} finally { await mcp?.close(); await save(); }
// 权限预检仅调用 session.access；不会调用目标写方法。
const device = new T830({ ...process.env, T830_ENABLE_WRITES: '0' });
try {
  for (const def of writes) {
    const row = { tool: toolName(def), section: def.key, api: def.api, registered: report.discovered.includes(toolName(def)), sampleSchemaValid: def.schema.safeParse(def.sample).success, execution: 'not_executed', readback: def.readback, readbackStatus: report.reads.find(row => row.section === def.readback)?.output.status || 'not_available' };
    if (def.transport === 'ubus') {
      try { const output = await device.rpc('session', 'access', { scope: 'ubus', object: def.service, function: def.method }); row.permission = { status: output.status, access: output.data?.access }; }
      catch (error) { row.permission = { status: 'error', error: error.message }; }
    } else row.permission = { status: 'not_checked', reason: 'session.access does not establish CGI authorization' };
    report.writes.push(row); await save();
    console.log(`${row.tool}: preflight ${JSON.stringify(row.permission)}`);
  }
} finally { await device.close(); await save(); }
report.summary = { reads: Object.fromEntries(['returned', 'device_warning', 'error'].map(status => [status, report.reads.filter(row => row.output.status === status).length])), writePreflights: report.writes.length, schemaValid: report.writes.filter(row => row.sampleSchemaValid).length, registeredWrites: report.writes.filter(row => row.registered).length, writePermissionsGranted: report.writes.filter(row => row.permission.access === true).length, writePermissionsDenied: report.writes.filter(row => row.permission.access === false).length, realWrites: 0 };
await save(); console.log('SUMMARY', JSON.stringify(report.summary));
