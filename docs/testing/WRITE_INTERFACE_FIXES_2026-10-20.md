# 2026-10-20：39 次实机调用涉及接口的首轮修复

范围是此前 39 次 MCP 实机写调用涉及的 28 种工具，不是 39 个不同接口。此前的成功结果保留在 [原始实机报告](REAL_DEVICE_WRITES_2026-10-20.md)，本报告不覆盖历史证据，也不宣称全部接口已修复。

## 已修复并实机验证

| 接口/行为 | 原问题 | 修改 | 本轮实机结果 |
|---|---|---|---|
| signal_start | 固件测量约 10 秒，原默认 10 秒存在超时 | 该接口默认等待 20 秒，显式超时配置仍优先 | submitted，取得完整测量数据 |
| signal_record | 只提交 name/position，业务码 2 | 要求携带测量返回的 index/name/sigal/time/qos 与用户 position | 创建、编辑、回读、删除通过，列表恢复原值 |
| phonebook_write | 未暴露号码、附加号码、email、增改标志，业务告警 | 补齐字段；type=0–3；flag=0 新增，flag=1 编辑且要求 index | 创建、编辑、回读、删除通过，列表恢复原值；没有发送短信 |
| reboot_schedule | 只传 action 得到 NO_DATA；原 schema 使用 HH:mm，而设备用 HH;mm | 要求完整 action/schweek/schTime，禁用时星期可为空 | 原值提交返回 409，明确 not_modified，回读禁用状态及原时间保持一致；未启用计划或触发重启 |
| wifi_night | 409 被解释为提交错误，但网页明确表示没有变化 | 标记 businessOutcome=not_modified，回读匹配后 submissionOutcome=not_modified | 原值提交得到 verified_fields + not_modified，无重试；未宣称发生了配置变更 |
| login（ubus 模式） | 配置标准认证后，独立登录工具仍调用损坏的 CGI，得到 500 | 同账号盐化摘要须与进程原始密码匹配，再调用 session.login；不匹配在本地拒绝 | submitted；无 CGI 登录调用 |

信号记录、电话本均使用专用测试条目，只删除本轮明确创建并精确匹配的索引。最终 pendingCleanup=[]，新的标准认证查询确认设备上联 connected。

## 同步修复与回归

- 高级 WiFi 的 409 也依据厂商网页“settings unchanged”标记为 not_modified。这是结果语义修正，本轮未重复进行高级 WiFi 实机写入；其他业务码与混合告警仍原样保留。
- 清除首次认证失败后留下的 rejected loginPromise，后续显式调用能够重新认证；不会自动重放已经发出的写请求。
- 标准认证模式的注销改用 session.destroy，只有设备确认成功才清理本地会话。实机目前拒绝该调用，因此返回真实错误，不把本地清空或 CGI 返回 0 冒充远端会话已撤销。
- 新电话本字段 numb/numb_house/numb_work/email 和 ubus_rpc_session 均纳入脱敏。
- 本地相关回归 **126 项通过、0 失败**，包含完整目录模拟、MCP 参数拒绝、队列/并发/关闭、409 语义、认证恢复、原生注销被拒和超时优先级。实机复测脚本已完成执行；无参数契约之外的任意文件操作、ACL 变更或固件修改。

## 仍未修复

| 范围 | 当前证据与限制 |
|---|---|
| CGI 写入：UPnP、MAC/IP 模式、端口转发/映射开关、重启、上游 WiFi 扫描 | 原生 UBUS 会话在 CGI 仍 HTTP 403；补 Bearer、Origin、Referer 的只读对照也 403。未用其他命令替换目标操作绕过被测接口 |
| CGI 官方登录及旧网页会话续期 | 仍 HTTP 500；本轮只读读取相关 LuCI 源码被设备拒绝，未修改设备端代码。默认 CGI 模式未被静默替换 |
| 原生注销 | session.destroy 返回 RPC_ERROR_-32002，远端权限问题保留；登录成功不代表有销毁会话权限 |
| backup_check | 真实响应为 tar 无法打开 /tmp/backup.tar.gz：文件不存在；需要有效测试备份，不能通过改错误码宣称通过 |

## 参数迁移

信号保存应先调用 signal_start，再原样携带测量字段。电话本调用需要补齐所有公开字段，非必填内容用空字符串；这里的号码仅用于设备本地记录。重启计划一律提交完整配置，schTime 使用分号，不能继续只传 action 或使用冒号时间。参见 [使用说明](../USAGE.md) 和 [生成的接口目录](../api/API_CATALOG.md)。

原始 API_DOC.md 未改动：设备网页和只读 UBUS 签名显示的修正依据另行记录，避免把历史文档当作当前固件所有字段都正确的保证。

## 证据与命令

- [实机修复复测](../../reports/live/write-fixes-2026-10-20/verification.json)
- [126 项回归日志](../../reports/mock/write-fix-regression-2026-10-20.log)
- [只读 CGI 认证对照及源码访问结果](../../reports/diagnostics/write-fixes-2026-10-20/probes.json)
- 厂商网页静态代码来源：http://192.168.0.1/assets/index-CR_moC_F.js；诊断副本在 tmp/device-ui-write-fix.js。信号保存页会提交完整测量对象；电话本表单提交号码和 flag；计划时间为 HH;mm；夜间和高级 WiFi 的 409 分支显示未变化。

```powershell
node --test test/t830.test.mjs test/write-workflow.test.mjs test/queue.test.mjs test/concurrency.test.mjs test/workflow-shutdown.test.mjs test/agent-tools.test.mjs test/write-fault-matrix.test.mjs
node scripts/verify-write-fixes.mjs --apply
```

实机命令需要通过进程环境设置设备凭据及 T830_AUTH_TRANSPORT=ubus。凭据不写入脚本、报告或 .env。后续复测仍应先确认当前设备及恢复基线。
