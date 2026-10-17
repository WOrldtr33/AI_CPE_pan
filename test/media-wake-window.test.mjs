import test from 'node:test';
import assert from 'node:assert/strict';
import { WakeWindow, VoiceGate, AudioBacklog, microphoneConstraints } from '../media/public/voice-audio.js';

test('Standby retains the quiet first syllable and a very short wake phrase byte for byte',()=>{
 const rate=16000,window=new WakeWindow(rate),samples=new Float32Array(rate*2);samples.fill(.0002,0,3200);samples.fill(.0005,3200,4800);samples.fill(.002,4800,6400);
 let first;
 for(let n=0;n<samples.length;n+=128){const out=window.push(samples.subarray(n,n+128));if(out&&!first)first=out;}
 assert.ok(first);assert.deepEqual(first,samples.subarray(0,first.length));assert.equal(first[3200],samples[3200]);
});
test('Overlapping standby windows preserve a whole phrase crossing the former five-second boundary',()=>{
 const rate=16000,window=new WakeWindow(rate),samples=Float32Array.from({length:rate*8},(_,n)=>n/(rate*8)),windows=[];
 for(let n=0;n<samples.length;n+=128){const out=window.push(samples.subarray(n,n+128));if(out)windows.push({audio:out,...window.lastCapture});}
 const start=rate*4.5,end=rate*5.8,w=windows.find(w=>w.startSample<=start&&w.endSample>=end);
 assert.ok(w);assert.deepEqual(w.audio.subarray(start-w.startSample,end-w.startSample),samples.subarray(start,end));
 assert.ok(windows.every(w=>w.audio.length<=rate*6));assert.equal(windows[0].startSample,0);
 window.reset();assert.equal(window.push(new Float32Array(128)),undefined);
});

test('Wake response delay preserves queued continuation without overlap duplication',()=>{
 const rate=16000,w=new WakeWindow(rate),queue=new AudioBacklog(rate),all=Float32Array.from({length:rate*12},(_,i)=>i/(rate*12));let firstEnd;
 for(let at=0;at<all.length;at+=128){const samples=w.push(all.subarray(at,at+128));if(samples){if(firstEnd===undefined)firstEnd=w.lastCapture.endSample;else queue.push(samples,{...w.lastCapture});}}
 const tail=w.continuation(firstEnd,queue.items);assert.deepEqual(tail,all.subarray(firstEnd));
});
test('Active capture contains every sample across five seconds, then ends on silence',()=>{
 const g=new VoiceGate(16000),frames=[],outputs=[];
 for(let i=0;i<95;i++){const frame=new Float32Array(1600).fill(i<80?.01:0);frames.push(frame);const out=g.push(frame);if(out)outputs.push(out);}
 assert.equal(outputs.length,1);assert.ok(outputs[0].length>16000*8);const expected=new Float32Array(outputs[0].length);for(let i=0;i<expected.length/1600;i++)expected.set(frames[i],i*1600);assert.deepEqual(outputs[0],expected);
});
test('Raw audio backlog is ordered, bounded and reports overflow rather than silently dropping',()=>{
 const q=new AudioBacklog(16000,2),a=new Float32Array(16000).fill(.1),b=new Float32Array(16000).fill(.2);q.push(a,{id:1});q.push(b,{id:2});assert.throws(()=>q.push(a,{}),/缓存/);assert.equal(q.length,2);assert.equal(q.shift().samples,a);assert.equal(q.shift().samples,b);assert.equal(q.seconds,0);q.push(a,{});q.clear();assert.equal(q.length,0);
 assert.deepEqual(microphoneConstraints,{channelCount:1,echoCancellation:true,noiseSuppression:false,autoGainControl:false});
});
