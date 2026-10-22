import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { redact } from '../src/t830.mjs';

if (!process.argv.includes('--apply') || !process.argv.includes('--wired-management-confirmed')) throw new Error('REQUIRES_APPLY_AND_WIRED_MANAGEMENT');
const path = new URL('../reports/live/systematic-writes-2026-10-20/wifi-switches.json', import.meta.url);
const report = { at: new Date().toISOString(), mode: 'real-device-switch-and-restore', management: 'wired-route-verified', records: [], cases: [] };
const mcp = await connectTools(['wifi', 'guest', 'device_info'], process.env, { enableWrites: true });
const save = () => writeFile(path, JSON.stringify(redact(report), null, 2));
async function call(name, args = {}, write = false) {
  let output;
  try { output = write ? await mcp.executeApprovedWrite(name, args) : await mcp.call(name, args); }
  catch (error) { output = { status: 'error', error: error.message }; }
  report.records.push({ name, args, write, output });
  await save();
  console.log(`${name}: ${output.status}${output.error ? ' / ' + output.error : ''}`);
  return output;
}
async function state(section, band, expected) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await call('t830_get_' + section);
    if (result.status === 'returned' && result.data?.[band]?.state === expected) return true;
    await delay(1000);
  }
  return false;
}
try {
  for (const [section, bands] of [['wifi', ['2.4G', '5G']], ['guest', ['Guest', 'Guest5G']]]) {
    for (const band of bands) {
      const before = await call('t830_get_' + section);
      const original = before.data?.[band]?.state;
      if (before.status !== 'returned' || !['up', 'down'].includes(original)) continue;
      const target = original === 'up' ? 'down' : 'up';
      const record = { key: section + '_switch', band, original, target, changed: false, restored: false };
      report.cases.push(record);
      try {
        const sent = await call('t830_set_' + section + '_switch', { name: band, action: target }, true);
        record.changed = sent.submissionOutcome === 'acknowledged' && await state(section, band, target);
      } finally {
        const current = await call('t830_get_' + section);
        if (current.status !== 'returned') throw new Error('RESTORE_READ_FAILED_' + band);
        const observed = current.data?.[band]?.state;
        if (observed === target) await call('t830_set_' + section + '_switch', { name: band, action: original }, true);
        else if (observed !== original) throw new Error('RESTORE_CONFLICT_' + band);
        record.restored = await state(section, band, original);
        await save();
        if (!record.restored) throw new Error('RESTORE_UNCONFIRMED_' + band);
      }
    }
  }
  const final = await call('t830_get_device_info');
  report.deviceResponding = final.status === 'returned';
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  await save();
  await mcp.close();
  console.log(JSON.stringify({ cases: report.cases, deviceResponding: report.deviceResponding, error: report.error }));
}
