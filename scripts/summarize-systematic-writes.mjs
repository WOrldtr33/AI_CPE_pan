import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { writes, toolName } from '../src/catalog.mjs';
import { writeProfiles } from '../src/write-profiles.mjs';

const matrix = JSON.parse(await readFile(new URL('../reports/mock/write-fault-matrix-2026-10-20.json', import.meta.url), 'utf8'));
const live = JSON.parse(await readFile(new URL('../reports/live/systematic-writes-2026-10-20/session-upnp.json', import.meta.url), 'utf8'));
const smoke = JSON.parse(await readFile(new URL('../reports/mock/mock-smoke-results.json', import.meta.url), 'utf8'));
const regression = await readFile(new URL('../reports/mock/systematic-write-regression-2026-10-20.log', import.meta.url), 'utf8');
if (!regression.includes('tests 119') || !regression.includes('pass 119') || !regression.includes('fail 0')) throw new Error('REGRESSION_EVIDENCE_MISSING');
const counts = new Set(matrix.records.map(row => row.tool));
if (counts.size !== writes.length || matrix.records.some(row => !row.passed)) throw new Error('INCOMPLETE_MATRIX');
const reason = key => {
  if (/^(pin_|puk_)/.test(key)) return '缺少可控测试卡及正确 PIN/PUK；不能用样例号码消耗真实卡重试次数';
  if (/^firmware_/.test(key)) return '缺少匹配硬件的有效固件、校验值及刷机失败后的恢复材料';
  if (key === 'sms_send') return '未提供授权接收号码及测试短信内容';
  if (key === 'sms_delete') return '缺少专用测试短信及可验证的删除目标';
  if (key === 'factory_reset') return '缺少已验证可恢复的配置备份与复位后重连/初始化材料';
  if (/^backup_/.test(key)) return '缺少专用备份包、完整性证据及恢复后的验证基线';
  if (['setup_save', 'password', 'wifi_config', 'guest_config', 'apn_save', 'tr069'].includes(key)) return '缺少完整可恢复原值；独立 MCP 测试进程尚无设备凭据';
  if (/delete|remove/.test(key)) return '需要先创建专用测试条目并精确定位，不删除既有业务数据；独立进程无设备凭据';
  if (key === 'reboot') return '已准备 --reboot 实机入口；本轮未通过 MCP 触发重启';
  return '网页登录会话有效，但网页确定性确认入口仅支持 UPnP 兼容工具；独立测试进程无设备凭据';
};
const rows = writes.map(def => {
  const records = matrix.records.filter(row => row.tool === toolName(def));
  const callback = smoke.records?.some(row => row.tool === toolName(def) && row.status === 'passed_mock');
  if (!callback) throw new Error('MISSING_SUCCESS_CALLBACK_' + def.key);
  return {
    tool: toolName(def), description: def.description,
    mockCallback: 'passed', invalidArguments: records.some(row => row.scenario === 'invalid_arguments' && row.deviceRequests === 0),
    faultHandling: writeProfiles[def.key] ? 'existing_write_workflow_regression' : records.filter(row => row.scenario !== 'invalid_arguments').map(row => row.scenario),
    currentLive: 'not_independently_executed', reason: reason(def.key),
  };
});
const summary = {
  at: new Date().toISOString(), ordinaryWriteTools: writes.length, mockRegression: { tests: 119, passed: 119, failed: 0 },
  newMatrix: { checks: matrix.scenarios, tools: counts.size, oneShotTools: matrix.oneShotTools },
  currentLive: { tool: 't830_set_upnp_verified', compatibilityToolExcludedFromOrdinaryCount: true, changeVerified: live.changedVerified, restored: live.restored, conflictRejected: live.staleBaselineRejected, cancelVerified: live.cancelVerified, confirmRequests: live.records.filter(row => row.action === 'confirm').length },
  completeLiveCoverage: false, rows,
};
const directory = new URL('../reports/live/systematic-writes-2026-10-20/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('coverage.json', directory), JSON.stringify(summary, null, 2));
const lines = [
  '# 2026-10-20 全部写工具系统测试', '',
  '> 后续已完成独立 MCP 实机测试：39 次写调用、28 种工具。最新结果与剩余限制见 [实机写测试报告](REAL_DEVICE_WRITES_2026-10-20.md)。以下为取得凭据之前的首轮模拟及现有会话记录。', '',
  '## 本轮结论', '',
  '- 目录中的 76 个普通写工具均通过 MCP 模拟成功回调和端点/参数映射检查；相关本地回归 119 项通过、0 失败。',
  '- 新增 336 个矩阵检查：全部 76 个工具拒绝额外参数且不访问设备；65 个单次提交工具分别检查成功、业务码 409、HTTP 403（含要求重新登录的响应头）及响应丢失，目标请求均只有一次。',
  '- 其余 11 个带回读工具由既有工作流回归验证，包括原值冲突、字段回读、有限重试、取消、队列及响应不确定性。',
  '- 恢复出厂、固件升级、重启、SIM 锁、短信及删除类工具均包含在模拟回调与适用的异常矩阵中；这不代表实机成功路径通过。',
  `- 当前网页登录会话实测 t830_set_upnp_verified：修改回读=${live.changedVerified}，恢复=${live.restored}，旧基线拒绝=${live.staleBaselineRejected}，取消不改配置=${live.cancelVerified}。共 ${summary.currentLive.confirmRequests} 次确认提交。`,
  '- 该 UPnP 兼容工具不计入 76 个普通写工具。本轮没有通过独立 MCP 客户端重新执行普通写工具，不把此前历史记录算作本轮实机结果。',
  '- 全量实机测试未完成。当前终端未配置设备管理凭据；网页登录不会将凭据传给另一个测试进程。测试资源缺项见下表。', '',
  '## 已执行命令', '',
  '```powershell',
  'node --test test/t830.test.mjs test/write-workflow.test.mjs test/queue.test.mjs test/concurrency.test.mjs test/workflow-shutdown.test.mjs test/agent-tools.test.mjs test/write-fault-matrix.test.mjs',
  'node scripts/systematic-session-write.mjs --apply',
  '```', '',
  '初次在受限沙箱运行，本机模拟 HTTP 请求被 EACCES 拒绝；允许访问本机网络后重新运行全部上述相关测试通过。这是执行环境限制，不是设备写入失败。', '',
  '## 后续实机入口', '',
  '```powershell',
  'powershell -ExecutionPolicy Bypass -File .\\scripts\\systematic-live-writes.ps1 --reboot',
  '```', '',
  '此入口通过隐藏输入接收密码和开发者密钥，使用独立 MCP 客户端，结束后恢复原进程环境变量；不把凭据写入配置或报告。默认认证使用已验证的 ubus，可预先设置 T830_AUTH_TRANSPORT=cgi 切换认证入口。', '',
  '脚本尝试 UPnP/DNS/GPS 修改与恢复、若干配置原值提交、本机 Ping、开发者验证、独立登录/注销；附带 --reboot 才触发一次真实重启并观察启动时间变化。任何不能恢复的配置变化立即停止。原值提交只记为 same_value_only，不能算完整功能通过。', '',
  '此脚本自身已通过 Node 语法、PowerShell 解析和无凭据计划模式检查；尚未实机执行。它只执行具备前置条件的子集，并为其他工具生成 blocked_prerequisites，不承诺一条命令验证全部 76 个成功路径。', '',
  '## 每个普通写工具的本轮范围', '',
  '| 工具 | 模拟成功回调 | 非法参数拒绝 | 异常路径 | 实机未完成原因 |',
  '|---|---|---|---|---|',
  ...rows.map(row => `| ${row.tool} | 通过 | ${row.invalidArguments ? '通过' : '未通过'} | ${typeof row.faultHandling === 'string' ? '既有工作流回归' : '成功/409/403/断连，各一次提交'} | ${row.reason} |`), '',
  '## 证据', '',
  '- [119 项本地回归日志](../../reports/mock/systematic-write-regression-2026-10-20.log)',
  '- [336 项异常矩阵明细](../../reports/mock/write-fault-matrix-2026-10-20.json)',
  '- [全部工具模拟回调](../../reports/mock/mock-smoke-results.json)',
  '- [本轮 UPnP 实机提交与恢复](../../reports/live/systematic-writes-2026-10-20/session-upnp.json)',
  '- [76 个普通写工具覆盖清单](../../reports/live/systematic-writes-2026-10-20/coverage.json)',
  '- [此前实机结果及限制](WRITE_AFTER_REBOOT_2026-10-20.md)', '',
];
await writeFile(new URL('../docs/testing/SYSTEMATIC_WRITES_2026-10-20.md', import.meta.url), lines.join('\n'));
console.log(JSON.stringify({ ordinaryTools: rows.length, matrixChecks: matrix.scenarios, regressionPassed: 119, liveCompatibilityToolPassed: live.passed, completeLiveCoverage: false }));
