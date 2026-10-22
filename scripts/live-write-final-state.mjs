import {connectTools} from '../src/agent-mcp.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const sections=['wifi_night','roaming','traffic','wifi','guest','mac_filter','ip_filter','port_forward','port_map','wifi_ad'];
const mcp=await connectTools(sections,process.env);
const report={at:new Date().toISOString(),records:[]};
try{for(const section of sections){const output=await mcp.call('t830_get_'+section,{});report.records.push({section,status:output.status,error:output.error,data:section==='wifi_ad'?output.data?.page_info:output.data});}}
finally{await mcp.close();}
try{
 const c=JSON.parse(await readFile('.media-state/connection.json','utf8'));
 const r=await fetch(c.url+'/api/dashboard/snapshot',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({refresh:true}),signal:AbortSignal.timeout(30000)});
 const d=await r.json();report.dashboard={http:r.status,available:d.available,online:d.online,upnp:d.upnp,uptime:d.device?.uptimeSeconds,queries:d.queries};
}catch(e){report.dashboard={error:e.message};}
await writeFile('reports/live/writes-developer-after-reboot-2026-10-20/final-state.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({readStatuses:report.records.map(x=>({section:x.section,status:x.status,error:x.error})),dashboard:report.dashboard}));
