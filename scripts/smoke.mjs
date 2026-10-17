import { timestamp } from '../src/time.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeReport } from '../src/artifacts.mjs';
import { reads, toolName } from '../src/catalog.mjs';
const client = new Client({ name: 't830-smoke', version: '0.2.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
  env: { ...process.env, T830_ENABLE_WRITES: '0' },
  stderr: 'inherit',
});
const sections = process.argv.slice(2);
if (sections.some((k) => !reads.some((d) => d.key === k)))
  throw new Error(
    'Unknown section: ' +
      sections.filter((k) => !reads.some((d) => d.key === k)).join(','),
  );
const selected = sections.length ? reads.filter((d) => sections.includes(d.key)) : reads;
const report = {
  at: timestamp(),
  mode: 'live-read-only',
  cookieMode: process.env.T830_COOKIE_MODE || 'auto',
  records: [],
  summary: { returned: 0, device_warning: 0, error: 0, skipped: 0 },
};
let stop = false;
try {
  await client.connect(transport);
  const list = await client.listTools();
  report.toolCount = list.tools.length;
  for (const def of selected) {
    if (stop) {
      report.records.push({
        section: def.key,
        status: 'skipped',
        reason: 'session_or_device_unavailable',
      });
      report.summary.skipped++;
      continue;
    }
    if (!list.tools.some((t) => t.name === toolName(def)))
      throw new Error('Tool missing: ' + toolName(def));
    const start = Date.now();
    let response;
    try {
      response = await client.callTool(
        { name: toolName(def), arguments: def.sample },
        undefined,
        { timeout: 90000 },
      );
    } catch (e) {
      response = {
        isError: true,
        content: [
          { type: 'text', text: JSON.stringify({ status: 'error', error: e.message }) },
        ],
      };
    }
    let output;
    try {
      output =
        response.structuredContent ||
        JSON.parse(response.content.find((c) => c.type === 'text').text);
    } catch {
      output = { status: 'error', error: 'INVALID_MCP_OUTPUT' };
    }
    const status = response.isError ? 'error' : output.status;
    if (!['returned', 'device_warning', 'error'].includes(status))
      throw new Error('Unexpected output status');
    report.records.push({
      api: def.api,
      section: def.key,
      group: def.group,
      status,
      ms: Date.now() - start,
      output,
    });
    report.summary[status]++;
    console.log(`${def.key}: ${status}${output.error ? ' / ' + output.error : ''}`);
    if (status === 'error') {
      process.exitCode = 1;
      console.log(JSON.stringify(output.details?.diagnostics || [], null, 2));
      if (
        [
          'LOGIN_FAILED_CHECK_CREDENTIALS',
          'MISSING_CREDENTIALS',
          'DEVICE_UNREACHABLE',
          'DEVICE_TIMEOUT',
        ].includes(output.error)
      )
        stop = true;
    }
  }
  const invalid = await client.callTool({
    name: 't830_query',
    arguments: { section: 'reboot' },
  });
  report.invalidSectionRejected = !!invalid.isError;
  if (!invalid.isError) {
    throw new Error('Invalid query accepted');
  }
  console.log('SUMMARY', JSON.stringify(report.summary));
} finally {
  await writeReport(
    'live/mcp-smoke-results.json',
    JSON.stringify(report, null, 2),
  );
  await client.close();
}
