import { randomBytes } from 'node:crypto';
import { T830, redact } from '../src/t830.mjs';
import { readByKey } from '../src/catalog.mjs';

// 只读：在已认证的原生会话里按 LuCI 登录流程写入 token/username 会话值，再对照 CGI 读取是否仍 403。
for (const mode of ['admin', 'developer']) {
  const device = new T830({ ...process.env, T830_AUTH_TRANSPORT: 'ubus', T830_AUTH_MODE: mode, T830_ENABLE_WRITES: '0' });
  await device.login();
  const username = device.developerAuthenticated ? 'superadmin' : device.username;
  const show = async label => {
    for (const key of ['dns', 'developer_mode']) {
      try { const out = await device.run(readByKey[key]); console.log(mode, label, key, out.status, JSON.stringify(redact(out.data)).slice(0, 300)); }
      catch (error) { console.log(mode, label, key, error.message); }
    }
  };
  await show('before');
  try {
    const before = await device.rawRpc('session', 'get', { ubus_rpc_session: device.token });
    console.log(mode, 'session.get before', JSON.stringify(Object.keys(before?.values || {})));
  } catch (error) { console.log(mode, 'session.get before', error.message); }
  try {
    await device.rawRpc('session', 'set', { ubus_rpc_session: device.token, values: { token: randomBytes(16).toString('hex'), username } });
    console.log(mode, 'session.set ok');
  } catch (error) { console.log(mode, 'session.set', error.message); }
  await show('after');
}
