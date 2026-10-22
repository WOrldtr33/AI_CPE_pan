import { timestamp } from './time.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { readByKey } from './catalog.mjs';
import {
  writeProfiles,
  takeSnapshot,
  compareSnapshot,
  sameSnapshot,
} from './write-profiles.mjs';

// 此函数已经拥有队列执行权。所有诊断和回读直接执行，不能再次入队。
export async function executeWriteWorkflow(
  device,
  def,
  args,
  queue,
  options,
  { error, sanitize },
) {
  const profile = writeProfiles[def.key];
  if (!profile) throw error('UNSUPPORTED_VERIFIED_WRITE');
  const fields = profile.fields(args);
  if (!fields.length) throw error('WRITE_NO_FIELDS');
  if (fields.some((field) => field.normalize(field.expected) === undefined))
    throw error('WRITE_VALUE_NOT_COMPARABLE');
  const steps = [],
    diagnostics = [];
  const signal = options.signal
    ? AbortSignal.any([options.signal, device.shutdownController.signal])
    : device.shutdownController.signal;
  let phase = 'baseline',
    original,
    latest,
    latestRaw,
    writeAttempts = 0,
    renewed = false;
  const add = (step, detail) =>
    diagnostics.push({
      at: timestamp(),
      step,
      evidence: 'observation',
      ...sanitize(detail),
    });
  const checkCancel = () => {
    if (signal.aborted)
      throw error(
        device.shutdownController.signal.aborted ? 'SERVER_SHUTDOWN' : 'CALL_CANCELLED',
      );
  };
  const pause = async () => {
    try {
      await delay(device.writeReadbackIntervalMs, undefined, { signal });
    } catch {
      checkCancel();
    }
    checkCancel();
  };
  const read = async (readPhase, poll = 1) => {
    phase = readPhase;
    checkCancel();
    let raw;
    try {
      const output = await device.runOperation(readByKey[profile.readback], {}, queue, {
        ...options,
        captureRaw: (value) => {
          raw = value;
        },
      });
      steps.push({ phase, poll, output });
      const invalidWarnings = output.warnings.filter(
        (warning) => !profile.allowWarning?.(warning),
      );
      if (invalidWarnings.length)
        throw error('WORKFLOW_READ_WARNING', { warnings: invalidWarnings });
      const snapshot = takeSnapshot(profile, fields, raw, args);
      latest = snapshot;
      latestRaw = raw;
      add('readback', {
        phase,
        poll,
        values: snapshot.values,
        unavailable: snapshot.unavailable,
        comparison: compareSnapshot(fields, snapshot),
      });
      return snapshot;
    } catch (e) {
      add('readback_failed', { phase, poll, error: e.message, details: e.details });
      throw e;
    }
  };
  const pollResult = async () => {
    let last, comparisons;
    const busyDeadline = Date.now() + device.writeBusyWaitMs;
    for (let poll = 1; poll <= device.writeReadbackAttempts; poll++) {
      if (poll > 1) await pause();
      try {
        last = await read('verification', poll);
        comparisons = compareSnapshot(fields, last);
      } catch (e) {
        if (['CALL_CANCELLED', 'SERVER_SHUTDOWN'].includes(e.message)) throw e;
        // 应用配置期间（如无线重启）回读返回忙：按厂商网页节奏等待，不计入回读次数。
        if (e.message === 'DEVICE_BUSY' && Date.now() < busyDeadline) {
          add('device_busy_wait', { poll, waitMs: device.writeBusyPollMs });
          try {
            await delay(device.writeBusyPollMs, undefined, { signal });
          } catch {
            checkCancel();
          }
          checkCancel();
          poll--;
          continue;
        }
        if (poll === device.writeReadbackAttempts)
          return { state: 'unknown', error: e.message };
        continue;
      }
      if (comparisons.allMatched)
        return { state: 'applied', snapshot: last, comparisons };
      if (comparisons.unknown.length)
        return { state: 'unknown', snapshot: last, comparisons };
      if (!sameSnapshot(original, last))
        return { state: 'conflict_or_partial', snapshot: last, comparisons };
    }
    return {
      state: last ? 'unchanged_observed' : 'unknown',
      snapshot: last,
      comparisons,
    };
  };
  const diagnose = async (failure) => {
    const facts = {
      authRejected: !!failure.details?.loginRequired,
      permanentPermissionDenied: false,
      sessionInvalid: false,
    };
    if (
      def.transport === 'ubus' &&
      ['RPC_ERROR_-32002', 'UBUS_ERROR_6_PERMISSION_DENIED', 'RPC_ERROR_-32000'].includes(
        failure.message,
      )
    ) {
      const probe = async (object, method, purpose) => {
        try {
          const data = await device.rawRpc(
            'session',
            'access',
            { scope: 'ubus', object, function: method },
            device.cookieMode !== 'never',
            signal,
          );
          if (typeof data?.access !== 'boolean') throw error('INVALID_ACCESS_RESPONSE');
          add('diagnostic', {
            service: 'session',
            method: 'access',
            params: { scope: 'ubus', object, function: method },
            purpose,
            data,
          });
          return data.access;
        } catch (e) {
          if (['CALL_CANCELLED', 'SERVER_SHUTDOWN'].includes(e.message)) throw e;
          add('diagnostic_failed', { purpose, error: e.message, details: e.details });
          return undefined;
        }
      };
      const target = await probe(def.service, def.method, 'target_write_permission');
      const control = await probe('mtk.wifi', 'get_ssidPage_info', 'control_permission');
      const permissionError = [
        'RPC_ERROR_-32002',
        'UBUS_ERROR_6_PERMISSION_DENIED',
      ].includes(failure.message);
      facts.permanentPermissionDenied =
        permissionError && target === false && control === true;
      facts.sessionInvalid = permissionError && target === false && control === false;
      facts.authRejected ||= permissionError && (target === true || facts.sessionInvalid);
    }
    add('write_diagnosis', facts);
    return facts;
  };
  const finish = (verification, submission) =>
    sanitize({
      status: 'verified_fields',
      section: def.key,
      verification: {
        state: 'applied',
        fields: verification.comparisons.matching,
        unknownFields: verification.comparisons.unknown,
      },
      submissionOutcome: submission,
      writeAttempts,
      original: original.values,
      expected: Object.fromEntries(fields.map((f) => [f.name, f.normalize(f.expected)])),
      observed: verification.snapshot.values,
      alreadyMatchedBeforeWrite: compareSnapshot(fields, original).allMatched,
      steps,
      diagnostics,
      automaticRollback: false,
      note: '仅确认目标配置字段在回读时符合期望，不代表联网或配置持续不变。',
    });
  try {
    original = await read('baseline');
    // 首次回读结构不明确时不冒险写入；密码掩码只能留作不可验证字段。
    const unknownNonSecret = original.unavailable.filter(
      (name) => !/(wpapsk|password)/i.test(name),
    );
    if (unknownNonSecret.length)
      throw error('READBACK_SCHEMA_UNSUPPORTED', { fields: unknownNonSecret });
    if (options.expectedCurrent !== undefined) {
      const expected =
        typeof options.expectedCurrent === 'object'
          ? options.expectedCurrent
          : { [fields[0].name]: String(options.expectedCurrent) };
      for (const [name, value] of Object.entries(expected)) {
        if (
          !(name in original.values) ||
          original.unavailable.includes(name) ||
          original.values[name] !== String(value)
        )
          throw error('CONFIG_CONFLICT', {
            phase: 'baseline',
            field: name,
            expected: sanitize(value, name),
            observed: sanitize(original.values[name], name),
          });
      }
    }
    const before = await read('before_write');
    if (!sameSnapshot(original, before))
      throw error('CONFIG_CONFLICT', {
        phase,
        original: original.values,
        observed: before.values,
      });
    let submission = args;
    if (profile.merge) {
      const { args: merged, missing } = profile.merge(latestRaw, args);
      if (missing.length) throw error('WRITE_BASELINE_INCOMPLETE', { fields: missing });
      const checked = def.submitSchema ? def.submitSchema.safeParse(merged) : { success: true, data: merged };
      if (!checked.success)
        throw error('WRITE_MERGED_ARGS_INVALID', { issues: checked.error.issues.map(({ path, message }) => ({ path, message })) });
      submission = checked.data;
      add('merge_baseline', { submittedFields: Object.keys(args), filledFromReadback: true });
    }
    for (let attempt = 1; attempt <= device.writeMaxAttempts; attempt++) {
      checkCancel();
      phase = 'write';
      writeAttempts++;
      let failure, submitted;
      try {
        submitted = await device.runOperation(def, submission, queue, options);
        steps.push({ phase, attempt, output: submitted });
        add('write_attempt', { attempt, outcome: submitted.status });
        if (submitted.status !== 'submitted' && submitted.businessOutcome !== 'not_modified')
          failure = error('WORKFLOW_WRITE_WARNING', { warnings: submitted.warnings });
      } catch (e) {
        failure = e;
        add('write_attempt', { attempt, error: e.message, details: e.details });
        if (['CALL_CANCELLED', 'SERVER_SHUTDOWN'].includes(e.message)) throw e;
      }
      const facts = failure ? await diagnose(failure) : {};
      // 不论收到成功响应还是异常，先回读。超时不等于未写入。
      const tokenBeforeReadback = device.token;
      const verification = await pollResult();
      const readbackRenewedSession = device.token !== tokenBeforeReadback;
      if (readbackRenewedSession) {
        renewed = true;
        add('session_recovery', { reason: 'readback_recovered_session' });
      }
      add('verification_result', { attempt, state: verification.state });
      if (verification.state === 'applied')
        return finish(
          verification,
          failure ? 'error_but_state_confirmed' : submitted?.businessOutcome === 'not_modified' ? 'not_modified' : 'acknowledged',
        );
      if (verification.state === 'unknown')
        throw error('WRITE_RESULT_UNKNOWN', {
          lastWriteError: failure?.message,
          verification,
        });
      if (verification.state === 'conflict_or_partial')
        throw error('WRITE_VERIFICATION_FAILED', { cause: 'unknown', verification });
      if (facts.permanentPermissionDenied)
        throw error(failure.message, {
          ...failure.details,
          confirmedReason: 'target_permission_denied',
          verification,
        });
      const transient =
        failure &&
        (facts.authRejected || failure.details?.executionState === 'not_dispatched');
      const acknowledgedUnchanged = !failure && profile.retryUnchanged;
      if (attempt === device.writeMaxAttempts || (!transient && !acknowledgedUnchanged)) {
        // 断线/超时之后仍是原值，也不能排除设备稍后执行；不盲目重发。
        if (
          failure &&
          [
            'DEVICE_TIMEOUT',
            'DEVICE_UNREACHABLE',
            'HTTP_500',
            'HTTP_502',
            'HTTP_503',
            'HTTP_504',
            'NON_JSON_RESPONSE',
            'UBUS_INVALID_RESPONSE',
          ].includes(failure.message)
        )
          throw error('WRITE_RESULT_UNKNOWN', {
            lastWriteError: failure.message,
            verification,
          });
        throw error(failure?.message || 'WRITE_VERIFICATION_FAILED', {
          ...failure?.details,
          verification,
          cause: 'unknown',
        });
      }
      phase = 'retry_prepare';
      const fresh = await read('before_retry');
      if (compareSnapshot(fields, fresh).allMatched)
        return finish(
          { snapshot: fresh, comparisons: compareSnapshot(fields, fresh) },
          'confirmed_before_retry',
        );
      if (!sameSnapshot(original, fresh))
        throw error('CONFIG_CONFLICT', {
          phase,
          original: original.values,
          observed: fresh.values,
        });
      if (transient && facts.authRejected) {
        if (!readbackRenewedSession) {
          if (renewed) throw error('WRITE_AUTH_RECOVERY_EXHAUSTED', { verification });
          renewed = true;
          await device.renew();
          checkCancel();
        }
        if (def.transport === 'ubus') {
          const access = await device.rawRpc(
            'session',
            'access',
            { scope: 'ubus', object: def.service, function: def.method },
            device.cookieMode !== 'never',
            signal,
          );
          add('diagnostic', {
            service: 'session',
            method: 'access',
            params: { scope: 'ubus', object: def.service, function: def.method },
            purpose: 'permission_after_renew',
            data: access,
          });
          if (access?.access !== true)
            throw error('WRITE_AUTH_RECOVERY_FAILED', { verification });
        }
      }
      add('retry_reason', {
        attempt: attempt + 1,
        reason: transient
          ? 'confirmed_rejection_recovered'
          : 'acknowledged_but_unchanged_absolute_setting',
      });
    }
    throw error('WRITE_RETRY_BUDGET_EXHAUSTED');
  } catch (e) {
    throw error(e.message, {
      ...e.details,
      phase,
      steps,
      diagnostics,
      writeAttempts,
      writeStarted: writeAttempts > 0,
      original: original?.values,
      expected: Object.fromEntries(fields.map((f) => [f.name, f.normalize(f.expected)])),
      observed: latest?.values,
      remoteConfiguration:
        writeAttempts > 0 ? 'requires_readback' : 'not_written_by_this_workflow',
      automaticRollback: false,
      diagnosticSummary: {
        outcome: 'failed',
        rootCause: e.details?.confirmedReason || 'unknown',
        writeAttempts,
        verification: e.details?.verification?.state || 'not_completed',
        stopped: true,
      },
    });
  }
}
