import { VoiceGate, WakeWindow, AudioBacklog, microphoneConstraints, audioWav } from './voice-audio.js';
const $ = id => document.getElementById(id);
const token = location.hash.slice(1) || sessionStorage.getItem(`media-token:${location.origin}`) || '';
if (location.hash) sessionStorage.setItem(`media-token:${location.origin}`, token);
history.replaceState(null, '', location.pathname);
const terminalId = crypto.randomUUID(), renderedPlans = new Set();
let context, player, playerStop, turn, attachment, previewUrl, voice, photo, monitor, connected = false, currentTask;
const stoppedTasks = new Set();
const statusNames = { awaiting_confirmation:'等待确认', starting:'正在连接摄像头', running:'监测中', finalizing:'正在整理记录', completed:'已完成', stopped:'已结束', failed:'未完成', interrupted:'曾中断', cancelled:'已取消' };
function friendly(error) { const text = error?.message || String(error); return ({ MEDIA_AGENT_BUSY:'上一个问题还在处理中，请稍等。', MEDIA_AGENT_NOT_CONNECTED:'Agent 尚未连接，请用 --web 启动服务。', MEDIA_VIDEO_UPLOAD_DISABLED:'当前只接收图片和 WAV 音频，不接收视频文件。', MEDIA_MONITOR_OBJECTIVE_REQUIRED:'请说明你想观察的具体内容或变化。', MEDIA_TERMINAL_NOT_READY:'页面还未连接，请稍后重试。', MEDIA_VOICE_AUDIO_INVALID:'没有收到有效语音，请再说一次。' })[text] || (text.includes('aborted') || text === 'CALL_CANCELLED' ? '本次操作已停止。' : text); }
function activity(text = '') { $('activity').textContent = text; }
function updateControls() { $('sendButton').disabled = !!turn || !connected || (!$('input').value.trim() && !attachment); $('cancelTurn').hidden = !turn; $('voiceButton').classList.toggle('active', !!voice); $('voiceButton').querySelector('span').textContent = voice ? '语音待机已开启' : '开启语音待机'; }
function renderText(element,text){element.replaceChildren();for(const part of String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)){if(part.startsWith('**')&&part.endsWith('**')){const node=document.createElement('strong');node.textContent=part.slice(2,-2);element.append(node);}else if(part.startsWith('`')&&part.endsWith('`')){const node=document.createElement('code');node.textContent=part.slice(1,-1);element.append(node);}else element.append(document.createTextNode(part));}}
function message(role, text, options = {}) {
  $('welcome').hidden = true; const row = document.createElement('article'), label = document.createElement('span'), bubble = document.createElement('div');
  row.className = `message ${role}${options.pending ? ' pending' : ''}${options.error ? ' error' : ''}`; label.className = 'message-label'; label.textContent = role === 'user' ? '你' : 'AI CPE'; bubble.className = 'bubble'; renderText(bubble,text);
  if (options.image) { const img = document.createElement('img'); img.src = options.image; img.alt = '用户提供的图片'; bubble.append(img); }
  row.append(label, bubble); $('messages').append(row); row.scrollIntoView({ block:'end' });
  return { row, set(value, error = false) { row.classList.remove('pending'); row.classList.toggle('error', error); renderText(bubble,value); } };
}
async function api(path, body, signal) {
  const response = await fetch(path, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify(body), signal });
  const result = await response.json(); if (!response.ok || result.status === 'error') throw new Error(result.error || '请求未完成'); return result;
}
const call = (name, args = {}, signal) => api('/api/call', { name, args }, signal);
async function audioContext() { context ||= new AudioContext(); await context.resume(); return context; }
async function playBuffer(buffer, signal, onStart) {
  signal?.throwIfAborted(); const ctx = await audioContext();
  return new Promise((resolve, reject) => {
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination); player = source;
    const finish = error => { source.onended = null; source.disconnect(); signal?.removeEventListener('abort', abort); if (player === source) { player = undefined; playerStop = undefined; } error ? reject(error) : resolve(); };
    const abort = () => { try { source.stop(); } catch {} finish(new Error('CALL_CANCELLED')); };
    playerStop = abort; source.onended = () => finish(); signal?.addEventListener('abort', abort, { once:true }); source.start(); onStart?.();
  });
}
async function playAsset(id, signal, onStart) { const res = await fetch(`/api/assets/${id}`, { headers:{ Authorization:`Bearer ${token}` }, signal }); if (!res.ok) throw new Error('无法读取语音'); const ctx = await audioContext(); await playBuffer(await ctx.decodeAudioData(await res.arrayBuffer()), signal, onStart); }
async function speak(text,signal,onText){
 const activeVoice=voice;let prefs={};try{prefs=JSON.parse(localStorage.getItem('sky-preferences')||'{}');}catch{}
 const profile=prefs.voiceProfile==='male'?'male':'female',rate=Number.isFinite(prefs.speechRate)?Math.min(1.2,Math.max(.85,prefs.speechRate)):1;
 const speech=await call('media_synthesize_speech',{text,concise:true,profile,rate},signal);
 try{await playAsset(speech.asset.id,signal,()=>{if(activeVoice&&voice===activeVoice){enqueueVoice(activeVoice,activeVoice.gate.flush());activeVoice.speaking=true;voiceState('正在回答','播放结束后继续聆听');}onText?.(text);});}
 finally{if(activeVoice){activeVoice.speaking=false;activeVoice.quietUntil=Date.now()+200;}await api('/api/delete',{assetId:speech.asset.id}).catch(()=>{});}
}

function clearAttachment() { if (previewUrl) { const oldUrl=previewUrl; setTimeout(()=>URL.revokeObjectURL(oldUrl),30000); } attachment = undefined; previewUrl = undefined; $('attachment').hidden = true; $('attachmentImage').hidden = true; $('attachmentImage').removeAttribute('src'); updateControls(); }
function stage(asset, blob) { clearAttachment(); attachment = asset; $('attachment').hidden = false; $('attachmentText').textContent = asset.kind === 'image' ? '图片已添加，可附上你的问题' : '音频已添加'; if (blob && asset.kind === 'image') { previewUrl = URL.createObjectURL(blob); $('attachmentImage').src = previewUrl; $('attachmentImage').hidden = false; } updateControls(); }
function dataBase64(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); }); }
async function upload(blob, signal) { if (blob.size > 16 * 1024 * 1024) throw new Error('文件需小于16MB'); return (await api('/api/upload', { data:await dataBase64(blob) }, signal)).asset; }
async function sendText() {
  if (turn || !connected) return; const text = $('input').value.trim(), asset = attachment, preview = previewUrl; if (!text && !asset) return;
  const controller = new AbortController(); turn = controller; updateControls(); message('user', text || '请分析这张图片。', { image:preview }); $('input').value = ''; $('input').style.height = ''; clearAttachment();
  const pending = message('assistant','我来确认一下…',{ pending:true }); activity('正在处理');
  try { const result = await api('/api/chat', { text, ...(asset ? { assetId:asset.id } : {}) }, controller.signal); const answer = result.answer || '本次处理完成。'; if ($('readTextAnswers').checked) { try { await speak(answer, controller.signal, value => pending.set(value)); } catch (error) { if (controller.signal.aborted) throw error; pending.set(answer); activity(`播报未完成：${friendly(error)}`); } } else pending.set(answer); }
  catch (error) { pending.set(friendly(error), true); }
  finally { turn = undefined; activity(); updateControls(); void drainVoice(); }
}
function voiceState(title, detail) { $('voiceTitle').textContent = title; $('voiceDetail').textContent = detail; }
function enqueueVoice(session, utterance, capture = {mode:'speech_segment',inputSampleRate:session.rate}) {
  if (!utterance || voice !== session) return;
  try{session.queue.push(utterance,capture);void drainVoice();}
  catch(error){message('assistant',friendly(error),{error:true});endVoice();}
}
function setAwake(session, awake, afterSample) {
  if (session.awake === awake) return;
  const tail=awake?session.wakeWindow.continuation(afterSample,session.queue.items):new Float32Array();
  session.awake = awake; session.generation++; session.queue.clear();
  session.wakeWindow.reset(); session.gate.reset();
  for(let at=0;at<tail.length;at+=128)enqueueVoice(session,session.gate.push(tail.subarray(at,at+128)));
}
async function startVoice() {
  if (voice) { endVoice(); return; } const session = { id:crypto.randomUUID(), controller:new AbortController(), queue:[], speaking:false, awake:false, generation:0, startupWindows:[], serverReady:false, captureReady:false }; voice = session; $('voicePanel').hidden = false; updateControls(); voiceState('正在准备语音待机','并行连接麦克风和本地模型');
  const ready = api('/api/voice/start', {sessionId:session.id}, session.controller.signal); void ready.catch(()=>{});
  try {
    const ctx = await audioContext(); session.rate = ctx.sampleRate; session.stream = await navigator.mediaDevices.getUserMedia({ video:false, audio:microphoneConstraints }); session.controller.signal.throwIfAborted();
    await ctx.audioWorklet.addModule('/recorder.js'); session.queue=new AudioBacklog(ctx.sampleRate);session.gate = new VoiceGate(ctx.sampleRate); session.wakeWindow = new WakeWindow(ctx.sampleRate); session.input = ctx.createMediaStreamSource(session.stream); session.node = new AudioWorkletNode(ctx,'pcm-recorder'); session.mute = ctx.createGain(); session.mute.gain.value = 0;
    void fetch('/api/voice/ack', { headers:{ Authorization:`Bearer ${token}` }, signal:session.controller.signal }).then(async r => { if (!r.ok) throw new Error(); session.ack = await ctx.decodeAudioData(await r.arrayBuffer()); }).catch(() => {});
    session.node.port.onmessage = event => {
      if (session.controller.signal.aborted) return;
      if (!session.captureReady) { session.captureReady=true; if(session.serverReady)voiceState('等待唤醒','麦克风已开始采样，请说 Hi Claude'); }
      if (session.speaking || Date.now() < (session.quietUntil || 0)) { session.gate.reset(); session.wakeWindow.reset(); return; }
      if (!session.awake) {
        const utterance = session.wakeWindow.push(event.data); let power=0;for(const v of event.data)power+=v*v;
        $('voiceMeter').style.width=`${Math.min(100,Math.sqrt(power/event.data.length)*2500)}%`;
        if (utterance) {
          const capture={...session.wakeWindow.lastCapture};
          enqueueVoice(session,utterance,capture);
        }
        return;
      }
      const utterance = session.gate.push(event.data); $('voiceMeter').style.width = `${Math.min(100, session.gate.lastRms * 2500)}%`;
      enqueueVoice(session, utterance);
    };
    // Attach the receiver before connecting the graph: no startup audio event gap.
    session.input.connect(session.node); session.node.connect(session.mute); session.mute.connect(ctx.destination);
    await ready; session.controller.signal.throwIfAborted(); session.serverReady=true;
    void drainVoice();
    voiceState(session.captureReady?'等待唤醒':'正在连接麦克风',session.captureReady?'请说 Hi Claude，收到提示后再说问题':'等待第一帧音频采样');
  } catch (error) { if (!session.controller.signal.aborted) message('assistant',`语音待机未启动：${friendly(error)}`,{ error:true }); endVoice(); }
}
function endVoice() { const session = voice; if (!session) return; session.controller.abort(); session.turn?.abort(); session.stream?.getTracks().forEach(t => t.stop()); session.node?.disconnect(); session.input?.disconnect(); session.mute?.disconnect(); playerStop?.(); session.queue?.clear();session.gate?.reset();session.wakeWindow?.reset();voice = undefined; void api('/api/voice/end',{sessionId:session.id}).catch(()=>{}); $('voicePanel').hidden = true; $('voiceMeter').style.width = '0%'; updateControls(); }
async function drainVoice() {
  const session = voice; if (!session || !session.serverReady || session.processing || turn || !session.queue.length) return;
  session.processing = true; const controller = new AbortController(); session.turn = controller; turn = controller; updateControls();
  const signal = AbortSignal.any([controller.signal,session.controller.signal]); let pending, answer, ack = Promise.resolve(), receivedFinal = false;
  voiceState(session.awake?'正在核对说话人':'等待唤醒',session.awake?'匹配当前会话的声音后再识别':'本地检测 Hi Claude，不将环境谈话交给对话模型');
  try {
    const segment=session.queue.shift();const encodedAudio=await audioWav(segment.samples,session.rate);
    const res = await fetch('/api/voice/turn', { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify({ sessionId:session.id, audio:encodedAudio, capture:segment.capture }), signal });
    if (!res.ok) throw new Error((await res.json()).error);
    const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const {done,value} = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), {stream:!done}); const events = buffer.split('\n\n'); buffer = events.pop();
        for (const event of events) { const line = event.split('\n').find(l => l.startsWith('data:')); if (!line) continue; const data = JSON.parse(line.slice(5));
          if (data.type === 'voice_identity') {
            if (data.status !== 'accepted') receivedFinal = true;
            if (data.status === 'woke') { setAwake(session,true,segment.capture?.endSample); session.notice='已唤醒，请说你的问题；后续任何人都可以继续提问'; pending=message('assistant','已唤醒，正在准备语音…',{pending:true}); if(!session.gate.parts.length&&!session.queue.length)await speak('我在，请说你的问题。',signal,value=>pending.set(value));else pending.set('我在，请继续。'); }
            if (data.status === 'accepted') { setAwake(session,true); session.notice='语音已唤醒，任何人都可以继续提问'; }
            if (data.status === 'waiting_wake') { setAwake(session,false); session.notice='请说 Hi Claude'; }
          }
          if (data.type === 'transcript') message('user',data.text);
          if (data.type === 'ack') { pending = message('assistant','正在确认…',{pending:true}); voiceState('正在确认','正在处理，仍可收音；播放时暂停收音'); if (session.ack && !session.gate.parts.length && !session.gate.attack) { session.speaking = true; ack = playBuffer(session.ack,signal, () => pending.set(data.text)).catch(() => {}).finally(() => { session.speaking = false; session.quietUntil = Date.now()+200; session.gate.reset(); }); } }
          if (data.type === 'state' && data.text) { activity(data.text); voiceState('正在确认',data.text); }
          if (data.type === 'silent') { receivedFinal = true; voiceState('正在聆听','没有识别到清楚的人声，请再说一次'); }
          if (data.type === 'error') throw new Error(data.error);
          if (data.type === 'answer') { receivedFinal = true; answer = data.answer || '本次处理完成。'; pending ||= message('assistant','正在准备语音…',{pending:true}); }
        }
        if (done) break;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!receivedFinal) throw new Error('语音连接提前结束，请再试一次。');
    await ack;
    if (answer) { voiceState('正在准备回答','仍可收音，语音开始播放时显示回答'); try { await speak(answer,signal, value => pending.set(value)); } catch (error) { if (signal.aborted) throw error; pending.set(answer); message('assistant',`播报未完成：${friendly(error)}`,{error:true}); } }
  } catch (error) { if (!signal.aborted) { if (pending) pending.set(friendly(error),true); else message('assistant',friendly(error),{error:true}); } }
  finally { session.processing = false; session.turn = undefined; if (turn === controller) turn = undefined; activity(); updateControls(); if (voice === session) { voiceState(session.awake?'正在聆听':'等待唤醒',session.notice || '请说 Hi Claude'); void drainVoice(); } }
}
function openPlan() { $('planError').textContent = ''; $('planDialog').showModal(); $('planObjective').focus(); }
async function preparePlan(event) { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const plan = await api('/api/monitor/prepare',{ objective:$('planObjective').value.trim(),durationSeconds:Math.round(Number($('planMinutes').value)*60),intervalSeconds:Number($('planInterval').value),summarize:$('planSummary').checked }); $('planDialog').close(); renderPlan(plan); await refreshReports(); } catch(error) { $('planError').textContent = friendly(error); } finally { button.disabled = false; } }
function renderPlan(task) {
  if (renderedPlans.has(task.id)) return; renderedPlans.add(task.id); $('welcome').hidden = true;
  const card = document.createElement('section'); card.className = 'plan-card'; const heading = document.createElement('h3'); heading.textContent = '请确认这次监测任务';
  const details = document.createElement('p'); details.textContent = `目标：${task.plan.objective}\n持续：${task.plan.durationSeconds/60} 分钟 · 每 ${task.plan.intervalSeconds} 秒采样\n记录：关键画面 + 过程${task.plan.summarize ? ' + 总结' : '（不生成模型总结）'}\n默认保存：reports/monitoring/${task.id}/index.html\n确认前不会打开摄像头。`; const actions = document.createElement('div'); actions.className = 'card-actions';
  const confirm = document.createElement('button'), cancel = document.createElement('button'); confirm.className='primary-button'; confirm.textContent='确认并开始'; cancel.className='quiet-button'; cancel.textContent='取消';
  confirm.onclick = async () => { confirm.disabled=true; try { if (photo || monitor) throw new Error('摄像头正在使用，请先结束当前任务。'); await api('/api/terminal/poll',{terminalId,armed:true}); const s=await api('/api/monitor/confirm',{taskId:task.id,terminalId}); confirm.textContent='已确认'; cancel.disabled=true; syncTask(s); } catch(e) { confirm.disabled=false; activity(friendly(e)); } };
  cancel.onclick = async () => { try { await api('/api/monitor/cancel',{taskId:task.id}); confirm.disabled=true; cancel.disabled=true; heading.textContent='已取消此计划'; await refreshReports(); } catch(e) { activity(friendly(e)); } };
  actions.append(confirm,cancel); card.append(heading,details,actions); $('messages').append(card); card.scrollIntoView({block:'end'});
}
async function openReport(task) {
  try { const response=await fetch(task.reportUrl,{headers:{Authorization:`Bearer ${token}`}}); if(!response.ok) throw new Error('报告暂不可读取'); const blob=await response.blob(), url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download=`摄像头监测-${task.id}.html`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),30000); } catch(error) { activity(friendly(error)); }
}
function renderReports(tasks) {
  $('reportList').replaceChildren();
  if(!tasks.length){const p=document.createElement('p');p.className='muted empty';p.textContent='完成的任务会保存在这里';$('reportList').append(p);return;}
  for(const task of tasks){ const item=document.createElement('div');item.className='report-item';const name=document.createElement('strong');name.textContent=task.plan.objective;name.title=task.plan.objective;const meta=document.createElement('small');meta.textContent=`${statusNames[task.state]||task.state} · ${task.frames} 次观测`;item.append(name,meta);if(task.state!=='awaiting_confirmation'){const button=document.createElement('button');button.className='text-button';button.textContent='下载图文记录';button.onclick=()=>openReport(task);item.append(button);}else renderPlan(task);$('reportList').append(item);}
}
async function refreshReports(){try{renderReports((await api('/api/monitor/list',{})).tasks);}catch(e){activity(friendly(e));}}
function releaseMonitor(){if(monitor)stoppedTasks.add(monitor.id);monitor?.controller.abort();monitor?.stream?.getTracks().forEach(t=>t.stop());$('monitorVideo').srcObject=null;}
function syncTask(task){if(currentTask?.confirmedAt&&(!task.confirmedAt||Date.parse(task.confirmedAt)<Date.parse(currentTask.confirmedAt)))return;if(monitor?.id===task.id&&task.state==='awaiting_confirmation')return;currentTask=task;const active=['starting','running','finalizing'].includes(task.state);$('taskBanner').hidden=!active;$('stopTask').disabled=task.state==='finalizing';if(active)$('taskBannerText').textContent=`${statusNames[task.state]} · ${task.frames} 次观测 · 结束后保存图文记录`;if(!['starting','running'].includes(task.state)){releaseMonitor();return;}if(stoppedTasks.has(task.id)){void call('media_stop_monitor').catch(()=>{});return;}if(!monitor){const session={id:task.id,controller:new AbortController()};monitor=session;void runMonitor(task,session);}}
function wait(ms,signal){return new Promise((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(new Error('CALL_CANCELLED'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}
async function snapshot(video){if(!video.videoWidth)throw new Error('摄像头没有返回画面');const c=document.createElement('canvas'),ratio=Math.min(1,960/video.videoWidth,540/video.videoHeight);c.width=Math.round(video.videoWidth*ratio);c.height=Math.round(video.videoHeight*ratio);c.getContext('2d').drawImage(video,0,0,c.width,c.height);return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('无法生成图片')),'image/jpeg',.78));}
async function runMonitor(task,session){const signal=session.controller.signal;try{if(photo)throw new Error('请先结束单次拍照');session.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:960},height:{ideal:540}}});signal.throwIfAborted();const video=$('monitorVideo');video.srcObject=session.stream;await video.play();for(let i=0;!video.videoWidth&&i<30;i++)await wait(100,signal);if(task.state==='starting')await api('/api/monitor/ready',{taskId:task.id,terminalId},signal);let sequence=task.frames+1;while(!signal.aborted){const started=Date.now(),capturedAt=new Date().toISOString(),blob=await snapshot(video);await api('/api/monitor/frame',{taskId:task.id,terminalId,sequence,capturedAt,data:await dataBase64(blob)},signal);sequence++;await wait(Math.max(30,task.plan.intervalSeconds*1000-(Date.now()-started)+30),signal);}}catch(error){if(!signal.aborted){activity(friendly(error));await api('/api/monitor/error',{taskId:task.id,terminalId}).catch(()=>{});}}finally{session.stream?.getTracks().forEach(t=>t.stop());if(monitor===session){monitor=undefined;$('monitorVideo').srcObject=null;}}}
async function stopTask(){releaseMonitor();$('stopTask').disabled=true;try{await call('media_stop_monitor');await refreshReports();}catch(error){activity(friendly(error));}}
function closePhoto(error=new Error('用户取消拍照')){if(!photo)return;photo.stream?.getTracks().forEach(t=>t.stop());photo.reject?.(error);photo=undefined;$('photoVideo').srcObject=null;$('photoDialog').close();}
function requestPhoto(purpose,signal){if(photo||monitor)return Promise.reject(new Error('摄像头正在使用，请先结束当前任务'));return new Promise((resolve,reject)=>{photo={purpose,resolve,reject,signal};$('photoPurpose').textContent=purpose;$('photoError').textContent='';$('photoVideo').hidden=true;$('openPhoto').hidden=false;$('shutter').hidden=true;$('photoDialog').showModal();const abort=()=>closePhoto(new Error('CALL_CANCELLED'));signal?.addEventListener('abort',abort,{once:true});photo.finish=(asset,blob)=>{signal?.removeEventListener('abort',abort);photo?.stream?.getTracks().forEach(t=>t.stop());photo=undefined;$('photoVideo').srcObject=null;$('photoDialog').close();resolve({asset,blob});};});}
$('openPhoto').onclick=async()=>{const session=photo;if(!session)return;$('openPhoto').disabled=true;try{session.stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720}}});if(photo!==session||session.signal?.aborted){session.stream.getTracks().forEach(t=>t.stop());return;}$('photoVideo').srcObject=session.stream;$('photoVideo').hidden=false;await $('photoVideo').play();$('openPhoto').hidden=true;$('shutter').hidden=false;}catch(e){$('photoError').textContent=friendly(e);}finally{$('openPhoto').disabled=false;}};
$('shutter').onclick=async()=>{const session=photo;if(!session)return;$('shutter').disabled=true;try{const blob=await snapshot($('photoVideo')),asset=await upload(blob,session.signal);session.finish(asset,blob);}catch(e){$('photoError').textContent=friendly(e);}finally{$('shutter').disabled=false;}};
async function recordOnce(seconds,signal){if(voice)throw new Error('请先结束连续语音交流');const ctx=await audioContext();let stream,node,input,mute;try{stream=await navigator.mediaDevices.getUserMedia({video:false,audio:microphoneConstraints});await ctx.audioWorklet.addModule('/recorder.js');const parts=[];node=new AudioWorkletNode(ctx,'pcm-recorder');input=ctx.createMediaStreamSource(stream);mute=ctx.createGain();mute.gain.value=0;node.port.onmessage=e=>parts.push(e.data);input.connect(node);node.connect(mute);mute.connect(ctx.destination);activity(`正在录音 ${seconds} 秒…`);await wait(seconds*1000,signal);node.port.onmessage=null;const count=parts.reduce((n,p)=>n+p.length,0),samples=new Float32Array(count);let offset=0;for(const p of parts){samples.set(p,offset);offset+=p.length;}return (await api('/api/upload',{data:await audioWav(samples,ctx.sampleRate)},signal)).asset;}finally{stream?.getTracks().forEach(t=>t.stop());node?.disconnect();input?.disconnect();mute?.disconnect();activity();}}
const commands=new Map();async function execute(command){const controller=new AbortController();commands.set(command.id,controller);const timer=setTimeout(()=>controller.abort(),Math.max(0,command.deadline-Date.now()));let result={};try{if(command.kind==='photo')result.assetId=(await requestPhoto(command.args.purpose||'拍摄一张当前画面，用于本次问题分析。',controller.signal)).asset.id;else if(command.kind==='record')result.assetId=(await recordOnce(command.args.seconds,controller.signal)).id;else if(command.kind==='play')await playAsset(command.args.assetId,controller.signal);else if(command.kind==='stop')playerStop?.();}catch(error){result={error:true};activity(friendly(error));}finally{clearTimeout(timer);commands.delete(command.id);}await api('/api/terminal/result',{terminalId,id:command.id,...result}).catch(()=>{});}
let lastLists='',lastStatus=0;async function poll(){try{if(!/^[a-f0-9]{64}$/.test(token))throw new Error('请打开服务启动时输出的完整链接');const state=await api('/api/terminal/poll',{terminalId,armed:true});for(const[id,controller]of commands)if(!state.activeIds.includes(id))controller.abort();for(const command of state.commands)void execute(command);syncTask(state.monitor);const key=JSON.stringify(state.monitorTasks);if(key!==lastLists){lastLists=key;renderReports(state.monitorTasks);}if(Date.now()-lastStatus>4000){connected=(await call('media_status')).agentConnected;lastStatus=Date.now();}$('connection').classList.remove('off');$('connectionText').textContent=connected?'助手已连接':'媒体服务已连接';updateControls();}catch(error){connected=false;releaseMonitor();$('connection').classList.add('off');$('connectionText').textContent='连接中断';activity(friendly(error));updateControls();}setTimeout(poll,750);}
$('sendButton').onclick=sendText;$('input').oninput=()=>{$('input').style.height='auto';$('input').style.height=`${Math.min(150,$('input').scrollHeight)}px`;updateControls();};$('input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!$('sendButton').disabled)void sendText();}};
$('cancelTurn').onclick=()=>{turn?.abort();playerStop?.();};$('voiceButton').onclick=startVoice;$('endVoice').onclick=endVoice;$('cameraButton').onclick=async()=>{try{const result=await requestPhoto('拍摄一张照片，供你确认后发送给助手分析。不会持续录制。');stage(result.asset,result.blob);}catch(error){if(error.message!=='用户取消拍照')activity(friendly(error));}};
$('cancelPhoto').onclick=()=>closePhoto();$('closePhoto').onclick=()=>closePhoto();$('photoDialog').addEventListener('cancel',e=>{e.preventDefault();closePhoto();});
$('uploadButton').onclick=()=>$('fileInput').click();$('fileInput').onchange=async()=>{const file=$('fileInput').files[0];if(!file)return;try{stage(await upload(file),file);}catch(e){activity(friendly(e));}finally{$('fileInput').value='';}};$('removeAttachment').onclick=clearAttachment;
$('suggestTools').onclick=()=>{$('input').value='现在可以查询哪些设备信息？';updateControls();$('input').focus();};$('suggestMonitor').onclick=openPlan;$('planNav').onclick=openPlan;$('planForm').onsubmit=preparePlan;$('closePlan').onclick=()=>$('planDialog').close();$('cancelPlan').onclick=()=>$('planDialog').close();$('refreshReports').onclick=refreshReports;$('stopTask').onclick=stopTask;
$('preferencesButton').onclick=()=>$('preferencesDialog').showModal();$('closePreferences').onclick=()=>$('preferencesDialog').close();$('menuButton').onclick=()=>$('sidebar').classList.toggle('open');$('chatNav').onclick=()=>$('sidebar').classList.remove('open');
window.addEventListener('pagehide',()=>{endVoice();releaseMonitor();closePhoto();turn?.abort();for(const c of commands.values())c.abort();void context?.close();});
void poll();

