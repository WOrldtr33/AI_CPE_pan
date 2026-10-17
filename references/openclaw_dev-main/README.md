i# OpenClaw Kiosk 智能交互终端

基于 OpenClaw + ARM 开发板打造的自助式 AI 交互终端。支持文字聊天、语音对话、摄像头拍照识别，全栈中英双语，适合展厅、前台、零售等无人值守场景。

---

## 一、功能概览

| 能力 | 实现 | 是否联网 |
| --- | --- | --- |
| 文字聊天 | OpenClaw Gateway + Kimi Code 模型 | 是（模型调用） |
| 语音合成 (TTS) | edge-tts（微软） | 是 |
| 语音识别 (STT) | sherpa-onnx（本地推理） | 否 |
| 摄像头拍照 + AI 分析 | USB 摄像头 + 本地图片服务 | 是（模型调用） |
| 摄像头意图自动触发 | 前端关键词正则（中英双语） | 否 |
| 全屏 Kiosk 展示 | Chromium Kiosk Mode + lightdm 自动登录 | 否 |
| 开机自启 | 定制的 kiosk.sh + systemd service | 否 |

---

## 二、硬件与系统

| 项目 | 配置 |
| --- | --- |
| 主控 | Rockchip 系列 ARM 开发板（aarch64） |
| 操作系统 | Debian (Linaro) |
| 桌面 / 显示 | lightdm + openbox + Chromium |
| 音频输出 | 板载 ES8388 声卡 + 3.5mm 耳机孔（HDMI 音频已禁用） |
| 麦克风 | USB 摄像头自带的 mono 麦克风（card 3） |
| 摄像头 | USB 全高清摄像头（/dev/video20） |
| 网络 | 有线 / Wi-Fi（需能访问 Kimi API 与 edge-tts） |

---

## 三、整体架构

```
                  ┌─────────────────────────────────┐
                  │     Chromium (Kiosk Mode)       │
                  │    http://127.0.0.1:8080/       │
                  └──────────────┬──────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │       Nginx 反向代理 :8080       │
                │  （去掉 CSP / Permissions-Policy）│
                └────────────────┬────────────────┘
                                 │
         ┌───────────────────────┴───────────────────────┐
         │                                               │
         │  OpenClaw Gateway :18789                      │
         │   ├── WebSocket ( chat / agent / events )     │
         │   ├── controlUi.root → /home/linaro/.openclaw/kiosk │
         │   └── trustedProxies = ["127.0.0.1"]          │
         │                                               │
         └───────────────────────┬───────────────────────┘
                                 │
                   ┌─────────────┴──────────────┐
                   │    Kimi Code 模型（云端）   │
                   └────────────────────────────┘

     ┌──────────────────────────────────────────────────┐
     │  辅助服务（本地 HTTP，前端通过 fetch 调用）       │
     ├──────────────────────────────────────────────────┤
     │  photo-server   :9090   拍照图片保存到本地       │
     │  tts-server     :9091   edge-tts 语音合成        │
     │  stt-server     :9092   sherpa-onnx 语音识别     │
     └──────────────────────────────────────────────────┘
```

### 关键端口

| 端口 | 服务 | 说明 |
| --- | --- | --- |
| 18789 | OpenClaw Gateway | AI 核心服务，loopback only |
| 8080  | Nginx 反代 | 对前端暴露，去掉安全头 |
| 9090  | photo-server | 接收 base64 图片，保存到 `.openclaw/kiosk/photos/` |
| 9091  | tts-server | POST 文字，返回 mp3 |
| 9092  | stt-server | POST PCM，返回识别文字 |

---

## 四、目录结构

```
/home/linaro/.openclaw/kiosk/
├── index.html              前端入口
├── style.css               样式
├── app.js                  核心逻辑（WebSocket / TTS / STT / 摄像头 / i18n）
├── events.js               事件绑定 + 快捷按钮（i18n）
├── tts-server.py           edge-tts HTTP 服务
├── stt-server.py           sherpa-onnx HTTP 服务
├── photo-server.py         拍照保存 HTTP 服务
├── asr-models/             sherpa-onnx 模型文件
│   ├── encoder-*.onnx
│   ├── decoder-*.onnx
│   ├── joiner-*.onnx
│   └── tokens.txt
├── photos/                 拍照保存目录
└── README.md

/usr/bin/kiosk.sh           开机启动脚本
/etc/lightdm/lightdm.conf.d/autologin.conf   自动登录到 kiosk 会话
/usr/share/xsessions/kiosk.desktop           kiosk 会话定义
/etc/nginx/sites-enabled/openclaw            Nginx 反代配置
/home/linaro/fix-audio.sh                    开机强制禁用 HDMI 音频
```

---

## 五、核心流程

### 5.1 文字对话流程

1. 用户在页面输入文字，点发送
2. 前端 `sendMessage()` 构造消息：
   - 附加语言提示（英文模式下追加 `(Please reply in English.)`）
   - 如果命中摄像头关键词，拦截并先打开摄像头（见 5.3）
3. WebSocket 把 `chat.send` 发给 Gateway
4. Gateway 调 Kimi Code 模型，流式返回 `chat` / `agent` 事件
5. 前端只在 `state === 'final'` 时：
   - 触发 TTS 合成（整段一次，不分句）
   - 音频就绪后同时显示文字气泡 + 播放语音（避免一闪而过）

### 5.2 语音输入流程（STT）

1. 用户点麦克风按钮 → `getUserMedia()` 请求麦克风
2. `AudioContext` + `ScriptProcessorNode` 采集 Float32 音频流
3. 再次点击停止，合并所有 chunk 转成 16-bit PCM 16kHz 单声道
4. `fetch('http://127.0.0.1:9092', {body: pcm.buffer})`
5. 后端用 sherpa-onnx 离线识别，返回识别文本
6. 前端把文本填入输入框并自动发送

### 5.3 摄像头流程（含智能意图触发）

**手动触发：** 点摄像头按钮 → 打开摄像头 → 拍照

**自动触发（智能）：** 用户输入 `"这是什么" / "what is this" / "take a photo"` 等关键词
1. `needsCamera()` 正则匹配，命中则暂存文字
2. 显示"正在打开摄像头"的打字机效果提示
3. 打字完成后自动弹出摄像头界面
4. 拍照 → POST 给 photo-server 存盘 → 把图片路径 + 原始文字 + 语言提示拼接后发给 AI

### 5.4 TTS 播报流程

1. AI 回复的 `final` 事件到达
2. 前端隐藏流式气泡，保持等待动画
3. 调 `speakText()` 整段发给 tts-server
4. 服务端过滤 emoji 和 markdown 符号，做 10 秒内相同文本去重
5. `fetch` 返回 mp3 Blob，用 `new Audio()` 播放
6. 音频就绪瞬间显示文字气泡、隐藏动画

---

## 六、关键技术难点与解决

### 6.1 音频输出：HDMI 抢占问题
**现象：** HDMI 显示器无喇叭，PipeWire 默认把音频输出到 HDMI
**尝试：** `wpctl set-default` / `pactl set-default-sink` / WirePlumber 优先级配置均无效
**最终方案：** 禁用 HDMI 音频 profile，强制走板载声卡
```bash
pactl set-card-profile alsa_card.platform-hdmi-sound off
```

### 6.2 OpenClaw 双重 final 事件
**现象：** Gateway 对每条回复发两次 `state=final`，一次带 emoji 一次不带，前端被调两次 TTS
**方案：** `hasFinalSpoken` 标记只放行第一次；`speakText` 内部用"去 emoji 后的 text"做 `lastSpokenText` 去重；服务端再加一道 10 秒窗口去重作保险

### 6.3 短回复/纯 emoji 导致界面卡死
**现象：** AI 回 `"?"` 这种一个字的回复，`speakText` 过滤后为空直接 return，但 `streamingBubble` 已隐藏、等待动画已显示，无人清理状态
**方案：** `speakText` 返回 `true/false`，调用方根据返回值决定是否手动显示文字 + 清理状态

### 6.4 ISP 设备干扰摄像头识别
**现象：** RK 平台的 ISP 内部 video 节点干扰 Chromium 识别真正的 USB 摄像头
**方案：** 开机脚本用 `chmod 000 /dev/video*`（除 video20）隐藏所有非 USB 摄像头的视频设备

### 6.5 Permissions-Policy 禁用摄像头/麦克风
**现象：** Gateway 返回的 `Permissions-Policy` 头把摄像头麦克风全禁了
**方案：** Nginx 反代中 `proxy_hide_header Permissions-Policy` 去掉原始头，`add_header` 重新放开

### 6.6 Nginx 反代导致"非本地"请求
**现象：** `[ws] Proxy headers detected from untrusted address`，Gateway 拒绝请求
**方案：** `openclaw config set gateway.trustedProxies '["127.0.0.1"]' --strict-json`

### 6.7 连续拍照第二张不触发 TTS
**根因：** 拍照 WebSocket 发送路径不经过 `sendMessage`，`hasFinalSpoken` 标记没重置
**方案：** 在 `capturePhoto` 发送图片前也加 `hasFinalSpoken = false; lastSpokenText = ''; pendingFinalText = '';`

---


## 六·五、模型文件准备（首次部署）

模型文件较大（>300MB），未纳入版本库。首次部署时手动下载：

### STT 模型（sherpa-onnx 流式中英双语）

```bash
mkdir -p /home/linaro/.openclaw/kiosk/asr-models
cd /home/linaro/.openclaw/kiosk/asr-models

BASE=https://hf-mirror.com/csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/resolve/main

wget $BASE/encoder-epoch-99-avg-1.onnx
wget $BASE/decoder-epoch-99-avg-1.onnx
wget $BASE/joiner-epoch-99-avg-1.onnx
wget $BASE/tokens.txt
```

### TTS 模型（可选，当前默认使用 edge-tts 云端）

如果需要离线 TTS，下载 Piper 中文模型：

```bash
mkdir -p /home/linaro/.openclaw/kiosk/piper-models
cd /home/linaro/.openclaw/kiosk/piper-models

wget https://hf-mirror.com/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx
wget https://hf-mirror.com/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json
```

### Python 依赖

```bash
pip3 install sherpa-onnx edge-tts --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple
```

---

## 七、启动方式

### 7.1 开机自启（默认）

系统启动后，lightdm 自动以 `linaro` 用户登录 `kiosk` 会话，执行 `/usr/bin/kiosk.sh`：

```bash
#!/bin/sh

# 1. 等 OpenClaw Gateway 就绪
while ! curl -s http://127.0.0.1:18789/ > /dev/null 2>&1; do sleep 2; done

# 2. 禁用 HDMI 音频
pactl set-card-profile alsa_card.platform-hdmi-sound off 2>/dev/null

# 3. 隐藏 ISP video 设备
for dev in /dev/video*; do
    case "$dev" in
        /dev/video20) ;;
        *) sudo chmod 000 "$dev" 2>/dev/null ;;
    esac
done

# 4. 启动辅助服务
python3 /home/linaro/.openclaw/kiosk/photo-server.py >> /tmp/photo-server.log 2>&1 &
python3 /home/linaro/.openclaw/kiosk/tts-server.py   >> /tmp/tts-server.log   2>&1 &
python3 /home/linaro/.openclaw/kiosk/stt-server.py   >> /tmp/stt-server.log   2>&1 &

sleep 3

# 5. 启动 Chromium Kiosk
openbox &
chromium --kiosk \
    --no-first-run \
    --use-fake-ui-for-media-stream \
    --autoplay-policy=no-user-gesture-required \
    --unsafely-treat-insecure-origin-as-secure="http://127.0.0.1:8080" \
    --enable-features=InsecureOriginAsSecure \
    "http://127.0.0.1:8080/"
```

`/etc/lightdm/lightdm.conf.d/autologin.conf`：

```ini
[Seat:*]
autologin-user=linaro
autologin-session=kiosk
user-session=kiosk
```

### 7.2 切换到调试模式（XFCE 桌面）

```bash
sudo tee /etc/lightdm/lightdm.conf.d/autologin.conf << 'EOF'
[Seat:*]
autologin-user=linaro
autologin-session=xfce
user-session=xfce
EOF
sudo systemctl restart lightdm
```

### 7.3 调试模式下手动启动各服务

```bash
# OpenClaw Gateway (systemd 用户服务)
systemctl --user start openclaw-gateway

# 辅助服务
python3 /home/linaro/.openclaw/kiosk/photo-server.py &
python3 /home/linaro/.openclaw/kiosk/tts-server.py &
python3 /home/linaro/.openclaw/kiosk/stt-server.py &

# 验证端口
ss -tlnp | grep -E "9090|9091|9092|18789"

# 浏览器访问
# http://127.0.0.1:8080/
```

### 7.4 恢复 Kiosk 自启

```bash
sudo tee /etc/lightdm/lightdm.conf.d/autologin.conf << 'EOF'
[Seat:*]
autologin-user=linaro
autologin-session=kiosk
user-session=kiosk
EOF
sudo systemctl restart lightdm
```

---

## 八、关键配置文件

### 8.1 OpenClaw 关键配置

`~/.openclaw/openclaw.json` 中的关键项：

```json
{
  "gateway": {
    "bind": "loopback",
    "trustedProxies": ["127.0.0.1"],
    "controlUi": {
      "root": "/home/linaro/.openclaw/kiosk",
      "allowInsecureAuth": true,
      "dangerouslyAllowHostHeaderOriginFallback": true,
      "dangerouslyDisableDeviceAuth": true,
      "allowedOrigins": ["http://127.0.0.1:8080", "http://localhost:8080"]
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "kimi/kimi-code" }
    }
  }
}
```

### 8.2 Nginx 反代

`/etc/nginx/sites-enabled/openclaw`（核心片段）：

```nginx
server {
    listen 8080;
    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        # 移除限制性响应头
        proxy_hide_header Permissions-Policy;
        proxy_hide_header Content-Security-Policy;

        # 放开摄像头/麦克风权限
        add_header Permissions-Policy "camera=*, microphone=*, geolocation=*";
    }
}
```

---

## 九、前端 i18n 机制

`app.js` 里定义 `I18N = {zh: {...}, en: {...}}` 字典。通过 `t(key)` 函数取值，`applyLanguage()` 在切换时批量更新：

- 欢迎语、占位符、状态提示
- 按钮 tooltip（拍照/语音/发送）
- 设置面板 label + placeholder + 保存按钮
- 快捷按钮（由 `events.js` 的 `renderQuickActions()` 处理）
- AI 语言提示（发送消息时自动追加 `aiLangHint`）
- TTS 音色（zh-CN-XiaoxiaoNeural / en-US-AriaNeural）

**当前默认：** 固定英文，语言切换按钮已隐藏（后续再开放）。修改位置：

```javascript
var CURRENT_LANG = 'en';   // app.js 开头
```

---

## 十、摄像头意图触发关键词

定义在 `app.js` 的 `CAMERA_PATTERNS`：

**中文（24 条）**：这是什么 / 帮我看 / 认一下 / 识别 / 拍照 / 扫一扫 / 什么东西 / 面前的 / 给你看 / 看图 / 图片分析 等

**英文（20+ 条）**：what is this / take a photo / identify / recognize / scan / look at this / in front of me / on the table 等（`/i` 大小写不敏感）

---

## 十一、故障排查速查

| 现象 | 排查步骤 |
| --- | --- |
| 页面 502/连接失败 | `systemctl --user status openclaw-gateway` |
| 页面空白 | `sudo systemctl status nginx` + `curl http://127.0.0.1:8080/` |
| 无语音输出 | `wpctl status` 看默认 sink 是否板载声卡；耳机是否插入 |
| TTS 无响应 | `ss -tlnp \| grep 9091` + `tail /tmp/tts-server.log` |
| STT 识别空 | `tail /tmp/stt-server.log`；麦克风权限；录音长度 |
| 摄像头打不开 | 检查 `/dev/video20` 存在且权限 660+ |
| AI 不回复 | Gateway 日志 `/tmp/openclaw/openclaw-*.log`，可能上下文满或 API 限流 |
| 连续拍照第二张无语音 | 检查 `hasFinalSpoken / lastSpokenText / pendingFinalText` 是否重置 |
| HDMI 插入后没声音 | 重新执行 `pactl set-card-profile alsa_card.platform-hdmi-sound off` |

---

## 十二、已知限制

- **TTS 联网依赖**：edge-tts 需要访问微软服务器，离线环境需换 Piper/sherpa-onnx TTS
- **上下文无自动压缩**：OpenClaw 未配 compaction，长对话可能卡住（临时方案：清理 `~/.openclaw/agents/main/sessions/*` 重启 Gateway）
- **浏览器 SpeechRecognition 不可用**：原生 API 依赖 Google 服务器，已改用 sherpa-onnx 替代
- **STT 非流式**：模型本身支持流式，当前实现是整段识别，后续优化
- **语言切换按钮暂时隐藏**：后续规划功能

---

## 十三、后续规划

- [ ] 流式 STT（边说边出字）
- [ ] 开放语言切换按钮 + 自动检测
- [ ] 上下文自动压缩避免长对话卡住
- [ ] 离线 TTS 方案（Piper 或 sherpa-onnx TTS）
- [ ] 多轮对话记忆管理
- [ ] 声纹识别 / 多用户场景
