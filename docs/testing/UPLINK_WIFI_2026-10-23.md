# 上游 WiFi 工具实机测试（2026-10-23）

- 设备：T830，`http://192.168.0.1`，主机经 USB 有线网卡管理；项目以 CGI + 开发者（superadmin）认证启动。
- 上游热点：`OPPO Find X8 F170`，2.4G 信道 11，WPA2-PSK。密码仅经环境变量传入，报告中已脱敏；BSSID 已脱敏。
- 脚本：`scripts/live-uplink-wifi.mjs <ssid> --apply`（`T830_UPLINK_PASSWORD` 提供上游密码），原始记录 `reports/live/uplink-wifi-2026-10-22/result.json`（设备时区日期）。
- 开始前设备已运行约 2 小时，登录戳正常，CGI 登录 200/code 0，未触发早期登录导致的 HTTP 500 问题。

## 结果

| 步骤 | 工具 | 结果 |
| --- | --- | --- |
| 基线 | `t830_get_workmode` / `t830_get_wifi_rt` | workmode 4；上游 enabled=0、disconnected |
| 模式 4 扫描 | `t830_set_wifi_scan_start` + `t830_set_wifi_scan_list` | 通过，68 个 2.4G 网络，找到目标 |
| 切 WLAN router | `t830_set_workmode` → 5 | 通过，code 0，回读即为 5 |
| 模式 5 扫描 | 同上 | 通过，第 2 次读取得到列表 |
| 连接 | `t830_set_wifi_router_connect` | 实际生效；请求约 28 秒后返回 `DEVICE_UNREACHABLE`，约 20 秒内回读 enabled=1、connected、取得 IP |
| 断开 | `t830_set_wifi_router_disconnect` | 实际生效；请求约 1 秒后返回 `DEVICE_UNREACHABLE`，回读 enabled=0、disconnected |
| 恢复 | `t830_set_workmode` → 4 | 通过，最终 workmode 4、上游未连接 |

## 发现与修改

- 扫描不要求 WLAN router 模式；厂商网页仅在模式 5（且 super 角色）下显示连接入口。
- 设备扫描列表的 `encrypt` 列错位（如 `AES            100      b`），按原样提交后设备自行规范为 `AES`，与厂商网页行为一致。
- 连接/断开期间设备会断开 HTTP 连接，工具返回 `DEVICE_UNREACHABLE` 但配置已执行；写工具不会自动重发（已确认）。
- 首次运行使用默认 10 秒超时，连接请求超时后脚本过早恢复工作模式，打断了连接。厂商网页请求超时为 120 秒，已将 `wifi_router_connect` 的默认等待设为 120 秒（显式 `T830_TIMEOUT_MS` 仍优先）。
- 工具描述补充：字段取自扫描条目、`wifi_index` 5G=1/2.4G=2、code 10 为信道干扰、传输中断不代表未执行、应轮询 `wifi_rt` 确认。
- 设备没有上游配置时 `t830_get_wifi_rt` 可能返回 `UBUS_ERROR_5_NO_DATA`。

## 未做

- 未把连接/断开接入回读工作流（需处理 `wifi_rt` 无数据的基线和 20 秒以上的生效延迟）。
- 未在 WLAN router 模式下验证经上游 WiFi 的外网连通性，只确认取得 IP。
