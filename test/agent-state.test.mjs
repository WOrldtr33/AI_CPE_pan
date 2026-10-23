import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgentStore } from '../src/agent-store.mjs';
import { Agent } from '../src/agent-core.mjs';
import { config } from '../src/agent-config.mjs';
import { sanitizer } from '../src/agent-log.mjs';

const settings = { ...config({}), turnTimeoutMs: 5000 };
const readTool = { type: 'function', function: { name: 't830_get_version' } };
const writeTool = { type: 'function', function: { name: 't830_set_upnp_verified' } };
const writeArgs = { upnp_switch: '1', expectedCurrent: '0' };
const request = (name, args, id = 'c1') => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const answer = content => ({ message: { role: 'assistant', content }, usage: { total_tokens: 10 } });
async function fixture(fn) {
  await mkdir(new URL('../.agent-state/', import.meta.url), { recursive: true });
  const directory = await mkdtemp(new URL('../.agent-state/test-store-', import.meta.url));
  const clean = sanitizer(['known-private-value']);
  let store = new AgentStore(directory, clean);
  const reopen = () => { store.close(); store = new AgentStore(directory, clean); return store; };
  try { await fn({ store, directory, reopen, clean }); }
  finally { store.close(); await rm(directory, { recursive: true, force: true }); }
}
function makeAgent(store, responses, overrides = {}) {
  const calls = [], writes = [], sent = [], events = [];
  const mcp = {
    definitions: [readTool, writeTool], writeTools: new Set([writeTool.function.name]),
    validate: (name, args) => { if (name === writeTool.function.name && (!['0', '1'].includes(args.upnp_switch) || !['0', '1'].includes(args.expectedCurrent))) throw new Error('INVALID_TOOL_ARGUMENTS'); },
    call: async (name, args) => { calls.push({ name, args }); return { status: 'returned', data: { data: { upnp_switch: '1' }, version: 'mock-v1' } }; },
    executeApprovedWrite: async (name, args) => { writes.push({ name, args }); return { status: 'verified_field', value: args.upnp_switch }; },
  };
  Object.assign(mcp, overrides.mcp);
  const agent = new Agent({ store, mcp, settings: { ...settings, ...overrides.settings }, sanitize: store.sanitize, onEvent: e => events.push(e),
    api: { complete: async messages => {
      sent.push(structuredClone(messages));
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    } },
  });
  return { agent, calls, writes, sent, events };
}
const proposalResponses = () => [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, writeArgs)] } }, answer('UPnP 写操作尚未执行，等待确认。')];

test('Explicit memories survive restart, can be forgotten and reject credentials', () => fixture(async ({ store, reopen }) => {
  const item = store.remember('回答请用简体中文');
  assert.throws(() => store.remember('API Key 是测试值'), /CREDENTIAL_REJECTED/);
  assert.throws(() => store.remember('密码是测试值'), /CREDENTIAL_REJECTED/);
  const restarted = reopen();
  assert.equal(restarted.memories()[0].id, item.id);
  const f = makeAgent(restarted, [answer('好的')]);
  await f.agent.turn('你好');
  assert(f.sent[0][0].content.includes('回答请用简体中文'));
  f.agent.clear(); assert.equal(restarted.memories().length, 1);
  restarted.forget(item.id); f.agent.refreshSystem();
  assert(!f.agent.messages[0].content.includes('回答请用简体中文'));
}));

test('Session restore keeps complete conversation and observations without persisting reasoning or secrets', () => fixture(async ({ store, directory, reopen }) => {
  const f = makeAgent(store, [{ message: { role: 'assistant', reasoning_content: 'INTERNAL-THOUGHT', tool_calls: [request(readTool.function.name, {})] } }, answer('已查询 mock-v1')]);
  await f.agent.turn('known-private-value 版本？');
  const saved = await readFile(join(directory, 'session.json'), 'utf8');
  assert(!saved.includes('INTERNAL-THOUGHT')); assert(!saved.includes('known-private-value'));
  assert(!saved.includes('tool_calls')); assert(!saved.includes('reasoning_content'));
  const restarted = reopen(), g = makeAgent(restarted, [answer('接着回答')]);
  assert(g.agent.summary.includes('mock-v1'));
  await g.agent.turn('接着说');
  assert(g.sent[0].some(m => m.content?.includes('已查询 mock-v1')));
  assert.equal(g.sent[0].at(-1).content, '接着说');
}));

test('Automatic summary removes complete old turns, preserves recent messages and bounds context', () => fixture(async ({ store }) => {
  const f = makeAgent(store, Array.from({ length: 12 }, () => answer('模拟回答'.repeat(80))), { settings: { contextChars: 4000, keepTurns: 1 } });
  for (let i = 0; i < 8; i++) await f.agent.turn(`问题 ${i}：${'测试'.repeat(100)}`);
  assert(f.events.some(e => e.event === 'context_compacted'));
  assert(f.agent.summary.length > 0); assert(f.agent.summary.length <= 1200);
  assert(f.sent.every(messages => JSON.stringify(messages).length <= 4000));
  assert(f.sent.at(-1).at(-1).content.startsWith('问题 7'));
}));

test('Write tool only creates a durable proposal; explicit approval executes exact args once', () => fixture(async ({ store, reopen }) => {
  const f = makeAgent(store, proposalResponses());
  const result = await f.agent.turn('开启 UPnP');
  assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0);
  assert.equal(result.proposals.length, 1); assert.equal(store.task(result.taskId).status, 'awaiting_approval');
  const restarted = reopen(), g = makeAgent(restarted, []);
  const approved = await g.agent.approve(result.proposals[0].id);
  assert.equal(approved.result.status, 'verified_field');
  assert.deepEqual(g.writes, [{ name: writeTool.function.name, args: writeArgs }]);
  await assert.rejects(g.agent.approve(result.proposals[0].id), /NOT_PENDING/);
  assert.equal(g.writes.length, 1);
}));

test('Approved writes use real sensitive values while disk keeps them redacted', () => fixture(async ({ store, directory, reopen }) => {
  const wifiArgs = { '5G': { ssid: '我爱上班', wpapsk: 'new-wifi-secret' } };
  const wifi = { mcp: { validate: () => {} } };
  const f = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, wifiArgs)] } }, answer('等待确认')], wifi);
  const result = await f.agent.turn('修改 5G');
  const saved = await readFile(join(directory, 'tasks', `${result.taskId}.json`), 'utf8');
  assert(!saved.includes('new-wifi-secret'));
  await f.agent.approve(result.proposals[0].id);
  assert.deepEqual(f.writes[0].args, wifiArgs);
  const g = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, wifiArgs)] } }, answer('等待确认')], wifi);
  const pending = await g.agent.turn('再改一次');
  const restarted = reopen(), h = makeAgent(restarted, [], wifi);
  await assert.rejects(h.agent.approve(pending.proposals[0].id), /PROPOSAL_ARGS_UNAVAILABLE/);
  assert.equal(h.writes.length, 0);
  const copied = makeAgent(restarted, [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, { '5G': { ssid: '[REDACTED]' } })] } }, answer('参数错误')], wifi);
  const rejected = await copied.agent.turn('照读到的值写回');
  assert.equal(rejected.proposals.length, 0);
}));

test('User-typed value equal to a process secret reaches the model and the write, but not the disk', () => fixture(async ({ store, directory }) => {
  const wifiArgs = { '5G': { ssid: '潘鸿鑫', wpapsk: 'known-private-value' } };
  const f = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, wifiArgs)] } }, answer('等待确认')], { mcp: { validate: () => {} } });
  const result = await f.agent.turn('5G 密码改成 known-private-value');
  assert.equal(f.sent[0].at(-1).content, '5G 密码改成 known-private-value');
  assert.equal(result.proposals.length, 1);
  for (const file of ['session.json', join('tasks', `${result.taskId}.json`)]) assert(!(await readFile(join(directory, file), 'utf8')).includes('known-private-value'));
  await f.agent.approve(result.proposals[0].id);
  assert.deepEqual(f.writes[0].args, wifiArgs);
}));

test('Queried Wi-Fi passwords are plain in model context and answers but redacted on disk', () => fixture(async ({ store, directory }) => {
  const wifi = { mcp: { call: async () => ({ status: 'returned', data: { data: { '5G': { ssid: '潘鸿鑫', wpapsk: 'read-wifi-pass' } } } }) } };
  const f = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(readTool.function.name, {})] } }, answer('5G 密码是 read-wifi-pass')], wifi);
  const result = await f.agent.turn('查看 5G 密码');
  assert(f.sent[1].at(-1).content.includes('read-wifi-pass'));
  assert.equal(result.answer, '5G 密码是 read-wifi-pass');
  for (const file of ['session.json', join('tasks', `${result.taskId}.json`)]) assert(!(await readFile(join(directory, file), 'utf8')).includes('read-wifi-pass'));
}));

test('Approval result shows the written password while the task file keeps it redacted', () => fixture(async ({ store, directory }) => {
  const wifiArgs = { '5G': { ssid: '潘鸿鑫', wpapsk: 'approved-pass' } };
  const wifi = { mcp: { validate: () => {}, executeApprovedWrite: async (name, args) => ({ status: 'verified_fields', expected: { '5G.wpapsk': args['5G'].wpapsk } }) } };
  const f = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, wifiArgs)] } }, answer('等待确认')], wifi);
  const pending = await f.agent.turn('5G 密码改成 approved-pass');
  const approved = await f.agent.approve(pending.proposals[0].id);
  assert.equal(approved.result.expected['5G.wpapsk'], 'approved-pass');
  assert(!(await readFile(join(directory, 'tasks', `${pending.taskId}.json`), 'utf8')).includes('approved-pass'));
}));

test('Write proposals keep the validated arguments, including schema defaults, for confirmation and execution', () => fixture(async ({ store }) => {
  const f = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, { upnp_switch: '1' })] } }, answer('等待确认'), answer('已开启')],
    { mcp: { validate: (name, args) => ({ ...args, expectedCurrent: '0' }) } });
  const pending = await f.agent.turn('开启 UPnP');
  assert.deepEqual(pending.proposals[0].args, { upnp_switch: '1', expectedCurrent: '0' });
  await f.agent.approve(pending.proposals[0].id);
  assert.deepEqual(f.writes[0].args, { upnp_switch: '1', expectedCurrent: '0' });
}));

test('Approval asks the model to summarize the executed result and keeps the summary in context', () => fixture(async ({ store }) => {
  const f = makeAgent(store, [...proposalResponses(), answer('UPnP 已开启，设备回读确认。')]);
  const pending = await f.agent.turn('开启 UPnP');
  const approved = await f.agent.approve(pending.proposals[0].id);
  assert.equal(approved.answer, 'UPnP 已开启，设备回读确认。');
  const report = f.sent.at(-1).at(-1);
  assert.equal(report.role, 'user');
  assert.match(report.content, /verified_field/);
  assert.match(report.content, /已提交，暂时无法确认/);
  assert.equal(f.agent.messages.at(-1).content, 'UPnP 已开启，设备回读确认。');
  assert.equal(store.task(pending.taskId).writeSummary, 'UPnP 已开启，设备回读确认。');
}));

test('A failed summary never repeats the write and still returns the device result', () => fixture(async ({ store }) => {
  const f = makeAgent(store, [...proposalResponses(), new Error('AI_NETWORK_ERROR')]);
  const pending = await f.agent.turn('开启 UPnP');
  const approved = await f.agent.approve(pending.proposals[0].id);
  assert.equal(approved.answer, undefined);
  assert.equal(approved.result.status, 'verified_field');
  assert.equal(f.writes.length, 1);
  assert.equal(store.task(pending.taskId).status, 'completed');
}));

test('Cancelled proposals and invalid args never reach the write executor', () => fixture(async ({ store }) => {
  const f = makeAgent(store, proposalResponses());
  const result = await f.agent.turn('开启 UPnP'); store.cancel(result.taskId);
  await assert.rejects(f.agent.approve(result.proposals[0].id), /NOT_PENDING/);
  assert.equal(f.writes.length, 0);
  const g = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(writeTool.function.name, { upnp_switch: '2' })] } }, answer('参数错误')]);
  const invalid = await g.agent.turn('测试非法参数');
  assert.equal(invalid.proposals.length, 0); assert.equal(g.writes.length, 0);
}));

test('Interrupted read task retains evidence and resumes as a linked new task', () => fixture(async ({ store, reopen }) => {
  const f = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [request(readTool.function.name, {})] } }, new Error('AI_NETWORK_ERROR')]);
  await assert.rejects(f.agent.turn('查询版本'), /AI_NETWORK_ERROR/);
  const task = store.tasks()[0]; assert.equal(task.steps[0].result.status, 'returned');
  // 模拟进程在持久化运行状态后被强制终止。
  task.status = 'running'; store.saveTask(task);
  const restarted = reopen(); assert.equal(restarted.task(task.id).status, 'interrupted');
  const g = makeAgent(restarted, [answer('恢复完成')]);
  const result = await g.agent.resume(task.id);
  assert.equal(restarted.task(result.taskId).parentId, task.id);
  assert.equal(restarted.task(task.id).status, 'resumed');
  assert.equal(result.answer, '恢复完成'); assert.equal(g.writes.length, 0);
}));

test('Crash after persisted write dispatch only reads back, never replays the write', () => fixture(async ({ store, reopen }) => {
  const f = makeAgent(store, proposalResponses());
  const result = await f.agent.turn('开启 UPnP');
  const task = store.task(result.taskId), p = task.proposals[0];
  p.status = 'dispatched'; task.status = 'executing_write';
  task.writeDispatch = { proposalId: p.id, name: p.name, args: p.args }; store.saveTask(task);
  const restarted = reopen(), g = makeAgent(restarted, []);
  assert.equal(restarted.task(task.id).recovery, 'readback_required_no_replay');
  await assert.rejects(g.agent.approve(p.id), /NOT_PENDING/);
  const recovered = await g.agent.resume(task.id);
  assert.equal(g.writes.length, 0); assert.deepEqual(g.calls.map(c => c.name), ['t830_get_upnp']);
  assert.equal(recovered.result.status, 'observed_fields'); assert.equal(recovered.result.matches, true);
  assert.equal(restarted.task(task.id).status, 'reconciled');
}));

test('Lost write response stays unknown and requires explicit readback recovery', () => fixture(async ({ store }) => {
  const f = makeAgent(store, proposalResponses(), { mcp: { executeApprovedWrite: async () => { throw new Error('MCP_TIMEOUT'); } } });
  const result = await f.agent.turn('开启 UPnP');
  const written = await f.agent.approve(result.proposals[0].id);
  assert.equal(written.result.remoteExecution, 'unknown');
  assert.equal(store.task(result.taskId).status, 'interrupted');
  await assert.rejects(f.agent.approve(result.proposals[0].id), /NOT_PENDING/);
  await f.agent.resume(result.taskId);
  assert.deepEqual(f.calls.map(c => c.name), ['t830_get_upnp']);
}));

test('State lock rejects a competing process and corrupt files fail closed', () => fixture(async ({ store, directory }) => {
  assert.throws(() => new AgentStore(directory), /STATE_LOCKED/);
  assert.equal(store.read('lock.json').pid, process.pid);
  writeFileSync(join(directory, 'session.json'), '{invalid');
  assert.throws(() => store.session(), /STATE_READ_FAILED/);
  assert.throws(() => store.task('../outside'), /INVALID_TASK_ID/);
  const task = store.createTask('测试');
  assert.equal(store.task(task.id).input, '测试');
  assert(!(await readdir(directory)).some(name => name.endsWith('.tmp')));
}));

test('An actual exited process leaves a stale lock; reopening marks its dispatched write interrupted', () => fixture(async ({ store, directory, reopen }) => {
  store.close();
  const code = `
    import { AgentStore } from './src/agent-store.mjs';
    const store = new AgentStore(process.argv[1]);
    const task = store.createTask('虚构写任务');
    const proposal = store.propose(task, 't830_set_upnp_verified', { upnp_switch: '1', expectedCurrent: '0' });
    proposal.status = 'dispatched'; task.status = 'executing_write';
    task.writeDispatch = { proposalId: proposal.id, name: proposal.name, args: proposal.args };
    store.saveTask(task);
    process.exit(0);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', code, directory], { cwd: new URL('../', import.meta.url), windowsHide: true });
  const restarted = reopen(), task = restarted.tasks()[0];
  assert.equal(task.status, 'interrupted'); assert.equal(task.recovery, 'readback_required_no_replay');
  const f = makeAgent(restarted, []);
  await f.agent.resume(task.id); assert.equal(f.writes.length, 0);
}));

test('Multiple different write requests in one model response create only one proposal', () => fixture(async ({ store }) => {
  const f = makeAgent(store, [{ message: { role: 'assistant', tool_calls: [
    request(writeTool.function.name, writeArgs, 'a'),
    request(writeTool.function.name, { upnp_switch: '0', expectedCurrent: '1' }, 'b'),
  ] } }, answer('请先确认第一个提案。')]);
  const result = await f.agent.turn('UPnP 开关测试');
  assert.equal(result.proposals.length, 1); assert.equal(f.writes.length, 0);
  assert(f.sent[1].some(m => m.role === 'tool' && m.content.includes('ONE_WRITE_PER_TASK')));
}));

test('Malformed persisted conversation roles are rejected before model requests', () => fixture(async ({ store }) => {
  store.saveSession({ summary: '', messages: [{ role: 'tool', content: '{}' }] });
  assert.throws(() => makeAgent(store, []), /INVALID_SESSION_STATE/);
}));

test('Submitted actions complete once without claiming field verification', () => fixture(async ({ store }) => {
  const name = 't830_set_reboot';
  const f = makeAgent(store, [], { mcp: {
    writeTools: new Set([name]),
    executeApprovedWrite: async () => ({ status: 'submitted', data: { code: 0 } }),
  } });
  const task = store.createTask('reboot');
  const proposal = store.propose(task, name, {});
  task.status = 'awaiting_approval'; store.saveTask(task);
  const output = await f.agent.approve(proposal.id);
  assert.equal(output.result.status, 'submitted');
  assert.equal(store.task(task.id).status, 'completed');
  assert.equal(store.task(task.id).proposals[0].status, 'submitted');
  await assert.rejects(f.agent.approve(proposal.id), /NOT_PENDING/);
}));

test('Non-UPnP recovery reads the matching section and never repeats the action', () => fixture(async ({ store }) => {
  const task = store.createTask('DNS');
  task.status = 'interrupted';
  task.writeDispatch = { name: 't830_set_dns', args: { rebind_protection: '1' } };
  store.saveTask(task);
  const calls = [];
  const f = makeAgent(store, [], { mcp: { call: async name => {
    calls.push(name); return { status: 'returned', data: { data: '1' } };
  } } });
  const result = await f.agent.resume(task.id);
  assert.deepEqual(calls, ['t830_get_dns']);
  assert.equal(result.result.comparison.allMatched, true);
  assert.equal(f.writes.length, 0);
  const action = store.createTask('send SMS');
  action.status = 'interrupted'; action.writeDispatch = { name: 't830_set_sms_send', args: {} };
  store.saveTask(action);
  await assert.rejects(f.agent.resume(action.id), /RECOVERY_NO_READBACK/);
  assert.deepEqual(calls, ['t830_get_dns']);
}));
