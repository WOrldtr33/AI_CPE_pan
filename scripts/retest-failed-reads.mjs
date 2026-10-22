import { readFile, writeFile } from 'node:fs/promises';
import { connectTools } from '../src/agent-mcp.mjs';
import { reads, toolName } from '../src/catalog.mjs';
const previous=JSON.parse(await readFile('reports/live/all-tools-2026-10-20/results.json','utf8'));
const report={at:new Date().toISOString(),mode:process.argv.includes('--developer')?'live-read-only-developer':'live-read-only-after-fix',records:[],realWrites:0};
const mcp=await connectTools(reads.map(d=>d.key),process.env);
try {
 for(const def of reads) {
  const output=await mcp.call(toolName(def),def.sample);
  const before=previous.reads.find(row=>row.section===def.key)?.output;
  // 复测报告只记录状态、分类与诊断，避免复制短信、电话本或完整设备配置。
  report.records.push({section:def.key,tool:toolName(def),before:before?.status,status:output.status,error:output.error,failure:output.failure,diagnosticSummary:output.details?.diagnosticSummary,validation:output.validation});
  console.log(`${toolName(def)}: ${output.status}${output.failure?' / '+output.failure.category:''}`);
 }
 report.summary=Object.fromEntries(['returned','device_warning','error'].map(status=>[status,report.records.filter(row=>row.status===status).length]));
 console.log('SUMMARY',JSON.stringify(report.summary));
} finally {
 await mcp.close();
 await writeFile('reports/live/all-tools-2026-10-20/'+(process.argv.includes('--developer')?'developer-reads.json':'after-fix.json'),JSON.stringify(report,null,2));
}
