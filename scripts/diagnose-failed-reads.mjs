import { T830, redact } from '../src/t830.mjs';
import { reads } from '../src/catalog.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const prior=JSON.parse(await readFile('reports/live/all-tools-2026-10-20/results.json','utf8'));
const device=new T830();const records=[];
try{
 await device.login();
 const cookie=device.cookies.map(c=>c.pair).join('; ');
 for(const row of prior.reads.filter(r=>r.output.status==='error')){
  const d=reads.find(d=>d.key===row.section);
  const flag=d.transport==='cgi'?d.path.split('/').at(-1):d.method;
  const headers={'Content-Type':'application/json',Cookie:cookie,Authorization:'Bearer '+device.token,Origin:device.base.origin,Referer:device.base.origin+'/'};
  const url=new URL(d.transport==='cgi'?d.path:'/ubus/',device.base);url.searchParams.set('flag',flag);url.searchParams.set('t',Date.now());
  const body=d.transport==='cgi'?undefined:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:[device.token,d.service,d.method,d.sample]});
  const r=await fetch(url,{headers,method:body?'POST':'GET',body,redirect:'manual',signal:AbortSignal.timeout(10000)});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{}
  const result={section:d.key,http:r.status,flag,shape:data?Object.keys(data):undefined,rpcError:data?.error?.code,resultCode:data?.result?.[0],businessCode:data?.code,loginRequired:r.headers.get('x-luci-login-required')};
  if(d.transport==='ubus')try{const p=await device.rpc('session','access',{scope:'ubus',object:d.service,function:d.method});result.permission=p.data?.access;}catch(e){result.permissionError=e.message}
  records.push(result);console.log(JSON.stringify(result));
 }
}finally{await device.close();await writeFile('reports/diagnostics/failed-read-browser-parity-2026-10-20.json',JSON.stringify({at:new Date().toISOString(),headers:'same-origin Cookie, Bearer session, Origin, Referer; vendor flag',records:redact(records)},null,2));}
