# 2026-10-20 独立 MCP 实机写工具测试

> 后续修复已完成信号记录、电话本、重启计划参数契约及原生登录等复测；最新结论见 [接口修复报告](WRITE_INTERFACE_FIXES_2026-10-20.md)。以下保留修复前的 39 次调用记录。

本轮向实机提交 **39 次 MCP 写调用，覆盖 28/76 个普通写工具**。其余 48 个未实际提交。失败响应、原值提交与模拟结果不算完整功能通过。

## 结论

- changed_and_restored：5 种工具。
- not_executed：48 种工具。
- failed_or_rejected：15 种工具。
- same_value_only：4 种工具。
- acknowledged_only：3 种工具。
- loopback_verified：1 种工具。

实际变更并恢复：2.4G/5G 主 WiFi 分别关闭再恢复；两个访客频段分别开启再恢复；APN4 新增再删除；URL 过滤规则新增再删除。均逐项回读，测试数据使用随机唯一名称，只删除本轮创建的条目。管理路由已确认走以太网。测试结束没有待清理条目，设备信息查询仍成功。

漫游、流量、网络类型及 SIM 选择仅提交原值并回读。夜间 WiFi 虽返回 verified_fields，但 submissionOutcome=error_but_state_confirmed，严格记为失败/告警；未把字段仍等于原值当作写入成功。

最终通过新的标准 UBUS 认证复核，10 项查询全部 returned，设备上联 reading.uplink=connected。网页旧会话续期返回 HTTP 500，页面查询暂不可用；这是仍未解决的登录异常，不能把网页状态误判为设备离线，也未宣称网页服务恢复。最终配置对照见 final-device.json 的 restorationChecks。

重启工具已真实提交，HTTP 403，未因此重启。CGI 官方登录仍 HTTP 500；标准 UBUS 管理员→开发者验证→superadmin 认证成功，但原生会话的 CGI 写入口仍返回 403。没有更改 ACL 或用底层重启命令代替被测工具。

信号记录和电话本写入返回业务告警，未产生专用条目，因此未编辑/删除既有数据。备份检查返回业务告警，不能视为有效备份。未执行刷机、恢复出厂、真实卡 PIN/PUK 或短信发送：缺失资源见下表。

## 参数契约发现

当前实机只读 UBUS 签名显示：信号记录还有 sigal/index/qos；电话本还有 email/numb_house/numb/numb_work/flag；双频 WiFi 还有 Unity。当前封装未暴露这些字段。签名不说明是否必填，只能确认契约差异，不能断言它们就是业务告警的唯一根因。尚未修改这些生产接口契约。

## 逐工具结果

| 工具 | 实机分类 | 写调用数 | 结果或缺失前提 |
|---|---|---:|---|
| t830_set_wifi_switch | changed_and_restored | 6 | 实际变更、回读及恢复通过 |
| t830_set_wifi_config | not_executed | 0 | 缺少完整可恢复原值 |
| t830_set_guest_switch | changed_and_restored | 6 | 实际变更、回读及恢复通过 |
| t830_set_guest_config | not_executed | 0 | 缺少完整可恢复原值 |
| t830_set_wifi_night | failed_or_rejected | 1 | 写入返回告警；原值仍匹配不能当作成功 |
| t830_set_apn_save | changed_and_restored | 1 | 实际变更、回读及恢复通过 |
| t830_set_roaming | same_value_only | 1 | 仅原值提交及回读，未验证实际切换功能 |
| t830_set_upnp | failed_or_rejected | 1 | HTTP_403 |
| t830_set_dns | not_executed | 0 | 基线不可用：HTTP_403 |
| t830_set_gps | not_executed | 0 | 基线不可用：原值无效 |
| t830_set_traffic | same_value_only | 1 | 仅原值提交及回读，未验证实际切换功能 |
| t830_set_setup_save | not_executed | 0 | 缺少完整可恢复原值 |
| t830_set_login | failed_or_rejected | 1 | HTTP_500 |
| t830_set_logout | acknowledged_only | 1 | 接口确认，尚未验证完整业务效果 |
| t830_set_password | not_executed | 0 | 缺少完整可恢复原值 |
| t830_set_wps_pbc | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_wps_pin | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_wifi_advanced | failed_or_rejected | 1 | [{"field":"5G.code","value":"409"},{"field":"2.4G.code","value":"409"}] |
| t830_set_workmode | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_wifi_scan_start | failed_or_rejected | 1 | HTTP_403 |
| t830_set_wifi_scan_list | failed_or_rejected | 1 | HTTP_403 |
| t830_set_wifi_router_connect | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_wifi_router_disconnect | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_mesh_role | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_mesh_close | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_mesh_router_name | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_mesh_onboard | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_mesh_router_remove | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_client_name | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_client_delete | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_firmware_upload | not_executed | 0 | 缺少匹配硬件的有效固件及失败恢复材料 |
| t830_set_firmware_upgrade | not_executed | 0 | 缺少匹配硬件的有效固件及失败恢复材料 |
| t830_set_reboot | failed_or_rejected | 1 | HTTP_403 |
| t830_set_factory_reset | not_executed | 0 | 缺少已验证可恢复的配置备份和复位后重连材料 |
| t830_set_sim_slot | same_value_only | 1 | 仅原值提交及回读，未验证实际切换功能 |
| t830_set_pin_verify | not_executed | 0 | 缺少可控测试卡及正确 PIN/PUK |
| t830_set_puk_unblock | not_executed | 0 | 缺少可控测试卡及正确 PIN/PUK |
| t830_set_pin_enable | not_executed | 0 | 缺少可控测试卡及正确 PIN/PUK |
| t830_set_pin_disable | not_executed | 0 | 缺少可控测试卡及正确 PIN/PUK |
| t830_set_pin_change | not_executed | 0 | 缺少可控测试卡及正确 PIN/PUK |
| t830_set_network_mode | same_value_only | 1 | 仅原值提交及回读，未验证实际切换功能 |
| t830_set_apn_remove | changed_and_restored | 1 | 实际变更、回读及恢复通过 |
| t830_set_band_lock | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_plmn_lock | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_plmn_unlock | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_mac_filter_mode | failed_or_rejected | 1 | HTTP_403 |
| t830_set_mac_filter_rule | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_ip_filter_mode | failed_or_rejected | 1 | HTTP_403 |
| t830_set_ip_filter_rule | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_port_forward_switch | failed_or_rejected | 1 | HTTP_403 |
| t830_set_port_forward_rule | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_port_map_switch | failed_or_rejected | 1 | HTTP_403 |
| t830_set_port_map_rule | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_url_filter_rule | changed_and_restored | 2 | 实际变更、回读及恢复通过 |
| t830_set_dmz | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_alg | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_dhcp | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_static_ip | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_ntp | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_reboot_schedule | failed_or_rejected | 1 | UBUS_ERROR_5_NO_DATA |
| t830_set_signal_start | acknowledged_only | 1 | 接口确认，尚未验证完整业务效果 |
| t830_set_signal_record | failed_or_rejected | 1 | [{"field":"code","value":"2"}] |
| t830_set_signal_record_edit | not_executed | 0 | 专用测试条目创建失败，没有可安全编辑/删除的测试索引 |
| t830_set_signal_record_delete | not_executed | 0 | 专用测试条目创建失败，没有可安全编辑/删除的测试索引 |
| t830_set_tr069 | not_executed | 0 | 缺少完整可恢复原值 |
| t830_set_developer_login | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_developer_verify | acknowledged_only | 1 | 接口确认，尚未验证完整业务效果 |
| t830_set_net_probe | loopback_verified | 1 | 本机 Ping 完成，收发相等且 0% 丢包 |
| t830_set_sms_center | not_executed | 0 | 尚未具备完整基线、业务前提或可靠恢复方案 |
| t830_set_sms_delete | not_executed | 0 | 缺少专用测试短信及精确删除目标 |
| t830_set_sms_send | not_executed | 0 | 未提供授权接收号码及测试短信内容 |
| t830_set_phonebook_write | failed_or_rejected | 1 | [{"field":"code","value":"5"}] |
| t830_set_phonebook_delete | not_executed | 0 | 专用测试条目创建失败，没有可安全编辑/删除的测试索引 |
| t830_set_backup_check | failed_or_rejected | 1 | [{"field":"code","value":1}] |
| t830_set_backup_restore | not_executed | 0 | 缺少有效专用备份包及恢复后的验证基线 |
| t830_set_backup_delete | not_executed | 0 | 缺少有效专用备份包及恢复后的验证基线 |

## 原始证据与复测

- [independent-mcp.json](../../reports/live/systematic-writes-2026-10-20/independent-mcp.json)
- [crud.json](../../reports/live/systematic-writes-2026-10-20/crud.json)
- [wifi-switches.json](../../reports/live/systematic-writes-2026-10-20/wifi-switches.json)
- [remaining.json](../../reports/live/systematic-writes-2026-10-20/remaining.json)
- [final-device.json](../../reports/live/systematic-writes-2026-10-20/final-device.json)
- [real-summary.json](../../reports/live/systematic-writes-2026-10-20/real-summary.json)

凭据仅通过进程环境提供并清除，不写源码、报告或 .env。复测入口：

```powershell
.\scripts\systematic-live-writes.ps1 --reboot
node scripts/systematic-live-crud.mjs --apply
node scripts/systematic-live-switches.mjs --apply --wired-management-confirmed
node scripts/systematic-live-remaining.mjs --apply
```

后面三个脚本需要调用进程已配置 T830_PASSWORD、可选 T830_DEVELOPER_KEY 以及 T830_AUTH_TRANSPORT=ubus。执行无线切换前必须重新确认有线管理路由。--reboot 只调用一次被封装的重启工具，不在失败后换其他命令重启。
