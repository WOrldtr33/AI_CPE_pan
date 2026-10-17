import { z } from 'zod';
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
const cgi = (key, api, group, path, description, auth = true) => ({
  ...rpc(key, api, group, null, null, description),
  transport: 'cgi',
  path,
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
  cgi('setup', 2, 'system', '/cgi-bin/luci/admin/jt_setup/get_setup', '初始化配置'),
  cgi('country', 8, 'system', '/cgi-bin/get_country_code', '国家编码', false),
  rpc('wifi', 9, 'wifi', 'mtk.wifi', 'get_ssidPage_info', '双频 WiFi 配置'),
  rpc('guest', 12, 'wifi', 'mtk.wifi', 'get_guestPage_info', '访客 WiFi 配置'),
  rpc('wps', 15, 'wifi', 'mtk.wifi', 'get_WPSPage_info', 'WPS 配置'),
  {
    ...rpc(
      'wps_run',
      16,
      'wifi',
      'mtk.wifi',
      'get_WPSRun_info',
      'WPS 运行状态',
      '需提供实际接口名和 host/guest',
    ),
    schema: z
      .object({ name: z.string().min(1).max(32), obj: z.enum(['host', 'guest']) })
      .strict(),
    sample: { name: 'ra0', obj: 'host' },
  },
  rpc(
    'wifi_ad',
    19,
    'wifi',
    'mtk.wifi',
    'get_AdvancPage_info',
    '高级 WiFi 配置',
    '无需 SIM；当前固件账号可能未授权',
  ),
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
  cgi('gps', 107, 'system', '/cgi-bin/luci/admin/jt_gps/get_gps', 'GPS 开关'),
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
];
const str = z.string().min(1).max(128);
const wifi = z
  .object({
    hidden: z.enum(['0', '1']),
    ssid: z.string().min(1).max(32),
    state: z.enum(['up', 'down']),
    authmode: z.enum(['Disable', 'WPA2PSK', 'WPA3PSK', 'WPA2PSKWPA3PSK']),
    wpapsk: z.string().min(8).max(63).optional(),
  })
  .strict()
  .refine(
    (v) => v.authmode === 'Disable' || !!v.wpapsk,
    'Encrypted WiFi requires wpapsk',
  );
const guest = z
  .object({
    state: z.enum(['up', 'down']),
    ssid: z.string().min(1).max(32),
    authmode: z.enum(['Disable', 'WPA2PSK']),
    on_mode: str,
    wpapsk: z.string().min(8).max(63).optional(),
  })
  .strict()
  .refine(
    (v) => v.authmode === 'Disable' || !!v.wpapsk,
    'Encrypted guest requires wpapsk',
  );
const write = (key, api, group, target, description, schema, sample, readback) => ({
  key,
  api,
  group,
  kind: 'write',
  transport: target.path ? 'cgi' : 'ubus',
  ...target,
  description,
  schema,
  sample,
  readback,
  auth: true,
  condition:
    '无需 SIM 可验证保存配置；显式开启写工具后使用，失败先回读，仅按条件有限重试',
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
    '双频 WiFi 配置（仅所列加密模式）',
    z.object({ '2.4G': wifi, '5G': wifi }).strict(),
    {
      '2.4G': { hidden: '0', ssid: 'test24', state: 'up', authmode: 'Disable' },
      '5G': { hidden: '0', ssid: 'test5', state: 'up', authmode: 'Disable' },
    },
    'wifi',
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
    '访客 WiFi 配置',
    z.object({ Guest: guest, Guest5G: guest }).strict(),
    {
      Guest: { state: 'up', ssid: 'guest24', authmode: 'Disable', on_mode: 'Only' },
      Guest5G: { state: 'up', ssid: 'guest5', authmode: 'Disable', on_mode: 'Only' },
    },
    'guest',
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
];
export const readByKey = Object.fromEntries(reads.map((d) => [d.key, d]));
export const writeByKey = Object.fromEntries(writes.map((d) => [d.key, d]));
export const toolName = (d) => `t830_${d.kind === 'write' ? 'set' : 'get'}_${d.key}`;
export const publicDefinition = ({ schema, sample, ...d }) => ({
  ...d,
  tool: toolName(d),
});
