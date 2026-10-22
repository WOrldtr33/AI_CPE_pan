# 2026-10-20 UBUS 写工具实机测试与修复（第三、四轮）

两轮都通过独立 MCP 客户端，以标准 UBUS 认证加开发者 superadmin 会话连接实机，管理链路走有线（本机 192.168.0.220，USB 以太网）。每个工具都按“读原值 → 改为测试值 → 回读确认 → 提交原值 → 回读确认”执行，蜂窝类改动还要求恢复后上联重新 connected，任何恢复未确认即停止。最终状态与测试前基线逐项对照，见文末“残留差异”。

## 结论

第三轮新增 13 种工具实机通过，修复 5 处缺陷；第四轮按用户授权测试蜂窝、WPS 与短信 9 种工具，依据厂商网页修正 6 个工具的参数契约。本地回归 219 项全部通过。

| 状态 | 第二轮 | 第三轮 | 第四轮 | 第四轮变化 |
|---|---:|---:|---:|---|
| 实际变更、回读并恢复通过 | 10 | 19 | 21 | 网络类型 21→19→21、SIM 卡槽 1→2→1 |
| 已验证具体功能 | 3 | 4 | 7 | WPS PBC、WPS PIN、删除单条短信 |
| 仅原值提交及回读通过 | 4 | 2 | 1 | 频段锁定（当前为不锁，原样提交） |
| 返回“没有变化” | 3 | 0 | 0 | |
| 仅接口确认 | 1 | 0 | 2 | PLMN 锁定、解锁（设备无读取接口，重启后才生效） |
| 仍有失败或前置条件问题 | 10 | 10 | 11 | 新增发送短信：接口契约已证实，但模组发送失败 |
| 尚未实机执行 | 45 | 41 | 34 | 26 个依赖 CGI 登录；8 个 UBUS：PIN/PUK 五项（用户选择跳过）、删除接入设备、备份恢复与删除 |

## 第四轮：蜂窝、WPS 与短信

| 工具 | 测试值 | 结果 |
|---|---|---|
| t830_set_band_lock | 当前 `state=FULL`（不锁），按网页格式原样提交 | code 200，回读不变，上联 connected |
| t830_set_network_mode | ratMode 21→19（5G NSA）→21 | 两次 code 200，回读确认，恢复后上联 connected |
| t830_set_sim_slot | sim_type 1→2→1 | 两次 code 200；卡槽 2 期间断网，切回后约 40 秒重新 connected，SIM READY |
| t830_set_plmn_lock / plmn_unlock | 锁定当前运营商 46001，随即解锁 | 均 code 200；最终持久状态为解锁，与重启后仍可用联通卡联网的原状态一致 |
| t830_set_wps_pbc | 主网络 2.4G | code 200，`Start WSC Process` 约 120 秒后 `Timed-out`（无设备配对） |
| t830_set_wps_pin | 主网络 2.4G，测试 PIN | code 200，同样进入 `Start WSC Process` 并超时 |
| t830_set_sms_send | 向用户指定号码发送一条 ASCII 测试短信 | 设备正确解码 base64 正文并存入会话，但返回 `code:"2"`、`error:"<号码>:0"`（网页含义：发送失败），约 60 ms 即返回，说明是设备或模组直接拒绝；工具正确报告为 device_warning |
| t830_set_sms_delete | 用 `号码[index` 删除上面这一条 | code 0，会话回读为空，未触及其他短信（测试前收件箱为空） |

### 第四轮修正的参数契约

全部依据厂商网页的调用方式，并经实机返回值核对：

| 工具 | 原定义 | 实际契约 |
|---|---|---|
| t830_get_wps_run、t830_set_wps_pbc、t830_set_wps_pin | name 示例 `ra0` | name 是频段名 `2.4G`/`5G`（双频合一时为 `Unity`）；`ra0` 实机只返回 `{host:[]}`。返回 `host/guest[name].code`：200 已启动、409 重复、416 参数错、403 已有任务。WscStatus=`Start WSC Process` 为进行中，`Idle`/`Timed-out` 等为结束，WscResult=1 为配对成功；运行状态读取的 `result=500` 按设备忙处理 |
| t830_set_network_mode | 任意字符串，示例 `auto` | 只能取 21 自动、19 5G NSA、15 5G SA、3 仅 4G |
| t830_set_band_lock | 示例 `{type:'band', state:'0'}` | type 为 NR/LTE/WCDMA；state 为 FULL、multi_band、PCI（PCI 优先时加 `pref:'1'`）；PCI 锁定必须带 arfcn 与 pci |
| t830_set_plmn_lock | 1–8 位任意数字 | 5–6 位 MCC+MNC；说明中写明重启或重新插卡后才生效、没有读取接口，以及厂商网页固定锁定 Rain 的 65538/65573/65574（对其他运营商的卡，重启后会断网） |
| t830_set_sms_send | content/myContent 为明文 | 两者都是正文 UTF-8 字节的 base64，且必须相同；旧定义会让设备把明文按 base64 解码成乱码 |
| t830_set_sms_delete | 示例 `10086[0]` | 单条为 `号码[index`（无右括号），整个会话为 `号码[ALL`，多项用逗号分隔 |

### 待用户确认

短信发送失败的原因无法在客户端确定。可能原因包括：该卡（联通 46001）未开通点对点短信；短信中心号码 `8613010888500` 缺少国际前缀 `+`。要继续排查，需要你决定是否再发一条短信，例如临时把短信中心改为 `+8613010888500`，测试后恢复。

## 第三轮逐项结果

| 工具 | 测试值 | 结果 |
|---|---|---|
| t830_set_traffic | day_limit 0MB→1024MB，start_day 1→2 | 改值、回读、恢复通过（统计未启用，不影响流量） |
| t830_set_roaming | Enable→Disable→Enable | 通过；结束时上联 connected |
| t830_set_wifi_night | Disable→Enable 03;00 关 / 04;00 开→Disable | 通过；测试窗口避开当前时间 |
| t830_set_reboot_schedule | Disable→Enable 周 7 03;30→Disable | 通过；未触发重启 |
| t830_set_wifi_advanced | isolate 0→1→0 | 修复后通过；恢复时遇到设备忙，间隔 10 秒重试一次后成功 |
| t830_set_sms_center | 送达报告 status 0→1→0（短信中心号码不变） | 修复后通过；未发送短信 |
| t830_set_client_name | 本机名称→codex-name-test→原名 | 修复后通过；forbid 保持 off |
| t830_set_guest_config | 2.4G 访客 SSID 加后缀→原值（访客保持关闭） | 修复后通过 |
| t830_set_wifi_config | 2.4G 主 SSID 加后缀→原值（密码原样提交） | 修复后通过；无 WiFi 客户端在线 |
| t830_set_developer_verify | 当前开发者密钥 | code=200 并返回临时密码（工具输出已脱敏） |
| t830_set_net_probe | Traceroute 127.0.0.1，3 跳，超时 2 秒 | 修复参数后完成并取得结果 |

## 第三轮修复的缺陷

| 问题 | 实机证据 | 修复 |
|---|---|---|
| 高级 WiFi 部分修改被报告为“未变化” | 响应 `isolate:"200"`、其余 `409`，旧逻辑只看到 409，返回 not_modified，而设备实际已改 | 目录声明 `resultFields`；存在 200 且其余均为“未变化”码时，返回 `submitted` + `businessOutcome: modified`，并列出 appliedParts / unchangedParts |
| 高级 WiFi 设备忙被报告为成功 | 改值后立即再提交，设备返回 `{"result":"500"}`，旧逻辑判为 submitted，导致第一次恢复实际未生效 | `result` 纳入该接口的结果码，返回 device_warning；描述中说明须先回读确认 |
| 双频/访客 WiFi 部分修改及无线重启期间的回读 | 写入返回 `2.4G_code:200, 5G_code:409`；随后回读返回 `{"result":"500"}`，旧流程 1 秒内放弃并报告 WRITE_RESULT_UNKNOWN | 两个配置工具声明 409 为未变化码；mtk.wifi 三个读接口识别 `result=500` 为 DEVICE_BUSY；写后回读按厂商网页节奏等待（默认每 5 秒，最长 45 秒，可用 T830_WRITE_BUSY_POLL_MS / T830_WRITE_BUSY_WAIT_MS 调整），不重发写请求 |
| 访客 WiFi 配置缺 wpapsk 返回 416 | 不加密时省略 wpapsk，两个频段均 416 | 访客 wpapsk 改为必填，不加密时提交空字符串；双频 WiFi 也接受空字符串 |
| 接入设备改名返回 403 | 只提交 mac/name 时业务码 403 | 按厂商网页补齐必填 `forbid`（on 禁止上网 / off 允许）；只改名时填当前值 |
| 短信设置返回业务码 2 | 只提交 addr 时被拒 | 按厂商网页要求同时提交 addr、status（送达报告）、time（有效期） |

Traceroute 首次返回业务码 2，是测试时漏传了 `time`（厂商网页总是提交 type/addr/jump/time）；补上后完成。工具 schema 未改。

## 参数迁移

- `t830_set_sms_center`：由 `{addr}` 改为 `{addr, status, time}`，未修改的项填 `t830_get_sms_center` 的原值。
- `t830_set_client_name`：新增必填 `forbid`。
- `t830_set_guest_config`：两个频段都必须带 `wpapsk`，不加密时为空字符串。
- `t830_set_wifi_advanced`、`t830_set_wifi_config`、`t830_set_guest_config`：可能返回 `businessOutcome: modified`；设备忙时回读会等待。
- `t830_get_wps_run`、`t830_set_wps_pbc`、`t830_set_wps_pin`：name 改为 `2.4G`/`5G`/`Unity`。
- `t830_set_network_mode`：ratMode 限定为 21/19/15/3。
- `t830_set_band_lock`：type、state 改为枚举，PCI 锁定必须带 arfcn/pci。
- `t830_set_sms_send`：content/myContent 改为 UTF-8 base64，且必须相同。
- `t830_set_sms_delete`：content 必须是 `号码[index` 或 `号码[ALL` 格式。

## 仍阻塞的问题

**CGI 登录（固件缺陷）**：`action_login` 仍返回 HTTP 500，设备异常信息为 `login.lua:176: attempt to perform arithmetic on local 'last_stamp' (a string value)`。admin 与开发者身份相同，`get_login_status` 显示 fail_cnt=0、wait_sec=0。`/tmp/last_login_time`（2 字节）与 `/tmp/login_fail_count`（1 字节）在开机时写入，superadmin 会话只能 stat，不能读取内容。原生会话补 LuCI 会话值所需的 `session.get/set` 也被拒绝（RPC -32002）。因此所有 CGI 写工具无法在客户端侧解决，需要厂商修复登录时间戳处理，或另行提供可修正该文件的设备侧手段。受影响：8 个已失败的 CGI 工具，以及未执行中的 26 个工具。

原生注销 `session.destroy` 与 `backup_check`（缺少 /tmp/backup.tar.gz）结论不变。

## 残留差异

测试后访客网络读数不再包含 `closetime: "NONE"`，其他字段与测试前一致。UCI 中不存在该项，属于运行时字段；`on_mode` 仍为 `Only`（不限时），厂商网页只在非 `Only` 时读取 `closetime`，功能等价。其余 15 个基线区段（含 WiFi、高级 WiFi、夜间 WiFi、定时重启、流量、漫游、短信设置、接入设备、网络类型、频段锁定、SIM）与测试前一致，上联 connected。

第四轮结束后再次全量读取：网络类型 21、SIM 卡槽 1、频段锁定 FULL、SIM READY、短信中心与漫游不变、收件箱为空，上联 connected。主网络 2.4G 的 WPS 状态显示由 `Idle` 变为 `Timed-out`。这是上次运行的结果标记，不是配置；设备没有复位它的接口，下次启动 WPS 时会被覆盖。PLMN 锁定状态无法读取，最终提交的是解锁。

## 证据与命令

- [测试前基线](../../reports/live/ubus-writes-2026-10-20/baselines.json)、[测试后状态](../../reports/live/ubus-writes-2026-10-20/final-state.json)
- 实机记录：[第一轮](../../reports/live/ubus-writes-2026-10-20/writes.json)、[第二轮](../../reports/live/ubus-writes-2026-10-20/writes-round2.json)、[第三轮](../../reports/live/ubus-writes-2026-10-20/writes-round3.json)、[第四轮](../../reports/live/ubus-writes-2026-10-20/writes-round4.json)
- [CGI/UBUS 认证对照](../../reports/diagnostics/cgi-auth-now/probe.json)
- 第四轮：[契约只读探测](../../reports/live/ubus-writes-2026-10-20/cellular-contracts.json)、[频段锁定](../../reports/live/ubus-writes-2026-10-20/cellular-band-lock.json)、[网络类型](../../reports/live/ubus-writes-2026-10-20/cellular-network-mode.json)、[SIM 卡槽](../../reports/live/ubus-writes-2026-10-20/cellular-sim-slot.json)、[PLMN](../../reports/live/ubus-writes-2026-10-20/cellular-plmn.json)、[WPS PBC](../../reports/live/ubus-writes-2026-10-20/cellular-wps.json)、[WPS PIN](../../reports/live/ubus-writes-2026-10-20/cellular-wps-pin.json)、[短信](../../reports/live/ubus-writes-2026-10-20/cellular-sms.json)、[结束状态](../../reports/live/ubus-writes-2026-10-20/final-state-cellular.json)

```powershell
node --test
$env:T830_AUTH_TRANSPORT='ubus'
node scripts/live-ubus-writes.mjs --apply --wired-management-confirmed --label=<名称> [--only=key1,key2]
node scripts/live-ubus-cellular-writes.mjs --apply --wired-management-confirmed --label=<名称> --only=band_lock|network_mode|sim_slot|plmn|wps_pbc|wps_pin|sms [--sms-to=<号码>]
```

`live-ubus-cellular-writes.mjs` 用锁文件保证同一时间只运行一个实例，防止重复发短信。

凭据只通过进程环境提供，结束后清除；原始 WiFi 密码与 MAC 只在脚本内存中由原生会话读取，报告经脱敏。
