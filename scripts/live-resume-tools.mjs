import { mkdir, writeFile } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads, writes, toolName } from '../src/catalog.mjs';
import { redact } from '../src/t830.mjs';
import { randomBytes, createHash } from 'node:crypto';
const dir = new URL('../reports/live/resumed-2026-10-20/', import.meta.url);
await mkdir(dir, { recursive: true });
const report = { at: new Date().toISOString(), transport: process.env.T830_AUTH_TRANSPORT, records: [], cases: [], skipped: [] };
const save = () => writeFile(new URL(process.argv.includes('--writes') ? 'writes.json' : 'reads.json', dir), JSON.stringify(redact(report), null, 2));
const mcp = await connectTools(reads.map(d => d.key), process.env, { enableWrites: true });
const outputs = new Map();
const allowedWrites = new Set(['wifi_night','wifi_advanced','mac_filter_mode','ip_filter_mode','port_forward_switch','port_map_switch','reboot_schedule','wifi_scan_start','wifi_scan_list','backup_check','developer_verify']);
async function call(name, args = {}, write = false) {
  if (write && !allowedWrites.has(name.replace('t830_set_',''))) throw new Error('WRITE_OUTSIDE_TEST_SCOPE');
  const start = Date.now(); let output;
  try { output = write ? await mcp.executeApprovedWrite(name, args) : await mcp.call(name, args); }
  catch (e) { output = { status: 'error', error: e.message }; }
  const privateData = /sms|phonebook/.test(name);
  report.records.push({ name, args, write, ms: Date.now() - start, output: privateData ? { status: output.status, error: output.error, warnings: output.warnings, dataKeys: Object.keys(output.data || {}) } : output });
  outputs.set(name, output); await save(); console.log(`${name}: ${output.status} ${output.error || ''}`);
  if (['DEVICE_UNREACHABLE', 'DEVICE_TIMEOUT', 'UBUS_LOGIN_FAILED', 'DEVELOPER_LOGIN_FAILED', 'DEVELOPER_VERIFICATION_FAILED'].includes(output.error)) throw new Error('STOP_AUTH_OR_DEVICE_UNAVAILABLE');
  return output;
}
const ack = o => o.status === 'submitted' || (['verified_field', 'verified_fields'].includes(o.status) && o.submissionOutcome === 'acknowledged');
const data = o => o.data?.data ?? o.data;
async function sameValue(key, section, args, select = data) {
  const before = await call('t830_get_' + section);
  if (before.status !== 'returned' || !writes.find(d => d.key === key).schema.safeParse(args).success) { report.skipped.push({ key, reason: 'baseline unavailable or not encodable' }); return; }
  const baseline = select(before);
  const sent = await call('t830_set_' + key, args, true);
  const after = await call('t830_get_' + section);
  const unchanged = after.status === 'returned' && JSON.stringify(select(after)) === JSON.stringify(baseline);
  report.cases.push({ key, kind: 'same-value', acknowledged: ack(sent), unchanged, passed: ack(sent) && unchanged }); await save();
  if (!unchanged) throw new Error('STOP_BASELINE_CHANGED_' + key);
}
try {
  if (!process.argv.includes('--writes')) {
    for (const def of reads) await call(toolName(def), def.sample);
    for (const [name,args] of [['t830_list_capabilities',{}],['t830_query',{section:'version'}],['t830_check_access',{section:'wifi'}]]) await call(name,args);
  } else {
    for (const section of ['wifi_night','wifi_ad','mac_filter','ip_filter','port_forward','port_map','reboot_schedule','network_mode','sim_slot','workmode','mesh_role','mesh_status','signal_records','url_filter','static_ip','sms_center','clients']) await call('t830_get_' + section);
    const night = outputs.get('t830_get_wifi_night');
    if (night.status === 'returned') await sameValue('wifi_night','wifi_night',Object.fromEntries(['action','openTime','closeTime'].map(k=>[k,night.data[k]])));
    const ad = outputs.get('t830_get_wifi_ad')?.data?.page_info;
    if (ad) {
      const args = Object.fromEntries(['country_code','trans_power','isolate','wmm_state'].map(k=>[k,String(ad[k])]));
      for (const b of ['5G','2.4G']) args[b] = Object.fromEntries(['wireless_mode','band_width','channel'].map(k=>[k,String(ad[b]?.[k])]));
      await sameValue('wifi_advanced','wifi_ad',args,o=>o.data?.page_info);
    }
    for (const [key,section,field] of [['mac_filter_mode','mac_filter','mode'],['ip_filter_mode','ip_filter','mode'],['port_forward_switch','port_forward','switch'],['port_map_switch','port_map','switch']]) {
      const value = data(outputs.get('t830_get_' + section))?.[field];
      if(value !== undefined) await sameValue(key,section,{[field]:field==='switch'?Number(value):String(value)});
    }
    const sch = outputs.get('t830_get_reboot_schedule');
    if (sch.status==='returned' && data(sch)?.action==='Disable') await sameValue('reboot_schedule','reboot_schedule',{action:'Disable'});
    // These tools do not change configured network topology or existing user data.
    for (const key of ['wifi_scan_start','wifi_scan_list','backup_check']) await call('t830_set_'+key,writes.find(d=>d.key===key).sample,true);
    await call('t830_set_developer_verify',{reply:'superpasswd',base64:process.env.T830_DEVELOPER_KEY},true);
    await call('t830_get_status');
  }
} catch(e) { report.error = e.message; process.exitCode = 1; }
finally {
  report.summary = { readCalls:report.records.filter(r=>!r.write).length,writeCalls:report.records.filter(r=>r.write).length,uniqueWriteTools:[...new Set(report.records.filter(r=>r.write).map(r=>r.name))],statuses:report.records.reduce((o,r)=>(o[r.output.status]=(o[r.output.status]||0)+1,o),{}) };
  await save(); await mcp.close(); console.log(JSON.stringify(report.summary));
}
