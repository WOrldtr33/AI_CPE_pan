import { timestamp } from '../src/time.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeReport } from '../src/artifacts.mjs';
const client = new Client({ name: 't830-concurrency-smoke', version: '1' });
const report = {
  at: timestamp(),
  mode: 'live-read-only',
  scope: 'concurrent MCP submissions; FIFO operations in one server',
  batches: [],
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
      env: { ...process.env, T830_ENABLE_WRITES: '0' },
      stderr: 'inherit',
    }),
  );
  for (const sections of [
    ['wifi', 'version', 'mesh_status', 'dhcp', 'workmode', 'country'],
    ['mesh_status', 'share', 'version'],
  ]) {
    const start = Date.now();
    const records = await Promise.all(
      sections.map(async (section) => {
        try {
          const response = await client.callTool(
            { name: `t830_get_${section}`, arguments: {} },
            undefined,
            { timeout: 90000 },
          );
          const output =
            response.structuredContent ||
            JSON.parse(response.content.find((c) => c.type === 'text').text);
          return { section, isError: !!response.isError, output };
        } catch (e) {
          return {
            section,
            isError: true,
            output: { status: 'error', error: e.message },
          };
        }
      }),
    );
    report.batches.push({ sections, ms: Date.now() - start, records });
  }
  const records = report.batches.flatMap((b) => b.records);
  const queue = records.map((r) =>
    (r.output.diagnostics || r.output.details?.diagnostics || []).find(
      (t) => t.step === 'queue',
    ),
  );
  report.summary = {
    calls: records.length,
    returned: records.filter((r) => !r.isError).length,
    error: records.filter((r) => r.isError).length,
    expectedReadsReturned: records
      .filter((r) => r.section !== 'share')
      .every((r) => !r.isError),
    failureDidNotBlockLaterRead:
      report.batches[1].records[2].output.status === 'returned',
    queueRecordsPresent: queue.every(Boolean),
    operationIdsUnique: new Set(queue.map((q) => q?.operationId)).size === records.length,
  };
  if (
    !report.summary.expectedReadsReturned ||
    !report.summary.failureDidNotBlockLaterRead ||
    !report.summary.queueRecordsPresent ||
    !report.summary.operationIdsUnique
  )
    process.exitCode = 1;
  console.log(JSON.stringify(report.summary, null, 2));
} finally {
  await writeReport(
    'live/concurrency-smoke-results.json',
    JSON.stringify(report, null, 2),
  );
  await client.close();
}
