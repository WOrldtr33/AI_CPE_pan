// 声纹门控在 voice-identity-live-smoke.mjs 单独验证；此脚本注入通过门控，检查后续真实模型链路。
// 真实模型检查：只发送生成的语音、纯色画面和测试请求，设备地址固定为本机不可用端口。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMediaService } from '../media/service.mjs';
import { mediaConfig } from '../media/config.mjs';
import { loadMediaCredentials } from '../media/credentials.mjs';
import { MediaProviders } from '../media/providers.mjs';
import { attachWebAgent } from '../src/agent-web.mjs';
import { root } from '../src/agent-config.mjs';
import { timestamp } from '../src/time.mjs';
const run=promisify(execFile);if(existsSync(join(root,'.env')))process.loadEnvFile(join(root,'.env'));
await mkdir(join(root,'.media-state'),{recursive:true});const directory=await mkdtemp(join(root,'.media-state/workflow-live-'));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^T830_/.test(k)));
Object.assign(env,{MEDIA_STATE_DIR:directory,MEDIA_REPORT_DIR:join(root,'reports/mock/monitoring-demo',randomUUID()),MEDIA_PORT:'0',AGENT_STATE_DIR:join(directory,'agent'),AGENT_TOOLS:'version,workmode',AGENT_ENABLE_WRITES:'0',AGENT_RESTORE_SESSION:'0',T830_BASE_URL:'http://127.0.0.1:9'});
const settings=mediaConfig(loadMediaCredentials(env)),service=await createMediaService(settings,{voiceGuard:{check:async()=>({status:'accepted',samples:1})}}),providers=new MediaProviders(settings),report={at:timestamp(),syntheticOnly:true,realDeviceAccess:false,speakerGateSimulated:true,results:[]};let web,heartbeat;
try{
 const address=(await service.listen()).split('/#')[0];web=await attachWebAgent(service,env);const terminalId=randomUUID();
 const post=async(path,body)=>{const response=await fetch(address+path,{method:'POST',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok||value.status==='error')throw new Error(value.error);return value;};
 const poll=()=>post('/api/terminal/poll',{terminalId,armed:true});await poll();heartbeat=setInterval(()=>void poll().catch(()=>{}),1000);
 const raw=join(directory,'raw.wav'),wav=join(directory,'voice.wav');await writeFile(raw,await providers.speech('现在可以查询哪些指令？'));await run(settings.ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',raw,'-ac','1','-ar','16000',wav],{windowsHide:true});
 const response=await fetch(address+'/api/voice/turn',{method:'POST',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},body:JSON.stringify({audio:(await readFile(wav)).toString('base64')})});const stream=await response.text();const events=stream.split('\n\n').filter(s=>s.startsWith('data:')).map(s=>JSON.parse(s.slice(5)));report.results.push({step:'voice_transcript_ack_answer',events});if(!events.some(e=>e.type==='transcript')||!events.some(e=>e.type==='ack')||!events.some(e=>e.type==='answer')){console.log(JSON.stringify(events));throw new Error('MEDIA_VOICE_LIVE_FAILED');}console.log('Voice transcript + acknowledgement + real Agent answer: passed');
 const vague=await post('/api/chat',{text:'帮我监控视频画面'});const empty=await post('/api/monitor/list',{});if(empty.tasks.some(t=>t.state!=='cancelled'))throw new Error('MEDIA_VAGUE_PLAN_STARTED');report.results.push({step:'vague_monitor_request',answer:vague.answer,plans:empty.tasks.length});console.log('Vague monitor request clarifies instead of starting: passed');
 await post('/api/chat',{text:'这是虚构测试：监测纯色测试画面的红色背景是否变为蓝色，持续30秒，每3秒采样，需要总结。请生成计划，等我在网页确认后再开始。'});const list=await post('/api/monitor/list',{});const plan=list.tasks.find(t=>t.state==='awaiting_confirmation');if(!plan||plan.frames!==0)throw new Error('MEDIA_MONITOR_PLAN_LIVE_FAILED');report.results.push({step:'agent_plan_waits_for_confirmation',plan:plan.plan});
 await post('/api/monitor/confirm',{taskId:plan.id,terminalId});await post('/api/monitor/ready',{taskId:plan.id,terminalId});
 for(const [index,color]of ['red','blue'].entries()){
  if(index)await new Promise(r=>setTimeout(r,3100));const{stdout}=await run(settings.ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-f','lavfi','-i',`color=c=${color}:s=320x240`,'-frames:v','1','-f','image2pipe','-c:v','mjpeg','pipe:1'],{encoding:'buffer',windowsHide:true});
  await post('/api/monitor/frame',{taskId:plan.id,terminalId,sequence:index+1,capturedAt:new Date().toISOString(),data:stdout.toString('base64')});
 }
 const result=await service.dispatch('media_stop_monitor',{});const stored=JSON.parse(await readFile(join(env.MEDIA_REPORT_DIR,plan.id,'report.json'),'utf8'));if(stored.events.length!==2||!stored.summary||stored.summaryError)throw new Error('MEDIA_REPORT_LIVE_FAILED');report.results.push({step:'camera_sampling_report',state:result.state,reportPath:result.reportPath,summary:stored.summary});report.status='passed';console.log('Confirmed sampling -> two real vision observations -> summary and HTML record: passed');
}catch(error){report.status='failed';report.error=/^MEDIA_[A-Z0-9_]+$/.test(error.message)?error.message:'MEDIA_WORKFLOW_LIVE_FAILED';console.error(report.error);process.exitCode=1;}
finally{clearInterval(heartbeat);await web?.close();await service.close();await mkdir(join(root,'reports/live'),{recursive:true});await writeFile(join(root,'reports/live/media-workflow-live-results.json'),JSON.stringify(report,null,2));await rm(directory,{recursive:true,force:true});}
