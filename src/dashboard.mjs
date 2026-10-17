import {reads} from './catalog.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const payload = result => ['returned','device_warning'].includes(result?.status) ? (result.data?.data || result.data || {}) : {};
const number = value => value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
const ip = value => typeof value==='string' && value.trim() && value!=='[REDACTED]' ? value.trim() : null;
export function normalizeDashboard(results, rateUnit) {
 const status=payload(results.status),device=payload(results.device_info),clients=payload(results.clients),dhcp=payload(results.dhcp),upnp=payload(results.upnp);
 const down=number(status.DLrate),up=number(status.ULrate);
 const factors={'B/s':1,'KB/s':1000,'MB/s':1e6,'bps':1/8,'Kbps':125,'Mbps':125000};
 const convert=v=>v===0?0:v!==null&&v>=0&&factors[rateUnit]?v*factors[rateUnit]:null;
 const counts=['brlan_count','ra0_count','ra1_count','rai0_count','rai1_count'].map(k=>number(clients[k]));
 const online=typeof status.wanstat==='string'?status.wanstat.split(',').some(v=>v.trim()==='true'):null;
 return { observedAt:Date.now(), available:results.status?.status==='returned', online,
  rates:{down:convert(down),up:convert(up),rawDown:down,rawUp:up,unit:rateUnit||null},
  clients:counts.some(v=>v!==null)?counts.reduce((s,n)=>s+(n||0),0):null,
  quality:{level:online===false?0:null,label:online===false?'上联未连接':'质量待测',basis:online===false?'设备上联状态':'尚无经验证的网络质量测量'},
  ips:{lan:ip(device.LanIP)||ip(dhcp.gateway),wan:ip(device.ccmni_ipv4)||ip(device.eth1_ipv4),ipv6:ip(device.ccmni_ipv6)||ip(device.eth1_ipv6),gateway:ip(dhcp.gateway),dns:ip(device.ccmni_dns)},
  device:{model:ip(device.ModelName),firmware:ip(device.SoftwareVersion),hardware:ip(device.HardwareVersion),uptimeSeconds:number(device.up_second)},
  upnp:['0','1'].includes(upnp.upnp_switch)?upnp.upnp_switch:null,
  queries:Object.entries(results).map(([name,r])=>({name,status:r.status,error:r.status==='error'?(r.error||'查询失败'):undefined})) };
}

export class Dashboard {
 constructor({mcp,store,approve,directory,rateUnit}) {Object.assign(this,{mcp,store,approve,directory,rateUnit});this.cache={};this.points=[];this.receipts=new Map();this.enabled=new Set(mcp.definitions.filter(d=>d.function.name.startsWith('t830_get_')).map(d=>d.function.name));}
 async init(){await mkdir(this.directory,{recursive:true});try{const saved=JSON.parse(await readFile(join(this.directory,'dashboard-history.json'),'utf8'));if(saved.deviceKey===this.mcp.deviceKey&&Array.isArray(saved.points)){this.points=saved.points.filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.down)&&Number.isFinite(p.up)).slice(-50000);this.boot=saved.boot;this.lastUptime=saved.lastUptime;this.lastUptimeAt=saved.lastUptimeAt;}}catch{}return this;}
 async read(name,signal){const tool='t830_get_'+name;if(!this.enabled.has(tool))return {status:'error',error:'查询尚未授权'};try{return await this.mcp.call(tool,{},signal);}catch{return{status:'error',error:'设备查询失败'};}}
 async snapshot(force=false,externalSignal){
  if(this.pending)return this.pending;if(!force&&this.current&&Date.now()-this.current.observedAt<2500)return this.current;
  this.pending=(async()=>{const signal=AbortSignal.any([AbortSignal.timeout(12000),...(externalSignal?[externalSignal]:[])]);
   for(const name of ['status','clients','device_info','dhcp','upnp']){if(force||!this.cache[name]||Date.now()-this.cache[name].at>(name==='status'?2500:30000))this.cache[name]={at:Date.now(),result:await this.read(name,signal)};}
   const normalized=normalizeDashboard(Object.fromEntries(Object.entries(this.cache).map(([key,v])=>[key,v.result])),this.rateUnit);
   const uptime=normalized.device.uptimeSeconds;
   if(uptime!==null){const predicted=this.lastUptime===undefined?null:this.lastUptime+(Date.now()-this.lastUptimeAt)/1000;if(!this.boot||predicted!==null&&Math.abs(uptime-predicted)>60){this.boot=randomUUID();this.points=[];}this.lastUptime=uptime;this.lastUptimeAt=Date.now();}
   if(!this.boot)this.boot=randomUUID();
   if(normalized.available&&normalized.rates.down!==null&&normalized.rates.up!==null){this.points.push({t:normalized.observedAt,down:normalized.rates.down,up:normalized.rates.up,source:'live'});this.points=this.points.slice(-50000);await writeFile(join(this.directory,'dashboard-history.json'),JSON.stringify({deviceKey:this.mcp.deviceKey,boot:this.boot,points:this.points,lastUptime:this.lastUptime,lastUptimeAt:this.lastUptimeAt}));}
   const labels={status:'查看网络状态',clients:'有哪些设备在线',device_info:'查看设备信息',wifi:'查看无线网络',version:'查看固件版本',dhcp:'查看地址分配',workmode:'查看设备工作模式'};
   const priority=['status','clients','device_info','wifi','version'];
   const suggestions=reads.filter(d=>this.enabled.has('t830_get_'+d.key)&&d.schema.safeParse({}).success).sort((a,b)=>(priority.indexOf(a.key)<0?99:priority.indexOf(a.key))-(priority.indexOf(b.key)<0?99:priority.indexOf(b.key))).map(d=>({id:d.key,text:labels[d.key]||'查看'+d.description}));
   if(this.enabled.has('t830_get_status')&&this.enabled.has('t830_get_device_info'))suggestions.splice(2,0,{id:'diagnose',text:'帮我排查网络'});
   this.current={...normalized,suggestions,bootId:this.boot,historySince:this.points[0]?.t||null,writeEnabled:!!this.mcp.writeTools?.has('t830_set_upnp_verified')};return this.current;
  })();try{return await this.pending;}finally{this.pending=undefined;}
 }
 async handle(action,body,signal){
  if(action==='snapshot')return this.snapshot(body.refresh===true,signal);
  if(action==='history')return{bootId:this.boot,points:this.points,note:'仅包含本次设备开机期间实际采集到的历史，未采集区间无法补回。'};
  if(action==='prepare'){
   if(!this.mcp.writeTools?.has('t830_set_upnp_verified'))throw new Error('MEDIA_DEVICE_WRITE_DISABLED');
   if(!['0','1'].includes(body.value))throw new Error('MEDIA_INVALID_SETTING');
   const current=payload(await this.read('upnp',signal)).upnp_switch;if(!['0','1'].includes(current))throw new Error('MEDIA_SETTING_READ_FAILED');
   if(body.expected!==undefined&&body.expected!==current)throw new Error('MEDIA_SETTING_CONFLICT');
   if(body.value===current)throw new Error('MEDIA_SETTING_UNCHANGED');
   const task=this.store.createTask('网页用户修改 UPnP');const proposal=this.store.propose(task,'t830_set_upnp_verified',{upnp_switch:body.value,expectedCurrent:current});task.status='awaiting_approval';this.store.saveTask(task);
   return{status:'awaiting_confirmation',id:proposal.id,taskId:task.id,before:current,after:body.value};
  }
  if(action==='cancel'){const {task}=this.store.proposal(body.id);this.store.cancel(task.id);return{status:'cancelled'};}
  if(action==='confirm'){
   if(body.confirmed!==true)throw new Error('MEDIA_CONFIRMATION_REQUIRED');const{proposal}=this.store.proposal(body.id);
   if(proposal.name!=='t830_set_upnp_verified'||Date.now()-Date.parse(proposal.createdAt)>600000)throw new Error('MEDIA_SETTING_EXPIRED');
   const before=proposal.args.expectedCurrent,after=proposal.args.upnp_switch;const output=await this.approve(body.id,signal);const verified=['verified_field','verified_fields'].includes(output.result?.status);
   if(verified)this.receipts.set(body.id,{before,after});this.cache.upnp=undefined;this.current=undefined;
   return {status:verified?'verified':'unknown',id:body.id,before,after,result:output.result,canUndo:verified};
  }
  if(action==='undo'){
   const receipt=this.receipts.get(body.id);if(!receipt)throw new Error('MEDIA_UNDO_UNAVAILABLE');
   return this.handle('prepare',{value:receipt.before,expected:receipt.after},signal);
  }
  throw new Error('MEDIA_DASHBOARD_ACTION_INVALID');
 }
}

