# T830 API 本地测试记录

## 最新实机复测：2026-10-08，原始密码登录

设备重新可访问后，48 项只读查询全部执行：31 项正常返回、3 项业务告警、14 项失败、无跳过。详细逐项结果见 docs/testing/LIVE_TEST_RESULTS.md。9 项权限拒绝有 session.access 证据；router 无数据；3 项 CGI 403 带 Cookie 对照仍失败；101 Share 返回 Object not found。6 项查询经 Cookie 自动补发恢复。

修正了 country_code=ZA 被误识别为业务错误码的问题，新增回归断言，6 项自动测试通过后重跑实机 smoke。原始密码、会话 token 和 Cookie 未写入源码或报告，未修改真实设备配置。下面超时记录是同日更早一次测试，不代表本轮结果。

## 最新进度：2026-10-08 Demo 0.2

- 已恢复 Cookie：auto/always/never 三种模式，默认 auto；只读 CGI 明确要求登录后携带 Cookie 有限重试，必要时重新登录一次。
- 48 项只读条目和 11 项写条目已封装，分类与暂未接入项见 docs/api/API_CATALOG.md。默认只注册读工具；写工具需 T830_ENABLE_WRITES=1，实机 smoke 强制不写。
- 失败保留原始响应及步骤日志：权限拒绝追加 session.access；router NO_DATA 追加权限和工作模式查询，假设与确认结果分开。诊断不递归，不自动提权或切换模式。
- 自动测试使用本地模拟设备，验证全部 59 项接口的 MCP 注册、callback、端点与业务参数映射；写接口未在真实设备执行。模拟结果见 reports/mock/mock-smoke-results.json。
- 本轮真实只读 smoke：首项 first_setup 超时，有限重试后仍超时，后续 47 项标记 skipped；退出码 1，原始诊断见 reports/live/mcp-smoke-results.json。
- 网络核对：本机以太网 Media disconnected；WLAN 192.168.3.52，网关192.168.3.1；独立 curl 查询 192.168.0.1 也连接超时。需连接 T830 后重新执行实机 smoke，不能把模拟通过当作实机通过。
- 下文为历史记录，描述此前连接设备时的结果，不代表本轮新增接口均已实机验证。

测试日期：2026-09-29（Asia/Shanghai）

设备地址：`http://192.168.0.1`。当前无 SIM 卡，蜂窝 Internet 连接和公网吞吐测试不具备条件。本轮只读，未修改配置、重启或发起打流。

## 实测结果

| 请求 | HTTP 状态 | 关键返回 | 结论 |
|---|---|---|---|
| GET `/` | 200 | 管理页面 HTML | 本机可访问设备管理页面 |
| GET `/cgi-bin/luci/login/get_login_status` | 200 | `code: 0`, `first_setup: "0"`, `fail_cnt: 0`, `max_try: 5` | 登录状态查询可访问；不代表已登录 |
| GET `/cgi-bin/luci/login/get_firstsetup` | 200 | `first_setup: "0"`, `code: 0` | 初始化状态查询可访问 |
| GET `/cgi-bin/get_simcard_inslot_stat` | 200 | `{"data":{"simcard_inslot":"0"},"dataCode":200}` | 与用户说明的未插 SIM 状态一致 |
| GET `/cgi-bin/luci/admin/jt_diagnose/get_diagnose_info` | 403 | `x-luci-login-required: yes`，HTML 登录页面 | 此接口未登录时拒绝访问；业务数据未验证 |

以上 GET 请求未附加 flag/t 参数，设备仍返回上述结果。后续正式客户端按文档附加这些参数。

## 登录流程核对

检查设备管理页引用的 `/assets/index-CR_moC_F.js`，发现前端生成 64 字符 salt，以 `SHA256(salt + ":" + password)` 作为登录 password 参数。登录成功条件为 `code == 0`，会话取自响应 `sessionid`。未保存网页脚本到项目中。

后续使用用户提供的 password 哈希和 salt，以文档默认用户名 admin 登录成功：HTTP 200、code 0，取得 sessionid。UBUS 使用该 sessionid 调用成功，无需附加 Cookie。凭据及 sessionid 未写入项目文件。受保护 CGI 的登录后 Cookie 行为本轮尚未验证。

## MCP Demo 需要处理的差异

- 成功响应可能使用 `code` 或 `dataCode`，应按接口解析，不能只检查 HTTP 200。
- 未认证响应可能是 HTTP 403 和 HTML，不能无条件按 JSON 解析。
- 无 SIM 是设备业务状态，不等同于 HTTP 接口故障。
- WiFi、蜂窝配置及设备信息接口认证后测试见下表；公网打流尚未测试。

## 后续

## 已登录 UBUS 实测

所有请求 HTTP 200，但其中两个返回 JSON-RPC error，不能将 HTTP 200 等同于业务成功。

| 服务 / 方法 | 实测结果 |
|---|---|
| mtk.wifi / get_ssidPage_info | result[0]=0，返回双频及统一 WiFi 配置；各业务 code 为字符串 200 |
| mtk.cell / get_device_info | result[0]=0，业务 code=206，Warn=Mobile Network registration failed |
| mtk.cell / get_simcard_index | JSON-RPC error -32002，Access denied |
| mtk.cell / get_sim_info | result[0]=0，sim.ERROR="10"；具体码义尚未获得厂商定义 |
| mtk.cell / get_netWay_info | result[0]=0，code=200，ratMode="21"，返回 modeList，currAct="255" |
| mtk.cell / get_cellList_info | 返回小区信息；未插 SIM 时仍有数据，不能据此推断已注册或联网 |
| mtk.cell / get_cellLock_info | 返回支持频段、锁定参数和 FULL 状态 |
| mtk.cell / get_roaming_info | JSON-RPC error -32002，Access denied |
| jytl_api / apn_R_get | result[0]=0，code=200，返回 APN 列表 |

脱敏原始结果：`reports/live/t830-readonly-results.json`。Access denied 的具体原因未确认，可能涉及权限或固件接口开放情况；未尝试提权。

## MCP Demo 验证

- 官方 MCP SDK 1.30.1，Node.js v24.19.0，本机 Windows。
- stdio Client 启动 Server，握手和 tools/list 成功，发现 2 个工具。
- SIM 在槽状态及 7 类 UBUS 查询全部通过真实 MCP tools/call 返回。
- device 和 sim 查询保留为 device_warning，其余 returned 也不代表联网正常。
- 非法 section="reboot" 被拒绝，不触发设备写操作。
- 2 项自动测试通过，涵盖共享登录、凭据缺失、脱敏、业务告警、HTTP 403、非 JSON 响应和 UBUS/RPC 错误。
- MCP 脱敏结果：`reports/live/mcp-smoke-results.json`。

尚未验证：云端模型选择工具、RK 部署、配置修改、蜂窝联网、公网打流。当前 Demo 是只读工具链，不是完整自动优化系统。

## 2026-09-30：新增高级 WiFi 工具排查

用户新增 `t830_get_wifi_advanced`。发现并修正：底层方法误写为 `get_AdvancePage_info`（正确为 `get_AdvancPage_info`）；新方法直接发请求，未保证先登录。现改为复用 `rpc('mtk.wifi', 'get_AdvancPage_info')`。

核对先前从本设备下载的网页脚本，其调用同样为 `mtk.wifi / get_AdvancPage_info`。自动测试验证高级 WiFi 可作为首次调用完成登录，并校验方法和 flag，2 项测试通过。

真实 MCP smoke：3 个工具成功发现，原有 8 项查询正常，新高级 WiFi 查询仍返回 `RPC_ERROR_-32002`，退出码 1。此结果不能归因于缺少 SIM，也不能认定 MCP 工具注册失败；需进一步确认当前账号对该方法的权限及固件实际支持情况。`reports/live/mcp-smoke-results.json` 已更新为本轮结果，保留失败记录。

## 2026-09-30：替换 WiFi router 工具排查

Server 已改注册 `t830_get_wifi_router`，但 smoke 的 callTool 仍传旧的 `t830_get_wifi_advanced`，导致 MCP 工具不存在。已统一调用与日志名称，并更新测试中旧的适配器方法。

修正名称后，真实工具请求及直接 HTTP 对照请求均收到 `{"jsonrpc":"2.0","id":1,"result":[5]}`。按 OpenWrt ubusmsg.h 枚举，5 为 UBUS_STATUS_NO_DATA；目前不能确认具体原因，不能推断为权限拒绝、接口不存在或未插 SIM 导致。API25 查询的是当前 WiFi 路由连接信息，并非设备全部路由表。

适配器现在保留 UBUS 状态码，显示 `UBUS_ERROR_5_NO_DATA`，不再混入无效响应的通用错误。CLI 同时输出新增工具的错误详情。未更改设备工作模式或网络配置。

## 2026-09-30：Mesh CGI 403 排查及修复

实测登录成功时响应头返回 `sysauth_http` Cookie（值未记录）。同一次登录后，对 API30 `get_easymesh_switch` 做只读对照：不带 Cookie 为 HTTP 403，含 `x-luci-login-required: yes`；携带登录 Cookie 为 HTTP 200，返回 `{"data":{"easymesh_switch":"0"},"code":0}`。

根因：原适配器仅保存 JSON sessionid 供 UBUS 使用，没有保留 CGI 所需的登录 Cookie；新 Mesh 方法也未显式等待登录。现已补充登录 Cookie 的内存保存、同源请求发送、Path/Secure 范围约束，并在 Mesh 查询前调用 login。未实现通用浏览器 Cookie jar 或会话自动刷新。

修复后 2 项自动测试通过（含未认证 CGI 拒绝、首次 Mesh 调用自动登录并携带 Cookie、跨源请求拒绝）。真实 MCP smoke 的原 8 项查询及新增 Mesh 查询均返回，非法参数拒绝通过，退出码 0。设备配置未改变。此前未验证的 CGI 登录后 Cookie 行为已在本接口验证。

## 2026-09-30：advanced / router 深入诊断

同一有效登录会话下分别携带和不携带 Cookie，advanced 均返回 JSON-RPC -32002 / Access denied；router 均返回 result:[5]。基本 WiFi 查询与工作模式查询均正常。故这两个错误与 Mesh 缺 Cookie 的原因不同。

调用只读 session.access 检查当前会话的 UBUS 方法权限（scope=ubus）：

| 对象 / 方法 | access |
|---|---|
| mtk.wifi / get_AdvancPage_info | false |
| web_api / get_wifi_router | true |
| mtk.wifi / get_ssidPage_info | true |

结论：advanced 的当前访问失败直接原因已确认是会话未获该方法权限。为何固件 ACL 不授予 admin 此权限，需固件配置或负责人确认；不推断是用户密码错误，也未尝试提权。

router 的 get_workmode 实测 data.workmode=4。设备原网页脚本将值4标为 wireless broadband mode (default)，值5标为 WLAN router mode；在工作模式初始化代码中，仅当模式为5（或对应标签）时调用 H()，H() 再调用 get_wifi_router。此查询针对设备连接上游 WiFi/AP 的状态，不是通用路由表查询。当前模式不符合网页调用条件，是 NO_DATA 的强关联解释；未查看固件后端实现或切换模式，故未把此推断写成已经证明的后端原因。

本轮脱敏响应及权限结果存放于 `reports/diagnostics/t830-interface-diagnostics.json`。未修改设备配置或应用功能代码。
