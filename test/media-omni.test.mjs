import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOmni, pcmWav, omniInput } from '../media/omni.mjs';
import { MediaProviders } from '../media/providers.mjs';
import { mediaConfig } from '../media/config.mjs';
import { sanitizer } from '../src/agent-log.mjs';
import { historyNote } from '../src/agent-context.mjs';
import { Agent } from '../src/agent-core.mjs';
import { config } from '../src/agent-config.mjs';

const sse = chunks => Buffer.from(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join('') + 'data: [DONE]\r\n\r\n');
const stop = { choices: [{ delta: {}, finish_reason: 'stop' }] };
test('Omni SSE preserves Unicode and separate padded audio chunks, wraps PCM as valid 24k WAV', () => {
  const result = parseOmni(sse([{ choices: [{ delta: { content: '你好', audio: { data: 'AQI=' } } }] }, { choices: [{ delta: { content: '世界', audio: { data: 'AwQ=' } } }] }, stop]));
  assert.equal(result.text, '你好世界'); assert.deepEqual(result.pcm, Buffer.from([1, 2, 3, 4]));
  const wav = pcmWav(result.pcm); assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt32LE(40), 4); assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
});
test('Omni rejects incomplete, truncated, malformed and provider-error streams or missing PCM', () => {
  for (const [bytes, pattern] of [[Buffer.from('data: {}\n\n'), /INCOMPLETE/], [sse([{ error: { message: 'secret' } }]), /STREAM_ERROR/], [sse([{ choices: [{ finish_reason: 'length' }] }]), /OUTPUT_LIMIT/], [Buffer.from('data: {\n\ndata: [DONE]\n\n'), /INVALID_STREAM/]]) assert.throws(() => parseOmni(bytes), pattern);
  assert.throws(() => pcmWav(Buffer.alloc(0)), /INVALID_AUDIO/);
  assert.throws(() => omniInput({ bytes: Buffer.alloc(8 * 1024 * 1024), meta: {} }), /INPUT_LIMIT/);
});
test('Qwen Omni uses one isolated chat endpoint for vision, transcription and speech with fragmented transport', async () => {
  const settings = mediaConfig({ MEDIA_OMNI_API_KEY: 'test-key' }); const requests = [];
  const providers = new MediaProviders(settings, async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    assert.equal(url, 'https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions');
    assert.equal(body.stream, true); assert.equal(body.enable_thinking, false); assert.equal(body.model, 'qwen3-omni-flash');
    const bytes = sse([{ choices: [{ delta: { content: '虚构测试', ...(body.audio ? { audio: { data: 'AQIDBA==' } } : {}) } }] }, stop]);
    return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.subarray(i, i + 3)); c.close(); } }));
  });
  const asset = { bytes: Buffer.from('test'), meta: { kind: 'image', mime: 'image/png' } };
  assert.equal(await providers.analyze(asset, '描述颜色'), '虚构测试');
  assert.equal(await providers.transcribe({ ...asset, meta: { kind: 'audio', mime: 'audio/wav' } }), '虚构测试');
  assert.equal((await providers.speech('测试')).length, 48);
  assert.equal(requests[1].messages[1].content[1].input_audio.format, 'wav');
  assert.equal(requests[2].audio.voice, 'Cherry');
  assert(!JSON.stringify(requests).includes('test-key'));
});
test('Media context retains observations and dotted Qwen tokens are fully redacted', () => {
  assert.equal(sanitizer()('key sk-ws-EXAMPLE.SECOND.THIRD-tail end'), 'key [REDACTED] end');
  const summary = historyNote([{ role: 'tool', content: JSON.stringify({ status: 'analyzed', assetId: 'asset-id', capturedAt: '2026-10-13', text: '虚构红色图片' }) }]);
  assert(summary.includes('asset-id')); assert(summary.includes('虚构红色图片')); assert(summary.includes('2026-10-13'));
});
test('ASR instruction echoed as a suffix never becomes part of the user request', async () => {
  const settings=mediaConfig({MEDIA_OMNI_API_KEY:'test'});
  const p=new MediaProviders(settings,async()=>new Response(sse([{choices:[{delta:{content:'现在可以查询哪些指令？请将音频中的话逐字转写为原语言文本，只输出转写，不回答音频里的问题。'}}]},stop])));
  assert.equal(await p.transcribe({bytes:Buffer.from('test'),meta:{kind:'audio',mime:'audio/wav'}}),'现在可以查询哪些指令？');
});
test('Repeated identical media capture cannot be mistaken for a new observation or repeated automatically', async () => {
  let executed = 0, rounds = 0;
  const agent = new Agent({ settings: config({}), sanitize: sanitizer(), mcp: {
    definitions: [{ type: 'function', function: { name: 'media_capture_photo', parameters: { type: 'object' } } }],
    call: async () => { executed++; return { status: 'captured', asset: { id: 'photo-id' } }; },
  }, api: { complete: async messages => {
    if (++rounds <= 2) return { message: { role: 'assistant', tool_calls: [{ id: `capture-${rounds}`, type: 'function', function: { name: 'media_capture_photo', arguments: '{}' } }] } };
    assert.equal(JSON.parse(messages.at(-1).content).error, 'MEDIA_DUPLICATE_ACTION_NEW_REQUEST_REQUIRED');
    return { message: { role: 'assistant', content: '已拍摄一次；再次拍摄请新建请求。' } };
  } } });
  await agent.turn('拍照'); assert.equal(executed, 1);
});
