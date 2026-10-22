import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { timestamp } from '../src/time.mjs';
import { writeReport } from '../src/artifacts.mjs';
import { redact, T830 } from '../src/t830.mjs';
import { readByKey } from '../src/catalog.mjs';

// 分阶段通过真实 MCP 调用 CGI 写工具：原值提交、测试条目增删、会话与密码往返、重启。
const phases = ['config', 'setup', 'rules', 'mesh', 'workmode', 'auth', 'password', 'reboot'];
const phase = process.argv[2];
if (!phases.includes(phase) || process.argv[3] !== '--apply')
  throw new Error(`Usage: node scripts/live-cgi-writes-full.mjs <${phases.join('|')}> --apply`);
const base = process.env.T830_BASE_URL || 'http://192.168.0.1';
const serverPath = fileURLToPath(new URL('../src/server.mjs', import.meta.url));
const report = { at: timestamp(), phase, records: [], results: [] };
let client;
const connect = async (env = {}) => {
  client = new Client({ name: `live-cgi-${phase}`, version: '1' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, T830_ENABLE_WRITES: '1', ...env },
    stderr: 'inherit',
  }));
};
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
  const text = response.content?.find((c) => c.type === 'text')?.text || '';
  let output = response.structuredContent;
  if (!output) try { output = JSON.parse(text); } catch { output = { error: text.slice(0, 300) }; }
  report.records.push({ at: timestamp(), tool: name, args: redact(args), isError: !!response.isError, output });
  return { ok: !response.isError, output, data: output.data };
};
const read = async (section) => {
  const r = await call(`t830_get_${section}`);
  if (!r.ok) throw new Error(`READ_${section}_${r.output.error}`);
  return r.data;
};
const record = (tool, outcome, detail = {}) => {
  report.results.push({ tool, outcome, ...detail });
  console.log(outcome.padEnd(8), tool, JSON.stringify(redact(detail)).slice(0, 300));
};
const writeOutcome = (w) => ({ writeStatus: w.ok ? w.output.status : 'error', writeError: w.output.error, deviceCode: w.data?.code });
const strip = (value, keys) => JSON.parse(JSON.stringify(value, (k, v) => (keys.includes(k) ? undefined : v)));
// 原值提交：提交前后回读一致才算通过。
const sameValue = async (tool, section, args, ignore = []) => {
  const before = strip(await read(section), ignore);
  const w = await call(tool, args);
  const after = strip(await read(section), ignore);
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  record(tool, w.ok && unchanged ? 'passed' : 'failed', { ...writeOutcome(w), unchanged, ...(unchanged ? {} : { before, after }) });
};
// 新增测试条目 → 回读找到 → 删除 → 回读确认消失。
// MCP 输出会脱敏 MAC 等字段，规则列表改用本进程只读原始读取来定位测试条目。
let rawReader;
const rawRead = async (section) => {
  rawReader ||= new T830({ ...process.env, T830_ENABLE_WRITES: '0' });
  let raw;
  await rawReader.run(readByKey[section], {}, { captureRaw: (v) => { raw = v; } });
  return raw;
};
const addDelete = async ({ tool, section, list, add, match, del }) => {
  const rows = async () => list(await rawRead(section)) || [];
  const leftover = (await rows()).find(match);
  if (leftover) {
    const cleanup = await call(tool, del(leftover));
    report.results.push({ tool, outcome: 'cleanup', cleanup: writeOutcome(cleanup) });
    if ((await rows()).some(match)) throw new Error(`${tool}_LEFTOVER_NOT_REMOVED`);
  }
  const added = await call(tool, add);
  const row = (await rows()).find(match);
  const detail = { add: writeOutcome(added), found: !!row };
  if (row) {
    const removed = await call(tool, del(row));
    const gone = !(await rows()).some(match);
    Object.assign(detail, { del: writeOutcome(removed), gone });
    record(tool, added.ok && removed.ok && gone ? 'passed' : 'failed', detail);
  } else record(tool, 'failed', detail);
};
const waitOnline = async (limitMs, label) => {
  const started = Date.now();
  await delay(5000);
  while (Date.now() - started < limitMs) {
    try {
      const r = await fetch(`${base}/cgi-bin/luci/login/get_login_status?flag=get_login_status&t=${Date.now()}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok && Number((await r.json()).code) === 0) {
        const seconds = Math.round((Date.now() - started) / 1000);
        report[`${label}OnlineAfterSeconds`] = seconds;
        return seconds;
      }
    } catch {}
    await delay(5000);
  }
  throw new Error(`${label}_DEVICE_NOT_BACK`);
};
const cgiLogin = async (password) => {
  const salt = randomBytes(32).toString('hex');
  const r = await fetch(`${base}/cgi-bin/luci/login/action_login?flag=action_login&t=${Date.now()}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', salt, password: createHash('sha256').update(salt + ':' + password).digest('hex') }),
  });
  const body = r.ok ? await r.json() : {};
  return { http: r.status, code: body.code };
};
const lanBase = (gateway) => gateway.split('.').slice(0, 3).join('.');

const run = {
  async config() {
    await sameValue('t830_set_dmz', 'dmz', { dmz_switch: '0' });
    const alg = (await read('alg')).data;
    const flag = (v) => String(Number(v) ? 1 : 0);
    await sameValue('t830_set_alg', 'alg', { alg_switch: flag(alg.alg_switch), enable_tftp: flag(alg.enable_tftp), enable_ftp: flag(alg.enable_ftp), enable_pptp: flag(alg.enable_pptp), enable_sip: flag(alg.enable_sip), enable_h323: flag(alg.enable_h323) });
    const dhcp = (await read('dhcp')).data;
    await sameValue('t830_set_dhcp', 'dhcp', { dhcp_switch: String(dhcp.dhcp_switch), gateway: dhcp.gateway, netmask: dhcp.netmask, leasetime: `${Number(dhcp.leasetime) / 3600}h`, start: String(dhcp.start), end: String(dhcp.end) });
    const ntp = (await read('ntp')).data;
    await sameValue('t830_set_ntp', 'ntp', String(ntp.ntp_switch) === '1'
      ? { ntp_switch: '1', ntp_server1: ntp.ntp_server1, ntp_server2: ntp.ntp_server2, zonename: ntp.zonename }
      : { ntp_switch: '0', ntp_server1: ntp.ntp_server1, ntp_server2: ntp.ntp_server2, current_time: ntp.current_time, timezone: ntp.timezone }, ['current_time']);
    const role = (await read('mesh_role')).data;
    await sameValue('t830_set_mesh_role', 'mesh_role', { role: String(role.role) });
    // 凭据类区段需原始值：只在本进程内从基线文件读取，不写入报告。
    const raw = JSON.parse(await readFile('tmp/cgi-writes/baseline-raw.json', 'utf8'));
    const tr = raw.tr069.data;
    await sameValue('t830_set_tr069', 'tr069', { enable: tr.enable, acs_url: tr.acs_url, acs_username: tr.acs_username, acs_password: tr.acs_password, periodic_enable: tr.periodic_enable, periodic_interval: tr.periodic_interval, cpe_username: tr.cpe_username, cpe_password: tr.cpe_password, cpe_apn: tr.cpe_apn });
  },
  async setup() {
    // 设备读取的 user_password 是占位值；该字段是网页登录密码，原值即当前管理员密码。
    const original = process.env.T830_PASSWORD;
    const s = JSON.parse(await readFile('tmp/cgi-writes/baseline-raw.json', 'utf8')).setup.data;
    await sameValue('t830_set_setup_save', 'setup', { Unity_switch: s.Unity_switch, first_login: 0, lang: s.lang, wifi_power: s.wifi_power, wifi2g_ssid: s.wifi2g_ssid, wifi5g_ssid: s.wifi5g_ssid, wifi2g_password: s.wifi2g_password, wifi5g_password: s.wifi5g_password, wifi_ssid: s.wifi2g_ssid, samePwdCheck: '1', user_password: original });
    const loginOriginal = await cgiLogin(original);
    const detail = { loginOriginal };
    if (Number(loginOriginal.code) !== 0) {
      detail.loginWifiPassword = await cgiLogin(s.wifi2g_password);
      if (Number(detail.loginWifiPassword.code) === 0) {
        await client.close();
        await connect({ T830_PASSWORD: s.wifi2g_password });
        const restore = await call('t830_set_password', { username: 'admin', old_password: s.wifi2g_password, new_password: original });
        detail.restore = writeOutcome(restore);
        detail.loginOriginalAfterRestore = await cgiLogin(original);
        await client.close();
        await connect();
      }
    }
    record('setup_admin_password_check', Number((detail.loginOriginalAfterRestore || loginOriginal).code) === 0 ? 'passed' : 'failed', detail);
    await sameValue('t830_set_developer_login', 'developer_mode', {});
  },
  async rules() {
    const dhcp = (await read('dhcp')).data;
    const net = lanBase(dhcp.gateway);
    const ip = (n) => `${net}.${Number(dhcp.end) - n}`;
    await addDelete({
      tool: 't830_set_static_ip', section: 'static_ip', list: (d) => d.data,
      add: { ip: ip(1), mac: '02:00:00:00:00:A1', name: 'mcptest', operate: 'add' },
      match: (r) => String(r.mac || r.macaddr || '').toUpperCase() === '02:00:00:00:00:A1',
      del: (r) => ({ ip: r.ip, mac: '02:00:00:00:00:A1', name: 'mcptest', operate: 'del' }),
    });
    await addDelete({
      tool: 't830_set_mac_filter_rule', section: 'mac_filter', list: (d) => d.data.macfilter_list,
      add: { macaddr: '02:00:00:00:00:A2', name: 'mcptest', operate: 'add' },
      match: (r) => r.name === 'mcptest',
      del: () => ({ macaddr: '02:00:00:00:00:A2', operate: 'del' }),
    });
    await addDelete({
      tool: 't830_set_ip_filter_rule', section: 'ip_filter', list: (d) => d.data.ipfilter_list,
      add: { ip_family: 'ipv4', protocol: 'tcp', proto: 'tcp', name: 'mcptest', lan_ip: ip(2), lan_port: '65000', operate: 'add' },
      match: (r) => r.name === 'mcptest',
      del: (r) => ({ index: String(r.index), ip_family: r.ip_family || 'ipv4', lan_ip: r.lan_ip, name: r.name, protocol: r.proto || r.protocol, operate: 'del' }),
    });
    await addDelete({
      tool: 't830_set_port_forward_rule', section: 'port_forward', list: (d) => d.data.rules,
      add: { name: 'mcptest', lan_ip: ip(2), protocol: 'tcp', start_port: '65001', end_port: '65001', operate: 'add' },
      match: (r) => r.name === 'mcptest',
      del: (r) => ({ name: r.name, lan_ip: r.lan_ip, protocol: r.protocol, start_port: String(r.start_port), end_port: String(r.end_port), index: String(r.index), operate: 'del' }),
    });
    await addDelete({
      tool: 't830_set_port_map_rule', section: 'port_map', list: (d) => d.data.rules,
      add: { name: 'mcptest', wan_port: '65002', lan_ip: ip(2), lan_port: '65002', protocol: 'tcp', start_port: '65002', end_port: '65002', operate: 'add' },
      match: (r) => r.name === 'mcptest',
      del: (r) => ({ name: r.name, wan_port: String(r.wan_port), lan_ip: r.lan_ip, lan_port: String(r.lan_port), protocol: r.protocol, index: String(r.index), operate: 'del' }),
    });
  },
  async mesh() {
    const scan = await call('t830_set_wifi_scan_start', { async: '1', state: '1' });
    await delay(8000);
    const list = await call('t830_set_wifi_scan_list', { state: '2' });
    record('t830_set_wifi_scan_start', scan.ok ? 'passed' : 'failed', writeOutcome(scan));
    const networks = list.data?.data?.wifi_list || list.data?.data || list.data?.wifi_list;
    record('t830_set_wifi_scan_list', list.ok ? 'passed' : 'failed', { ...writeOutcome(list), networks: Array.isArray(networks) ? networks.length : typeof networks });
    const workmode = JSON.stringify((await read('workmode')).data);
    const disc = await call('t830_set_wifi_router_disconnect', { connect: '0' });
    const workmodeAfter = JSON.stringify((await read('workmode')).data);
    record('t830_set_wifi_router_disconnect', disc.ok && workmode === workmodeAfter ? 'passed' : 'failed', { ...writeOutcome(disc), workmodeUnchanged: workmode === workmodeAfter });
    const routers = JSON.stringify(await read('mesh_routers'));
    for (const [tool, args] of [['t830_set_mesh_router_name', { al_mac: '02:00:00:00:00:A3', name: 'mcptest' }], ['t830_set_mesh_router_remove', { al_mac: '02:00:00:00:00:A3' }]]) {
      const w = await call(tool, args);
      const unchanged = JSON.stringify(await read('mesh_routers')) === routers;
      record(tool, w.ok && unchanged ? 'passed' : 'failed', { ...writeOutcome(w), note: '当前无 Mesh 子节点，使用不存在的 MAC', unchanged });
    }
    await sameValue('t830_set_mesh_close', 'mesh_status', {});
    const status = JSON.stringify(await read('mesh_status'));
    const onboard = await call('t830_set_mesh_onboard', { on_boaid: '1' });
    await delay(5000);
    const statusAfter = JSON.stringify(await read('mesh_status'));
    const detail = { ...writeOutcome(onboard), meshStatusUnchanged: status === statusAfter };
    if (status !== statusAfter) {
      const restore = await call('t830_set_mesh_close', {});
      detail.restore = writeOutcome(restore);
      detail.restoredStatus = JSON.stringify(await read('mesh_status')) === status;
    }
    record('t830_set_mesh_onboard', onboard.ok && (detail.meshStatusUnchanged || detail.restoredStatus) ? 'passed' : 'failed', detail);
  },
  async workmode() {
    const before = (await read('workmode')).data;
    const w = await call('t830_set_workmode', { workmode: Number(before.workmode), bonding: String(before.bonding), add_ccmni_to_bridge: String(before.add_ccmni_to_bridge), ip_passthrough: String(before.ip_passthrough) });
    await delay(10000);
    const seconds = await waitOnline(240000, 'workmode');
    await delay(10000);
    const after = (await read('workmode')).data;
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    record('t830_set_workmode', w.ok && unchanged ? 'passed' : 'failed', { ...writeOutcome(w), onlineAfterSeconds: seconds, unchanged, ...(unchanged ? {} : { before, after }) });
  },
  async auth() {
    const salt = randomBytes(32).toString('hex');
    const login = await call('t830_set_login', { username: process.env.T830_USERNAME || 'admin', salt, password: createHash('sha256').update(salt + ':' + process.env.T830_PASSWORD).digest('hex') });
    record('t830_set_login', login.ok && Number(login.data?.code) === 0 ? 'passed' : 'failed', writeOutcome(login));
    const logout = await call('t830_set_logout', {});
    const next = await call('t830_get_upnp');
    record('t830_set_logout', logout.ok && next.ok ? 'passed' : 'failed', { ...writeOutcome(logout), nextReadAfterRelogin: next.ok ? next.output.status : next.output.error });
  },
  async password() {
    const original = process.env.T830_PASSWORD;
    const temporary = `${original}Tmp`;
    const change = await call('t830_set_password', { username: 'admin', old_password: original, new_password: temporary });
    const loginTemp = await cgiLogin(temporary);
    const loginOriginalWhileChanged = await cgiLogin(original);
    const detail = { change: writeOutcome(change), loginTemporary: loginTemp, loginOriginalWhileChanged };
    let restore = await call('t830_set_password', { username: 'admin', old_password: temporary, new_password: original });
    if (!restore.ok) {
      await client.close();
      await connect({ T830_PASSWORD: temporary });
      restore = await call('t830_set_password', { username: 'admin', old_password: temporary, new_password: original });
      detail.restoreUsedTemporarySession = true;
    }
    detail.restore = writeOutcome(restore);
    detail.loginOriginalAfterRestore = await cgiLogin(original);
    const changed = Number(loginTemp.code) === 0;
    const restored = Number(detail.loginOriginalAfterRestore.code) === 0;
    report.passwordRestored = restored;
    record('t830_set_password', change.ok && changed && restore.ok && restored ? 'passed' : 'failed', detail);
  },
  async reboot() {
    const before = (await call('t830_get_device_info')).data;
    const w = await call('t830_set_reboot', { reboot: '1' });
    await delay(20000);
    const seconds = await waitOnline(300000, 'reboot');
    await delay(15000);
    await client.close();
    await connect();
    const info = await call('t830_get_device_info');
    const uptime = (d) => Number(d?.data?.uptime ?? d?.data?.run_time ?? d?.uptime);
    record('t830_set_reboot', w.ok && info.ok ? 'passed' : 'failed', { ...writeOutcome(w), onlineAfterSeconds: seconds, uptimeBefore: uptime(before), uptimeAfter: uptime(info.data) });
  },
};

try {
  await connect();
  await run[phase]();
} catch (error) {
  report.error = error.message;
  console.log('ERROR', error.message);
  process.exitCode = 1;
} finally {
  if (report.results.some((r) => r.outcome !== 'passed')) process.exitCode = 1;
  await writeReport(`live/cgi-writes-2026-10-21/${phase}.json`, JSON.stringify(report, null, 2));
  await client?.close();
  await rawReader?.close();
}
