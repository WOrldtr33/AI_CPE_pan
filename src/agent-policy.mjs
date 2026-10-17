// 依据 docs/testing/LIVE_TEST_RESULTS.md 的 2026-10-08 实机 returned 项。
// 不把业务告警、模拟通过或权限预检当成实机正常返回。
export const verifiedReadSections = [
  'first_setup', 'country', 'wifi', 'guest', 'wps', 'wps_run', 'workmode',
  'mesh_status', 'mesh_role', 'mesh_routers', 'clients', 'status', 'device_info',
  'version', 'device', 'sim_presence', 'sim', 'network_mode', 'apn', 'cells', 'band_lock', 'traffic',
  'mac_filter', 'ip_filter', 'port_forward', 'port_map', 'url_filter',
  'upnp', 'dmz', 'alg', 'dns', 'dhcp', 'time', 'developer_mode',
];
export const verifiedWriteTool = 't830_set_upnp_verified';
