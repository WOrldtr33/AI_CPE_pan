# T830 MCP Server Demo

本页为完整使用说明；整体代码框架见[项目导览](PROJECT_GUIDE.md)，快速入口见[根目录 README](../README.md)。下文终端命令和正文中的文件路径均相对于项目根目录。

音视频功能见[音视频指南](MEDIA_GUIDE.md)：网页模式运行 `powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1 --web`，打开输出的完整页面链接即可聊天。保留的 CLI 模式先运行媒体服务，再启动 Agent，可使用 `/listen 5`、`/voice on`、`/image 文件路径` 等命令。千问媒体 Key 与 DeepSeek 决策模型 Key 独立配置。

当前版本 0.2：48 个只读接口条目、11 个写接口条目，按 WiFi、蜂窝配置、Mesh、设备、网络、防火墙、系统、诊断分类。条目数量不是原文 API 编号数量（API63 拆为两项）。详见 [API_CATALOG.md](api/API_CATALOG.md)。

## 当前验证情况

2026-10-14 最新调整：移除视频通话和视频上传分析；新增独立连续语音、摄像头用途确认、监测计划审核与图文结果。当前150项自动测试通过，浏览器使用假设备验证连续语音与监测报告下载，真实模型流程检查通过。当前用法以[媒体指南](MEDIA_GUIDE.md)为准，下方旧版本测试结果是历史记录。

2026-10-14：项目内已安装 FFmpeg，Windows 下自动查找，无需配置系统 PATH。MP4/WebM 上传、抽取首帧及网页 Agent 链路通过本地验证；真实 Qwen 视频首帧分析通过。完整回归 143 项通过。运行中的旧服务需退出并重新启动才能使用新配置。

2026-10-13 媒体及网页 Agent 接入回归：142 项本地自动测试通过；Qwen3-Omni-Flash 的虚构图片分析、语音生成和语音转写真实接口通过。浏览器显示、硬件采集和 FFmpeg 视频处理仍待实测，详见[媒体测试记录](testing/MEDIA_TEST_RESULTS.md)。

2026-10-08：48 项真实只读 smoke：31 项正常返回、3 项业务告警、14 项失败、0 项跳过，详见 [LIVE_TEST_RESULTS.md](testing/LIVE_TEST_RESULTS.md)。76 项模拟自动测试通过。11 个写接口已接入完整验证流程；实机完成 UPnP 从关闭到开启的验证，并恢复为关闭。其余写接口完成只读预检，未批量修改。详见 [WRITE_VERIFICATION_TEST_RESULTS.md](testing/WRITE_VERIFICATION_TEST_RESULTS.md)。

2026-10-12 最新回归：121 项自动测试通过，0 失败、0 跳过。Agent 已支持自动摘录摘要、用户显式长期记忆、任务持久化及中断恢复；开放上述 31 项正常返回的读工具和需逐次确认的 UPnP 写工具。本轮新增验证使用模拟模型和模拟设备，未新增实机写操作。详见 [AGENT_TEST_RESULTS.md](testing/AGENT_TEST_RESULTS.md)。

## 快速操作（PowerShell）

需要 Node.js 22+。项目依赖已安装；新电脑可运行 `npm install` 或使用现有 pnpm 锁文件安装。

```powershell
cd "C:\Users\admin\Documents\我在金英托联\项目\AI CPE\Codex"
# 如果 node 已在 PATH 中可以直接用 node；否则使用已安装的本机运行时：
$nodePath = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $nodePath --test
```

连接 T830 后，在同一窗口设置凭据（原始密码不会回显）：

```powershell
$env:T830_BASE_URL = "http://192.168.0.1"
$env:T830_USERNAME = "admin"
$securePassword = Read-Host "T830 原始管理密码" -AsSecureString
$env:T830_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
Remove-Variable securePassword
$env:T830_COOKIE_MODE = "auto"
& $nodePath scripts/smoke.mjs
```

也支持 `T830_PASSWORD_HASH` 和匹配的 `T830_SALT`，不二次哈希。原始密码优先；使用哈希方式时删除原始密码环境变量。凭据不写入源码或报告。

只测试某几项：

```powershell
& $nodePath scripts/smoke.mjs mesh_status wifi guest wifi_ad wifi_rt
```

结果保存到 `reports/live/mcp-smoke-results.json`。returned=请求和基本解析成功，不代表网络健康；device_warning=设备业务告警；error=失败及诊断记录；skipped=设备/登录不可用后跳过。只要存在 error，退出码为 1，不把已诊断的失败伪装成成功。无错误但存在 device_warning 的退出码为 0，需查看报告告警。

## Cookie 与有限自动处理

- `auto`（默认）：首次只读请求不发 Cookie；响应明确要求登录时，携带 Cookie 重试一次，必要时最多重新登录一次。
- `always`：首个业务请求就携带适用 Cookie。
- `never`：不发送 Cookie，用于复现 CGI 403；不会偷偷改用 Cookie。
- 只读目标请求最多 4 次。网络异常仅额外重试一次；初次密码登录失败会缓存，不连续重复登录。
- 权限拒绝：调用 `session/access` 检查目标方法；必要时用普通 WiFi 查询权限作对照。如果目标未授权而对照已授权，停止重试，记录证据。
- UBUS 查询和 `session/access` 都明确返回权限拒绝时，默认 auto/always 模式尝试重新登录一次，携带新 Cookie 重查原工具，并重新诊断仍存在的拒绝。仅把失效会话记为假设，不把诊断失败误判为目标无权限；畸形诊断、网络错误不触发此认证分支。never 模式不启用新增的恢复分支。
- NO_DATA：保留原始 UBUS 状态，查询权限；router 额外查工作模式，只记录假设，不自动切换模式。
- 所有辅助查询不递归触发新一轮诊断。记录每次原始响应、检查和处理结果，敏感字段脱敏。未知原因保留日志待分析。
- Cookie/session 仅在内存中；Cookie 发送有同源、Path、Secure 约束。这不是完整浏览器 Cookie jar。

## MCP 工具

每个只读条目注册独立 `t830_get_<key>` 工具，包含输入 schema、类别和前提。保留 `t830_query({section,args})` 兼容入口；Mesh 和 SIM 的原工具名保持不变。

`t830_list_capabilities` 返回接口清单；`t830_check_access({section})` 查询已封装 UBUS 接口权限。

运行 `node src/server.mjs` 会等待 stdio MCP 消息，不会打开网页。MCP 客户端使用 Node 路径及 server.mjs 绝对路径启动它，将凭据通过进程环境传入。标准输出仅用于 MCP，诊断结果随工具输出返回。

## 写接口

默认不注册写工具。显式设置 `T830_ENABLE_WRITES=1` 后，注册清单中的 11 个 `t830_set_*` 工具。每个工具有严格参数 schema，不提供任意 URL、任意 ubus 方法或命令执行工具。

每次写操作在一个 FIFO 任务内完成原值读取、写前检查、提交、失败诊断和有限回读。普通写工具成功返回 verified_fields，表示提交字段与回读一致；它不保证整份配置或网络性能符合预期。Cookie auto 下写请求首发即带 Cookie。超时或响应丢失后先回读，不盲目重发；只有满足明确条件才有限重试。部分变化、无法比较和权限拒绝会停止并记录证据，不自动回滚。默认只读 smoke 仍强制关闭写工具。

新增 CLI：`node scripts/write-preflight.mjs` 仅查询基线和 UBUS 写权限；`node scripts/write-smoke.mjs` 仅预览 UPnP 测试目标；`node scripts/write-smoke.mjs --apply` 执行 UPnP 修改并有条件恢复原值。凭据设置方式同上。

## 测试方法

`node --test`：模拟 Cookie 403/补 Cookie、过期会话、拒绝访问及 access 诊断、NO_DATA 工作模式证据、网络有限重试、缺少凭据、脱敏、写开关/参数限制/不重复写，最后通过真实 MCP stdio Client 调用全部条目但连接模拟 T830。

模拟 smoke 检查工具发现、callback、URL/service/method/业务参数匹配，不证明真实固件支持。实机 smoke 已为有返回样本的查询建立关键字段规则（包括 WPS 动态结果），本轮 31 项正常返回均通过校验，其他接口明确标为 basic 校验。缺失关键字段、类型错误和无业务数据会返回 INVALID_BUSINESS_RESPONSE；业务告警跳过关键字段要求并明确标记，不伪装成正常通过。尚未拥有厂商完整响应 schema。详见 [RESPONSE_DIAGNOSTICS.md](design/RESPONSE_DIAGNOSTICS.md)。

`scripts/check-access.mjs` 保留你的手工实验脚本；可继续用于逐项排查。`node scripts/catalog.mjs` 重新生成分类文档。

设备工具层不负责模型调度。2026-10-12 新增下述命令行 Agent。文档中的接口已注册为 MCP 工具；写工具默认关闭，固件、重启、恢复和备份不会进入 Agent 的默认工具名单。分类见 docs/api/API_CATALOG.md。

## DeepSeek 命令行 Agent（2026-10-12）

新运行日志、设备诊断和测试报告的时间统一使用 `America/Los_Angeles`，时间戳包含 `-07:00`（夏令时）或 `-08:00`（标准时间），自动切换；Agent 日志另记录 timeZone 字段，文件名也使用洛杉矶时间。历史 UTC 记录保留原样，`Z` 表示 UTC。耗时 ms 仍表示实际经过的毫秒数，与时区无关。

命令行输入中文问题 → DeepSeek 选择工具 → 本地 MCP Client 调用当前 Server → 设备结果回传模型 → 输出中文回答。默认开放接口目录中的全部 58 项查询、76 项写工具，以及 `t830_query`、`t830_check_access`、`t830_list_capabilities` 和 `t830_set_upnp_verified`。CLI 与网页共用这一范围。写工具先生成提案，必须确认后才执行；每个任务仍只允许一个写提案，批量修改需分别发起任务。设置 `AGENT_ENABLE_WRITES=0` 可恢复纯只读模式。`AGENT_TOOLS=*`（或不设置）开放全部查询；逗号分隔 section 可缩小查询范围，开启写操作时还会补入对应回读工具。媒体工具继续由 `AGENT_ENABLE_MEDIA` 控制。

工具数量超过 128 时，模型请求通过 `t830_query(section,args)` 提供全部查询，各独立查询仍可通过 MCP Client 调用；全部写工具仍单独提供给模型。参数由目录 schema 校验，兼容查询也受查询范围和参数校验约束。11 项已有验证流程的普通写工具会回读，其余写工具返回 `submitted` 只代表已提交，不能视为生效。中断恢复按原写工具对应的查询回读，绝不重发；无回读接口的操作提示人工核实。

默认使用 `deepseek-flash`，关闭思考。

```powershell
# 1. 本地隐藏输入并加密保存/更新 Key（本机已保存，不必重复）
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-agent.ps1
# 2. 检查鉴权与可用模型；不调用聊天模型
node scripts/agent.mjs --check-api
# 3. 交互启动；提示输入 T830 管理密码
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-agent.ps1
# 或：已经设置好 T830 环境变量时
npm run agent
# 单次问题
node scripts/agent.mjs --once "查询设备版本"
```

Key 使用 Windows DPAPI 保存到被忽略的 `credentials-agent.json`，绑定保存时的 Windows 用户，不能直接复制到其他用户/电脑使用。也可通过 `DEEPSEEK_API_KEY` 进程环境变量提供，优先于加密文件。API Key 不传入 MCP 子进程、不加入模型消息、不打印。运行时会将 Key 解密到 Agent 内存。

可复制 `.env.example` 为 `.env` 配置模型、接口地址、工具范围和预算；现有进程环境变量优先。默认调用 DeepSeek 官方 HTTPS 地址；只在确知接口所属平台时更改地址。环境变量也支持旧版模型名，但启动时会检查实际模型列表，不自动更换模型。

基本命令：`/help`、`/tools`、`/models`、`/model 模型名`、`/thinking off|low|high|max`、`/status`、`/clear`、`/exit`。切换模型或思考模式时清空对话。Ctrl+C 取消当前问题，空闲时退出；取消本地请求不保证远端停止或不计费。模型列表暂时请求失败时仍可进入交互界面，使用本地任务命令和设备回读恢复。

| 功能 | 使用方式 |
|---|---|
| 查看历史摘要 | `/summary`；上下文接近上限时自动摘录旧完整轮次，保留最近对话，不另调模型生成猜测性总结 |
| 保存长期记忆 | `/remember 回答请使用简体中文`；仅此明确命令保存，拒绝凭据类内容 |
| 查看/删除记忆 | `/memory`、`/forget 记忆ID`；清空对话不会删除长期记忆 |
| 查看任务 | `/tasks` 列出最近 30 项；`/task 任务ID` 查看完整步骤 |
| 恢复任务 | `/resume 任务ID`；只读任务以关联的新任务重新规划查询，历史观测不当作当前事实 |
| 撤销待处理任务 | `/cancel 任务ID`；撤销尚未执行的写提案，不回滚已提交的写操作 |
| 查看写提案 | `/pending`；每个任务最多一项写提案，展示 UPnP 原值和目标值 |
| 确认写入 | `/approve 提案ID`；执行提案中的固定参数，再次核对原值并回读验证，确认不能重复使用 |

例如输入“先查询 UPnP 状态，准备开启 UPnP”，Agent 读取原值后生成提案；核对参数后输入 `/approve 提案ID` 执行。开启、关闭使用同一个已验证工具；恢复原值需另发请求并确认，不新增自动回滚策略。模型回复或工具输出中包含 `/approve` 文本不会获得授权，只有命令行中的实际用户命令能执行。

会话、显式记忆和任务保存在被 Git 忽略的 `.agent-state/<设备标识>/` 中，以设备 URL 和管理账号隔离。同一标识只允许一个新版本 Agent 进程持有状态锁。任务和会话文件经脱敏后原子替换保存；推理过程和设备凭据不落盘。会话重启后默认恢复最近完整问答及工具历史摘要，不恢复半个工具调用；`AGENT_RESTORE_SESSION=0` 可关闭自动恢复。`/clear` 同时清空持久化会话，但不清除任务或长期记忆。记忆只将最近最多 10 项、预算内的项目注入模型；全部项目仍可用 `/memory` 查看。

在模型请求或工具调用前后记录任务进度；崩溃后将运行中的任务标为 interrupted，等待 `/resume`，不会启动后自行执行。已经持久化为写提交中、响应未知或执行中断的 UPnP 任务，恢复仅查询当前 UPnP，并报告是否符合目标，不重发写请求，也不宣称变化一定由前次写入造成。对设备 URL/账号的隔离不能识别同地址下替换过的物理设备，执行前仍需核对目标设备。

默认每个问题最多 6 轮模型调用、8 个工具请求、180 秒；单次模型请求 60 秒，输出上限 2048 Token。每轮仅明确的 429/部分 5xx 最多重试一次，网络异常不自动重发，因此包含重试时 HTTP 尝试次数可能超过轮数。累计 usage 达 200000 Token 后停止继续调用（启用全部读写和媒体工具时，每次调用重发的工具目录约 2.5 万 Token）；这是收到服务端 usage 后的停止阈值，单次响应可能越过阈值，不是精确费用封顶。上下文最多 60000 字符，达到 75% 时按完整轮次摘录摘要，默认保留最近两个完整轮次及当前请求；摘要不超过预算的 30%（最多 12000 字符）。当前单轮内容过大、摘要后仍超限时才提示 `/clear`。相同工具和参数在单个问题内复用结果，避免反复请求设备。

本地 `.agent-logs/*.jsonl` 保存模型名、耗时、usage、工具参数、设备结果/诊断与退出原因，按字段与已知凭据脱敏；默认不记录用户问题、模型答复全文和 reasoning_content。工具结果发送给云端模型时省略详细 diagnostics，保留业务状态、数据、校验与诊断摘要。脱敏字段（例如 SSID）在答复中只能解释为隐藏，不能得到原值。

`.agent-state/` 与运行日志不同，会保存脱敏后的问题、回答、摘要和任务证据；它是本地明文状态文件，不是加密保险箱。自动摘要、最近会话和选中的长期记忆会随后续问题发给所配置的模型服务。没有自动从设备日志学习恢复策略，已有故障恢复规则保持不变。

`node --test` 包含 Agent 的模拟 API、真实 MCP stdio 和模拟设备闭环，以及命令行交互测试。真实模型鉴权和实机 Agent 验证状态见 `docs/testing/AGENT_TEST_RESULTS.md`。电脑需要同时能访问 DeepSeek 和 T830；无 SIM 可验证本地查询，不能验证蜂窝上网。


## 第一轮并发处理

同一 Server 内的工具调用按进入顺序执行完整任务，包含登录、目标请求、辅助诊断和重试。一个失败不会阻断队列；同时发起的会话更新共用一次登录。diagnostics 的 queue 项记录 operationId、waitMs 和 policy。

运行 node --test 验证模拟并发场景；凭据设置后运行 node scripts/concurrency-smoke.mjs，执行两批共 9 个真实只读工具调用并保存 reports/live/concurrency-smoke-results.json。该脚本并发提交 MCP 调用，Server 串行访问设备。详见 [CONCURRENCY_TEST_RESULTS.md](testing/CONCURRENCY_TEST_RESULTS.md)。

第一轮之后已补充容量、等待上限和取消，见下节。11 个写工具的连续步骤已作为完整任务串行执行。多 Server 进程协调、优先级和多个独立工具调用之间的事务尚未实现。

## 队列容量、等待与取消

默认最多等待 16 个任务，单个任务最多排队 30 秒。T830_QUEUE_MAX_PENDING（0–1000）和 T830_QUEUE_WAIT_MS（1–120000 毫秒）可调整。队列满返回 QUEUE_FULL，等待超时返回 QUEUE_WAIT_TIMEOUT，取消返回 CALL_CANCELLED。未开始的任务会被移除，不发送设备请求。

MCP 主动取消和当前 SDK 超时通知会传递至工具。已发送请求只取消本地等待，不能保证远端停止；共享登录先完成或超时，再跳过取消任务的业务请求。

node --test test/queue.test.mjs 可单独运行 13 项边界测试。详情见 [QUEUE_LIMITS_TEST_RESULTS.md](testing/QUEUE_LIMITS_TEST_RESULTS.md)。
## 连续业务步骤、外部干扰和关闭

11 个普通写工具均执行连续验证流程。同实例工具不能插入，外部网页修改无法锁定，通过写前检查与写后回读检测部分冲突。保留 t830_set_upnp_verified({upnp_switch,expectedCurrent}) 兼容入口，成功仍返回 verified_field；它额外校验调用者提供的原值。实机 UPnP 修改和恢复已验证。回读只能发现采样时可见的变化，不能证明不存在外部干扰。

关闭会拒绝等待及新任务，允许活动任务收尾，默认期限 5 秒（T830_SHUTDOWN_GRACE_MS 可调整）。期限到达后停止本地等待，远端是否执行仍可能未知。支持 stdin EOF 与正常交付的 SIGINT/SIGTERM，不包含掉电或操作系统强制终止后的恢复。

node --test test/workflow-shutdown.test.mjs 可运行本轮 13 项模拟测试。详情见 [WORKFLOW_SHUTDOWN_TEST_RESULTS.md](testing/WORKFLOW_SHUTDOWN_TEST_RESULTS.md)。

## 开发者会话（可选）

当前设备官方网页的授权流程为：普通管理员登录 → `gen.attr/check_asymmetric_verify` 验证开发者密钥 → 用返回的临时密码按 SHA256(salt:密码) 登录 `superadmin`。仅提交验证工具不会使现有 MCP 会话自动成为开发者会话。

项目支持进程环境 `T830_DEVELOPER_KEY`。推荐使用隐藏输入，不将密钥写入 `.env`、源码或报告：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1 --web
```

启动后先输入正常设备管理密码，再选择是否输入第二个密码（设备开发者密钥）：第二项直接回车使用普通 admin 模式；两项都提供且通过设备验证后，使用权限更高的 developer / superadmin 会话。若已通过环境变量提供凭据，脚本复用该值并跳过对应输入。两个凭据都不填仍可跳过设备连接。保留 `--developer --web` 用法，此时第二项不能为空。

会话续期会重新完成授权流程；密钥验证或开发者登录失败会停止调用，不退回普通管理员身份继续执行。密钥及派生临时密码不传给对话模型、不写入报告。停止服务后需重新提供交互输入的密钥。写工具仍受 `AGENT_ENABLE_WRITES` 和逐次确认约束；权限允许不代表功能验证通过。固件未提供的对象或无数据也不能靠开发者权限补齐。

## CGI 登录故障时的标准 UBUS 认证

2026-10-20 写接口修复后，显式选择 `T830_AUTH_TRANSPORT=ubus` 时，独立 `t830_set_login`/`t830_set_logout` 也使用标准 `session.login`/`session.destroy`。登录工具仍收取盐化摘要，但必须与进程环境中同账号的原始密码匹配，才会发送该密码；不匹配在本地拒绝。设备拒绝销毁会话时返回真实错误，不假装已注销。CGI 模式维持原端点。

信号记录保存需提交 `signal_start` 返回的 `index/name/sigal/time/qos`，并填写 `position`；测量默认超时提高到 20 秒，显式 `T830_TIMEOUT_MS` 优先。电话本写入需完整 `numb/numb_house/numb_work/email/flag`，`type` 为 0–3，新增 `flag=0`、编辑 `flag=1` 且带 `index`，不会发送短信。重启计划提交完整 `action/schweek/schTime`，时间格式为 `HH;mm`，禁用时星期可为空。

厂商文档中的夜间 WiFi、重启计划和高级 WiFi 业务码 409 表示未变化，返回中标记 `businessOutcome=not_modified`；有回读的工作流仍必须确认目标字段，才给出 `submissionOutcome=not_modified`，不会把它说成已发生配置变更。

2026-10-20 实机发现 CGI 登录返回 HTTP 500，指向固件 `login.lua:176` 的 last_stamp 算术异常。重启后同样存在，但使用相同管理员凭据的标准 rpcd `session.login` 可成功认证，再验证开发者密钥并以 `superadmin` 登录。此流程验证已有账号凭据，不修改 ACL，也不自动回退到其他身份。[标准接口文档](https://openwrt.org/docs/guide-developer/ubus/session)。

2026-10-21 复现了触发条件：设备重启后若在开机约 62 秒时就有一次成功的 CGI 登录，之后所有 CGI 登录都返回 500，直到下次重启。**重启后至少等 5 分钟再让任何客户端（网页服务、MCP、浏览器）登录**。正常时，默认 `cgi` 模式加开发者认证下 CGI 读写均可用，见 [CGI 写工具复测](testing/CGI_WRITES_2026-10-21.md)。**CGI 写工具必须使用默认 `cgi` 模式**；`ubus` 模式只在 CGI 登录返回 500 时临时使用，此时 CGI 工具仍会 403。

项目新增可选 `T830_AUTH_TRANSPORT=ubus`，默认仍为 `cgi`。标准认证需要原始密码，不能使用 `T830_PASSWORD_HASH`/`T830_SALT` 代替；仅发送到配置的设备同源地址。该模式用于当前固件可用的 UBUS 工具，**不能保证定制 CGI 接口兼容**：本次原生会话在 DHCP 读取及 4 个 CGI 写入口上仍返回 HTTP 403，不能算作已修复。

```powershell
$env:T830_AUTH_TRANSPORT='ubus'
powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1 --developer --web
```

当前网页服务已使用该模式重新加载，基本设备查询恢复。写工具的用户确认规则保持不变；真实写测试与剩余限制见 [重启后写测试](testing/WRITE_AFTER_REBOOT_2026-10-20.md)。

## 诊断结果、电话本与兼容查询

网络诊断需要先由用户确认 `t830_set_net_probe` 提案，再轮询 `t830_get_ping_result({addr:"read_ping"})`。设备 code=1 对应 `reading.state=pending`，表示尚未取得完整结果；不要重复启动任务。code=0 对应 complete，收发和丢包率见 reading；本机 127.0.0.1 测试不证明外网可达。

全部电话本或按名称搜索使用 `t830_get_phonebook({device:"1",type:"ALL",name?})`。类别/名称筛选用 `t830_get_phonebook_select`，省略 type/name 时自动补空字符串；type 仅接受空或 0/1/2/3，不能混用 ALL。成功码 0 且 data 为空字符串时，reading.state=empty，表示本次无条目，不伪造联系人。

初始化与 GPS 查询保留文档中的 CGI 主入口；仅当该路径返回 403/404 时，使用已在当前固件实测的同名 `web_api/get_setup`、`web_api/get_gps` 只读兼容入口。原始 CGI 错误留在 diagnostics；不改设备 ACL、不回退写方法。GPS 的 enabled 与 fix 分开，开启不等于定位成功。

上游 WiFi 无数据时仅经授权读取 STA 禁用状态，诊断不记录 SSID 或密钥；均禁用则 failure.category=precondition_not_met。101 Share 对象不存在时核对当前 UBUS 服务清单，缺少服务则标记 service_unavailable；不自动启用网络、安装软件或升级固件。实机结论见 [六项工具修复](testing/SIX_TOOLS_FIX_2026-10-20.md)。
