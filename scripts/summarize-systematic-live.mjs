import { readFile, writeFile } from 'node:fs/promises';
import { writes, toolName } from '../src/catalog.mjs';
const directory = new URL('../reports/live/systematic-writes-2026-10-20/', import.meta.url);
const sources = {};
for (const file of ['independent-mcp', 'crud', 'wifi-switches', 'remaining']) sources[file] = JSON.parse(await readFile(new URL(file + '.json', directory), 'utf8'));
const calls = Object.values(sources).flatMap(source => source.records).filter(row => row.write);
const changed = new Set();
for (const key of ['wifi_switch', 'guest_switch']) {
  const cases = sources['wifi-switches'].cases.filter(row => row.key === key);
  if (cases.length === 2 && cases.every(row => row.changed && row.restored)) changed.add(key);
}
for (const row of sources.crud.cases) {
  if (row.key === 'apn_save/apn_remove' && row.created && row.restored && row.deleteAcknowledged) { changed.add('apn_save'); changed.add('apn_remove'); }
  if (row.key === 'url_filter_rule' && row.created && row.restored) changed.add('url_filter_rule');
}
const originalOnly = new Set(sources['independent-mcp'].coverage.filter(row => row.live === 'same_value_only').map(row => row.tool.replace('t830_set_', '')));
for (const row of sources.crud.cases) if (row.kind === 'same-value-only' && row.passed) originalOnly.add(row.key);
function reason(key) {
  if (/^(pin_|puk_)/.test(key)) return '缺少可控测试卡及正确 PIN/PUK';
  if (/^firmware_/.test(key)) return '缺少匹配硬件的有效固件及失败恢复材料';
  if (key === 'sms_send') return '未提供授权接收号码及测试短信内容';
  if (key === 'sms_delete') return '缺少专用测试短信及精确删除目标';
  if (key === 'factory_reset') return '缺少已验证可恢复的配置备份和复位后重连材料';
  if (/^backup_/.test(key)) return '缺少有效专用备份包及恢复后的验证基线';
  if (['setup_save', 'password', 'wifi_config', 'guest_config', 'tr069'].includes(key)) return '缺少完整可恢复原值';
  if (['signal_record_edit', 'signal_record_delete', 'phonebook_delete'].includes(key)) return '专用测试条目创建失败，没有可安全编辑/删除的测试索引';
  return '尚未具备完整基线、业务前提或可靠恢复方案';
}
const rows = writes.map(def => {
  const submitted = calls.filter(row => row.name === toolName(def));
  let status = 'not_executed', detail = reason(def.key);
  if (changed.has(def.key)) { status = 'changed_and_restored'; detail = '实际变更、回读及恢复通过'; }
  else if (originalOnly.has(def.key)) { status = 'same_value_only'; detail = '仅原值提交及回读，未验证实际切换功能'; }
  else if (sources['independent-mcp'].coverage.some(row => row.tool === toolName(def) && row.live === 'functional_loopback_only')) { status = 'loopback_verified'; detail = '本机 Ping 完成，收发相等且 0% 丢包'; }
  else if (submitted.length) {
    const output = submitted.at(-1).output;
    status = output.status === 'submitted' ? 'acknowledged_only' : 'failed_or_rejected';
    const warnings = output.warnings || output.steps?.flatMap(step => step.output?.warnings || []) || [];
    detail = output.error || (output.submissionOutcome === 'error_but_state_confirmed' ? '写入返回告警；原值仍匹配不能当作成功' : status === 'acknowledged_only' ? '接口确认，尚未验证完整业务效果' : JSON.stringify(warnings));
  } else {
    const baseline = sources['independent-mcp'].coverage.find(row => row.tool === toolName(def) && row.live === 'blocked_baseline');
    if (baseline) detail = '基线不可用：' + baseline.reason;
  }
  return { tool: toolName(def), currentLive: status, writeCalls: submitted.length, detail };
});
const counts = rows.reduce((result, row) => ({ ...result, [row.currentLive]: (result[row.currentLive] || 0) + 1 }), {});
const summary = { at: new Date().toISOString(), ordinaryWrites: writes.length, realWriteCalls: calls.length, realWriteToolTypes: new Set(calls.map(row => row.name)).size, counts, pendingCleanup: sources.crud.pendingCleanup, completeLiveCoverage: false, metadata: sources.remaining.metadata, rows };
await writeFile(new URL('real-summary.json', directory), JSON.stringify(summary, null, 2));
const lines = [
  '# 2026-10-20 独立 MCP 实机写工具测试', '',
  '> 后续修复已完成信号记录、电话本、重启计划参数契约及原生登录等复测；最新结论见 [接口修复报告](WRITE_INTERFACE_FIXES_2026-10-20.md)。以下保留修复前的 39 次调用记录。', '',
  `本轮向实机提交 **${summary.realWriteCalls} 次 MCP 写调用，覆盖 ${summary.realWriteToolTypes}/76 个普通写工具**。其余 ${counts.not_executed} 个未实际提交。失败响应、原值提交与模拟结果不算完整功能通过。`, '',
  '## 结论', '',
  ...Object.entries(counts).map(([status, count]) => `- ${status}：${count} 种工具。`), '',
  '实际变更并恢复：2.4G/5G 主 WiFi 分别关闭再恢复；两个访客频段分别开启再恢复；APN4 新增再删除；URL 过滤规则新增再删除。均逐项回读，测试数据使用随机唯一名称，只删除本轮创建的条目。管理路由已确认走以太网。测试结束没有待清理条目，设备信息查询仍成功。', '',
  '漫游、流量、网络类型及 SIM 选择仅提交原值并回读。夜间 WiFi 虽返回 verified_fields，但 submissionOutcome=error_but_state_confirmed，严格记为失败/告警；未把字段仍等于原值当作写入成功。', '',
  '最终通过新的标准 UBUS 认证复核，10 项查询全部 returned，设备上联 reading.uplink=connected。网页旧会话续期返回 HTTP 500，页面查询暂不可用；这是仍未解决的登录异常，不能把网页状态误判为设备离线，也未宣称网页服务恢复。最终配置对照见 final-device.json 的 restorationChecks。', '',
  '重启工具已真实提交，HTTP 403，未因此重启。CGI 官方登录仍 HTTP 500；标准 UBUS 管理员→开发者验证→superadmin 认证成功，但原生会话的 CGI 写入口仍返回 403。没有更改 ACL 或用底层重启命令代替被测工具。', '',
  '信号记录和电话本写入返回业务告警，未产生专用条目，因此未编辑/删除既有数据。备份检查返回业务告警，不能视为有效备份。未执行刷机、恢复出厂、真实卡 PIN/PUK 或短信发送：缺失资源见下表。', '',
  '## 参数契约发现', '',
  '当前实机只读 UBUS 签名显示：信号记录还有 sigal/index/qos；电话本还有 email/numb_house/numb/numb_work/flag；双频 WiFi 还有 Unity。当前封装未暴露这些字段。签名不说明是否必填，只能确认契约差异，不能断言它们就是业务告警的唯一根因。尚未修改这些生产接口契约。', '',
  '## 逐工具结果', '',
  '| 工具 | 实机分类 | 写调用数 | 结果或缺失前提 |', '|---|---|---:|---|',
  ...rows.map(row => `| ${row.tool} | ${row.currentLive} | ${row.writeCalls} | ${row.detail.replaceAll('|', '/')} |`), '',
  '## 原始证据与复测', '',
  ...['independent-mcp', 'crud', 'wifi-switches', 'remaining', 'final-device', 'real-summary'].map(file => `- [${file}.json](../../reports/live/systematic-writes-2026-10-20/${file}.json)`), '',
  '凭据仅通过进程环境提供并清除，不写源码、报告或 .env。复测入口：', '',
  '```powershell', '.\\scripts\\systematic-live-writes.ps1 --reboot',
  'node scripts/systematic-live-crud.mjs --apply',
  'node scripts/systematic-live-switches.mjs --apply --wired-management-confirmed',
  'node scripts/systematic-live-remaining.mjs --apply', '```', '',
  '后面三个脚本需要调用进程已配置 T830_PASSWORD、可选 T830_DEVELOPER_KEY 以及 T830_AUTH_TRANSPORT=ubus。执行无线切换前必须重新确认有线管理路由。--reboot 只调用一次被封装的重启工具，不在失败后换其他命令重启。', '',
];
await writeFile(new URL('../docs/testing/REAL_DEVICE_WRITES_2026-10-20.md', import.meta.url), lines.join('\n'));
console.log(JSON.stringify({ realWriteCalls: summary.realWriteCalls, realWriteToolTypes: summary.realWriteToolTypes, counts, pendingCleanup: summary.pendingCleanup.length }));
