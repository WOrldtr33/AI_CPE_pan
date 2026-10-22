import {T830} from '../src/t830.mjs';
import {readByKey} from '../src/catalog.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const directory='reports/live/six-tools-2026-10-20';await mkdir(directory,{recursive:true});
const d=new T830({...process.env,T830_ENABLE_WRITES:'1'});
const report={at:new Date().toISOString(),records:[],policy:'Only one bounded loopback Ping is started; no configuration changes or service starts.'};
const save=()=>writeFile(directory+'/probe.json',JSON.stringify(report,null,2));
const run=async(section,args={})=>{try{const output=await d.query(section,args);const result={section,args,status:output.status,warnings:output.warnings,data:section.startsWith('phonebook')?{keys:Object.keys(output.data||{}),code:output.data?.code,hasData:!!output.data?.data}:output.data};report.records.push(result);console.log(JSON.stringify(result));await save();return output;}catch(e){report.records.push({section,error:e.message,diagnosticSummary:e.details?.diagnosticSummary});console.log(section+': '+e.message);await save();return null;}};
try{
 await d.login();report.developerAuthenticated=d.developerAuthenticated;
 await run('gps');await run('first_setup');await run('setup');await run('workmode');await run('wifi_rt');await run('share');
 const book=await run('phonebook',{device:'1',type:'ALL'});
 const selected=await run('phonebook_select',{device:'1',type:'ALL'});
 if(selected?.status!=='returned')await run('phonebook_select',{device:'1',type:'',name:''});
 await run('ping_result',{addr:'read_ping'});
 const started=await d.write('net_probe',{type:'PING',addr:'127.0.0.1',time:'1'});
 report.pingStart={status:started.status,data:started.data,warnings:started.warnings};console.log('PING_START '+JSON.stringify(report.pingStart));await save();
 if(started.status==='submitted')for(let poll=0;poll<15;poll++){
  await delay(1000);const r=await run('ping_result',{addr:'read_ping'});if(r?.status==='returned')break;
 }
 const metadata=await d.request('/ubus/',{jsonrpc:'2.0',id:100,method:'list',params:[d.token]},'list',{cookie:true});
 report.ubusObjects=metadata?.result?Object.keys(metadata.result):{error:metadata?.error?.code};console.log('OBJECTS '+JSON.stringify(report.ubusObjects));
 const fileAccess=await d.rawRpc('session','access',{scope:'ubus',object:'file',function:'read'},true);report.controllerReadAccess=fileAccess.access;
 if(fileAccess.access){for(const key of ['jt_gps','jt_setup','jt_workmode']){
  try{const r=await d.rawRpc('file','read',{path:`/usr/lib/lua/luci/controller/${key}.lua`},true);if(typeof r.data==='string'){await writeFile(`.agent-state/device-controller-${key}.lua`,r.data);report[key]={sourceSaved:true,bytes:r.data.length};}else report[key]={keys:Object.keys(r)};}catch(e){report[key]={error:e.message};}
 }}
}catch(e){report.error=e.message;console.log(JSON.stringify({error:e.message}));process.exitCode=1;}finally{await d.close();await save();}
