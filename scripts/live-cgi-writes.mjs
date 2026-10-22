import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { timestamp } from '../src/time.mjs';
import { writeReport } from '../src/artifacts.mjs';

// 通过真实 MCP 以当前原值提交 CGI 写工具，再回读确认配置未变；需 --apply 才会提交。
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw new Error('Usage: node scripts/live-cgi-writes.mjs [--apply]');
const gpsValue = (value) => ({ enable: '1', disable: '0', 1: '1', 0: '0' })[value];
const cases = [
  { tool: 't830_set_upnp', read: 't830_get_upnp', args: (d) => ({ upnp_switch: String(d.data.upnp_switch) }) },
  { tool: 't830_set_dns', read: 't830_get_dns', args: (d) => ({ rebind_protection: String(d.data) }) },
  { tool: 't830_set_gps', read: 't830_get_gps', args: (d) => ({ gps_switch: gpsValue(d.data.gps_switch) }) },
  { tool: 't830_set_mac_filter_mode', read: 't830_get_mac_filter', args: (d) => ({ mode: String(d.data.mode) }) },
  { tool: 't830_set_ip_filter_mode', read: 't830_get_ip_filter', args: (d) => ({ mode: String(d.data.mode) }) },
  { tool: 't830_set_port_forward_switch', read: 't830_get_port_forward', args: (d) => ({ switch: Number(d.data.switch) }) },
  { tool: 't830_set_port_map_switch', read: 't830_get_port_map', args: (d) => ({ switch: Number(d.data.switch) }) },
];
const client = new Client({ name: 'live-cgi-writes', version: '1' });
const report = { at: timestamp(), mode: apply ? 'same-value-submit-and-readback' : 'preview', records: [], results: [] };
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const output = response.structuredContent || JSON.parse(response.content.find((c) => c.type === 'text').text);
  report.records.push({ at: timestamp(), tool: name, args, isError: !!response.isError, output });
  return { output, isError: !!response.isError };
};
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env: { ...process.env, T830_ENABLE_WRITES: apply ? '1' : '0' },
    stderr: 'inherit',
  }));
  for (const item of cases) {
    const result = { tool: item.tool };
    report.results.push(result);
    const before = await call(item.read);
    if (before.isError || before.output.status !== 'returned' && before.output.status !== 'device_warning') {
      result.outcome = 'baseline_unavailable';
      result.error = before.output.error;
      continue;
    }
    const args = item.args(before.output.data);
    result.args = args;
    result.before = before.output.data;
    if (!apply) { result.outcome = 'preview'; continue; }
    const submitted = await call(item.tool, args);
    result.writeStatus = submitted.isError ? 'error' : submitted.output.status;
    result.writeError = submitted.output.error;
    result.deviceCode = submitted.output.data?.code;
    const after = await call(item.read);
    result.after = after.output.data;
    result.unchanged = JSON.stringify(after.output.data) === JSON.stringify(before.output.data);
    result.outcome = !submitted.isError && result.unchanged ? 'passed' : 'failed';
  }
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (report.results.some((r) => r.outcome === 'failed' || r.outcome === 'baseline_unavailable')) process.exitCode = 1;
  await writeReport('live/cgi-writes-2026-10-21/same-value.json', JSON.stringify(report, null, 2));
  await client.close();
  console.log(JSON.stringify(report.results.map(({ before, after, ...rest }) => rest), null, 2));
}
