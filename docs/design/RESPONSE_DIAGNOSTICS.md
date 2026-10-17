# 返回校验与诊断记录

## 返回校验 validation

src/response.mjs 集中维护规则。规则依据已有脱敏实机样本，属于关键字段校验，不是完整厂商响应规范。新增字段允许保留，不把空列表、0 或关闭状态当成失败。

- status=passed：通过当前规则；不代表联网或配置生效。
- status=failed：空响应、只有成功码没有业务数据、缺少关键字段或类型错误。工具返回 INVALID_BUSINESS_RESPONSE，details.validation.issues 给出字段路径、原因和期望类型。
- status=skipped_business_warning：设备返回业务告警，未强制要求正常成功响应的关键字段。告警和原数据仍保留；不解释厂商未知业务码。
- coverage=key_fields：有关键字段规则；checkedFields 列出本次实际检查的字段及类型。
- coverage=basic：只有通用对象/业务数据检查，尚无接口专用规则。

例如 WiFi 使用路径数组 ["5G", "Channel"]，避免 2.4G 中的点被误认为层级分隔符。SSID 等敏感值继续脱敏；校验在脱敏之前执行。没有真实成功样本的失败接口不猜测必需字段。

## 诊断轨迹 diagnostics

原有 step 名称保留。每个记录增加 evidence：observation（直接观察）、confirmed（有证据支持的结论）、hypothesis（假设）、inconclusive（未确认结论）。

attempt 记录 endpoint、业务 params、次数和 withCookie。UBUS endpoint 含 service/method；CGI 含 path/httpMethod。params 继续脱敏。

diagnostic / diagnostic_failed 记录辅助查询的 service、method、params、purpose、withCookie 和结果或错误：

- target_permission：目标接口的 session/access。
- control_permission：对照接口的 session/access。
- workmode_context：router 失败后的工作模式查询。

access 必须返回布尔值；错误结构会记录 INVALID_ACCESS_RESPONSE，不能据此判定无权限。辅助查询不递归触发诊断。

## 诊断摘要 diagnosticSummary

成功输出在顶层提供摘要，失败输出在 details 中提供。摘要包括 outcome、rootCause、permissionCheck、confirmedFindings、hypotheses、attempts、retries，失败还包括 remainingUnknowns 和 stopped。

permissionCheck.status 区分 completed、failed、inconclusive、not_run、not_applicable。CGI 的 not_applicable 仅指当前 UBUS 权限查询不适用，不代表 CGI 没有权限控制。

仅已有权限拒绝错误且目标 access=false、对照 access=true 时，rootCause 为 target_permission_denied。share 的 Object not found，即使 access=false，也保持 rootCause=unknown；router 的工作模式相关解释仍为假设。

MCP 成功和失败均提供 structuredContent，同时保留 text 内容，方便 CLI 查看及客户端读取。

## 验证

node --test：11 项自动测试，包括真实 MCP Client 对模拟设备的调用、字段缺失/类型错误、动态字段、空列表、业务告警保留、辅助权限查询异常、结构化错误及不重复目标请求。

48 项真实只读 smoke：31 项正常返回且通过关键字段校验，3 项设备告警，14 项失败。新增校验没有增加误报；不执行真实写操作。查看 reports/live/mcp-smoke-results.json 中的 validation、diagnosticSummary 和 diagnostics。

test/fixtures/read-responses.json 是固定脱敏样本，自动测试不依赖随后覆盖的实机报告。reports/archive/mcp-smoke-before-validation.json 保留此次更新之前的报告。