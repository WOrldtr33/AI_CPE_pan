import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export class LocalVoiceModels {
  constructor(settings) { this.settings = settings; this.pending = new Map(); }
  async start() {
    if (this.ready) return this.ready;
    const root = this.settings.voiceModelsDirectory;
    if (!existsSync(join(root,'wake-asr/model.int8.onnx')) || !existsSync(join(root,'wake-asr/tokens.txt')) || !existsSync(this.settings.voicePython)) throw new Error('MEDIA_VOICE_MODELS_MISSING：请运行 scripts/setup-voice.ps1');
    this.ready = new Promise((resolve, reject) => {
      const child = this.child = spawn(this.settings.voicePython, ['-u', fileURLToPath(new URL('./voice-worker.py', import.meta.url)), root],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      const timer = setTimeout(() => { child.kill(); reject(new Error('MEDIA_VOICE_LOCAL_TIMEOUT')); }, 30000);
      const fail = () => { clearTimeout(timer); this.ready = undefined; reject(new Error('MEDIA_VOICE_LOCAL_UNAVAILABLE')); for (const p of this.pending.values()) p.reject(new Error('MEDIA_VOICE_LOCAL_UNAVAILABLE')); this.pending.clear(); };
      child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail); child.stderr.resume();
      createInterface({ input: child.stdout }).on('line', line => {
        let event; try { event = JSON.parse(line); } catch { return; }
        if (event.ready) { clearTimeout(timer); resolve(); return; }
        const p = this.pending.get(event.id); if (!p) return;
        this.pending.delete(event.id); event.error ? p.reject(new Error(event.error)) : p.resolve(event.result);
      });
    });
    return this.ready;
  }
  async analyze(bytes, detectWake, signal) {
    await this.start(); signal?.throwIfAborted();
    if (this.pending.size >= 8) throw new Error('MEDIA_VOICE_LOCAL_BUSY');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); error ? reject(error) : resolve(result); };
      const abort = () => finish(new Error('CALL_CANCELLED'));
      const timer = setTimeout(() => finish(new Error('MEDIA_VOICE_LOCAL_TIMEOUT')), 30000);
      this.pending.set(id, { resolve: r => finish(null, r), reject: e => finish(e) });
      signal?.addEventListener('abort', abort, { once: true });
      this.child.stdin.write(JSON.stringify({ id, audio: bytes.toString('base64'), detectWake }) + '\n');
    });
  }
  close() { this.child?.kill(); }
}

// Historical export name retained for callers; only wake/session state remains.
export class VoiceIdentity {
  constructor(models,{clock=Date.now,timeoutMs=120000}={}){Object.assign(this,{models,clock,timeoutMs});this.sessions=new Map();}
  async open(id,signal){
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new Error('MEDIA_VOICE_SESSION_REQUIRED');
    await this.models.start();signal?.throwIfAborted();
    for(const[key,s]of this.sessions)if(this.clock()-s.lastAccepted>this.timeoutMs)this.sessions.delete(key);
    if(this.sessions.size>=8&&!this.sessions.has(id))throw new Error('MEDIA_VOICE_SESSION_LIMIT');
    this.sessions.set(id,{awake:false,lastAccepted:this.clock()});
  }
  reset(id){this.sessions.delete(id);}
  touch(id){const session=this.sessions.get(id);if(session?.awake)session.lastAccepted=this.clock();}
  async check(id,bytes,signal){
    const current=this.sessions.get(id);if(!current)throw new Error('MEDIA_VOICE_SESSION_REQUIRED');
    if(this.clock()-current.lastAccepted>this.timeoutMs)current.awake=false;
    const detectWake=!current.awake,result=await this.models.analyze(bytes,detectWake,signal);signal?.throwIfAborted();
    if(this.sessions.get(id)!==current)return{status:'waiting_wake'};
    const diagnostic={wakeChecked:detectWake,wakeDetected:!!result.wake,wakeThreshold:.10,keywordBoost:5,wakeMethod:result.wakeMethod,wakeAlias:result.wakeAlias,localWakeText:result.localWakeText,wakeAsrUsed:result.wakeAsrUsed,denoise:result.denoise,speakerCheck:false};
    if(detectWake&&!result.wake)return{status:'waiting_wake',diagnostic};
    current.awake=true;current.lastAccepted=this.clock();
    return{status:detectWake?'woke':'accepted',diagnostic,processedAudio:result.processedAudio};
  }
  close(){this.sessions.clear();this.models.close();}
}
