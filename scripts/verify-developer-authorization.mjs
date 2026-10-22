import {T830} from '../src/t830.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const device=new T830({ ...process.env, T830_DEVELOPER_KEY: '' });const report={at:new Date().toISOString(),flow:'vendor-ui: verify supplied key, then login superadmin',credentialsPersisted:false};
try{
 await device.login();
 const verified=await device.rawRpc('gen.attr','check_asymmetric_verify',{reply:'superpasswd',base64:process.env.T830_DEVELOPER_KEY},true);
 report.verificationCode=verified?.code;
 if(Number(verified?.code)!==200||typeof verified.passwd!=='string'||!verified.passwd)throw new Error('DEVELOPER_KEY_REJECTED');
 const salt=randomBytes(32).toString('hex');
 const login=await device.request('/cgi-bin/luci/login/action_login',{username:'superadmin',salt,password:createHash('sha256').update(salt+':'+verified.passwd).digest('hex')},'action_login');
 verified.passwd=undefined;
 report.loginCode=login.code;
 if(Number(login.code)!==0||!device.token)throw new Error('SUPERADMIN_LOGIN_REJECTED');
 report.permissionChecks=[];
 for(const [service,method] of [['mtk.wifi','get_AdvancPage_info'],['mtk.cell','get_simcard_index'],['sms_app','all_sms']]){
  const access=await device.rawRpc('session','access',{scope:'ubus',object:service,function:method},true);
  report.permissionChecks.push({service,method,access:access.access});
 }
 console.log(JSON.stringify(report));
}catch(e){report.error=e.message;console.log(JSON.stringify(report));process.exitCode=1;}finally{await device.close();await writeFile('reports/live/all-tools-2026-10-20/developer-authorization.json',JSON.stringify(report,null,2));}
