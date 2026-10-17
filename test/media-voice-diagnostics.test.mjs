import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginVoiceDiagnostic, VoiceDiagnosticCache } from '../media/voice-diagnostics.mjs';
import { pcmWav } from '../media/omni.mjs';

test('Voice diagnostic preserves exact ASR bytes and pairs transcript; disabled mode writes nothing', async () => {
  assert.equal(await beginVoiceDiagnostic(undefined, Buffer.alloc(0)), undefined);
  const directory = await mkdtemp(join(tmpdir(), 'voice-evidence-'));
  try {
    const bytes = pcmWav(Buffer.alloc(16000 * 2), 16000);
    const finish = await beginVoiceDiagnostic(directory, bytes, undefined, { mode:'wake_window',inputSampleRate:48000,startSample:0,endSample:48000,ignored:'not-saved' });
    await finish({ status: 'transcribed', transcript: '测试输入' });
    const [id] = await readdir(directory);
    assert.deepEqual(await readFile(join(directory, id, 'input.wav')), bytes);
    const result = JSON.parse(await readFile(join(directory, id, 'result.json'), 'utf8'));
    assert.equal(result.transcript, '测试输入');
    assert.equal(result.seconds, 1);
    assert.equal(result.status, 'transcribed');
    assert.equal(result.sha256.length, 64);
    assert.ok(result.totalElapsedMs >= 0);
    assert.equal(result.audio.rmsEvery100ms.length, 10);
    assert.equal(result.audio.peak, 0);
    assert.deepEqual(result.capture,{mode:'wake_window',inputSampleRate:48000,startSample:0,endSample:48000});
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Diagnostics distinguish received WAV from actual denoised ASR WAV and clean only session cache',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-cache-')),cache=new VoiceDiagnosticCache(dir);
 try{const input=pcmWav(Buffer.alloc(32000),16000),processed=pcmWav(Buffer.alloc(32000,1),16000);
 const finish=await cache.begin(input,'test-session');await finish({status:'transcribing',asrAudio:processed},false);const [id]=await readdir(dir);assert.deepEqual(await readFile(join(dir,id,'input.wav')),input);assert.deepEqual(await readFile(join(dir,id,'asr.wav')),processed);
 const record=JSON.parse(await readFile(join(dir,id,'result.json'),'utf8'));assert.notEqual(record.sha256,record.asrSha256);assert(!JSON.stringify(record).includes('Buffer'));
 await cache.clear('test-session');assert.deepEqual(await readdir(dir),[]);await finish({status:'late_result'});assert.deepEqual(await readdir(dir),[]);
 }finally{await cache.close();await rm(dir,{recursive:true,force:true});}
});
