import {T830} from '../src/t830.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const d=new T830({...process.env,T830_ENABLE_WRITES:'0'});const report={at:new Date().toISOString(),records:[]};
try{
 await d.login();
 for(const method of ['read_book','select_book']){
  const args=method==='read_book'?{device:'1',type:'ALL'}:{device:'1',type:'',name:''};
  const r=await d.rawRpc('phone_book',method,args,true);report.records.push({method,args,code:r.code,dataType:typeof r.data,isNull:r.data===null,isEmptyString:r.data==='',isArray:Array.isArray(r.data),entries:r.data&&typeof r.data==='object'?Object.keys(r.data).length:0});
 }
 for(const params of [['*'],[d.token,'*']]){
  try{const r=await d.request('/ubus/',{jsonrpc:'2.0',id:200,method:'list',params},'list',{cookie:true});report.records.push({action:'ubus-list',parameterShape:params.length,keys:Object.keys(r),error:r.error?.code,result:r.result});}catch(e){report.records.push({action:'ubus-list',error:e.message});}
 }
 try{const result=await d.rawRpc('file','exec',{command:'/bin/ubus',params:['list']},true);report.records.push({action:'ubus-list-cli',code:result.code,stdout:result.stdout,stderr:result.stderr});}catch(e){report.records.push({action:'ubus-list-cli',error:e.message});}
}catch(e){report.error=e.message;}finally{await d.close();await mkdir('reports/live/six-tools-2026-10-20',{recursive:true});await writeFile('reports/live/six-tools-2026-10-20/metadata.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
