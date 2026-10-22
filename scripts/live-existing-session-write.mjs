import {readFile,writeFile} from 'node:fs/promises';
if (process.argv.length !== 3 || process.argv[2] !== '--apply') throw new Error('Usage: node scripts/live-existing-session-write.mjs --apply');
const connection=JSON.parse(await readFile('.media-state/connection.json','utf8'));
const report={at:new Date().toISOString(),mode:'live-existing-developer-session-upnp-change-and-restore',records:[],restored:false,verified:false};
const path='reports/live/writes-developer-2026-10-20/existing-session-write.json';
const save=()=>writeFile(path,JSON.stringify(report,null,2));
const request=async(action,body)=>{
 const response=await fetch(connection.url+'/api/dashboard/'+action,{method:'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const output=await response.json();
 report.records.push({at:new Date().toISOString(),action,body,http:response.status,output});await save();
 if(!response.ok||output.status==='error')throw new Error(output.error||'DASHBOARD_REQUEST_FAILED');
 return output;
};
let attempted=false;
try{
 const before=await request('snapshot',{refresh:true});
 const original=before.upnp;
 if(!['0','1'].includes(original)||!before.writeEnabled)throw new Error('UPNP_BASELINE_UNAVAILABLE');
 report.original=original;report.target=original==='0'?'1':'0';
 const proposal=await request('prepare',{value:report.target,expected:original});
 report.proposalId=proposal.id;await save();attempted=true;
 const result=await request('confirm',{id:proposal.id,confirmed:true});
 report.verified=result.status==='verified';await save();
 if(!report.verified)report.writeError=result.result?.error||result.status;
}catch(e){report.error=e.message;process.exitCode=1;}
finally{
 if(attempted){
  try{
   const current=await request('snapshot',{refresh:true});
   if(current.upnp===report.original)report.restored=true;
   else if(current.upnp===report.target){
    const proposal=await request('prepare',{value:report.original,expected:report.target});
    const result=await request('confirm',{id:proposal.id,confirmed:true});
    const after=await request('snapshot',{refresh:true});
    report.restored=result.status==='verified'&&after.upnp===report.original;
   }else throw new Error('RESTORE_STATE_UNAVAILABLE');
  }catch(e){report.restoreError=e.message;process.exitCode=1;}
 }
 if(attempted&&!report.restored)process.exitCode=1;
 await save();console.log(JSON.stringify({verified:report.verified,restored:report.restored,original:report.original,target:report.target,error:report.error,restoreError:report.restoreError,submissions:report.records.filter(x=>x.action==='confirm').length}));
}
