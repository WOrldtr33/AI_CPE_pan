// Replace this adapter with an Android bridge without changing presentation code.
import {api,call,token} from './api';
import {VoiceGate,WakeWindow,AudioBacklog,microphoneConstraints,audioWav} from '../../media/public/voice-audio.js';
declare global {interface Window {AICPE?:{setBrightness?:(v:number)=>void;setVolume?:(v:number)=>void;};}}
export const audioActivity={input:0,output:0,awake:false,playing:false};
let context:AudioContext|undefined,gain:GainNode|undefined,analyser:AnalyserNode|undefined,volume=.65;
let speechOptions:{profile:'female'|'male';rate:number}={profile:'female',rate:1};
async function audio(){if(!context){context=new AudioContext();gain=context.createGain();analyser=context.createAnalyser();analyser.fftSize=512;analyser.connect(gain);gain.connect(context.destination);}gain!.gain.value=volume;let timeout:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([context.resume(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('MEDIA_AUDIO_GESTURE_REQUIRED')),3000);})]);}finally{clearTimeout(timeout);}return context;}
export const device={unlockAudio:()=>audio(),setBrightness(v:number){window.AICPE?.setBrightness?.(v);},setVolume(v:number){volume=v/100;if(gain)gain.gain.value=volume;window.AICPE?.setVolume?.(v);},setSpeechOptions(profile:'female'|'male',rate:number){speechOptions={profile,rate};},nativeBrightness:()=>!!window.AICPE?.setBrightness};
export async function speak(text:string,signal:AbortSignal,onStart?:(text:string)=>void,options:{profile?:'female'|'male';rate?:number;concise?:boolean}={}){
 const ctx=await audio(),r=await call('media_synthesize_speech',{text,...speechOptions,concise:true,...options},signal);
 try{const res=await fetch('/api/assets/'+r.asset.id,{headers:{Authorization:`Bearer ${token}`},signal});if(!res.ok)throw new Error('播报音频读取失败');const buffer=await ctx.decodeAudioData(await res.arrayBuffer());
 await new Promise<void>((resolve,reject)=>{signal.throwIfAborted();const source=ctx.createBufferSource();source.buffer=buffer;source.connect(analyser!);let frame=0;const samples=new Float32Array(analyser!.fftSize);
 const meter=()=>{analyser!.getFloatTimeDomainData(samples);let power=0;for(const v of samples)power+=v*v;audioActivity.output=Math.min(1,Math.sqrt(power/samples.length)*12);frame=requestAnimationFrame(meter);};
 const finish=(error?:Error)=>{cancelAnimationFrame(frame);audioActivity.output=0;audioActivity.playing=false;source.onended=null;signal.removeEventListener('abort',abort);source.disconnect();error?reject(error):resolve();};
 const abort=()=>{source.stop();finish(new Error('本次播报已停止'));};source.onended=()=>finish();signal.addEventListener('abort',abort,{once:true});audioActivity.playing=true;source.start();meter();onStart?.(text);
 });}finally{await api('/api/delete',{assetId:r.asset.id}).catch(()=>{});}
}
export class VoiceSession {
 controller=new AbortController();id=crypto.randomUUID();stream?:MediaStream;node?:AudioWorkletNode;input?:MediaStreamAudioSourceNode;mute?:GainNode;gate:any;wake:any;rate=48000;awake=false;speaking=false;quietUntil=0;queue:any;processing=false;ready=false;lastActivity=performance.now();idleTimer?:ReturnType<typeof setInterval>;
 constructor(public event:(data:any)=>void){}
 async start(){const ready=api('/api/voice/start',{sessionId:this.id},this.controller.signal);void ready.catch(()=>{});try{this.stream=await navigator.mediaDevices.getUserMedia({audio:microphoneConstraints,video:false});this.controller.signal.throwIfAborted();const ctx=await audio();this.controller.signal.throwIfAborted();this.rate=ctx.sampleRate;await ctx.audioWorklet.addModule('/recorder.js');this.gate=new VoiceGate(this.rate);this.wake=new WakeWindow(this.rate);this.queue=new AudioBacklog(this.rate);this.input=ctx.createMediaStreamSource(this.stream);this.node=new AudioWorkletNode(ctx,'pcm-recorder');this.mute=ctx.createGain();this.mute.gain.value=0;
 this.node.port.onmessage=e=>{
   let power=0;for(const v of e.data)power+=v*v;const rms=Math.sqrt(power/e.data.length);audioActivity.input=this.awake?Math.min(1,rms*45):0;
   if(this.awake&&rms>.001)this.lastActivity=performance.now();
   if(this.controller.signal.aborted||this.speaking||audioActivity.playing||performance.now()<this.quietUntil)return;
   const utterance=this.awake?this.gate.push(e.data):this.wake.push(e.data);
   if(utterance)this.enqueue(utterance,this.awake?{mode:'speech_segment',inputSampleRate:this.rate}:{...this.wake.lastCapture});
 };
 this.input.connect(this.node);this.node.connect(this.mute);this.mute.connect(ctx.destination);await ready;this.controller.signal.throwIfAborted();this.ready=true;this.idleTimer=setInterval(()=>{if(audioActivity.output>.01)this.lastActivity=performance.now();if(this.awake&&!this.processing&&!this.queue?.length&&performance.now()-this.lastActivity>120000){this.switchAwake(false);this.event({type:'session_idle'});void api('/api/voice/start',{sessionId:this.id},this.controller.signal).catch(()=>{});}},1000);void this.drain();this.event({type:'ui_state',state:'listening',text:'语音待机已开启，请说 Hi Claude'});
 }catch(e){this.stop();throw e;}}
 enqueue(samples:Float32Array,capture:any){
   if(this.controller.signal.aborted)return;
   try{this.queue.push(samples,capture);void this.drain();}
   catch(e){this.event({type:'error',error:String(e)});this.event({type:'ui_state',state:'ready',text:'缓存已满，请重新开启语音'});this.stop();this.event({type:'ended'});}
 }
 switchAwake(awake:boolean,afterSample?:number){
   if(this.awake===awake)return;const tail=awake?this.wake.continuation(afterSample,this.queue.items):new Float32Array();this.awake=awake;audioActivity.awake=awake;audioActivity.input=0;this.lastActivity=performance.now();this.queue.clear();this.gate.reset();this.wake.reset();
   for(let at=0;at<tail.length;at+=128){const part=this.gate.push(tail.subarray(at,at+128));if(part)this.enqueue(part,{mode:'speech_segment',inputSampleRate:this.rate});}
 }
 async talk(text:string){try{await speak(text,this.controller.signal,t=>{if(!this.speaking){const pending=this.gate.flush();if(pending&&this.awake)this.enqueue(pending,{mode:'speech_segment',inputSampleRate:this.rate});this.speaking=true;}this.event({type:'answer',answer:t});});}finally{this.speaking=false;this.quietUntil=performance.now()+250;this.gate.reset();this.wake.reset();}}
 async drain(){if(!this.ready||this.processing||!this.queue?.length||this.controller.signal.aborted)return;this.processing=true;try{const segment=this.queue.shift();const audio=await audioWav(segment.samples,this.rate);const res=await fetch('/api/voice/turn',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sessionId:this.id,audio,capture:segment.capture}),signal:this.controller.signal});if(!res.ok)throw new Error((await res.json()).error);const reader=res.body!.getReader(),decoder=new TextDecoder();let text='',answer='';try{while(true){const{done,value}=await reader.read();text+=decoder.decode(value||new Uint8Array(),{stream:!done});const events=text.split('\n\n');text=events.pop()||'';for(const raw of events){const line=raw.split('\n').find(l=>l.startsWith('data:'));if(!line)continue;const data=JSON.parse(line.slice(5));if(data.type==='voice_identity'){if(data.status==='woke'){this.event({type:'wake'});this.switchAwake(true,segment.capture?.endSample);this.event({type:'ui_state',state:'listening',text:'我在，请说你的问题。'});if(!this.gate.parts.length&&!this.queue.length)await this.talk('我在，请说你的问题。');}if(data.status==='waiting_wake'){const expired=this.awake;this.switchAwake(false);if(expired)this.event({type:'session_idle'});}}else if(data.type==='answer'){answer=data.answer;if(data.proposals?.length)this.event({type:'proposal',proposal:data.proposals[0]});this.event({type:'ui_state',state:'thinking',text:'正在准备语音…'});}else if(data.type==='ack'){this.event({type:'ui_state',state:'thinking',text:data.text});}else if(data.type==='error')throw new Error(data.error);else this.event(data);}if(done)break;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}if(answer){try{await this.talk(answer);}catch(e){if(!this.controller.signal.aborted){this.event({type:'answer',answer});this.event({type:'error',error:'播报未完成'});}}}}catch(e){if(!this.controller.signal.aborted)this.event({type:'error',error:e instanceof Error?e.message:String(e)});}finally{this.processing=false;if(!this.controller.signal.aborted){this.event({type:'ui_state',state:'listening',text:this.awake?'正在聆听':'请说 Hi Claude'});void this.drain();}}}
 stop(){clearInterval(this.idleTimer);audioActivity.awake=false;audioActivity.input=0;this.controller.abort();this.stream?.getTracks().forEach(t=>t.stop());this.node?.disconnect();this.input?.disconnect();this.mute?.disconnect();this.queue?.clear();this.gate?.reset();this.wake?.reset();void api('/api/voice/end',{sessionId:this.id}).catch(()=>{});}
}


