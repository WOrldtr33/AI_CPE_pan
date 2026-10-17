# 第二轮并发处理：容量、等待上限与取消（2026-10-08）

## 行为

同一个 T830 实例最多执行一个完整工具任务。等待队列默认最多 16 个任务，不含正在执行的任务；等待超过 30000 毫秒会被移除。被拒绝、等待超时及排队取消的任务不会发送设备请求，也不会占着等待位置。

| 环境变量 | 默认 | 范围 | 含义 |
|---|---|---|---|
| T830_QUEUE_MAX_PENDING | 16 | 整数 0–1000 | 等待任务容量；0 表示忙时不接收新任务 |
| T830_QUEUE_WAIT_MS | 30000 | 整数 1–120000 | 单个任务排队等待上限，毫秒 |
| T830_TIMEOUT_MS | 10000 | 100–120000 | 单次设备 HTTP 请求上限，与排队时间不同 |

配置通过 T830 构造函数读取环境变量。t830_list_capabilities 的 queuePolicy 返回容量、等待上限及实例作用域。排队时限不是整个工具任务的执行期限；辅助查询和有限重试仍可能增加执行时长。

## 错误与日志

- QUEUE_FULL：等待队列已满，任务未开始。
- QUEUE_WAIT_TIMEOUT：排队等待超时，任务已从队列移除。
- CALL_CANCELLED：收到取消信号。

排队失败返回 details.queue 与 diagnostics 的 queue 记录，包括任务编号、section、waitMs、state=not_started、容量和等待上限。diagnosticSummary 标明 attempts=0、executionState=not_started。

已开始的任务仍使用原有请求/诊断轨迹。发送后的请求取消时记录 remoteExecution=unknown；不能把取消理解成设备操作已经停止或配置已经回滚。

## 取消链路

MCP SDK callback 的 extra.signal → T830 run/query/rpc 的 options.signal → 等待队列或设备 HTTP 请求。

- 排队中：立即移除任务、清理计时器及取消监听，释放容量。
- HTTP 请求中：终止本地 fetch 等待，不自动重试，不执行后续辅助查询。
- 只读重试间隔中：中断等待，不执行下一次请求。
- 登录或会话更新中：共用登录过程不被单个调用取消。等待它成功或超时后，检查取消状态，不发送被取消任务的业务请求；这样避免旧登录过程与下一任务争用会话。
- 已发送写操作：取消不会重试，不能确认设备是否已执行。写操作仅在模拟设备上验证，没有真实写入。

MCP 客户端主动取消及当前 SDK 自动超时取消通知均已验证。取消后的原调用通常由客户端 SDK 直接报取消/超时，Server 的工具结果可能不会被送回客户端；这不是取消诊断日志一定能被客户端收到的保证。

取消不会要求 CPE 回滚，也不能证明 CPE 上的旧操作已经结束。多进程、外部网页操作和业务事务边界仍不在此队列保护范围内。

## 文件

- src/queue.mjs：有界 FIFO、等待超时、排队移除与资源清理。
- src/t830.mjs：配置校验、任务参数传递、请求及重试取消处理。
- src/server.mjs：接入 MCP extra.signal，返回 queuePolicy。
- test/queue.test.mjs：13 项新增测试。

## 验证

node --test：30 项自动测试全部通过。

新增测试包括：容量与 FIFO、等待超时释放位置、排队取消释放位置、提前取消、零等待容量、取消任务不访问设备、执行中读请求取消、共享登录中取消、重试间隔取消、模拟写请求取消、配置范围校验，以及通过真实 SDK MCP Client 验证主动取消、结构化容量/等待错误和客户端超时后的排队取消。

node scripts/concurrency-smoke.mjs：现有 9 项真实只读调用回归，8 成功、1 为 share 已知错误，后续版本读取成功。结果保存于 reports/live/concurrency-smoke-results.json。没有对真实设备强制取消已发送请求或执行压力测试；这些边界在可控模拟设备上验证。

单独复现本轮测试：node --test test/queue.test.mjs。