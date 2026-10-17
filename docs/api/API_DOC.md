# M05 接口文档

## 请求说明

本项目存在两种接口调用方式：

**方式一：CGI 直连**
- URL 格式：`/cgi-bin/luci/...`
- 参数直接作为请求体传递（GET 请求无参数，POST 请求传 JSON 对象）
- 所有请求附带查询参数 `?flag=xxx&t=时间戳`

**方式二：UBUS RPC**
- URL 固定为：`/ubus/?flag=xxx&t=时间戳`
- 请求方法均为 POST
- 请求体遵循 JSON-RPC 2.0 格式，结构如下：
```json
{
  "jsonrpc": "2.0",
  "method": "call",
  "params": ["<token>", "<service>", "<method>", { /* 业务参数 */ }]
}
```
- `token`：登录后获取的会话令牌
- `service`：UBUS 服务名
- `method`：具体方法名
- 部分接口支持批量请求，请求体为数组

---

## 一、系统与登录

### 1. 判断设备是否恢复出厂
- **URL**：`/cgi-bin/luci/login/get_firstsetup`
- **方法**：GET
- **参数**：无
- **说明**：判断设备是否处于出厂状态

### 2. 获取初始化配置
- **URL**：`/cgi-bin/luci/admin/jt_setup/get_setup`
- **方法**：GET
- **参数**：无
- **说明**：获取设备初始化配置信息

### 3. 提交初始化设置
- **URL**：`/cgi-bin/luci/admin/jt_setup/set_setup`
- **方法**：POST
- **说明**：首次使用时提交初始化配置

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Unity_switch | string | 是 | 统一开关，`"OFF"` / `"ON"` |
| first_login | number | 是 | 首次登录标识，`0` |
| lang | string | 是 | 语言，如 `"en"` |
| wifi_power | string | 是 | WiFi 功率，如 `"2"` |
| wifi2g_ssid | string | 是 | 2.4G WiFi 名称 |
| wifi5g_ssid | string | 是 | 5G WiFi 名称 |
| wifi2g_password | string | 是 | 2.4G WiFi 密码 |
| wifi5g_password | string | 是 | 5G WiFi 密码 |
| wifi_ssid | string | 是 | WiFi 名称 |
| samePwdCheck | string | 是 | 同密码标识，`"1"` |
| user_password | string | 是 | 管理员密码 |

### 4. 获取登录状态
- **URL**：`/cgi-bin/luci/login/get_login_status`
- **方法**：GET
- **参数**：无
- **说明**：获取当前用户登录状态

### 5. 登录
- **URL**：`/cgi-bin/luci/login/action_login`
- **方法**：POST
- **说明**：用户登录认证

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名，`"admin"` |
| password | string | 是 | 密码，SHA256(salt + ":" + 原始密码) |
| salt | string | 是 | 盐值 |

### 6. 退出登录
- **URL**：`/cgi-bin/luci/login/action_logout`
- **方法**：POST
- **参数**：无
- **说明**：退出当前登录

### 7. 修改登录密码
- **URL**：`/cgi-bin/luci/admin/jt_system/set_login`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名，`"admin"` |
| old_password | string | 是 | 旧密码 |
| new_password | string | 是 | 新密码 |

### 8. 获取国家编码
- **URL**：`/cgi-bin/get_country_code`
- **方法**：GET
- **参数**：无
- **说明**：获取设备当前国家编码

---

## 二、WiFi 设置

### 9. 获取 WiFi 信息
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `get_ssidPage_info`
- **参数**：无
- **说明**：获取首页 WiFi SSID 配置信息

### 10. 修改 WiFi 开关
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_wifi_switch`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 频段标识，`"5G"` 或 `"2.4G"` |
| action | string | 是 | `"up"` 开启 / `"down"` 关闭 |

### 11. 修改 WiFi 配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_wifi_cfgs`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 2.4G | object | 是 | 2.4G WiFi 配置 |
| 5G | object | 是 | 5G WiFi 配置 |

**2.4G / 5G 配置对象：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| hidden | string | 是 | 隐藏 SSID，`"0"` 否 / `"1"` 是 |
| ssid | string | 是 | WiFi 名称 |
| state | string | 是 | 连接状态 |
| authmode | string | 是 | 认证模式，如 `"WPA2PSK"`、`"Disable"` |
| wpapsk | string | 条件必填 | WiFi 密码（authmode 非 Disable 时必填） |

---

## 三、访客网络

### 12. 获取访客网络配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `get_guestPage_info`
- **参数**：无
- **说明**：获取访客网络配置信息

### 13. 开启/关闭访客网络
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_guest_wifi`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | `"Guest5G"` 或 `"Guest"` |
| action | string | 是 | `"up"` 开启 / `"down"` 关闭 |

### 14. 修改访客网络配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_guest_cfgs`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Guest | object | 是 | 2.4G 访客网络配置 |
| Guest5G | object | 是 | 5G 访客网络配置 |

**Guest / Guest5G 配置对象：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| state | string | 是 | 状态，`"up"` |
| ssid | string | 是 | WiFi 名称 |
| authmode | string | 是 | 认证模式，`"Disable"` / `"WPA2PSK"` |
| on_mode | string | 是 | 开启模式，如 `"Only"` |
| wpapsk | string | 条件必填 | WiFi 密码 |

---

## 四、WPS 设置

### 15. 获取 WPS 配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `get_WPSPage_info`
- **参数**：无
- **说明**：获取 WPS 配置信息

### 16. 获取 WPS 运行信息
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `get_WPSRun_info`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 接口名，如 `"ra0"`、`"rai0"` |
| obj | string | 是 | `"guest"` 或 `"host"` |

### 17. 配置 PBC WPS
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_WPS_pbc`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 接口名，如 `"ra0"`、`"rai0"` |
| obj | string | 是 | `"guest"` 或 `"host"` |

### 18. 配置 PIN WPS
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_WPS_pin`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 接口名，如 `"ra0"`、`"rai0"` |
| obj | string | 是 | `"guest"` 或 `"host"` |
| pincode | string | 是 | PIN 码，4 位或 8 位数字 |

---

## 五、高级 WiFi 设置

### 19. 获取高级 WiFi 页面信息
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `get_AdvancPage_info`
- **参数**：无
- **说明**：获取高级 WiFi 码值和页面配置

### 20. 提交高级 WiFi 配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_Advanc_cfgs`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| country_code | string | 是 | 国家编码 |
| 5G | object | 是 | 5G 高级配置 |
| 2.4G | object | 是 | 2.4G 高级配置 |
| trans_power | string | 是 | 发射功率 |
| isolate | string | 是 | 隔离设置 |
| wmm_state | string | 是 | WMM 状态 |

**5G / 2.4G 高级配置对象：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| wireless_mode | string | 是 | 无线模式 |
| band_width | string | 是 | 带宽 |
| channel | string | 是 | 信道 |

### 21. 获取夜间 WiFi 设置
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `get_NigWifi_info`
- **参数**：无
- **说明**：获取 WiFi awake settings 参数

### 22. 提交夜间 WiFi 设置
- **URL**：`/ubus/`
- **UBUS**：`mtk.wifi` / `set_NigWifi_cfg`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 是 | `"Enable"` 或 `"Disable"` |
| openTime | string | 条件必填 | 开启时间，格式 `"HH;mm"` |
| closeTime | string | 条件必填 | 关闭时间，格式 `"HH;mm"` |

---

## 六、工作模式

### 23. 获取工作模式
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_workmode`
- **参数**：无
- **说明**：获取当前工作模式

### 24. 修改工作模式
- **URL**：`/cgi-bin/luci/admin/jt_workmode/set_workmode`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workmode | number | 是 | 工作模式编号 |
| bonding | string | 是 | Bonding 模式，如 `"0"` |
| add_ccmni_to_bridge | string | 否 | 是否添加 ccmni 到 bridge |
| ip_passthrough | string | 否 | IP 透传 |

### 25. 获取当前 WiFi 路由信息
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_wifi_router`
- **参数**：无
- **说明**：获取当前连接的 WiFi 路由信息

### 26. 第一次扫描 WiFi 路由
- **URL**：`/cgi-bin/luci/admin/jt_workmode/wifi_scan_async?flag=first`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| async | string | 是 | 异步标识，`"1"` |
| state | string | 是 | `"1"` |

### 27. 第二次扫描 WiFi 路由列表
- **URL**：`/cgi-bin/luci/admin/jt_workmode/wifi_scan_async?flag=second`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| state | string | 是 | `"2"` |

### 28. 连接 WiFi 路由
- **URL**：`/cgi-bin/luci/admin/jt_workmode/set_wifi_router`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ap_ssid | string | 是 | 目标 WiFi 名称 |
| ap_password | string | 条件必填 | 目标 WiFi 密码 |
| channel | string | 是 | 信道 |
| wifi_index | string | 是 | WiFi 索引 |
| encrypt | string | 是 | 加密方式 |
| auth | string | 是 | 认证方式 |

### 29. 断开 WiFi 连接
- **URL**：`/cgi-bin/luci/admin/jt_workmode/wifi_connect`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| connect | string | 是 | `"0"` 断开连接 |

---

## 七、Mesh 组网

### 30. 获取 Mesh 开关状态
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/get_easymesh_switch`
- **方法**：GET
- **参数**：无
- **说明**：获取 EasyMesh 开关状态

### 31. 获取 Mesh 模式
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/get_role`
- **方法**：GET
- **参数**：无
- **说明**：获取 Mesh 角色（0：关闭，1：主路由，2：子路由）

### 32. 修改 Mesh 模式
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/set_role`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | string/number | 是 | Mesh 角色（0：关闭，1：主路由，2：子路由） |

### 33. 关闭 Mesh
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/close_easymesh`
- **方法**：POST
- **参数**：无
- **说明**：关闭 EasyMesh 功能

### 34. 获取组网内设备列表
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/get_routers`
- **方法**：GET
- **参数**：无
- **说明**：获取 Mesh 组网内所有路由设备

### 35. 修改 Mesh 路由设备名称
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/set_router_name`
- **方法**：POST
- **说明**：修改 Mesh 组网中路由设备的名称

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| al_mac | string | 是 | 设备 AL MAC 地址 |
| name | string | 是 | 设备名称 |

### 36. 发起组网
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/on_boarding`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| on_boaid | string | 是 | 组网标识，`"1"` |

### 37. 删除 Mesh 路由
- **URL**：`/cgi-bin/luci/admin/jt_easymesh/remove_router`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| al_mac | string | 是 | 设备 AL MAC 地址 |

---

## 八、设备管理

### 38. 获取接入设备数
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `ue_get`
- **参数**：无
- **说明**：获取当前接入设备数量及信息

### 39. 修改接入设备名称
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `ue_modify`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mac | string | 是 | 设备 MAC 地址 |
| name | string | 是 | 设备名称 |

### 40. 删除接入设备
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `ue_delete`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mac | string | 是 | 设备 MAC 地址 |

### 41. 获取状态页面设备信息
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `get_status_info`
- **参数**：无
- **说明**：获取 Status 页面的设备信息

### 42. 获取设备信息（jytl）
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `devinfo_get`
- **参数**：无
- **说明**：获取设备基本信息

### 43. 获取蜂窝设备信息
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `get_device_info`
- **参数**：无
- **说明**：获取蜂窝网络设备信息

### 44. 获取设备版本信息
- **URL**：`/cgi-bin/upgrade-set.lua`
- **方法**：GET
- **参数**：无
- **说明**：获取设备版本信息，用于判断设备是否重连
- **返回**：包含 `version` 字段（当前固件版本）

### 45. 上传固件文件
- **URL**：`/cgi-bin/cgi-upload`
- **方法**：POST
- **Content-Type**：`multipart/form-data`
- **说明**：上传固件 .bin 文件到设备

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sessionid | string | 是 | 登录会话 token |
| filename | string | 是 | 固件存储路径，`"/tmp/firmware.bin"` |
| file | file | 是 | 固件文件（.bin） |

- **返回**：包含 `checksum`（校验和）和 `size`（文件大小）字段

### 46. 执行固件升级
- **URL**：`/cgi-bin/luci/admin/jt_system/set_local_system_do_upgrade`
- **方法**：POST
- **查询参数**：`?do_upgrade=1`
- **参数**：无
- **说明**：通知后端执行固件升级动作，升级过程设备 WiFi 会断开

| 返回字段 | 说明 |
|----------|------|
| code = 0 | 升级任务启动成功 |
| code = 11 | 数据处理中，稍后重试 |
| 其他 | 升级失败 |

### 47. 重启设备
- **URL**：`/cgi-bin/luci/admin/jt_system/set_reboot`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| reboot | string | 是 | 重启标识，`"1"` |

### 48. 恢复出厂设置
- **URL**：`/cgi-bin/luci/admin/jt_system/set_restore`
- **方法**：POST
- **参数**：无
- **说明**：恢复设备出厂设置

---

## 九、SIM 卡管理

### 49. 获取 SIM 卡状态
- **URL**：`/cgi-bin/get_simcard_inslot_stat`
- **方法**：GET
- **参数**：无
- **说明**：获取 SIM 卡是否在槽

### 50. 获取 SIM 卡配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `get_simcard_index`
- **参数**：无
- **说明**：获取 SIM 卡插槽配置

### 51. 修改 SIM 卡选择
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_simcard_index`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sim_type | string | 是 | SIM 类型，`"1"` 物理 SIM / `"2"` eSIM |

### 52. 获取 SIM 卡信息
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `get_sim_info`
- **参数**：无
- **说明**：获取 SIM 卡详细信息（SIM Lock 相关）

### 53. 提交 PIN 码验证
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_verify_pin`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pin_str | string | 是 | PIN 码 |

### 54. 提交 PUK 解锁
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_unblock_pin`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| puk_str | string | 是 | PUK 码 |
| pin_str | string | 是 | 新 PIN 码 |

### 55. 开启 PIN 码锁
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_enable_pin`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pin_str | string | 是 | PIN 码 |

### 56. 关闭 PIN 码锁
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_disable_pin`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| pin_str | string | 是 | PIN 码 |

### 57. 修改 PIN 码
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_change_pin`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| old_pin | string | 是 | 旧 PIN 码 |
| new_pin | string | 是 | 新 PIN 码 |

---

## 十、网络设置

### 58. 获取网络类型配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `get_netWay_info`
- **参数**：无
- **说明**：获取网络类型配置信息

### 59. 设置网络类型
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_netWay_cfg`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ratMode | string | 是 | 网络类型模式值 |

---

## 十一、APN 管理

### 60. 获取 APN 列表
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `apn_R_get`
- **参数**：无
- **说明**：获取 APN 列表配置

### 61. 保存 APN 配置
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `apn_R_save`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| config_file | string | 是 | 配置文件标识，如 `"APN1"`、`"APN2"`、`"APN3"`、`"APN4"` |
| apn_name | string | 是 | APN 名称 |
| ip_version | string | 是 | IP 版本，如 `"IPv4v6"` |
| auth_pref | string | 是 | 认证偏好，如 `"none"` |
| user_name | string | 否 | 认证用户名 |
| user_password | string | 否 | 认证密码 |

### 62. 移除 APN
- **URL**：`/ubus/`
- **UBUS**：`jytl_api` / `apn_R_remove`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| config_file | string | 是 | 配置文件标识，如 `"APN2"`、`"APN3"`、`"APN4"` |

---

## 十二、Band Selection / Cell Lock

### 63. 获取 Band Selection 配置
- **URL**：`/ubus/`
- **UBUS**：批量请求
  - `mtk.cell` / `get_cellList_info`
  - `mtk.cell` / `get_cellLock_info`
- **参数**：无
- **说明**：批量获取小区列表信息和小区锁定信息

### 64. 频段锁定
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_cellFreq_lock`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | 锁定类型 |
| state | string | 是 | 锁定状态 |
| band | string | 是 | 频段 |
| arfcn | string | 否 | ARFCN |
| pci | string | 否 | PCI |
| pref | string | 否 | 优选标识，`"1"` |
| multi_band | object | 否 | 多频段配置 |

**multi_band 对象：**

| 字段 | 类型 | 说明 |
|------|------|------|
| list_3G | array | 3G 频段列表 |
| list_4G | array | 4G 频段列表 |
| list_5G | array | 5G 频段列表 |

---

## 十三、PLMN 管理

### 65. PLMN 锁定
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_plmn_lock`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| plmn_array | array | 是 | PLMN 编码数组，如 `["65538", "65573", "65574"]` |

### 66. PLMN 解锁
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_plmn_unlock`
- **参数**：无
- **说明**：解除 PLMN 锁定

---

## 十四、漫游设置

### 67. 获取漫游配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `get_roaming_info`
- **参数**：无
- **说明**：获取漫游配置信息

### 68. 设置漫游配置
- **URL**：`/ubus/`
- **UBUS**：`mtk.cell` / `set_roaming_cfg`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 是 | `"Enable"` 或 `"Disable"` |

---

## 十五、防火墙

### 69. 获取 MAC 过滤配置
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_macfilter`
- **参数**：无
- **说明**：获取 MAC 过滤规则和模式

### 70. 修改 MAC 过滤模式
- **URL**：`/cgi-bin/luci/admin/jt_firewall/set_macfilter_mode`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mode | string | 是 | 过滤模式 |

### 71. 创建/修改/删除 MAC 过滤规则
- **URL**：`/cgi-bin/luci/admin/jt_firewall/set_macfilter`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| macaddr | string | 是 | MAC 地址 |
| name | string | 否 | 设备名称 |
| operate | string | 删除时必填 | `"del"` 删除操作 |

### 72. 获取 IP 过滤配置
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_ipfilter`
- **参数**：无
- **说明**：获取 IP 过滤规则和模式

### 73. 修改 IP 过滤模式
- **URL**：`/cgi-bin/luci/admin/jt_firewall/set_ipfilter_mode`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mode | string | 是 | 过滤模式，如 `"0"` |

### 74. 创建/修改/删除 IP 过滤规则
- **URL**：`/cgi-bin/luci/admin/jt_firewall/set_ipfilter`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| index | string | 修改/删除时 | 规则索引 |
| ip_family | string | 是 | IP 协议族 |
| lan_ip | string | 是 | LAN IP 地址 |
| name | string | 是 | 规则名称 |
| protocol | string | 是 | 协议 |
| operate | string | 删除时必填 | `"del"` 删除操作 |

### 75. 获取端口转发规则
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_portforward`
- **参数**：无
- **说明**：获取端口转发规则列表

### 76. 修改端口转发开关
- **URL**：`/cgi-bin/luci/admin/jt_nat/set_portforward_switch`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| switch | number | 是 | `0` 关闭 / `1` 开启 |

### 77. 添加/删除端口转发规则
- **URL**：`/cgi-bin/luci/admin/jt_nat/set_portforward`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 规则名称 |
| lan_ip | string | 是 | LAN IP 地址 |
| protocol | string | 是 | 协议，如 `"tcp"` / `"udp"` |
| start_port | string | 添加时必填 | 起始端口 |
| end_port | string | 添加时必填 | 结束端口 |
| index | string | 删除时必填 | 规则索引 |
| operate | string | 是 | `"add"` 添加 / `"del"` 删除 |

### 78. 获取端口映射规则
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_portmap`
- **参数**：无
- **说明**：获取端口映射规则列表

### 79. 修改端口映射开关
- **URL**：`/cgi-bin/luci/admin/jt_nat/set_portmap_switch`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| switch | number | 是 | `0` 关闭 / `1` 开启 |

### 80. 添加/删除端口映射规则
- **URL**：`/cgi-bin/luci/admin/jt_nat/set_portmap`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 规则名称 |
| wan_port | string | 是 | WAN 端口 |
| lan_ip | string | 是 | LAN IP 地址 |
| lan_port | string | 是 | LAN 端口 |
| protocol | string | 是 | 协议，如 `"tcp"` / `"udp"` |
| start_port | string | 添加时 | 起始端口 |
| end_port | string | 添加时 | 结束端口 |
| index | string | 删除时必填 | 规则索引 |
| operate | string | 是 | `"add"` 添加 / `"del"` 删除 |

### 81. 获取 URL 过滤规则
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_urlfilter`
- **参数**：无
- **说明**：获取 URL 过滤规则列表

### 82. 添加/删除 URL 过滤规则
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `set_urlfilter`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | URL 地址 |
| name | string | 删除时必填 | 规则名称 |
| operate | string | 是 | `"add"` 添加 / `"del"` 删除 |

### 83. 获取 UPnP 配置
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_upnp`
- **参数**：无
- **说明**：获取 UPnP 配置信息

### 84. 设置 UPnP 开关
- **URL**：`/cgi-bin/luci/admin/jt_nat/set_upnp`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| upnp_switch | string | 是 | `"0"` 关闭 / `"1"` 开启 |

### 85. 获取 DMZ 配置
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_dmz`
- **参数**：无
- **说明**：获取 DMZ 配置信息

### 86. 设置 DMZ
- **URL**：`/cgi-bin/luci/admin/jt_nat/set_dmz`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| dmz_switch | string | 是 | `"0"` 关闭 / `"1"` 开启 |
| lan_ip | string | 条件必填 | DMZ 目标 LAN IP |
| name | string | 否 | 名称 |

### 87. 获取 ALG 配置
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_alg`
- **参数**：无
- **说明**：获取 ALG 配置信息

### 88. 设置 ALG
- **URL**：`/cgi-bin/luci/admin/jt_alg/set_alg`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| alg_switch | string | 是 | 总开关，`"0"` / `"1"` |
| enable_tftp | string | 是 | TFTP ALG，`"0"` / `"1"` |
| enable_ftp | string | 是 | FTP ALG，`"0"` / `"1"` |
| enable_pptp | string | 是 | PPTP ALG，`"0"` / `"1"` |
| enable_sip | string | 是 | SIP ALG，`"0"` / `"1"` |
| enable_h323 | string | 否 | H323 ALG，`"0"` / `"1"` |

### 89. 获取 DNS Protection 配置
- **URL**：`/cgi-bin/luci/admin/jt_dns/get_dns`
- **方法**：GET
- **参数**：无
- **说明**：获取 DNS Protection 配置

### 90. 设置 DNS Protection
- **URL**：`/cgi-bin/luci/admin/jt_dns/set_dns`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| rebind_protection | string | 是 | `"0"` 关闭 / `"1"` 开启 |

---

## 十六、LAN 设置

### 91. 获取 DHCP 信息
- **URL**：`/cgi-bin/luci/admin/jt_lan/get_dhcp`
- **方法**：GET
- **参数**：无
- **说明**：获取设备网关和 DHCP 信息

### 92. 配置 DHCP
- **URL**：`/cgi-bin/luci/admin/jt_lan/set_dhcp`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| dhcp_switch | string | 是 | `"0"` 关闭 / `"1"` 开启 |
| gateway | string | 条件必填 | 网关地址 |
| netmask | string | 条件必填 | 子网掩码 |
| leasetime | string | 否 | 租约时间，如 `"12h"` |
| start | string | 条件必填 | 起始 IP |
| end | string | 条件必填 | 结束 IP |

### 93. 新增/删除静态 IP
- **URL**：`/cgi-bin/luci/admin/jt_lan/set_static_ip`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ip | string | 是 | IP 地址 |
| mac | string | 是 | MAC 地址 |
| name | string | 否 | 设备名称 |
| operate | string | 是 | `"add"` 添加 / `"del"` 删除 |

### 94. 获取静态 IP 配置
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_static_ip`
- **参数**：无
- **说明**：获取静态 IP 分配列表

---

## 十七、NTP 时间设置

### 95. 获取 NTP 配置
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_ntp`
- **参数**：无
- **说明**：获取 NTP 时间配置

### 96. 提交 NTP 配置
- **URL**：`/cgi-bin/luci/admin/jt_ntp/set_ntp`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| ntp_switch | string | 是 | `"0"` 手动 / `"1"` 自动 |
| ntp_server1 | string | 自动时必填 | NTP 服务器1 |
| ntp_server2 | string | 否 | NTP 服务器2 |
| current_time | string | 手动时必填 | 当前时间 |
| timezone | string | 手动时必填 | 时区 |
| zonename | string | 自动时必填 | 时区名称 |

### 97. 获取服务器时间
- **URL**：`/ubus/`
- **UBUS**：`luci` / `getLocaltime`
- **参数**：无
- **说明**：获取设备当前服务器时间

---

## 十八、定时重启

### 98. 获取定时重启配置
- **URL**：`/ubus/`
- **UBUS**：`gen.attr` / `get_rebootSch_info`
- **参数**：无
- **说明**：获取定时重启调度配置

### 99. 提交定时重启配置
- **URL**：`/ubus/`
- **UBUS**：`gen.attr` / `set_rebootSch_cfg`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| action | string | 是 | `"Enable"` 或 `"Disable"` |
| schweek | string | 条件必填 | 星期，如 `"1|2|3"`（`\|` 分隔） |
| schTime | string | 条件必填 | 重启时间 |

---

## 十九、信号测试

### 100. 启动信号测试
- **URL**：`/ubus/`
- **UBUS**：`position_sigal` / `start`
- **参数**：无
- **说明**：获取设备当前信号参数

### 101. 读取信号测试列表
- **URL**：`/ubus/`
- **UBUS**：`position_sigal` / `read_file`
- **参数**：无
- **说明**：获取信号测试结果列表

### 102. 记录信号测试信息
- **URL**：`/ubus/`
- **UBUS**：`position_sigal` / `write_file`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 测试名称 |
| position | string | 是 | 位置信息 |
| time | string | 否 | 测试时间 |

### 103. 修改信号测试记录
- **URL**：`/ubus/`
- **UBUS**：`position_sigal` / `modify_file`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| index | string | 是 | 记录索引 |
| name | string | 是 | 测试名称 |
| position | string | 是 | 位置信息 |

### 104. 删除信号测试记录
- **URL**：`/ubus/`
- **UBUS**：`position_sigal` / `delet_file`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| index | string | 是 | 记录索引 |

---

## 二十、TR069

### 105. 获取 TR069 数据
- **URL**：`/ubus/`
- **UBUS**：`web_api` / `get_tr069`
- **参数**：无
- **说明**：获取 TR069 配置

### 106. 提交 TR069 配置
- **URL**：`/cgi-bin/luci/admin/jt_tr069/set_tr069`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| enable | string | 是 | `"0"` / `"1"` |
| acs_url | string | 条件必填 | ACS URL |
| acs_username | string | 否 | ACS 用户名 |
| acs_password | string | 否 | ACS 密码 |
| periodic_enable | string | 否 | 周期通知，`"0"` / `"1"` |
| periodic_interval | string | 否 | 周期间隔 |
| cpe_username | string | 否 | CPE 用户名 |
| cpe_password | string | 否 | CPE 密码 |
| cpe_apn | string | 否 | CPE APN，默认 `"auto"` |

---

## 二十一、GPS

### 107. 获取 GPS 开关状态
- **URL**：`/cgi-bin/luci/admin/jt_gps/get_gps`
- **方法**：GET
- **参数**：无
- **说明**：获取 GPS 开关状态

### 108. 修改 GPS 开关状态
- **URL**：`/cgi-bin/luci/admin/jt_gps/set_gps`
- **方法**：POST

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| gps_switch | string | 是 | `"0"` 关闭 / `"1"` 开启 |

---

## 二十二、开发者模式

### 109. 获取开发者模式状态
- **URL**：`/cgi-bin/luci/admin/jt_system/get_develop_mode`
- **方法**：GET
- **参数**：无
- **说明**：判断当前是否开发者模式

### 110. 登录开发者模式
- **URL**：`/cgi-bin/luci/admin/jt_system/set_develop_mode`
- **方法**：POST
- **说明**：登录开发者模式

### 111. 获取开发者随机码验证
- **URL**：`/ubus/`
- **UBUS**：`gen.attr` / `check_asymmetric_verify`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| reply | string | 是 | 固定值 `"superpasswd"` |
| base64 | string | 是 | Base64 编码的密码 |

---

## 二十三、流量统计

### 112. 获取流量配置
- **URL**：`/ubus/`
- **UBUS**：`cell.traffic` / `get_traffic_cfg`
- **参数**：无
- **说明**：获取流量统计配置

### 113. 修改流量限制配置
- **URL**：`/ubus/`
- **UBUS**：`cell.traffic` / `set_traffic_cfg`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| day_limit | string | 是 | 日流量限制，如 `"100MB"` / `"0MB"` |
| month_limit | string | 是 | 月流量限制，如 `"1GB"` / `"0MB"` |
| start_day | string | 是 | 起始日，如 `"1"` |

---

## 二十四、诊断

### 114. 获取诊断信息
- **URL**：`/cgi-bin/luci/admin/jt_diagnose/get_diagnose_info`
- **方法**：GET
- **参数**：无
- **说明**：获取网络诊断数据

### 115. 网络工具 Ping/Traceroute
- **URL**：`/ubus/`
- **UBUS**：`netApp` / `start`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 是 | `"PING"` 或 `"Traceroute"` |
| addr | string | 是 | 目标地址 |
| jump | string | 否 | 最大跳数（Traceroute），如 `"30"` |
| time | string | 否 | 超时秒数，如 `"4"` |

### 116. 读取 Ping/Traceroute 结果
- **URL**：`/ubus/`
- **UBUS**：`netApp` / `start`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| addr | string | 是 | `"read_ping"` 读取结果 |

---

## 二十五、SMS 短信

### 117. 获取所有短信数据
- **URL**：`/ubus/`
- **UBUS**：批量请求
  - `sms_app` / `all_sms`
  - `phone_book` / `read_book`（参数：`{ device: "1", type: "ALL" }`）
  - `sms_app` / `get_addr`
- **参数**：无（token 自动注入）
- **说明**：批量获取短信列表、电话本、短信中心地址

### 118. 获取短信详细内容
- **URL**：`/ubus/`
- **UBUS**：`sms_app` / `addr_sms`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| addr | string | 是 | 发件人地址 |

### 119. 修改短信中心配置
- **URL**：`/ubus/`
- **UBUS**：`sms_app` / `set_addr`
- **说明**：设置短信中心号码

### 120. 删除短信
- **URL**：`/ubus/`
- **UBUS**：`sms_app` / `delet_pdu`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | 是 | 删除标识，格式 `"addr1[index1]"` 或批量 `"addr1[ALL,addr2[ALL,...]"` |

### 121. 发送短信
- **URL**：`/ubus/`
- **UBUS**：`sms_app` / `send_msg`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| addr | string | 是 | 收件人地址，多个用逗号分隔 |
| content | string | 是 | 短信内容 |
| format | string | 是 | 格式，`"2"` |
| myContent | string | 是 | 短信内容（原始） |

### 122. 获取短信发送状态报告
- **URL**：`/ubus/`
- **UBUS**：`sms_app` / `status_report`
- **参数**：无
- **说明**：获取短信发送成功报告

### 123. 获取未读短信数
- **URL**：`/ubus/`
- **UBUS**：`sms_app` / `read_unread`
- **参数**：无
- **说明**：获取未读短信数量

---

## 二十六、电话本

### 124. 查询电话本
- **URL**：`/ubus/`
- **UBUS**：`phone_book` / `read_book`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device | string | 是 | 设备标识，`"1"` |
| type | string | 是 | 查询类型，`"ALL"` 全部 |
| name | string | 否 | 按名称搜索 |

### 125. 选择电话本条目
- **URL**：`/ubus/`
- **UBUS**：`phone_book` / `select_book`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device | string | 是 | 设备标识，`"1"` |
| type | string | 否 | 查询类型 |
| name | string | 否 | 名称 |

### 126. 添加/编辑电话本
- **URL**：`/ubus/`
- **UBUS**：`phone_book` / `write_book`
- **说明**：添加或编辑电话本条目，包含 name、type、device、index 等字段

### 127. 删除电话本条目
- **URL**：`/ubus/`
- **UBUS**：`phone_book` / `delet_book`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| device | string | 是 | 设备标识 |
| index | string | 是 | 索引，多个用 `\|` 分隔，如 `"index1\|index2"` |

---

## 二十七、101 Share

### 128. 获取 101 Share 状态
- **URL**：`/ubus/`
- **UBUS**：`cpe-ctrl` / `get_101share_status`
- **参数**：无
- **说明**：获取 101 Share 功能状态

---

## 二十八、日志与备份

### 129. 导出日志
- **URL**：`/ubus/`
- **UBUS**：`luci` / `getLogFileUrl`
- **参数**：无
- **说明**：获取日志文件下载地址

### 130. 备份配置检查
- **URL**：`/ubus/`
- **UBUS**：`file` / `exec`
- **说明**：检查备份文件是否有效

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| command | string | 是 | `"/bin/tar"` |
| params | array | 是 | `["-tzf", "/tmp/backup.tar.gz"]` |

### 131. 恢复备份
- **URL**：`/ubus/`
- **UBUS**：`file` / `exec`
- **说明**：从备份文件恢复配置

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| command | string | 是 | `"/sbin/sysupgrade"` |
| params | array | 是 | `["--restore-backup", "/tmp/backup.tar.gz"]` |

### 132. 删除备份文件
- **URL**：`/ubus/`
- **UBUS**：`file` / `remove`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | `"/tmp/backup.tar.gz"` |

---

## UBUS 服务索引

| 服务名 | 说明 |
|--------|------|
| mtk.wifi | WiFi 相关配置（SSID、WPS、高级设置、访客网络、夜间模式） |
| mtk.cell | 蜂窝网络相关（SIM、APN、Band、PLMN、漫游、频段锁定） |
| web_api | 通用 API（工作模式、防火墙、NTP、TR069、WiFi路由） |
| jytl_api | 设备管理（设备列表、设备信息、APN） |
| gen.attr | 通用属性（定时重启、开发者验证） |
| luci | OpenWrt 系统（时间、日志） |
| sms_app | 短信应用 |
| phone_book | 电话本 |
| cell.traffic | 流量统计 |
| position_sigal | 信号测试 |
| netApp | 网络诊断工具 |
| cpe-ctrl | CPE 控制接口（101 Share） |
| file | 文件操作（备份/恢复） |
