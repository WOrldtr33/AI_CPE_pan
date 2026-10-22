import {T830} from '../src/t830.mjs';
import {writeFile} from 'node:fs/promises';
const d=new T830({...process.env,T830_DEVELOPER_KEY:''});
const report={at:new Date().toISOString(),mode:'standard-rpcd-auth-probe',stages:[]};
async function login(username,password){
 const r=await fetch('http://192.168.0.1/ubus/?flag=login&t='+Date.now(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:['00000000000000000000000000000000','session','login',{username,password,timeout:300}]}),signal:AbortSignal.timeout(10000)});
 const body=await r.json();report.stages.push({stage:'session.login',username,http:r.status,rpcError:body.error?.code,resultCode:body.result?.[0],sessionCreated:!!body.result?.[1]?.ubus_rpc_session});
 if(body.result?.[0]!==0||!body.result?.[1]?.ubus_rpc_session)throw new Error('STANDARD_LOGIN_REJECTED');
 d.token=body.result[1].ubus_rpc_session;
}
try{
 await login('admin',process.env.T830_PASSWORD);
 const v=await d.rawRpc('gen.attr','check_asymmetric_verify',{reply:'superpasswd',base64:process.env.T830_DEVELOPER_KEY},false);
 report.stages.push({stage:'developer-key-verification',code:v.code,hasPassword:typeof v.passwd==='string'});
 if(Number(v.code)!==200||!v.passwd)throw new Error('DEVELOPER_KEY_REJECTED');
 await login('superadmin',v.passwd);v.passwd=undefined;
 const p=await d.rawRpc('session','access',{scope:'ubus',object:'mtk.wifi',function:'get_NigWifi_info'});
 report.permission={object:'mtk.wifi',method:'get_NigWifi_info',access:p.access};
 const result=await d.rawRpc('mtk.wifi','get_NigWifi_info');report.baseline={section:'wifi_night',data:result};
}catch(e){report.error=e.message;}finally{await d.close();await writeFile('reports/live/writes-developer-after-reboot-2026-10-20/native-developer-auth.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
