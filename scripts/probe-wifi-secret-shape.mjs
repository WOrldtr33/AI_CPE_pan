import { T830 } from '../src/t830.mjs';

// 只读：检查原生会话返回的 WiFi 密码是否为掩码，只输出长度与字符类别，不输出内容。
const device = new T830({ ...process.env, T830_AUTH_MODE: 'admin', T830_ENABLE_WRITES: '0' });
await device.login();
const shape = value => typeof value !== 'string' ? typeof value : {
  length: value.length,
  allMask: /^[*•x]+$/i.test(value),
  classes: [/[a-z]/.test(value) && 'lower', /[A-Z]/.test(value) && 'upper', /\d/.test(value) && 'digit', /[^A-Za-z0-9]/.test(value) && 'symbol'].filter(Boolean),
};
for (const [method, bands] of [['get_ssidPage_info', ['2.4G', '5G']], ['get_guestPage_info', ['Guest', 'Guest5G']]]) {
  const data = await device.rawRpc('mtk.wifi', method, {});
  for (const band of bands) console.log(method, band, 'ssidLength', data[band]?.ssid?.length, 'wpapsk', JSON.stringify(shape(data[band]?.wpapsk)), 'authmode', data[band]?.authmode);
}
