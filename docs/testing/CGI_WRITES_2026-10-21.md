# 2026-10-21 CGI 写工具实机复测

凭据只通过进程环境提供，未写入文件；报告中的写入参数经脱敏（密码、MAC 等），原始基线只保存在被忽略的 `tmp/`。本机经有线网卡（192.168.0.220）连接设备。

## 结论

36 个 CGI 写工具中，32 个已通过真实 MCP 调用，4 个未执行。26 个通过；6 个由设备或固件拒绝，且已确认不是项目登录问题。

**CGI 登录故障的触发条件已复现**：重启后设备只运行了 62 秒时，测试脚本做了一次成功的 CGI 登录；此后所有 CGI 登录都返回 HTTP 500（`login.lua:176` last_stamp 算术异常）。连续观察 7 分钟未自愈，直到下次重启前都无法恢复。用户选择暂不恢复，**设备当前停在该故障状态**：UBUS 工具可用，CGI 工具不可用。

## 结果

| 工具 | 方式 | 结果 |
|---|---|---|
| upnp / dns / gps | 原值提交并验证回读 | 通过（另做 UPnP 0→1→0 实际修改与恢复） |
| mac_filter_mode / ip_filter_mode / port_forward_switch / port_map_switch | 原值提交 | 通过，code 0，回读不变 |
| dmz / alg / dhcp / ntp / mesh_role / tr069 | 原值提交 | 通过，code 0，回读不变 |
| static_ip / mac_filter_rule / ip_filter_rule / port_forward_rule / port_map_rule | 新增 `mcptest` 测试条目 → 回读找到 → 删除 → 回读确认消失 | 通过 |
| wifi_scan_start / wifi_scan_list | 扫描后读取列表 | 通过，返回周边 2.4G/5G 网络 |
| mesh_close / mesh_onboard / mesh_router_remove | Mesh 关闭状态下调用 | 通过，code 0，Mesh 状态不变 |
| mesh_router_name | 无子节点时使用不存在的 MAC | 设备业务码 3，路由列表不变 |
| workmode | 原值提交（模式 4） | 通过，设备 5 秒内可访问，回读不变 |
| login / logout | 独立工具登录；注销后再读取 | 通过，注销后自动重新登录 |
| password | 改为临时密码 → 验证 → 改回 | 通过：临时密码可登录、原密码 code 1；改回后原密码登录正常 |
| reboot | 提交重启 | 通过，48 秒后恢复访问，开机计时重置 |
| setup_save | 原值提交 | **HTTP 403**：带有效会话且未要求重新登录；设备初始化完成（first_setup=0）后拒绝该向导接口，配置与登录密码均未变化 |
| developer_login | 空参数 | 设备业务码 3；网页实际使用的是密钥验证加 superadmin 登录 |
| wifi_router_disconnect | 断开（当前没有上游） | **HTTP 500**：固件 `api_wifi_sta.lua:60` 的 gsub 收到 nil；没有配置上游 STA 时固件出错，与 `get_wifi_rt` 的 NO_DATA 是同一前提 |
| wifi_router_connect | 未执行 | 需要上游 WiFi 的 SSID 和密码，并需切换到 WLAN 路由模式 |
| factory_reset / firmware_upload / firmware_upgrade | 未执行 | 用户选择跳过 |

最终状态与测试前基线的对比没能完成：重启后 CGI 读取不可用。测试过程中各项回读都与原值一致，测试条目都已删除，密码已恢复。

## 本轮修复

1. **一次性写工具遇到"需要登录"时续期并重发一次**（`src/t830.mjs`）。实测发现固件同一账号只保留一个 CGI 会话：任何客户端（网页服务、另一个 MCP 实例、诊断脚本）一登录，其他会话就会失效，之后的写入返回 403 且带 `x-luci-login-required: yes`。该响应在 LuCI 调度层发出，请求尚未执行，所以重新登录后重发一次是安全的。其他故障（包括不带该标记的 403、超时、断线）依然不重发；带回读配置的写入仍由写流程自行恢复。
2. **目录 schema 与设备网页实际请求不一致**（`src/catalog.mjs`）：
   - `dhcp`：`start`/`end` 是主机号（如 `100`），之前要求 IPv4，无法按设备格式提交。
   - `ip_filter_rule`：新增请求补上 `proto`、`lan_port`、`wan_ip`、`wan_port`，`operate` 允许 `add`。
   - `mac_filter_rule`：`operate` 允许 `add`/`mod`（修改需带 `macaddr_new`）；之前只允许 `del`，缺少 `add` 时设备返回码 2。
   - `port_forward_rule`：删除也必须带该规则的 `start_port`/`end_port`，否则设备返回码 2。
3. GPS 写 profile 放行 `code=-1`（仅表示未定位）。

模拟测试：非语音的 12 个测试文件共 180 项通过。新增"被其他登录挤掉会话后续期重发一次"的测试；故障矩阵改为验证"仅在设备要求登录时重发一次"。

## CGI 登录故障分析

| 状态 | `/tmp/last_login_time` | 写入时机 | 之后的 CGI 登录 |
|---|---|---|---|
| 2026-10-20 故障 | 2 字节 | 开机不久 | 500，持续数小时 |
| 2026-10-21 正常 | 5 字节 | 开机约 10067 秒时登录 | 正常 |
| 本次重启后 | 2 字节 | 开机 62 秒时的成功登录 | 500，连续 7 分钟未恢复 |

文件大小与写入时的开机秒数位数一致，推测文件记录的是登录时的开机秒数，固件在后续登录时处理这个值出错。开发者会话不能读取文件内容或 `login.lua`（file read/exec 均被拒绝），因此"两位数会触发"仍是推断，具体阈值未确认。

**规避方法**：设备重启后，在开机足够久（建议 5 分钟以上）之前，不要让任何客户端进行 CGI 登录，包括网页服务、MCP 和浏览器。恢复方式只有重启，并且重启后同样要避开开机早期的登录。这个结论尚未用一次受控重启验证。

## 证据与命令

- 实机记录：[原值写入](../../reports/live/cgi-writes-2026-10-21/same-value.json)、[配置](../../reports/live/cgi-writes-2026-10-21/config.json)、[初始化/开发者入口](../../reports/live/cgi-writes-2026-10-21/setup.json)、[规则增删](../../reports/live/cgi-writes-2026-10-21/rules.json)、[上游 WiFi 与 Mesh](../../reports/live/cgi-writes-2026-10-21/mesh.json)、[工作模式](../../reports/live/cgi-writes-2026-10-21/workmode.json)、[登录注销](../../reports/live/cgi-writes-2026-10-21/auth.json)、[密码](../../reports/live/cgi-writes-2026-10-21/password.json)、[重启](../../reports/live/cgi-writes-2026-10-21/reboot.json)

```powershell
node scripts/live-cgi-writes.mjs --apply
node scripts/live-cgi-writes-full.mjs <config|setup|rules|mesh|workmode|auth|password|reboot> --apply
```
