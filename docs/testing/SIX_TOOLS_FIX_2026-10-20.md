# 2026-10-20 六项查询问题修复与实机验收

## 结论

Ping、电话本筛选和初始化配置三项调用问题已修复并通过真实 MCP 验证。GPS 接口可读取，开关开启但仍未定位；上游 WiFi 禁用、101 Share 服务缺失，均明确报告真实前置条件，不伪装成功。

| 原问题 | 修改与证据 | 当前状态 |
|---|---|---|
| t830_get_ping_result | 先提交一次有界 127.0.0.1 Ping，再轮询；按网页使用 netAppStar1/netAppStar2；code=1 解释为 pending | complete，6 发 6 收，0% 丢包；不证明外网 |
| t830_get_phonebook_select | 与 read_book 的 ALL 规则分开；省略 type/name 时补空字符串；类型为空或 0/1/2/3 | returned，reading.state=empty，count=0 |
| t830_get_setup | CGI 403/404 后用实际设备已声明且实测的 web_api/get_setup，只读切换且保留原始失败轨迹 | returned |
| t830_get_gps | CGI 403/404 后用 web_api/get_gps；区分开关、卫星数与定位状态 | device_warning；enabled=true、satellites=1、fix=not_fixed，仍不能认为已定位 |
| t830_get_wifi_rt | 只读核对当前 STA 配置，不保存 SSID/密钥；apcli0/apclii0 均 disabled=1 | 保留 NO_DATA；failure.category=precondition_not_met，不自动启用或切换模式 |
| t830_get_share | 核对设备当前 UBUS 服务清单，没有 cpe-ctrl | 保留 Object not found；failure.category=service_unavailable，不安装/启动服务或升级固件 |

## 电话本调用方式

用户提供的 API124 是 read_book，用于全部查询或按名称查询，原本就可以返回：

```json
{"device":"1","type":"ALL"}
```

API125 的 select_book 是独立的类别/名称筛选，不能传 read_book 的 ALL。实机表明，仅传 device 返回业务码5，传 type=ALL 仍为5；传空 type/name 则 code=0、data=""。项目已将空筛选设为默认并拒绝 ALL，以免把两种接口混用。

```json
{"device":"1","type":"","name":""}
```

两种接口当前 data 都为空字符串，明确解释为本次没有条目，没有创建、选择虚构联系人或读取报告中的联系人正文。

## 前置条件与边界

- t830_get_ping_result 继续是只读工具，绝不暗中启动任务。启动需要已获授权的写工具；Agent 提示、工具描述与复测脚本均按启动→轮询处理。pending 不能宣称完成，完成也不能仅凭 code=0 宣称外网可达。
- GPS 开关为 enable、is_good=0，设备业务码 -1 仍保留。接收状态与开关是两回事；本次没有开关 GPS 或声称修复了物理定位条件。
- 上游 WiFi 两个 STA 均禁用，是从经授权的 uci.get 直接读到的事实；工作模式编号仅作上下文，不擅自解释编号含义。恢复该功能需要明确上游接入目标并授权配置；本轮不改变现有网络。
- Share 对象缺失经实际服务清单确认，仅证明当前未注册服务，不断言硬件永久不支持。要恢复功能需厂商确认对应服务/固件。
- 设备重启后定制 CGI 登录本身仍返回 HTTP500。当前服务使用已验证的 T830_AUTH_TRANSPORT=ubus 标准开发者认证；没有修改 ACL。两个兼容查询仍由设备检查正常 UBUS 权限，不绕过授权。

## 实现和回归

- 声明式只读兼容入口仅覆盖 setup/gps，主 CGI 返回403/404时切换一次；写工具、其他错误不采用此兼容逻辑。保留一次队列所有权、原始请求错误与 fallback 轨迹。
- 新增 reading 解释 GPS、Ping、电话本结果，保留原始数据和告警。
- 缺少 Share 对象时只读取服务元数据；上游 WiFi 缺少数据时仅读取经授权的 STA 状态，原始配置中的密钥不进入诊断轨迹。
- 补充 Agent 调用顺序与电话本参数说明；上下文摘要按系统提示和近期消息占用后的实际空间裁剪。
- 本地完整回归：**200 项通过，0 失败**。覆盖兼容入口、原始失败保留、单次队列、Ping启动顺序和flag、默认电话本筛选、GPS未定位、STA密钥不泄露、服务缺失证据及原有功能。
- 真实 MCP：本轮启动两次有界本机诊断，均得到完整结果；未进行配置修改、重启、恢复出厂、固件、服务启停、电话本写入或任何待确认提案执行。
- 网页服务已重载。真实网页→模型→MCP验收：setup 和 phonebook_select 两次查询均 returned，模型 answered。

## 原始证据

- [真实 MCP 六项验收](../../reports/live/six-tools-2026-10-20/verification.json)
- [第一次启动诊断及初步六项探测](../../reports/live/six-tools-2026-10-20/probe.json)
- [实际设备的同名 UBUS 入口](../../reports/live/six-tools-2026-10-20/alternative-endpoints.json)
- [设备服务元数据与电话本空数据结构](../../reports/live/six-tools-2026-10-20/metadata.json)
- [STA 禁用状态](../../reports/live/six-tools-2026-10-20/wlan-context.json)
- [网页验收](../../reports/live/six-tools-2026-10-20/web-validation.json)
- [完整模拟回归日志](../../reports/mock/six-tools-regression.log)

复测入口 `node scripts/verify-six-tools.mjs` 会启动本机诊断任务，须在用户授权后运行；凭据仅通过进程环境提供，不写入脚本、日志和报告。
