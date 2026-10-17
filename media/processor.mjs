import {voiceProfiles} from './speech-style.mjs';
import {wavInfo} from './store.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
const run = promisify(execFile);

export class MediaProcessor {
  constructor(settings, store) { this.settings = settings; this.store = store; }
  async available() { try { await run(this.settings.ffmpeg, ['-version'], { timeout: 3000, windowsHide: true, maxBuffer: 65536 }); return true; } catch { return false; } }
  async styleSpeech(bytes,{profile='female',rate=1}={},signal){
    if(!voiceProfiles[profile]||!Number.isFinite(rate)||rate<.85||rate>1.2)throw new Error('MEDIA_INVALID_SPEECH_OPTIONS');
    const directory=await mkdtemp(join(this.settings.directory,'speech-'));
    try{
      const input=join(directory,'input.wav'),output=join(directory,'styled.wav'),info=wavInfo(bytes),pitch=voiceProfiles[profile].pitch;
      await writeFile(input,bytes,{mode:0o600});
      const filters=`highpass=f=65,lowpass=f=9000,acompressor=threshold=0.18:ratio=1.5:attack=15:release=160,asetrate=${Math.round(info.sampleRate*pitch)},aresample=24000,atempo=${rate/pitch},alimiter=limit=0.95:level=false`;
      await run(this.settings.ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,'-vn','-af',filters,'-ac','1','-ar','24000','-c:a','pcm_s16le',output],{timeout:this.settings.timeoutMs,signal,windowsHide:true,maxBuffer:65536});
      return await readFile(output);
    }catch(error){if(signal?.aborted)throw new Error('CALL_CANCELLED');throw new Error(error.code==='ENOENT'?'MEDIA_FFMPEG_NOT_INSTALLED':'MEDIA_SPEECH_STYLE_FAILED');}
    finally{await rm(directory,{recursive:true,force:true});}
  }
  async normalize(id, signal) {
    const asset = await this.store.get(id);
    if (asset.meta.kind !== 'audio') throw new Error('MEDIA_AUDIO_REQUIRED');
    if (asset.meta.sampleRate === 16000 && asset.meta.channels === 1) return asset.meta;
    const directory = await mkdtemp(join(this.settings.directory, 'convert-'));
    try {
      const input = join(directory, 'input.bin'), output = join(directory, 'audio.wav');
      await writeFile(input, asset.bytes, { mode: 0o600 });
      // 禁止输入媒体引用网络资源；不经 shell，不接受用户自定义 FFmpeg 参数。
      const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-i', input];
      args.push('-vn', '-t', '60', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output);
      await run(this.settings.ffmpeg, args, { timeout: this.settings.timeoutMs, signal, windowsHide: true, maxBuffer: 65536 });
      return await this.store.put(await readFile(output), 'normalized_audio');
    } catch (error) {
      if (signal?.aborted) throw new Error('CALL_CANCELLED');
      throw new Error(error.code === 'ENOENT' ? 'MEDIA_FFMPEG_NOT_INSTALLED' : 'MEDIA_CONVERSION_FAILED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
