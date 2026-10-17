# 写操作验证与测试

2026-10-08：76 项自动测试通过，其中新增 32 项写工作流测试。11 个现有写工具全部接入验证；实机仅修改 UPnP，确认 0 → 1 后恢复为 0。模拟通过不等于固件全部支持。

## 程序位置

- `src/write-profiles.mjs`：定义每个接口回读位置、比较字段、单位转换及重试策略。
- `src/write-workflow.mjs`：执行原值读取、写前再检查、提交、诊断、有限回读和条件重试。
- `src/t830.mjs`：把现有写调用接入上述流程；共享 FIFO、认证、取消和关闭机制。
- `src/server.mjs`：沿用现有工具注册，能力查询中提供写验证策略。
- `test/write-workflow.test.mjs`：验证生效、失败、并发、外部变化及取消等场景。

## 验证规则

一次写入流程占用一个队列任务，其他同实例请求不能插入其中。先读取基线，写前再次检查；发现变化则停止。提交后读取对应配置，逐项比较本次提交字段。延迟生效允许有限轮询。

写请求出错也先回读：若目标字段已一致，记录响应错误并报告目标状态已确认；若响应丢失且仍看到原值，保留结果未知，不能据此证明远端不会稍后执行。明确认证拒绝可恢复认证后重新检查；目标权限拒绝且对照权限正常则停止。CGI 的 403 本身不足以确认认证原因。

成功应答后仍是原值时，只对明确列入策略的绝对值设置有限重试。整份 WiFi/访客配置、夜间设置及 APN 不因这种现象自动重写。部分字段变化、回读失败或敏感值被遮蔽无法比较时，停止并记录结果。没有自动回滚。

| 写 section | 回读 section | 成功应答但原值未变时允许重试 | 实机预检 |
|---|---|---|---|
| wifi_switch / wifi_config | wifi | 开关允许；整份配置不允许 | 基线可用，写权限 true |
| guest_switch / guest_config | guest | 开关允许；整份配置不允许 | 基线可用，写权限 true |
| wifi_night | wifi_night | 不允许 | 无可用基线，写权限 false |
| apn_save | apn | 不允许 | 基线可用，写权限 true；未验证蜂窝连接 |
| roaming | roaming | 允许 | 无可用基线，写权限 false |
| upnp | upnp | 允许 | 实机修改及恢复通过 |
| dns | dns | 允许 | 基线可用；CGI 不适用 session/access |
| gps | gps | 允许 | 读取失败；CGI 不适用 session/access |
| traffic | traffic | 允许 | 配置基线可用，写权限 false；统计有业务告警 |

权限 true 只代表会话权限检查结果，不保证实际写入成功。外部网页和其他 Server 进程不受本实例队列约束；检查能发现部分冲突，不能提供跨进程锁或检测所有短暂变化。

## 返回与参数

普通写工具从原来的提交确认升级为 `status: verified_fields`，调用方需要适配。结果包含原值、期望值、观察值、比较结果、提交结果、写次数、步骤和诊断。敏感字段在返回及报告中脱敏，内部使用原始回读值比较。`alreadyMatchedBeforeWrite` 可区分提交前就已符合目标的情况，避免误称是本次写入造成。

默认写提交最多 2 次，每次最多回读 3 次，回读间隔 300 毫秒：

- `T830_WRITE_MAX_ATTEMPTS`：1–3。
- `T830_WRITE_READBACK_ATTEMPTS`：1–5。
- `T830_WRITE_READBACK_INTERVAL_MS`：0–5000。

这些是上限，未满足重试条件时不会用满次数。取消或关闭后停止后续步骤；已经发出的写请求是否执行可能未知，需要重新回读。

## CLI 与结果

先按 README 设置凭据，然后运行：

```powershell
node --test
node scripts/write-preflight.mjs
node scripts/write-smoke.mjs
# 此命令会改变 UPnP，随后检查当前值并有条件恢复：
node scripts/write-smoke.mjs --apply
```

- `reports/mock/write-mock-results.json`：模拟场景，不修改真实设备。
- `reports/live/write-preflight-results.json`：11 项实机基线与权限预检，不写配置。
- `reports/live/write-live-results.json`：MCP 客户端实际调用 UPnP 工具，记录修改、回读及恢复。
- `reports/diagnostics/write-mapping-evidence.json`：部分回读映射的设备网页代码依据。

测试覆盖响应丢失但已生效、未知结果不重发、认证恢复、权限拒绝、延迟生效、有限重试、部分修改、外部干扰、敏感信息脱敏、单位转换、并发写连续执行及取消。未验证 RK 部署、SIM 上网、网络性能改善或全部实机写接口。
