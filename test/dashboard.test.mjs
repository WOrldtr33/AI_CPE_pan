import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Dashboard,normalizeDashboard} from '../src/dashboard.mjs';
import {AgentStore} from '../src/agent-store.mjs';
const result=data=>({status:'returned',data:{data}});
test('dashboard preserves unknown quality and rate units; counts terminals rather than people',()=>{
 const r=normalizeDashboard({status:result({DLrate:'20',ULrate:'2',wanstat:'true,false'}),clients:result({brlan_count:'2',ra0_count:1})});assert.equal(r.rates.down,null);assert.equal(r.quality.level,null);assert.equal(r.clients,3);
 assert.equal(normalizeDashboard({status:result({DLrate:'20',ULrate:'0',wanstat:'false,false'})},'Mbps').rates.down,2500000);
 assert.equal(normalizeDashboard({status:result({DLrate:'0',ULrate:'0'})}).rates.down,0);
 const live=normalizeDashboard({status:result({DLrate:'0',ULrate:'0',wanstat:'true,ccmni',SignalValue:'-78 dBm',long_eons:'ChinaUnicom',NR_or_LTE:'5G',SimStatus:'21'}),sim_presence:{status:'returned',data:{data:{simcard_inslot:'21'}}}});
 assert.equal(live.quality.level,4);assert.equal(live.cellular.slot,'present');assert.equal(live.cellular.operator,'ChinaUnicom');assert.equal(live.cellular.radio,'5G');
 assert.equal(normalizeDashboard({status:result({wanstat:'true,ccmni',SIM:'8610000000000'})}).cellular.operator,null);
});
async function fixture(fn){await mkdir('.media-state',{recursive:true});const dir=await mkdtemp(join(process.cwd(),'.media-state/dashboard-test-')),store=new AgentStore(join(dir,'agent'));let value='0',writes=0,uptime=500;
 const mcp={deviceKey:'test-device',writeTools:new Set(['t830_set_upnp_verified']),definitions:['status','clients','device_info','dhcp','upnp'].map(n=>({function:{name:'t830_get_'+n}})),call:async name=>result(name.endsWith('upnp')?{upnp_switch:value}:name.endsWith('device_info')?{up_second:uptime,LanIP:'192.168.0.1'}:name.endsWith('status')?{DLrate:'0',ULrate:'0',wanstat:'false,false'}:{})};
 const approve=async id=>{const{task,proposal}=store.proposal(id);if(task.status!=='awaiting_approval'||proposal.status!=='pending')throw new Error('PROPOSAL_NOT_PENDING');if(value!==proposal.args.expectedCurrent)throw new Error('CONFLICT');writes++;value=proposal.args.upnp_switch;task.status='completed';proposal.status='completed';store.saveTask(task);return{result:{status:'verified_field'}};};
 try{const dashboard=await new Dashboard({mcp,store,approve,directory:dir}).init();await fn({dashboard,dir,mcp,store,get writes(){return writes;},change:v=>{value=v;},reboot:()=>{uptime=3;}});}finally{store.close();await rm(dir,{recursive:true,force:true});}}
test('dashboard settings require explicit approval; duplicate confirmation never repeats writes; undo is a new proposal',()=>fixture(async f=>{
 const p=await f.dashboard.handle('prepare',{value:'1'});assert.equal(f.writes,0);await assert.rejects(f.dashboard.handle('confirm',{id:p.id}),/CONFIRMATION_REQUIRED/);assert.equal(f.writes,0);
 const receipt=await f.dashboard.handle('confirm',{id:p.id,confirmed:true});assert.equal(receipt.status,'verified');assert.equal(f.writes,1);await assert.rejects(f.dashboard.handle('confirm',{id:p.id,confirmed:true}),/NOT_PENDING/);assert.equal(f.writes,1);
 const undo=await f.dashboard.handle('undo',{id:p.id});assert.notEqual(undo.id,p.id);assert.equal(undo.after,'0');assert.equal(f.writes,1);await f.dashboard.handle('confirm',{id:undo.id,confirmed:true});assert.equal(f.writes,2);
}));
test('dashboard undo refuses to overwrite a subsequent device change',()=>fixture(async f=>{const p=await f.dashboard.handle('prepare',{value:'1'});await f.dashboard.handle('confirm',{id:p.id,confirmed:true});f.change('0');await assert.rejects(f.dashboard.handle('undo',{id:p.id}),/SETTING_CONFLICT/);assert.equal(f.writes,1);}));
test('dashboard cancelled settings cannot be submitted',()=>fixture(async f=>{const p=await f.dashboard.handle('prepare',{value:'1'});await f.dashboard.handle('cancel',{id:p.id});await assert.rejects(f.dashboard.handle('confirm',{id:p.id,confirmed:true}),/NOT_PENDING/);assert.equal(f.writes,0);}));
test('dashboard boot history resets at reboot and never mixes device identities',()=>fixture(async f=>{
 const first=await f.dashboard.snapshot(true);assert.equal(f.dashboard.points.length,1);const restored=await new Dashboard({mcp:f.mcp,store:f.store,directory:f.dir}).init();assert.equal(restored.points.length,1);
 const other=await new Dashboard({mcp:{...f.mcp,deviceKey:'other-device'},store:f.store,directory:f.dir}).init();assert.equal(other.points.length,0);
 f.reboot();const next=await f.dashboard.snapshot(true);assert.notEqual(next.bootId,first.bootId);assert.equal(f.dashboard.points.length,1);
}));

test('Suggested queries come only from enabled catalog reads that need no missing parameters',()=>fixture(async f=>{
 f.dashboard.enabled.add('t830_get_wps_run');f.dashboard.enabled.add('t830_get_unknown');const snapshot=await f.dashboard.snapshot(true);const ids=snapshot.suggestions.map(s=>s.id);assert.ok(ids.includes('status'));assert.ok(ids.includes('diagnose'));assert(!ids.includes('wps_run'));assert(!ids.includes('unknown'));assert(!ids.includes('wifi'));
}));
