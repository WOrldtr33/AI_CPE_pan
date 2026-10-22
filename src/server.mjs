import { writeProfiles } from './write-profiles.mjs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { T830, redact } from './t830.mjs';
import { reads, writes, toolName, publicDefinition } from './catalog.mjs';
import { mediaTools } from '../media/tools.mjs';
import { MediaClient } from './media-client.mjs';
const device = new T830();
const server = new McpServer({ name: 't830-mcp-demo', version: '0.2.0' });
if (process.env.MCP_ENABLE_MEDIA === '1') {
  const media = new MediaClient();
  for (const tool of mediaTools) server.registerTool(tool.name, {
    description: tool.description, inputSchema: tool.schema,
    annotations: { readOnlyHint: ['media_status', 'media_list_assets', 'media_monitor_status'].includes(tool.name), destructiveHint: false, openWorldHint: ['media_transcribe', 'media_analyze_image', 'media_synthesize_speech'].includes(tool.name) },
  }, (args, extra) => result(() => media.call(tool.name, args, extra.signal)));
}
// 统一 MCP 返回格式：文本方便 CLI 查看，structuredContent 供程序读取。
async function result(fn) {
  try {
    const data = await fn();
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (e) {
    const data = redact({
      status: 'error',
      error: e.name === 'ZodError' ? 'INVALID_ARGUMENTS' : e.message,
      details: e.details,
      ...(e.details?.diagnosticSummary?.failure ? { failure: e.details.diagnosticSummary.failure } : {}),
    });
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
}
// 从接口目录注册工具；extra.signal 将 MCP 取消通知传递到设备处理层。
for (const def of [...reads, ...(device.writesEnabled ? writes : [])]) {
  server.registerTool(
    toolName(def),
    {
      description: `API${def.api} / ${def.group}: ${def.description}。${def.condition}`,
      inputSchema: def.schema,
      annotations: {
        readOnlyHint: def.kind === 'read',
        destructiveHint: def.kind === 'write',
        idempotentHint: def.kind === 'read',
        openWorldHint: false,
      },
    },
    (args, extra) => result(() => device.run(def, args, { signal: extra.signal })),
  );
}
server.registerTool(
  't830_query',
  {
    description:
      '兼容入口：section 选择只读查询，args 传该查询参数。分类和使用条件见各独立 get 工具。',
    inputSchema: z
      .object({
        section: z.enum(reads.map((d) => d.key)),
        args: z.record(z.unknown()).optional(),
      })
      .strict(),
    annotations: { readOnlyHint: true },
  },
  ({ section, args }, extra) =>
    result(() => device.query(section, args, { signal: extra.signal })),
);
server.registerTool(
  't830_list_capabilities',
  {
    description: '列出已封装接口分类、读写属性和前提。注册不代表当前设备支持或授权。',
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true },
  },
  () =>
    result(async () => ({
      cookieMode: device.cookieMode,
      writesEnabled: device.writesEnabled,
      queuePolicy: {
        maxPending: device.queueMaxPending,
        waitTimeoutMs: device.queueWaitMs,
        scope: 'per_device_instance',
      },
      shutdownGraceMs: device.shutdownGraceMs,
      writeVerificationPolicy: {
        maxAttempts: device.writeMaxAttempts,
        readbackAttempts: device.writeReadbackAttempts,
        intervalMs: device.writeReadbackIntervalMs,
      },
      writeVerificationProfiles: Object.entries(writeProfiles).map(([key, p]) => ({
        key,
        readback: p.readback,
        basis: p.basis,
        retryAcknowledgedUnchanged: p.retryUnchanged,
        retryAfterUncertainDispatch: false,
      })),
      workflows: [
        {
          tool: 't830_set_upnp_verified',
          enabled: device.writesEnabled,
          scope: 'per_device_instance',
          requiresExpectedCurrent: true,
        },
      ],
      apis: [...reads, ...writes].map(publicDefinition),
    })),
);
server.registerTool(
  't830_check_access',
  {
    description: '只读查询一个已封装 UBUS 接口的会话权限，不修改权限。',
    inputSchema: z
      .object({
        section: z.enum(reads.filter((d) => d.transport === 'ubus').map((d) => d.key)),
      })
      .strict(),
    annotations: { readOnlyHint: true },
  },
  ({ section }, extra) =>
    result(() => {
      const d = reads.find((d) => d.key === section);
      return device.rpc(
        'session',
        'access',
        { scope: 'ubus', object: d.service, function: d.method },
        { signal: extra.signal },
      );
    }),
);
// 连续写入工具也受写开关保护，不能绕过默认只读模式。
if (device.writesEnabled)
  server.registerTool(
    't830_set_upnp_verified',
    {
      description:
        '连续执行已有 UPnP 原值检查、写入与回读。仅锁定本 Server；冲突时停止，不自动回滚。',
      inputSchema: z
        .object({ upnp_switch: z.enum(['0', '1']), expectedCurrent: z.enum(['0', '1']) })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    ({ upnp_switch, expectedCurrent }, extra) =>
      result(() =>
        device.writeVerified(
          'upnp',
          { upnp_switch },
          { expectedCurrent, signal: extra.signal },
        ),
      ),
  );
let closing;
// closing 复用一次关闭过程，避免 EOF 和系统信号同时触发重复清理。
const shutdown = () => {
  if (closing) {
    return closing;
  }
  closing = (async () => {
    const outcome = await device.close();
    console.error(JSON.stringify({ event: 'shutdown', ...outcome }));
    await server.close();
  })();
  closing.catch((error) => {
    console.error('Shutdown failed:', error.message);
    process.exitCode = 1;
  });
  return closing;
};
// 正常关闭事件先让设备任务收尾，再关闭 MCP 传输。
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.stdin.once('end', shutdown);
await server.connect(new StdioServerTransport());
