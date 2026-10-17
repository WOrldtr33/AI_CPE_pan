import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { reads, toolName } from './catalog.mjs';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { verifiedWriteTool } from './agent-policy.mjs';
import { mediaTools } from '../media/tools.mjs';
import { MediaClient } from './media-client.mjs';

export function deviceEnvironment(env = process.env, enableWrites = false, enableMedia = false) {
  const allowed = Object.fromEntries(Object.entries(env).filter(([key, value]) =>
    typeof value === 'string' && (/^T830_/.test(key) || /^(PATH|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC)$/i.test(key))));
  if (enableMedia) for (const key of ['MEDIA_STATE_DIR', 'MEDIA_SERVICE_URL', 'MEDIA_SERVICE_TOKEN']) if (env[key]) allowed[key] = env[key];
  return { ...allowed, T830_ENABLE_WRITES: enableWrites ? '1' : '0', MCP_ENABLE_MEDIA: enableMedia ? '1' : '0' };
}

export async function connectTools(sections, env = process.env, { enableWrites = false, enableMedia = false } = {}) {
  const selected = [...new Set([...sections, ...(enableWrites ? ['upnp'] : [])])].map(key => {
    const def = reads.find(d => d.key === key);
    if (!def) throw new Error(`UNKNOWN_READ_TOOL_${key}`);
    return def;
  });
  if (!selected.length && !enableMedia) throw new Error('EMPTY_TOOL_ALLOWLIST');
  const client = new Client({ name: 't830-cli-agent', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    env: deviceEnvironment(env, enableWrites, enableMedia), stderr: 'inherit',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const definitions = selected.map(def => {
      const tool = tools.find(t => t.name === toolName(def));
      if (!tool || tool.annotations?.readOnlyHint !== true) throw new Error(`UNAVAILABLE_READ_TOOL_${def.key}`);
      return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
    });
    const validators = new Map(selected.map(def => [toolName(def), def.schema]));
    if (enableMedia) for (const def of mediaTools) {
      const tool = tools.find(t => t.name === def.name);
      if (!tool) throw new Error(`UNAVAILABLE_MEDIA_TOOL_${def.name}`);
      validators.set(def.name, def.schema);
      definitions.push({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } });
    }
    const writeTools = new Set();
    if (enableWrites) {
      const name = verifiedWriteTool;
      const tool = tools.find(t => t.name === name);
      if (!tool) throw new Error('UNAVAILABLE_VERIFIED_UPNP_WRITE');
      validators.set(name, z.object({ upnp_switch: z.enum(['0', '1']), expectedCurrent: z.enum(['0', '1']) }).strict());
      writeTools.add(name);
      definitions.push({ type: 'function', function: { name, description: `${tool.description}。仅生成待用户确认的 UPnP 写提案，先调用 t830_get_upnp 读取 expectedCurrent。`, parameters: tool.inputSchema } });
    }
    const validate = (name, args) => {
      if (!validators.has(name)) throw new Error('TOOL_NOT_ALLOWED');
      const parsed = validators.get(name).safeParse(args);
      if (!parsed.success) throw new Error('INVALID_TOOL_ARGUMENTS');
      return parsed.data;
    };
    const execute = async (name, args, signal) => {
      const parsed = validate(name, args);
      const response = await client.callTool({ name, arguments: parsed }, undefined, { timeout: name.startsWith('media_') ? 115000 : 90000, signal });
      return response.structuredContent || JSON.parse(response.content.find(c => c.type === 'text').text);
    };
    const deviceUrl = new URL(env.T830_BASE_URL || 'http://192.168.0.1');
    const deviceKey = createHash('sha256').update(`${deviceUrl.origin}${deviceUrl.pathname}|${env.T830_USERNAME || 'admin'}`).digest('hex').slice(0, 20);
    return {
      definitions, writeTools, validate, deviceKey,
      async uploadMedia(file, signal) {
        if (!enableMedia) throw new Error('MEDIA_DISABLED');
        return new MediaClient(env).upload(file, signal);
      },
      async call(name, args, signal) {
        if (writeTools.has(name)) throw new Error('WRITE_APPROVAL_REQUIRED');
        return execute(name, args, signal);
      },
      async executeApprovedWrite(name, args, signal) {
        if (!writeTools.has(name)) throw new Error('WRITE_TOOL_DISABLED');
        return execute(name, args, signal);
      },
      close: () => client.close(),
    };
  } catch (error) { await client.close().catch(() => {}); throw error; }
}
