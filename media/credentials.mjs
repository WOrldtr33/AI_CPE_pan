import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function loadMediaCredentials(env = process.env) {
  const path = new URL('../credentials-media.json', import.meta.url);
  if (env.MEDIA_OMNI_API_KEY || !existsSync(path)) return env;
  if (process.platform !== 'win32') throw new Error('MEDIA_CREDENTIAL_WINDOWS_REQUIRED');
  try {
    const saved = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    if (saved.format !== 'windows-dpapi-v1') throw new Error();
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
    const key = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('../scripts/read-media-key.ps1', import.meta.url))],
      { env: childEnv, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!key) throw new Error();
    return { ...env, MEDIA_OMNI_API_KEY: key, MEDIA_OMNI_BASE_URL: env.MEDIA_OMNI_BASE_URL || saved.baseUrl, MEDIA_OMNI_MODEL: env.MEDIA_OMNI_MODEL || saved.model };
  } catch { throw new Error('MEDIA_CREDENTIAL_DECRYPT_FAILED'); }
}
