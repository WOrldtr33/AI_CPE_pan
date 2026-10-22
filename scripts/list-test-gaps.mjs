import {writes,toolName} from '../src/catalog.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const r=JSON.parse(await readFile('reports/live/writes-developer-after-reboot-2026-10-20/summary.json','utf8'));
const passed=new Set([...r.passedToolTypes,'upnp','dns']);
const failed=new Set(r.failedToolTypes);
const untested=writes.filter(d=>!passed.has(d.key)&&!failed.has(d.key));
const partial=new Set(['wifi_switch','guest_switch','roaming','traffic']);
const errorFor=key=>['wifi_night','wifi_advanced'].includes(key)?'设备业务码 409；字段保持原值，未确认写入成功':'HTTP 403；字段保持原值，未确认写入成功';
function reason(key){
 if(['login','developer_verify'].includes(key))return '认证前置流程已真实验证，但未通过这个独立 MCP 写工具单独提交/验证';
 if(key==='developer_login')return '官方网页实际使用密钥验证加 superadmin 登录；此空参数入口未单独调用';
 if(['wifi_config','guest_config','apn_save','tr069'].includes(key))return '包含脱敏凭据或缺少完整原值，无法可靠恢复';
 if(key==='gps')return '当前原生 UBUS 会话下基线 CGI 读取 HTTP 403';
 if(key==='alg')return '读取结果含写 schema 未覆盖的开关，完整恢复条件不足';
 if(key==='dmz')return '原始空地址无法在当前写 schema 中完整表达';
 if(key==='ntp')return '避免更改设备时间及触发同步，影响登录时间戳故障诊断';
 if(key==='reboot_schedule')return '未改变重启计划，原始时间格式与写 schema 不一致';
 if(/^pin_|^puk_/.test(key))return '需要正确 PIN/PUK 及可控测试卡，错误尝试可能锁卡';
 if(['firmware_upload','firmware_upgrade','factory_reset','setup_save','backup_restore','backup_delete','password','sms_delete','sms_send','phonebook_delete','client_delete','mesh_router_remove','apn_remove','signal_record_delete'].includes(key))return '超出此前选定的可恢复范围，涉及固件、数据、凭据或外部消息等影响，未执行';
 if(key==='reboot')return '用户手动重启不算此 MCP 工具的执行测试；未通过工具触发重启';
 return '未具备本轮限定范围内的完整测试前置条件与恢复方案，未提交；权限预检不算执行通过';
}
const lines=['# 2026-10-20 实机测试未完成项与失败项','','口径：设备目录共 76 个普通写工具。另有 UPnP 验证兼容入口，不重复计数。模拟测试、schema 校验及 session.access 权限检查均不等同于真实写执行。','','| 状态 | 普通写工具数 |','|---|---:|','| UPnP、DNS 修改及恢复，或本机 Ping 执行验证 | 3 |','| 仅原值提交并回读通过，完整功能测试未完成 | 4 |','| 已提交但失败/被拒绝 | 6 |',`| 未通过独立 MCP 写工具提交 | ${untested.length} |`,'','## 写入失败的 6 个工具','','| 工具 | 用途 | 结果 |','|---|---|---|',...writes.filter(d=>failed.has(d.key)).map(d=>`| ${toolName(d)} | ${d.description} | ${errorFor(d.key)} |`),'','## 部分完成','','| 工具 | 已验证 | 未验证 |','|---|---|---|',...writes.filter(d=>partial.has(d.key)).map(d=>`| ${toolName(d)} | 当前原值提交、接口确认和字段回读 | 更改值、恢复、实际业务作用及其他参数组合 |`),'| t830_set_net_probe | 127.0.0.1 Ping：6 发 6 收，0% 丢包 | Traceroute、外网诊断与其他参数组合 |','','## 未通过独立工具提交的 63 项','','其中 t830_set_login、t830_set_developer_verify 对应的认证流程已在前置登录中执行，但不能把它们算为这两个独立 MCP 工具已经通过。','','| 工具 | 用途 | 未完成原因 |','|---|---|---|',...untested.map(d=>`| ${toolName(d)} | ${d.description.replaceAll('|','/')} | ${reason(d.key)} |`),'','## 最近实机记录中仍有问题的查询','','| 工具 | 最近记录/限制 |','|---|---|','| t830_get_setup | 定制 CGI 初始化路径 HTTP 403，未解决 |','| t830_get_wifi_rt | UBUS NO_DATA；与当前上游 WLAN 功能前提有关，未切换模式复测 |','| t830_get_share | Object not found，未解决 |','| t830_get_gps | 先前定制开发者会话为业务告警 -1，当前原生 UBUS 会话为 CGI HTTP 403 |','| t830_get_dhcp | 先前定制会话正常，当前原生 UBUS 会话为 CGI HTTP 403 |','| t830_get_phonebook_select | 最近完整查询测试为业务告警 5，未准备真实条目进一步验证 |','','t830_get_ping_result 原先的业务告警已通过启动本机 Ping 后取得完整结果；不能继续列为本次仍失败。当前没有重新完整跑 58 项查询，上表按各工具最近保留证据列出，不宣称其余全部参数组合已验证。','','证据：[重启后写测试](WRITE_AFTER_REBOOT_2026-10-20.md)、[开发者查询复测](DEVELOPER_ACCESS_2026-10-20.md)。'];
await writeFile('docs/testing/TOOL_TEST_GAPS_2026-10-20.md',lines.join('\n')+'\n');
console.log(JSON.stringify({ordinaryWrites:writes.length,failed:failed.size,partial:partial.size,neverInvokedAsIndependentMcpTool:untested.length}));
