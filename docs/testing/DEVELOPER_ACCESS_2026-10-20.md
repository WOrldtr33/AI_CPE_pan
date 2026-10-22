# 2026-10-20 开发者授权与实机复测

用户明确提供开发者密钥并授权用于当前设备。密钥、派生临时密码、token 和 Cookie 均不写入本报告。原来的管理员测试记录保持为历史基线。

## 结果

| 查询状态 | 普通管理员 | 开发者会话 |
|---|---:|---:|
| 正常 returned | 37 | 52 |
| 业务告警 device_warning | 0 | 3 |
| 失败 error | 21 | 3 |

此前确认权限拒绝的 16 个查询全部已解除权限拒绝。共 18 个原失败查询变为返回或业务告警，不把业务告警算为功能验证成功。

40 个 UBUS 写工具在开发者会话中 `session.access=true`，0 项拒绝；36 个 CGI 写工具不适用此权限探测。这里只证明权限，**没有执行这 76 个写工具**。原先用户选择的“仅可恢复测试”范围继续有效。

## 当前仍未成功的项目

| 工具 | 结果 | 说明 |
|---|---|---|
| t830_get_setup | HTTP_403 | 初始化路径仍被设备拒绝，根因未确认；不重置设备以制造初始化条件 |
| t830_get_wifi_rt | UBUS_ERROR_5_NO_DATA | 权限允许但无上游 WLAN 数据；不自动切换工作模式 |
| t830_get_share | Object not found | 固件报告 cpe-ctrl 对象不存在，需核对固件服务 |
| t830_get_gps | device_warning，code=-1 | 已可调用，但业务结果告警，不猜测未知业务码 |
| t830_get_ping_result | device_warning，code="1" | 已可调用，但本轮没有启动网络探测任务 |
| t830_get_phonebook_select | device_warning，code="5" | 样例条目查询为业务告警，不猜测未知业务码 |

## 登录实现

设备自己的网页实际执行：管理员登录 → gen.attr/check_asymmetric_verify 校验密钥并获取临时密码 → 用 SHA256(salt:临时密码) 登录 superadmin。仅执行验证不会改变已有管理员会话的身份，未调用文档中的空参数 set_develop_mode 代替这一实际流程。

项目现通过可选的进程环境 T830_DEVELOPER_KEY 完成此流程；会话续期同样重新授权。验证失败会清除普通管理员会话，后续调用继续失败，不以较低权限继续。未配置密钥时仍使用原有管理员流程。

推荐启动命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1 --developer --web
```

脚本隐藏输入管理员密码与开发者密钥；当前后台服务已传入密钥并重载。密钥仅存在于运行进程环境与内存中，未永久保存，下次新启动需重新输入。写操作仍需逐次确认。

## 网页与回归

- 本地完整自动测试：186 项通过，0 失败。验证双阶段登录、续期、密钥拒绝后的多次调用均停止、密钥脱敏，以及高级 WiFi 大响应处理。
- 发现高级 WiFi 返回约 46 KB 的国家/信道列表，可能使模型对话达到字符上限。传给模型时仅省略超长候选列表并显式注明，page_info 当前配置完整保留；完整原始结果仍留在本地任务记录。
- 当前网页→真实模型→真实 MCP→真实设备联调：t830_query(section=wifi_ad,args={}) 返回 returned，模型 answered，调用 1 次。
- 最终仪表盘 HTTP 200、available=true、online=true，6 个基础查询均 returned，UPnP 保持原值 0。未批准现有待确认提案，未执行重启、恢复出厂、固件或网络配置变更。

## 全部查询复测

| 工具 | 开发者会话结果 | 错误 |
|---|---|---|
| t830_get_first_setup | returned | — |
| t830_get_setup | error | HTTP_403 |
| t830_get_country | returned | — |
| t830_get_wifi | returned | — |
| t830_get_guest | returned | — |
| t830_get_wps | returned | — |
| t830_get_wps_run | returned | — |
| t830_get_wifi_ad | returned | — |
| t830_get_wifi_night | returned | — |
| t830_get_workmode | returned | — |
| t830_get_wifi_rt | error | UBUS_ERROR_5_NO_DATA |
| t830_get_mesh_status | returned | — |
| t830_get_mesh_role | returned | — |
| t830_get_mesh_routers | returned | — |
| t830_get_clients | returned | — |
| t830_get_status | returned | — |
| t830_get_device_info | returned | — |
| t830_get_device | returned | — |
| t830_get_version | returned | — |
| t830_get_sim_presence | returned | — |
| t830_get_sim_slot | returned | — |
| t830_get_sim | returned | — |
| t830_get_network_mode | returned | — |
| t830_get_apn | returned | — |
| t830_get_cells | returned | — |
| t830_get_band_lock | returned | — |
| t830_get_roaming | returned | — |
| t830_get_mac_filter | returned | — |
| t830_get_ip_filter | returned | — |
| t830_get_port_forward | returned | — |
| t830_get_port_map | returned | — |
| t830_get_url_filter | returned | — |
| t830_get_upnp | returned | — |
| t830_get_dmz | returned | — |
| t830_get_alg | returned | — |
| t830_get_dns | returned | — |
| t830_get_dhcp | returned | — |
| t830_get_static_ip | returned | — |
| t830_get_ntp | returned | — |
| t830_get_time | returned | — |
| t830_get_reboot_schedule | returned | — |
| t830_get_signal_records | returned | — |
| t830_get_tr069 | returned | — |
| t830_get_gps | device_warning | — |
| t830_get_developer_mode | returned | — |
| t830_get_traffic | returned | — |
| t830_get_diagnose | returned | — |
| t830_get_share | error | RPC_ERROR_-32000 |
| t830_get_login_status | returned | — |
| t830_get_ping_result | device_warning | — |
| t830_get_sms_all | returned | — |
| t830_get_sms_center | returned | — |
| t830_get_sms_thread | returned | — |
| t830_get_sms_report | returned | — |
| t830_get_sms_unread | returned | — |
| t830_get_phonebook | returned | — |
| t830_get_phonebook_select | device_warning | — |
| t830_get_log_url | returned | — |

## 原始证据

- [密钥验证及 superadmin 登录结果](../../reports/live/all-tools-2026-10-20/developer-authorization.json)
- [全部查询与权限预检](../../reports/live/all-tools-2026-10-20/developer-full.json)
- [单会话写权限复核](../../reports/live/all-tools-2026-10-20/developer-write-permissions.json)
- [网页联调及在线检查](../../reports/live/all-tools-2026-10-20/developer-web-validation.json)
- [完整本地回归日志](../../reports/mock/developer-auth-regression.log)
