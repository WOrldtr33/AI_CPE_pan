import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { Agent } from '../src/agent-core.mjs';
import { ModelApi } from '../src/agent-api.mjs';
import { config } from '../src/agent-config.mjs';
import { connectTools, deviceEnvironment } from '../src/agent-mcp.mjs';
import { sanitizer } from '../src/agent-log.mjs';
import { spawn } from 'node:child_process';

const settings = { ...config({}), maxRounds: 4, turnTimeoutMs: 5000 };
const request = (id = 'c1', name = 't830_get_version', args = '{}') => ({ id, type: 'function', function: { name, arguments: args } });
const answer = content => ({ message: { role: 'assistant', content }, usage: { total_tokens: 12 } });
const tools = [{ type: 'function', function: { name: 't830_get_version', parameters: { type: 'object' } } }];
function fixture(responses, call = async () => ({ status: 'returned', data: { version: 'mock-v1' } }), overrides = {}) {
  const sent = [], executed = [], events = [];
  const agent = new Agent({ settings: { ...settings, ...overrides },
    api: { complete: async messages => { sent.push(structuredClone(messages)); const next = responses.shift(); if (next instanceof Error) throw next; return typeof next === 'function' ? next(messages) : next; } },
    mcp: { definitions: tools, call: async (...args) => { executed.push(args); return call(...args); } },
    sanitize: sanitizer(['private-key']), onEvent: e => events.push(e),
  });
  return { agent, sent, executed, events };
}

test('Agent tool loop preserves call IDs and reasoning; multi-turn and clear work', async () => {
  const f = fixture([{ message: { role: 'assistant', content: null, reasoning_content: 'internal', tool_calls: [request()] }, usage: { total_tokens: 20 } }, answer('版本 mock-v1'), answer('后续答复')]);
  const result = await f.agent.turn('版本？');
  assert.equal(result.answer, '版本 mock-v1'); assert.equal(result.tokens, 32);
  assert.equal(f.executed.length, 1);
  assert.equal(f.sent[1][2].reasoning_content, 'internal');
  assert.equal(f.sent[1][3].tool_call_id, 'c1');
  await f.agent.turn('再说一次'); assert.equal(f.sent[2].at(-1).content, '再说一次');
  f.agent.clear(); assert.equal(f.agent.messages.length, 1);
  assert(!JSON.stringify(f.events).includes('internal'));
});

test('Unlisted writes and malformed JSON never execute; all tool replies correlate', async () => {
  const f = fixture([{ message: { role: 'assistant', tool_calls: [request('a', 't830_set_upnp'), request('b', 't830_get_version', '{')] } }, answer('无法执行')]);
  await f.agent.turn('修改'); assert.equal(f.executed.length, 0);
  assert.equal(JSON.parse(f.sent[1][3].content).error, 'TOOL_NOT_ALLOWED');
  assert.equal(JSON.parse(f.sent[1][4].content).error, 'INVALID_TOOL_ARGUMENTS');
});

test('Repeated device errors are cached per turn and do not dispatch twice', async () => {
  const f = fixture([{ message: { role: 'assistant', tool_calls: [request('a'), request('b')] } }, answer('查询失败')], async () => { throw new Error('DEVICE_TIMEOUT'); });
  await f.agent.turn('查版本'); assert.equal(f.executed.length, 1);
  assert.equal(JSON.parse(f.sent[1][3].content).error, 'DEVICE_TIMEOUT');
});

test('Tool and round limits stop before dispatch and roll back incomplete history', async () => {
  for (const overrides of [{ maxTools: 1 }, { maxRounds: 1 }]) {
    const f = fixture([{ message: { role: 'assistant', tool_calls: [request('a'), request('b')] } }], undefined, overrides);
    await assert.rejects(f.agent.turn('查询'), /TOOL_CALL_LIMIT|MODEL_ROUND_LIMIT/);
    assert.equal(f.executed.length, 0); assert.equal(f.agent.messages.length, 1);
  }
});

test('Cancellation, context and usage limits leave recoverable history', async () => {
  const cancelled = fixture([]); const controller = new AbortController(); controller.abort();
  await assert.rejects(cancelled.agent.turn('查', controller.signal), /CALL_CANCELLED/);
  assert.equal(cancelled.agent.messages.length, 1);
  const context = fixture([], undefined, { contextChars: 10 });
  await assert.rejects(context.agent.turn('查'), /CONTEXT_LIMIT/);
  const budget = fixture([{ message: { role: 'assistant', tool_calls: [request()] }, usage: { total_tokens: 1000 } }], undefined, { tokenBudget: 1000 });
  await assert.rejects(budget.agent.turn('查'), /TOKEN_BUDGET_LIMIT/); assert.equal(budget.executed.length, 0);
});

test('Secrets are removed from logs, strings, device data and AI field names', () => {
  const clean = sanitizer(['private-key']);
  const value = clean({ api_key: 'anything', Authorization: 'Bearer xyz', password: 'pw', content: 'private-key sk-example123', data: { ssid: 'wifi', reasoning_content: 'hidden' } });
  assert(!JSON.stringify(value).includes('private-key'));
  assert.equal(value.Authorization, '[REDACTED]'); assert.equal(value.data.ssid, '[REDACTED]');
  assert.equal(value.content, '[REDACTED] [REDACTED]');
  const usage = clean({ tokens: 42, usage: { total_tokens: 42, prompt_tokens: 30, completion_tokens: 12 }, token: 'secret' });
  assert.equal(usage.tokens, 42); assert.equal(usage.usage.total_tokens, 42); assert.equal(usage.token, '[REDACTED]');
});

test('MCP child environment excludes AI credentials and forces writes off', () => {
  const env = deviceEnvironment({ DEEPSEEK_API_KEY: 'secret', T830_PASSWORD: 'device', T830_ENABLE_WRITES: '1', PATH: 'runtime' });
  assert.equal(env.DEEPSEEK_API_KEY, undefined); assert.equal(env.T830_PASSWORD, 'device');
  assert.equal(env.T830_ENABLE_WRITES, '0');
  assert.throws(() => config({ DEEPSEEK_BASE_URL: 'http://example.com' }), /INVALID_API_URL/);
  assert.throws(() => config({ AGENT_MAX_ROUNDS: '0' }), /INVALID_CONFIG/);
});

test('Model API handles 401 without retries and 429 with one retry; never exposes response secrets', async () => {
  let calls = 0;
  const unauthorized = new ModelApi({ apiKey: 'test', baseUrl: 'https://mock.invalid', fetchImpl: async () => { calls++; return new Response('secret response', { status: 401 }); } });
  await assert.rejects(unauthorized.models(), /AI_HTTP_401/); assert.equal(calls, 1);
  calls = 0;
  const retry = new ModelApi({ apiKey: 'test', baseUrl: 'https://mock.invalid', fetchImpl: async () => ++calls === 1 ? new Response('', { status: 429 }) : Response.json({ data: [{ id: 'test-model' }] }) });
  assert.deepEqual(await retry.models(), ['test-model']); assert.equal(calls, 2);
});

test('Model API preserves timeout through body parsing and rejects truncated output', async () => {
  const api = new ModelApi({ apiKey: 'test', baseUrl: 'https://mock.invalid', fetchImpl: async () => Response.json({ choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }] }) });
  await assert.rejects(api.complete([], tools, settings), /AI_OUTPUT_LIMIT/);
  const timeout = new ModelApi({ apiKey: 'test', baseUrl: 'https://mock.invalid', requestTimeoutMs: 20,
    fetchImpl: async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')))) });
  const keepAlive = setTimeout(() => {}, 100);
  try { await assert.rejects(timeout.models(), /AI_REQUEST_TIMEOUT/); } finally { clearTimeout(keepAlive); }
});

test('HTTP model simulator → Agent → real MCP stdio → simulated T830 → final answer', async () => {
  const samples = JSON.parse(await readFile(new URL('./fixtures/read-responses.json', import.meta.url), 'utf8'));
  let deviceCalls = 0, modelCalls = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/cgi-bin/upgrade-set.lua')) { deviceCalls++; res.end(JSON.stringify(samples.version)); return; }
    if (req.url === '/chat/completions') {
      const payload = JSON.parse(body); modelCalls++;
      assert.equal(payload.thinking.type, 'disabled');
      assert(payload.tools.every(t => t.function.name.startsWith('t830_get_')));
      if (modelCalls === 1) res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [request()] }, finish_reason: 'tool_calls' }], usage: { total_tokens: 25 } }));
      else {
        const result = JSON.parse(payload.messages.at(-1).content);
        assert.equal(result.status, 'returned'); assert.equal(payload.messages.at(-1).tool_call_id, 'c1');
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '已读取模拟设备固件版本。' }, finish_reason: 'stop' }], usage: { total_tokens: 30 } }));
      }
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let mcp;
  try {
    mcp = await connectTools(['version'], { ...process.env, T830_BASE_URL: base, T830_PASSWORD: 'mock-only' });
    const api = new ModelApi({ apiKey: 'mock-only', baseUrl: base });
    const agent = new Agent({ api, mcp, settings });
    const result = await agent.turn('查询版本');
    assert.equal(result.answer, '已读取模拟设备固件版本。');
    assert.equal(deviceCalls, 1); assert.equal(modelCalls, 2); assert.equal(result.tokens, 55);
    await assert.rejects(mcp.call('t830_set_upnp', {}), /TOOL_NOT_ALLOWED/);
    await assert.rejects(mcp.call('t830_get_version', { unexpected: true }), /INVALID_TOOL_ARGUMENTS/);
  } finally { await mcp?.close(); await new Promise(resolve => server.close(resolve)); }
});

test('CLI piped interaction handles commands, model switch, clear and a mocked answer', async () => {
  await mkdir(new URL('../.agent-state/', import.meta.url), { recursive: true });
  const stateDir = await mkdtemp(new URL('../.agent-state/test-cli-', import.meta.url));
  const program = `
    globalThis.fetch = async (url) => String(url).endsWith('/models')
      ? Response.json({ data: [{ id: 'deepseek-flash' }, { id: 'test-model' }] })
      : Response.json({ choices: [{ message: { role: 'assistant', content: '模拟交互成功' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } });
    await import('./scripts/agent.mjs');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, DEEPSEEK_API_KEY: 'mock-only', DEEPSEEK_MODEL: 'deepseek-flash', AGENT_TOOLS: 'version', AGENT_STATE_DIR: stateDir, AGENT_ENABLE_WRITES: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdin.end('/tools\n/models\n/model test-model\n/thinking low\n/status\n/remember 回答请用简体中文\n/memory\n/tasks\n/summary\n/clear\n你好\n/exit\n');
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(status, 0, errors);
  assert.match(output, /t830_get_version/, errors); assert.match(output, /模型已切换：test-model/, errors);
  assert.match(output, /思考模式：low/); assert.match(output, /模拟交互成功/);
  assert(!output.includes('mock-only'));
  assert.match(output, /已保存记忆/);
  await rm(stateDir, { recursive: true, force: true });
});
