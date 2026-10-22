import { T830 } from '../src/t830.mjs';

// 只读：读取 CGI 登录计时文件的元数据和内容（以 JSON 转义显示不可见字符），不修改设备。
const device = new T830({ ...process.env, T830_AUTH_TRANSPORT: 'ubus', T830_AUTH_MODE: 'developer', T830_ENABLE_WRITES: '0' });
await device.login();
for (const path of ['/tmp/last_login_time', '/tmp/login_fail_count']) {
  for (const [method, args] of [['stat', { path }], ['read', { path }], ['read', { path, base64: true }], ['md5', { path }]]) {
    try { console.log(path, method, JSON.stringify(await device.rawRpc('file', method, args))); }
    catch (error) { console.log(path, method, error.message); }
  }
}
try { console.log('system.info', JSON.stringify(await device.rawRpc('system', 'info', {}))); }
catch (error) { console.log('system.info', error.message); }
