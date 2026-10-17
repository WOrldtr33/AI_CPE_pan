import { T830 } from '../src/t830.mjs';

const device = new T830();

const result = await device.rpc('session', 'access', {
  scope: 'ubus',
  object: 'web_api',
  function: 'get_wifi_router',
});

console.log('Router 权限', JSON.stringify(result, null, 2));

const mode = await device.rpc('web_api', 'get_workmode');

console.log('当前工作模式', JSON.stringify(mode, null, 2));

try {
  const router = await device.rpc('web_api', 'get_wifi_router');
  console.log('Router: ', JSON.stringify(router, null, 2));
} catch (error) {
  console.error('Router 查询失败', error.message);
}
