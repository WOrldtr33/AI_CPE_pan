# 2026-10-20 用户重启后：可恢复写工具实机测试

## 结果

本轮已向真实设备提交 **14 次写请求，覆盖 11 种写工具**。7 个用例通过（5 种工具），7 个用例被设备拒绝或返回业务告警（6 种工具）。拒绝请求不算成功写入。测试结束，对照的 10 组配置字段均保持测试前原值；流量限额按字节归一比较，0 与 0MB 等价。

| 工具 | 请求数 | 结果及边界 |
|---|---:|---|
| t830_set_roaming | 1 | 提交原值 Enable，接口确认且回读匹配；没有测试关闭漫游 |
| t830_set_traffic | 1 | 提交原值，0 限额与起始日 1 回读一致，enable 保持 0；没有启用限额或重置统计 |
| t830_set_wifi_switch | 2 | 2.4G/5G 分别提交原值 up，回读匹配；没有关停无线 |
| t830_set_guest_switch | 2 | Guest/Guest5G 分别提交原值 down，回读匹配；没有开放访客网络 |
| t830_set_net_probe | 1 | 仅探测本机 127.0.0.1，已完成，6 发 6 收、0% 丢包；不代表外网上网或吞吐正常 |
| t830_set_wifi_night | 2 | 原值提交、禁用状态下尝试修改计划时间均返回业务码 409；计划一直保持禁用与原时间，未实际改动 |
| t830_set_wifi_advanced | 1 | 仅提交完整非敏感原值，返回业务码 409，所有对照字段未变 |
| t830_set_mac_filter_mode | 1 | HTTP 403；回读模式与 enable 原值保留 |
| t830_set_ip_filter_mode | 1 | HTTP 403；回读模式与 enable 原值保留 |
| t830_set_port_forward_switch | 1 | HTTP 403；开关原值保留 |
| t830_set_port_map_switch | 1 | HTTP 403；开关原值保留 |

夜间 WiFi 的原值提交虽然工具返回 verified_fields，但 submissionOutcome=error_but_state_confirmed，实际写响应为业务码 409；这只能证明字段仍等于目标值。本报告严格按写入未获确认记为未通过，未把“原值仍匹配”当作接口写成功。

## 认证障碍与可用路径

用户已重启设备；之后查询到启动时间约 143 秒。定制 CGI 登录仍返回 HTTP 500，标准认证入口则用相同凭据认证成功。已完成管理员认证→开发者密钥验证→superadmin 认证→真实 MCP 调用，**没有修改 ACL、伪造账号身份或更改固件**。

新增可选 T830_AUTH_TRANSPORT=ubus，默认仍为 cgi。标准认证遵循 [OpenWrt session.login 文档](https://openwrt.org/docs/guide-developer/ubus/session)，使用账号原始密码并由设备验证；不适用于只有盐化 hash 的配置。认证、拒绝、续期及凭据脱敏等完整本地回归 **194 项通过、0 失败**。

标准认证能让当前设备的 UBUS 工具继续测试，但不能保证定制 CGI 兼容。使用同一合法会话只读比较 sysauth_http 和 sysauth Cookie 名，DHCP 均返回 403；没有更改会话数据或权限来强行解除拒绝。夜间与高级 WiFi 的业务码 409 含义未确认，不等同 HTTP 409，也不猜测为单一权限或参数原因。

## 最终状态与未执行范围

最终标准认证下的网页 Agent 已恢复基本查询：HTTP 200、available=true、online=true、UPnP=0。5 项基础查询 returned，DHCP 查询仍是 HTTP 403；原 CGI 登录异常未被宣称修复。已有会话无法续期时已重载本项目网页服务，没有再次重启真实设备。

未修改 SSID、WiFi 密码、APN、TR069、NTP、定时重启、DHCP 地址池或 SIM/PIN；未升级固件、恢复出厂、发送短信或删除规则/数据。APN/WiFi/TR069 凭据被脱敏，无法取得完整恢复材料；GPS 基线仍 403；其他跳过原因见原始报告 skipped。

## 对照字段

| 配置 | 最终与原值一致 |
|---|---|
| wifi_night | 是 |
| roaming | 是 |
| traffic | 是 |
| wifi | 是 |
| guest | 是 |
| mac_filter | 是 |
| ip_filter | 是 |
| port_forward | 是 |
| port_map | 是 |
| wifi_advanced | 是 |

这些检查只证明所列字段的本次回读，不证明所有配置、所有参数组合、关闭/开启功能或长期运行行为均通过。

## 证据

- [本轮汇总及逐字段对照](../../reports/live/writes-developer-after-reboot-2026-10-20/summary.json)
- [13 次主测试请求及回读](../../reports/live/writes-developer-after-reboot-2026-10-20/write-results.json)
- [高级 WiFi 第 14 次请求](../../reports/live/writes-developer-after-reboot-2026-10-20/advanced-current-value.json)
- [原始配置基线](../../reports/live/writes-developer-after-reboot-2026-10-20/baselines-native.json)
- [最终字段和网页状态](../../reports/live/writes-developer-after-reboot-2026-10-20/final-state.json)
- [标准开发者认证验证](../../reports/live/writes-developer-after-reboot-2026-10-20/native-developer-auth.json)
- [CGI Cookie 兼容性检查](../../reports/live/writes-developer-after-reboot-2026-10-20/native-cookie-compatibility.json)
- [本地回归日志](../../reports/mock/native-auth-regression.log)

复测脚本：live-expanded-writes.mjs --apply、live-advanced-wifi-current.mjs --apply 会进行真实写操作，只在再次获准且基线可用时执行。所有实际凭据仅通过进程环境提供，未写入源代码或报告。
