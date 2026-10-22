import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reads } from './catalog.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const credentialPath = fileURLToPath(new URL('../credentials-agent.json', import.meta.url));
export const defaultTools = reads.map(def => def.key);

export function readApiKey(env = process.env) {
  if (env.DEEPSEEK_API_KEY?.trim()) return env.DEEPSEEK_API_KEY.trim();
  if (!existsSync(credentialPath)) throw new Error('MISSING_API_KEY：运行 scripts/configure-agent.ps1 保存 Key，或设置 DEEPSEEK_API_KEY。');
  if (process.platform !== 'win32') throw new Error('加密凭据仅适用于 Windows；请设置 DEEPSEEK_API_KEY。');
  // Windows DPAPI：只有保存时的 Windows 用户可以解密。Key 不放在命令行参数中。
  const saved = JSON.parse(readFileSync(credentialPath, 'utf8').replace(/^\uFEFF/, ''));
  if (saved.format !== 'windows-dpapi-v1' || typeof saved.encryptedKey !== 'string') throw new Error('INVALID_CREDENTIAL_FILE');
  try {
    // 父进程可能由 PowerShell 7 启动；其模块路径不能传给 Windows PowerShell 5。
    const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'));
    const key = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('../scripts/read-agent-key.ps1', import.meta.url))],
    { env: childEnv, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!key) throw new Error('Empty API Key');
    return key;
  } catch { throw new Error('CREDENTIAL_DECRYPT_FAILED：请在保存 Key 的 Windows 用户下运行，或重新配置 Key。'); }
}

export function config(env = process.env) {
  const number = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`INVALID_CONFIG_${name}`);
    return value;
  };
  const base = new URL(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('INVALID_API_URL：必须使用无凭据的 HTTPS 地址。');
  const thinking = env.AGENT_THINKING || 'off';
  if (!['off', 'low', 'high', 'max'].includes(thinking)) throw new Error('INVALID_THINKING');
  const sections = (!env.AGENT_TOOLS || env.AGENT_TOOLS.trim() === '*' ? defaultTools.join(',') : env.AGENT_TOOLS).split(',').map(s => s.trim()).filter(Boolean);
  const flag = (name, fallback) => {
    const value = env[name] ?? fallback;
    if (!['0', '1'].includes(value)) throw new Error(`INVALID_CONFIG_${name}`);
    return value === '1';
  };
  return {
    baseUrl: base.href.replace(/\/$/, ''), model: env.DEEPSEEK_MODEL || 'deepseek-flash', thinking, sections,
    maxRounds: number('AGENT_MAX_ROUNDS', 6, 1, 20), maxTools: number('AGENT_MAX_TOOLS', 8, 1, 50),
    maxTokens: number('AGENT_MAX_OUTPUT_TOKENS', 2048, 64, 16384),
    // 每次模型调用都会重发约 2.5 万 Token 的系统提示和工具目录，预算须容纳 maxRounds 次调用。
    tokenBudget: number('AGENT_TOKEN_BUDGET', 200000, 1000, 2000000),
    turnTimeoutMs: number('AGENT_TURN_TIMEOUT_MS', 180000, 1000, 600000),
    requestTimeoutMs: number('AGENT_REQUEST_TIMEOUT_MS', 60000, 1000, 180000),
    contextChars: number('AGENT_CONTEXT_CHARS', 60000, 4000, 400000),
    autoSummary: flag('AGENT_AUTO_SUMMARY', '1'), keepTurns: number('AGENT_KEEP_TURNS', 2, 0, 10),
    restoreSession: flag('AGENT_RESTORE_SESSION', '1'), enableWrites: flag('AGENT_ENABLE_WRITES', '1'),
    enableMedia: flag('AGENT_ENABLE_MEDIA', '1'),
    stateDir: env.AGENT_STATE_DIR,
  };
}
