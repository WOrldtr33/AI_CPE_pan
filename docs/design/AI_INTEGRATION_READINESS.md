# AI API 接入条件检查

检查日期：2026-10-12。对象：当前目录中的 T830 MCP Server Demo 0.2.0。

更新：下文保留接入前检查结果。现已新增命令行 Agent、DeepSeek API 接入与工具循环，并完成真实模型 + MCP + 纯虚构模拟设备闭环；最新 121 项自动测试通过。Agent 已支持摘要、显式长期记忆、任务保存与恢复，默认开放 31 项经实机冒烟正常返回的读工具，以及需逐次确认的 UPnP 写工具。用户已反馈此前四项查询修复后通过；本轮新增功能使用模拟模型和模拟设备验证，未新增实机写入。实际实现与使用方法见 README.md，验证边界见 docs/testing/AGENT_TEST_RESULTS.md。

## 结论

已具备开始接入 Qwen 的 MCP 工具基础；尚未具备“配置 API Key 后直接运行 AI Agent”的完整应用层。适合先实现本机、只读、小规模工具白名单的 AI 联调，不要求先修复全部设备接口。

建议结构：用户问题 → 本地 Agent（Qwen API 客户端 + MCP Client）→ stdio MCP Server → T830；工具结果返回 Agent，再送模型生成答复。AI Key 保留在 Agent，设备管理凭据传给 MCP Server。

Qwen Function Calling 要求应用执行模型返回的工具名称与参数，并将结果关联 tool_call_id 回传。现有 Server 不负责这一循环。官方依据：https://www.alibabacloud.com/help/zh/model-studio/qwen-function-calling

## 本次验证

- 阅读 src/server.mjs、src/t830.mjs、src/catalog.mjs、测试客户端及既有实机报告。
- 本机 Node.js 24.19.0，安装的 MCP SDK 1.30.1。
- 运行 node --test：76 项通过，0 失败、0 跳过；包含真实 MCP stdio 握手与模拟设备调用、参数限制、默认禁写、并发、取消、关闭和写回读流程。
- 未调用 Qwen、未验证 Key/账号额度/模型权限，未重新连接真实设备或修改设备配置。
- 测试会按现有逻辑重新生成 reports/mock/mock-smoke-results.json 和 reports/mock/write-mock-results.json；这是模拟记录，不是新增实机证据。

## 已满足

| 条件 | 证据与边界 |
|---|---|
| MCP 传输与工具发现 | server.mjs 使用 StdioServerTransport；测试 Client 完成握手、listTools、callTool。适合本机由客户端启动子进程。 |
| 工具描述与输入约束 | 48 个只读目录条目、11 个写条目；工具描述带类别和前提；schema 限定参数。 |
| 可程序读取的结果 | 返回 content 与 structuredContent；错误使用 isError；区分 returned、device_warning 和 error。 |
| 设备侧有限执行 | 请求超时、有限重试、FIFO、容量/等待上限、取消与关闭已实现并测试。不能代替 Agent 总预算。 |
| 默认只读 | 未设置 T830_ENABLE_WRITES=1 时不注册写工具，并有设备层保护。 |
| 现有设备数据脱敏 | 返回和诊断对密码、会话、SIM 标识等字段脱敏；.gitignore 排除 .env。不是未来 AI 日志的完整保护。 |
| 实机基础证据 | 2026-10-08 报告为 31 正常、3 告警、14 失败；实机 UPnP 修改并恢复通过。以上为历史记录，本次未复测。 |

## 接入前需要补齐

1. **AI 配置与请求层**：环境变量读取 Key、与 Key 平台/地域匹配的 base URL、模型 ID；验证该模型支持 Function Calling。按模型支持情况配置思考、输出上限、请求超时；处理鉴权失败、429、5xx 和有限重试。项目目前没有读取 AI Key 或调用模型的代码。可以使用 Node fetch，不强制新增 SDK。
2. **Agent/MCP 桥接层**：启动现有 Server；将 listTools 的名称、描述、inputSchema 转成模型 tools；解析 tool_calls，经执行白名单检查后调用 MCP；为每个 tool_call_id 回传结果，直到得到最终回答或达到上限。现有 scripts/smoke.mjs 是固定测试流程，不是 Agent。
3. **调用与成本边界**：限制模型轮数、工具总次数、每轮工具数量、总时长及累计 Token；已知权限拒绝等错误不允许模型无限重复调用。对模型输入使用必要业务字段，保留完整诊断到本地，避免重复传送大量日志。
4. **AI 记录与凭据保护**：记录模型名、耗时、usage、工具名/参数、operationId、错误和退出原因；API Key、Authorization、设备密码不得写入提示词或报告。现有 redact 按字段名匹配，不涵盖所有 api_key/Authorization 场景；AI 日志需单独处理。现有 CLI 将 process.env 整体传入子进程，新增 Agent 时宜只传设备必需环境变量。
5. **行为与错误约束**：只以实际工具结果作答；告警不等于成功联网，权限失败不等于设备不支持；设备返回文本作为数据处理。首轮只提供经过选择的只读工具。未来开放写操作时，需增加应用端的用户确认/授权策略，工具 annotations 本身不会执行确认。
6. **闭环验收**：先模拟模型工具请求验证发现→执行→回传→终答，再用真实 Key 做最小调用、单工具读取和多工具汇总；验证无效参数、权限失败、超时、轮数上限与日志脱敏。只有真实模型参与后才能确认实际兼容性。

## 无 SIM 的测试范围

无 SIM 不妨碍测试自然语言查询、模型选工具、本地 MCP 调用和配置/设备状态读取，前提是运行 Agent 的电脑能同时访问 Qwen 服务与 T830 管理地址。若电脑仅连接没有外网上行的 T830，仍需其他可用互联网通路；不能因本次文档查询成功就推断连接 T830 后路由也正确。

不能据此验收蜂窝注册、拨号、APN 上网效果、移动网络吞吐和真实蜂窝故障恢复。已有 14 项失败不全部归因于无 SIM，报告包括权限拒绝、CGI 403、NO_DATA 和 Object not found。

## 推荐首轮验收

首轮可考虑 version、device_info、wifi、mesh_status、sim_presence 等在历史实机测试中正常返回的只读工具，连接设备后再确认当前可用性。无需一次向模型开放所有目录条目；t830_query 若开放，也需限制可选 section，避免绕过小范围白名单。

验收目标：用户问设备版本/WiFi状态/是否插卡 → 模型选择正确工具 → MCP 返回真实结果 → 模型准确解释；同时证明错误可退出、调用有上限、Key 不落日志。完成后再扩大工具范围和考虑写能力。
