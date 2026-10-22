import { mkdir, writeFile } from 'node:fs/promises';
import { T830 } from '../src/t830.mjs';

// 只读：列出 superadmin 原生会话 ACL，并尝试只读定位 CGI 登录使用的 last_stamp 来源。
const directory = new URL('../tmp/cgi-auth-now/', import.meta.url);
await mkdir(directory, { recursive: true });
const device = new T830({ ...process.env, T830_AUTH_TRANSPORT: 'ubus', T830_AUTH_MODE: 'developer', T830_ENABLE_WRITES: '0' });
await device.login();
const report = { at: new Date().toISOString(), developer: device.developerAuthenticated };
const attempt = async (label, service, method, args) => {
  try { report[label] = await device.rawRpc(service, method, args); }
  catch (error) { report[label] = { error: error.message }; }
};
await attempt('access', 'session', 'access', { ubus_rpc_session: device.token });
for (const config of ['luci', 'system', 'jt_login', 'login', 'web_login', 'admin']) await attempt(`uci_${config}`, 'uci', 'get', { config });
for (const path of ['/tmp/last_stamp', '/tmp/login_stamp', '/tmp/luci_login', '/etc/config/luci']) await attempt(`file_${path}`, 'file', 'read', { path });
await attempt('list_tmp', 'file', 'list', { path: '/tmp' });
await attempt('stat_login', 'file', 'stat', { path: '/usr/lib/lua/luci/controller/login.lua' });
await writeFile(new URL('session-acl.json', directory), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.access).slice(0, 6000));
for (const [key, value] of Object.entries(report)) if (key !== 'access') console.log(key, JSON.stringify(value).slice(0, 400));
