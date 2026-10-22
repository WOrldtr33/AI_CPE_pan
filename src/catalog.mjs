import { z } from 'zod';
const wpsBand = z.enum(['2.4G', '5G', 'Unity']);
// 接口目录集中描述设备端点、输入约束和分类；Server 根据目录注册工具。
const rpc = (
  key,
  api,
  group,
  service,
  method,
  description,
  condition = '无需 SIM，读取设备状态或已保存配置',
) => ({
  key,
  api,
  group,
  kind: 'read',
  transport: 'ubus',
  service,
  method,
  description,
  condition,
  schema: z.object({}).strict(),
  sample: {},
});
// 固件网页的 flag 是接口标识，不是 Agent 的 section 名。
const cgiFlag = path => {
  const endpoint = path.split('/').at(-1);
  return ({ get_role: 'get_mesh_role', get_routers: 'get_mesh_routers',
    get_dns: 'get_dns_protection', set_dns: 'set_dns_protection',
    set_role: 'set_mesh_role', set_router_name: 'set_mesh_router_name',
    on_boarding: 'on__mesh_boarding', remove_router: 'remove_mesh_routers_one',
    'upgrade-set.lua': 'upgradeSet' })[endpoint] || endpoint;
};
const cgi = (key, api, group, path, description, auth = true) => ({
  ...rpc(key, api, group, null, null, description),
  transport: 'cgi',
  path,
  flag: cgiFlag(path),
  auth,
});
// 只读工具默认开放；schema.strict() 拒绝文档之外的输入字段。
export const reads = [
  cgi(
    'first_setup',
    1,
    'system',
    '/cgi-bin/luci/login/get_firstsetup',
    '初始化状态',
    false,
  ),
  { ...cgi('setup', 2, 'system', '/cgi-bin/luci/admin/jt_setup/get_setup', '初始化配置'), readFallback: { service: 'web_api', method: 'get_setup' } },
  cgi('country', 8, 'system', '/cgi-bin/get_country_code', '国家编码', false),
  // 无线重启期间 mtk.wifi 读取返回 {result:'500'}，按设备忙处理。
  { ...rpc('wifi', 9, 'wifi', 'mtk.wifi', 'get_ssidPage_info', '双频 WiFi 配置'), busyResult: '500' },
  { ...rpc('guest', 12, 'wifi', 'mtk.wifi', 'get_guestPage_info', '访客 WiFi 配置'), busyResult: '500' },
  rpc('wps', 15, 'wifi', 'mtk.wifi', 'get_WPSPage_info', 'WPS 配置'),
  {
    ...rpc(
      'wps_run',
      16,
      'wifi',
      'mtk.wifi',
      'get_WPSRun_info',
      'WPS 运行状态',
      'name 为频段名 2.4G/5G（双频合一时为 Unity），不是 ra0 等接口名；obj 为 host/guest。WscStatus=Start WSC Process 表示进行中，其余（Idle、Timed-out 等）为已结束；WscResult=1 表示配对成功',
    ),
    schema: z
      .object({ name: wpsBand, obj: z.enum(['host', 'guest']) })
      .strict(),
    sample: { name: '2.4G', obj: 'host' },
    busyResult: '500',
  },
  {
    ...rpc(
      'wifi_ad',
      19,
      'wifi',
      'mtk.wifi',
      'get_AdvancPage_info',
      '高级 WiFi 配置',
      '无需 SIM；仅开发者（superadmin）会话可读',
    ),
    busyResult: '500',
  },
  rpc('wifi_night', 21, 'wifi', 'mtk.wifi', 'get_NigWifi_info', '夜间 WiFi 设置'),
  rpc('workmode', 23, 'network', 'web_api', 'get_workmode', '工作模式'),
  rpc(
    'wifi_rt',
    25,
    'network',
    'web_api',
    'get_wifi_router',
    '上游 WLAN 路由状态',
    '与 WLAN router 模式和上游连接有关，不是通用路由表',
  ),
  cgi(
    'mesh_status',
    30,
    'mesh',
    '/cgi-bin/luci/admin/jt_easymesh/get_easymesh_switch',
    'Mesh 开关',
  ),
  cgi('mesh_role', 31, 'mesh', '/cgi-bin/luci/admin/jt_easymesh/get_role', 'Mesh 角色'),
  {
    ...cgi(
      'mesh_routers',
      34,
      'mesh',
      '/cgi-bin/luci/admin/jt_easymesh/get_routers',
      'Mesh 节点',
    ),
    condition: '无需 SIM，需要实际组网才有节点',
  },
  rpc('clients', 38, 'device', 'jytl_api', 'ue_get', '接入设备'),
  rpc('status', 41, 'device', 'jytl_api', 'get_status_info', '设备状态页。reading.uplink 为 connected 表示上联已连接；SimStatus 3 需要 PIN，4 需要 PUK。是否在槽看 sim_presence'),
  rpc('device_info', 42, 'device', 'jytl_api', 'devinfo_get', '设备基本信息'),
  rpc(
    'device',
    43,
    'cellular',
    'mtk.cell',
    'get_device_info',
    '蜂窝设备信息',
    '无 SIM 可返回未注册告警',
  ),
  cgi('version', 44, 'device', '/cgi-bin/upgrade-set.lua', '固件版本', false),
  cgi(
    'sim_presence',
    49,
    'cellular',
    '/cgi-bin/get_simcard_inslot_stat',
    'SIM 在槽状态。reading.state：present=21 在槽可用，absent=0 未插入，unavailable=3 或 4 暂时不可用，abnormal=其他。不代表上联已连接',
    false,
  ),
  rpc('sim_slot', 50, 'cellular', 'mtk.cell', 'get_simcard_index', 'SIM 插槽配置'),
  rpc(
    'sim',
    52,
    'cellular',
    'mtk.cell',
    'get_sim_info',
    'SIM 信息',
    '无 SIM 可产生业务告警',
  ),
  rpc('network_mode', 58, 'cellular', 'mtk.cell', 'get_netWay_info', '蜂窝网络模式'),
  rpc('apn', 60, 'cellular', 'jytl_api', 'apn_R_get', 'APN 配置，不验证拨号'),
  rpc(
    'cells',
    63,
    'cellular',
    'mtk.cell',
    'get_cellList_info',
    '小区列表',
    '无 SIM 的小区信息不代表已联网',
  ),
  rpc('band_lock', 63, 'cellular', 'mtk.cell', 'get_cellLock_info', '频段锁定配置'),
  rpc('roaming', 67, 'cellular', 'mtk.cell', 'get_roaming_info', '漫游配置'),
  ...[
    ['mac_filter', 69, 'get_macfilter', 'MAC 过滤'],
    ['ip_filter', 72, 'get_ipfilter', 'IP 过滤'],
    ['port_forward', 75, 'get_portforward', '端口转发'],
    ['port_map', 78, 'get_portmap', '端口映射'],
    ['url_filter', 81, 'get_urlfilter', 'URL 过滤'],
    ['upnp', 83, 'get_upnp', 'UPnP'],
    ['dmz', 85, 'get_dmz', 'DMZ'],
    ['alg', 87, 'get_alg', 'ALG'],
  ].map(([k, a, m, d]) => rpc(k, a, 'firewall', 'web_api', m, d + '配置')),
  cgi('dns', 89, 'network', '/cgi-bin/luci/admin/jt_dns/get_dns', 'DNS 保护配置'),
  cgi('dhcp', 91, 'network', '/cgi-bin/luci/admin/jt_lan/get_dhcp', 'LAN/DHCP 配置'),
  rpc('static_ip', 94, 'network', 'web_api', 'get_static_ip', '静态 IP 配置'),
  rpc('ntp', 95, 'system', 'web_api', 'get_ntp', 'NTP 配置，不验证同步'),
  rpc('time', 97, 'system', 'luci', 'getLocaltime', '设备时间'),
  rpc('reboot_schedule', 98, 'system', 'gen.attr', 'get_rebootSch_info', '定时重启配置'),
  rpc(
    'signal_records',
    101,
    'diagnostics',
    'position_sigal',
    'read_file',
    '已保存信号记录',
  ),
  rpc('tr069', 105, 'system', 'web_api', 'get_tr069', 'TR069 配置，不验证远端连接'),
  { ...cgi('gps', 107, 'system', '/cgi-bin/luci/admin/jt_gps/get_gps', 'GPS 开关与定位状态'), readFallback: { service: 'web_api', method: 'get_gps' } },
  cgi(
    'developer_mode',
    109,
    'system',
    '/cgi-bin/luci/admin/jt_system/get_develop_mode',
    '开发者模式状态，不提权',
  ),
  rpc('traffic', 112, 'cellular', 'cell.traffic', 'get_traffic_cfg', '流量统计配置'),
  cgi(
    'diagnose',
    114,
    'diagnostics',
    '/cgi-bin/luci/admin/jt_diagnose/get_diagnose_info',
    '诊断信息',
  ),
  rpc('share', 128, 'system', 'cpe-ctrl', 'get_101share_status', '101 Share 状态'),
  cgi('login_status', 4, 'system', '/cgi-bin/luci/login/get_login_status', '登录状态', false),
  {
    ...rpc('ping_result', 116, 'diagnostics', 'netApp', 'start', 'Ping/Traceroute 结果', '先经用户确认调用 t830_set_net_probe 启动诊断，再轮询本工具；code=1 为等待结果，code=0 为完成；addr 固定为 read_ping'),
    flag: 'netAppStar2',
    schema: z.object({ addr: z.literal('read_ping') }).strict(),
    sample: { addr: 'read_ping' },
  },
  rpc('sms_all', 117, 'sms', 'sms_app', 'all_sms', '全部短信。同编号批量里的电话本用 phonebook，短信中心用 sms_center', '读取设备本地短信，不发送消息'),
  rpc('sms_center', 117, 'sms', 'sms_app', 'get_addr', '短信中心号码', '读取设备本地短信配置，不发送消息'),
  {
    ...rpc('sms_thread', 118, 'sms', 'sms_app', 'addr_sms', '短信会话内容', '读取设备本地短信，不发送消息'),
    schema: z.object({ addr: z.string().regex(/^\+?\d{3,20}$/) }).strict(),
    sample: { addr: '10086' },
  },
  rpc('sms_report', 122, 'sms', 'sms_app', 'status_report', '短信发送状态报告', '读取设备本地短信报告，不发送消息'),
  rpc('sms_unread', 123, 'sms', 'sms_app', 'read_unread', '未读短信数', '读取设备本地短信，不发送消息'),
  {
    ...rpc('phonebook', 124, 'phonebook', 'phone_book', 'read_book', '查询全部电话本或按 name 搜索；type 固定 ALL', '读取设备本地电话本，空字符串 data 表示本次无条目'),
    schema: z.object({ device: z.literal('1'), type: z.literal('ALL'), name: z.string().max(64).optional() }).strict(),
    sample: { device: '1', type: 'ALL' },
  },
  {
    ...rpc('phonebook_select', 125, 'phonebook', 'phone_book', 'select_book', '按类别或名称筛选电话本；全部查询优先使用 t830_get_phonebook', 'type 为空或 0/1/2/3（普通/家人/朋友/同事），不能填写 read_book 的 ALL'),
    schema: z.object({ device: z.literal('1'), type: z.enum(['', '0', '1', '2', '3']).default(''), name: z.string().max(64).default('') }).strict(),
    sample: { device: '1', type: '', name: '' },
  },
  rpc('log_url', 129, 'diagnostics', 'luci', 'getLogFileUrl', '日志下载地址', '只返回地址，不解析日志内容'),
];
const str = z.string().min(1).max(128);
const psk = z.union([z.literal(''), z.string().min(8).max(63)]);
const wifiFields = {
  hidden: z.enum(['0', '1']),
  ssid: z.string().min(1).max(32),
  state: z.enum(['up', 'down']),
  authmode: z.enum(['Disable', 'WPA2PSK', 'WPA3PSK', 'WPA2PSKWPA3PSK']),
};
const wifi = z
  .object({ ...wifiFields, wpapsk: psk.optional() })
  .strict()
  .refine(
    (v) => v.authmode === 'Disable' || !!v.wpapsk,
    'Encrypted WiFi requires wpapsk',
  );
const guestFields = {
  state: z.enum(['up', 'down']),
  ssid: z.string().min(1).max(32),
  authmode: z.enum(['Disable', 'WPA2PSK']),
  on_mode: str,
};
const guest = z
  // 设备缺少 wpapsk 时返回 416；不加密时提交空字符串。
  .object({ ...guestFields, wpapsk: psk })
  .strict()
  .refine(
    (v) => v.authmode === 'Disable' || !!v.wpapsk,
    'Encrypted guest requires wpapsk',
  );
// 模型只提交要修改的频段与字段；写流程按提交前回读的原始值补齐，再用完整契约校验。
const bandPatch = (fields) =>
  z
    .object({ ...fields, wpapsk: psk })
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, 'Band patch must change at least one field');
// 顶层保持 ZodObject，MCP SDK 才能导出参数结构；空请求由写流程拒绝。
const bandsPatch = (bands, fields) =>
  z.object(Object.fromEntries(bands.map((band) => [band, bandPatch(fields).optional()]))).strict();
const submitted = { condition: '显式开启写工具后提交一次；不回读验证，不自动重试' };
const flag01 = z.enum(['0', '1']);
const word = z.string().min(1).max(64);
const text = z.string().min(1).max(256);
const ipv4 = z.string().ip({ version: 'v4' });
const macAddr = z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/);
const portText = z.string().regex(/^\d{1,5}$/);
const empty = z.object({}).strict();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const utf8Base64 = z.string().min(4).max(4000).regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return false;
  try { return strictUtf8.decode(bytes).length > 0; } catch { return false; }
}, 'must be base64 of UTF-8 text');
const write = (key, api, group, target, description, schema, sample, readback, extra = {}) => ({
  key,
  api,
  group,
  kind: 'write',
  transport: target.path ? 'cgi' : 'ubus',
  ...(target.path ? { flag: cgiFlag(target.path) } : {}),
  ...target,
  description,
  schema,
  sample,
  readback,
  auth: true,
  condition:
    '无需 SIM 可验证保存配置；显式开启写工具后使用，失败先回读，仅按条件有限重试',
  ...extra,
});
// 写工具只有显式开启后注册。sample 供模拟测试使用，不用于自动修改真实设备。
export const writes = [
  write(
    'wifi_switch',
    10,
    'wifi',
    { service: 'mtk.wifi', method: 'set_wifi_switch' },
    'WiFi 开关',
    z.object({ name: z.enum(['5G', '2.4G']), action: z.enum(['up', 'down']) }).strict(),
    { name: '5G', action: 'up' },
    'wifi',
  ),
  write(
    'wifi_config',
    11,
    'wifi',
    { service: 'mtk.wifi', method: 'set_wifi_cfgs' },
    '双频 WiFi 配置（仅所列加密模式）。只填要修改的频段和字段（如只改 5G 名称时仅提交 {"5G":{"ssid":"新名称"}}）；未填写的字段和现有密码由服务端按当前配置补齐，不需要也不应向用户索要原密码，只有改为加密或修改密码时才提交 wpapsk。按频段返回 200 已修改、409 未变化；生效会重启无线，回读在设备忙期间自动等待',
    bandsPatch(['2.4G', '5G'], wifiFields),
    {
      '2.4G': { hidden: '0', ssid: 'test24', state: 'up', authmode: 'Disable' },
      '5G': { hidden: '0', ssid: 'test5', state: 'up', authmode: 'Disable' },
    },
    'wifi',
    { noChangeCodes: [409], submitSchema: z.object({ '2.4G': wifi, '5G': wifi }).strict() },
  ),
  write(
    'guest_switch',
    13,
    'wifi',
    { service: 'mtk.wifi', method: 'set_guest_wifi' },
    '访客 WiFi 开关',
    z
      .object({ name: z.enum(['Guest5G', 'Guest']), action: z.enum(['up', 'down']) })
      .strict(),
    { name: 'Guest', action: 'up' },
    'guest',
  ),
  write(
    'guest_config',
    14,
    'wifi',
    { service: 'mtk.wifi', method: 'set_guest_cfgs' },
    '访客 WiFi 配置。只填要修改的频段和字段；未填写的字段和现有密码由服务端按当前配置补齐，不需要向用户索要原密码，只有改为加密或修改密码时才提交 wpapsk。按频段返回 200 已修改、409 未变化',
    bandsPatch(['Guest', 'Guest5G'], guestFields),
    {
      Guest: { state: 'up', ssid: 'guest24', authmode: 'Disable', on_mode: 'Only', wpapsk: '' },
      Guest5G: { state: 'up', ssid: 'guest5', authmode: 'Disable', on_mode: 'Only', wpapsk: '' },
    },
    'guest',
    { noChangeCodes: [409], submitSchema: z.object({ Guest: guest, Guest5G: guest }).strict() },
  ),
  write(
    'wifi_night',
    22,
    'wifi',
    { service: 'mtk.wifi', method: 'set_NigWifi_cfg' },
    '夜间 WiFi 计划',
    z
      .object({
        action: z.enum(['Enable', 'Disable']),
        openTime: z
          .string()
          .regex(/^([01]\d|2[0-3]);[0-5]\d$/)
          .optional(),
        closeTime: z
          .string()
          .regex(/^([01]\d|2[0-3]);[0-5]\d$/)
          .optional(),
      })
      .strict()
      .refine(
        (v) => v.action === 'Disable' || !!(v.openTime && v.closeTime),
        'Enabled schedule requires times',
      ),
    { action: 'Disable' },
    'wifi_night',
    { noChangeCodes: [409] },
  ),
  write(
    'apn_save',
    61,
    'cellular',
    { service: 'jytl_api', method: 'apn_R_save' },
    '保存 APN，不验证拨号',
    z
      .object({
        config_file: z.enum(['APN1', 'APN2', 'APN3', 'APN4']),
        apn_name: str,
        ip_version: z.enum(['IPv4', 'IPv6', 'IPv4v6']),
        auth_pref: z.literal('none'),
        user_name: z.string().max(128).optional(),
        user_password: z.string().max(128).optional(),
      })
      .strict(),
    { config_file: 'APN2', apn_name: 'test', ip_version: 'IPv4v6', auth_pref: 'none' },
    'apn',
  ),
  write(
    'roaming',
    68,
    'cellular',
    { service: 'mtk.cell', method: 'set_roaming_cfg' },
    '漫游开关',
    z.object({ action: z.enum(['Enable', 'Disable']) }).strict(),
    { action: 'Disable' },
    'roaming',
  ),
  write(
    'upnp',
    84,
    'firewall',
    { path: '/cgi-bin/luci/admin/jt_nat/set_upnp' },
    'UPnP 开关',
    z.object({ upnp_switch: z.enum(['0', '1']) }).strict(),
    { upnp_switch: '0' },
    'upnp',
  ),
  write(
    'dns',
    90,
    'network',
    { path: '/cgi-bin/luci/admin/jt_dns/set_dns' },
    'DNS 重绑定保护',
    z.object({ rebind_protection: z.enum(['0', '1']) }).strict(),
    { rebind_protection: '1' },
    'dns',
  ),
  write(
    'gps',
    108,
    'system',
    { path: '/cgi-bin/luci/admin/jt_gps/set_gps' },
    'GPS 开关',
    z.object({ gps_switch: z.enum(['0', '1']) }).strict(),
    { gps_switch: '0' },
    'gps',
  ),
  write(
    'traffic',
    113,
    'cellular',
    { service: 'cell.traffic', method: 'set_traffic_cfg' },
    '流量限额',
    z
      .object({
        day_limit: z.string().regex(/^\d+(MB|GB)$/),
        month_limit: z.string().regex(/^\d+(MB|GB)$/),
        start_day: z.string().regex(/^(?:[1-9]|[12]\d|3[01])$/),
      })
      .strict(),
    { day_limit: '0MB', month_limit: '0MB', start_day: '1' },
    'traffic',
  ),
  write('setup_save', 3, 'system', { path: '/cgi-bin/luci/admin/jt_setup/set_setup' }, '提交初始化设置', z.object({ Unity_switch: z.enum(['OFF', 'ON']), first_login: z.literal(0), lang: word, wifi_power: word, wifi2g_ssid: word, wifi5g_ssid: word, wifi2g_password: z.string().min(8).max(63), wifi5g_password: z.string().min(8).max(63), wifi_ssid: word, samePwdCheck: z.literal('1'), user_password: z.string().min(8).max(63) }).strict(), { Unity_switch: 'OFF', first_login: 0, lang: 'en', wifi_power: '2', wifi2g_ssid: 'setup24', wifi5g_ssid: 'setup5', wifi2g_password: 'setup-pass', wifi5g_password: 'setup-pass', wifi_ssid: 'setup', samePwdCheck: '1', user_password: 'setup-pass' }, 'setup', submitted),
  write('login', 5, 'system', { path: '/cgi-bin/luci/login/action_login' }, '使用已计算的 SHA256(salt:密码) 登录', z.object({ username: word, password: z.string().regex(/^[a-f0-9]{64}$/), salt: z.string().min(1).max(128) }).strict(), { username: 'admin', password: 'a'.repeat(64), salt: 'salt' }, 'none', { ...submitted, auth: false }),
  write('logout', 6, 'system', { path: '/cgi-bin/luci/login/action_logout' }, '退出当前登录会话', empty, {}, 'none', submitted),
  write('password', 7, 'system', { path: '/cgi-bin/luci/admin/jt_system/set_login' }, '修改登录密码', z.object({ username: word, old_password: z.string().min(1).max(128), new_password: z.string().min(1).max(128) }).strict(), { username: 'admin', old_password: 'old-pass', new_password: 'new-pass' }, 'none', submitted),
  write('wps_pbc', 17, 'wifi', { service: 'mtk.wifi', method: 'set_WPS_pbc' }, '启动 PBC WPS。name 为频段名 2.4G/5G（双频合一时为 Unity）；设备返回 host/guest[name].code：200 已启动、409 重复、416 参数错误、403 已有 WPS 任务；之后用 t830_get_wps_run 跟踪，无取消接口，未配对时约 2 分钟超时', z.object({ name: wpsBand, obj: z.enum(['host', 'guest']) }).strict(), { name: '2.4G', obj: 'host' }, 'wps', submitted),
  write('wps_pin', 18, 'wifi', { service: 'mtk.wifi', method: 'set_WPS_pin' }, '启动 PIN WPS（pincode 为客户端的 4 或 8 位 PIN）。name 与返回码同 t830_set_wps_pbc', z.object({ name: wpsBand, obj: z.enum(['host', 'guest']), pincode: z.string().regex(/^\d{4}(\d{4})?$/) }).strict(), { name: '2.4G', obj: 'host', pincode: '12345670' }, 'wps', submitted),
  write('wifi_advanced', 20, 'wifi', { service: 'mtk.wifi', method: 'set_Advanc_cfgs' }, '提交高级 WiFi 配置。设备按字段返回结果：200 已修改、409 未变化；生效会重启无线，期间再次提交返回 result=500（设备忙），应先回读确认后再提交', z.object({ country_code: word, trans_power: word, isolate: word, wmm_state: word, '5G': z.object({ wireless_mode: word, band_width: word, channel: word }).strict(), '2.4G': z.object({ wireless_mode: word, band_width: word, channel: word }).strict() }).strict(), { country_code: 'ZA', trans_power: '2', isolate: '0', wmm_state: '1', '5G': { wireless_mode: 'auto', band_width: '80', channel: 'auto' }, '2.4G': { wireless_mode: 'auto', band_width: '20', channel: 'auto' } }, 'wifi_ad', { ...submitted, noChangeCodes: [409], resultFields: ['wmm_state', 'isolate', 'base_code', 'result'] }),
  write('workmode', 24, 'network', { path: '/cgi-bin/luci/admin/jt_workmode/set_workmode' }, '修改工作模式', z.object({ workmode: z.number().int().min(0).max(99), bonding: word, add_ccmni_to_bridge: word.optional(), ip_passthrough: word.optional() }).strict(), { workmode: 0, bonding: '0' }, 'workmode', submitted),
  write('wifi_scan_start', 26, 'network', { path: '/cgi-bin/luci/admin/jt_workmode/wifi_scan_async' }, '第一次扫描上游 WiFi', z.object({ async: z.literal('1'), state: z.literal('1') }).strict(), { async: '1', state: '1' }, 'wifi_rt', { ...submitted, flag: 'first' }),
  write('wifi_scan_list', 27, 'network', { path: '/cgi-bin/luci/admin/jt_workmode/wifi_scan_async' }, '第二次读取上游 WiFi 扫描列表', z.object({ state: z.literal('2') }).strict(), { state: '2' }, 'wifi_rt', { ...submitted, flag: 'second' }),
  write('wifi_router_connect', 28, 'network', { path: '/cgi-bin/luci/admin/jt_workmode/set_wifi_router' }, '连接上游 WiFi', z.object({ ap_ssid: word, ap_password: z.string().max(63).optional(), channel: word, wifi_index: word, encrypt: word, auth: word }).strict(), { ap_ssid: 'uplink', channel: '1', wifi_index: '0', encrypt: 'none', auth: 'open' }, 'wifi_rt', submitted),
  write('wifi_router_disconnect', 29, 'network', { path: '/cgi-bin/luci/admin/jt_workmode/wifi_connect' }, '断开上游 WiFi', z.object({ connect: z.literal('0') }).strict(), { connect: '0' }, 'wifi_rt', submitted),
  write('mesh_role', 32, 'mesh', { path: '/cgi-bin/luci/admin/jt_easymesh/set_role' }, '修改 Mesh 角色', z.object({ role: z.enum(['0', '1', '2']) }).strict(), { role: '1' }, 'mesh_role', submitted),
  write('mesh_close', 33, 'mesh', { path: '/cgi-bin/luci/admin/jt_easymesh/close_easymesh' }, '关闭 Mesh', empty, {}, 'mesh_status', submitted),
  write('mesh_router_name', 35, 'mesh', { path: '/cgi-bin/luci/admin/jt_easymesh/set_router_name' }, '修改 Mesh 路由名称', z.object({ al_mac: macAddr, name: word }).strict(), { al_mac: '02:00:00:00:00:01', name: 'node' }, 'mesh_routers', submitted),
  write('mesh_onboard', 36, 'mesh', { path: '/cgi-bin/luci/admin/jt_easymesh/on_boarding' }, '发起组网', z.object({ on_boaid: z.literal('1') }).strict(), { on_boaid: '1' }, 'mesh_routers', submitted),
  write('mesh_router_remove', 37, 'mesh', { path: '/cgi-bin/luci/admin/jt_easymesh/remove_router' }, '删除 Mesh 路由', z.object({ al_mac: macAddr }).strict(), { al_mac: '02:00:00:00:00:01' }, 'mesh_routers', submitted),
  write('client_name', 39, 'device', { service: 'jytl_api', method: 'ue_modify' }, '修改接入设备名称或联网权限。forbid=on 禁止该设备上网，off 允许；只改名时 forbid 填 t830_get_clients 中的当前值', z.object({ mac: macAddr, name: word, forbid: z.enum(['on', 'off']) }).strict(), { mac: '02:00:00:00:00:02', name: 'phone', forbid: 'off' }, 'clients', submitted),
  write('client_delete', 40, 'device', { service: 'jytl_api', method: 'ue_delete' }, '删除接入设备', z.object({ mac: macAddr }).strict(), { mac: '02:00:00:00:00:02' }, 'clients', submitted),
  write('firmware_upload', 45, 'system', { path: '/cgi-bin/cgi-upload' }, '上传固件。sessionid 由当前会话注入，不作为参数', z.object({ filename: z.literal('/tmp/firmware.bin'), file: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(4).max(80000000) }).strict(), { filename: '/tmp/firmware.bin', file: 'AA==' }, 'none', { ...submitted, encoding: 'multipart' }),
  write('firmware_upgrade', 46, 'system', { path: '/cgi-bin/luci/admin/jt_system/set_local_system_do_upgrade' }, '执行固件升级', empty, {}, 'none', { ...submitted, search: { do_upgrade: '1' } }),
  write('reboot', 47, 'system', { path: '/cgi-bin/luci/admin/jt_system/set_reboot' }, '重启设备', z.object({ reboot: z.literal('1') }).strict(), { reboot: '1' }, 'none', submitted),
  write('factory_reset', 48, 'system', { path: '/cgi-bin/luci/admin/jt_system/set_restore' }, '恢复出厂设置', empty, {}, 'none', submitted),
  write('sim_slot', 51, 'cellular', { service: 'mtk.cell', method: 'set_simcard_index' }, '修改 SIM 选择', z.object({ sim_type: z.enum(['1', '2']) }).strict(), { sim_type: '1' }, 'sim_slot', submitted),
  write('pin_verify', 53, 'cellular', { service: 'mtk.cell', method: 'set_verify_pin' }, '提交 PIN 验证', z.object({ pin_str: z.string().regex(/^\d{4,8}$/) }).strict(), { pin_str: '0000' }, 'none', submitted),
  write('puk_unblock', 54, 'cellular', { service: 'mtk.cell', method: 'set_unblock_pin' }, '提交 PUK 解锁', z.object({ puk_str: z.string().regex(/^\d{8}$/), pin_str: z.string().regex(/^\d{4,8}$/) }).strict(), { puk_str: '00000000', pin_str: '0000' }, 'none', submitted),
  write('pin_enable', 55, 'cellular', { service: 'mtk.cell', method: 'set_enable_pin' }, '开启 PIN 锁', z.object({ pin_str: z.string().regex(/^\d{4,8}$/) }).strict(), { pin_str: '0000' }, 'none', submitted),
  write('pin_disable', 56, 'cellular', { service: 'mtk.cell', method: 'set_disable_pin' }, '关闭 PIN 锁', z.object({ pin_str: z.string().regex(/^\d{4,8}$/) }).strict(), { pin_str: '0000' }, 'none', submitted),
  write('pin_change', 57, 'cellular', { service: 'mtk.cell', method: 'set_change_pin' }, '修改 PIN', z.object({ old_pin: z.string().regex(/^\d{4,8}$/), new_pin: z.string().regex(/^\d{4,8}$/) }).strict(), { old_pin: '0000', new_pin: '1111' }, 'none', submitted),
  write('network_mode', 59, 'cellular', { service: 'mtk.cell', method: 'set_netWay_cfg' }, '设置网络类型：21 自动（5G/4G）、19 5G NSA、15 5G SA、3 仅 4G；切换期间上联会短暂中断', z.object({ ratMode: z.enum(['21', '19', '15', '3']) }).strict(), { ratMode: '21' }, 'network_mode', submitted),
  write('apn_remove', 62, 'cellular', { service: 'jytl_api', method: 'apn_R_remove' }, '移除 APN', z.object({ config_file: z.enum(['APN1', 'APN2', 'APN3', 'APN4']) }).strict(), { config_file: 'APN2' }, 'apn', submitted),
  write('band_lock', 64, 'cellular', { service: 'mtk.cell', method: 'set_cellFreq_lock' }, '锁频/锁小区。state：FULL 不锁、multi_band 按 multi_band 列表锁频段、PCI 锁小区（加 pref=1 为 PCI 优先）；type 为 NR/LTE/WCDMA，band/arfcn/pci 取 t830_get_band_lock 的 supp_list 范围。网页总是提交 arfcn/band/pci/type 与三个列表，未用的列表为空', z.object({ type: z.enum(['NR', 'LTE', 'WCDMA']), state: z.enum(['FULL', 'multi_band', 'PCI']), band: word, arfcn: z.string().regex(/^\d+$/).optional(), pci: z.string().regex(/^\d+$/).optional(), pref: z.literal('1').optional(), multi_band: z.object({ list_3G: z.array(word).max(64).optional(), list_4G: z.array(word).max(64).optional(), list_5G: z.array(word).max(64).optional() }).strict().optional() }).strict().refine(v => v.state !== 'PCI' || !!(v.arfcn && v.pci), 'PCI lock requires arfcn and pci').refine(v => !v.pref || v.state === 'PCI', 'pref only applies to PCI lock'), { type: 'NR', state: 'FULL', band: 'n41', arfcn: '504990', pci: '850', multi_band: { list_3G: [], list_4G: [], list_5G: [] } }, 'band_lock', submitted),
  write('plmn_lock', 65, 'cellular', { service: 'mtk.cell', method: 'set_plmn_lock' }, 'PLMN 锁定（MCC+MNC，如 46001）。设备重启或重新插卡后才生效，且没有读取锁定状态的接口；锁到与当前 SIM 不符的 PLMN 会在重启后断网。厂商网页固定提交 Rain 的 65538/65573/65574', z.object({ plmn_array: z.array(z.string().regex(/^\d{5,6}$/)).min(1).max(32) }).strict(), { plmn_array: ['65538', '65573', '65574'] }, 'none', submitted),
  write('plmn_unlock', 66, 'cellular', { service: 'mtk.cell', method: 'set_plmn_unlock' }, 'PLMN 解锁。设备重启或重新插卡后才生效', empty, {}, 'none', submitted),
  write('mac_filter_mode', 70, 'firewall', { path: '/cgi-bin/luci/admin/jt_firewall/set_macfilter_mode' }, '修改 MAC 过滤模式', z.object({ mode: word }).strict(), { mode: '0' }, 'mac_filter', submitted),
  write('mac_filter_rule', 71, 'firewall', { path: '/cgi-bin/luci/admin/jt_firewall/set_macfilter' }, '创建、修改或删除 MAC 过滤规则', z.object({ macaddr: macAddr, macaddr_new: macAddr.optional(), name: word.optional(), operate: z.enum(['add', 'mod', 'del']).optional() }).strict().refine((v) => v.operate !== 'mod' || !!v.macaddr_new, 'mod requires macaddr_new'), { macaddr: '02:00:00:00:00:03', name: 'cam', operate: 'add' }, 'mac_filter', submitted),
  write('ip_filter_mode', 73, 'firewall', { path: '/cgi-bin/luci/admin/jt_firewall/set_ipfilter_mode' }, '修改 IP 过滤模式', z.object({ mode: word }).strict(), { mode: '0' }, 'ip_filter', submitted),
  write('ip_filter_rule', 74, 'firewall', { path: '/cgi-bin/luci/admin/jt_firewall/set_ipfilter' }, '创建、修改或删除 IP 过滤规则', z.object({ index: word.optional(), ip_family: word, lan_ip: ipv4, name: word, protocol: word, proto: word.optional(), lan_port: portText.optional(), wan_ip: ipv4.optional(), wan_port: portText.optional(), operate: z.enum(['add', 'del']).optional() }).strict(), { ip_family: 'ipv4', lan_ip: '192.168.0.20', name: 'rule', protocol: 'tcp' }, 'ip_filter', submitted),
  write('port_forward_switch', 76, 'firewall', { path: '/cgi-bin/luci/admin/jt_nat/set_portforward_switch' }, '修改端口转发开关', z.object({ switch: z.union([z.literal(0), z.literal(1)]) }).strict(), { switch: 0 }, 'port_forward', submitted),
  write('port_forward_rule', 77, 'firewall', { path: '/cgi-bin/luci/admin/jt_nat/set_portforward' }, '添加或删除端口转发规则', z.object({ name: word, lan_ip: ipv4, protocol: z.enum(['tcp', 'udp']), start_port: portText.optional(), end_port: portText.optional(), index: word.optional(), operate: z.enum(['add', 'del']) }).strict().refine((v) => !!(v.start_port && v.end_port) && (v.operate === 'add' || !!v.index), 'add requires ports; del requires index and the rule ports'), { name: 'web', lan_ip: '192.168.0.20', protocol: 'tcp', start_port: '80', end_port: '80', operate: 'add' }, 'port_forward', submitted),
  write('port_map_switch', 79, 'firewall', { path: '/cgi-bin/luci/admin/jt_nat/set_portmap_switch' }, '修改端口映射开关', z.object({ switch: z.union([z.literal(0), z.literal(1)]) }).strict(), { switch: 0 }, 'port_map', submitted),
  write('port_map_rule', 80, 'firewall', { path: '/cgi-bin/luci/admin/jt_nat/set_portmap' }, '添加或删除端口映射规则', z.object({ name: word, wan_port: portText, lan_ip: ipv4, lan_port: portText, protocol: z.enum(['tcp', 'udp']), start_port: portText.optional(), end_port: portText.optional(), index: word.optional(), operate: z.enum(['add', 'del']) }).strict().refine((v) => v.operate === 'del' ? !!v.index : !!(v.start_port && v.end_port), 'add requires ports and del requires index'), { name: 'map', wan_port: '8080', lan_ip: '192.168.0.20', lan_port: '80', protocol: 'tcp', start_port: '8080', end_port: '8080', operate: 'add' }, 'port_map', submitted),
  write('url_filter_rule', 82, 'firewall', { service: 'web_api', method: 'set_urlfilter' }, '添加或删除 URL 过滤规则', z.object({ url: text, name: word.optional(), operate: z.enum(['add', 'del']) }).strict().refine((v) => v.operate !== 'del' || !!v.name, 'delete requires name'), { url: 'example.com', operate: 'add' }, 'url_filter', submitted),
  write('dmz', 86, 'firewall', { path: '/cgi-bin/luci/admin/jt_nat/set_dmz' }, '设置 DMZ', z.object({ dmz_switch: flag01, lan_ip: ipv4.optional(), name: word.optional() }).strict().refine((v) => v.dmz_switch === '0' || !!v.lan_ip, 'enabled DMZ requires lan_ip'), { dmz_switch: '0' }, 'dmz', submitted),
  write('alg', 88, 'firewall', { path: '/cgi-bin/luci/admin/jt_alg/set_alg' }, '设置 ALG', z.object({ alg_switch: flag01, enable_tftp: flag01, enable_ftp: flag01, enable_pptp: flag01, enable_sip: flag01, enable_h323: flag01.optional() }).strict(), { alg_switch: '0', enable_tftp: '0', enable_ftp: '0', enable_pptp: '0', enable_sip: '0' }, 'alg', submitted),
  write('dhcp', 92, 'network', { path: '/cgi-bin/luci/admin/jt_lan/set_dhcp' }, '配置 DHCP', z.object({ dhcp_switch: flag01, gateway: ipv4.optional(), netmask: ipv4.optional(), leasetime: z.string().regex(/^\d+[hm]$/).optional(), start: z.string().regex(/^\d{1,3}$/).optional(), end: z.string().regex(/^\d{1,3}$/).optional() }).strict().refine((v) => v.dhcp_switch === '0' || !!(v.gateway && v.netmask && v.start && v.end), 'enabled DHCP requires range'), { dhcp_switch: '0' }, 'dhcp', submitted),
  write('static_ip', 93, 'network', { path: '/cgi-bin/luci/admin/jt_lan/set_static_ip' }, '新增或删除静态 IP', z.object({ ip: ipv4, mac: macAddr, name: word.optional(), operate: z.enum(['add', 'del']) }).strict(), { ip: '192.168.0.30', mac: '02:00:00:00:00:04', operate: 'add' }, 'static_ip', submitted),
  write('ntp', 96, 'system', { path: '/cgi-bin/luci/admin/jt_ntp/set_ntp' }, '提交 NTP 配置', z.object({ ntp_switch: flag01, ntp_server1: text.optional(), ntp_server2: text.optional(), current_time: text.optional(), timezone: word.optional(), zonename: word.optional() }).strict().refine((v) => v.ntp_switch === '1' ? !!(v.ntp_server1 && v.zonename) : !!(v.current_time && v.timezone), 'NTP mode requires its fields'), { ntp_switch: '1', ntp_server1: 'pool.ntp.org', zonename: 'UTC' }, 'ntp', submitted),
  write('reboot_schedule', 99, 'system', { service: 'gen.attr', method: 'set_rebootSch_cfg' }, '提交完整定时重启配置；schTime 使用 HH;mm，禁用时 schweek 可为空', z.object({ action: z.enum(['Enable', 'Disable']), schweek: z.string().regex(/^(?:[1-7](\|[1-7])*)?$/), schTime: z.string().regex(/^([01]\d|2[0-3]);[0-5]\d$/) }).strict().refine((v) => v.action === 'Disable' || !!v.schweek, 'Enabled schedule requires week'), { action: 'Disable', schweek: '', schTime: '00;00' }, 'reboot_schedule', { ...submitted, noChangeCodes: [409] }),
  write('signal_start', 100, 'diagnostics', { service: 'position_sigal', method: 'start' }, '启动信号测试，设备测量约需 10 秒，默认等待最多 20 秒；显式超时配置优先', empty, {}, 'signal_records', { ...submitted, timeoutMs: 20000 }),
  write('signal_record', 102, 'diagnostics', { service: 'position_sigal', method: 'write_file' }, '保存 signal_start 返回的 index/name/sigal/time/qos，加上用户填写的 position', z.object({ index: word, name: word, position: text, sigal: text, time: z.string().regex(/^\d{1,16}$/), qos: z.enum(['0', '1', '2', '3']) }).strict(), { index: '1', name: 'spot', position: 'lab', sigal: '-80 dBm', time: '1792484815', qos: '3' }, 'signal_records', submitted),
  write('signal_record_edit', 103, 'diagnostics', { service: 'position_sigal', method: 'modify_file' }, '修改信号测试记录', z.object({ index: word, name: word, position: text }).strict(), { index: '0', name: 'spot', position: 'lab' }, 'signal_records', submitted),
  write('signal_record_delete', 104, 'diagnostics', { service: 'position_sigal', method: 'delet_file' }, '删除信号测试记录', z.object({ index: word }).strict(), { index: '0' }, 'signal_records', submitted),
  write('tr069', 106, 'system', { path: '/cgi-bin/luci/admin/jt_tr069/set_tr069' }, '提交 TR069 配置', z.object({ enable: flag01, acs_url: text.optional(), acs_username: word.optional(), acs_password: z.string().max(128).optional(), periodic_enable: flag01.optional(), periodic_interval: z.string().regex(/^\d+$/).optional(), cpe_username: word.optional(), cpe_password: z.string().max(128).optional(), cpe_apn: word.optional() }).strict().refine((v) => v.enable === '0' || !!v.acs_url, 'enabled TR069 requires acs_url'), { enable: '0' }, 'tr069', submitted),
  write('developer_login', 110, 'system', { path: '/cgi-bin/luci/admin/jt_system/set_develop_mode' }, '登录开发者模式。文档未列出请求字段', empty, {}, 'developer_mode', submitted),
  write('developer_verify', 111, 'system', { service: 'gen.attr', method: 'check_asymmetric_verify' }, '提交开发者随机码验证', z.object({ reply: z.literal('superpasswd'), base64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(4).max(4096) }).strict(), { reply: 'superpasswd', base64: 'dGVzdA==' }, 'developer_mode', submitted),
  write('net_probe', 115, 'diagnostics', { service: 'netApp', method: 'start', flag: 'netAppStar1' }, '启动 Ping 或 Traceroute', z.object({ type: z.enum(['PING', 'Traceroute']), addr: z.string().regex(/^[A-Za-z0-9_.:-]{1,253}$/), jump: z.string().regex(/^\d{1,3}$/).optional(), time: z.string().regex(/^\d{1,3}$/).optional() }).strict(), { type: 'PING', addr: '127.0.0.1' }, 'ping_result', submitted),
  write('sms_center', 119, 'sms', { service: 'sms_app', method: 'set_addr' }, '修改短信设置：短信中心号码 addr、送达报告 status（1 开/0 关）及有效期 time；三项须一起提交，未修改的项填 t830_get_sms_center 的原值', z.object({ addr: z.string().regex(/^\+?\d{3,15}$/), status: z.enum(['0', '1']), time: z.string().regex(/^\d{1,4}$/) }).strict(), { addr: '10086', status: '0', time: '30' }, 'sms_center', submitted),
  write('sms_delete', 120, 'sms', { service: 'sms_app', method: 'delet_pdu' }, '删除短信。content 为“号码[序号”（无右括号，序号取 t830_get_sms_thread 中该条的 index）删除单条，或“号码[ALL”删除整个会话；多项用英文逗号分隔。返回 code 0 成功', z.object({ content: z.string().max(512).regex(/^\+?\d{3,20}\[(?:\d+|ALL)(?:,\+?\d{3,20}\[(?:\d+|ALL))*$/) }).strict(), { content: '10086[1' }, 'sms_all', submitted),
  write('sms_send', 121, 'sms', { service: 'sms_app', method: 'send_msg' }, '发送短信。content 与 myContent 都填正文 UTF-8 字节的 base64（两者相同），多个号码用英文逗号分隔；设备返回 code 0 全部发送、1 部分发送（error 列出失败号码）', z.object({ addr: z.string().regex(/^\+?\d{3,20}(,\+?\d{3,20})*$/), content: utf8Base64, format: z.literal('2'), myContent: utf8Base64 }).strict().refine(v => v.content === v.myContent, 'myContent must equal content'), { addr: '10086', content: 'dGVzdA==', format: '2', myContent: 'dGVzdA==' }, 'none', submitted),
  write('phonebook_write', 126, 'phonebook', { service: 'phone_book', method: 'write_book' }, '添加或编辑设备电话本；flag=0 新增，flag=1 编辑需 index；numb 为手机号，不发送短信', z.object({ name: word, type: z.enum(['0', '1', '2', '3']), device: z.literal('1'), index: word.optional(), numb: z.string().regex(/^\+?\d{3,30}$/), numb_house: z.string().regex(/^(?:\+?\d{3,30})?$/), numb_work: z.string().regex(/^(?:\+?\d{3,30})?$/), email: z.union([z.literal(''), z.string().email().max(254)]), flag: z.enum(['0', '1']) }).strict().refine(value => value.flag !== '1' || !!value.index, 'Editing requires index'), { name: 'home', type: '0', device: '1', numb: '0000000000', numb_house: '', numb_work: '', email: '', flag: '0' }, 'phonebook', submitted),
  write('phonebook_delete', 127, 'phonebook', { service: 'phone_book', method: 'delet_book' }, '删除电话本条目', z.object({ device: z.literal('1'), index: z.string().regex(/^[A-Za-z0-9_-]+(\|[A-Za-z0-9_-]+)*$/) }).strict(), { device: '1', index: '1' }, 'phonebook', submitted),
  write('backup_check', 130, 'system', { service: 'file', method: 'exec' }, '检查备份包', z.object({ command: z.literal('/bin/tar'), params: z.tuple([z.literal('-tzf'), z.literal('/tmp/backup.tar.gz')]) }).strict(), { command: '/bin/tar', params: ['-tzf', '/tmp/backup.tar.gz'] }, 'none', submitted),
  write('backup_restore', 131, 'system', { service: 'file', method: 'exec' }, '从备份恢复配置', z.object({ command: z.literal('/sbin/sysupgrade'), params: z.tuple([z.literal('--restore-backup'), z.literal('/tmp/backup.tar.gz')]) }).strict(), { command: '/sbin/sysupgrade', params: ['--restore-backup', '/tmp/backup.tar.gz'] }, 'none', submitted),
  write('backup_delete', 132, 'system', { service: 'file', method: 'remove' }, '删除备份文件', z.object({ path: z.literal('/tmp/backup.tar.gz') }).strict(), { path: '/tmp/backup.tar.gz' }, 'none', submitted),
];
export const readByKey = Object.fromEntries(reads.map((d) => [d.key, d]));
export const writeByKey = Object.fromEntries(writes.map((d) => [d.key, d]));
export const toolName = (d) => `t830_${d.kind === 'write' ? 'set' : 'get'}_${d.key}`;
export const publicDefinition = ({ schema, submitSchema, sample, ...d }) => ({
  ...d,
  tool: toolName(d),
});
