import { join } from 'node:path';
import { config, readApiKey, root } from './agent-config.mjs';
import { ModelApi } from './agent-api.mjs';
import { connectTools } from './agent-mcp.mjs';
import { Agent } from './agent-core.mjs';
import { AgentStore } from './agent-store.mjs';
import { createLog, sanitizer } from './agent-log.mjs';
import { Dashboard } from './dashboard.mjs';
import { writes, toolName } from './catalog.mjs';

const fieldLabels = { ssid: '名称', wpapsk: '密码', authmode: '加密方式', hidden: '隐藏', state: '开关' };
// 网页确认卡片按原值显示即将写入的内容，包括密码，便于用户核对。
export function describeProposal(proposal) {
  const args = proposal.args || {};
  if (proposal.name === 't830_set_upnp_verified')
    return `UPnP：${args.expectedCurrent === '1' ? '开启' : '关闭'} → ${args.upnp_switch === '1' ? '开启' : '关闭'}`;
  const def = writes.find(d => toolName(d) === proposal.name);
  const title = def ? def.description.split(/[（。(]/)[0].trim() : proposal.name;
  const parts = [];
  const walk = (value, path) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) walk(v, [...path, k]);
    else parts.push(`${path.map(k => fieldLabels[k] || k).join(' ')}：${String(value)}`);
  };
  walk(args, []);
  return `${title}：${parts.join('，') || '无参数'}`;
}

// 网页和 CLI 使用同一个 Agent 实现、工具白名单及持久化目录。
export async function attachWebAgent(service, env = process.env, dependencies = {}) {
  const settings = config(env), key = dependencies.api ? undefined : readApiKey(env);
  const clean = sanitizer([key, env.T830_PASSWORD, env.T830_PASSWORD_HASH, env.T830_SALT, env.T830_DEVELOPER_KEY]);
  const log = dependencies.log || createLog(join(root, '.agent-logs'), clean);
  const api = dependencies.api || new ModelApi({ ...settings, apiKey: key, onEvent: log.event });
  const mcp = dependencies.mcp || await connectTools(settings.sections, env, { enableWrites: settings.enableWrites, enableMedia: true });
  let store, active, progress, settled = Promise.resolve();
  try {
    store = dependencies.store || new AgentStore(join(settings.stateDir || join(root, '.agent-state'), mcp.deviceKey), clean);
    const webStyle='网页答复先用一句直接结论，再给必要信息和清楚的下一步。单项查询明确名称和值，联合查询只讲关键状态与异常。优先自然短段落或名称：值，少用多级标题、长表格、代码块、寒暄和接口名堆砌。保留失败、不确定、未执行和待确认的边界，不为简洁省略关键告警。用户要求详细时给足细节。网页写提案请提示用户打开 AI 对话框确认，不要求输入命令行 /approve；语音不能代替写操作批准。';
    const webApi={complete:(messages,...args)=>api.complete(messages.map((m,i)=>i===0&&m.role==='system'?{...m,content:m.content+'\n'+webStyle}:m),...args)};
    const agent = new Agent({ settings, api:webApi, mcp, store, sanitize: clean, onEvent: log.event, onTool: () => progress?.({ type: 'state', state: 'using_tools', text: '正在核对相关信息…' }) });
    const dashboard=await new Dashboard({mcp,store,approve:(id,signal)=>agent.approve(id,signal),directory:env.MEDIA_STATE_DIR||join(root,'.media-state'),rateUnit:env.DASHBOARD_RATE_UNIT}).init();
    service.setDashboardHandler((action,body,signal)=>dashboard.handle(action,body,signal));
    service.setChatHandler(async ({ text, assetId, onProgress }, requestSignal) => {
      active = new AbortController();
      progress = onProgress;
      let resolveSettled; settled = new Promise(resolve => { resolveSettled = resolve; });
      const signal = AbortSignal.any([requestSignal, active.signal, AbortSignal.timeout(settings.turnTimeoutMs)]);
      try {
        let input = text.trim();
        if (assetId) {
          const { meta } = await service.store.get(assetId);
          if (meta.kind === 'audio') {
            const normalized = await service.dispatch('media_normalize_audio', { assetId }, signal);
            const transcript = await service.dispatch('media_transcribe', { assetId: normalized.asset.id }, signal);
            input = `${input ? input + '\n' : ''}用户语音转写：${transcript.text}`;
          } else if (meta.kind === 'image') {
            input += `\n用户提供图片素材 ID ${meta.id}（${meta.createdAt}）。请通过 media_analyze_image 分析图片后回答。`;
          } else throw new Error('MEDIA_VIDEO_UPLOAD_DISABLED');
        }
        const result = await agent.turn(input, signal);
        // 交互结果只发给本机网页，按原文显示；落盘内容由 store 和日志各自脱敏。
        const proposals = (result.proposals || []).map(p => ({ id: p.id, name: p.name, summary: describeProposal(p) }));
        return { status: 'answered', ...result, proposals };
      } catch (error) {
        return { status: 'error', error: clean(signal.aborted ? 'CALL_CANCELLED' : error.message) };
      } finally { active = undefined; progress = undefined; resolveSettled(); }
    });
    return { async close() { service.setChatHandler(undefined);service.setDashboardHandler(undefined); active?.abort(); await settled; await mcp.close(); if (!dependencies.store) store.close(); } };
  } catch (error) { await mcp.close().catch(() => {}); if (!dependencies.store) store?.close(); throw error; }
}
