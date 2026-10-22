import {connectTools} from '../src/agent-mcp.mjs';
import {writes} from '../src/catalog.mjs';
import {writeFile} from 'node:fs/promises';
if(process.argv[2]!=='--apply'||process.argv.length!==3)throw new Error('Usage: node scripts/live-advanced-wifi-current.mjs --apply');
const path='reports/live/writes-developer-after-reboot-2026-10-20/advanced-current-value.json';
const report={at:new Date().toISOString(),mode:'same-value-advanced-wifi',records:[],passed:false};
const mcp=await connectTools(['wifi_ad'],process.env,{enableWrites:true});
const snapshot=output=>{
 const p=output.data?.page_info;if(output.status!=='returned'||!p)throw new Error('ADVANCED_BASELINE_UNAVAILABLE');
 const required=(value)=>{if(value===undefined||value===null)throw new Error('INCOMPLETE_ADVANCED_BASELINE');return String(value);};
 return {country_code:required(p.country_code),trans_power:required(p.trans_power),isolate:required(p.isolate),wmm_state:required(p.wmm_state),...Object.fromEntries(['5G','2.4G'].map(b=>[b,Object.fromEntries(['wireless_mode','band_width','channel'].map(k=>[k,required(p[b]?.[k])]))]))};
};
const call=async(name,args={},write=false)=>{const result=write?await mcp.executeApprovedWrite(name,args):await mcp.call(name,args);report.records.push({name,args,write,output:result});return result;};
try{
 const original=snapshot(await call('t830_get_wifi_ad'));
 const def=writes.find(d=>d.key==='wifi_advanced');def.schema.parse(original);report.original=original;
 if(JSON.stringify(snapshot(await call('t830_get_wifi_ad')))!==JSON.stringify(original))throw new Error('BASELINE_CHANGED_STOP');
 const result=await call('t830_set_wifi_advanced',original,true);
 report.submission=result.status;report.error=result.error;
 const after=snapshot(await call('t830_get_wifi_ad'));
 report.unchanged=JSON.stringify(after)===JSON.stringify(original);
 report.passed=result.status==='submitted'&&report.unchanged;
 if(!report.unchanged){
  report.restoreRequired=true;
  const restored=await call('t830_set_wifi_advanced',original,true);
  report.restoreSubmission=restored.status;
  report.restored=JSON.stringify(snapshot(await call('t830_get_wifi_ad')))===JSON.stringify(original);
  if(!report.restored)throw new Error('ADVANCED_RESTORATION_UNCONFIRMED');
 }
}catch(e){report.error=e.message;process.exitCode=1;}finally{await mcp.close();await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,submission:report.submission,error:report.error,unchanged:report.unchanged,restored:report.restored,writeCalls:report.records.filter(x=>x.write).length}));}
