// Two synthetic audition clips, generated with the configured provider. No microphone or CPE access.
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {mediaConfig} from '../media/config.mjs';
import {loadMediaCredentials} from '../media/credentials.mjs';
import {MediaProviders} from '../media/providers.mjs';
import {MediaProcessor} from '../media/processor.mjs';
import {wavInfo} from '../media/store.mjs';
const root=process.cwd(),config=mediaConfig(loadMediaCredentials());await mkdir(join(root,'.media-state'),{recursive:true});await mkdir(join(root,'reports/live'),{recursive:true});
const directory=await mkdtemp(join(root,'.media-state/voice-preview-')),providers=new MediaProviders(config),processor=new MediaProcessor({...config,directory});
const text='我在。你可以直接告诉我想了解什么，我们一起看看。',report={syntheticOnly:true,realMicrophone:false,profiles:[]};
try{for(const profile of ['female','male']){const signal=AbortSignal.timeout(60000),raw=await providers.speech(text,signal,{profile}),styled=await processor.styleSpeech(raw,{profile,rate:1},signal),path=join(root,`reports/live/voice-profile-${profile}.wav`);await writeFile(path,styled);const transcript=await providers.transcribe({bytes:styled,meta:{kind:'audio',mime:'audio/wav'}},signal);const normalize=t=>t.replace(/[^\p{L}\p{N}]/gu,'');const transcriptionMatches=normalize(transcript)===normalize(text);report.profiles.push({profile,text,transcript,transcriptionMatches,seconds:wavInfo(styled).seconds,path});console.log(JSON.stringify({profile,seconds:wavInfo(styled).seconds}));}report.status=report.profiles.every(p=>p.transcriptionMatches)?'passed':'review_required';if(report.status!=='passed')process.exitCode=1;}
catch(error){report.status='failed';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await rm(directory,{recursive:true,force:true});await writeFile(join(root,'reports/live/voice-profile-results.json'),JSON.stringify(report,null,2));}
