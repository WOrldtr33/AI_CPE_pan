import { mkdir, writeFile } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { redact } from '../src/t830.mjs';

// 只读：记录 UBUS 写工具测试前的基线（MCP 返回值已脱敏）。
const sections = ['wifi', 'guest', 'wps', 'wifi_ad', 'wifi_night', 'reboot_schedule', 'traffic', 'roaming', 'sms_center', 'clients', 'network_mode', 'band_lock', 'sim_slot', 'sim', 'status', 'time'];
const directory = new URL('../reports/live/ubus-writes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
const mcp = await connectTools(sections, process.env);
const report = { at: new Date().toISOString(), baselines: {} };
try {
  for (const key of sections) {
    let output;
    try { output = await mcp.call('t830_get_' + key, {}); }
    catch (error) { output = { status: 'error', error: error.message }; }
    report.baselines[key] = { status: output.status, data: output.data, reading: output.reading, warnings: output.warnings, error: output.error };
    console.log(key, output.status, JSON.stringify(output.data ?? output.error).slice(0, 700));
  }
} finally {
  const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) || 'baselines';
  await writeFile(new URL(`${label}.json`, directory), JSON.stringify(redact(report), null, 2));
  await mcp.close();
}
