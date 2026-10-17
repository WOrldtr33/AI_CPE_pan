// Explicit cloud test: synthetic speech only; no microphone or device traffic.
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaConfig } from '../media/config.mjs';
import { loadMediaCredentials } from '../media/credentials.mjs';
import { MediaProviders } from '../media/providers.mjs';
import { MediaStore } from '../media/store.mjs';
import { MediaProcessor } from '../media/processor.mjs';
import { LocalVoiceModels, VoiceIdentity } from '../media/voice-identity.mjs';
import { root } from '../src/agent-config.mjs';
const settings=mediaConfig(loadMediaCredentials());await mkdir(join(root,'.media-state'),{recursive:true});
const directory=await mkdtemp(join(root,'.media-state/voice-smoke-'));
const store=new MediaStore({...settings,directory});await store.init();const processor=new MediaProcessor(settings,store);
const models=new LocalVoiceModels(settings), guard=new VoiceIdentity(models), id=randomUUID();
const report={syntheticOnly:true,realMicrophone:false,results:[]};
async function audio(voice,text){const providers=new MediaProviders({...settings,providers:{...settings.providers,tts:{...settings.providers.tts,voice}}});const asset=await store.put(await providers.speech(text),'synthetic');return(await store.get((await processor.normalize(asset.id)).id)).bytes;}
try{
 await guard.open(id);
 for(const [label,voice,text] of [['background','Cherry','今天天气很好，我们待会一起去吃午饭。'],['wake','Ryan','Hi Claude, are you there?'],['owner','Ryan','Please tell me which device status I can check right now.'],['other','Cherry','请告诉我现在可以查询哪些设备状态。'],['owner_again','Ryan','Please check the current network connection status for me.']]){
  const fixture=join(root,'.media-state/voice-fixtures',label+'.wav');const bytes=process.argv.includes('--reuse-fixtures')?await readFile(fixture):await audio(voice,text);await mkdir(join(root,'.media-state/voice-fixtures'),{recursive:true});await writeFile(fixture,bytes);const r=await guard.check(id,bytes);const {processedAudio,...decision}=r;report.results.push({label,...decision});console.log(label,JSON.stringify(decision));
 }
 const statuses=report.results.map(r=>r.status);report.status=statuses[0]==='waiting_wake'&&statuses[1]==='woke'&&statuses[2]==='accepted'&&statuses[3]==='accepted'&&statuses[4]==='accepted'?'passed':'failed';if(report.status!=='passed')process.exitCode=1;
}finally{guard.close();await rm(directory,{recursive:true,force:true});await mkdir(join(root,'reports/live'),{recursive:true});await writeFile(join(root,'reports/live/voice-identity-live-results.json'),JSON.stringify(report,null,2));}
