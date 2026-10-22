# 2026-10-20 开发者会话继续写入测试

后续更新：用户重启后发现可用的标准 UBUS 认证路径，已继续测试 11 种写工具，结果与限制见[重启后写测试](WRITE_AFTER_REBOOT_2026-10-20.md)。

## 本轮实测

复用了网页 Agent 已有且仍有效的开发者会话，执行 UPnP 开关修改、回读和恢复。测试前为 0，写入 1 后回读确认，再写回 0 并回读确认。两次真实提交均通过验证；最终设备 available=true、online=true。没有重启设备，没有修改其他业务配置。

| 工具/入口 | 实际提交次数 | 回读结果 | 恢复结果 |
|---|---:|---|---|
| t830_set_upnp_verified（网页 prepare/confirm） | 2 | 两次均 verified_field | 0→1→0，确认恢复 |

这是已有会话下的真实网页提案确认与 MCP 写验证，不是模拟测试，也不是全部写工具通过的声明。

## 其他写工具尚未执行

本轮先为夜间 WiFi、漫游、流量、APN、安全开关等候选工具读取当前基线，但 MCP 新建会话在管理员登录阶段返回 HTTP 500。原计划的 16 项基线均没有发出目标查询：它们因复用同一个失败登录结果而返回错误，不应算作 16 个目标接口自身失败。

另用已知凭据复核一次，设备返回 LuCI 异常：

```text
/usr/lib/lua/luci/controller/login.lua:176:
attempt to perform arithmetic on local 'last_stamp' (a string value)
```

同时设备首页、公共登录状态与公共固件版本入口均 HTTP 200。现有开发者会话仍有效，故可完成 UPnP 的受控写入；这些事实不说明新登录服务已经恢复。

没有取得候选工具的当前有效基线与可靠恢复材料，因此没有向其提交样例参数、盲写配置或使用历史配置恢复。本轮也未执行重启、恢复出厂、固件、密码、短信、规则/数据删除。

## 继续条件

已请用户先重启设备，之后重新检查登录与基线；重启未保证一定消除固件问题，若仍失败需厂商修复登录服务的时间戳处理。只有新会话登录和基线读取恢复后，才继续新增写工具的可恢复测试。

## 原始证据

- [UPnP 两次提交与恢复完整记录](../../reports/live/writes-developer-2026-10-20/existing-session-write.json)
- [现有开发者会话只读检查](../../reports/live/writes-developer-2026-10-20/existing-session.json)
- [新会话登录异常摘要](../../reports/live/writes-developer-2026-10-20/login-blocker.json)
- [被登录初始化阻断的基线记录](../../reports/live/writes-developer-2026-10-20/baselines.json)

脚本：`node scripts/live-write-baselines.mjs` 只读；`node scripts/live-existing-session-write.mjs --apply` 会实际修改 UPnP 并尝试恢复，仅在用户明确授权测试且基线可用时执行。账号凭据和会话凭据不写入报告。
