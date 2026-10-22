import { mkdir, writeFile } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { redact } from '../src/t830.mjs';

// 只读：核对 WPS 运行状态的 name 取值，并记录蜂窝/短信写测试前的基线。
const directory = new URL('../reports/live/ubus-writes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
const mcp = await connectTools(['wps', 'wps_run', 'network_mode', 'sim_slot', 'band_lock', 'sms_all', 'sms_center', 'status'], process.env);
const report = { at: new Date().toISOString(), calls: [] };
const call = async (tool, args = {}) => {
  let output;
  try { output = await mcp.call(tool, args); }
  catch (error) { output = { status: 'error', error: error.message }; }
  report.calls.push({ tool, args, status: output.status, data: output.data, reading: output.reading, warnings: output.warnings, error: output.error });
  console.log(tool, JSON.stringify(args), output.status, JSON.stringify(output.data ?? output.error).slice(0, 900));
};
try {
  await call('t830_get_wps');
  for (const name of ['ra0', '2.4G', '5G', 'Unity']) await call('t830_get_wps_run', { name, obj: 'host' });
  for (const key of ['network_mode', 'sim_slot', 'band_lock', 'sms_all', 'sms_center', 'status']) await call('t830_get_' + key);
} finally {
  await writeFile(new URL('cellular-contracts.json', directory), JSON.stringify(redact(report), null, 2));
  await mcp.close();
}
