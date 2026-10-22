# T830 接口接入清单

此清单由 `node scripts/catalog.mjs` 生成。分类是开发范围，**不是实机成功声明**。查询无 SIM 状态与验证蜂窝上网是两回事。

## 已封装只读接口

| API | 分组 | section | MCP 工具 | 功能及前提 |
|---|---|---|---|---|
| 1 | system | first_setup | t830_get_first_setup | 初始化状态；无需 SIM，读取设备状态或已保存配置 |
| 2 | system | setup | t830_get_setup | 初始化配置；无需 SIM，读取设备状态或已保存配置 |
| 8 | system | country | t830_get_country | 国家编码；无需 SIM，读取设备状态或已保存配置 |
| 9 | wifi | wifi | t830_get_wifi | 双频 WiFi 配置；无需 SIM，读取设备状态或已保存配置 |
| 12 | wifi | guest | t830_get_guest | 访客 WiFi 配置；无需 SIM，读取设备状态或已保存配置 |
| 15 | wifi | wps | t830_get_wps | WPS 配置；无需 SIM，读取设备状态或已保存配置 |
| 16 | wifi | wps_run | t830_get_wps_run | WPS 运行状态；name 为频段名 2.4G/5G（双频合一时为 Unity），不是 ra0 等接口名；obj 为 host/guest。WscStatus=Start WSC Process 表示进行中，其余（Idle、Timed-out 等）为已结束；WscResult=1 表示配对成功 |
| 19 | wifi | wifi_ad | t830_get_wifi_ad | 高级 WiFi 配置；无需 SIM；仅开发者（superadmin）会话可读 |
| 21 | wifi | wifi_night | t830_get_wifi_night | 夜间 WiFi 设置；无需 SIM，读取设备状态或已保存配置 |
| 23 | network | workmode | t830_get_workmode | 工作模式；无需 SIM，读取设备状态或已保存配置 |
| 25 | network | wifi_rt | t830_get_wifi_rt | 上游 WLAN 路由状态；与 WLAN router 模式和上游连接有关，不是通用路由表 |
| 30 | mesh | mesh_status | t830_get_mesh_status | Mesh 开关；无需 SIM，读取设备状态或已保存配置 |
| 31 | mesh | mesh_role | t830_get_mesh_role | Mesh 角色；无需 SIM，读取设备状态或已保存配置 |
| 34 | mesh | mesh_routers | t830_get_mesh_routers | Mesh 节点；无需 SIM，需要实际组网才有节点 |
| 38 | device | clients | t830_get_clients | 接入设备；无需 SIM，读取设备状态或已保存配置 |
| 41 | device | status | t830_get_status | 设备状态页。reading.uplink 为 connected 表示上联已连接；SimStatus 3 需要 PIN，4 需要 PUK。是否在槽看 sim_presence；无需 SIM，读取设备状态或已保存配置 |
| 42 | device | device_info | t830_get_device_info | 设备基本信息；无需 SIM，读取设备状态或已保存配置 |
| 43 | cellular | device | t830_get_device | 蜂窝设备信息；无 SIM 可返回未注册告警 |
| 44 | device | version | t830_get_version | 固件版本；无需 SIM，读取设备状态或已保存配置 |
| 49 | cellular | sim_presence | t830_get_sim_presence | SIM 在槽状态。reading.state：present=21 在槽可用，absent=0 未插入，unavailable=3 或 4 暂时不可用，abnormal=其他。不代表上联已连接；无需 SIM，读取设备状态或已保存配置 |
| 50 | cellular | sim_slot | t830_get_sim_slot | SIM 插槽配置；无需 SIM，读取设备状态或已保存配置 |
| 52 | cellular | sim | t830_get_sim | SIM 信息；无 SIM 可产生业务告警 |
| 58 | cellular | network_mode | t830_get_network_mode | 蜂窝网络模式；无需 SIM，读取设备状态或已保存配置 |
| 60 | cellular | apn | t830_get_apn | APN 配置，不验证拨号；无需 SIM，读取设备状态或已保存配置 |
| 63 | cellular | cells | t830_get_cells | 小区列表；无 SIM 的小区信息不代表已联网 |
| 63 | cellular | band_lock | t830_get_band_lock | 频段锁定配置；无需 SIM，读取设备状态或已保存配置 |
| 67 | cellular | roaming | t830_get_roaming | 漫游配置；无需 SIM，读取设备状态或已保存配置 |
| 69 | firewall | mac_filter | t830_get_mac_filter | MAC 过滤配置；无需 SIM，读取设备状态或已保存配置 |
| 72 | firewall | ip_filter | t830_get_ip_filter | IP 过滤配置；无需 SIM，读取设备状态或已保存配置 |
| 75 | firewall | port_forward | t830_get_port_forward | 端口转发配置；无需 SIM，读取设备状态或已保存配置 |
| 78 | firewall | port_map | t830_get_port_map | 端口映射配置；无需 SIM，读取设备状态或已保存配置 |
| 81 | firewall | url_filter | t830_get_url_filter | URL 过滤配置；无需 SIM，读取设备状态或已保存配置 |
| 83 | firewall | upnp | t830_get_upnp | UPnP配置；无需 SIM，读取设备状态或已保存配置 |
| 85 | firewall | dmz | t830_get_dmz | DMZ配置；无需 SIM，读取设备状态或已保存配置 |
| 87 | firewall | alg | t830_get_alg | ALG配置；无需 SIM，读取设备状态或已保存配置 |
| 89 | network | dns | t830_get_dns | DNS 保护配置；无需 SIM，读取设备状态或已保存配置 |
| 91 | network | dhcp | t830_get_dhcp | LAN/DHCP 配置；无需 SIM，读取设备状态或已保存配置 |
| 94 | network | static_ip | t830_get_static_ip | 静态 IP 配置；无需 SIM，读取设备状态或已保存配置 |
| 95 | system | ntp | t830_get_ntp | NTP 配置，不验证同步；无需 SIM，读取设备状态或已保存配置 |
| 97 | system | time | t830_get_time | 设备时间；无需 SIM，读取设备状态或已保存配置 |
| 98 | system | reboot_schedule | t830_get_reboot_schedule | 定时重启配置；无需 SIM，读取设备状态或已保存配置 |
| 101 | diagnostics | signal_records | t830_get_signal_records | 已保存信号记录；无需 SIM，读取设备状态或已保存配置 |
| 105 | system | tr069 | t830_get_tr069 | TR069 配置，不验证远端连接；无需 SIM，读取设备状态或已保存配置 |
| 107 | system | gps | t830_get_gps | GPS 开关与定位状态；无需 SIM，读取设备状态或已保存配置 |
| 109 | system | developer_mode | t830_get_developer_mode | 开发者模式状态，不提权；无需 SIM，读取设备状态或已保存配置 |
| 112 | cellular | traffic | t830_get_traffic | 流量统计配置；无需 SIM，读取设备状态或已保存配置 |
| 114 | diagnostics | diagnose | t830_get_diagnose | 诊断信息；无需 SIM，读取设备状态或已保存配置 |
| 128 | system | share | t830_get_share | 101 Share 状态；无需 SIM，读取设备状态或已保存配置 |
| 4 | system | login_status | t830_get_login_status | 登录状态；无需 SIM，读取设备状态或已保存配置 |
| 116 | diagnostics | ping_result | t830_get_ping_result | Ping/Traceroute 结果；先经用户确认调用 t830_set_net_probe 启动诊断，再轮询本工具；code=1 为等待结果，code=0 为完成；addr 固定为 read_ping |
| 117 | sms | sms_all | t830_get_sms_all | 全部短信。同编号批量里的电话本用 phonebook，短信中心用 sms_center；读取设备本地短信，不发送消息 |
| 117 | sms | sms_center | t830_get_sms_center | 短信中心号码；读取设备本地短信配置，不发送消息 |
| 118 | sms | sms_thread | t830_get_sms_thread | 短信会话内容；读取设备本地短信，不发送消息 |
| 122 | sms | sms_report | t830_get_sms_report | 短信发送状态报告；读取设备本地短信报告，不发送消息 |
| 123 | sms | sms_unread | t830_get_sms_unread | 未读短信数；读取设备本地短信，不发送消息 |
| 124 | phonebook | phonebook | t830_get_phonebook | 查询全部电话本或按 name 搜索；type 固定 ALL；读取设备本地电话本，空字符串 data 表示本次无条目 |
| 125 | phonebook | phonebook_select | t830_get_phonebook_select | 按类别或名称筛选电话本；全部查询优先使用 t830_get_phonebook；type 为空或 0/1/2/3（普通/家人/朋友/同事），不能填写 read_book 的 ALL |
| 129 | diagnostics | log_url | t830_get_log_url | 日志下载地址；只返回地址，不解析日志内容 |

## 已封装写接口（默认关闭）

只在 T830_ENABLE_WRITES=1 时注册。11 项已接入写前检查、提交和回读验证；其余写工具只提交一次，不回读。sample 仅供自动测试，不是推荐配置。

| API | 分组 | MCP 工具 | 功能 | 后续回读 section |
|---|---|---|---|---|
| 10 | wifi | t830_set_wifi_switch | WiFi 开关 | wifi |
| 11 | wifi | t830_set_wifi_config | 双频 WiFi 配置（仅所列加密模式）。只填写要修改的频段和字段；未填写的字段（含 SSID、密码）由服务端读取设备当前值合并后整体提交，不需要也不应向用户索要原值。仅把加密方式从 Disable 改为加密时须提供 wpapsk。按频段返回 200 已修改、409 未变化；生效会重启无线，回读在设备忙期间自动等待 | wifi |
| 13 | wifi | t830_set_guest_switch | 访客 WiFi 开关 | guest |
| 14 | wifi | t830_set_guest_config | 访客 WiFi 配置。只填写要修改的频段和字段；未填写的字段（含 SSID、密码）由服务端读取设备当前值合并后整体提交，不需要也不应向用户索要原值。仅把加密方式从 Disable 改为加密时须提供 wpapsk；按频段返回 200 已修改、409 未变化 | guest |
| 22 | wifi | t830_set_wifi_night | 夜间 WiFi 计划 | wifi_night |
| 61 | cellular | t830_set_apn_save | 保存 APN，不验证拨号 | apn |
| 68 | cellular | t830_set_roaming | 漫游开关 | roaming |
| 84 | firewall | t830_set_upnp | UPnP 开关 | upnp |
| 90 | network | t830_set_dns | DNS 重绑定保护 | dns |
| 108 | system | t830_set_gps | GPS 开关 | gps |
| 113 | cellular | t830_set_traffic | 流量限额 | traffic |
| 3 | system | t830_set_setup_save | 提交初始化设置 | setup |
| 5 | system | t830_set_login | 使用已计算的 SHA256(salt:密码) 登录 | none |
| 6 | system | t830_set_logout | 退出当前登录会话 | none |
| 7 | system | t830_set_password | 修改登录密码 | none |
| 17 | wifi | t830_set_wps_pbc | 启动 PBC WPS。name 为频段名 2.4G/5G（双频合一时为 Unity）；设备返回 host/guest[name].code：200 已启动、409 重复、416 参数错误、403 已有 WPS 任务；之后用 t830_get_wps_run 跟踪，无取消接口，未配对时约 2 分钟超时 | wps |
| 18 | wifi | t830_set_wps_pin | 启动 PIN WPS（pincode 为客户端的 4 或 8 位 PIN）。name 与返回码同 t830_set_wps_pbc | wps |
| 20 | wifi | t830_set_wifi_advanced | 提交高级 WiFi 配置。设备按字段返回结果：200 已修改、409 未变化；生效会重启无线，期间再次提交返回 result=500（设备忙），应先回读确认后再提交 | wifi_ad |
| 24 | network | t830_set_workmode | 修改工作模式 | workmode |
| 26 | network | t830_set_wifi_scan_start | 第一次扫描上游 WiFi | wifi_rt |
| 27 | network | t830_set_wifi_scan_list | 第二次读取上游 WiFi 扫描列表 | wifi_rt |
| 28 | network | t830_set_wifi_router_connect | 连接上游 WiFi | wifi_rt |
| 29 | network | t830_set_wifi_router_disconnect | 断开上游 WiFi | wifi_rt |
| 32 | mesh | t830_set_mesh_role | 修改 Mesh 角色 | mesh_role |
| 33 | mesh | t830_set_mesh_close | 关闭 Mesh | mesh_status |
| 35 | mesh | t830_set_mesh_router_name | 修改 Mesh 路由名称 | mesh_routers |
| 36 | mesh | t830_set_mesh_onboard | 发起组网 | mesh_routers |
| 37 | mesh | t830_set_mesh_router_remove | 删除 Mesh 路由 | mesh_routers |
| 39 | device | t830_set_client_name | 修改接入设备名称或联网权限。forbid=on 禁止该设备上网，off 允许；只改名时 forbid 填 t830_get_clients 中的当前值 | clients |
| 40 | device | t830_set_client_delete | 删除接入设备 | clients |
| 45 | system | t830_set_firmware_upload | 上传固件。sessionid 由当前会话注入，不作为参数 | none |
| 46 | system | t830_set_firmware_upgrade | 执行固件升级 | none |
| 47 | system | t830_set_reboot | 重启设备 | none |
| 48 | system | t830_set_factory_reset | 恢复出厂设置 | none |
| 51 | cellular | t830_set_sim_slot | 修改 SIM 选择 | sim_slot |
| 53 | cellular | t830_set_pin_verify | 提交 PIN 验证 | none |
| 54 | cellular | t830_set_puk_unblock | 提交 PUK 解锁 | none |
| 55 | cellular | t830_set_pin_enable | 开启 PIN 锁 | none |
| 56 | cellular | t830_set_pin_disable | 关闭 PIN 锁 | none |
| 57 | cellular | t830_set_pin_change | 修改 PIN | none |
| 59 | cellular | t830_set_network_mode | 设置网络类型：21 自动（5G/4G）、19 5G NSA、15 5G SA、3 仅 4G；切换期间上联会短暂中断 | network_mode |
| 62 | cellular | t830_set_apn_remove | 移除 APN | apn |
| 64 | cellular | t830_set_band_lock | 锁频/锁小区。state：FULL 不锁、multi_band 按 multi_band 列表锁频段、PCI 锁小区（加 pref=1 为 PCI 优先）；type 为 NR/LTE/WCDMA，band/arfcn/pci 取 t830_get_band_lock 的 supp_list 范围。网页总是提交 arfcn/band/pci/type 与三个列表，未用的列表为空 | band_lock |
| 65 | cellular | t830_set_plmn_lock | PLMN 锁定（MCC+MNC，如 46001）。设备重启或重新插卡后才生效，且没有读取锁定状态的接口；锁到与当前 SIM 不符的 PLMN 会在重启后断网。厂商网页固定提交 Rain 的 65538/65573/65574 | none |
| 66 | cellular | t830_set_plmn_unlock | PLMN 解锁。设备重启或重新插卡后才生效 | none |
| 70 | firewall | t830_set_mac_filter_mode | 修改 MAC 过滤模式 | mac_filter |
| 71 | firewall | t830_set_mac_filter_rule | 创建、修改或删除 MAC 过滤规则 | mac_filter |
| 73 | firewall | t830_set_ip_filter_mode | 修改 IP 过滤模式 | ip_filter |
| 74 | firewall | t830_set_ip_filter_rule | 创建、修改或删除 IP 过滤规则 | ip_filter |
| 76 | firewall | t830_set_port_forward_switch | 修改端口转发开关 | port_forward |
| 77 | firewall | t830_set_port_forward_rule | 添加或删除端口转发规则 | port_forward |
| 79 | firewall | t830_set_port_map_switch | 修改端口映射开关 | port_map |
| 80 | firewall | t830_set_port_map_rule | 添加或删除端口映射规则 | port_map |
| 82 | firewall | t830_set_url_filter_rule | 添加或删除 URL 过滤规则 | url_filter |
| 86 | firewall | t830_set_dmz | 设置 DMZ | dmz |
| 88 | firewall | t830_set_alg | 设置 ALG | alg |
| 92 | network | t830_set_dhcp | 配置 DHCP | dhcp |
| 93 | network | t830_set_static_ip | 新增或删除静态 IP | static_ip |
| 96 | system | t830_set_ntp | 提交 NTP 配置 | ntp |
| 99 | system | t830_set_reboot_schedule | 提交完整定时重启配置；schTime 使用 HH;mm，禁用时 schweek 可为空 | reboot_schedule |
| 100 | diagnostics | t830_set_signal_start | 启动信号测试，设备测量约需 10 秒，默认等待最多 20 秒；显式超时配置优先 | signal_records |
| 102 | diagnostics | t830_set_signal_record | 保存 signal_start 返回的 index/name/sigal/time/qos，加上用户填写的 position | signal_records |
| 103 | diagnostics | t830_set_signal_record_edit | 修改信号测试记录 | signal_records |
| 104 | diagnostics | t830_set_signal_record_delete | 删除信号测试记录 | signal_records |
| 106 | system | t830_set_tr069 | 提交 TR069 配置 | tr069 |
| 110 | system | t830_set_developer_login | 登录开发者模式。文档未列出请求字段 | developer_mode |
| 111 | system | t830_set_developer_verify | 提交开发者随机码验证 | developer_mode |
| 115 | diagnostics | t830_set_net_probe | 启动 Ping 或 Traceroute | ping_result |
| 119 | sms | t830_set_sms_center | 修改短信设置：短信中心号码 addr、送达报告 status（1 开/0 关）及有效期 time；三项须一起提交，未修改的项填 t830_get_sms_center 的原值 | sms_center |
| 120 | sms | t830_set_sms_delete | 删除短信。content 为“号码[序号”（无右括号，序号取 t830_get_sms_thread 中该条的 index）删除单条，或“号码[ALL”删除整个会话；多项用英文逗号分隔。返回 code 0 成功 | sms_all |
| 121 | sms | t830_set_sms_send | 发送短信。content 与 myContent 都填正文 UTF-8 字节的 base64（两者相同），多个号码用英文逗号分隔；设备返回 code 0 全部发送、1 部分发送（error 列出失败号码） | none |
| 126 | phonebook | t830_set_phonebook_write | 添加或编辑设备电话本；flag=0 新增，flag=1 编辑需 index；numb 为手机号，不发送短信 | phonebook |
| 127 | phonebook | t830_set_phonebook_delete | 删除电话本条目 | phonebook |
| 130 | system | t830_set_backup_check | 检查备份包 | none |
| 131 | system | t830_set_backup_restore | 从备份恢复配置 | none |
| 132 | system | t830_set_backup_delete | 删除备份文件 | none |

## 文档覆盖

API_DOC.md 中的编号接口都已注册。写工具默认不注册。`file exec` 只接受文档中的 tar 检查和 sysupgrade 恢复参数。

写接口仅封装文档中明确的参数子集：APN 认证目前仅 none；WiFi 加密仅 schema 所列模式。不声称覆盖全部设备功能。
