# 2026-10-20 失败查询排查与项目侧修正

后续更新：用户提供开发者密钥后已完成 superadmin 授权，查询结果更新为 52 正常、3 业务告警、3 失败，详见[开发者权限复测](DEVELOPER_ACCESS_2026-10-20.md)。以下保留普通管理员基线。

## 实际结果

项目侧修正已完成并重载网页服务，但本轮实机仍为 **58 项查询中 37 项返回、21 项失败**。没有把错误改成成功，也未改变设备 ACL、固件、密码、网络模式或其他配置。

## 修正内容

- CGI `flag` 原先使用 Agent section，例如 mesh_role、dns、version；现按设备自己的前端 `/assets/index-CR_moC_F.js` 使用 get_mesh_role、get_dns_protection、upgradeSet 等标识，并修正对应 CGI 写入口标识。已知 first/second 扫描标识仍优先保留。
- MCP 失败返回新增结构化 failure，含中文原因、下一步、证据类型和禁止重复同一请求的建议；保留原始 error/isError、完整诊断及原有 rootCause。
- 区分确认的接口权限拒绝、证据不足的访问拒绝、无数据、对象不存在、HTTP 403 和未知原因。对象不存在不解释为密码错误；403 不直接解释为管理员 ACL；无数据也不解释为权限拒绝。
- Agent 提示词同步使用这些诊断。网页服务已重载，未执行或批准原有待确认写提案。

## 实机证据与未解决项

先读取设备官方网页脚本，再以同一管理员会话、Cookie、Bearer、Origin、Referer 和网页接口 flag 对 21 项失败查询逐一复核，均仍失败。未尝试其他账号、提权或绕过访问限制。

| 本轮故障类别 | 数量 | 下一步 |
|---|---:|---|
| http_forbidden | 3 | setup、gps、diagnose 路径被设备拒绝；核对固件路由与访问限制，不能仅凭 403 断言根因。 |
| permission_denied | 16 | 目标 access=false、对照接口可用：需设备管理员/厂商核对当前账号 ACL 后复测。 |
| no_data | 1 | 上游 WLAN 查询 access=true，但返回 NO_DATA；需确认实际功能配置与模式，不自动切换模式。 |
| object_not_found | 1 | 101 Share 返回 Object not found；需厂商确认当前固件服务是否存在，不能推断永久不支持。 |

这些条件不能通过修改客户端参数或增加重试次数解除。继续恢复实际功能需要设备管理员或厂商提供正确的接口授权、已启用服务或对应固件信息；当前环境中没有这些材料。

| 工具 | 实机结果 | 分类 |
|---|---|---|
| t830_get_setup | HTTP_403 | http_forbidden |
| t830_get_wifi_ad | RPC_ERROR_-32002 | permission_denied |
| t830_get_wifi_night | RPC_ERROR_-32002 | permission_denied |
| t830_get_wifi_rt | UBUS_ERROR_5_NO_DATA | no_data |
| t830_get_sim_slot | RPC_ERROR_-32002 | permission_denied |
| t830_get_roaming | RPC_ERROR_-32002 | permission_denied |
| t830_get_static_ip | RPC_ERROR_-32002 | permission_denied |
| t830_get_ntp | RPC_ERROR_-32002 | permission_denied |
| t830_get_reboot_schedule | RPC_ERROR_-32002 | permission_denied |
| t830_get_signal_records | RPC_ERROR_-32002 | permission_denied |
| t830_get_tr069 | RPC_ERROR_-32002 | permission_denied |
| t830_get_gps | HTTP_403 | http_forbidden |
| t830_get_diagnose | HTTP_403 | http_forbidden |
| t830_get_share | RPC_ERROR_-32000 | object_not_found |
| t830_get_ping_result | RPC_ERROR_-32002 | permission_denied |
| t830_get_sms_all | RPC_ERROR_-32002 | permission_denied |
| t830_get_sms_center | RPC_ERROR_-32002 | permission_denied |
| t830_get_sms_thread | RPC_ERROR_-32002 | permission_denied |
| t830_get_sms_report | RPC_ERROR_-32002 | permission_denied |
| t830_get_phonebook | RPC_ERROR_-32002 | permission_denied |
| t830_get_phonebook_select | RPC_ERROR_-32002 | permission_denied |

## 验证

- 完整本地模拟回归：183 项通过，0 失败。新增断言验证 CGI 请求标识、结构化 MCP 错误分类、权限证据不足时不武断判断，以及不重复无权限目标请求。
- 修改后全部 58 项查询真实复测：37 returned、21 error、0 device_warning。
- 重载后仪表盘 HTTP 200、available=true、online=true，六个基础查询全部 returned，UPnP 为原值 0。
- 本轮实机修改配置次数：0。

## 原始证据

- [网页格式逐项复核](../../reports/diagnostics/failed-read-browser-parity-2026-10-20.json)
- [修正后 58 项实机复测](../../reports/live/all-tools-2026-10-20/after-fix.json)
- [重载后的仪表盘检查](../../reports/live/all-tools-2026-10-20/after-fix-dashboard.json)
- [完整模拟回归日志](../../reports/mock/failed-read-fix-regression.log)

复测脚本：`scripts/diagnose-failed-reads.mjs` 与 `scripts/retest-failed-reads.mjs`。均只读，密码仅通过进程环境提供。
