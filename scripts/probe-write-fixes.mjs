import { mkdir, writeFile } from 'node:fs/promises';
import { T830 } from '../src/t830.mjs';
const device = new T830({ ...process.env, T830_ENABLE_WRITES: '0' });
const directory = new URL('../reports/live/write-fixes-2026-10-20/', import.meta.url);
const sources = new URL('../.agent-state/write-fix-sources/', import.meta.url);
await mkdir(directory, { recursive: true });
await mkdir(sources, { recursive: true });
const report = { at: new Date().toISOString(), mode: 'read-only-device-code-inspection', files: [] };
try {
  await device.login();
  const access = await device.rawRpc('session', 'access', { scope: 'ubus', object: 'file', function: 'read' });
  if (access.access) for (const path of ['/usr/lib/lua/luci/controller/login.lua', '/usr/lib/lua/luci/controller/jt_system.lua', '/usr/lib/lua/luci/controller/jt_firewall.lua', '/usr/lib/lua/luci/dispatcher.lua']) {
    try {
      const output = await device.rawRpc('file', 'read', { path }, true);
      if (typeof output.data === 'string') {
        await writeFile(new URL(path.split('/').at(-1), sources), output.data);
        report.files.push({ path, saved: true, bytes: output.data.length });
      } else report.files.push({ path, saved: false });
    } catch (error) { report.files.push({ path, error: error.message }); }
  }
} catch (error) { report.error = error.message; }
finally {
  await device.close();
  await writeFile(new URL('source-inspection.json', directory), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
