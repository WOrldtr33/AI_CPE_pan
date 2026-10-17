# 2026-10-08 T830 实机只读测试

使用原始管理密码登录 admin。未记录密码/token/Cookie，未执行写配置。

## 汇总

共 48 项。2026-10-08 为 31 项正常返回、3 项业务告警、14 项失败。2026-10-17 已插入 SIM 且蜂窝上联连接后，复测蜂窝相关只读项：`device`、`sim`、`traffic` 由业务告警变为正常返回；`sim_presence` 为在槽（21），`status` 上联为 connected。`sim_slot` 与 `roaming` 仍是会话无权限。其余行仍是 2026-10-08 的结果，本轮没有重跑。当前表为 34 项正常返回、0 项业务告警、14 项失败。未执行写配置，也未提交 PIN/PUK。

| API | section | 状态 | 证据／结果 |
|---|---|---|---|
| 1 | first_setup | returned | 返回并通过当前基本解析 |
| 2 | setup | error | HTTP_403 |
| 8 | country | returned | 返回并通过当前基本解析 |
| 9 | wifi | returned | 返回并通过当前基本解析 |
| 12 | guest | returned | 返回并通过当前基本解析 |
| 15 | wps | returned | 返回并通过当前基本解析 |
| 16 | wps_run | returned | 返回并通过当前基本解析 |
| 19 | wifi_ad | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 21 | wifi_night | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 23 | workmode | returned | 返回并通过当前基本解析 |
| 25 | wifi_rt | error | UBUS_ERROR_5_NO_DATA；access=true，workmode=4，模式相关为假设 |
| 30 | mesh_status | returned | 补 Cookie 后恢复 |
| 31 | mesh_role | returned | 补 Cookie 后恢复 |
| 34 | mesh_routers | returned | 补 Cookie 后恢复 |
| 38 | clients | returned | 返回并通过当前基本解析 |
| 41 | status | returned | 返回并通过当前基本解析 |
| 42 | device_info | returned | 返回并通过当前基本解析 |
| 43 | device | returned | 2026-10-17 插卡复测：code=200，PS_eAct=NR，reading.state=registered；不代表测速 |
| 44 | version | returned | 返回并通过当前基本解析 |
| 49 | sim_presence | returned | 返回并通过当前基本解析 |
| 50 | sim_slot | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 52 | sim | returned | 2026-10-17 插卡复测：sim.status=READY，lock=0；号码已脱敏 |
| 58 | network_mode | returned | 返回并通过当前基本解析 |
| 60 | apn | returned | 返回并通过当前基本解析 |
| 63 | cells | returned | 返回并通过当前基本解析 |
| 63 | band_lock | returned | 返回并通过当前基本解析 |
| 67 | roaming | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 69 | mac_filter | returned | 返回并通过当前基本解析 |
| 72 | ip_filter | returned | 返回并通过当前基本解析 |
| 75 | port_forward | returned | 返回并通过当前基本解析 |
| 78 | port_map | returned | 返回并通过当前基本解析 |
| 81 | url_filter | returned | 返回并通过当前基本解析 |
| 83 | upnp | returned | 返回并通过当前基本解析 |
| 85 | dmz | returned | 返回并通过当前基本解析 |
| 87 | alg | returned | 返回并通过当前基本解析 |
| 89 | dns | returned | 补 Cookie 后恢复 |
| 91 | dhcp | returned | 补 Cookie 后恢复 |
| 94 | static_ip | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 95 | ntp | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 97 | time | returned | 返回并通过当前基本解析 |
| 98 | reboot_schedule | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 101 | signal_records | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 105 | tr069 | error | RPC_ERROR_-32002；目标 access=false，对照 WiFi access=true |
| 107 | gps | error | HTTP_403 |
| 109 | developer_mode | returned | 补 Cookie 后恢复 |
| 112 | traffic | returned | 2026-10-17 插卡复测：stats.code=200 |
| 114 | diagnose | error | HTTP_403 |
| 128 | share | error | RPC_ERROR_-32000；设备返回 Object not found，access=false，根因未知 |

## 剩余失败的处理边界

- 9 项 UBUS 拒绝已由 session.access 确认为当前会话没有目标方法权限；未尝试提权。
- router 返回 NO_DATA，权限允许，当前 workmode=4。没有切换模式，不把前端使用条件推断当成后端根因。
- setup、GPS、diagnose 在始终带 Cookie 的独立对照中仍返回 403；同会话 Mesh 查询成功。GPS/diagnose 重新登录一次后仍失败；具体设备侧策略尚未确认，不继续重试。
- 101 Share 的设备返回 Object not found；不推断是文档错误还是固件功能未包含。

## 本轮修复与测试

发现 country_code=ZA 被通用 *_code 判断误判为业务错误，已改为明确结果码字段集合，并增加回归断言。修复后重跑 48 项实机查询。11 项模拟自动测试全部通过。

## 日志

- reports/live/mcp-smoke-results.json：修复后完整实机结果和自动诊断轨迹。
- reports/archive/mcp-smoke-first-pass.json：首次原始结果（包含已修正的国家编码误判）。
- reports/diagnostics/t830-cgi-diagnostics.json：始终带 Cookie 的 CGI 对照。
- reports/mock/mock-smoke-results.json：模拟设备测试，不代表真实写操作验证。

## 返回校验与诊断记录更新

新增关键字段/类型校验、诊断请求参数与用途、证据性质和 diagnosticSummary；MCP 错误同时提供 structuredContent。重新执行 48 项只读实机测试，仍为 31 返回、3 告警、14 失败，无新增校验失败。旧完整报告保存在 reports/archive/mcp-smoke-before-validation.json。share 权限查询返回 false，但不将其解释为 Object not found 的确定原因。
