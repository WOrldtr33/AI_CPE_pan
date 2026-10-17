# 第三轮：连续业务步骤、外部干扰与关闭（2026-10-08）

## 连续步骤

新增 T830.writeVerified('upnp', {upnp_switch:'1'}, {expectedCurrent:'0', signal})。整个流程只占一个队列任务：读取基线、再次检查当前值、执行已有 set_upnp、通过已有 get_upnp 回读。

同一实例其他工具任务不能插入这四个步骤；不是 CPE 端事务，不保证回滚或所有设备操作的原子性。已有独立写工具仍只表示 submitted，不自动变成此流程。暂时只有 UPnP 支持明确字段映射，其他业务流程后续逐项定义。

显式开启 T830_ENABLE_WRITES=1 时新增 MCP 工具 t830_set_upnp_verified，参数为 upnp_switch 和 expectedCurrent（均为字符串 0 或 1）。默认不注册。没有增加新的设备 API，不提供任意 URL/命令或任意执行回调给 MCP Client。

## 外部干扰

- 基线不等于调用方提供的 expectedCurrent：CONFIG_CONFLICT，停止，不写入。
- 写前再次读取发现变化：CONFIG_CONFLICT，停止，不覆盖当前值。
- 回读不等于期望写值：WRITE_VERIFICATION_FAILED，原因 unknown；可能是配置未生效、外部修改或其他设备行为，不把任何一种猜测当作根因。
- 外部重新登录使会话失效：既有只读权限对照和有限更新机制能够恢复模拟场景的读步骤。写请求仍不重复。

错误返回 phase、已完成 steps、writeStarted、remoteConfiguration 和 automaticRollback=false。写后失败或取消需要后续回读确认；不自动恢复旧配置，以免覆盖外部修改。

写前读取与写入之间仍有外部修改窗口；值先改变再恢复也可能无法检测。没有设备端版本号/条件写入或锁，无法保证阻止网页、其他客户端或其他进程的操作。verified_field 只确认回读时 data.upnp_switch 这一字段，不代表配置持续不变或网络健康。

## 关闭

OperationQueue.close 停止入队、移除全部等待项并返回 SERVER_CLOSING。T830.close 默认给正在执行的任务 5000 毫秒收尾，T830_SHUTDOWN_GRACE_MS 可配置为整数 1–120000。

收尾期间允许当前连续流程完成；超过期限时全局关闭信号中止本地 HTTP 等待、重试或后续步骤，执行任务返回 SERVER_SHUTDOWN。不会强制远端停止或回滚。重复 close 共用同一关闭过程。

Server 处理 stdin EOF，并在运行环境正常交付 SIGINT/SIGTERM 时触发同样流程。日志写 stderr，标准输出仍用于 MCP。关闭摘要包括 forced、discardedPending、activeAtClose，强制停止本地等待时附 remoteExecution=unknown。

已断开的客户端未必能收到错误结果。操作系统强制终止、掉电等不能依赖 JavaScript 收尾；没有实现持久任务恢复。此次实际子进程关闭测试使用 stdin EOF，没有宣称 Windows 强制结束进程会经过信号处理函数。

## 验证结果

全量自动测试 44 项通过；本轮新增 13 项，全部对模拟设备执行：本地插入隔离、过时基线、写前外部变化、写后结果冲突、外部会话失效、业务告警、写后取消、优雅关闭清理队列、关闭超时、MCP 连续工具、真实子进程 EOF 关闭、失败释放队列和写入口限制。

真实 T830 仅进行原有 9 项只读并发回归：8 返回、1 为 share 已知错误；失败未阻断后续任务。没有执行真实 UPnP 写入，也没有让真实设备主动发生外部会话失效或强制关闭测试。以上新写流程的实际配置效果仍待受控实机验证。

单独运行：node --test test/workflow-shutdown.test.mjs。

## 改动文件

src/queue.mjs：关闭队列、拒绝等待/新任务、等待活动任务完成。
src/t830.mjs：writeVerified 连续流程、冲突和回读检测、关闭信号和有限收尾。
src/server.mjs：受写开关保护的连续工具、能力信息、EOF/信号关闭入口。
test/workflow-shutdown.test.mjs：本轮 13 项测试。
test/t830.test.mjs：显式开启写工具后的工具总数增加 1。