import { createHash, randomInt } from 'node:crypto';

// 只读诊断：按厂商网页的字段顺序和 salt 字符集提交 CGI 登录，记录原始 HTTP 状态与正文。
const base = process.env.T830_BASE_URL || 'http://192.168.0.1';
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.';
const salt = Array.from({ length: 64 }, () => alphabet[randomInt(alphabet.length)]).join('');
const show = async (label, response) => {
  const text = await response.text();
  console.log(label, response.status, JSON.stringify(Object.fromEntries(response.headers)), text.slice(0, 1500).replace(/"sessionid":"[^"]+"/, '"sessionid":"<redacted>"'));
};
await show('login_status', await fetch(`${base}/cgi-bin/luci/login/get_login_status?flag=get_login_status&t=${Date.now()}`));
const body = {
  password: createHash('sha256').update(salt + ':' + process.env.T830_PASSWORD).digest('hex'),
  salt,
  username: process.env.T830_USERNAME || 'admin',
};
await show('action_login', await fetch(`${base}/cgi-bin/luci/login/action_login?flag=action_login&t=${Date.now()}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: base, Referer: base + '/' },
  body: JSON.stringify(body),
}));
