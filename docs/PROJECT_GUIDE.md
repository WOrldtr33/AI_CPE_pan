# 项目导览

建议先读本页，再按需看[使用说明](USAGE.md)、[API 清单](api/API_CATALOG.md)和[测试记录](testing/AGENT_TEST_RESULTS.md)。本文中的源码路径、终端命令均相对于项目根目录。

## 运行链路

```text
用户在命令行提出问题
  → scripts/agent.mjs：接收输入和管理命令
  → src/agent-core.mjs：维护上下文，运行模型与工具循环
  → src/agent-api.mjs：请求 DeepSeek，接收答复或工具调用
  → src/agent-mcp.mjs：校验白名单及参数，通过 stdio 调用 MCP
  → src/server.mjs：注册工具并转交设备层
  → src/t830.mjs：认证、排队、HTTP/UBUS 请求和已验证的错误处理
  → T830 设备
  → 工具结果沿原链路返回模型，再输出答复
```

写工具在 Agent 层先保存提案。用户在终端输入 `/approve 提案ID` 后，才进入设备写验证流程；模型不能批准自己的提案。

音视频分支：`Agent → MCP → src/media-client.mjs → media/service.mjs → Qwen3-Omni-Flash`。浏览器页面负责麦克风、摄像头和扬声器，本机媒体服务保存素材、处理格式并调用识别服务。Agent 只使用素材 ID 和文字结果，详见[音视频指南](MEDIA_GUIDE.md)。

网页模式：`frontend/src/ → media/dashboard-ui/ → /api/chat → src/agent-web.mjs → 同一个 Agent 实现 → MCP`。通过 `scripts/start-agent.ps1 --web` 启动。`src/agent-web.mjs` 复用现有记忆、任务、上下文和工具策略，网页不加载 reference 中的 OpenClaw Gateway 连接逻辑。首页的读轮询与确认式设置经 src/dashboard.mjs 接入同一 MCP 白名单；旧媒体工作台在 /legacy 保留。详见[仪表盘指南](DASHBOARD_GUIDE.md)。

连续语音：`voice-audio.js → /api/voice/turn → ASR → SSE转写/回应/进度 → Agent → TTS`，不打开摄像头。后台监测：`media_prepare_monitor → 网页审核确认 → monitor-tasks.mjs → 采样识别 → reports/monitoring/<ID>/index.html`，不把每帧描述刷进聊天。视频通话、画面指令自动执行、视频上传分析已移除。

## 源码分工

| 关注点 | 文件 | 作用 |
|---|---|---|
| Agent 主流程 | `src/agent-core.mjs` | 模型与工具循环、任务、提案批准和恢复 |
| 模型请求 | `src/agent-api.mjs` | API 请求、流转协议、超时及有限重试 |
| 工具接入 | `src/agent-mcp.mjs` | MCP 子进程、工具描述、参数与执行白名单 |
| 工具开放范围 | `src/agent-policy.mjs` | 31 项已验证读工具、UPnP 写工具 |
| 上下文 | `src/agent-context.mjs` | 历史摘录摘要、近期完整问答的保存 |
| 状态与记忆 | `src/agent-store.mjs` | 会话、显式记忆、任务、提案与进程锁 |
| 配置与日志 | `src/agent-config.mjs`、`src/agent-log.mjs` | 配置、Key 读取、脱敏和结构化日志 |
| MCP 入口 | `src/server.mjs` | 工具注册、MCP 请求及关闭处理 |
| 接口目录 | `src/catalog.mjs` | 48 项读条目与 11 项写条目的描述、参数和映射 |
| 设备访问 | `src/t830.mjs` | 登录、Cookie、UBUS/CGI 请求及已验证恢复规则 |
| 响应解释 | `src/response.mjs` | 关键字段校验、业务告警与错误诊断摘要 |
| 写入验证 | `src/write-profiles.mjs`、`src/write-workflow.mjs` | 基线检查、字段比较、提交与回读 |
| 排队与取消 | `src/queue.mjs` | 有界 FIFO、超时、取消和关闭 |
| 公共设施 | `src/time.mjs`、`src/artifacts.mjs` | 洛杉矶时间戳、统一报告写入目录 |
| 媒体业务 | `media/service.mjs`、`media/store.mjs`、`media/processor.mjs` | 独立本机服务、素材保存、FFmpeg 处理 |
| 媒体模型 | `media/providers.mjs`、`media/omni.mjs`、`media/credentials.mjs` | 兼容服务、Qwen SSE/音频协议、加密凭据读取 |
| 媒体入口 | `media/public/`、`media/tools.mjs`、`src/media-client.mjs` | 新版网页、13 个工具定义、MCP HTTP 客户端 |
| 连续语音 | `media/public/voice-audio.js`、`media/service.mjs` | VAD、分段、流式转写与回复事件 |
| 监测任务 | `media/monitor-tasks.mjs` | 计划、用户确认、期限、取消、关键画面和图文记录 |

首次阅读代码建议顺序：`scripts/agent.mjs` → `src/agent-core.mjs` → `src/agent-mcp.mjs` → `src/server.mjs` → `src/t830.mjs`。其余文件按需要查看。

## 脚本分工

| 脚本 | 用途 |
|---|---|
| `scripts/start-agent.ps1` | 交互式输入设备密码并启动 Agent |
| `scripts/configure-agent.ps1` | 隐藏输入并加密保存模型 Key |
| `scripts/read-agent-key.ps1` | Agent 内部读取 Key 的辅助脚本 |
| `scripts/agent.mjs` | 命令行入口，也支持 API 检查和单次问题 |
| `scripts/smoke.mjs` | 实机只读冒烟，可指定 section |
| `scripts/concurrency-smoke.mjs` | 实机只读并发提交检查 |
| `scripts/write-preflight.mjs` | 写接口只读基线与权限预检 |
| `scripts/write-smoke.mjs` | UPnP 预览；带 `--apply` 才修改并有条件恢复 |
| `scripts/check-access.mjs` | 保留的手工权限排查脚本 |
| `scripts/agent-live-smoke.mjs` | 调用真实模型，用纯虚构设备数据验证工具闭环，会消耗 API 额度 |
| `scripts/catalog.mjs` | 生成 `docs/api/API_CATALOG.md` |

## 文档与结果

- `docs/api/`：厂商说明与生成的接入清单。
- `docs/design/`：接入前评估与响应诊断规则；接入前评估保留历史结论。
- `docs/testing/`：人阅读的各次测试记录，日期和验证范围以正文为准。
- `reports/`：JSON 原始证据，具体分类见[报告索引](../reports/README.md)。同名报告可能被对应脚本的下一次运行覆盖；固定测试样本独立保存在 `test/fixtures/`。
- `references/openclaw_dev-main/`：独立参考项目及其原始文件，不属于 T830 Demo 的运行链路。

## 本地状态与凭据

`.agent-state/` 保存脱敏后的会话、摘要、长期记忆和任务，`.agent-logs/` 保存运行日志。二者均被 Git 忽略；整理目录时保留原位置，已有任务仍可继续使用。

`credentials-agent.json` 保留在根目录，由 Windows DPAPI 保护；设备密码仍由启动提示或进程环境变量提供。长期记忆使用 `/remember` 显式添加，不自动训练模型。中断读取任务可以重新规划；已提交且结果不确定的写任务只回读，不重放写入。

