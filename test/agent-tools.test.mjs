import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { verifiedReadSections, verifiedWriteTool } from '../src/agent-policy.mjs';
import { reads } from '../src/catalog.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { Agent } from '../src/agent-core.mjs';
import { config } from '../src/agent-config.mjs';
import { sanitizer } from '../src/agent-log.mjs';
import { spawn } from 'node:child_process';

async function fixture(fn, enableWrites = true) {
  const samples = JSON.parse(await readFile(new URL('./fixtures/read-responses.json', import.meta.url), 'utf8'));
  let upnp = '0', writes = 0;
  const calls = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {}, path = new URL(req.url, 'http://local').pathname;
    calls.push({ path, body }); res.setHeader('Content-Type', 'application/json');
    const send = data => res.end(JSON.stringify(data));
    if (path.includes('action_login')) {
      res.setHeader('Set-Cookie', 'sysauth_http=mock-session; Path=/; HttpOnly');
      return send({ code: 0, sessionid: 'mock-session' });
    }
    if (path.includes('/cgi-bin/luci/admin/') && !req.headers.cookie?.includes('mock-session')) {
      res.statusCode = 403; res.setHeader('x-luci-login-required', 'yes'); return send({});
    }
    if (path.endsWith('/set_upnp')) { writes++; upnp = body.upnp_switch; return send({ code: 0 }); }
    if (path.endsWith('/get_upnp')) return send({ code: 0, data: { upnp_switch: upnp } });
    if (path === '/ubus/') {
      const [, service, method, args] = body.params;
      if (service === 'session' && method === 'access') return send({ result: [0, { access: true }] });
      if (service === 'web_api' && method === 'get_upnp') return send({ result: [0, { ...samples.upnp, data: { ...samples.upnp.data, upnp_switch: upnp } }] });
      const def = reads.find(d => d.transport === 'ubus' && d.service === service && d.method === method);
      return send({ result: [0, samples[def?.key] || { code: 200 }] });
    }
    const def = reads.find(d => d.path === path);
    return send(samples[def?.key] || { code: 200 });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let mcp;
  try {
    const env = { ...process.env, T830_BASE_URL: `http://127.0.0.1:${server.address().port}`, T830_PASSWORD: 'mock-only', T830_WRITE_READBACK_INTERVAL_MS: '0' };
    mcp = await connectTools(verifiedReadSections, env, { enableWrites });
    await fn({ mcp, env, calls, stats: () => ({ writes, upnp }), change: value => { upnp = value; } });
  } finally { await mcp?.close(); await new Promise(resolve => server.close(resolve)); }
}

test('Default tools match exactly the live rows that returned', async () => {
  const doc = await readFile(new URL('../docs/testing/LIVE_TEST_RESULTS.md', import.meta.url), 'utf8');
  const passed = [...doc.matchAll(/^\|\s*\d+\s*\|\s*(\w+)\s*\|\s*returned\s*\|/gm)].map(m => m[1]);
  assert.equal(passed.length, 34);
  assert.deepEqual([...verifiedReadSections].sort(), passed.sort());
  assert.deepEqual(['device', 'sim', 'traffic'].filter(key => verifiedReadSections.includes(key)), ['device', 'sim', 'traffic']);
  assert(!verifiedReadSections.includes('sim_slot')); assert(!verifiedReadSections.includes('roaming')); assert(!verifiedReadSections.includes('wifi_ad'));
});

test('All default read tools call through real MCP; only verified UPnP write is exposed', () => fixture(async ({ mcp, stats }) => {
  assert.equal(mcp.definitions.length, 35);
  assert.deepEqual([...mcp.writeTools], [verifiedWriteTool]);
  for (const section of verifiedReadSections) {
    const def = reads.find(d => d.key === section);
    const output = await mcp.call(`t830_get_${section}`, def.sample);
    assert.equal(output.status, 'returned', section);
  }
  assert.equal(stats().writes, 0);
  await assert.rejects(mcp.call(verifiedWriteTool, { upnp_switch: '1', expectedCurrent: '0' }), /WRITE_APPROVAL_REQUIRED/);
  for (const name of ['t830_set_wifi_switch', 't830_set_upnp', 't830_set_dns']) {
    assert.throws(() => mcp.validate(name, {}), /TOOL_NOT_ALLOWED/);
    await assert.rejects(mcp.executeApprovedWrite(name, {}), /WRITE_TOOL_DISABLED/);
  }
}));

test('Approved UPnP write executes preflight and readback; stale expectedCurrent blocks submission', () => fixture(async ({ mcp, stats, change }) => {
  const result = await mcp.executeApprovedWrite(verifiedWriteTool, { upnp_switch: '1', expectedCurrent: '0' });
  assert.equal(result.status, 'verified_field', result.error); assert.equal(result.value, '1');
  assert.equal(stats().writes, 1);
  change('0');
  const conflict = await mcp.executeApprovedWrite(verifiedWriteTool, { upnp_switch: '0', expectedCurrent: '1' });
  assert.equal(conflict.status, 'error'); assert.equal(conflict.error, 'CONFIG_CONFLICT');
  assert.equal(stats().writes, 1);
}));

test('Agent proposal → approval → real MCP verified write works against simulated device', () => fixture(async ({ mcp, stats }) => {
  await mkdir(new URL('../.agent-state/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.agent-state/test-tools-', import.meta.url));
  const store = new AgentStore(directory, sanitizer());
  const responses = [
    { message: { role: 'assistant', tool_calls: [{ id: 'read', type: 'function', function: { name: 't830_get_upnp', arguments: '{}' } }] } },
    { message: { role: 'assistant', tool_calls: [{ id: 'write', type: 'function', function: { name: verifiedWriteTool, arguments: '{"upnp_switch":"1","expectedCurrent":"0"}' } }] } },
    { message: { role: 'assistant', content: 'UPnP 0 → 1 待确认。' } },
  ];
  const agent = new Agent({ store, mcp, settings: config({}), sanitize: sanitizer(), api: { complete: async () => responses.shift() } });
  try {
    const task = await agent.turn('开启 UPnP');
    assert.equal(stats().writes, 0); assert.equal(task.proposals.length, 1);
    const result = await agent.approve(task.proposals[0].id);
    assert.equal(result.result.status, 'verified_field', result.result.error); assert.equal(stats().writes, 1);
    assert.equal(store.task(task.taskId).status, 'completed');
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}));

test('Read-only configuration still excludes writes at the MCP boundary', () => fixture(async ({ mcp }) => {
  assert.equal(mcp.definitions.length, 34); assert.equal(mcp.writeTools.size, 0);
  await assert.rejects(mcp.executeApprovedWrite(verifiedWriteTool, {}), /WRITE_TOOL_DISABLED/);
}, false));

test('CLI requires actual /approve input before executing the proposed UPnP write', () => fixture(async ({ env, stats }) => {
  await mkdir(new URL('../.agent-state/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.agent-state/test-cli-write-', import.meta.url));
  const program = `
    let round = 0;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/models')) return Response.json({data:[{id:'deepseek-flash'}]});
      round++;
      const message = round === 1
        ? { role:'assistant',tool_calls:[{id:'r',type:'function',function:{name:'t830_get_upnp',arguments:'{}'}}] }
        : round === 2
          ? { role:'assistant',tool_calls:[{id:'w',type:'function',function:{name:'t830_set_upnp_verified',arguments:'{"upnp_switch":"1","expectedCurrent":"0"}'}}] }
          : {role:'assistant',content:'UPnP 提案等待确认，尚未执行。'};
      return Response.json({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{total_tokens:10}});
    };
    await import('./scripts/agent.mjs');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], {
    cwd: new URL('../', import.meta.url), windowsHide: true,
    env: { ...env, DEEPSEEK_API_KEY: 'mock-only', DEEPSEEK_MODEL: 'deepseek-flash', AGENT_STATE_DIR: directory, AGENT_ENABLE_WRITES: '1', AGENT_TOOLS: 'upnp' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', errors = '', approved = false, exited = false;
  const timer = setTimeout(() => child.kill(), 15000);
  child.stderr.on('data', chunk => { errors += chunk; });
  child.stdout.on('data', chunk => {
    output += chunk;
    const match = output.match(/确认执行：\/approve ([a-f0-9-]{36})/);
    if (match && !approved) {
      assert.equal(stats().writes, 0);
      approved = true; child.stdin.write(`/approve ${match[1]}\n`);
    }
    if (output.includes('"status": "verified_field"') && !exited) { exited = true; child.stdin.end('/exit\n'); }
  });
  child.stdin.write('准备开启 UPnP\n');
  try {
    const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    assert.equal(status, 0, errors); assert(approved && exited, output + errors);
    assert.equal(stats().writes, 1); assert.equal(stats().upnp, '1');
  } finally { clearTimeout(timer); child.kill(); await rm(directory, { recursive: true, force: true }); }
}));
