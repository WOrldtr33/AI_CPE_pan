import {connectTools} from '../src/agent-mcp.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
await mkdir('reports/live/six-tools-2026-10-20',{recursive:true});
const report={at:new Date().toISOString(),mode:'real-mcp-six-tool-fix-verification',records:[],writes:'Only one explicitly requested bounded loopback diagnostic; no configuration changes.'};
const path='reports/live/six-tools-2026-10-20/verification.json';
const mcp=await connectTools(['ping_result','phonebook','phonebook_select','gps','setup','wifi_rt','share'],process.env,{enableWrites:true});
const call=async(name,args={},write=false)=>{
 const r=write?await mcp.executeApprovedWrite(name,args):await mcp.call(name,args);
 report.records.push({tool:name,args,status:r.status,error:r.error,reading:r.reading,warnings:r.warnings,failure:r.failure,rootCause:r.details?.diagnosticSummary?.rootCause,
  fallback:r.diagnostics?.filter(x=>x.step==='read_fallback'),initialErrors:r.diagnostics?.filter(x=>x.step==='attempt'&&x.error).map(x=>x.error)});
 console.log(JSON.stringify(report.records.at(-1)));await writeFile(path,JSON.stringify(report,null,2));return r;
};
try{
 await call('t830_get_phonebook',{device:'1',type:'ALL'});
 await call('t830_get_phonebook_select',{device:'1'});
 await call('t830_get_gps');await call('t830_get_setup');await call('t830_get_wifi_rt');await call('t830_get_share');
 const started=await call('t830_set_net_probe',{type:'PING',addr:'127.0.0.1',time:'1'},true);
 if(started.status==='submitted')for(let poll=0;poll<15;poll++){
  await delay(1000);const r=await call('t830_get_ping_result',{addr:'read_ping'});if(r.reading?.state==='complete')break;
 }
 const ping=report.records.findLast(x=>x.tool==='t830_get_ping_result');
 report.summary={phonebook:report.records.find(x=>x.tool==='t830_get_phonebook')?.status,phonebookSelect:report.records.find(x=>x.tool==='t830_get_phonebook_select')?.status,
  setup:report.records.find(x=>x.tool==='t830_get_setup')?.status,gps:report.records.find(x=>x.tool==='t830_get_gps')?.reading,
  ping:ping?.reading,wireless:report.records.find(x=>x.tool==='t830_get_wifi_rt')?.failure,share:report.records.find(x=>x.tool==='t830_get_share')?.failure};
 console.log('SUMMARY',JSON.stringify(report.summary));
}catch(e){report.error=e.message;console.log(JSON.stringify({error:e.message}));process.exitCode=1;}finally{await mcp.close();await writeFile(path,JSON.stringify(report,null,2));}
