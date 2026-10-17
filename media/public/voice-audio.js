// Standby preserves every sample, independently of speech energy or duration.
export class WakeWindow {
  constructor(rate) { this.rate = rate; this.reset(); }
  reset() { this.parts = []; this.count = 0; this.total = 0; this.next = Math.ceil(this.rate * 1.5); this.lastCapture = undefined; }
  continuation(afterSample, queued=[]){
    if(!Number.isFinite(afterSample))return new Float32Array();
    const current=new Float32Array(this.count);let at=0;for(const part of this.parts){current.set(part,at);at+=part.length;}
    const windows=[...queued,{samples:current,capture:{startSample:this.total-this.count,endSample:this.total}}];
    let cursor=afterSample;const pieces=[];
    for(const {samples,capture}of windows){if(!Number.isFinite(capture?.startSample)||capture.endSample<=cursor)continue;
      if(capture.startSample>cursor)throw new Error('唤醒期间的音频缓存出现缺口，请重新说一次。');
      pieces.push(samples.subarray(cursor-capture.startSample));cursor=capture.endSample;}
    const output=new Float32Array(pieces.reduce((n,p)=>n+p.length,0));at=0;for(const part of pieces){output.set(part,at);at+=part.length;}return output;
  }

  push(samples) {
    this.parts.push(samples); this.count += samples.length; this.total += samples.length;
    const limit = Math.ceil(this.rate * 6);
    while (this.count > limit) {
      const excess = this.count - limit, first = this.parts[0];
      if (excess >= first.length) { this.parts.shift(); this.count -= first.length; }
      else { this.parts[0] = first.subarray(excess); this.count -= excess; }
    }
    if (this.total < this.next) return;
    while (this.next <= this.total) this.next += this.rate;
    const output = new Float32Array(this.count); let offset = 0;
    for (const part of this.parts) { output.set(part, offset); offset += part.length; }
    this.lastCapture = { mode: 'wake_window', inputSampleRate: this.rate, startSample: this.total - this.count, endSample: this.total };
    return output;
  }
}

// Active conversation VAD; standby uses WakeWindow instead.
export class VoiceGate {
  constructor(rate) { this.rate = rate; this.noise = 0.0002; this.elapsed = 0; this.lastRms = 0; this.reset(); }
  reset() { this.parts = []; this.voiced = 0; this.silence = 0; this.duration = 0; this.pre = []; this.attack = 0; }
  flush() {
    let output;
    if (this.voiced >= 0.12 && this.duration >= 0.3) {
      output = new Float32Array(this.parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
      for (const part of this.parts) { output.set(part, offset); offset += part.length; }
    }
    this.reset(); return output;
  }
  push(samples) {
    const seconds = samples.length / this.rate; this.elapsed += seconds;
    let power = 0; for (const value of samples) power += value * value; const rms = Math.sqrt(power / samples.length);
    this.lastRms = rms; this.threshold = Math.max(0.001, Math.min(0.003, this.noise * 2));
    const loud = rms > this.threshold;
    if (!this.parts.length) {
      if (!loud) this.noise = this.noise * 0.98 + rms * 0.02;
      this.pre.push(samples); if (this.pre.length > Math.ceil(this.rate * 0.6 / samples.length)) this.pre.shift();
      this.attack = loud ? this.attack + seconds : 0;
      if (this.attack < 0.12) return;
      this.parts = this.pre; this.pre = []; this.duration = this.parts.reduce((n, p) => n + p.length / this.rate, 0); this.voiced = this.attack;
      return;
    }
    this.parts.push(samples); this.duration += seconds; if (loud) this.voiced += seconds;
    this.silence = loud ? 0 : this.silence + seconds;
    // Preserve natural pauses and words across the former five-second cut.
    // The 25-second ceiling bounds a request, not continuous microphone capture.
    if ((this.silence < 0.9 || this.duration < 0.6) && this.duration < 25) return;
    let output;
    if (this.voiced >= 0.12) { const count = this.parts.reduce((n, p) => n + p.length, 0); output = new Float32Array(count); let offset = 0; for (const part of this.parts) { output.set(part, offset); offset += part.length; } }
    this.reset(); return output;
  }
}
export async function audioWav(samples, rate) {
  const size = Math.floor(samples.length * 16000 / rate), offline = new OfflineAudioContext(1, size, 16000);
  const buffer = offline.createBuffer(1, samples.length, rate); buffer.copyToChannel(samples, 0);
  const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
  const pcm = (await offline.startRendering()).getChannelData(0), bytes = new ArrayBuffer(44 + size * 2), view = new DataView(bytes);
  const text = (at, value) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, size * 2, true);
  for (let i = 0; i < size; i++) { const value = Math.max(-1, Math.min(1, pcm[i])); view.setInt16(44 + i * 2, value * (value < 0 ? 32768 : 32767), true); }
  const blob = new Blob([bytes], { type: 'audio/wav' });
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
}

// Raw PCM waits in memory; conversion happens only when a request is ready.
export class AudioBacklog {
  constructor(rate, limitSeconds=120){this.rate=rate;this.limitSeconds=limitSeconds;this.clear();}
  clear(){this.items=[];this.seconds=0;}
  push(samples,capture){const seconds=samples.length/this.rate;if(this.seconds+seconds>this.limitSeconds)throw new Error('语音缓存已达 120 秒，请等待当前处理结束后重新开启，录音没有被静默丢弃。');this.items.push({samples,capture,seconds});this.seconds+=seconds;}
  shift(){const item=this.items.shift();if(item)this.seconds-=item.seconds;return item;}
  get length(){return this.items.length;}
}
export const microphoneConstraints={channelCount:1,echoCancellation:true,noiseSuppression:false,autoGainControl:false};
