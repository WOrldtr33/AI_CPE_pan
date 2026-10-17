import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MonitorTasks } from '../media/monitor-tasks.mjs';
import { createMediaService } from '../media/service.mjs';
import { mediaConfig } from '../media/config.mjs';
import { pcmWav } from '../media/omni.mjs';
import { VoiceGate } from '../media/public/voice-audio.js';
import { connectTools } from '../src/agent-mcp.mjs';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';
const plan = { objective:'监测门口人员经过的情况',durationSeconds:60,intervalSeconds:3,summarize:true };
async function folder(fn) { await mkdir(new URL('../.media-state/',import.meta.url),{recursive:true});const directory=await mkdtemp(new URL('../.media-state/workflow-',import.meta.url));try{await fn(directory);}finally{await rm(directory,{recursive:true,force:true});} }
const provider = overrides => ({settings:{providers:{vision:{ready:true}}},analyze:async()=> '门口出现一名经过的人。',summarize:async()=> '本次采样观察到一人经过；采样间隔存在证据空白。',...overrides});

test('Monitoring proposal never captures; explicit confirm, readiness and duration produce standalone HTML/Markdown evidence',()=>folder(async directory=>{
 let calls=0;const monitor=new MonitorTasks({reportDirectory:directory},provider({analyze:async()=>{calls++;return '门口有人经过。';}}));await monitor.init();
 await assert.rejects(monitor.prepare({...plan,objective:'帮我监控视频画面'}),/OBJECTIVE_REQUIRED/);
 const task=await monitor.prepare(plan);assert.equal(task.state,'awaiting_confirmation');assert.equal(calls,0);
 const input={taskId:task.id,sequence:1,capturedAt:new Date().toISOString(),data:image};
 await assert.rejects(monitor.frame(input,'owner',new AbortController().signal),/SESSION_EXPIRED/);
 await monitor.confirm(task.id,'owner');assert.equal(calls,0);await assert.rejects(monitor.frame(input,'owner',new AbortController().signal),/SESSION_EXPIRED/);
 await monitor.ready(task.id,'owner');await monitor.frame(input,'owner',new AbortController().signal);assert.equal(calls,1);
 monitor.get(task.id).deadline=Date.now()-1;await monitor.tick(true,'owner');const status=monitor.status();assert.equal(status.state,'completed');assert.equal(status.frames,1);
 const html=(await monitor.readReport(task.id,'index.html')).toString();assert(html.includes('data:image/png;base64,'));assert(html.includes('门口有人经过'));assert(html.includes('采样间隔存在证据空白'));
 const saved=JSON.parse((await monitor.readReport(task.id,'report.json')).toString());assert(!('owner' in saved));assert.equal(saved.events.length,1);assert((await monitor.readReport(task.id,'report.md')).toString().includes('images/frame-00001.png'));
}));
test('Monitoring cancellation, unsafe report paths and service restart never open or replay a camera',()=>folder(async directory=>{
 const m=new MonitorTasks({reportDirectory:directory},provider());await m.init();const p=await m.prepare(plan);await m.cancel(p.id);await assert.rejects(m.confirm(p.id,'owner'),/EXPIRED/);
 const p2=await m.prepare(plan);await m.confirm(p2.id,'owner');await m.ready(p2.id,'owner');
 const recovered=new MonitorTasks({reportDirectory:directory},provider());await recovered.init();assert.equal(recovered.status(p2.id).state,'interrupted');assert(!recovered.active());
 await assert.rejects(recovered.readReport(p2.id,'../../credentials-agent.json'),/REPORT_NOT_FOUND/);
}));
test('Monitor stop aborts in-flight inference and persists an honest partial record',()=>folder(async directory=>{
 let entered;const started=new Promise(r=>{entered=r;});
 const m=new MonitorTasks({reportDirectory:directory},provider({analyze:async(_,q,signal)=>{entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return '迟到结果';}}));await m.init();const p=await m.prepare({...plan,summarize:false});await m.confirm(p.id,'owner');await m.ready(p.id,'owner');
 const work=m.frame({taskId:p.id,sequence:1,capturedAt:new Date().toISOString(),data:image},'owner',new AbortController().signal);await started;const stop=m.finish();await assert.rejects(work,/abort|CALL_CANCELLED/i);await stop;assert.equal(m.status().frames,0);assert.equal(m.status().state,'stopped');assert((await m.readReport(p.id,'index.html')).toString().includes('尚未获得'));
}));

async function serviceFixture(fn){return folder(async directory=>{
 const env={MEDIA_STATE_DIR:directory,MEDIA_REPORT_DIR:join(directory,'reports'),MEDIA_PORT:'0',MEDIA_ASR_BASE_URL:'https://mock.invalid/v1',MEDIA_ASR_MODEL:'asr',MEDIA_ASR_API_KEY:'mock',MEDIA_VISION_BASE_URL:'https://mock.invalid/v1',MEDIA_VISION_MODEL:'vision',MEDIA_VISION_API_KEY:'mock'};
 const service=await createMediaService(mediaConfig(env),{voiceGuard:{check:async()=>({status:'accepted',samples:1})},fetchImpl:async url=>url.endsWith('audio/transcriptions')?Response.json({text:'现在可以查询哪些指令？'}):Response.json({choices:[{finish_reason:'stop',message:{content:'模拟观测'}}]})});const origin=(await service.listen()).split('/#')[0];
 const post=(path,body,options={})=>fetch(origin+path,{method:'POST',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},body:JSON.stringify(body),...options});try{await fn({service,env,origin,post});}finally{await service.close();}
});}
test('Continuous voice turn streams user transcript and acknowledgement before Agent answer, after the injected speaker gate, without camera',()=>serviceFixture(async({service,post})=>{
 let resolveAnswer,started;const gate=new Promise(r=>{resolveAnswer=r;}),began=new Promise(r=>{started=r;});let input;
 service.setChatHandler(async body=>{input=body;started();await gate;body.onProgress({type:'state',state:'using_tools',text:'正在查询'});return {status:'answered',answer:'当前可查询工作模式等信息。'};});
 const res=await post('/api/voice/turn',{audio:pcmWav(Buffer.alloc(32000,32),16000).toString('base64')});assert(res.headers.get('Content-Type').includes('event-stream'));
 const reader=res.body.getReader();let text='';const decoder=new TextDecoder();
 while(!text.includes('"type":"ack"')){const item=await reader.read();text+=decoder.decode(item.value);}
 await began;assert(text.includes('现在可以查询哪些指令'));assert(!text.includes('当前可查询工作模式'));assert.equal(input.text,'现在可以查询哪些指令？');assert(!input.assetId);resolveAnswer();
 while(true){const{done,value}=await reader.read();if(done)break;text+=decoder.decode(value);}assert(text.includes('当前可查询工作模式'));assert(text.includes('using_tools'));assert.equal((await service.store.list()).length,0);
}));
test('Voice request disconnect cancels Agent work; overlapping turns are rejected',()=>serviceFixture(async({service,post})=>{
 let entered,finished;const started=new Promise(r=>{entered=r;}),ended=new Promise(r=>{finished=r;});service.setChatHandler(async(_,signal)=>{entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));finished();return{status:'error',error:'CALL_CANCELLED'};});
 const c=new AbortController(),audio=pcmWav(Buffer.alloc(32000,32),16000).toString('base64');const response=await post('/api/voice/turn',{audio},{signal:c.signal});await started;
 assert.equal((await post('/api/voice/turn',{audio})).status,400);c.abort();await response.body.cancel().catch(()=>{});await ended;
}));
test('MCP can prepare a plan but cannot approve it or invoke retired video capabilities',()=>serviceFixture(async({env,service,post})=>{
 const mcp=await connectTools([],env,{enableMedia:true});try{const names=mcp.definitions.map(t=>t.function.name);assert(names.includes('media_prepare_monitor'));assert(!names.includes('media_start_monitor'));assert(!names.includes('media_extract_frame'));
 const p=await mcp.call('media_prepare_monitor',plan);assert.equal(p.state,'awaiting_confirmation');await assert.rejects(mcp.call('media_confirm_monitor',{taskId:p.id}),/TOOL_NOT_ALLOWED/);
 const terminalId=randomUUID();await post('/api/terminal/poll',{terminalId,armed:true});assert.equal((await post('/api/monitor/ready',{taskId:p.id,terminalId})).status,400);assert.equal((await post('/api/monitor/confirm',{taskId:p.id,terminalId})).status,200);
 }finally{await mcp.close();}
}));
test('Voice gate retains quiet speech from the start and rejects steady low noise and short impulses',()=>{
 const gate=new VoiceGate(16000),part=l=>new Float32Array(1600).fill(l);let count=0;
 for(let i=0;i<4;i++)if(gate.push(part(.006)))count++;for(let i=0;i<12;i++)if(gate.push(part(.0003)))count++;assert.equal(count,1);
 gate.push(part(.2));for(let i=0;i<12;i++)if(gate.push(part(.0003)))count++;assert.equal(count,1);
 for(let i=0;i<100;i++)if(gate.push(part(.0008)))count++;assert.equal(count,1);
});
test('Voice capture keeps quiet words and an internal thinking pause in one unchanged segment',()=>{
 const gate=new VoiceGate(16000),frames=[],outputs=[];
 for(let i=0;i<38;i++){
  const speaking=i<8||(i>=16&&i<24), frame=new Float32Array(1600).fill(speaking?.0015:0);
  frames.push(frame);const out=gate.push(frame);if(out)outputs.push(out);
 }
 assert.equal(outputs.length,1);
 assert.equal(outputs[0][0],frames[0][0]);
 assert.equal(outputs[0][17*1600],frames[17][0]);
 assert.ok(outputs[0].length>=34*1600);
});
test('Long speech crosses the old five-second boundary with a bounded 25-second ceiling; playback flush preserves pending words',()=>{
 const gate=new VoiceGate(16000);let output;
 for(let i=0;i<251;i++){output=gate.push(new Float32Array(1600).fill(i<10?.02:.004));if(output)break;}
 assert.ok(output);assert.ok(output.length/16000<=25.11);
 const partial=new VoiceGate(16000);for(let i=0;i<5;i++)partial.push(new Float32Array(1600).fill(.002));
 assert.equal(partial.flush().length,8000);assert.equal(partial.flush(),undefined);
});
