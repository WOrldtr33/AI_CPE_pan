import { timestamp } from '../src/time.mjs';
// 真实 DeepSeek + 真实 MCP stdio + 模拟 T830；不连接或修改真实设备。
import { createServer } from 'node:http';
import { writeReport } from '../src/artifacts.mjs';
import { config, readApiKey } from '../src/agent-config.mjs';
import { ModelApi } from '../src/agent-api.mjs';
import { connectTools } from '../src/agent-mcp.mjs';
import { Agent } from '../src/agent-core.mjs';
import { sanitizer } from '../src/agent-log.mjs';

// 全部云端测试内容为新建的虚构数据，禁止使用项目中的设备响应样本。
const syntheticVersion = 'DEMO-ONLY-1.0';
const report = { at: timestamp(), mode: 'real-model-mcp-mock-device', realDeviceAccessed: false, events: [] };
let deviceCalls = 0, mcp;
let clean = sanitizer();
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!req.url.startsWith('/cgi-bin/upgrade-set.lua')) { res.statusCode = 404; res.end('{}'); return; }
  deviceCalls++; res.end(JSON.stringify({ dataCode: 200, data: { version: syntheticVersion } }));
});
try {
  const apiKey = readApiKey(); clean = sanitizer([apiKey]);
  const settings = { ...config(), sections: ['version'], thinking: 'off', maxTokens: 512, maxRounds: 4 };
  report.model = settings.model;
  const api = new ModelApi({ apiKey, ...settings, onEvent: e => report.events.push(clean(e)) });
  await server.listen({ host: '127.0.0.1', port: 0 });
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  mcp = await connectTools(['version'], { ...process.env, T830_BASE_URL: `http://127.0.0.1:${server.address().port}` });
  // 云端只看到通用的虚构演示工具；本地适配器依旧通过真实 MCP 协议执行。
  const demoTools = {
    definitions: [{ type: 'function', function: { name: 'get_demo_version', description: 'Return a fictional demo version.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }],
    async call(name, args, signal) {
      if (name !== 'get_demo_version') throw new Error('TOOL_NOT_ALLOWED');
      const data = await mcp.call('t830_get_version', args, signal);
      if (data.status !== 'returned' || data.data?.data?.version !== syntheticVersion) throw new Error('MOCK_DEVICE_CHECK_FAILED');
      return { status: 'returned', data: { version: syntheticVersion } };
    },
  };
  const agent = new Agent({ api, mcp: demoTools, settings, sanitize: clean, onEvent: e => report.events.push(clean(e)) });
  agent.messages = [{ role: 'system', content: 'You test fictional demo data. Use the provided tool when asked for the demo version, then answer briefly.' }];
  const result = await agent.turn('请调用 get_demo_version 获取虚构演示版本，并用中文简短回答。');
  Object.assign(report, result, { deviceCalls });
  if (deviceCalls !== 1 || !report.events.some(e => e.event === 'tool_result' && e.name === 'get_demo_version' && e.result.status === 'returned')) throw new Error('LIVE_TOOL_LOOP_NOT_VERIFIED');
  report.status = 'passed';
} catch (error) { report.status = 'error'; report.error = clean(error.message); process.exitCode = 1; }
finally {
  await mcp?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await writeReport('live/agent-live-results.json', JSON.stringify(clean(report), null, 2));
  console.log(JSON.stringify(clean({ status: report.status, model: report.model, answer: report.answer, calls: report.calls, deviceCalls, tokens: report.tokens, error: report.error }), null, 2));
}
