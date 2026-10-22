import { mkdir, writeFile } from 'node:fs/promises';
import { T830, redact } from '../src/t830.mjs';
import { readByKey } from '../src/catalog.mjs';

// 只读：对照 CGI / UBUS 两种认证在当前设备上的登录结果及 CGI 读权限，不提交任何配置。
const directory = new URL('../reports/diagnostics/cgi-auth-now/', import.meta.url);
await mkdir(directory, { recursive: true });
const report = { at: new Date().toISOString(), cases: [] };
const variants = [
  { name: 'cgi-admin', T830_AUTH_TRANSPORT: 'cgi', T830_AUTH_MODE: 'admin' },
  { name: 'cgi-developer', T830_AUTH_TRANSPORT: 'cgi', T830_AUTH_MODE: 'developer' },
  { name: 'ubus-admin', T830_AUTH_TRANSPORT: 'ubus', T830_AUTH_MODE: 'admin' },
  { name: 'ubus-developer', T830_AUTH_TRANSPORT: 'ubus', T830_AUTH_MODE: 'developer' },
];
for (const variant of variants) {
  const { name, ...overrides } = variant;
  const device = new T830({ ...process.env, ...overrides, T830_ENABLE_WRITES: '0' });
  const record = { name };
  try {
    await device.login();
    record.login = 'ok';
    record.developer = device.developerAuthenticated;
    for (const key of ['dns', 'dhcp', 'gps', 'developer_mode', 'upnp']) {
      try {
        const out = await device.run(readByKey[key]);
        record[key] = { status: out.status, warnings: out.warnings, data: out.data };
      } catch (error) {
        record[key] = { error: error.message, details: error.details };
      }
    }
  } catch (error) {
    record.login = error.message;
    record.details = error.details;
  }
  await device.close?.().catch(() => {});
  report.cases.push(redact(record));
  console.log(name, JSON.stringify(redact(record)).slice(0, 600));
}
await writeFile(new URL('probe.json', directory), JSON.stringify(report, null, 2));
