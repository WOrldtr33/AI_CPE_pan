# 晴空仪表盘

当前网页首页采用 React + TypeScript + Vite，动画由 GSAP 与 Three.js 实现。构建产物由原有 Media service 提供，同一个 Agent / MCP 后端继续工作。

## 启动

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1 --web
```

打开终端打印的完整网页链接。修改前端源码后执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-dashboard.ps1
```

构建脚本兼容当前未配置 node PATH 的电脑。依赖位于 frontend/node_modules，锁定版本在 frontend/package-lock.json；换电脑后安装 Node.js 并在 frontend 中运行 npm ci。页面已构建，日常启动不需要重新安装依赖。

## 功能与数据边界

- 首页展示终端设备 → AI CPE → 上联网络 / 云端，连接数来自设备终端数量，并非人数。上联状态不等于已验证的互联网可达性。
- 状态每 5 秒轮询；设备、地址、终端数量等详情通常缓存 30 秒，手动刷新强制查询。闲置轮询仅调用白名单读工具，不消耗模型 tokens。
- 流量图支持时间范围、滚轮缩放、拖动回看、双指缩放、方向键移动与返回此刻。浮标显示采样点速率，底部显示所选区间近似流量。
- 无有效非零真实流量时默认展示明确标识的演示曲线，可点击“演示流量”切换“真实采集”。演示数据不会发送到 CPE，也不会计入真实采集历史。脚本 scripts/dashboard-demo.mjs 可单独导出演示样本。
- 正数 DLrate/ULrate 的单位在现有设备文档中尚未核实，不猜测换算。核实后可设置 DASHBOARD_RATE_UNIT 为 B/s、KB/s、MB/s、bps、Kbps 或 Mbps。未配置时仅零值可安全进入真实曲线。
- 真实历史保存在 .media-state/dashboard-history.json，最多 50000 个点。按设备身份隔离，检测到设备重新开机后清空；只包含实际采集的区间，不能补回未运行页面时的数据。
- 网络质量缺少经验证的测量指标时显示“质量待测”；上联断开时显示“上联未连接”，不会凭接口调用成功填满信号格。
- 页面连接助手后自动开启语音待机，首次需允许麦克风权限。在主界面直接说 Hi Claude 即可交流，不自动展开聊天文字。点击 AI 球体可查看同一轮问答与当前处理状态；收起聊天框不停止录音或打断回答。主界面可关闭语音唤醒，该选择在本浏览器保留；若浏览器要求手势激活声音，轻触主界面的“开启语音唤醒”即可重试。
- AI 球体原地进入交互，展示最近一轮问答、快捷选项、语音待机与经确认的单次拍照。沿用 Hi Claude 唤醒、本地温和降噪、连续采集与分段提交。语音讲口语摘要、屏幕显示完整回答；可选两种调校音色与 0.85～1.20 倍语速，详见[界面与声音细化](UI_REFINEMENTS.md)。文本随对应音频开始播放时出现，播报失败时回退文字。设备写操作仍需展开聊天框明确确认，语音唤醒不代替批准。
- “媒体采集与监测任务”保留旧媒体工作台，负责完整的监测计划确认、采集与图文报告。尚未把这部分任务卡重新设计到首页。
- 设置只开放现有 Agent 白名单中的 UPnP 写操作，并要求启用 Agent 写权限。预览不会写入；确认后回读验证；撤回重新生成反向提案，再次确认并校验设备现状。退出取消未确认提案并清空草稿与提示，已保存设置保留。撤回凭据保存在当前服务进程内，重启后不可通过此入口撤回。
- 下拉栏提供音量、亮度、柔和显示、减少动效与演示流量开关。PC 亮度调整页面遮罩，音量控制应用播报。Android 系统亮度 / 音量仍需实现原生桥接，当前未生成 APK 或进行板端驱动验证。

## 代码入口

| 文件 | 职责 |
| --- | --- |
| frontend/src/App.tsx | 首页、设置、快捷栏与 AI 状态 |
| frontend/src/Traffic.tsx | SVG 流量曲线及缩放、平移、采样标记 |
| frontend/src/Orb.tsx | 球体、轨道、粒子与 WebGL 失败时的 CSS 降级 |
| frontend/src/device.ts | 音频采集、播报、语音会话与将来 Android 桥接入口 |
| frontend/src/style.css | 天空主题、布局、磨砂效果与适配 |
| src/dashboard.mjs | 设备数据归一化、读查询、历史、确认和撤回提案 |
| media/service.mjs | 首页静态资源、/api/dashboard 路由及原媒体服务 |
| media/public/ | 保留的媒体工作台，入口 /legacy |

## 验证

- 最新测试结果见 reports/mock/dashboard-ui-results.json 与 test/；确认与撤回、语速、摘要等测试均使用固定输入或模拟设备，确认与撤回测试使用模拟设备，不对实机写入。
- scripts/dashboard-ui-smoke.mjs：Chrome 桌面 / 390px 手机布局、缩放 / 历史、快捷栏、确认 / 撤回、原地 AI 问答及模拟麦克风语音链路。
- scripts/media-ui-smoke.mjs：旧工作台语音、单次拍照确认、后台监测与报告下载回归。
- 截图在 reports/mock/dashboard-desktop.png、dashboard-ai.png、dashboard-mobile.png；截图中的设备状态及流量属于模拟验证，不代表实际网络质量。
