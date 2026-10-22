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
| [live/write-fixes-2026-10-20/verification.json](live/write-fixes-2026-10-20/verification.json) | `scripts/verify-write-fixes.mjs --apply` | 信号记录与电话本创建/编辑/删除及恢复、重启计划与夜间 WiFi 无变化响应、原生登录通过；原生注销仍被拒；126 项回归通过；[修复报告](../docs/testing/WRITE_INTERFACE_FIXES_2026-10-20.md) |
| [live/systematic-writes-2026-10-20/real-summary.json](live/systematic-writes-2026-10-20/real-summary.json) | `scripts/summarize-systematic-live.mjs` | 39 次独立 MCP 实机写调用、28 种工具；5 种实际变更并恢复，4 种仅原值提交，1 种本机 Ping，3 种仅接口确认，15 种失败或拒绝；48 种未提交；[实机报告](../docs/testing/REAL_DEVICE_WRITES_2026-10-20.md) |
| [live/systematic-writes-2026-10-20/coverage.json](live/systematic-writes-2026-10-20/coverage.json) | `scripts/summarize-systematic-writes.mjs` | 本轮 76 个普通写工具的模拟覆盖及实机缺项；119 项相关回归通过，新增 336 项矩阵检查；现有会话 UPnP 兼容工具修改、恢复、取消和冲突实测通过；不代表全量实机通过；[说明](../docs/testing/SYSTEMATIC_WRITES_2026-10-20.md) |
| [mock/write-fault-matrix-2026-10-20.json](mock/write-fault-matrix-2026-10-20.json) | `node --test test/write-fault-matrix.test.mjs` | 76 个写工具非法参数拒绝及 65 个单次提交工具的成功、告警、403、断连检查；仅本机模拟设备，含危险工具 |
| [live/six-tools-2026-10-20/verification.json](live/six-tools-2026-10-20/verification.json) | `scripts/verify-six-tools.mjs` | Ping启动/读取、电话本参数、GPS/初始化兼容入口，以及WiFi禁用和Share缺失的诊断；[结论](../docs/testing/SIX_TOOLS_FIX_2026-10-20.md) |
| [live/writes-developer-after-reboot-2026-10-20/summary.json](live/writes-developer-after-reboot-2026-10-20/summary.json) | 标准开发者认证、受控写入与最终对照 | 11 种工具、14 次写请求；5 种工具的原值提交/本机 Ping 通过，6 种被拒绝；[完整说明](../docs/testing/WRITE_AFTER_REBOOT_2026-10-20.md) |
| [live/writes-developer-2026-10-20/existing-session-write.json](live/writes-developer-2026-10-20/existing-session-write.json) | `scripts/live-existing-session-write.mjs --apply` | 复用已有开发者会话，UPnP 两次真实提交均验证并恢复；其他写测试被新登录 HTTP 500 阻断；[说明](../docs/testing/DEVELOPER_WRITE_TEST_2026-10-20.md) |
| [live/all-tools-2026-10-20/developer-full.json](live/all-tools-2026-10-20/developer-full.json) | 开发者密钥授权后的 MCP 实机查询与只读权限复核 | 52 项正常、3 项业务告警、3 项失败；40 个 UBUS 写方法获授权但未执行；[结论](../docs/testing/DEVELOPER_ACCESS_2026-10-20.md) |
| [live/all-tools-2026-10-20/results.json](live/all-tools-2026-10-20/results.json) | `scripts/live-all-tools.mjs`、`scripts/live-controlled-tools.mjs` | 58 项实机查询、76 项写预检、5 种写工具共 8 次提交与回读、UPnP/DNS 恢复及真实网页模型链路；[结论与限制](../docs/testing/ALL_TOOLS_LIVE_2026-10-20.md) |
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
