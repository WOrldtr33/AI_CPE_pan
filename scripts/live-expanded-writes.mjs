import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {connectTools} from '../src/agent-mcp.mjs';
import {reads,writes,toolName} from '../src/catalog.mjs';
if(process.argv.length!==3||process.argv[2]!=='--apply')throw new Error('Usage: node scripts/live-expanded-writes.mjs --apply');
const dir=new URL('../reports/live/writes-developer-after-reboot-2026-10-20/',import.meta.url);
await mkdir(dir,{recursive:true});
const report={at:new Date().toISOString(),authTransport:process.env.T830_AUTH_TRANSPORT||'cgi',mode:'live-controlled-write-tests',records:[],cases:[],skipped:[]};
const save=()=>writeFile(new URL('write-results.json',dir),JSON.stringify(report,null,2));
const mcp=await connectTools(reads.map(d=>d.key),process.env,{enableWrites:true});
const call=async(name,args={},write=false)=>{
 const started=Date.now();let output;
 try{output=write?await mcp.executeApprovedWrite(name,args):await mcp.call(name,args);}catch(e){output={status:'error',error:e.message};}
 report.records.push({at:new Date().toISOString(),name,args,write,ms:Date.now()-started,output});await save();
 console.log(`${name}: ${output.status}${output.error?' / '+output.error:''}`);
 if(['DEVICE_UNREACHABLE','DEVICE_TIMEOUT','UBUS_LOGIN_FAILED','LOGIN_FAILED_CHECK_CREDENTIALS','DEVELOPER_LOGIN_FAILED'].includes(output.error))throw new Error('STOP_DEVICE_OR_AUTH_UNAVAILABLE');
 return output;
};
const payload=o=>o.data?.data??o.data;
const acknowledged=o=>o.status==='submitted'||(['verified_fields','verified_field'].includes(o.status)&&o.submissionOutcome==='acknowledged');
const same=(left,right)=>Object.entries(right).every(([key,value])=>String(left?.[key])===String(value));
const skip=(section,reason)=>{report.skipped.push({section,reason});};
async function sameValue(section,readSection,args,expected,select=payload){
 const row={section,kind:'same-value-submission',args,expected,passed:false};report.cases.push(row);
 const before=await call('t830_get_'+readSection);
 if(before.status!=='returned'||!same(select(before),expected)){row.status='skipped_baseline_changed';await save();return;}
 const result=await call('t830_set_'+section,args,true);
 const after=await call('t830_get_'+readSection);
 row.acknowledged=acknowledged(result);row.status=result.status;row.error=result.error;
 row.fieldsPreserved=after.status==='returned'&&same(select(after),expected);
 row.passed=row.acknowledged&&row.fieldsPreserved;
 row.verification=result.verification;await save();
 if(!row.fieldsPreserved)throw new Error('STOP_SAME_VALUE_FIELDS_CHANGED_'+section);
}
try{
 // 禁用状态下只修改计划时间，不启用夜间断网。
 const night=await call('t830_get_wifi_night');
 if(night.status==='returned'&&night.data?.action==='Disable'){
  const original=Object.fromEntries(['action','openTime','closeTime'].map(k=>[k,night.data[k]]));
  const def=writes.find(d=>d.key==='wifi_night');
  if(def.schema.safeParse(original).success){
   await sameValue('wifi_night','wifi_night',original,original);
   const target={...original,openTime:original.openTime==='00;01'?'00;02':'00;01'};
   const row={section:'wifi_night',kind:'disabled-schedule-change-and-restore',original,target,changedVerified:false,restored:false};report.cases.push(row);await save();
   try{
    const result=await call('t830_set_wifi_night',target,true);
    const actual=await call('t830_get_wifi_night');
    row.changedVerified=actual.status==='returned'&&same(actual.data,target)&&['verified_fields','verified_field'].includes(result.status);
    row.error=result.error;
   }finally{
    const current=await call('t830_get_wifi_night');
    if(current.status==='returned'&&same(current.data,original))row.restored=true;
    else if(current.status==='returned'&&same(current.data,target)){
     await call('t830_set_wifi_night',original,true);
     const restored=await call('t830_get_wifi_night');row.restored=restored.status==='returned'&&same(restored.data,original);
    }else row.restoreError='RESTORE_CONFLICT_OR_UNAVAILABLE';
    row.passed=row.changedVerified&&row.restored;await save();
    if(!row.restored)throw new Error('STOP_NIGHT_RESTORATION_UNCONFIRMED');
   }
  }else skip('wifi_night','Cannot encode exact original configuration');
 }else skip('wifi_night','Not disabled or baseline unavailable; do not alter active schedule');
 const roaming=await call('t830_get_roaming');
 if(roaming.status==='returned'&&['Enable','Disable'].includes(roaming.data?.action))await sameValue('roaming','roaming',{action:roaming.data.action},{action:roaming.data.action});
 else skip('roaming','Baseline unavailable');
 // 只提交原有流量配置，不改变限额或计费起始日；与设备网页使用相同三个字段。
 const traffic=await call('t830_get_traffic');
 const cfg=traffic.data?.cfgs;
 const quota=value=>/^\d+$/.test(String(value))&&Number(value)%1048576===0?String(Number(value)/1048576)+'MB':/^\d+(MB|GB)$/.test(String(value))?String(value):null;
 if(traffic.status==='returned'&&cfg&&quota(cfg.day_limit)&&quota(cfg.month_limit)){
  const args={day_limit:quota(cfg.day_limit),month_limit:quota(cfg.month_limit),start_day:String(cfg.start_day)};
  const row={section:'traffic',kind:'same-value-submission',args,original:cfg,passed:false};report.cases.push(row);
  const result=await call('t830_set_traffic',args,true);
  const after=await call('t830_get_traffic');
  row.acknowledged=acknowledged(result);row.status=result.status;row.error=result.error;
  const bytes=value=>{const m=String(value).match(/^(\d+)(MB|GB)?$/);return m?BigInt(m[1])*(m[2]==='GB'?1073741824n:m[2]==='MB'?1048576n:1n):null;};
  row.fieldsPreserved=after.status==='returned'&&bytes(after.data?.cfgs?.day_limit)===bytes(cfg.day_limit)&&bytes(after.data?.cfgs?.month_limit)===bytes(cfg.month_limit)&&String(after.data?.cfgs?.enable)===String(cfg.enable)&&String(after.data?.cfgs?.start_day)===String(cfg.start_day);
  row.passed=row.acknowledged&&row.fieldsPreserved;await save();
  if(!row.fieldsPreserved)throw new Error('STOP_TRAFFIC_CONFIGURATION_NOT_CONFIRMED');
 }else skip('traffic','Original quota values cannot be encoded losslessly');
 // 无线开关只提交当前值，不关停正在使用的无线连接。
 for(const section of ['wifi','guest']){
  const result=await call('t830_get_'+section);
  if(result.status!=='returned'){skip(section+'_switch','Baseline unavailable');continue;}
  for(const name of section==='wifi'?['2.4G','5G']:['Guest','Guest5G']){
   const action=result.data?.[name]?.state;
   if(!['up','down'].includes(action)){skip(section+'_switch:'+name,'State missing');continue;}
   await sameValue(section+'_switch',section,{name,action},{state:action},o=>o.data?.[name]);
  }
 }
 // 单字段安全开关也只提交原值，不创建/删除规则，不改变过滤策略。
 for(const [section,readSection,field]of [['mac_filter_mode','mac_filter','mode'],['ip_filter_mode','ip_filter','mode'],['port_forward_switch','port_forward','switch'],['port_map_switch','port_map','switch']]){
  const result=await call('t830_get_'+readSection);const data=payload(result);
  if(result.status!=='returned'||data?.[field]===undefined){skip(section,'Baseline unavailable');continue;}
  const original=data[field];const args={[field]:field==='switch'?Number(original):String(original)};
  const def=writes.find(d=>d.key===section);
  if(!def.schema.safeParse(args).success){skip(section,'Original value does not match supported schema');continue;}
  await sameValue(section,readSection,args,{[field]:original});
 }
 // 本机回环诊断不触及业务网络目标；未启动前先读取当前结果以保留证据。
 const priorProbe=await call('t830_get_ping_result',{addr:'read_ping'});
 const probe={section:'net_probe',kind:'bounded-loopback-diagnostic',target:'127.0.0.1',passed:false,priorStatus:priorProbe.status};report.cases.push(probe);
 const sent=await call('t830_set_net_probe',{type:'PING',addr:'127.0.0.1',time:'1'},true);
 probe.submission=sent.status;
 if(sent.status==='submitted')for(let poll=0;poll<6;poll++){
  await delay(1000);const result=await call('t830_get_ping_result',{addr:'read_ping'});
  probe.readback=result.status;probe.warnings=result.warnings;
  if(result.status==='returned'){
    const text=result.data?.data;
    const stats=typeof text==='string'?text.match(/(\d+) packets transmitted, (\d+) packets received, ([\d.]+)% packet loss/):null;
    probe.passed=!!stats&&Number(stats[1])>0&&Number(stats[2])===Number(stats[1])&&Number(stats[3])===0&&text.includes('Complete');
    probe.resultVerified=probe.passed?'loopback-complete-zero-loss':'result-returned-reachability-not-confirmed';
    break;
  }
 }
 await save();
 for(const [section,reason]of [
  ['wifi_config','SSID and PSK are redacted; no complete recoverable baseline'],['guest_config','SSID and PSK are redacted; no complete recoverable baseline'],
  ['apn_save','Current profile contains a redacted password; do not overwrite or interrupt active APN'],['gps','Baseline returned HTTP_403'],
  ['alg','Getter contains additional switches outside supported write schema'],['dmz','Original empty address cannot be encoded for exact restoration'],
  ['ntp','Do not change device time or trigger synchronization while diagnosing login timestamp failure'],['reboot_schedule','Do not alter reboot scheduling; original time format is not accepted by write schema'],
  ['tr069','Credentials are redacted and ACS is active; do not contact or reconfigure remote management'],
 ])skip(section,reason);
}catch(e){report.error=e.message;process.exitCode=1;}
finally{
 report.summary={writeCalls:report.records.filter(x=>x.write).length,uniqueWriteTools:[...new Set(report.records.filter(x=>x.write).map(x=>x.name))],passed:report.cases.filter(x=>x.passed).length,failed:report.cases.filter(x=>x.passed===false&&x.status!=='skipped_baseline_changed').length,skipped:report.skipped.length,allRequiredRestorationsConfirmed:report.cases.filter(x=>x.kind.endsWith('change-and-restore')).every(x=>x.restored)};
 await save();await mcp.close();console.log('SUMMARY',JSON.stringify(report.summary));
}
