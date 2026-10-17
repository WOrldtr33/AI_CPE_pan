import { existsSync } from 'node:fs';
import { createMediaService } from '../media/service.mjs';
import { root } from '../src/agent-config.mjs';
import { join } from 'node:path';
import { loadMediaCredentials } from '../media/credentials.mjs';
import { mediaConfig } from '../media/config.mjs';
import { attachWebAgent } from '../src/agent-web.mjs';
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const service = await createMediaService(mediaConfig(loadMediaCredentials()));
let webAgent;
try {
  const address = await service.listen();
  if (process.argv.includes('--agent')) webAgent = await attachWebAgent(service);
  console.log(`${webAgent ? '网页 Agent' : '媒体服务'}（仅本机）：${address}\n页面保持打开。语音交流独立开启；拍照和监测均需确认。Ctrl+C 退出。`);
} catch (error) { await service.close(); throw error; }
let closing;
const close = () => closing ||= (async () => { try { await webAgent?.close(); } finally { await service.close(); } })().catch(() => { process.exitCode = 1; });
process.once('SIGINT', close); process.once('SIGTERM', close);
