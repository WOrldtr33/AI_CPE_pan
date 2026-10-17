# T830 MCP Server Demo

通过命令行 Agent 调用 DeepSeek，再通过 MCP 查询或配置 T830 设备。当前 Agent 开放 31 项经实机冒烟正常返回的读工具；写操作仅开放 UPnP，生成提案后需逐次确认。

独立媒体模块通过 13 个 MCP 工具接入 Agent，支持图片理解、连续语音交流、经确认的单次拍照和后台摄像头监测。监测结果保存为图文报告。启动和交互见[媒体指南](docs/MEDIA_GUIDE.md)。

运行 `powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1 --web` 启动晴空仪表盘（React + TypeScript + Vite）。交互、构建与数据边界见[仪表盘指南](docs/DASHBOARD_GUIDE.md)。语音独立于摄像头，监测必须先明确目标、时长和记录方式，再由用户审核计划。视频通话和视频上传分析已移除。

## 从这里开始

| 想了解什么 | 阅读入口 |
|---|---|
| 整体框架、代码分工、数据流 | [项目导览](docs/PROJECT_GUIDE.md) |
| 启动 Agent、配置凭据、交互命令、测试方法 | [使用说明](docs/USAGE.md) |
| 音视频采集、语音问答与 Qwen 接入 | [音视频指南](docs/MEDIA_GUIDE.md)、[验证记录](docs/testing/MEDIA_TEST_RESULTS.md) |
| 已封装哪些接口、还有哪些未接入 | [API 接入清单](docs/api/API_CATALOG.md) |
| 厂商原始接口说明 | [API 文档](docs/api/API_DOC.md) |
| Agent 的实现与验证边界 | [Agent 测试记录](docs/testing/AGENT_TEST_RESULTS.md) |
| 实机读操作与写操作结果 | [读操作记录](docs/testing/LIVE_TEST_RESULTS.md)、[写操作记录](docs/testing/WRITE_VERIFICATION_TEST_RESULTS.md) |
| 原始 JSON 证据如何分类 | [报告索引](reports/README.md) |

## 目录

```text
src/             MCP、设备访问与 Agent 源码
frontend/        晴空仪表盘源码（React / TypeScript / Vite）
media/           独立音视频服务、构建后的首页、媒体工作台和模型适配
scripts/         启动、凭据配置、冒烟测试和文档生成脚本
test/            自动测试与固定样本
docs/            使用说明、接口文档、设计说明、测试记录
reports/         实测、模拟、诊断及历史 JSON 结果
references/      独立参考项目（OpenClaw）
.agent-state/    本地会话、长期记忆及任务状态（Git 忽略）
.agent-logs/     Agent 运行日志（Git 忽略）
.media-state/    本地媒体素材及服务连接信息（Git 忽略）
reports/monitoring/ 用户确认的摄像头监测图文记录（Git 忽略）
```

根目录的 `credentials-agent.json` 是本机 DPAPI 加密的 API Key 文件，已被 Git 忽略；配置与启动脚本仍使用该位置。`node_modules/`、`.pnpm-store/` 是依赖目录。

`credentials-media.json` 独立保存加密后的千问媒体 Key。

## 常用命令

在项目根目录的 PowerShell 中运行：

```powershell
# 配置 API Key（首次使用或更换 Key）
powershell -ExecutionPolicy Bypass -File scripts/configure-agent.ps1
# 启动 Agent，按提示输入设备管理密码
powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1
# 本地自动测试，不调用云端模型、不修改真实设备
node --test
# 独立媒体服务；另开窗口运行，打开输出的本机页面
node scripts/media.mjs
# 根据原始 API 文档生成接入清单
node scripts/catalog.mjs
```

独立 MCP Server：`npm start`；设备凭据已配置时也可用 `npm run agent`。实机冒烟命令及写操作边界见[使用说明](docs/USAGE.md)。

2026-10-14 媒体交互调整后回归：**150 项通过，0 失败**。另完成假摄像头／麦克风的浏览器交互检查，以及真实 DeepSeek／Qwen 的语音、需求澄清和监测报告流程测试。历史视频通话报告仅保留为旧版本证据。

