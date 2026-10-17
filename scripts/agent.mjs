import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, readApiKey, root } from '../src/agent-config.mjs';
import { ModelApi } from '../src/agent-api.mjs';
import { connectTools } from '../src/agent-mcp.mjs';
import { Agent } from '../src/agent-core.mjs';
import { createLog, sanitizer } from '../src/agent-log.mjs';
import { AgentStore } from '../src/agent-store.mjs';

const commands = '/tools /models /model 名称 /thinking off|low|high|max /status /clear /summary\n/remember 内容 /memory /forget 记忆ID\n/tasks /task 任务ID /resume 任务ID /cancel 任务ID\n/pending /approve 提案ID\n/media /listen 秒数 /voice on|off /image 文件路径 /audio 文件路径 /speak 文字 /stop /exit';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`node scripts/agent.mjs [--check-api | --once "问题"]\n交互命令：/help ${commands}`);
  process.exit(0);
}
const envPath = join(root, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
let mcp, rl, active, store;
let clean = sanitizer();
try {
  if (args.length && !(args.length === 1 && args[0] === '--check-api') && !(args.length === 2 && args[0] === '--once')) throw new Error('INVALID_CLI_ARGUMENTS：使用 --help 查看参数。');
  const settings = config();
  const apiKey = readApiKey();
  clean = sanitizer([apiKey, process.env.T830_PASSWORD, process.env.T830_PASSWORD_HASH, process.env.T830_SALT]);
  const log = createLog(join(root, '.agent-logs'), clean);
  const api = new ModelApi({ apiKey, ...settings, onEvent: log.event });
  let models = [];
  try { models = await api.models(); }
  catch (error) {
    if (args[0] === '--check-api') throw error;
    console.error(`模型列表暂不可用：${clean(error.message)}；本地任务、记忆和回读恢复仍可使用。`);
  }
  if (models.length && !models.includes(settings.model)) throw new Error(`MODEL_UNAVAILABLE：可用模型 ${models.join(', ')}，请设置 DEEPSEEK_MODEL。`);
  if (args[0] === '--check-api') {
    console.log(JSON.stringify({ status: 'api_authenticated', model: settings.model, models }, null, 2));
  } else {
    mcp = await connectTools(settings.sections, process.env, { enableWrites: settings.enableWrites, enableMedia: settings.enableMedia });
    store = new AgentStore(join(settings.stateDir || join(root, '.agent-state'), mcp.deviceKey), clean);
    const agent = new Agent({ api, mcp, settings, store, sanitize: clean, onEvent: log.event,
      onTool: name => console.log(`工具 > ${name}`) });
    const show = result => {
      if (result.answer) console.log(`助手 > ${result.answer}`);
      if (result.result) {
        const { status, value, error, observed, expected, matches, note } = result.result;
        console.log(JSON.stringify({ status, value, error, observed, expected, matches, note }, null, 2));
      }
      if (result.taskId) console.log(`任务 > ${result.taskId}`);
      if (result.tokens !== undefined) console.log(`[工具 ${result.calls} 次；本轮累计 Token ${result.tokens}]`);
      for (const p of result.proposals || []) console.log(`待确认写操作 > ${p.name} ${JSON.stringify(p.args)}\n确认执行：/approve ${p.id}`);
    };
    const action = async fn => {
      active = new AbortController();
      try {
        const signal = AbortSignal.any([active.signal, AbortSignal.timeout(settings.turnTimeoutMs)]);
        const result = await fn(signal); show(result); return result;
      } finally { active = undefined; }
    };
    let voice = false;
    const mediaCall = async (name, args, signal) => {
      if (!settings.enableMedia) throw new Error('MEDIA_DISABLED：设置 AGENT_ENABLE_MEDIA=1 后重启。');
      const result = await mcp.call(name, args, signal);
      if (result.status === 'error') throw new Error(result.error);
      return result;
    };
    const speak = async (text, signal) => {
      if (text.length > 2000) throw new Error('MEDIA_SPEECH_TOO_LONG：最多播报 2000 字符。');
      const result = await mediaCall('media_synthesize_speech', { text: clean(text) }, signal);
      await mediaCall('media_play_audio', { assetId: result.asset.id }, signal);
    };
    const reply = async (input, signal) => {
      const result = await agent.turn(input, signal);
      if (voice) {
        // 播报失败不回滚已经完成的问答，也不重发设备操作。
        try { await speak(result.answer, signal); } catch (e) { console.error(`播报未完成 > ${clean(e.message)}`); }
      }
      return result;
    };
    const run = input => action(signal => reply(input, signal));
    const audioQuestion = async (assetId, signal) => {
      const result = await mediaCall('media_transcribe', { assetId }, signal);
      console.log(`识别 > ${clean(result.text)}`);
      return reply(result.text, signal);
    };
    const importQuestion = (file, kind) => action(async signal => {
      file = file.trim().replace(/^"(.*)"$/, '$1');
      const uploaded = await mcp.uploadMedia(file, signal);
      if (kind === 'audio') {
        const normalized = await mediaCall('media_normalize_audio', { assetId: uploaded.asset.id }, signal);
        return audioQuestion(normalized.asset.id, signal);
      }
      let asset = uploaded.asset;
      if (asset.kind !== 'image') throw new Error('MEDIA_IMAGE_REQUIRED');
      return reply(`用户提供图片素材 ID ${asset.id}（${asset.createdAt}）。请调用 media_analyze_image 分析这张图片，先描述画面，再按需结合设备工具，不能把图片当作当前网络状态证明。`, signal);
    });
    if (args[0] === '--once') await run(args[1]);
    else {
      console.log(`T830 Agent｜${settings.enableWrites ? '查询 + UPnP 待确认写入' : '只读'}｜${settings.model}｜思考 ${settings.thinking}\n输入 /help 查看命令。日志：${log.path}`);
      const unfinished = store.tasks().filter(t => ['interrupted', 'awaiting_approval'].includes(t.status));
      if (unfinished.length) console.log(`有 ${unfinished.length} 个待处理任务，使用 /tasks 查看；不会自动重放操作。`);
      if (!process.env.T830_PASSWORD && !process.env.T830_PASSWORD_HASH) console.log('提示：未配置 T830 管理凭据，设备查询将报告缺少凭据；可用 scripts/start-agent.ps1 启动。');
      rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
      const stop = () => { if (active) active.abort(); else rl.close(); };
      rl.on('SIGINT', stop);
      process.on('SIGINT', stop);
      try {
        if (process.stdin.isTTY) { rl.setPrompt('你 > '); rl.prompt(); }
        for await (const line of rl) {
          const input = line.trim();
          if (input === '/exit' || input === '/quit') break;
          try {
            if (input === '/clear') { agent.clear(); console.log('对话已清空。'); }
            else if (input === '/help') console.log(`${commands}\nCtrl+C：取消当前问题；空闲时退出。`);
            else if (input === '/tools') console.log(mcp.definitions.map(t => `${t.function.name}：${t.function.description}`).join('\n'));
            else if (input === '/models') console.log(models.join('\n'));
            else if (input === '/status') console.log(JSON.stringify({ ...settings, mode: settings.enableWrites ? 'reads-and-approved-upnp' : 'read-only', messages: agent.messages.length, summaryChars: agent.summary.length, memories: store.memories().length, state: store.directory }, null, 2));
            else if (input === '/summary') console.log(agent.summary || '尚未生成历史摘要。');
            else if (input === '/media') await action(async signal => ({ answer: JSON.stringify(await mediaCall('media_status', {}, signal), null, 2) }));
            else if (input === '/voice on' || input === '/voice off') { voice = input.endsWith('on'); console.log(`自动播报：${voice ? '开启' : '关闭'}。`); }
            else if (/^\/listen(?:\s|$)/.test(input)) await action(async signal => {
              const seconds = Number(input.slice(7).trim() || 5);
              const captured = await mediaCall('media_record_audio', { seconds }, signal);
              return audioQuestion(captured.asset.id, signal);
            });
            else if (input.startsWith('/image ')) await importQuestion(input.slice(7), 'image');
            else if (input.startsWith('/audio ')) await importQuestion(input.slice(7), 'audio');
            else if (input.startsWith('/speak ')) await action(async signal => { await speak(input.slice(7), signal); return { answer: '播报已完成。' }; });
            else if (input === '/stop') await action(async signal => { await mediaCall('media_stop_audio', {}, signal); return { answer: '已停止播报。' }; });
            else if (input === '/memory') console.log(JSON.stringify(store.memories(), null, 2));
            else if (input.startsWith('/remember ')) { const item = store.remember(input.slice(10)); agent.refreshSystem(); console.log(`已保存记忆：${item.id}`); }
            else if (input.startsWith('/forget ')) { store.forget(input.slice(8).trim()); agent.refreshSystem(); console.log('记忆已删除。'); }
            else if (input === '/tasks') console.log(JSON.stringify(store.tasks().slice(0, 30).map(t => ({ id: t.id, status: t.status, at: t.updatedAt, input: t.input.slice(0, 80) })), null, 2));
            else if (input.startsWith('/task ')) console.log(JSON.stringify(store.task(input.slice(6).trim()), null, 2));
            else if (input.startsWith('/cancel ')) { store.cancel(input.slice(8).trim()); console.log('任务已取消，待确认提案已撤销。'); }
            else if (input === '/pending') console.log(JSON.stringify(store.tasks().filter(t => t.status === 'awaiting_approval').flatMap(t => t.proposals.filter(p => p.status === 'pending').map(p => ({ taskId: t.id, ...p }))), null, 2));
            else if (input.startsWith('/approve ')) await action(signal => agent.approve(input.slice(9).trim(), signal));
            else if (input.startsWith('/resume ')) await action(signal => agent.resume(input.slice(8).trim(), signal));
            else if (input.startsWith('/model ')) {
              const model = input.slice(7).trim();
              if (!models.includes(model)) throw new Error('MODEL_UNAVAILABLE：使用 /models 查看。');
              settings.model = model; agent.clear(); console.log(`模型已切换：${model}；对话已清空。`);
            } else if (input.startsWith('/thinking ')) {
              const thinking = input.slice(10).trim();
              if (!['off', 'low', 'high', 'max'].includes(thinking)) throw new Error('INVALID_THINKING');
              settings.thinking = thinking; agent.clear(); console.log(`思考模式：${thinking}；对话已清空。`);
            } else if (input.startsWith('/')) console.log('未知命令，输入 /help 查看。');
            else if (input) await run(input);
          } catch (error) { console.error(`错误 > ${clean(error.message)}`); }
          if (process.stdin.isTTY) rl.prompt();
        }
      } finally { process.removeListener('SIGINT', stop); }
    }
  }
} catch (error) { console.error(clean(error.message)); process.exitCode = 1; }
finally { rl?.close(); try { if (mcp) await mcp.close(); } finally { store?.close(); } }
