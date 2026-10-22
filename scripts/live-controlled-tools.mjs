import { readFile, writeFile } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads } from '../src/catalog.mjs';
import { redact } from '../src/t830.mjs';
const path = new URL('../reports/live/all-tools-2026-10-20/results.json', import.meta.url);
const report = JSON.parse(await readFile(path, 'utf8'));
const save = () => writeFile(path, JSON.stringify(redact(report), null, 2));
const mcp = await connectTools(reads.map(def => def.key), process.env, { enableWrites: true });
const call = async (name, args, write = false) => {
  const output = write ? await mcp.executeApprovedWrite(name, args) : await mcp.call(name, args);
  report.controlledWrites.push({ at: new Date().toISOString(), tool: name, args, write, output });
  await save(); console.log(`${name}: ${output.status}${output.error ? ' / ' + output.error : ''}`);
  return output;
};
try {
  for (const section of ['upnp', 'dns']) {
    const field = section === 'upnp' ? 'upnp_switch' : 'rebind_protection';
    const extract = result => section === 'upnp' ? result.data?.data?.upnp_switch : result.data?.data;
    const baseline = await call(`t830_get_${section}`, {});
    const original = String(extract(baseline));
    if (baseline.status !== 'returned' || !['0', '1'].includes(original)) continue;
    const target = original === '0' ? '1' : '0';
    const row = { section, original, target, restored: false, testVerified: false };
    (report.writeRestoration ||= []).push(row); await save();
    let attempted = false;
    try {
      attempted = true;
      const name = section === 'upnp' ? 't830_set_upnp_verified' : 't830_set_dns';
      const args = { [field]: target, ...(section === 'upnp' ? { expectedCurrent: original } : {}) };
      const result = await call(name, args, true);
      row.testVerified = ['verified_field', 'verified_fields'].includes(result.status);
      if (!row.testVerified) row.error = result.error;
    } finally {
      if (attempted) {
        const current = await call(`t830_get_${section}`, {});
        if (current.status !== 'returned') throw new Error(`RESTORE_READ_FAILED_${section}`);
        if (String(extract(current)) === original) row.restored = true;
        else if (String(extract(current)) === target) {
          // 普通 UPnP 工具作为恢复步骤，也获得真实写入/回读证据。
          const result = await call(`t830_set_${section}`, { [field]: original }, true);
          row.restoreStatus = result.status;
          const after = await call(`t830_get_${section}`, {});
          row.restored = after.status === 'returned' && String(extract(after)) === original;
        } else throw new Error(`RESTORE_CONFLICT_${section}`);
      }
      await save();
      if (!row.restored) throw new Error(`RESTORATION_NOT_CONFIRMED_${section}`);
    }
  }
  // 相同 WiFi/访客开关值验证提交路径，不切换网络状态。
  for (const section of ['wifi', 'guest']) {
    const baseline = await call(`t830_get_${section}`, {});
    if (baseline.status !== 'returned') continue;
    for (const name of section === 'wifi' ? ['2.4G', '5G'] : ['Guest', 'Guest5G']) {
      const action = baseline.data?.[name]?.state;
      if (!['up', 'down'].includes(action)) continue;
      const result = await call(`t830_set_${section}_switch`, { name, action }, true);
      if (!['verified_field', 'verified_fields'].includes(result.status)) break;
    }
  }
} finally {
  await mcp.close();
  report.summary.controlledWriteCalls = report.controlledWrites.filter(row => row.write).length;
  report.summary.controlledWritesVerified = report.controlledWrites.filter(row => row.write && ['verified_field', 'verified_fields'].includes(row.output.status)).length;
  report.summary.realWrites = report.controlledWrites.filter(row => row.write).reduce((sum, row) => sum + (row.output.writeAttempts || 0), 0);
  report.summary.restoration = report.writeRestoration;
  await save();
}
