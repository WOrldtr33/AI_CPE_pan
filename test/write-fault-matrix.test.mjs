import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writes, toolName } from '../src/catalog.mjs';
import { writeProfiles } from '../src/write-profiles.mjs';

const records = [];
const report = new URL('../reports/mock/write-fault-matrix-2026-10-20.json', import.meta.url);
const unverified = writes.filter(def => !writeProfiles[def.key]);

async function fixture(run) {
  let mode = 'ok';
  const calls = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const multipart = request.headers['content-type']?.startsWith('multipart/');
    const body = text && !multipart ? JSON.parse(text) : {};
    const path = new URL(request.url, 'http://mock').pathname;
    response.setHeader('Content-Type', 'application/json');
    const send = value => response.end(JSON.stringify(value));
    // 续期登录使用随机 salt；login 工具样例的 salt 固定为 'salt'，仍按当前模式应答。
    if ((mode === 'bootstrap' || (mode === 'denied' && body.salt !== 'salt')) && path.endsWith('action_login')) {
      response.setHeader('Set-Cookie', 'sysauth_http=mock-session; Path=/');
      return send({ code: 0, sessionid: 'mock-session' });
    }
    calls.push({ path, body, multipart });
    if (mode === 'lost') return response.destroy();
    if (mode === 'denied') {
      response.statusCode = 403;
      response.setHeader('x-luci-login-required', 'yes');
      return send({});
    }
    const data = mode === 'warning' ? { code: 409 } : { code: 0 };
    return send(path === '/ubus/' ? { result: [0, data] } : data);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new Client({ name: 'write-fault-matrix', version: '1' });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
      env: {
        T830_BASE_URL: `http://127.0.0.1:${server.address().port}`,
        T830_PASSWORD: 'mock-only', T830_ENABLE_WRITES: '1',
        T830_AUTH_MODE: 'admin', T830_AUTH_TRANSPORT: 'cgi',
        T830_TIMEOUT_MS: '500', T830_COOKIE_MODE: 'always',
      },
      stderr: 'inherit',
    }));
    await run({ client, calls, setMode: value => { mode = value; } });
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const output = response => response.structuredContent || JSON.parse(response.content.find(part => part.type === 'text').text);

test('every write rejects extra fields at the MCP boundary before device access', () => fixture(async ({ client, calls }) => {
  for (const def of writes) {
    const before = calls.length;
    const response = await client.callTool({ name: toolName(def), arguments: { ...def.sample, unexpected: true } });
    assert.equal(response.isError, true, def.key);
    assert.equal(calls.length, before, def.key);
    records.push({ tool: toolName(def), scenario: 'invalid_arguments', passed: true, deviceRequests: 0 });
  }
}));

for (const mode of ['ok', 'warning', 'denied', 'lost']) {
  test(`all one-shot writes: ${mode} does not replay dangerous operations`, () => fixture(async ({ client, calls, setMode }) => {
    setMode('bootstrap');
    const capabilities = await client.listTools();
    assert(capabilities.tools.some(tool => tool.name === 't830_set_factory_reset'));
    const shape = schema => schema.innerType ? shape(schema.innerType()) : schema.shape || {};
    for (const def of writes.filter(def => Object.keys(shape(def.schema)).length))
      assert(Object.keys(capabilities.tools.find(tool => tool.name === toolName(def)).inputSchema.properties || {}).length, toolName(def));
    assert.deepEqual(Object.keys(capabilities.tools.find(tool => tool.name === 't830_set_net_probe').inputSchema.properties).sort(), ['addr', 'jump', 'time', 'type']);
    const mismatched = await client.callTool({ name: 't830_set_sms_send', arguments: { addr: '10086', content: 'dGVzdA==', format: '2', myContent: 'b3RoZXI=' } });
    assert.equal(mismatched.isError, true);
    assert.equal(output(mismatched).error, 'INVALID_ARGUMENTS');
    const bootstrap = await client.callTool({ name: 't830_set_backup_delete', arguments: { path: '/tmp/backup.tar.gz' } });
    assert.equal(output(bootstrap).status, 'submitted');
    setMode(mode);
    for (const def of [...unverified.filter(def => def.key !== 'logout'), ...unverified.filter(def => def.key === 'logout')]) {
      const before = calls.length;
      const response = await client.callTool({ name: toolName(def), arguments: def.sample });
      const result = output(response);
      const targetCalls = calls.slice(before).filter(call => def.transport === 'ubus'
        ? call.body.params?.[1] === def.service && call.body.params?.[2] === def.method
        : call.path === def.path);
      // 只有设备明确要求登录时，才续期后重发一次；其他故障均不重发。
      const expected = mode === 'denied' && def.auth !== false ? 2 : 1;
      assert.equal(targetCalls.length, expected, `${mode}: ${def.key}`);
      assert.equal(calls.length - before, expected, `no hidden replay: ${def.key}`);
      assert.equal(result.status, mode === 'ok' ? 'submitted' : mode === 'warning' ? 'device_warning' : 'error', def.key);
      if (mode === 'warning') assert(result.warnings.some(warning => warning.value === 409), def.key);
      if (mode === 'denied') assert.equal(result.error, 'HTTP_403', def.key);
      if (mode === 'lost') assert.equal(result.error, 'DEVICE_UNREACHABLE', def.key);
      if (def.encoding === 'multipart') assert.equal(targetCalls[0].multipart, true);
      else if (def.transport === 'ubus') assert.deepEqual(targetCalls[0].body.params[3], def.sample);
      else assert.deepEqual(targetCalls[0].body, def.sample);
      records.push({ tool: toolName(def), scenario: mode, passed: true, deviceRequests: expected, status: result.status, error: result.error });
    }
  }));
}

test('persist complete fault-matrix evidence', async () => {
  assert.equal(records.length, writes.length + unverified.length * 4);
  await mkdir(new URL('../reports/mock/', import.meta.url), { recursive: true });
  await writeFile(report, JSON.stringify({
    at: new Date().toISOString(), mode: 'mock-only', realDeviceModified: false,
    ordinaryWriteTools: writes.length, oneShotTools: unverified.length,
    scenarios: records.length, records,
  }, null, 2));
});
