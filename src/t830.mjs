import { timestamp } from './time.mjs';
import { executeWriteWorkflow } from './write-workflow.mjs';
import { writeProfiles } from './write-profiles.mjs';
import { OperationQueue } from './queue.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { validateResponse, summarizeDiagnostics } from './response.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { readByKey, writeByKey, reads } from './catalog.mjs';
// 对外输出前统一脱敏；保留 withCookie 布尔值，便于判断认证处理过程。
export function redact(value, key = '') {
  if (key === 'withCookie' && typeof value === 'boolean') {
    return value;
  }
  if (
    /password|passwd|wpapsk|token|sessionid|cookie|imei|imsi|iccid|serial|mac|ssid|phone|pincode|pin_str|puk|salt|cnum|secret/i.test(
      key,
    )
  )
    return '[REDACTED]';
  if (Array.isArray(value)) {
    return value.map((v) => redact(v));
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  return value;
}
// 错误码与诊断详情一起保存，供 CLI 和 MCP 客户端读取。
export class DeviceError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.details = redact(details);
  }
}
const names = [
  'OK',
  'INVALID_COMMAND',
  'INVALID_ARGUMENT',
  'METHOD_NOT_FOUND',
  'NOT_FOUND',
  'NO_DATA',
  'PERMISSION_DENIED',
  'TIMEOUT',
  'NOT_SUPPORTED',
];
const good = (code) => [0, 200, '0', '200'].includes(code);
// 只识别已知业务结果码，不能把 country_code 等配置字段当成错误码。
function warnings(data, path = '') {
  if (!data || typeof data !== 'object') {
    return [];
  }
  return Object.entries(data).flatMap(([k, v]) => {
    const field = path ? `${path}.${k}` : k;
    // 只检查明确的结果码字段；country_code 等业务编码仍是数据。
    if (
      [
        'code',
        'dataCode',
        '5G_code',
        '2.4G_code',
        'Unity_code',
        'Guest_code',
        'Guest5G_code',
      ].includes(k) &&
      !good(v)
    )
      return [{ field, value: v }];
    if ((k === 'ERROR' || k === 'Warn') && v && v !== '0') {
      return [{ field, value: v }];
    }
    return typeof v === 'object' ? warnings(v, field) : [];
  });
}
export class T830 {
  constructor(env = process.env) {
    this.base = new URL(env.T830_BASE_URL || 'http://192.168.0.1');
    if (
      !['http:', 'https:'].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password
    )
      throw new Error('Invalid device URL');
    this.username = env.T830_USERNAME || 'admin';
    this.password = env.T830_PASSWORD;
    this.hash = env.T830_PASSWORD_HASH;
    this.salt = env.T830_SALT;
    this.cookieMode = env.T830_COOKIE_MODE || 'auto';
    if (!['auto', 'always', 'never'].includes(this.cookieMode))
      throw new Error('Invalid cookie mode');
    this.timeout = Number(env.T830_TIMEOUT_MS || 10000);
    if (!Number.isFinite(this.timeout) || this.timeout < 100 || this.timeout > 120000)
      throw new Error('Invalid timeout');
    this.writesEnabled = env.T830_ENABLE_WRITES === '1';
    this.writeMaxAttempts = Number(env.T830_WRITE_MAX_ATTEMPTS ?? 2);
    this.writeReadbackAttempts = Number(env.T830_WRITE_READBACK_ATTEMPTS ?? 3);
    this.writeReadbackIntervalMs = Number(env.T830_WRITE_READBACK_INTERVAL_MS ?? 300);
    for (const [value, min, max] of [
      [this.writeMaxAttempts, 1, 3],
      [this.writeReadbackAttempts, 1, 5],
      [this.writeReadbackIntervalMs, 0, 5000],
    ]) {
      if (!Number.isInteger(value) || value < min || value > max)
        throw new Error('Invalid write verification policy');
    }
    this.cookies = [];
    this.token = null;
    this.loginPromise = null;
    this.renewPromise = null;
    this.nextId = 0;
    this.operationId = 0;
    this.shutdownController = new AbortController();
    this.closePromise = null;
    this.shutdownGraceMs = Number(env.T830_SHUTDOWN_GRACE_MS ?? 5000);
    if (
      !Number.isInteger(this.shutdownGraceMs) ||
      this.shutdownGraceMs < 1 ||
      this.shutdownGraceMs > 120000
    )
      throw new Error('Invalid shutdown grace');
    this.queueMaxPending = Number(env.T830_QUEUE_MAX_PENDING ?? 16);
    this.queueWaitMs = Number(env.T830_QUEUE_WAIT_MS ?? 30000);
    if (
      !Number.isInteger(this.queueMaxPending) ||
      this.queueMaxPending < 0 ||
      this.queueMaxPending > 1000
    )
      throw new Error('Invalid queue capacity');
    if (
      !Number.isInteger(this.queueWaitMs) ||
      this.queueWaitMs < 1 ||
      this.queueWaitMs > 120000
    )
      throw new Error('Invalid queue wait timeout');
    this.operationQueue = new OperationQueue({
      maxPending: this.queueMaxPending,
      waitTimeoutMs: this.queueWaitMs,
      error: (code, queue) =>
        new DeviceError(code, {
          queue,
          diagnostics: [
            {
              at: timestamp(),
              step: 'queue',
              evidence: 'observation',
              ...queue,
            },
          ],
          diagnosticSummary: {
            outcome: 'failed',
            rootCause: code,
            attempts: 0,
            stopped: true,
            executionState: 'not_started',
          },
        }),
    });
  }
  // HTTP 层：处理 Cookie、请求超时和取消；不负责业务层重试。
  async request(path, body, flag, options = {}) {
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin)
      throw new DeviceError('CROSS_ORIGIN_REQUEST_BLOCKED');
    url.searchParams.set('flag', flag);
    url.searchParams.set('t', String(Date.now()));
    const useCookie = options.cookie ?? this.cookieMode === 'always';
    const cookie = useCookie
      ? this.cookies
          .filter(
            (c) =>
              (!c.secure || url.protocol === 'https:') &&
              (url.pathname === c.path ||
                url.pathname.startsWith(c.path.endsWith('/') ? c.path : c.path + '/')),
          )
          .map((c) => c.pair)
          .join('; ')
      : '';
    if (options.signal?.aborted)
      throw new DeviceError('CALL_CANCELLED', { executionState: 'not_dispatched' });
    const deadline = AbortSignal.timeout(this.timeout);
    const requestSignal = AbortSignal.any([
      deadline,
      this.shutdownController.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    let response;
    try {
      response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: requestSignal,
      });
    } catch (e) {
      throw new DeviceError(
        this.shutdownController.signal.aborted
          ? 'SERVER_SHUTDOWN'
          : options.signal?.aborted
            ? 'CALL_CANCELLED'
            : deadline.aborted
              ? 'DEVICE_TIMEOUT'
              : 'DEVICE_UNREACHABLE',
        {
          cause: e.cause?.code || e.name,
          executionState: 'dispatched',
          remoteExecution: 'unknown',
        },
      );
    }
    const loginRequired = response.headers.get('x-luci-login-required') === 'yes';
    if (!response.ok)
      throw new DeviceError(`HTTP_${response.status}`, {
        http: response.status,
        loginRequired,
      });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new DeviceError(
        options.signal?.aborted
          ? 'CALL_CANCELLED'
          : deadline.aborted
            ? 'DEVICE_TIMEOUT'
            : 'NON_JSON_RESPONSE',
        {
          http: response.status,
          loginRequired,
          executionState: 'dispatched',
          remoteExecution: 'unknown',
        },
      );
    }
    if (url.pathname === '/cgi-bin/luci/login/action_login' && Number(data.code) === 0) {
      this.cookies = response.headers.getSetCookie().map((h) => {
        const [pair, ...attrs] = h.split(';').map((s) => s.trim());
        return {
          pair,
          path: attrs.find((s) => /^path=/i.test(s))?.slice(5) || '/cgi-bin/luci/login',
          secure: attrs.some((s) => /^secure$/i.test(s)),
        };
      });
    }
    return data;
  }
  // loginPromise 保存正在进行的登录，让其他调用等待同一次登录。
  async login() {
    if (this.renewPromise) {
      await this.renewPromise;
      return;
    }
    if (this.token) {
      return;
    }
    if (!this.loginPromise) this.loginPromise = this.performLogin();
    await this.loginPromise;
  }
  // 原始密码先按设备要求计算摘要；凭据和登录响应中的会话只保存在内存。
  async performLogin() {
    let salt = this.salt,
      password = this.hash;
    if (this.password) {
      salt = randomBytes(32).toString('hex');
      password = createHash('sha256')
        .update(salt + ':' + this.password)
        .digest('hex');
    }
    if (!password || !salt) {
      throw new DeviceError('MISSING_CREDENTIALS');
    }
    const r = await this.request(
      '/cgi-bin/luci/login/action_login',
      { username: this.username, password, salt },
      'action_login',
    );
    if (Number(r.code) !== 0 || !r.sessionid)
      throw new DeviceError('LOGIN_FAILED_CHECK_CREDENTIALS', { code: r.code });
    this.token = r.sessionid;
  }
  // renewPromise 合并重叠的会话更新，避免多个登录互相使旧会话失效。
  async renew() {
    if (this.renewPromise) {
      return this.renewPromise;
    }
    // 先等待初始登录结束，再替换共享会话，避免两个登录过程交错。
    const initial = this.loginPromise;
    this.renewPromise = (async () => {
      if (initial) await initial.catch(() => {});
      this.token = null;
      this.cookies = [];
      this.loginPromise = this.performLogin();
      await this.loginPromise;
    })().finally(() => {
      this.renewPromise = null;
    });
    return this.renewPromise;
  }
  // UBUS 参数顺序：[会话、服务对象、方法、业务参数]。本层保留原始错误。
  async rawRpc(service, method, args = {}, cookie = false, signal) {
    const r = await this.request(
      '/ubus/',
      {
        jsonrpc: '2.0',
        id: ++this.nextId,
        method: 'call',
        params: [this.token, service, method, args],
      },
      method,
      { cookie, signal },
    );
    if (r === null || typeof r !== 'object' || Array.isArray(r))
      throw new DeviceError('UBUS_INVALID_RESPONSE', { response: r });
    if (r.error) {
      throw new DeviceError(`RPC_ERROR_${r.error.code}`, { response: r });
    }
    if (!Array.isArray(r.result) || !Number.isInteger(r.result[0]))
      throw new DeviceError('UBUS_INVALID_RESPONSE', { response: r });
    if (r.result[0] !== 0)
      throw new DeviceError(
        `UBUS_ERROR_${r.result[0]}_${names[r.result[0]] || 'UNKNOWN'}`,
        { response: r },
      );
    if (r.result.length < 2)
      throw new DeviceError('UBUS_INVALID_RESPONSE', { response: r });
    return r.result[1];
  }
  // 工具入口：参数校验后入队。排队与执行分离，取消等待任务不会访问设备。
  run(def, args = {}, options = {}) {
    // 入队前拒绝无效参数，避免占用等待位置。
    args = def.schema ? def.schema.parse(args) : args;
    if (def.kind === 'write' && !this.writesEnabled)
      return Promise.reject(new DeviceError('WRITES_DISABLED'));
    const operationId = ++this.operationId;
    return this.operationQueue.enqueue(
      (queue) =>
        def.kind === 'write' && writeProfiles[def.key]
          ? this.executeWrite(def, args, queue, options)
          : this.runOperation(def, args, queue, options),
      {
        signal: options.signal,
        metadata: {
          operationId,
          section: def.key,
          maxPending: this.queueMaxPending,
          waitTimeoutMs: this.queueWaitMs,
        },
      },
    );
  }
  // 已取得队列执行权的任务；内部诊断直接调用 rawRpc，避免重复入队造成死锁。
  async runOperation(def, args = {}, queue, options = {}) {
    args = def.schema ? def.schema.parse(args) : args;
    const endpoint =
      def.transport === 'ubus'
        ? { transport: 'ubus', service: def.service, method: def.method }
        : {
            transport: 'cgi',
            path: def.path,
            httpMethod: def.kind === 'write' ? 'POST' : 'GET',
          };
    const trace = [];
    const add = (step, data) =>
      trace.push({
        at: timestamp(),
        step,
        evidence:
          step === 'hypothesis'
            ? 'hypothesis'
            : step === 'conclusion'
              ? data.confirmed
                ? 'confirmed'
                : 'inconclusive'
              : 'observation',
        ...redact(data),
      });
    add('queue', queue);
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.shutdownController.signal])
      : this.shutdownController.signal;
    const cancelled = () => {
      if (signal?.aborted)
        throw new DeviceError(
          this.shutdownController.signal.aborted ? 'SERVER_SHUTDOWN' : 'CALL_CANCELLED',
          { executionState: 'started', remoteExecution: 'unknown' },
        );
    };
    const readonly = def.kind !== 'write';
    if (!readonly && !this.writesEnabled) {
      throw new DeviceError('WRITES_DISABLED');
    }
    let cookie =
      this.cookieMode === 'always' || (!readonly && this.cookieMode !== 'never');
    let cookieRetry = false,
      renewed = false,
      netRetry = false,
      checked = false;
    const probe = async (service, method, params, purpose = 'target_permission') => {
      try {
        const data = await this.rawRpc(service, method, params, cookie, signal);
        if (
          service === 'session' &&
          method === 'access' &&
          typeof data?.access !== 'boolean'
        )
          throw new DeviceError('INVALID_ACCESS_RESPONSE', { response: data });
        add('diagnostic', { service, method, params, purpose, withCookie: cookie, data });
        return data;
      } catch (e) {
        if (['CALL_CANCELLED', 'SERVER_SHUTDOWN'].includes(e.message)) {
          throw e;
        }
        add('diagnostic_failed', {
          service,
          method,
          params,
          purpose,
          withCookie: cookie,
          error: e.message,
          details: e.details,
        });
        return null;
      }
    };
    try {
      cancelled();
      if (def.auth !== false) await this.login();
      cancelled();
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          cancelled();
          const data =
            def.transport === 'ubus'
              ? await this.rawRpc(def.service, def.method, args, cookie, signal)
              : await this.request(def.path, readonly ? undefined : args, def.key, {
                  cookie,
                  signal,
                });
          cancelled();
          const issues = warnings(data);
          const validation = validateResponse(def, data, issues);
          add('response_validation', { endpoint, validation });
          if (validation.status === 'failed')
            throw new DeviceError('INVALID_BUSINESS_RESPONSE', { validation, data });
          add('attempt', {
            attempt,
            endpoint,
            params: args,
            withCookie: cookie,
            outcome: issues.length
              ? 'device_warning'
              : readonly
                ? 'returned'
                : 'submitted',
            data,
          });
          options.captureRaw?.(data);
          return {
            status: issues.length
              ? 'device_warning'
              : readonly
                ? 'returned'
                : 'submitted',
            data: redact(data),
            warnings: redact(issues),
            validation,
            diagnosticSummary: summarizeDiagnostics(trace, def),
            diagnostics: trace,
            note: readonly
              ? '返回数据不代表已联网；无 SIM 仍可能有无线信息。'
              : '仅接口返回，未自动确认配置生效；不重试写操作。',
          };
        } catch (e) {
          add('attempt', {
            attempt,
            endpoint,
            params: args,
            withCookie: cookie,
            error: e.message,
            details: e.details,
          });
          if (e.message === 'CALL_CANCELLED') {
            throw e;
          }
          cancelled();
          if (!readonly) {
            throw e;
          }
          // 只有响应明确要求登录，才尝试补 Cookie 或更新会话。
          if (e.details?.loginRequired && def.auth !== false) {
            if (
              this.cookieMode === 'auto' &&
              !cookie &&
              this.cookies.length &&
              !cookieRetry
            ) {
              cookieRetry = true;
              cookie = true;
              add('retry_reason', { reason: 'login_required_retry_with_cookie' });
              continue;
            }
            if (this.cookieMode !== 'never' && !renewed) {
              renewed = true;
              await this.renew();
              cancelled();
              cookie = true;
              add('retry_reason', { reason: 'login_required_renew_session' });
              continue;
            }
          }
          if (['DEVICE_TIMEOUT', 'DEVICE_UNREACHABLE'].includes(e.message) && !netRetry) {
            netRetry = true;
            try {
              await delay(200, undefined, { signal });
            } catch {
              cancelled();
            }
            cancelled();
            add('retry_reason', { reason: 'single_transport_retry' });
            continue;
          }
          // 目标权限与已知可读接口作对照；只有证据充分才确认权限拒绝。
          if (
            ['RPC_ERROR_-32002', 'UBUS_ERROR_6_PERMISSION_DENIED'].includes(e.message) &&
            def.transport === 'ubus' &&
            !checked
          ) {
            checked = true;
            const p = await probe('session', 'access', {
              scope: 'ubus',
              object: def.service,
              function: def.method,
            });
            const accessFailure = trace.at(-1);
            // 失效会话也会让 session/access 自己被拒绝，而不是返回 access:false。
            // 仅对此明确拒绝做一次认证恢复；超时、畸形响应不能作为同一证据。
            if (
              p === null &&
              accessFailure?.step === 'diagnostic_failed' &&
              ['RPC_ERROR_-32002', 'UBUS_ERROR_6_PERMISSION_DENIED'].includes(accessFailure.error) &&
              !renewed &&
              this.cookieMode !== 'never'
            ) {
              add('hypothesis', {
                reason: 'target_and_access_denied_session_may_be_invalid',
                confirmed: false,
              });
              renewed = true;
              await this.renew();
              cancelled();
              cookie = true;
              checked = false;
              add('retry_reason', { reason: 'access_probe_denied_renew_session_once' });
              continue;
            }
            if (p?.access === false) {
              const c = await probe(
                'session',
                'access',
                { scope: 'ubus', object: 'mtk.wifi', function: 'get_ssidPage_info' },
                'control_permission',
              );
              add('conclusion', {
                reason:
                  c?.access === true
                    ? 'target_permission_denied'
                    : 'permission_denied_or_session_invalid',
                confirmed: c?.access === true,
              });
              if (c?.access === false && !renewed) {
                renewed = true;
                await this.renew();
                cancelled();
                cookie = this.cookieMode !== 'never';
                checked = false;
                add('retry_reason', {
                  reason: 'all_checked_permissions_false_renew_once',
                });
                continue;
              }
            }
          }
          if (
            def.key === 'share' &&
            e.message === 'RPC_ERROR_-32000' &&
            def.transport === 'ubus' &&
            !checked
          ) {
            checked = true;
            await probe('session', 'access', {
              scope: 'ubus',
              object: def.service,
              function: def.method,
            });
          }
          if (e.message === 'UBUS_ERROR_5_NO_DATA' && def.transport === 'ubus') {
            await probe('session', 'access', {
              scope: 'ubus',
              object: def.service,
              function: def.method,
            });
            if (def.key === 'wifi_rt' || def.method === 'get_wifi_router') {
              const mode = await probe('web_api', 'get_workmode', {}, 'workmode_context');
              add('hypothesis', {
                reason: 'router_data_depends_on_mode_and_upstream_connection',
                workmode: mode?.data?.workmode,
                confirmed: false,
              });
            }
          }
          throw e;
        }
      }
      throw new DeviceError('RETRY_BUDGET_EXHAUSTED');
    } catch (e) {
      if (!trace.some((t) => t.step === 'attempt'))
        add('initialization_failed', { error: e.message, details: e.details });
      throw new DeviceError(e.message, {
        ...e.details,
        endpoint,
        diagnosticSummary: summarizeDiagnostics(trace, def, e.message),
        diagnostics: trace,
        exhausted: true,
      });
    }
  }
  // 普通写工具也走完整流程；内部单次提交仍由 runOperation 执行且不自行重试。
  executeWrite(def, args, queue, options) {
    return executeWriteWorkflow(this, def, args, queue, options, {
      error: (code, details) => new DeviceError(code, details),
      sanitize: redact,
    });
  }
  // 保留原 UPnP 连续工具入口，结果格式兼容旧版本。
  async writeVerified(key, args, options = {}) {
    const def = writeByKey[key];
    if (!def || !writeProfiles[key]) throw new DeviceError('UNSUPPORTED_VERIFIED_WRITE');
    if (!this.writesEnabled) throw new DeviceError('WRITES_DISABLED');
    if (key === 'upnp' && !['0', '1'].includes(options.expectedCurrent))
      throw new DeviceError('EXPECTED_CURRENT_REQUIRED');
    const result = await this.run(def, args, options);
    if (key === 'upnp')
      return {
        ...result,
        status: 'verified_field',
        field: 'data.upnp_switch',
        value: result.observed.upnp_switch,
      };
    return result;
  }
  // 停止接收任务，等待活动任务收尾；超时后只终止本地等待，不保证远端停止。
  close({ graceMs = this.shutdownGraceMs } = {}) {
    if (this.closePromise) {
      return this.closePromise;
    }
    if (!Number.isInteger(graceMs) || graceMs < 1 || graceMs > 120000)
      return Promise.reject(new Error('Invalid shutdown grace'));
    this.closePromise = (async () => {
      const discardedPending = this.operationQueue.pending.length,
        activeAtClose = this.operationQueue.active;
      const idle = this.operationQueue.close();
      let timer;
      const graceful = await Promise.race([
        idle.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), graceMs);
        }),
      ]);
      clearTimeout(timer);
      if (!graceful) {
        this.shutdownController.abort();
        await idle;
      }
      return {
        status: 'closed',
        forced: !graceful,
        discardedPending,
        activeAtClose,
        ...(!graceful ? { remoteExecution: 'unknown' } : {}),
      };
    })();
    return this.closePromise;
  }
  async query(key, args = {}, options = {}) {
    const d = readByKey[key];
    if (!d) {
      throw new DeviceError('UNKNOWN_QUERY');
    }
    return this.run(d, args, options);
  }
  async write(key, args = {}, options = {}) {
    const d = writeByKey[key];
    if (!d) {
      throw new DeviceError('UNKNOWN_WRITE');
    }
    return this.run(d, args, options);
  }
  async rpc(service, method, args = {}, options = {}) {
    return this.run(
      { key: method, kind: 'read', transport: 'ubus', service, method },
      args,
      options,
    );
  }
  async simStatus() {
    return this.query('sim_presence');
  }
  async getMeshStatus() {
    return this.query('mesh_status');
  }
  async getWifiRtInfo() {
    return this.query('wifi_rt');
  }
}
export const queries = Object.fromEntries(
  reads.filter((d) => d.transport === 'ubus').map((d) => [d.key, [d.service, d.method]]),
);
