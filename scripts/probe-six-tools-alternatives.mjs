import {T830,redact} from '../src/t830.mjs';
import {writeFile} from 'node:fs/promises';
const d=new T830({...process.env,T830_ENABLE_WRITES:'0'});const report={at:new Date().toISOString(),records:[]};
try{await d.login();for(const method of ['get_gps','get_setup','get_wifi_router_status','get_wifi_router']){
 try{const access=await d.rawRpc('session','access',{scope:'ubus',object:'web_api',function:method},true);if(!access.access){report.records.push({method,access:false});continue;}const raw=await d.rawRpc('web_api',method,{},true);report.records.push({method,raw:redact(raw)});console.log(JSON.stringify({method,raw:redact(raw)}));}
 catch(e){report.records.push({method,error:e.message});console.log(JSON.stringify({method,error:e.message}));}
}}catch(e){report.error=e.message;}finally{await d.close();await writeFile('reports/live/six-tools-2026-10-20/alternative-endpoints.json',JSON.stringify(report,null,2));}
