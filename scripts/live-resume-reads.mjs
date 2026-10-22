import { mkdir, writeFile } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads, toolName } from '../src/catalog.mjs';
import { redact } from '../src/t830.mjs';
const dir = new URL('../reports/live/resumed-2026-10-20/', import.meta.url);
await mkdir(dir,{recursive:true});
const report={at:new Date().toISOString(),mode:'read-only-mcp',records:[]};
const mcp=await connectTools(reads.map(d=>d.key),process.env,{enableWrites:false});
try {
  for(const def of reads) {
    const output=await mcp.call(toolName(def),def.sample);
    const privateData=['sms','phonebook'].includes(def.group);
    report.records.push({name:toolName(def),args:def.sample,output:privateData?{status:output.status,error:output.error,warnings:output.warnings,dataKeys:Object.keys(output.data||{})}:output});
    console.log(`${toolName(def)}: ${output.status} ${output.error||''}`);
    await writeFile(new URL('reads.json',dir),JSON.stringify(redact(report),null,2));
    if(['DEVICE_UNREACHABLE','DEVICE_TIMEOUT','UBUS_LOGIN_FAILED','DEVELOPER_LOGIN_FAILED'].includes(output.error))throw new Error('STOP_DEVICE_OR_AUTH_UNAVAILABLE');
  }
}catch(e){report.error=e.message;process.exitCode=1;}
finally{
  report.summary=report.records.reduce((o,r)=>(o[r.output.status]=(o[r.output.status]||0)+1,o),{});
  await mcp.close();await writeFile(new URL('reads.json',dir),JSON.stringify(redact(report),null,2));console.log(JSON.stringify(report.summary));
}
