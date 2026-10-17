import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceIdentity } from '../media/voice-identity.mjs';
import { randomUUID } from 'node:crypto';
import { createMediaService } from '../media/service.mjs';
import { mediaConfig } from '../media/config.mjs';
import { pcmWav } from '../media/omni.mjs';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const a=[1,0,0,0,0,0,0,0], b=[0,1,0,0,0,0,0,0];
function fixture(){let result, now=1000;const guard=new VoiceIdentity({start:async()=>{},analyze:async()=>result,close(){}},{clock:()=>now,timeoutMs:1000});return{guard,set:r=>result={wake:false,embedding:a,seconds:3,voicedSeconds:2,clippedFraction:0,...r},time:n=>now=n};}
test('Wake no longer needs a speaker embedding or duration gate; any subsequent speaker is accepted',async()=>{
 const f=fixture(),id=randomUUID();await f.guard.open(id);f.set({});assert.equal((await f.guard.check(id,Buffer.alloc(0))).status,'waiting_wake');
 f.set({wake:true,embedding:null,seconds:.3,voicedSeconds:.1});const wake=await f.guard.check(id,Buffer.alloc(0));assert.equal(wake.status,'woke');assert.equal(wake.diagnostic.speakerCheck,false);
 f.set({embedding:b});assert.equal((await f.guard.check(id,Buffer.alloc(0))).status,'accepted');assert(!f.guard.sessions.get(id).anchor);
});
test('Session expiry requires wake again; reset clears session state',async()=>{
 const f=fixture(),id=randomUUID();await f.guard.open(id);f.set({wake:true});await f.guard.check(id,Buffer.alloc(0));
 f.time(2100);f.set({});assert.equal((await f.guard.check(id,Buffer.alloc(0))).status,'waiting_wake');f.guard.reset(id);assert.equal(f.guard.sessions.size,0);await assert.rejects(f.guard.check(id,Buffer.alloc(0)),/SESSION_REQUIRED/);
});
test('A late wake inference after session end cannot recreate a voice profile',async()=>{
 let resolve;const guard=new VoiceIdentity({start:async()=>{},analyze:()=>new Promise(r=>resolve=r),close(){}});const id=randomUUID();await guard.open(id);
 const check=guard.check(id,Buffer.alloc(0));guard.reset(id);resolve({wake:true,embedding:a,seconds:2,voicedSeconds:1,clippedFraction:0});assert.equal((await check).status,'waiting_wake');assert.equal(guard.sessions.size,0);
});
test('HTTP blocks unwoken background, then allows another speaker; session audio is cleaned on end',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'voice-gate-')),f=fixture();let cloud=0,agent=0,failAsr=false;
 const settings=mediaConfig({MEDIA_VOICE_DIAGNOSTICS:'1',MEDIA_STATE_DIR:directory,MEDIA_REPORT_DIR:join(directory,'reports'),MEDIA_PORT:'0',MEDIA_ASR_BASE_URL:'https://mock.invalid',MEDIA_ASR_MODEL:'asr',MEDIA_ASR_API_KEY:'mock'});
 const service=await createMediaService(settings,{voiceGuard:f.guard,fetchImpl:async()=>{cloud++;if(failAsr)throw new Error('synthetic failure');return Response.json({text:'查询设备状态'});}});
 service.setChatHandler(async()=>{agent++;return{status:'answered',answer:'测试回答'};});
 try{
  const origin=(await service.listen()).split('/#')[0],sessionId=randomUUID();
  const post=(path,body)=>fetch(origin+path,{method:'POST',headers:{Authorization:`Bearer ${service.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  await post('/api/voice/start',{sessionId});const body={sessionId,audio:pcmWav(Buffer.alloc(32000),16000).toString('base64')};
  f.set({});assert.match(await(await post('/api/voice/turn',body)).text(),/waiting_wake/);
  f.set({wake:true});assert.match(await(await post('/api/voice/turn',body)).text(),/woke/);
  f.set({embedding:b});assert.match(await(await post('/api/voice/turn',body)).text(),/测试回答/);assert.equal(cloud,1);assert.equal(agent,1);
  f.set({});assert.match(await(await post('/api/voice/turn',body)).text(),/测试回答/);assert.equal(cloud,2);assert.equal(agent,2);
  const saved=await Promise.all((await readdir(join(directory,'voice-diagnostics'))).map(async id=>{
   const folder=join(directory,'voice-diagnostics',id);assert.deepEqual(await readFile(join(folder,'input.wav')),Buffer.from(body.audio,'base64'));return JSON.parse(await readFile(join(folder,'result.json'),'utf8'));
  }));
  assert.deepEqual(saved.map(r=>r.status).sort(),['waiting_wake','woke','transcribed','transcribed'].sort());
  for(const r of saved){assert.equal(r.sessionId,sessionId);assert.ok(r.identityElapsedMs>=0);assert.equal(r.asrSubmitted,r.status==='transcribed');assert(!JSON.stringify(r).includes('embedding":'));}
  const success=saved.find(r=>r.status==='transcribed');assert.equal(success.transcript,'查询设备状态');assert.ok(success.asrElapsedMs>=0);
  failAsr=true;assert.match(await(await post('/api/voice/turn',body)).text(),/MEDIA_PROVIDER_REQUEST_FAILED/);
  const errors=await Promise.all((await readdir(join(directory,'voice-diagnostics'))).map(async id=>JSON.parse(await readFile(join(directory,'voice-diagnostics',id,'result.json'),'utf8'))));
  const failed=errors.find(r=>r.status==='error');assert.equal(failed.stage,'transcribing');assert.equal(failed.asrSubmitted,true);assert.equal(failed.error,'MEDIA_PROVIDER_REQUEST_FAILED');assert.ok(failed.asrElapsedMs>=0);assert.equal(agent,2);
  await post('/api/voice/end',{sessionId});assert.equal(f.guard.sessions.size,0);assert.deepEqual(await readdir(join(directory,'voice-diagnostics')),[]);
 }finally{await service.close();await rm(directory,{recursive:true,force:true});}
});
