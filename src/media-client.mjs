import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localUrl } from '../media/config.mjs';
import { boundedBody } from '../media/providers.mjs';

export class MediaClient {
  constructor(env = process.env) { this.directory = env.MEDIA_STATE_DIR || fileURLToPath(new URL('../.media-state/', import.meta.url)); this.url = env.MEDIA_SERVICE_URL; this.token = env.MEDIA_SERVICE_TOKEN; }
  async request(route, body, signal) {
    let connection;
    if (this.url && this.token) connection = { url: this.url, token: this.token };
    else { try { connection = JSON.parse(await readFile(join(this.directory, 'connection.json'), 'utf8')); } catch { throw new Error('MEDIA_SERVICE_NOT_RUNNING：先运行 npm run media。'); } }
    const url = localUrl(connection.url);
    if (typeof connection.token !== 'string' || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('MEDIA_INVALID_CONNECTION');
    const combined = AbortSignal.any([AbortSignal.timeout(115000), ...(signal ? [signal] : [])]);
    try {
      const response = await fetch(`${url}${route}`, { method: 'POST', redirect: 'error', signal: combined, headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = JSON.parse((await boundedBody(response, 100000)).toString('utf8'));
      if (!response.ok || result.status === 'error') throw new Error(/^MEDIA_|^CALL_CANCELLED/.test(result.error) ? result.error : 'MEDIA_SERVICE_ERROR');
      return result;
    } catch (error) { if (signal?.aborted) throw new Error('CALL_CANCELLED'); if (combined.aborted) throw new Error('MEDIA_SERVICE_TIMEOUT'); if (/^MEDIA_|^CALL_CANCELLED/.test(error.message)) throw error; throw new Error('MEDIA_SERVICE_UNAVAILABLE'); }
  }
  call(name, args, signal) { return this.request('/api/call', { name, args }, signal); }
  async upload(file, signal) {
    // 本地路径仅接受用户在 CLI 中显式输入，不向模型提供任意文件读取工具。
    const { stat } = await import('node:fs/promises');
    const info = await stat(file);
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('MEDIA_SIZE_LIMIT');
    return this.request('/api/upload', { data: (await readFile(file)).toString('base64') }, signal);
  }
}
