// 显式运行才调用云端：仅发送本脚本生成的演示图片与合成语音。
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createMediaService } from '../media/service.mjs';
import { mediaConfig } from '../media/config.mjs';
import { loadMediaCredentials } from '../media/credentials.mjs';
import { timestamp } from '../src/time.mjs';
import { root } from '../src/agent-config.mjs';
import { deflateSync } from 'node:zlib';
function syntheticPng() {
  const chunk = (name, data) => {
    const type = Buffer.from(name), input = Buffer.concat([type, data]); let crc = 0xffffffff;
    for (const byte of input) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), check = Buffer.alloc(4); size.writeUInt32BE(data.length); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, input, check]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(64 * (1 + 64 * 3));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const p = y * 193 + 1 + x * 3; pixels[p] = 255; pixels[p + 1] = 32; pixels[p + 2] = 32; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const settings = mediaConfig(loadMediaCredentials());
const service = await createMediaService(settings);
const report = { at: timestamp(), model: settings.providers.vision.model, baseUrl: settings.providers.vision.baseUrl, syntheticOnly: true, results: [] };
try {
  const photo = await service.store.put(syntheticPng(), 'synthetic-smoke');
  try {
    const result = await service.dispatch('media_analyze_image', { assetId: photo.id, question: '这是一张虚构测试图片，请简要描述它的颜色。' });
    report.results.push({ tool: 'media_analyze_image', status: result.status, text: result.text }); console.log('Vision: passed');
    const speech = await service.dispatch('media_synthesize_speech', { text: '这是虚构演示测试。今天阳光很好。' });
    report.results.push({ tool: 'media_synthesize_speech', status: speech.status, bytes: speech.asset.bytes, sampleRate: speech.asset.sampleRate }); console.log('Speech: passed');
    try {
      const transcript = await service.dispatch('media_transcribe', { assetId: speech.asset.id });
      report.results.push({ tool: 'media_transcribe', status: transcript.status, text: transcript.text }); console.log('Transcription: passed');
    } finally { await service.store.remove(speech.asset.id); }
  } finally { await service.store.remove(photo.id); }
} catch (error) {
  report.results.push({ status: 'failed', error: /^MEDIA_[A-Z0-9_]+$/.test(error.message) ? error.message : 'MEDIA_LIVE_SMOKE_FAILED' });
  console.log(report.results.at(-1).error); process.exitCode = 1;
} finally {
  await service.close(); await mkdir(join(root, 'reports/live'), { recursive: true });
  await writeFile(join(root, 'reports/live/media-live-results.json'), JSON.stringify(report, null, 2) + '\n');
}
