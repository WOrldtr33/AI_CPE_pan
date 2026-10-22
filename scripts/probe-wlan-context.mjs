import{T830}from'../src/t830.mjs';import{writeFile}from'node:fs/promises';
const d=new T830({...process.env,T830_ENABLE_WRITES:'0'});const report={at:new Date().toISOString(),records:[]};
try{await d.login();
 try{const raw=await d.rawRpc('network.wireless','status',{},true);report.records.push({action:'wireless-status',radios:Object.entries(raw).map(([name,radio])=>({name,up:radio.up,disabled:radio.disabled,pending:radio.pending,interfaces:(radio.interfaces||[]).map(iface=>({ifname:iface.ifname,mode:iface.config?.mode,disabled:iface.config?.disabled}))}))});}catch(e){report.records.push({action:'wireless-status',error:e.message});}
 const p=await d.rawRpc('session','access',{scope:'uci',object:'wireless',function:'read'},true);report.configReadAllowed=p.access;
 if(p.access){try{const r=await d.rawRpc('uci','get',{config:'wireless',type:'wifi-iface',match:{mode:'sta'}},true);report.stationConfig=Object.entries(r.values||{}).map(([section,v])=>({section,mode:v.mode,disabled:v.disabled,ifname:v.ifname,network:v.network}));}catch(e){report.configError=e.message;}}
}catch(e){report.error=e.message;}finally{await d.close();await writeFile('reports/live/six-tools-2026-10-20/wlan-context.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
