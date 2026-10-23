import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redact, isPasswordKey } from './t830.mjs';
import { timestamp, logTimeZone } from './time.mjs';

export function sanitizer(initial = []) {
  const secrets = new Set(initial.filter(Boolean));
  const clean = (value, key = '') => {
    // Token 数量是计费指标，认证 token 才是凭据；不要丢失 usage。
    if (typeof value === 'number' && /(^|_)tokens$/.test(key)) return value;
    if (/api.?key|authorization|reasoning_content/i.test(key)) return '[REDACTED]';
    if (redact(undefined, key) === '[REDACTED]') return '[REDACTED]';
    if (typeof value === 'string') {
      let text = value.replace(/sk-[a-zA-Z0-9_.-]+/g, '[REDACTED]');
      for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
      return text;
    }
    if (Array.isArray(value)) return value.map(v => clean(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
    return value;
  };
  const sanitize = value => clean(value);
  // 交互中明文显示的配置密码也会出现在回答正文里；记下其值，落盘时按字符串替换。
  sanitize.learn = (value, key = '') => {
    if (typeof value === 'string') { if (isPasswordKey(key) && value.length >= 4 && value !== '[REDACTED]') secrets.add(value); }
    else if (Array.isArray(value)) value.forEach(v => sanitize.learn(v));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) sanitize.learn(v, k);
  };
  return sanitize;
}

export function createLog(directory, sanitize) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${timestamp().replace(/[:.]/g, '-')}-${randomUUID()}.jsonl`);
  return { path, event: data => {
    // 媒体转写和视觉描述可能包含用户隐私；运行日志只记录状态及素材 ID。
    if (data.name?.startsWith('media_')) data = { event: data.event, name: data.name, result: { status: data.result?.status, error: data.result?.error, assetId: data.result?.assetId || data.result?.asset?.id } };
    appendFileSync(path, JSON.stringify(sanitize({ ...data, at: timestamp(), timeZone: logTimeZone })) + '\n', { mode: 0o600 });
  } };
}
