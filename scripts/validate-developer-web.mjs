import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const c=JSON.parse(await readFile('.media-state/connection.json','utf8'));
const post=async(path,body)=>{const response=await fetch(c.url+path,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});return {http:response.status,data:await response.json()};};
const dashboard=await post('/api/dashboard/snapshot',{refresh:true});
const chat=await post('/api/chat',{text:'开发者会话实机只读复测：请调用工具重新查询高级 WiFi 配置（wifi_ad），只报告本次查询是否成功。不要修改任何配置或执行待确认提案。'});
const report={at:new Date().toISOString(),dashboard:{http:dashboard.http,available:dashboard.data.available,online:dashboard.data.online,upnp:dashboard.data.upnp,queries:dashboard.data.queries},chat:{http:chat.http,status:chat.data.status,error:chat.data.error,calls:chat.data.calls,taskId:chat.data.taskId}};
for(const dir of await readdir('.agent-state',{withFileTypes:true})){
 if(!dir.isDirectory()||!chat.data.taskId)continue;
 try{const task=JSON.parse(await readFile(join('.agent-state',dir.name,'tasks',chat.data.taskId+'.json'),'utf8'));report.chat.tools=task.steps.map(s=>({name:s.name,args:s.args,status:s.result?.status,error:s.result?.error}));break;}catch{}
}
await writeFile('reports/live/all-tools-2026-10-20/developer-web-validation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
