import { setTimeout as delay } from 'node:timers/promises';
import { reads, writes, toolName } from './catalog.mjs';

const deviceData = result => result?.data?.data ?? result?.data;
const submitted = result => result?.status === 'submitted';
// 连接或断开上游 WiFi 时设备常断开 HTTP 应答；传输错误不代表未执行，仍需回读。
const maybeApplied = result => submitted(result) || ['DEVICE_TIMEOUT', 'DEVICE_UNREACHABLE'].includes(result?.error);
const routerStatus = result => deviceData(result)?.status;
const scanCount = result => ['scanlist_5g', 'scanlist_2g'].reduce((sum, key) => sum + (Array.isArray(deviceData(result)?.[key]) ? deviceData(result)[key].length : 0), 0);

// 需要等待设备完成的操作：首次等待、轮询间隔和次数取自实机测试的耗时。
const pollers = {
  t830_set_net_probe: {
    when: submitted,
    poll: args => ({ tool: 't830_get_ping_result', args: { addr: 'read_ping' }, firstMs: 2000, intervalMs: 2000, attempts: args.type === 'Traceroute' ? 45 : 15,
      done: r => r?.status === 'returned' && String(deviceData(r)?.code ?? r?.data?.code) === '0' }),
  },
  // 扫描列表接口按写接口注册，但只读取本次扫描结果；用户确认扫描即包含读取列表。
  t830_set_wifi_scan_start: {
    when: submitted,
    poll: () => ({ tool: 't830_set_wifi_scan_list', args: { state: '2' }, write: true, firstMs: 8000, intervalMs: 4000, attempts: 4,
      done: r => submitted(r) && scanCount(r) > 0 }),
  },
  t830_set_wifi_router_connect: {
    when: maybeApplied,
    poll: () => ({ tool: 't830_get_wifi_rt', args: {}, firstMs: 20000, intervalMs: 5000, attempts: 25,
      done: r => routerStatus(r)?.status === 'connected' && !!routerStatus(r)?.ip }),
  },
  t830_set_wifi_router_disconnect: {
    when: maybeApplied,
    poll: () => ({ tool: 't830_get_wifi_rt', args: {}, firstMs: 3000, intervalMs: 5000, attempts: 12,
      done: r => r?.status === 'returned' && routerStatus(r)?.status !== 'connected' }),
  },
  t830_set_workmode: {
    when: submitted,
    poll: args => ({ tool: 't830_get_workmode', args: {}, firstMs: 5000, intervalMs: 5000, attempts: 18,
      done: r => r?.status === 'returned' && Number(deviceData(r)?.workmode) === Number(args.workmode) }),
  },
};

// 写操作确认执行后收集结果：等待型操作按固定节奏轮询；其余已提交操作有回读接口时回读一次。
export async function collectFollowUp({ name, args, result, mcp, signal, wait = ms => delay(ms, undefined, { signal }) }) {
  const available = tool => mcp.definitions.some(d => d.function?.name === tool) || mcp.writeTools?.has(tool);
  const run = (plan) => plan.write ? mcp.executeApprovedWrite(plan.tool, plan.args, signal) : mcp.call(plan.tool, plan.args, signal);
  const attempt = async plan => { try { return await run(plan); } catch (error) { return { status: 'error', error: error.message }; } };
  const poller = pollers[name];
  if (poller) {
    const plan = poller.poll(args);
    if (!poller.when(result) || !available(plan.tool)) return { steps: [] };
    let last, attempts = 0;
    for (; attempts < plan.attempts; ) {
      signal?.throwIfAborted();
      await wait(attempts === 0 ? plan.firstMs : plan.intervalMs);
      last = await attempt(plan); attempts++;
      if (plan.done(last)) return { steps: [{ tool: plan.tool, attempts, complete: true, result: last }] };
    }
    return { steps: [{ tool: plan.tool, attempts, complete: false, result: last }] };
  }
  if (!['submitted', 'device_warning'].includes(result?.status)) return { steps: [] };
  const readback = reads.find(d => d.key === writes.find(d => toolName(d) === name)?.readback);
  if (!readback || !readback.schema.safeParse({}).success || !available(toolName(readback))) return { steps: [] };
  const plan = { tool: toolName(readback), args: {} };
  return { steps: [{ tool: plan.tool, attempts: 1, complete: true, result: await attempt(plan) }] };
}
