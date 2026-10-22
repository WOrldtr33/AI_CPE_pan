import {T830} from '../src/t830.mjs';
import {writeFile} from 'node:fs/promises';
const d=new T830({...process.env,T830_AUTH_TRANSPORT:'ubus'});
const report={at:new Date().toISOString(),mode:'read-only-native-session-cookie-compatibility',records:[]};
try{
 await d.login();
 for(const name of ['sysauth_http','sysauth']){
  d.cookies=[{pair:name+'='+d.token,path:'/',secure:false}];
  try{const out=await d.request('/cgi-bin/luci/admin/jt_lan/get_dhcp',undefined,'get_dhcp',{cookie:true});report.records.push({cookieName:name,status:'returned',code:out.code,keys:Object.keys(out.data||{})});}
  catch(e){report.records.push({cookieName:name,error:e.message});}
 }
}catch(e){report.error=e.message;}finally{await d.close();await writeFile('reports/live/writes-developer-after-reboot-2026-10-20/native-cookie-compatibility.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
