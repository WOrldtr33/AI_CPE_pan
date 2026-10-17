# 原始报告索引

本目录保存 JSON 测试与诊断证据。人阅读的结论与时间线在 [docs/testing](../docs/testing/)，运行方法在[使用说明](../docs/USAGE.md)。以下路径相对于本目录。

## 分类

| 目录 | 内容 | 说明 |
|---|---|---|
| `live/` | 实机查询、写前预检、UPnP 写验证，以及真实模型测试 | 每份报告证明的范围不同，见下表 |
| `mock/` | 模拟设备自动测试结果 | 不代表真实设备通过 |
| `diagnostics/` | CGI、UBUS 诊断和网页映射证据 | 用于排查与接口映射 |
| `archive/` | 首轮和新增响应校验之前的只读结果 | 保留历史对照，不是最新结果 |

## 当前报告

| 文件 | 生成方式或来源 | 验证范围 |
|---|---|---|
| [live/media-workflow-live-results.json](live/media-workflow-live-results.json) | `node scripts/media-workflow-live-smoke.mjs` | 当前真实语音/Agent、笼统需求澄清、计划等待确认和图文监测报告；全部虚构素材，无真实设备访问 |
| [mock/media-ui-results.json](mock/media-ui-results.json) | `node scripts/media-ui-smoke.mjs` | 当前桌面/手机布局、假摄像头拍照确认、连续两轮语音、监测确认和图文报告下载 |
| [mock/media-monitor-report-example.html](mock/media-monitor-report-example.html) | 当前真实模型工作流测试生成 | 虚构红/蓝画面的独立图文记录示例，可直接打开；不是现场监测证据 |
| [live/mcp-smoke-results.json](live/mcp-smoke-results.json) | `node scripts/smoke.mjs` | 实机只读查询与诊断 |
| [live/concurrency-smoke-results.json](live/concurrency-smoke-results.json) | `node scripts/concurrency-smoke.mjs` | 实机只读并发提交 |
| [live/write-preflight-results.json](live/write-preflight-results.json) | `node scripts/write-preflight.mjs` | 只读基线与权限预检，不写入 |
| [live/write-live-results.json](live/write-live-results.json) | `node scripts/write-smoke.mjs --apply` | UPnP 修改、回读与恢复 |
| [live/agent-live-results.json](live/agent-live-results.json) | `node scripts/agent-live-smoke.mjs` | 真实云端模型 + 本机模拟设备，数据全部虚构，不是实机证据 |
| [live/media-live-results.json](live/media-live-results.json) | `node scripts/media-live-smoke.mjs` | 真实 Qwen3-Omni-Flash 图片分析、语音生成和转写；仅虚构媒体 |
| [live/media-video-live-results.json](live/media-video-live-results.json) | 历史脚本已退役 | 旧版视频首帧分析证据，该功能已移除 |
| [live/media-monitor-live-results.json](live/media-monitor-live-results.json) | 历史脚本已退役 | 旧版逐帧描述证据，现已改为确认后的监测报告任务 |
| [live/media-call-live-results.json](live/media-call-live-results.json) | 历史脚本已退役 | 旧版音视频通话和纸条请求证据，该功能已移除 |
| [live/t830-readonly-results.json](live/t830-readonly-results.json) | 早期实机实验记录 | 当时的只读结果 |
| [live/share-access-results.json](live/share-access-results.json) | 手工权限排查记录 | share 相关权限证据 |
| [mock/mock-smoke-results.json](mock/mock-smoke-results.json) | `node --test` | 模拟设备 MCP 接口检查 |
| [mock/write-mock-results.json](mock/write-mock-results.json) | `node --test` | 模拟写入、回读、取消等场景 |
| [diagnostics/t830-cgi-diagnostics.json](diagnostics/t830-cgi-diagnostics.json) | 实机诊断记录 | CGI 与 Cookie 对照 |
| [diagnostics/t830-interface-diagnostics.json](diagnostics/t830-interface-diagnostics.json) | 实机诊断记录 | 接口响应与权限排查 |
| [diagnostics/write-mapping-evidence.json](diagnostics/write-mapping-evidence.json) | 设备网页代码分析记录 | 写字段与回读映射依据 |
| [archive/mcp-smoke-first-pass.json](archive/mcp-smoke-first-pass.json) | 历史只读冒烟 | 最初结果，含后来修正的误判 |
| [archive/mcp-smoke-before-validation.json](archive/mcp-smoke-before-validation.json) | 历史只读冒烟 | 增加关键字段校验前的结果 |

终端命令均在项目根目录执行。脚本从任何工作目录启动，仍将结果写入本目录；目录不存在时自动创建。运行对应脚本会覆盖同名输出，归档文件不会由当前测试自动覆盖。

2026-10-13 目录整理时，14 份已有 JSON 报告逐一校验 SHA-256，移动前后内容完全一致。以后的自动测试会更新 `mock/` 中的报告。
