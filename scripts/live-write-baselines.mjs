import {mkdir,writeFile} from 'node:fs/promises';
import {connectTools} from '../src/agent-mcp.mjs';
const sections=['wifi_night','roaming','traffic','apn','mac_filter','ip_filter','port_forward','port_map','dmz','alg','ntp','reboot_schedule','tr069','gps','wifi','guest'];
const dir=new URL(process.argv.includes('--after-reboot') ? '../reports/live/writes-developer-after-reboot-2026-10-20/' : '../reports/live/writes-developer-2026-10-20/',import.meta.url);
await mkdir(dir,{recursive:true});
const report={at:new Date().toISOString(),mode:'read-only-write-baselines',records:[]};
const mcp=await connectTools(sections,process.env);
try{
 for(const section of sections){
  const output=await mcp.call('t830_get_'+section,{});
  report.records.push({section,output});
  console.log(JSON.stringify({section,status:output.status,error:output.error,data:output.data,warnings:output.warnings}));
  await writeFile(new URL(process.argv.includes('--native') ? 'baselines-native.json' : 'baselines.json',dir),JSON.stringify(report,null,2));
  if(output.status==='error' && output.details?.diagnosticSummary?.attempts===0) throw new Error('AUTH_INITIALIZATION_FAILED_'+output.error);
  if(['LOGIN_FAILED_CHECK_CREDENTIALS','DEVELOPER_VERIFICATION_FAILED','DEVELOPER_LOGIN_FAILED','DEVICE_UNREACHABLE'].includes(output.error))throw new Error(output.error);
 }
}finally{await mcp.close();}
