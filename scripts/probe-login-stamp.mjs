import { mkdir, writeFile } from 'node:fs/promises';
import { T830 } from '../src/t830.mjs';

// 只读：在 UCI 和 /tmp 文件名中搜索 CGI 登录 last_stamp 可能的来源，原始结果只写入被忽略的 tmp/。
const device = new T830({ ...process.env, T830_AUTH_TRANSPORT: 'ubus', T830_AUTH_MODE: 'developer', T830_ENABLE_WRITES: '0' });
await device.login();
const out = { at: new Date().toISOString(), matches: [] };
const configs = (await device.rawRpc('file', 'list', { path: '/etc/config' })).entries.map(entry => entry.name);
out.configs = configs;
for (const config of configs) {
  let values;
  try { values = (await device.rawRpc('uci', 'get', { config })).values; }
  catch (error) { out.matches.push({ config, error: error.message }); continue; }
  for (const [section, options] of Object.entries(values)) {
    for (const [option, value] of Object.entries(options)) {
      if (/stamp|login|fail|lock|wait/i.test(option + ' ' + section + ' ' + options['.type']))
        out.matches.push({ config, section, type: options['.type'], option, value: /pass|key|secret|token/i.test(option) ? '<redacted>' : value });
    }
  }
}
for (const path of ['/tmp', '/var', '/tmp/luci-sessions', '/tmp/run', '/etc']) {
  try { out[path] = (await device.rawRpc('file', 'list', { path })).entries.map(entry => `${entry.type[0]} ${entry.name} ${entry.size}`); }
  catch (error) { out[path] = error.message; }
}
await mkdir(new URL('../tmp/cgi-auth-now/', import.meta.url), { recursive: true });
await writeFile(new URL('../tmp/cgi-auth-now/login-stamp.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.configs));
for (const match of out.matches) console.log(JSON.stringify(match));
for (const path of ['/tmp', '/var', '/tmp/luci-sessions', '/tmp/run', '/etc']) console.log(path, JSON.stringify(out[path]));
