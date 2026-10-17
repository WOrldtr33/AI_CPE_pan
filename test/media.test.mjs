import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createMediaService } from '../media/service.mjs';
import { mediaConfig } from '../media/config.mjs';
import { MediaClient } from '../src/media-client.mjs';
import { connectTools, deviceEnvironment } from '../src/agent-mcp.mjs';
import { Agent } from '../src/agent-core.mjs';
import { config } from '../src/agent-config.mjs';
import { createLog, sanitizer } from '../src/agent-log.mjs';

function wav() {
  const b = Buffer.alloc(44 + 32000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40); return b;
}
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64');
async function fixture(fn, { configured = false, fetchImpl, maxAssets = '100' } = {}) {
  await mkdir(new URL('../.media-state/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.media-state/test-', import.meta.url));
  const env = { MEDIA_STATE_DIR: directory, MEDIA_PORT: '0', MEDIA_FFMPEG_PATH: 'missing-demo-ffmpeg', MEDIA_MAX_ASSETS: maxAssets };
  if (configured) for (const kind of ['ASR', 'TTS', 'VISION']) Object.assign(env, { [`MEDIA_${kind}_BASE_URL`]: 'https://mock.invalid/v1', [`MEDIA_${kind}_MODEL`]: `demo-${kind}`, [`MEDIA_${kind}_API_KEY`]: 'mock-provider-key' });
  const requests = [];
  const service = await createMediaService(mediaConfig(env), { fetchImpl: fetchImpl || (async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('audio/transcriptions')) { assert(options.body instanceof FormData); assert.equal(options.body.get('file').type, 'audio/wav'); return Response.json({ text: '查询设备版本' }); }
    if (url.endsWith('audio/speech')) return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
    const body = JSON.parse(options.body); assert(body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,'));
    return Response.json({ choices: [{ message: { content: '虚构测试图片：一台演示设备。' }, finish_reason: 'stop' }] });
  }) });
  const address = await service.listen(), origin = address.split('/#')[0], client = new MediaClient(env);
  const post = (route, body, extra = {}) => fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.token}`, ...extra }, body: JSON.stringify(body) });
  try { await fn({ env, directory, service, client, requests, post, origin }); }
  finally { await service.close(); await rm(directory, { recursive: true, force: true }); }
}

test('Media starts without keys, reports missing providers and accepts real-format assets', () => fixture(async ({ client, service }) => {
  const status = await client.call('media_status', {}); assert.equal(status.providers.asr.configured, false); assert.equal(status.ffmpegAvailable, false); assert.equal(status.terminalConnected, false);
  const audio = await service.store.put(wav()), photo = await service.store.put(image);
  assert.equal(audio.sampleRate, 16000); assert.equal(photo.kind, 'image');
  const list = await client.call('media_list_assets', {}); assert.equal(list.assets.length, 2); assert(!JSON.stringify(list).includes('base64'));
  await assert.rejects(client.call('media_transcribe', { assetId: audio.id }), /MEDIA_ASR_NOT_CONFIGURED/);
  await assert.rejects(client.call('media_analyze_image', { assetId: photo.id, question: '是什么？' }), /MEDIA_VISION_NOT_CONFIGURED/);
  await assert.rejects(client.call('media_synthesize_speech', { text: '你好' }), /MEDIA_TTS_NOT_CONFIGURED/);
}));

test('Media API rejects unauthorized/cross-origin calls, invalid files and traversal', () => fixture(async ({ post, client, service, origin }) => {
  assert.equal((await post('/api/call', { name: 'media_status', args: {} }, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await post('/api/call', { name: 'media_status', args: {} }, { Origin: 'https://foreign.invalid' })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const req = request(origin, { headers: { Host: 'foreign.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.once('error', reject); req.end(); });
  assert.equal(hostStatus, 403);
  await assert.rejects(service.store.put(Buffer.from('not-media')), /UNSUPPORTED_FORMAT/);
  const broken = wav(); broken.writeUInt32LE(9999999, 40); await assert.rejects(service.store.put(broken), /INVALID_WAV/);
  await assert.rejects(client.call('media_transcribe', { assetId: '../../credentials-agent.json' }), /INVALID_TOOL_ARGUMENTS/);
  await assert.rejects(service.store.get(randomUUID()), /ASSET_NOT_FOUND/);
  assert.equal((await post('/api/upload', { data: '%%%=' })).status, 400);
  const body = await (await post('/api/upload', { data: wav().toString('base64') })).json(); assert.equal(body.status, 'stored');
  assert(!JSON.stringify(await client.call('media_status', {})).includes(service.token));
}));

test('Concurrent media storage enforces quota and normalizing valid WAV does not require FFmpeg', () => fixture(async ({ service, client }) => {
  const results = await Promise.allSettled([service.store.put(wav()), service.store.put(image)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await service.store.list()).length, 1);
  const asset = results.find(r => r.status === 'fulfilled').value;
  assert.equal((await client.call('media_normalize_audio', { assetId: asset.id })).asset.id, asset.id);
  await assert.rejects(client.call('media_extract_frame', { assetId: asset.id, seconds: 0 }), /MEDIA_INVALID_TOOL_ARGUMENTS/);
}, { maxAssets: '1' }));

test('Configured ASR, vision and TTS adapters exchange media only with provider and return compact results', () => fixture(async ({ service, client, requests }) => {
  const audio = await service.store.put(wav()), photo = await service.store.put(image);
  assert.equal((await client.call('media_transcribe', { assetId: audio.id })).text, '查询设备版本');
  const analysis = await client.call('media_analyze_image', { assetId: photo.id, question: '描述测试画面' }); assert.equal(analysis.status, 'analyzed');
  const speech = await client.call('media_synthesize_speech', { text: '测试答复' }); assert.equal(speech.asset.kind, 'audio');
  assert.equal(requests.length, 3); assert(requests.every(r => r.options.redirect === 'error'));
  assert(!JSON.stringify(analysis).includes('data:image')); assert(!JSON.stringify(speech).includes('mock-provider-key'));
}, { configured: true }));

test('Provider errors never expose provider response secrets and are never automatically retried', () => fixture(async ({ client }) => {
  await assert.rejects(client.call('media_synthesize_speech', { text: '测试' }), error => error.message === 'MEDIA_PROVIDER_HTTP_401');
}, { configured: true, fetchImpl: async () => new Response('secret-key-in-provider-error', { status: 401 }) }));

test('Retired video upload and extraction are rejected at the service boundary', () => fixture(async ({ post, client }) => {
  const bytes = Buffer.alloc(32); bytes.write('ftyp', 4); bytes.write('isom', 8);
  const response = await post('/api/upload', { data: bytes.toString('base64') });
  assert.equal(response.status, 400); assert.equal((await response.json()).error, 'MEDIA_VIDEO_UPLOAD_DISABLED');
  await assert.rejects(client.call('media_extract_frame', { assetId: randomUUID(), seconds: 0 }), /MEDIA_INVALID_TOOL_ARGUMENTS/);
}));

test('Interrupted media side effects cannot be replayed by task resume', async () => {
  const task = { status: 'interrupted', steps: [{ name: 'media_record_audio', state: 'started' }] };
  const agent = new Agent({ api: {}, mcp: {}, settings: config({}), store: { session: () => null, memories: () => [], task: () => task } });
  await assert.rejects(agent.resume(randomUUID()), /MEDIA_TASK_REQUIRES_NEW_REQUEST/);
});

test('Browser terminal commands require arming, execute once and stop/play status is acknowledged', () => fixture(async ({ client, post, service }) => {
  const terminalId = randomUUID(), audio = await service.store.put(wav());
  await assert.rejects(client.call('media_record_audio', { seconds: 1 }), /TERMINAL_NOT_READY/);
  await post('/api/terminal/poll', { terminalId, armed: true });
  const playing = client.call('media_play_audio', { assetId: audio.id });
  let command;
  for (let i = 0; i < 30 && !command; i++) { await new Promise(r => setTimeout(r, 5)); const poll = await (await post('/api/terminal/poll', { terminalId, armed: true })).json(); command = poll.commands[0]; }
  assert.equal(command.kind, 'play');
  assert.deepEqual((await (await post('/api/terminal/poll', { terminalId, armed: true })).json()).commands, []);
  await post('/api/terminal/result', { terminalId, id: command.id }); assert.equal((await playing).status, 'played');
  assert.equal((await post('/api/terminal/result', { terminalId, id: command.id })).status, 400);
  const recording = client.call('media_record_audio', { seconds: 1 });
  for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 5)); const poll = await (await post('/api/terminal/poll', { terminalId, armed: true })).json(); if (poll.commands.length) { command = poll.commands[0]; break; } }
  await post('/api/terminal/result', { terminalId, id: command.id, assetId: audio.id }); assert.equal((await recording).status, 'captured');
}));

test('Cancelled capture is removed and cannot be replayed by a later browser poll', () => fixture(async ({ client, post }) => {
  const terminalId = randomUUID(); await post('/api/terminal/poll', { terminalId, armed: true });
  const controller = new AbortController(), pending = client.call('media_capture_photo', {}, controller.signal);
  await new Promise(r => setTimeout(r, 20)); controller.abort(); await assert.rejects(pending, /CALL_CANCELLED/);
  await new Promise(r => setTimeout(r, 20)); const poll = await (await post('/api/terminal/poll', { terminalId, armed: true })).json(); assert.deepEqual(poll.commands, []); assert.deepEqual(poll.activeIds, []);
}));

test('Real MCP exposes media only when enabled and excludes provider keys from its environment', () => fixture(async ({ env, service }) => {
  const child = deviceEnvironment({ ...env, MEDIA_ASR_API_KEY: 'do-not-forward', DEEPSEEK_API_KEY: 'do-not-forward' }, false, true);
  assert.equal(child.MEDIA_ASR_API_KEY, undefined); assert.equal(child.DEEPSEEK_API_KEY, undefined); assert.equal(child.MEDIA_STATE_DIR, env.MEDIA_STATE_DIR);
  const mcp = await connectTools([], env, { enableMedia: true });
  try {
    assert.equal(mcp.definitions.length, 13); assert(mcp.definitions.every(t => t.function.name.startsWith('media_')));
    const audio = await service.store.put(wav());
    assert.equal((await mcp.call('media_transcribe', { assetId: audio.id })).error, 'MEDIA_ASR_NOT_CONFIGURED');
    assert.throws(() => mcp.validate('media_record_audio', { seconds: 99 }), /INVALID_TOOL_ARGUMENTS/);
    await assert.rejects(mcp.call('media_arbitrary_file', { path: 'credentials-agent.json' }), /TOOL_NOT_ALLOWED/);
  } finally { await mcp.close(); }
}));

test('Agent uses real MCP vision results without receiving raw images and media logs omit transcript text', () => fixture(async ({ env, service, directory }) => {
  const photo = await service.store.put(image), mcp = await connectTools([], env, { enableMedia: true });
  const log = createLog(join(directory, 'logs'), sanitizer());
  let count = 0;
  const agent = new Agent({ mcp, settings: config({}), onEvent: log.event,
    api: { async complete(messages) {
      count++;
      if (count === 1) return { message: { role: 'assistant', tool_calls: [{ id: 'image', type: 'function', function: { name: 'media_analyze_image', arguments: JSON.stringify({ assetId: photo.id, question: '测试图片内容' }) } }] } };
      const result = JSON.parse(messages.at(-1).content); assert.equal(result.status, 'analyzed'); assert(!messages.at(-1).content.includes('data:image'));
      return { message: { role: 'assistant', content: '已分析演示图片。' } };
    } },
  });
  try { assert.equal((await agent.turn('分析刚上传的演示图片')).calls, 1); const text = await readFile(log.path, 'utf8'); assert(!text.includes('虚构测试图片')); assert(text.includes('analyzed')); }
  finally { await mcp.close(); }
}, { configured: true }));

test('CLI image command uploads local file then model calls vision through real MCP', () => fixture(async ({ directory, env }) => {
  const file = join(directory, 'demo.png'); await writeFile(file, image);
  const program = `
    const originalFetch = globalThis.fetch; let turn = 0;
    globalThis.fetch = async (url, opts) => {
      if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, opts);
      if (String(url).endsWith('/models')) return Response.json({data:[{id:'deepseek-flash'}]});
      const body=JSON.parse(opts.body); let message;
      if (++turn===1) {const id=body.messages.at(-1).content.match(/[a-f0-9]{8}-[a-f0-9-]{27}/)[0];message={role:'assistant',tool_calls:[{id:'photo',type:'function',function:{name:'media_analyze_image',arguments:JSON.stringify({assetId:id,question:'描述图片'})}}]};}
      else {if(JSON.parse(body.messages.at(-1).content).status!=='analyzed')throw new Error('VISION_FAILED');message={role:'assistant',content:'CLI图片分析通过'};}
      return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{total_tokens:20}});
    }; await import('./scripts/agent.mjs');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { cwd: new URL('../', import.meta.url), env: { ...process.env, ...env, DEEPSEEK_API_KEY: 'mock-only', AGENT_TOOLS: 'version', AGENT_ENABLE_WRITES: '0', AGENT_ENABLE_MEDIA: '1', AGENT_STATE_DIR: join(directory, 'agent-state') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => errors += c);
  child.stdin.end(`/image "${file}"\n/exit\n`);
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(code, 0, errors); assert.match(output, /CLI图片分析通过/, errors);
}, { configured: true }));

test('CLI voice round trip records, transcribes, answers, synthesizes and acknowledges playback', () => fixture(async ({ directory, env, service, post, requests }) => {
  const terminalId = randomUUID(), audio = await service.store.put(wav()), kinds = [];
  await post('/api/terminal/poll', { terminalId, armed: true });
  let polling = false, pollError;
  const timer = setInterval(async () => {
    if (polling) return; polling = true;
    try {
      const response = await (await post('/api/terminal/poll', { terminalId, armed: true })).json();
      for (const c of response.commands) { kinds.push(c.kind); await post('/api/terminal/result', { terminalId, id: c.id, ...(c.kind === 'record' ? { assetId: audio.id } : {}) }); }
    } catch (e) { pollError = e; } finally { polling = false; }
  }, 10);
  const program = `
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async(url,opts)=>{
      if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,opts);
      if(String(url).endsWith('/models'))return Response.json({data:[{id:'deepseek-flash'}]});
      const body=JSON.parse(opts.body);if(body.messages.at(-1).content!=='查询设备版本')throw new Error('ASR_NOT_FORWARDED');
      return Response.json({choices:[{message:{role:'assistant',content:'语音闭环通过'},finish_reason:'stop'}],usage:{total_tokens:20}});
    };await import('./scripts/agent.mjs');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { cwd: new URL('../', import.meta.url), env: { ...process.env, ...env, DEEPSEEK_API_KEY: 'mock-only', AGENT_TOOLS: 'version', AGENT_ENABLE_WRITES: '0', AGENT_ENABLE_MEDIA: '1', AGENT_STATE_DIR: join(directory, 'agent-state') }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => errors += c);
  child.stdin.end('/voice on\n/listen 1\n/exit\n');
  try {
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    assert.equal(code, 0, errors); assert.match(output, /识别 > 查询设备版本/); assert.match(output, /语音闭环通过/); assert(!output.includes('播报未完成'));
    assert.deepEqual(kinds, ['record', 'play']); assert.equal(requests.length, 2); assert.equal(pollError, undefined);
  } finally { clearInterval(timer); while (polling) await new Promise(r => setTimeout(r, 5)); }
}, { configured: true }));
