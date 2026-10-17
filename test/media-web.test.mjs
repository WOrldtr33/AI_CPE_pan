import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createMediaService } from '../media/service.mjs';
import { mediaConfig } from '../media/config.mjs';
import { attachWebAgent } from '../src/agent-web.mjs';
import { pcmWav } from '../media/omni.mjs';

async function fixture(fn) {
  await mkdir(new URL('../.media-state/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.media-state/web-test-', import.meta.url));
  const env = { MEDIA_STATE_DIR: directory, MEDIA_PORT: '0', MEDIA_FFMPEG_PATH: 'missing-ffmpeg', AGENT_STATE_DIR: join(directory, 'agent'), AGENT_TOOLS: 'version', AGENT_ENABLE_WRITES: '0' };
  const settings = mediaConfig({ ...env, MEDIA_VISION_BASE_URL: 'https://mock.invalid/v1', MEDIA_VISION_MODEL: 'mock-vision', MEDIA_VISION_API_KEY: 'mock-key', MEDIA_ASR_BASE_URL: 'https://mock.invalid/v1', MEDIA_ASR_MODEL: 'mock-asr', MEDIA_ASR_API_KEY: 'mock-key' });
  const service = await createMediaService(settings, { fetchImpl: async url => url.endsWith('audio/transcriptions') ? Response.json({ text: '虚构语音问题' }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: '虚构红色设备' } }] }) });
  const origin = (await service.listen()).split('/#')[0];
  const post = (route, body, options = {}) => fetch(`${origin}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${service.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options });
  try { await fn({ service, env, origin, post }); }
  finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
}

test('Web assets are served under CSP; chat requires authentication, Agent connection and valid bounded input', () => fixture(async ({ service, origin, post }) => {
  const html = await fetch(origin), css = await fetch(`${origin}/style.css`);
  assert(html.headers.get('Content-Security-Policy').includes("script-src 'self'"));
  // HTTP 200 不代表浏览器会应用 CSS；页面策略必须允许同源外部样式表。
  const styleSources = html.headers.get('Content-Security-Policy').split(';').map(v => v.trim()).find(v => v.startsWith('style-src ')).split(/\s+/).slice(1);
  assert(styleSources.includes("'self'"), 'Page CSP must allow the linked same-origin stylesheet');
  assert((await html.text()).includes('AI CPE')); assert(css.headers.get('Content-Type').startsWith('text/css'));
  assert.equal((await post('/api/chat', { text: 'hello' }, { headers: {} })).status, 401);
  assert((await (await post('/api/chat', { text: 'hello' })).json()).error.startsWith('MEDIA_AGENT_NOT_CONNECTED'));
  let calls = 0; service.setChatHandler(async () => { calls++; return { status: 'answered', answer: 'mock' }; });
  for (const body of [{ text: '' }, { text: 'x'.repeat(4001) }, { text: 'hello', command: 'approve' }, { text: 'hello', assetId: '../../credentials-agent.json' }]) assert.equal((await post('/api/chat', body)).status, 400);
  assert.equal(calls, 0);
}));

test('Browser text, photo and audio requests reach the existing Agent; photo analysis uses real MCP and audio transcribes before reasoning', () => fixture(async ({ service, env, post }) => {
  const sent = [], web = await attachWebAgent(service, env, { log: { event() {} }, api: { complete: async messages => {
    sent.push(structuredClone(messages));
    const last = messages.at(-1);
    if (last.role === 'user' && last.content.includes('图片素材 ID')) {
      const id = last.content.match(/图片素材 ID ([a-f0-9-]+)/)[1];
      return { message: { role: 'assistant', tool_calls: [{ id: 'analyze-photo', type: 'function', function: { name: 'media_analyze_image', arguments: JSON.stringify({ assetId: id, question: '描述颜色' }) } }] } };
    }
    return { message: { role: 'assistant', content: last.role === 'tool' ? JSON.parse(last.content).text : `模拟回答：${last.content}` } };
  } } });
  try {
    assert.equal((await service.dispatch('media_status', {})).agentConnected, true);
    assert((await (await post('/api/chat', { text: '你好' })).json()).answer.includes('你好'));
    const photo = await service.store.put(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64'));
    assert.equal((await (await post('/api/chat', { text: '什么颜色？', assetId: photo.id })).json()).answer, '虚构红色设备');
    const audio = await service.store.put(pcmWav(Buffer.alloc(32000), 16000));
    assert((await (await post('/api/chat', { text: '', assetId: audio.id })).json()).answer.includes('虚构语音问题'));
    const serialized = JSON.stringify(sent); assert(!serialized.includes('base64')); assert(!serialized.includes('mock-key'));
    assert((await (await post('/api/chat', { text: '/approve example' })).json()).answer.includes('/approve example'));
  } finally { await web.close(); }
  assert.equal((await service.dispatch('media_status', {})).agentConnected, false);
}));

test('Web chat rejects concurrent turns and disconnect cancels work rather than replaying requests', () => fixture(async ({ service, post }) => {
  let began, finished; const started = new Promise(r => { began = r; }), ended = new Promise(r => { finished = r; }); let calls = 0;
  service.setChatHandler(async (_, signal) => {
    calls++; began(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); finished(); return { status: 'error', error: 'CALL_CANCELLED' };
  });
  const controller = new AbortController(); const pending = post('/api/chat', { text: '虚构测试' }, { signal: controller.signal }).catch(e => e);
  await started; assert.equal((await (await post('/api/chat', { text: 'second' })).json()).error, 'MEDIA_AGENT_BUSY');
  controller.abort(); await pending; await ended; assert.equal(calls, 1);
}));
