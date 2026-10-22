// 规则来自已保存的实机返回样本，仅校验关键字段，并非完整厂商响应规范。
const rules = {
  first_setup: [['first_setup', 'scalar']],
  country: [['data.country_code', 'string']],
  wifi: ['5G', '2.4G'].flatMap((b) =>
    ['ssid', 'state', 'Channel', 'BandWidth'].map((k) => [[b, k], 'string']),
  ),
  guest: ['Guest', 'Guest5G'].flatMap((b) =>
    ['ssid', 'state', 'on_mode'].map((k) => [[b, k], 'string']),
  ),
  wps: [
    ['host', 'object'],
    ['guest', 'object'],
  ],
  wps_run: [],
  workmode: [['data.workmode', 'scalar']],
  mesh_status: [['data.easymesh_switch', 'scalar']],
  mesh_role: [['data.role', 'scalar']],
  mesh_routers: [
    ['data.count', 'scalar'],
    ['data.dev_list', 'collection'],
  ],
  clients: [
    ['data.brlan_list', 'array'],
    ['data.offline_list', 'array'],
  ],
  status: [
    ['data.SimStatus', 'scalar'],
    ['data.wanstat', 'string'],
  ],
  device_info: [
    ['data.ModelName', 'string'],
    ['data.SoftwareVersion', 'string'],
    ['data.LanIP', 'string'],
  ],
  device: [
    ['code', 'scalar'],
    ['PS_eAct', 'scalar'],
  ],
  version: [['data.version', 'string']],
  sim_presence: [['data.simcard_inslot', 'scalar']],
  sim: [
    ['sim', 'object'],
    ['sim.status', 'string'],
  ],
  network_mode: [
    ['ratMode', 'scalar'],
    ['modeList', 'object'],
  ],
  apn: [['manual.apn_list', 'array']],
  cells: [
    ['serving', 'array'],
    ['neighbour', 'array'],
  ],
  band_lock: [
    ['Band', 'object'],
    ['Pci', 'object'],
  ],
  mac_filter: [
    ['data.enable', 'scalar'],
    ['data.mode', 'scalar'],
  ],
  ip_filter: [
    ['data.enable', 'scalar'],
    ['data.ipfilter_list', 'array'],
  ],
  port_forward: [
    ['data.switch', 'scalar'],
    ['data.rules', 'array'],
  ],
  port_map: [
    ['data.switch', 'scalar'],
    ['data.rules', 'array'],
  ],
  url_filter: [
    ['data.enable', 'scalar'],
    ['data.urlfilter_list', 'array'],
  ],
  upnp: [
    ['data.upnp_switch', 'scalar'],
    ['data.pf_rules', 'array'],
  ],
  dmz: [
    ['data.dmz_switch', 'scalar'],
    ['data.lan_ip', 'string'],
  ],
  alg: [['data.alg_switch', 'scalar']],
  dns: [['data', 'scalar']],
  dhcp: [
    ['data.dhcp_switch', 'scalar'],
    ['data.start', 'scalar'],
    ['data.end', 'scalar'],
    ['data.netmask', 'string'],
  ],
  time: [['result', 'number']],
  developer_mode: [['data.develop_mode', 'scalar']],
  traffic: [
    ['cfgs', 'object'],
    ['stats', 'object'],
  ],
};
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const matches = (v, t) =>
  t === 'object'
    ? object(v)
    : t === 'array'
      ? Array.isArray(v)
      : t === 'collection'
        ? object(v) || Array.isArray(v)
        : t === 'scalar'
          ? typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
          : t === 'number'
            ? typeof v === 'number' && Number.isFinite(v)
            : typeof v === t;
// 将“请求返回”与“数据符合规则”分开；业务告警不冒充校验通过。
export function validateResponse(def, data, businessWarnings = []) {
  const report = {
    status: 'passed',
    coverage: 'basic',
    basis: 'generic_object_check',
    checkedFields: [],
    issues: [],
    limitations: [
      'Not a full vendor response schema; does not prove connectivity or configuration effectiveness.',
    ],
  };
  if (!object(data)) {
    report.status = 'failed';
    report.issues.push({ path: [], reason: 'expected_object' });
    return report;
  }
  if (!Object.keys(data).length) {
    report.status = 'failed';
    report.issues.push({ path: [], reason: 'empty_response' });
    return report;
  }
  const fields = def.kind === 'write' ? undefined : rules[def.key];
  if (fields) {
    report.coverage = 'key_fields';
    report.basis = 'saved_real_device_response';
  }
  if (businessWarnings.length) {
    report.status = 'skipped_business_warning';
    report.limitations.push(
      'Key fields were not required because the device reported a business warning.',
    );
    return report;
  }
  // 只有成功码而没有业务数据，不能视为可用的查询结果。
  if (
    def.kind !== 'write' &&
    Object.keys(data).every((k) => ['code', 'dataCode'].includes(k))
  ) {
    report.status = 'failed';
    report.issues.push({ path: [], reason: 'missing_business_data' });
    return report;
  }
  for (const [field, type] of fields || []) {
    const path = Array.isArray(field) ? field : field.split('.');
    const value = path.reduce((v, k) => v?.[k], data);
    report.checkedFields.push({ path, expected: type });
    if (value === undefined || value === null)
      report.issues.push({ path, reason: 'missing_field', expected: type });
    else if (!matches(value, type))
      report.issues.push({
        path,
        reason: 'invalid_type',
        expected: type,
        actual: Array.isArray(value) ? 'array' : typeof value,
      });
  }
  if (
    def.key === 'wps_run' &&
    !['host', 'guest'].some(
      (k) => Object.hasOwn(data, k) && matches(data[k], 'collection'),
    )
  )
    report.issues.push({ path: [], reason: 'missing_wps_result' });
  if (report.issues.length) report.status = 'failed';
  return report;
}
const simSlotStates = {
  21: ['present', 'SIM 在槽且设备前端允许继续使用'],
  0: ['absent', '未检测到 SIM'],
  3: ['unavailable', 'SIM 暂时不可用'],
  4: ['unavailable', 'SIM 暂时不可用'],
};
export function simPresenceReading(data) {
  const raw = data?.data?.simcard_inslot;
  const value = raw === undefined || raw === null ? '' : String(raw);
  const known = simSlotStates[value];
  return {
    field: 'data.simcard_inslot',
    value,
    state: known?.[0] || (value ? 'abnormal' : 'unknown'),
    text: known?.[1] || (value ? '未识别的在槽码，设备前端视为 SIM 异常' : '响应没有在槽字段'),
    provesUplink: false,
  };
}
export function statusReading(data) {
  const row = data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {};
  const first = typeof row.wanstat === 'string' ? row.wanstat.split(',')[0].trim() : '';
  const simStatus = row.SimStatus === undefined || row.SimStatus === null ? '' : String(row.SimStatus);
  const uplink = first === 'true' ? 'connected' : first === 'false' ? 'not_connected' : 'unknown';
  const pin = simStatus === '3' ? 'pin_required' : simStatus === '4' ? 'puk_required' : 'not_indicated';
  const signal = typeof row.SignalValue === 'string' && row.SignalValue.trim() ? row.SignalValue.trim() : null;
  const operator = typeof row.long_eons === 'string' && row.long_eons.trim() ? row.long_eons.trim() : null;
  const radio = typeof row.NR_or_LTE === 'string' && row.NR_or_LTE.trim() ? row.NR_or_LTE.trim() : null;
  const text = uplink === 'connected'
    ? '上联已连接'
    : uplink === 'not_connected'
      ? pin === 'pin_required'
        ? '上联未连接，需要 PIN'
        : pin === 'puk_required'
          ? '上联未连接，需要 PUK'
          : '上联未连接'
      : '上联状态未知';
  return {
    wanstat: typeof row.wanstat === 'string' ? row.wanstat : null,
    uplink,
    simStatus,
    pin,
    signal,
    operator,
    radio,
    text,
    provesSimSlot: false,
  };
}
export function cellularDeviceReading(data) {
  const row = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const code = row.code === undefined || row.code === null ? '' : String(row.code);
  const warn = typeof row.Warn === 'string' && row.Warn && row.Warn !== '0' ? row.Warn : '';
  const radio = typeof row.PS_eAct === 'string' && row.PS_eAct.trim() ? row.PS_eAct.trim() : null;
  const registered = code === '200' && !warn;
  return {
    field: 'code',
    value: code,
    state: registered ? 'registered' : warn || code ? 'not_registered' : 'unknown',
    radio,
    plmn: typeof row.plmn === 'string' && row.plmn ? row.plmn : null,
    text: registered
      ? `蜂窝已注册${radio ? `，制式 ${radio}` : ''}`
      : warn
        ? `蜂窝未注册：${warn}`
        : '蜂窝注册状态未知',
    provesUplink: false,
    provesSimSlot: false,
  };
}
export function simInfoReading(data) {
  const sim = data?.sim && typeof data.sim === 'object' && !Array.isArray(data.sim) ? data.sim : {};
  const status = typeof sim.status === 'string' ? sim.status : '';
  const lock = sim.lock === undefined || sim.lock === null ? '' : String(sim.lock);
  const pinLock = lock === '0' ? 'disabled' : lock === '1' ? 'enabled' : 'unknown';
  const attempts = sim.remain?.pin1;
  const pinAttempts = attempts === undefined || attempts === null || attempts === '' ? null : String(attempts);
  const ready = status === 'READY';
  return {
    field: 'sim.status',
    value: status,
    state: ready ? 'ready' : status ? 'not_ready' : 'unknown',
    pinLock,
    pinAttempts,
    text: ready
      ? `SIM 可用${pinLock === 'disabled' ? '，PIN 锁关闭' : pinLock === 'enabled' ? '，PIN 锁开启' : ''}`
      : status
        ? `SIM 状态 ${status}`
        : '没有 SIM 状态字段',
    provesUplink: false,
    provesSimSlot: false,
  };
}
export function gpsReading(data) {
  const gps = data?.data || {};
  const value = String(gps.gps_switch ?? '');
  const enabled = ['enable', '1'].includes(value) ? true : ['disable', '0'].includes(value) ? false : null;
  const satellites = /^\d+$/.test(String(gps.number ?? '')) ? Number(gps.number) : null;
  const fix = String(gps.is_good ?? '') === '1' ? 'fixed' : String(gps.is_good ?? '') === '0' ? 'not_fixed' : 'unknown';
  return { enabled, satellites, fix, text: enabled === false ? 'GPS 已关闭' : enabled === true
    ? fix === 'fixed' ? 'GPS 已开启，设备报告已定位' : fix === 'not_fixed' ? 'GPS 已开启，但尚未定位' : 'GPS 已开启，定位状态未知'
    : 'GPS 开关状态未知', provesLocation: enabled === true && fix === 'fixed' };
}
export function pingReading(data) {
  const code = String(data?.code ?? '');
  const output = typeof data?.data === 'string' ? data.data : '';
  const stats = output.match(/(\d+) packets transmitted, (\d+) packets received, ([\d.]+)% packet loss/);
  return { state: code === '0' ? 'complete' : code === '1' ? 'pending' : 'unknown',
    text: code === '0' ? '诊断任务已完成；是否可达需看收发和丢包结果' : code === '1' ? '尚无完整结果；先启动诊断，已启动则继续轮询，不重复启动' : '诊断状态未知',
    ...(stats ? { transmitted: Number(stats[1]), received: Number(stats[2]), lossPercent: Number(stats[3]) } : {}),
    provesInternet: false };
}
export function phonebookReading(data) {
  if (String(data?.code ?? '') !== '0') return { state: 'unknown', text: '电话本返回业务告警，不能当作空列表' };
  const rows = data?.data;
  const count = rows === '' || rows === null ? 0 : rows && typeof rows === 'object' ? Object.keys(rows).length : null;
  return { state: count === 0 ? 'empty' : count === null ? 'unknown' : 'entries', count,
    text: count === 0 ? '本次电话本查询没有条目' : count === null ? '电话本条目结构未知' : `本次返回 ${count} 个电话本条目` };
}
export function deviceReading(key, data) {
  if (key === 'gps') return gpsReading(data);
  if (key === 'ping_result') return pingReading(data);
  if (['phonebook', 'phonebook_select'].includes(key)) return phonebookReading(data);
  if (key === 'sim_presence') return simPresenceReading(data);
  if (key === 'status') return statusReading(data);
  if (key === 'device') return cellularDeviceReading(data);
  if (key === 'sim') return simInfoReading(data);
  return undefined;
}
// 分类只解释已观测证据，保留原始错误码；不把权限拒绝伪装成成功。
function describeFailure(trace, def, error, confirmed, permission) {
  const base = { retrySameRequest: false };
  if (confirmed.some(f => f.reason === 'upstream_wifi_disabled')) return {
    ...base, category: 'precondition_not_met', evidence: 'confirmed',
    message: '当前上游 WiFi 客户端接口均已禁用，路由查询没有可返回的数据。',
    nextStep: '如需无线作为上游，先明确接入目标并授权配置；本次不自动启用接口或切换网络模式。',
  };
  if (confirmed.some(f => f.reason === 'service_not_registered')) return {
    ...base, category: 'service_unavailable', evidence: 'confirmed',
    message: '设备当前 UBUS 服务清单中没有注册所需服务对象，无法查询该功能。',
    nextStep: '向厂商确认对应服务或固件支持；本次不安装软件、启动服务或升级固件。',
  };
  if (confirmed.some(f => f.reason === 'target_permission_denied')) return {
    ...base, category: 'permission_denied', evidence: 'confirmed',
    message: '当前设备账号无权调用此接口；对照查询可用，反复登录不能增加接口权限。',
    nextStep: '由设备管理员或厂商核对当前账号的固件接口授权；授权后再复测。',
  };
  if (['RPC_ERROR_-32002', 'UBUS_ERROR_6_PERMISSION_DENIED'].includes(error)) return {
    ...base, category: 'access_rejected', evidence: 'observation',
    message: '设备拒绝访问；尚缺少有效的对照权限证据，不能确定是接口授权还是会话问题。',
    nextStep: '检查会话及账号授权；不要通过反复调用目标接口或修改配置来排查。',
  };
  if (error === 'UBUS_ERROR_5_NO_DATA') return {
    ...base, category: 'no_data', evidence: 'observation',
    message: permission === true ? '接口权限允许，但设备本次未提供业务数据。' : '设备本次未提供业务数据，尚不能确定原因。',
    nextStep: def.key === 'wifi_rt' ? '核对上游 WLAN 功能是否已配置；当前工作模式仅供参考，不自动切换模式或断网。' : '检查该功能的前置条件后再查询。',
  };
  const last = trace.filter(t => t.step === 'attempt').at(-1);
  if (error === 'RPC_ERROR_-32000' && last?.details?.response?.error?.message === 'Object not found') return {
    ...base, category: 'object_not_found', evidence: 'observation',
    message: '设备报告目标 UBUS 对象不存在，不能据此断言账号密码错误或仅是权限不足。',
    nextStep: '由设备管理员或厂商检查当前固件是否提供该服务；不自动安装、启动服务或升级固件。',
  };
  if (error === 'HTTP_403') return {
    ...base, category: 'http_forbidden', evidence: 'observation',
    message: trace.some(t => t.reason === 'login_required_renew_session')
      ? '携带 Cookie 并更新登录会话后，设备仍拒绝此路径。'
      : '设备拒绝此 HTTP 路径；仅凭 403 不能断言密码错误或接口无权限。',
    nextStep: '核对固件是否提供该页面接口及其访问限制；UBUS 权限查询不适用于此路径。',
  };
  return { ...base, category: 'unknown', evidence: 'inconclusive', message: '设备调用失败，现有证据不足以确定根因。', nextStep: '保留原始错误与诊断轨迹，核对接口和设备前置条件。' };
}
// 摘要从轨迹提取事实与假设；access=false 单独不能解释 Object not found。
export function summarizeDiagnostics(trace, def, error) {
  const access = trace.filter(
    (t) =>
      ['diagnostic', 'diagnostic_failed'].includes(t.step) &&
      t.service === 'session' &&
      t.method === 'access',
  );
  const target = access.filter(
    (t) => t.params?.object === def.service && t.params?.function === def.method,
  );
  const last = target.at(-1);
  const confirmed = trace
    .filter((t) => t.step === 'conclusion' && t.confirmed === true)
    .map((t) => ({ reason: t.reason, evidence: 'confirmed' }));
  return {
    outcome: error
      ? 'failed'
      : trace.filter((t) => t.step === 'attempt').at(-1)?.outcome || 'returned',
    rootCause: confirmed.at(-1)?.reason || (error ? 'unknown' : 'not_applicable'),
    permissionCheck: {
      status:
        def.transport !== 'ubus'
          ? 'not_applicable'
          : !last
            ? 'not_run'
            : last.step === 'diagnostic_failed'
              ? 'failed'
              : typeof last.data?.access === 'boolean'
                ? 'completed'
                : 'inconclusive',
      ...(typeof last?.data?.access === 'boolean' ? { access: last.data.access } : {}),
      note:
        def.transport !== 'ubus'
          ? 'UBUS session/access does not check CGI path authorization.'
          : 'An access result alone does not establish the cause of Object not found or NO_DATA.',
    },
    confirmedFindings: confirmed,
    hypotheses: trace
      .filter((t) => t.step === 'hypothesis')
      .map((t) => ({ reason: t.reason, evidence: 'hypothesis', workmode: t.workmode })),
    attempts: trace.filter((t) => t.step === 'attempt').length,
    retries: trace.filter((t) => t.step === 'retry_reason').map((t) => t.reason),
    ...(error
      ? {
          failure: describeFailure(trace, def, error, confirmed, last?.data?.access),
          remainingUnknowns: confirmed.length
            ? []
            : ['Failure root cause has not been established.'],
          stopped: true,
        }
      : {}),
  };
}
