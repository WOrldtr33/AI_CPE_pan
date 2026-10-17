import { timestamp } from '../src/time.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeReport } from '../src/artifacts.mjs';
const apply = process.argv.includes('--apply');
if (process.argv.slice(2).some((arg) => arg !== '--apply'))
  throw new Error('Usage: node scripts/write-smoke.mjs [--apply]');
const client = new Client({ name: 'controlled-write-smoke', version: '1' });
const report = {
  at: timestamp(),
  mode: apply ? 'live-upnp-change-and-restore' : 'live-upnp-preview',
  records: [],
  summary: { testVerified: false, restored: false },
};
let original,
  target,
  submitted = false;
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  const output =
    response.structuredContent ||
    JSON.parse(response.content.find((c) => c.type === 'text').text);
  report.records.push({
    at: timestamp(),
    tool: name,
    args,
    output,
    isError: !!response.isError,
  });
  if (response.isError)
    throw Object.assign(new Error(output.error), { details: output.details });
  return output;
};
const read = async () => {
  const output = await call('t830_get_upnp');
  const value = output.data?.data?.upnp_switch;
  if (output.status !== 'returned' || !['0', '1', 0, 1].includes(value))
    throw new Error('UPNP_BASELINE_UNAVAILABLE');
  return String(value);
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
      env: { ...process.env, T830_ENABLE_WRITES: apply ? '1' : '0' },
      stderr: 'inherit',
    }),
  );
  original = await read();
  target = original === '0' ? '1' : '0';
  report.original = original;
  report.testTarget = target;
  if (apply) {
    // 调用者期望的原值作为条件，避免把预检后变化的状态直接覆盖。
    submitted = true;
    const output = await call('t830_set_upnp_verified', {
      upnp_switch: target,
      expectedCurrent: original,
    });
    report.summary.testVerified = output.status === 'verified_field';
  } else report.note = '只读预览；加 --apply 才会修改 UPnP，并尝试有条件恢复。';
} catch (e) {
  report.error = { code: e.message, details: e.details };
  process.exitCode = 1;
} finally {
  if (submitted) {
    try {
      const current = await read();
      if (current === original) {
        report.summary.restored = true;
        report.restoreNote = '当前已经是原值，无需再写。';
      } else if (current === target) {
        // 此次测试的恢复是显式操作，不是工作流自动回滚；再次校验当前值。
        const output = await call('t830_set_upnp_verified', {
          upnp_switch: original,
          expectedCurrent: target,
        });
        report.summary.restored =
          output.status === 'verified_field' && (await read()) === original;
      } else throw new Error('RESTORE_CONFLICT');
    } catch (e) {
      report.restoreError = { code: e.message, details: e.details };
      process.exitCode = 1;
    }
  }
  if (apply && (!report.summary.testVerified || !report.summary.restored))
    process.exitCode = 1;
  await writeReport(
    'live/write-live-results.json',
    JSON.stringify(report, null, 2),
  );
  await client.close();
  console.log(
    JSON.stringify(
      {
        original,
        target,
        ...report.summary,
        error: report.error?.code,
        restoreError: report.restoreError?.code,
      },
      null,
      2,
    ),
  );
}
