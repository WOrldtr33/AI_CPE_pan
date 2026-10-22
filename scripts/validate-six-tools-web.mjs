import {readFile,writeFile,readdir} from 'node:fs/promises';import {join} from 'node:path';
const c=JSON.parse(await readFile('.media-state/connection.json','utf8'));
const response=await fetch(c.url+'/api/chat',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify({text:'六项修复后的只读验收：请分别调用查询工具读取 setup（参数 {}）和 phonebook_select（参数 {"device":"1"}），只说明本次是否成功及电话本是否为空，不输出配置或联系人内容；不要执行任何写操作或待确认提案。'}),signal:AbortSignal.timeout(180000)});
const result=await response.json();const report={at:new Date().toISOString(),http:response.status,status:result.status,error:result.error,calls:result.calls,taskId:result.taskId};
for(const dir of await readdir('.agent-state',{withFileTypes:true})){
 if(!dir.isDirectory()||!result.taskId)continue;
 try{const t=JSON.parse(await readFile(join('.agent-state',dir.name,'tasks',result.taskId+'.json'),'utf8'));report.tools=t.steps.map(s=>({name:s.name,args:s.args,status:s.result?.status,error:s.result?.error,reading:s.result?.reading}));break;}catch{}
}
await writeFile('reports/live/six-tools-2026-10-20/web-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
