import {T830} from '../src/t830.mjs';
import {writes,toolName} from '../src/catalog.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const d=new T830({...process.env,T830_ENABLE_WRITES:'0'});
const r={at:new Date().toISOString(),mode:'developer-read-only-write-permissions',realWrites:0,records:[]};
try{
 await d.login();
 r.developerAuthenticated=d.developerAuthenticated;
 for(const def of writes){
  const row={tool:toolName(def),section:def.key,permission:{status:'not_checked',reason:'CGI authorization is not established by UBUS session.access'}};
  if(def.transport==='ubus'){
   try{const p=await d.rpc('session','access',{scope:'ubus',object:def.service,function:def.method});row.permission={status:p.status,access:p.data?.access};}catch(e){row.permission={status:'error',error:e.message};}
  }
  r.records.push(row);
 }
 r.summary={granted:r.records.filter(x=>x.permission.access===true).length,denied:r.records.filter(x=>x.permission.access===false).length,notChecked:r.records.filter(x=>x.permission.status==='not_checked').length,errors:r.records.filter(x=>x.permission.status==='error').length};
 console.log(JSON.stringify(r.summary));
}catch(e){r.error=e.message;console.log(JSON.stringify({error:e.message}));process.exitCode=1;}finally{await d.close();await writeFile('reports/live/all-tools-2026-10-20/developer-write-permissions.json',JSON.stringify(r,null,2));}
