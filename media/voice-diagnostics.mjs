import { mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { wavInfo } from './store.mjs';
import { timestamp } from '../src/time.mjs';

let creation = Promise.resolve();
const active = new Set();

// Opt-in local evidence, including rejected wake attempts. Never save embeddings.
export async function beginVoiceDiagnostic(directory, bytes, sessionId, capture) {
  if (!directory) return;
  const id = randomUUID(), folder = join(directory, id);
  const allocation = creation.then(async () => {
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory, { withFileTypes: true });
    const folders = await Promise.all(entries.filter(e => e.isDirectory() && /^[a-f0-9-]{36}$/.test(e.name)).map(async e => ({ path: join(directory, e.name), at: (await stat(join(directory, e.name))).birthtimeMs })));
    folders.sort((a, b) => b.at - a.at);
    // At most 100 recent recordings, plus any requests still in flight.
    for (const entry of folders.slice(99)) if (!active.has(entry.path)) await rm(entry.path, { recursive: true, force: true });
    await mkdir(folder); active.add(folder);
  });
  creation = allocation.catch(() => {}); await allocation;
  await writeFile(join(folder, 'input.wav'), bytes, { flag: 'wx', mode: 0o600 });
  const levels = [], info = wavInfo(bytes);
  let peak = 0, squared = 0, clipped = 0, count = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (bytes.toString('ascii', offset, offset + 4) === 'data') {
      let framePower = 0, frameCount = 0;
      for (let i = start; i < start + size; i += 2) {
        const value = bytes.readInt16LE(i) / 32768; peak = Math.max(peak, Math.abs(value)); squared += value * value; count++; if (Math.abs(value) >= 0.99) clipped++;
        framePower += value * value; frameCount++;
        if (frameCount === info.sampleRate * info.channels / 10 || i + 2 >= start + size) { levels.push(Math.sqrt(framePower / frameCount)); framePower = 0; frameCount = 0; }
      }
      break;
    }
    offset = start + size + size % 2;
  }
  const record = { id, submittedAt: timestamp(), ...(typeof sessionId === 'string' && /^[a-f0-9-]{36}$/.test(sessionId) ? { sessionId } : {}), ...info, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), status: 'received', stage: 'received',
    audio: { peak, rms: count ? Math.sqrt(squared / count) : 0, clippedFraction: count ? clipped / count : 0, rmsEvery100ms: levels },
    asrSubmitted: false };
  if (capture && ['wake_window','speech_segment'].includes(capture.mode)) {
    record.capture = { mode: capture.mode };
    for (const key of ['inputSampleRate','startSample','endSample']) if (Number.isSafeInteger(capture[key]) && capture[key] >= 0) record.capture[key] = capture[key];
  }
  const save = () => writeFile(join(folder, 'result.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  await save();
  const start = performance.now();
  const finish = async (outcome, final = true) => {
    const {asrAudio,...fields}=outcome;
    if(asrAudio){await writeFile(join(folder,'asr.wav'),asrAudio,{mode:0o600});fields.asrSha256=createHash('sha256').update(asrAudio).digest('hex');fields.asrBytes=asrAudio.length;}
    Object.assign(record, fields, { totalElapsedMs: Math.round(performance.now() - start) }); try { await save(); } finally { if (final) active.delete(folder); } };
  finish.folder=folder;return finish;
}

// Only files allocated by this service instance are removed. In-flight writes finish first.
export class VoiceDiagnosticCache {
 constructor(directory){this.directory=directory;this.sessions=new Map();}
 async begin(bytes,id,capture){
  let session=this.sessions.get(id);if(!session){session={ended:false,paths:new Set(),operations:new Set()};this.sessions.set(id,session);}
  if(session.ended)return;
  const allocation=beginVoiceDiagnostic(this.directory,bytes,id,capture);session.operations.add(allocation);
  let finish;try{finish=await allocation;if(finish)session.paths.add(finish.folder);}finally{session.operations.delete(allocation);}
  if(!finish||session.ended)return;
  return async(outcome,final)=>{if(session.ended)return;const operation=finish(outcome,final);session.operations.add(operation);try{await operation;}finally{session.operations.delete(operation);}};
 }
 async clear(id){const session=this.sessions.get(id);if(!session)return;session.ended=true;await Promise.allSettled([...session.operations]);for(const path of session.paths){active.delete(path);await rm(path,{recursive:true,force:true});}session.paths.clear();}
 async close(){await Promise.all([...this.sessions.keys()].map(id=>this.clear(id)));this.sessions.clear();}
}
