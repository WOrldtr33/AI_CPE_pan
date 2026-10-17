import { createServer } from 'node:http';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mediaConfig } from './config.mjs';
import { MediaStore } from './store.mjs';
import { MediaProviders } from './providers.mjs';
import { MediaProcessor } from './processor.mjs';
import { mediaTools } from './tools.mjs';
import { MonitorTasks } from './monitor-tasks.mjs';
import { detectMedia, wavInfo } from './store.mjs';
import { VoiceDiagnosticCache } from './voice-diagnostics.mjs';
import { LocalVoiceModels, VoiceIdentity } from './voice-identity.mjs';

export async function createMediaService(settings = mediaConfig(), { fetchImpl = fetch, voiceGuard } = {}) {
  const diagnostics=new VoiceDiagnosticCache(settings.voiceDiagnostics?join(settings.directory,'voice-diagnostics'):undefined);
  const identity = voiceGuard || new VoiceIdentity(new LocalVoiceModels(settings));
  const store = new MediaStore(settings); await store.init();
  const providers = new MediaProviders(settings, fetchImpl), processor = new MediaProcessor(settings, store);
  const monitor = new MonitorTasks({ ...settings, reportDirectory: settings.reportDirectory || join(settings.directory, 'reports') }, providers); await monitor.init();
  const token = randomBytes(32).toString('hex'), pending = new Map();
  let terminal, origin, active = 0, chatHandler, dashboardHandler, chatBusy = false, ackBytes;
  const connected = () => terminal && Date.now() - terminal.at < 5000;
  async function invokeChat(body, signal) {
    if (!chatHandler) throw new Error('MEDIA_AGENT_NOT_CONNECTED');
    if (chatBusy) throw new Error('MEDIA_AGENT_BUSY');
    chatBusy = true;
    try { return await chatHandler(body, signal); } finally { chatBusy = false; }
  }
  async function command(kind, args, signal) {
    if (!connected() || !terminal.armed) throw new Error('MEDIA_TERMINAL_NOT_READY：打开媒体页面并启用工具控制。');
    if (pending.size && kind !== 'stop') throw new Error('MEDIA_TERMINAL_BUSY');
    signal?.throwIfAborted();
    const id = randomUUID(), deadline = Date.now() + (kind === 'record' ? args.seconds * 1000 + 15000 : 75000);
    return new Promise((resolve, reject) => {
      const finish = (error, result) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); pending.delete(id); error ? reject(error) : resolve(result); };
      const cancel = () => finish(new Error('CALL_CANCELLED'));
      const timer = setTimeout(() => finish(new Error('MEDIA_TERMINAL_TIMEOUT')), deadline - Date.now());
      pending.set(id, { id, kind, args, deadline, delivered: false, terminalId: terminal.id, finish });
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  async function dispatch(name, args, signal) {
    const tool = mediaTools.find(t => t.name === name);
    if (!tool || !tool.schema.safeParse(args).success) throw new Error('MEDIA_INVALID_TOOL_ARGUMENTS');
    switch (name) {
      case 'media_status': return { status: 'returned', agentConnected: !!chatHandler, agentBusy: chatBusy, terminalConnected: !!connected(), terminalArmed: !!(connected() && terminal.armed),
        providers: Object.fromEntries(Object.entries(settings.providers).map(([kind, p]) => [kind, { configured: p.ready, model: p.model || null }])), ffmpegAvailable: await processor.available() };
      case 'media_list_assets': return { status: 'returned', assets: await store.list() };
      case 'media_prepare_monitor': return monitor.prepare(args);
      case 'media_monitor_status': return monitor.status(args.taskId);
      case 'media_stop_monitor': return monitor.finish();
      case 'media_record_audio': case 'media_capture_photo': {
        const reply = await command(name === 'media_record_audio' ? 'record' : 'photo', args, signal), asset = await store.get(reply.assetId);
        if (asset.meta.kind !== (name === 'media_record_audio' ? 'audio' : 'image')) throw new Error('MEDIA_CAPTURE_TYPE_MISMATCH');
        return { status: 'captured', asset: asset.meta };
      }
      case 'media_normalize_audio': return { status: 'processed', asset: await processor.normalize(args.assetId, signal) };
      case 'media_transcribe': {
        const asset = await store.get(args.assetId);
        if (asset.meta.kind !== 'audio') throw new Error('MEDIA_AUDIO_REQUIRED');
        return { status: 'transcribed', assetId: args.assetId, text: await providers.transcribe(asset, signal) };
      }
      case 'media_analyze_image': {
        const asset = await store.get(args.assetId);
        if (asset.meta.kind !== 'image') throw new Error('MEDIA_IMAGE_REQUIRED');
        return { status: 'analyzed', assetId: args.assetId, capturedAt: asset.meta.createdAt, text: await providers.analyze(asset, args.question, signal) };
      }
      case 'media_synthesize_speech': {
        if(!args.concise&&args.text.length>2000)throw new Error('MEDIA_SPEECH_TEXT_LIMIT');
        const spokenText=args.concise?await providers.briefSpeech(args.text,signal):args.text;
        let bytes=await providers.speech(spokenText,signal,args);
        if(args.profile||args.rate!==undefined)bytes=await processor.styleSpeech(bytes,args,signal);
        return{status:'synthesized',asset:await store.put(bytes,'tts'),spokenText,profile:args.profile||null,rate:args.rate||1};
      }
      case 'media_play_audio': {
        if ((await store.get(args.assetId)).meta.kind !== 'audio') throw new Error('MEDIA_AUDIO_REQUIRED');
        await command('play', args, signal); return { status: 'played', assetId: args.assetId };
      }
      case 'media_stop_audio': await command('stop', {}, signal); return { status: 'stopped' };
    }
  }
  const json = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const server = createServer(async (req, res) => {
    let counted = false;
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (!origin || !['127.0.0.1', 'localhost'].some(host => req.headers.host === `${host}:${server.address().port}`)) return json(res, { status: 'error', error: 'MEDIA_HOST_REJECTED' }, 403);
      if (req.headers.origin && req.headers.origin !== origin) return json(res, { status: 'error', error: 'MEDIA_ORIGIN_REJECTED' }, 403);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && (['/','/legacy', '/app.js', '/recorder.js', '/voice-audio.js', '/style.css'].includes(url.pathname)||/^\/ui\/(?:assets\/)?[a-zA-Z0-9._-]+$/.test(url.pathname))) {
        const dashboard=url.pathname==='/'&&existsSync(new URL('./dashboard-ui/index.html',import.meta.url));
        const file = ['/','/legacy'].includes(url.pathname) ? 'index.html' : url.pathname.slice(1);
        res.writeHead(200, { 'Content-Type': file.endsWith('.woff2') ? 'font/woff2' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'" });
        const target=dashboard?new URL('./dashboard-ui/index.html',import.meta.url):url.pathname.startsWith('/ui/')?new URL('./dashboard-ui/'+url.pathname.slice(4),import.meta.url):new URL(`./public/${file}`,import.meta.url);
        res.end(await readFile(target)); return;
      }
      const bearer = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
      if (bearer.length !== expected.length || !timingSafeEqual(bearer, expected)) return json(res, { status: 'error', error: 'MEDIA_UNAUTHORIZED' }, 401);
      if (++active > 8) { active--; return json(res, { status: 'error', error: 'MEDIA_BUSY' }, 429); } counted = true;
      if (req.method === 'GET' && url.pathname === '/api/voice/ack') {
        ackBytes ||= await providers.speech('稍等，我确认一下。', controller.signal);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }); res.end(ackBytes); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/reports/')) {
        const parts = url.pathname.split('/'); const bytes = await monitor.readReport(parts[3], parts[4]);
        res.writeHead(200, { 'Content-Type': parts[4] === 'index.html' ? 'text/html; charset=utf-8' : parts[4] === 'report.json' ? 'application/json' : 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'" }); res.end(bytes); return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/assets/')) {
        const { meta, bytes } = await store.get(url.pathname.slice('/api/assets/'.length));
        res.writeHead(200, { 'Content-Type': meta.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); return;
      }
      if (req.method !== 'POST') return json(res, { status: 'error', error: 'MEDIA_ROUTE_NOT_FOUND' }, 404);
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > settings.maxBytes * 1.4 + 10000) throw new Error('MEDIA_SIZE_LIMIT'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('MEDIA_INVALID_JSON'); }
      if (url.pathname.startsWith('/api/dashboard/')) {
        if(!dashboardHandler)return json(res,{status:'unavailable',error:'设备助手尚未连接',observedAt:Date.now(),points:[]});
        const action=url.pathname.slice('/api/dashboard/'.length);
        if(['confirm','undo','prepare','cancel'].includes(action)&&chatBusy)throw new Error('MEDIA_AGENT_BUSY');
        if(action==='confirm')chatBusy=true;
        try{return json(res,await dashboardHandler(action,body,controller.signal));}finally{if(action==='confirm')chatBusy=false;}
      }
      if (url.pathname === '/api/voice/start') { await identity.open(body.sessionId, controller.signal); return json(res, { status: 'waiting_wake' }); }
      if (url.pathname === '/api/voice/end') { identity.reset(body.sessionId);await diagnostics.clear(body.sessionId); return json(res, { status: 'ended' }); }
      if (url.pathname === '/api/voice/turn') {
        if (!chatHandler) throw new Error('MEDIA_AGENT_NOT_CONNECTED');
        if (chatBusy) throw new Error('MEDIA_AGENT_BUSY');
        if (typeof body.audio !== 'string' || body.audio.length > 1400000 || body.audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio)) throw new Error('MEDIA_VOICE_AUDIO_INVALID');
        const bytes = Buffer.from(body.audio, 'base64'), type = detectMedia(bytes), info = wavInfo(bytes);
        if (type.mime !== 'audio/wav' || info.seconds < 0.3 || info.seconds > 30 || info.sampleRate !== 16000 || info.channels !== 1) throw new Error('MEDIA_VOICE_AUDIO_INVALID');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
        const emit = event => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
        let finishDiagnostic, recognitionComplete = false, stage = 'identity', identityStarted, asrStarted;
        try {
          finishDiagnostic = await diagnostics.begin(bytes,body.sessionId,body.capture);
          identityStarted = performance.now();
          const speaker = await identity.check(body.sessionId, bytes, controller.signal);
          const identityElapsedMs = Math.round(performance.now() - identityStarted);
          const asrBytes=speaker.processedAudio?Buffer.from(speaker.processedAudio,'base64'):bytes;
          const identityResult = Object.fromEntries(['status', 'speakerId', 'samples', 'score', 'anchorScore', 'diagnostic'].filter(k => speaker[k] !== undefined).map(k => [k, speaker[k]]));
          await finishDiagnostic?.({ stage: 'identity', status: speaker.status, identity: identityResult, identityElapsedMs }, speaker.status !== 'accepted');
          emit({ type: 'voice_identity',status:speaker.status,...identityResult });
          if (speaker.status !== 'accepted') { res.end(); return; }
          stage = 'transcribing'; asrStarted = performance.now();
          await finishDiagnostic?.({ stage, status: 'transcribing', asrSubmitted: true,asrAudio:asrBytes }, false);
          emit({ type: 'state', state: 'transcribing' });
          const transcript = await providers.transcribe({ bytes:asrBytes, meta: type }, controller.signal);
          await finishDiagnostic?.({ stage: 'transcribed', status: 'transcribed', transcript, asrElapsedMs: Math.round(performance.now() - asrStarted) });
          recognitionComplete = true;
          if (/^\[?无语音\]?$/.test(transcript.trim())) { emit({ type: 'silent' }); res.end(); return; }
          if (/^(?:结束(?:语音)?(?:对话|交流)?|停止(?:语音)?(?:对话|交流)|再见)[。！!\s]*$/.test(transcript.trim())) { identity.reset(body.sessionId); await identity.open(body.sessionId, controller.signal); emit({ type: 'voice_identity', status: 'waiting_wake' }); res.end(); return; }
          emit({ type: 'transcript', text: transcript }); emit({ type: 'ack', text: '稍等，我确认一下。' });
          const result = await invokeChat({ text: transcript, onProgress: emit }, controller.signal);identity.touch?.(body.sessionId);
          emit(result.status === 'error' ? { type: 'error', error: result.error } : { type: 'answer', ...result });
        } catch (error) {
          const code = /^MEDIA_|^CALL_CANCELLED/.test(error.message) ? error.message : 'MEDIA_VOICE_TURN_FAILED';
          if (!recognitionComplete) await finishDiagnostic?.({ status: 'error', stage, error: code, ...(asrStarted ? { asrElapsedMs: Math.round(performance.now() - asrStarted) } : identityStarted ? { identityElapsedMs: Math.round(performance.now() - identityStarted) } : {}) }).catch(() => {});
          emit({ type: 'error', error: code });
        }
        res.end(); return;
      }
      if (url.pathname === '/api/monitor/prepare') return json(res, await dispatch('media_prepare_monitor', body, controller.signal));
      if (url.pathname === '/api/monitor/cancel') return json(res, await monitor.cancel(body.taskId));
      if (url.pathname === '/api/monitor/list') return json(res, { status: 'returned', tasks: monitor.list() });
      if (url.pathname === '/api/monitor/confirm' || url.pathname === '/api/monitor/ready') {
        if (!connected() || body.terminalId !== terminal.id) throw new Error('MEDIA_TERMINAL_NOT_READY');
        return json(res, await (url.pathname.endsWith('/confirm') ? monitor.confirm(body.taskId, terminal.id) : monitor.ready(body.taskId, terminal.id)));
      }
      if (url.pathname === '/api/monitor/frame' || url.pathname === '/api/monitor/error') {
        if (!connected() || body.terminalId !== terminal.id) throw new Error('MEDIA_TERMINAL_NOT_READY');
        if (url.pathname.endsWith('/error')) return json(res, await monitor.finish('camera_error'));
        return json(res, await monitor.frame(body, terminal.id, controller.signal));
      }
      if (url.pathname === '/api/chat') {
        if (!chatHandler) throw new Error('MEDIA_AGENT_NOT_CONNECTED：使用 scripts/start-agent.ps1 --web 启动网页 Agent。');
        if (!body || Object.keys(body).some(k => !['text', 'assetId'].includes(k)) || typeof body.text !== 'string' || body.text.length > 4000 || (!body.text.trim() && !body.assetId)) throw new Error('MEDIA_INVALID_CHAT');
        if (body.assetId && (await store.get(body.assetId)).meta.kind === 'video') throw new Error('MEDIA_VIDEO_UPLOAD_DISABLED');
        return json(res, await invokeChat({ text: body.text, assetId: body.assetId }, controller.signal));
      }
      if (url.pathname === '/api/upload') {
        if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data) || body.data.length % 4) throw new Error('MEDIA_INVALID_BASE64');
        const bytes = Buffer.from(body.data, 'base64'); if (detectMedia(bytes).kind === 'video') throw new Error('MEDIA_VIDEO_UPLOAD_DISABLED');
        return json(res, { status: 'stored', asset: await store.put(bytes) });
      }
      if (url.pathname === '/api/delete') { await store.remove(body.assetId); return json(res, { status: 'deleted' }); }
      if (url.pathname === '/api/call') return json(res, await dispatch(body.name, body.args, controller.signal));
      if (url.pathname === '/api/terminal/poll') {
        if (typeof body.terminalId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.terminalId) || typeof body.armed !== 'boolean') throw new Error('MEDIA_INVALID_TERMINAL');
        if (connected() && terminal.id !== body.terminalId) throw new Error('MEDIA_TERMINAL_ALREADY_CONNECTED');
        if (monitor.active() && monitor.get(monitor.current).owner !== body.terminalId) await monitor.finish('terminal_changed');
        terminal = { id: body.terminalId, armed: body.armed, at: Date.now() };
        const commands = [...pending.values()].filter(c => !c.delivered && c.terminalId === terminal.id && c.deadline > Date.now());
        commands.forEach(c => { c.delivered = true; });
        return json(res, { commands: commands.map(({ id, kind, args, deadline }) => ({ id, kind, args, deadline })), activeIds: [...pending.keys()], monitor: monitor.status(), monitorTasks: monitor.list() });
      }
      if (url.pathname === '/api/terminal/result') {
        const c = pending.get(body.id);
        if (!c || !c.delivered || c.terminalId !== body.terminalId) throw new Error('MEDIA_COMMAND_EXPIRED');
        if (body.error) c.finish(new Error('MEDIA_TERMINAL_OPERATION_FAILED'));
        else if (['record', 'photo'].includes(c.kind) && typeof body.assetId !== 'string') throw new Error('MEDIA_CAPTURE_RESULT_INVALID');
        else c.finish(null, { assetId: body.assetId });
        return json(res, { status: 'accepted' });
      }
      return json(res, { status: 'error', error: 'MEDIA_ROUTE_NOT_FOUND' }, 404);
    } catch (error) { if (!res.headersSent) json(res, { status: 'error', error: /^MEDIA_|^CALL_CANCELLED/.test(error.message) ? error.message : 'MEDIA_INTERNAL_ERROR' }, 400); }
    finally { if (counted) active--; }
  });
  server.requestTimeout = 120000;
  const monitorWatchdog = setInterval(() => { void monitor.tick(!!connected(), terminal?.id).catch(() => {}); }, 1000); monitorWatchdog.unref();
  return { store, dispatch, token, server,
    setChatHandler(handler) { chatHandler = handler; },
    setDashboardHandler(handler) { dashboardHandler=handler; },
    async listen() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(settings.port, '127.0.0.1', resolve); });
      origin = `http://127.0.0.1:${server.address().port}`;
      await writeFile(join(settings.directory, 'connection.json'), JSON.stringify({ url: origin, token, pid: process.pid }), { mode: 0o600 });
      return `${origin}/#${token}`;
    },
    async close() {
      identity.close?.();await diagnostics.close();
      clearInterval(monitorWatchdog); await monitor.finish('service_closed');
      for (const c of pending.values()) c.finish(new Error('MEDIA_SERVICE_CLOSED'));
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
      try { if (JSON.parse(await readFile(join(settings.directory, 'connection.json'), 'utf8')).token === token) await rm(join(settings.directory, 'connection.json')); } catch { /* other service owns its connection */ }
    },
  };
}


