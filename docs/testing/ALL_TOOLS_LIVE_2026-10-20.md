# 2026-10-20 全部 T830 MCP 工具实机验证

后续更新：用户提供开发者密钥后已完成 superadmin 授权，查询结果更新为 52 正常、3 业务告警、3 失败，详见[开发者权限复测](DEVELOPER_ACCESS_2026-10-20.md)。以下保留普通管理员基线。

测试对象：当前真实设备 `192.168.0.1`；使用现有管理员凭据。密码、Cookie、token 不写入报告，短信和电话本正文不保存。日期按 Asia/Shanghai。

## 结果

发现 138 个设备工具：58 个独立查询、76 个普通写工具、3 个辅助查询及 1 个 UPnP 验证兼容工具。媒体的 13 个工具不属于本轮设备接口测试。

- 全部 58 个独立查询均真实调用：37 项 returned、21 项 error、0 项业务告警。returned 仅证明本次参数下返回并通过现有校验；部分接口只具备基础结构校验，不能视为厂商完整 schema 或所有功能通过。
- 全部 76 个普通写工具均发现、样例 schema 有效。40 个 UBUS 写工具中 session.access=true 18 项、false 22 项；36 个 CGI 写工具不适用这一权限检查。权限检查不能代替执行或证明配置生效。
- 5 个不同写工具共实际提交 8 次，全部回读验证通过。UPnP 与 DNS 均完成 0→1→0 并确认恢复；双频 WiFi 和双频访客 WiFi 各提交一次原值，不测试关停后重启。
- 其余 72 个普通写工具未提交。用户明确选择只完成可恢复测试，原因逐项列于下表；未执行不计为通过。
- 网页→真实模型→MCP→真实设备链路通过：本次固件查询调用 1 次工具。测试结束仪表盘 available=true、online=true，六项基础查询全部 returned，UPnP 为原值 0。

## 可恢复写操作

| 工具 | 实际调用次数 | 验证范围 |
|---|---:|---|
| t830_set_upnp_verified | 1 | UPnP 0→1，原值检查和回读通过 |
| t830_set_upnp | 1 | 恢复 1→0，回读通过 |
| t830_set_dns | 2 | DNS 重绑定保护 0→1→0，均回读通过 |
| t830_set_wifi_switch | 2 | 2.4G/5G 分别提交当前原值，回读通过 |
| t830_set_guest_switch | 2 | Guest/Guest5G 分别提交当前原值，回读通过 |

## 全部查询结果

| API | 工具 | 本次结果 | 错误 |
|---|---|---|---|
| 1 | t830_get_first_setup | returned | — |
| 2 | t830_get_setup | error | HTTP_403 |
| 8 | t830_get_country | returned | — |
| 9 | t830_get_wifi | returned | — |
| 12 | t830_get_guest | returned | — |
| 15 | t830_get_wps | returned | — |
| 16 | t830_get_wps_run | returned | — |
| 19 | t830_get_wifi_ad | error | RPC_ERROR_-32002 |
| 21 | t830_get_wifi_night | error | RPC_ERROR_-32002 |
| 23 | t830_get_workmode | returned | — |
| 25 | t830_get_wifi_rt | error | UBUS_ERROR_5_NO_DATA |
| 30 | t830_get_mesh_status | returned | — |
| 31 | t830_get_mesh_role | returned | — |
| 34 | t830_get_mesh_routers | returned | — |
| 38 | t830_get_clients | returned | — |
| 41 | t830_get_status | returned | — |
| 42 | t830_get_device_info | returned | — |
| 43 | t830_get_device | returned | — |
| 44 | t830_get_version | returned | — |
| 49 | t830_get_sim_presence | returned | — |
| 50 | t830_get_sim_slot | error | RPC_ERROR_-32002 |
| 52 | t830_get_sim | returned | — |
| 58 | t830_get_network_mode | returned | — |
| 60 | t830_get_apn | returned | — |
| 63 | t830_get_cells | returned | — |
| 63 | t830_get_band_lock | returned | — |
| 67 | t830_get_roaming | error | RPC_ERROR_-32002 |
| 69 | t830_get_mac_filter | returned | — |
| 72 | t830_get_ip_filter | returned | — |
| 75 | t830_get_port_forward | returned | — |
| 78 | t830_get_port_map | returned | — |
| 81 | t830_get_url_filter | returned | — |
| 83 | t830_get_upnp | returned | — |
| 85 | t830_get_dmz | returned | — |
| 87 | t830_get_alg | returned | — |
| 89 | t830_get_dns | returned | — |
| 91 | t830_get_dhcp | returned | — |
| 94 | t830_get_static_ip | error | RPC_ERROR_-32002 |
| 95 | t830_get_ntp | error | RPC_ERROR_-32002 |
| 97 | t830_get_time | returned | — |
| 98 | t830_get_reboot_schedule | error | RPC_ERROR_-32002 |
| 101 | t830_get_signal_records | error | RPC_ERROR_-32002 |
| 105 | t830_get_tr069 | error | RPC_ERROR_-32002 |
| 107 | t830_get_gps | error | HTTP_403 |
| 109 | t830_get_developer_mode | returned | — |
| 112 | t830_get_traffic | returned | — |
| 114 | t830_get_diagnose | error | HTTP_403 |
| 128 | t830_get_share | error | RPC_ERROR_-32000 |
| 4 | t830_get_login_status | returned | — |
| 116 | t830_get_ping_result | error | RPC_ERROR_-32002 |
| 117 | t830_get_sms_all | error | RPC_ERROR_-32002 |
| 117 | t830_get_sms_center | error | RPC_ERROR_-32002 |
| 118 | t830_get_sms_thread | error | RPC_ERROR_-32002 |
| 122 | t830_get_sms_report | error | RPC_ERROR_-32002 |
| 123 | t830_get_sms_unread | returned | — |
| 124 | t830_get_phonebook | error | RPC_ERROR_-32002 |
| 125 | t830_get_phonebook_select | error | RPC_ERROR_-32002 |
| 129 | t830_get_log_url | returned | — |

21 项查询失败中：16 项 RPC_ERROR_-32002（权限拒绝）、3 项 HTTP_403、1 项 UBUS_ERROR_5_NO_DATA、1 项 RPC_ERROR_-32000。无数据或 RPC_ERROR_-32000 不能仅凭该返回猜测根因。

## 全部普通写工具覆盖与限制

| API | 工具 | 权限预检 | 执行/限制 |
|---|---|---|---|
| 10 | t830_set_wifi_switch | access=true | 真实写入并回读验证通过 |
| 11 | t830_set_wifi_config | access=true | SSID/密钥已脱敏，无法可靠完整恢复，未执行 |
| 13 | t830_set_guest_switch | access=true | 真实写入并回读验证通过 |
| 14 | t830_set_guest_config | access=true | SSID/密钥已脱敏，无法可靠完整恢复，未执行 |
| 22 | t830_set_wifi_night | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 61 | t830_set_apn_save | access=true | 未具备完整原值/恢复证据，未提交样例配置 |
| 68 | t830_set_roaming | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 84 | t830_set_upnp | not_checked | 真实写入并回读验证通过 |
| 90 | t830_set_dns | not_checked | 真实写入并回读验证通过 |
| 108 | t830_set_gps | not_checked | 回读不可用，无法证明恢复，未执行 |
| 113 | t830_set_traffic | access=false | 未具备完整原值/恢复证据，未提交样例配置；UBUS access=false |
| 3 | t830_set_setup_save | not_checked | 高影响、凭据变更或数据风险，按用户选择未执行 |
| 5 | t830_set_login | not_checked | 登录已由查询链路验证，未单独提交登录/退出工具以免影响当前会话 |
| 6 | t830_set_logout | not_checked | 登录已由查询链路验证，未单独提交登录/退出工具以免影响当前会话 |
| 7 | t830_set_password | not_checked | 高影响、凭据变更或数据风险，按用户选择未执行 |
| 17 | t830_set_wps_pbc | access=true | 未具备完整原值/恢复证据，未提交样例配置 |
| 18 | t830_set_wps_pin | access=true | 未具备完整原值/恢复证据，未提交样例配置 |
| 20 | t830_set_wifi_advanced | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 24 | t830_set_workmode | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 26 | t830_set_wifi_scan_start | not_checked | 当前工作模式相关查询无数据，不发起扫描 |
| 27 | t830_set_wifi_scan_list | not_checked | 当前工作模式相关查询无数据，不发起扫描 |
| 28 | t830_set_wifi_router_connect | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 29 | t830_set_wifi_router_disconnect | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 32 | t830_set_mesh_role | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 33 | t830_set_mesh_close | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 35 | t830_set_mesh_router_name | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 36 | t830_set_mesh_onboard | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 37 | t830_set_mesh_router_remove | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 39 | t830_set_client_name | access=true | 未具备完整原值/恢复证据，未提交样例配置 |
| 40 | t830_set_client_delete | access=true | 未具备完整原值/恢复证据，未提交样例配置 |
| 45 | t830_set_firmware_upload | not_checked | 高影响、凭据变更或数据风险，按用户选择未执行 |
| 46 | t830_set_firmware_upgrade | not_checked | 高影响、凭据变更或数据风险，按用户选择未执行 |
| 47 | t830_set_reboot | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 48 | t830_set_factory_reset | not_checked | 高影响、凭据变更或数据风险，按用户选择未执行 |
| 51 | t830_set_sim_slot | access=false | 可能断网、改动组网/蜂窝或现有配置，未执行；UBUS access=false |
| 53 | t830_set_pin_verify | access=true | 需真实 PIN/PUK，尝试可能锁卡，未执行 |
| 54 | t830_set_puk_unblock | access=true | 需真实 PIN/PUK，尝试可能锁卡，未执行 |
| 55 | t830_set_pin_enable | access=false | 需真实 PIN/PUK，尝试可能锁卡，未执行；UBUS access=false |
| 56 | t830_set_pin_disable | access=false | 需真实 PIN/PUK，尝试可能锁卡，未执行；UBUS access=false |
| 57 | t830_set_pin_change | access=false | 需真实 PIN/PUK，尝试可能锁卡，未执行；UBUS access=false |
| 59 | t830_set_network_mode | access=true | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 62 | t830_set_apn_remove | access=true | 未具备完整原值/恢复证据，未提交样例配置 |
| 64 | t830_set_band_lock | access=false | 可能断网、改动组网/蜂窝或现有配置，未执行；UBUS access=false |
| 65 | t830_set_plmn_lock | access=false | 可能断网、改动组网/蜂窝或现有配置，未执行；UBUS access=false |
| 66 | t830_set_plmn_unlock | access=false | 可能断网、改动组网/蜂窝或现有配置，未执行；UBUS access=false |
| 70 | t830_set_mac_filter_mode | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 71 | t830_set_mac_filter_rule | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 73 | t830_set_ip_filter_mode | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 74 | t830_set_ip_filter_rule | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 76 | t830_set_port_forward_switch | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 77 | t830_set_port_forward_rule | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 79 | t830_set_port_map_switch | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 80 | t830_set_port_map_rule | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 82 | t830_set_url_filter_rule | access=true | 会修改转发、安全规则或开放服务，未执行 |
| 86 | t830_set_dmz | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 88 | t830_set_alg | not_checked | 会修改转发、安全规则或开放服务，未执行 |
| 92 | t830_set_dhcp | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 93 | t830_set_static_ip | not_checked | 可能断网、改动组网/蜂窝或现有配置，未执行 |
| 96 | t830_set_ntp | not_checked | 回读不可用，无法证明恢复，未执行 |
| 99 | t830_set_reboot_schedule | access=false | 可能断网、改动组网/蜂窝或现有配置，未执行；UBUS access=false |
| 100 | t830_set_signal_start | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 102 | t830_set_signal_record | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 103 | t830_set_signal_record_edit | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 104 | t830_set_signal_record_delete | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 106 | t830_set_tr069 | not_checked | 回读不可用，无法证明恢复，未执行 |
| 110 | t830_set_developer_login | not_checked | 登录已由查询链路验证，未单独提交登录/退出工具以免影响当前会话 |
| 111 | t830_set_developer_verify | access=true | 缺少验证材料，不改变开发者模式 |
| 115 | t830_set_net_probe | access=false | 回读不可用，无法证明恢复，未执行；UBUS access=false |
| 119 | t830_set_sms_center | access=false | 涉及号码、正文或条目，可能发送消息/改删数据，未执行；UBUS access=false |
| 120 | t830_set_sms_delete | access=false | 涉及号码、正文或条目，可能发送消息/改删数据，未执行；UBUS access=false |
| 121 | t830_set_sms_send | access=false | 涉及号码、正文或条目，可能发送消息/改删数据，未执行；UBUS access=false |
| 126 | t830_set_phonebook_write | access=false | 涉及号码、正文或条目，可能发送消息/改删数据，未执行；UBUS access=false |
| 127 | t830_set_phonebook_delete | access=false | 涉及号码、正文或条目，可能发送消息/改删数据，未执行；UBUS access=false |
| 130 | t830_set_backup_check | access=true | 回读不可用，无法证明恢复，未执行 |
| 131 | t830_set_backup_restore | access=true | 高影响、凭据变更或数据风险，按用户选择未执行 |
| 132 | t830_set_backup_delete | access=true | 高影响、凭据变更或数据风险，按用户选择未执行 |

## 辅助工具与模型链路

- t830_list_capabilities：returned。
- t830_query：returned。
- t830_check_access：returned。
- 网页模型选择 t830_query：{"args":{},"section":"version"}，结果 returned。

本轮没有执行重启、恢复出厂、固件上传/升级、密码修改、PIN/PUK、短信发送、数据删除、网络模式切换或摄像头/麦克风采集。原有待确认提案未批准。

## 证据与复测

- [逐项原始证据](../../reports/live/all-tools-2026-10-20/results.json)
- `node scripts/live-all-tools.mjs`：58 项真实查询、3 项辅助查询、76 项写工具注册/schema/权限预检；不写配置。
- `node scripts/live-controlled-tools.mjs`：显式运行会提交本报告列出的可恢复写操作，读取最新原值并尝试恢复；执行前应确保用户授权、设备空闲且基线可用。
- 运行时仅通过进程环境提供 `T830_PASSWORD`，脚本不包含凭据。多次 MCP 登录可能更新会话；最终已通过现有网页进程重新查询，确认服务正常。
