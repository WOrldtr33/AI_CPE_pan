import {createRequire} from 'node:module';
import {join} from 'node:path';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createMediaService} from '../media/service.mjs';
import {mediaConfig} from '../media/config.mjs';
import {pcmWav} from '../media/omni.mjs';
const root=process.cwd(),require=createRequire(import.meta.url);
const {chromium}=require(join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
await mkdir(join(root,'reports/mock'),{recursive:true});
const dir=await mkdtemp(join(root,'.media-state/home-voice-smoke-')),checks=[],errors=[];
let service,browser,page,guardCalls=0,chatCalls=0,releaseReply,notifyChat;
const firstChat=new Promise(resolve=>notifyChat=resolve),replyGate=new Promise(resolve=>releaseReply=resolve);
const question='查询当前联网情况',answer='当前网络检查已经完成。上联尚未连接。';
function tone(seconds){const pcm=Buffer.alloc(Math.round(16000*seconds)*2);for(let n=0;n<pcm.length/2;n++)pcm.writeInt16LE(Math.round(Math.sin(n/16000*Math.PI*660)*3000),n*2);return pcmWav(pcm,16000);}
try{
 const env={MEDIA_STATE_DIR:dir,MEDIA_REPORT_DIR:join(dir,'reports'),MEDIA_PORT:'0'};
 for(const kind of ['ASR','TTS','VISION'])Object.assign(env,{[`MEDIA_${kind}_BASE_URL`]:'https://mock.invalid/v1',[`MEDIA_${kind}_MODEL`]:'mock',[`MEDIA_${kind}_API_KEY`]:'mock'});
 const pcm=Buffer.alloc(16000*6*2);for(let n=0;n<16000*6;n++)pcm.writeInt16LE(Math.floor(n/16000)%2===0?Math.round(Math.sin(n/16000*Math.PI*880)*3000):0,n*2);
 const fakeMic=join(dir,'fake-mic.wav');await writeFile(fakeMic,pcmWav(pcm,16000));
 service=await createMediaService(mediaConfig(env),{voiceGuard:{open:async()=>{guardCalls=0;},reset:()=>{},check:async()=>++guardCalls===1?{status:'woke'}:{status:'accepted'}},fetchImpl:async(url,options)=>{
  if(url.endsWith('audio/transcriptions'))return Response.json({text:question});
  if(url.endsWith('audio/speech')){const text=JSON.parse(options.body).input;return new Response(tone(text===answer?2.5:.2));}
  throw new Error('Unexpected mock request '+url);
 }});
 service.setChatHandler(async()=>{chatCalls++;notifyChat();if(chatCalls===1)await replyGate;return{status:'answered',answer};});
 service.setDashboardHandler(async action=>{if(action==='history')return{points:[]};if(action==='snapshot'){await new Promise(resolve=>setTimeout(resolve,1200));return{observedAt:Date.now(),available:true,online:false,clients:3,device:{model:'Mock CPE'},ips:{lan:'192.168.0.1'}};}});
 const address=await service.listen();
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+fakeMic]});
 page=await browser.newPage({viewport:{width:1440,height:1040}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__micCalls=0;window.__streams=[];window.__plays=0;const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{window.__micCalls++;const stream=await original(options);window.__streams.push(stream);return stream;};const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.context.constructor.name==='AudioContext'&&this.buffer?.duration>.6)window.__plays++;return start.apply(this,args);};});
 await page.goto(address);await page.getByRole('button',{name:'关闭语音唤醒',exact:true}).waitFor({timeout:15000});assert.equal(await page.locator('.ai-conversation').count(),0);checks.push('automatic microphone standby without orb click or autoplay override');
 await Promise.race([firstChat,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No voice chat request')),25000))]);
 assert.equal(await page.locator('.ai-conversation').count(),0);assert.ok(!(await page.locator('body').textContent()).includes(question));assert.equal(await page.evaluate(()=>window.__micCalls),1);
 await page.getByRole('button',{name:'进入 AI 交互',exact:true}).click();await page.locator('.user-question').filter({hasText:question}).waitFor();assert.ok((await page.locator('.ai-orb-caption').textContent()).includes('正在思考'));checks.push('home wake stays collapsed; opening shows the same in-flight transcript and state');
 await page.getByRole('button',{name:'收起 AI 对话'}).click();releaseReply();await page.waitForFunction(()=>window.__plays>0,{timeout:20000});assert.equal(await page.locator('.ai-conversation').count(),0);assert.ok(!(await page.locator('body').textContent()).includes(answer));
 await page.getByRole('button',{name:'进入 AI 交互',exact:true}).click();await page.locator('.ai-reply').filter({hasText:answer}).waitFor();assert.ok((await page.locator('.ai-orb-caption').textContent()).includes('正在回答'));assert.equal(await page.evaluate(()=>window.__micCalls),1);await page.screenshot({path:join(root,'reports/mock/home-voice-expanded.png')});checks.push('collapse does not abort reply audio; reopening shares answer and speaking state with one microphone');
 await page.getByRole('button',{name:'收起 AI 对话'}).click();await page.screenshot({path:join(root,'reports/mock/home-voice-dashboard.png')});await page.getByRole('button',{name:'关闭语音唤醒',exact:true}).click();await page.waitForTimeout(3300);assert.equal(await page.evaluate(()=>window.__micCalls),1);assert.equal(await page.evaluate(()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))),true);assert.equal(await page.evaluate(()=>localStorage.getItem('sky-voice-standby')),'off');checks.push('explicit stop releases microphone and connectivity polling does not restart it');
 await page.reload();await page.getByRole('button',{name:'开启语音唤醒',exact:true}).waitFor();await page.waitForTimeout(3300);assert.equal(await page.evaluate(()=>window.__micCalls),0);await page.getByRole('button',{name:'开启语音唤醒',exact:true}).click();await page.getByRole('button',{name:'关闭语音唤醒',exact:true}).waitFor();assert.equal(await page.locator('.ai-conversation').count(),0);await page.getByRole('button',{name:'关闭语音唤醒',exact:true}).click();checks.push('opt-out survives reload; homepage button restarts voice without opening chat');
 await page.evaluate(()=>localStorage.removeItem('sky-voice-standby'));await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{window.__micCalls++;throw new DOMException('Denied','NotAllowedError');};});await page.reload();await page.getByRole('alert').filter({hasText:'允许麦克风权限'}).waitFor();await page.waitForTimeout(3300);assert.equal(await page.evaluate(()=>window.__micCalls),1);assert.equal(await page.locator('.ai-conversation').count(),0);checks.push('permission denial remains visible on home and is not automatically retried');
 assert.deepEqual(errors,[]);const report={status:'passed',syntheticOnly:true,checks};await writeFile(join(root,'reports/mock/home-voice-ui-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page)await page.screenshot({path:join(root,'reports/mock/home-voice-failure.png'),fullPage:true});await writeFile(join(root,'reports/mock/home-voice-ui-results.json'),JSON.stringify({status:'failed',syntheticOnly:true,checks,error:error.message},null,2));console.error(error);process.exitCode=1;}
finally{releaseReply?.();await browser?.close();await service?.close();await rm(dir,{recursive:true,force:true});}
