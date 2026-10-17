import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const bundledFfmpeg = fileURLToPath(new URL('../.tools/ffmpeg/ffmpeg.exe', import.meta.url));

export function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('MEDIA_LOCAL_URL_REQUIRED');
  return url.origin;
}
export function mediaConfig(env = process.env) {
  const integer = (name, fallback, min, max) => {
    const n = Number(env[name] ?? fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`INVALID_${name}`);
    return n;
  };
  const providers = Object.fromEntries(['ASR', 'TTS', 'VISION'].map(kind => {
    const omni = !env[`MEDIA_${kind}_BASE_URL`] && !!env.MEDIA_OMNI_API_KEY;
    const baseUrl = omni ? (env.MEDIA_OMNI_BASE_URL || 'https://maas.qianwenaiapi.com/compatible-mode/v1') : env[`MEDIA_${kind}_BASE_URL`];
    const model = omni ? (env.MEDIA_OMNI_MODEL || 'qwen3-omni-flash') : env[`MEDIA_${kind}_MODEL`];
    const apiKey = omni ? env.MEDIA_OMNI_API_KEY : env[`MEDIA_${kind}_API_KEY`];
    if (baseUrl) {
      const u = new URL(baseUrl);
      if (u.username || u.password || u.search || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))) throw new Error(`INVALID_MEDIA_${kind}_URL`);
    }
    return [kind.toLowerCase(), { protocol: omni ? 'qwen-omni' : 'compatible', baseUrl: baseUrl?.replace(/\/$/, ''), model, apiKey, voice: env.MEDIA_TTS_VOICE || (omni ? 'Cherry' : 'alloy'), ready: !!(baseUrl && model && apiKey) }];
  }));
  return { directory: env.MEDIA_STATE_DIR || fileURLToPath(new URL('../.media-state/', import.meta.url)),
    voiceDiagnostics: env.MEDIA_VOICE_DIAGNOSTICS === '1',
    voiceModelsDirectory: env.MEDIA_VOICE_MODELS_DIR || fileURLToPath(new URL('../.tools/voice/', import.meta.url)),
    voicePython: env.MEDIA_VOICE_PYTHON || join(env.USERPROFILE || process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),
    reportDirectory: env.MEDIA_REPORT_DIR || fileURLToPath(new URL('../reports/monitoring/', import.meta.url)),
    port: integer('MEDIA_PORT', 18790, 0, 65535), maxBytes: integer('MEDIA_MAX_BYTES', 16 * 1024 * 1024, 1024, 32 * 1024 * 1024),
    maxAssets: integer('MEDIA_MAX_ASSETS', 100, 1, 1000), ffmpeg: env.MEDIA_FFMPEG_PATH || (process.platform === 'win32' && existsSync(bundledFfmpeg) ? bundledFfmpeg : 'ffmpeg'),
    timeoutMs: integer('MEDIA_TIMEOUT_MS', 60000, 1000, 120000), providers,
  };
}
