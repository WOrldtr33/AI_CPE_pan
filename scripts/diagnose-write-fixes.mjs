import { mkdir, writeFile } from 'node:fs/promises';
import { T830, redact } from '../src/t830.mjs';
const directory = new URL('../reports/diagnostics/write-fixes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
const device = new T830({ ...process.env, T830_ENABLE_WRITES: '0' });
const report = { at: new Date().toISOString(), probes: [], files: [] };
try {
  await device.login();
  const cookie = device.cookies.map(row => row.pair).join('; ');
  for (const bearer of [false, true]) {
    const response = await fetch(new URL('/cgi-bin/luci/admin/jt_lan/get_dhcp?flag=get_dhcp&t=' + Date.now(), device.base), {
      headers: { Cookie: cookie, ...(bearer ? { Authorization: 'Bearer ' + device.token } : {}), Origin: device.base.origin, Referer: device.base.href },
      signal: AbortSignal.timeout(10000),
    });
    report.probes.push({ bearer, http: response.status, loginRequired: response.headers.get('x-luci-login-required') });
  }
  for (const path of ['/usr/lib/lua/luci/controller/login.lua', '/usr/lib/lua/luci/dispatcher.lua', '/usr/lib/lua/luci/controller/jt_system.lua', '/usr/lib/lua/luci/controller/jt_lan.lua']) {
    try {
      const result = await device.rawRpc('file', 'read', { path }, true);
      if (typeof result.data === 'string') {
        const name = path.split('/').at(-1);
        await writeFile(new URL(name + '.txt', directory), result.data);
        report.files.push({ path, captured: true, characters: result.data.length });
      } else report.files.push({ path, captured: false, keys: Object.keys(result) });
    } catch (error) { report.files.push({ path, error: error.message }); }
  }
} catch (error) { report.error = error.message; }
finally {
  await device.close();
  await writeFile(new URL('probes.json', directory), JSON.stringify(redact(report), null, 2));
  console.log(JSON.stringify(report));
}
