// 每个写接口明确列出回读位置；路径数组避免把 2.4G 中的点当作层级。
const field = (name, path, expected, normalize = scalar) => ({
  name,
  path,
  expected,
  normalize,
});
function scalar(value) {
  if (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return String(value);
  }
  return undefined;
}
function gpsState(value) {
  if (value === 'enable') return '1';
  if (value === 'disable') return '0';
  return ['0', '1', 0, 1].includes(value) ? String(value) : undefined;
}
function trafficBytes(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(MB|GB)?$/);
  if (!match) return undefined;
  const multiplier = match[2] === 'GB' ? 1024 ** 3 : match[2] === 'MB' ? 1024 ** 2 : 1;
  const bytes = Number(match[1]) * multiplier;
  return Number.isSafeInteger(bytes) ? String(bytes) : undefined;
}
const configFields = (args, bands) =>
  bands.flatMap((band) =>
    Object.entries(args[band] || {}).map(([name, expected]) =>
      field(`${band}.${name}`, [band, name], expected),
    ),
  );
// 设备接口要求双频整体提交：以提交前回读的原始值补齐未修改字段，凭据不经过模型。
// disabledPsk 为 undefined 时不加密频段省略 wpapsk，否则提交该值。
const mergeBands = (bands, keys, disabledPsk) => (raw, args) => {
  const missing = [];
  const merged = Object.fromEntries(
    bands.map((band) => {
      const current = raw?.[band] || {};
      const next = Object.fromEntries(
        keys.filter((key) => scalar(current[key]) !== undefined).map((key) => [key, scalar(current[key])]),
      );
      Object.assign(next, args[band]);
      for (const key of keys)
        if (key !== 'wpapsk' && next[key] === undefined) missing.push(`${band}.${key}`);
      if (next.authmode === 'Disable') {
        if (disabledPsk === undefined) delete next.wpapsk;
        else next.wpapsk = disabledPsk;
      } else if (args[band]?.wpapsk === undefined && (!next.wpapsk || masked(next.wpapsk))) {
        missing.push(`${band}.wpapsk`);
      }
      return [band, next];
    }),
  );
  return { args: merged, missing };
};
export const writeProfiles = {
  wifi_switch: {
    readback: 'wifi',
    retryUnchanged: true,
    basis: 'API10/实机 WiFi state',
    fields: (args) => [field('state', [args.name, 'state'], args.action)],
  },
  wifi_config: {
    readback: 'wifi',
    retryUnchanged: false,
    basis: 'API11/实机双频对象',
    fields: (args) => configFields(args, ['2.4G', '5G']),
    merge: mergeBands(['2.4G', '5G'], ['hidden', 'ssid', 'state', 'authmode', 'wpapsk']),
  },
  guest_switch: {
    readback: 'guest',
    retryUnchanged: true,
    basis: 'API13/实机 Guest state',
    fields: (args) => [field('state', [args.name, 'state'], args.action)],
  },
  guest_config: {
    readback: 'guest',
    retryUnchanged: false,
    basis: 'API14/实机访客对象',
    fields: (args) => configFields(args, ['Guest', 'Guest5G']),
    merge: mergeBands(['Guest', 'Guest5G'], ['state', 'ssid', 'authmode', 'on_mode', 'wpapsk'], ''),
  },
  wifi_night: {
    readback: 'wifi_night',
    retryUnchanged: false,
    basis: 'API22/设备网页 daylight 的 action/openTime/closeTime',
    fields: (args) =>
      Object.entries(args).map(([name, expected]) => field(name, [name], expected)),
  },
  apn_save: {
    readback: 'apn',
    retryUnchanged: false,
    basis: 'API61/实机 manual.apn_list，以 config_file 定位',
    select: (raw, args) => {
      const list = raw?.manual?.apn_list;
      if (!Array.isArray(list)) return undefined;
      const matches = list.filter((row) => row.config_file === args.config_file);
      if (matches.length > 1) return undefined;
      return matches[0] || { absent: true };
    },
    fields: (args) =>
      Object.entries(args).map(([name, expected]) => field(name, [name], expected)),
  },
  roaming: {
    readback: 'roaming',
    retryUnchanged: true,
    basis: 'API68/设备网页 connection mode 的 action',
    fields: (args) => [field('action', ['action'], args.action)],
  },
  upnp: {
    readback: 'upnp',
    retryUnchanged: true,
    basis: 'API84/实机 data.upnp_switch',
    fields: (args) => [field('upnp_switch', ['data', 'upnp_switch'], args.upnp_switch)],
  },
  dns: {
    readback: 'dns',
    retryUnchanged: true,
    basis: 'API90/设备网页 protection 的 data 标量',
    fields: (args) => [field('rebind_protection', ['data'], args.rebind_protection)],
  },
  gps: {
    readback: 'gps',
    retryUnchanged: true,
    basis: 'API108/设备网页 GPS 的 enable→1、disable→0',
    fields: (args) => [
      field('gps_switch', ['data', 'gps_switch'], args.gps_switch, gpsState),
    ],
    // 设备网页对 code=-1 仍读取 gps_switch，只把定位数据视为未就绪。
    allowWarning: (warning) => warning.field === 'code' && Number(warning.value) === -1,
  },
  traffic: {
    readback: 'traffic',
    retryUnchanged: true,
    basis: 'API113/网页 X0 的 MB/GB→字节；仅验证 cfgs，不验证蜂窝流量',
    fields: (args) =>
      Object.entries(args).map(([name, expected]) =>
        field(
          name,
          ['cfgs', name],
          expected,
          name.endsWith('_limit') ? trafficBytes : scalar,
        ),
      ),
    allowWarning: (warning) => warning.field.startsWith('stats.'),
  },
};
// 掩码不能证明密码已生效；它与真实原值不可比较。
const masked = (value) =>
  typeof value === 'string' &&
  (/^\*+$/.test(value) || value === '[REDACTED]' || value === '********');
export function takeSnapshot(profile, fields, raw, args) {
  const selected = profile.select ? profile.select(raw, args) : raw;
  const values = {},
    unavailable = [];
  for (const descriptor of fields) {
    const value = selected?.absent
      ? null
      : descriptor.path.reduce((object, key) => object?.[key], selected);
    const normalized =
      value === null && selected?.absent ? null : descriptor.normalize(value);
    if (
      normalized === undefined ||
      (/(wpapsk|password)/i.test(descriptor.name) && masked(value))
    ) {
      unavailable.push(descriptor.name);
    }
    values[descriptor.name] = normalized ?? null;
  }
  return { values, unavailable, absent: !!selected?.absent };
}
export function compareSnapshot(fields, snapshot) {
  const matching = [],
    different = [],
    unknown = [];
  for (const descriptor of fields) {
    if (snapshot.unavailable.includes(descriptor.name)) unknown.push(descriptor.name);
    else if (
      snapshot.values[descriptor.name] === descriptor.normalize(descriptor.expected)
    )
      matching.push(descriptor.name);
    else different.push(descriptor.name);
  }
  return {
    matching,
    different,
    unknown,
    allMatched: different.length === 0 && unknown.length === 0,
  };
}
export function sameSnapshot(left, right) {
  return (
    left.absent === right.absent &&
    JSON.stringify(left.values) === JSON.stringify(right.values) &&
    JSON.stringify(left.unavailable) === JSON.stringify(right.unavailable)
  );
}
