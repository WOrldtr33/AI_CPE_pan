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
  version: [['data.version', 'string']],
  sim_presence: [['data.simcard_inslot', 'scalar']],
  sim: [['sim', 'object']],
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
          remainingUnknowns: confirmed.length
            ? []
            : ['Failure root cause has not been established.'],
          stopped: true,
        }
      : {}),
  };
}
