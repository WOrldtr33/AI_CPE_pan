import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writes } from '../src/catalog.mjs';
const path='reports/live/all-tools-2026-10-20/results.json';
const r=JSON.parse(await readFile(path,'utf8'));
const taskId=r.endToEnd?.chat.result.taskId;
for(const entry of await readdir('.agent-state',{withFileTypes:true})) {
 if(!entry.isDirectory())continue;
 try { const task=JSON.parse(await readFile(join('.agent-state',entry.name,'tasks',taskId+'.json'),'utf8'));
 r.endToEnd.modelTools=task.steps.map(s=>({name:s.name,args:s.args,status:s.result?.status,error:s.result?.error})); break;
 }catch{}
}
const success=r.controlledWrites.filter(row=>row.write&&['verified_field','verified_fields'].includes(row.output.status));
const tested=new Set(success.map(row=>row.tool));
r.mode='live-mcp-reads-write-preflight-and-controlled-reversible-writes';
function limitation(row) {
 if(tested.has(row.tool))return '真实写入并回读验证通过';
 const key=row.section;
 let reason;
 if(/firmware|factory_reset|backup_restore|backup_delete|password|setup_save/.test(key))reason='高影响、凭据变更或数据风险，按用户选择未执行';
 else if(/^(pin_|puk_)/.test(key))reason='需真实 PIN/PUK，尝试可能锁卡，未执行';
 else if(/sms|phonebook/.test(key))reason='涉及号码、正文或条目，可能发送消息/改删数据，未执行';
 else if(/wifi_config|guest_config/.test(key))reason='SSID/密钥已脱敏，无法可靠完整恢复，未执行';
 else if(/reboot|workmode|wifi_router|mesh|network_mode|sim_slot|band_lock|plmn|dhcp|static_ip/.test(key))reason='可能断网、改动组网/蜂窝或现有配置，未执行';
 else if(/filter|port_|dmz|alg/.test(key))reason='会修改转发、安全规则或开放服务，未执行';
 else if(/login|logout/.test(key))reason='登录已由查询链路验证，未单独提交登录/退出工具以免影响当前会话';
 else if(/scan/.test(key))reason='当前工作模式相关查询无数据，不发起扫描';
 else if(/developer/.test(key))reason='缺少验证材料，不改变开发者模式';
 else if(row.readbackStatus==='error'||row.readbackStatus==='not_available')reason='回读不可用，无法证明恢复，未执行';
 else reason='未具备完整原值/恢复证据，未提交样例配置';
 return reason+(row.permission.access===false?'；UBUS access=false':'');
}
for(const row of r.writes)row.execution=tested.has(row.tool)?'verified_fields':'not_executed';
r.scope={deviceTools:r.discovered.length,mediaTools:'not_in_scope: this run tests T830 device APIs, not microphone/camera/cloud media',userChoice:'Only reversible tests; list remaining limits',remainingOrdinaryWritesNotExecuted:r.writes.filter(x=>!tested.has(x.tool)).length};
await writeFile(path,JSON.stringify(r,null,2));
const lines=[
'# 2026-10-20 全部 T830 MCP 工具实机验证',
'',
'测试对象：当前真实设备 `192.168.0.1`；使用现有管理员凭据。密码、Cookie、token 不写入报告，短信和电话本正文不保存。日期按 Asia/Shanghai。',
'',
'## 结果',
'',
`发现 ${r.discovered.length} 个设备工具：58 个独立查询、76 个普通写工具、3 个辅助查询及 1 个 UPnP 验证兼容工具。媒体的 13 个工具不属于本轮设备接口测试。`,
'',
'- 全部 58 个独立查询均真实调用：37 项 returned、21 项 error、0 项业务告警。returned 仅证明本次参数下返回并通过现有校验；部分接口只具备基础结构校验，不能视为厂商完整 schema 或所有功能通过。',
'- 全部 76 个普通写工具均发现、样例 schema 有效。40 个 UBUS 写工具中 session.access=true 18 项、false 22 项；36 个 CGI 写工具不适用这一权限检查。权限检查不能代替执行或证明配置生效。',
'- 5 个不同写工具共实际提交 8 次，全部回读验证通过。UPnP 与 DNS 均完成 0→1→0 并确认恢复；双频 WiFi 和双频访客 WiFi 各提交一次原值，不测试关停后重启。',
'- 其余 72 个普通写工具未提交。用户明确选择只完成可恢复测试，原因逐项列于下表；未执行不计为通过。',
'- 网页→真实模型→MCP→真实设备链路通过：本次固件查询调用 1 次工具。测试结束仪表盘 available=true、online=true，六项基础查询全部 returned，UPnP 为原值 0。',
'',
'## 可恢复写操作',
'',
'| 工具 | 实际调用次数 | 验证范围 |',
'|---|---:|---|',
'| t830_set_upnp_verified | 1 | UPnP 0→1，原值检查和回读通过 |',
'| t830_set_upnp | 1 | 恢复 1→0，回读通过 |',
'| t830_set_dns | 2 | DNS 重绑定保护 0→1→0，均回读通过 |',
'| t830_set_wifi_switch | 2 | 2.4G/5G 分别提交当前原值，回读通过 |',
'| t830_set_guest_switch | 2 | Guest/Guest5G 分别提交当前原值，回读通过 |',
'',
'## 全部查询结果',
'',
'| API | 工具 | 本次结果 | 错误 |',
'|---|---|---|---|',
...r.reads.map(row=>`| ${row.api} | ${row.tool} | ${row.output.status} | ${row.output.error||'—'} |`),
'',
'21 项查询失败中：16 项 RPC_ERROR_-32002（权限拒绝）、3 项 HTTP_403、1 项 UBUS_ERROR_5_NO_DATA、1 项 RPC_ERROR_-32000。无数据或 RPC_ERROR_-32000 不能仅凭该返回猜测根因。',
'',
'## 全部普通写工具覆盖与限制',
'',
'| API | 工具 | 权限预检 | 执行/限制 |',
'|---|---|---|---|',
...r.writes.map(row=>`| ${row.api} | ${row.tool} | ${typeof row.permission.access==='boolean'?'access='+row.permission.access:row.permission.status} | ${limitation(row)} |`),
'',
'## 辅助工具与模型链路',
'',
...r.helpers.map(row=>`- ${row.tool}：${row.output.status||'returned'}。`),
...((r.endToEnd.modelTools||[]).map(row=>`- 网页模型选择 ${row.name}：${JSON.stringify(row.args)}，结果 ${row.status}。`)),
'',
'本轮没有执行重启、恢复出厂、固件上传/升级、密码修改、PIN/PUK、短信发送、数据删除、网络模式切换或摄像头/麦克风采集。原有待确认提案未批准。',
'',
'## 证据与复测',
'',
'- [逐项原始证据](../../reports/live/all-tools-2026-10-20/results.json)',
'- `node scripts/live-all-tools.mjs`：58 项真实查询、3 项辅助查询、76 项写工具注册/schema/权限预检；不写配置。',
'- `node scripts/live-controlled-tools.mjs`：显式运行会提交本报告列出的可恢复写操作，读取最新原值并尝试恢复；执行前应确保用户授权、设备空闲且基线可用。',
'- 运行时仅通过进程环境提供 `T830_PASSWORD`，脚本不包含凭据。多次 MCP 登录可能更新会话；最终已通过现有网页进程重新查询，确认服务正常。',
];
await writeFile('docs/testing/ALL_TOOLS_LIVE_2026-10-20.md',lines.join('\n')+'\n');
console.log(JSON.stringify({tools:r.scope.deviceTools,untestedWrites:r.scope.remainingOrdinaryWritesNotExecuted,modelTools:r.endToEnd.modelTools}));
