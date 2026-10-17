// ===== 语言切换 =====
var CURRENT_LANG = 'en';

var I18N = {
  zh: {
    brand: 'AI Assistant',
    sub: 'Powered by OpenClaw',
    welcome: '你好，有什么可以帮你？',
    welcomeDesc: '我可以文字聊天、语音对话，也能拍照分析图片内容。',
    placeholder: '输入消息...',
    connecting: '连接中...',
    connected: '已连接',
    disconnected: '已断开',
    connectFailed: '连接失败',
    openingCamera: '正在打开摄像头，请对准物体后点击拍照...',
    micError: '无法访问麦克风',
    recognizing: '识别中...',
    sttFailed: '语音识别失败',
    noSpeech: '未识别到语音，请重试',
    noServer: '未连接到服务器，请检查 Gateway 设置。',
    photoAnalyze: '请分析这张照片',
    photoDone: '[拍照完成]',
    savePhotoFailed: '保存图片失败: ',
    sendFailed: '发送失败: ',
    requestFailed: '请求失败: ',
    unknownError: '未知错误',
    ttsVoice: 'zh-CN-XiaoxiaoNeural',
    recogLang: 'zh-CN',
    aiLangHint: '',
    cfgHost: 'Gateway 地址',
    cfgToken: 'Token',
    cfgTokenPh: 'Gateway Token',
    cfgBrand: '品牌名称',
    cfgSub: '副标题',
    cfgColor: '主题色 (Hex)',
    cfgLogo: 'Logo URL (可选)',
    cfgLogoPh: 'https://...',
    cfgWelcome: '欢迎语',
    cfgSession: 'Session Key (可选)',
    cfgSessionPh: '留空使用默认',
    cfgSave: '保存并重连',
    tipCamera: '拍照',
    tipMic: '语音输入',
    tipSend: '发送'
  },
  en: {
    brand: 'AI Assistant',
    sub: 'Powered by OpenClaw',
    welcome: 'Hi, how can I help you?',
    welcomeDesc: 'I can chat, talk with voice, and analyze photos.',
    placeholder: 'Type a message...',
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    connectFailed: 'Connection failed',
    openingCamera: 'Opening camera, please aim at the object and tap the shutter...',
    micError: 'Cannot access microphone',
    recognizing: 'Recognizing...',
    sttFailed: 'Speech recognition failed',
    noSpeech: 'No speech detected, please try again',
    noServer: 'Not connected to server. Please check Gateway settings.',
    photoAnalyze: 'Please analyze this photo',
    photoDone: '[Photo captured]',
    savePhotoFailed: 'Failed to save photo: ',
    sendFailed: 'Send failed: ',
    requestFailed: 'Request failed: ',
    unknownError: 'Unknown error',
    ttsVoice: 'en-US-AriaNeural',
    recogLang: 'en-US',
    aiLangHint: '(Please reply in English.)',
    cfgHost: 'Gateway Host',
    cfgToken: 'Token',
    cfgTokenPh: 'Gateway Token',
    cfgBrand: 'Brand Name',
    cfgSub: 'Subtitle',
    cfgColor: 'Theme Color (Hex)',
    cfgLogo: 'Logo URL (optional)',
    cfgLogoPh: 'https://...',
    cfgWelcome: 'Welcome Message',
    cfgSession: 'Session Key (optional)',
    cfgSessionPh: 'Leave empty for default',
    cfgSave: 'Save & Reconnect',
    tipCamera: 'Camera',
    tipMic: 'Voice input',
    tipSend: 'Send'
  }
};

function t(key) {
  return (I18N[CURRENT_LANG] && I18N[CURRENT_LANG][key]) || I18N.zh[key] || key;
}

function applyLanguage() {
  var el;
  el = document.getElementById('welcomeTitle'); if (el) el.textContent = t('welcome');
  el = document.getElementById('welcomeDesc'); if (el) el.textContent = t('welcomeDesc');
  el = document.getElementById('input'); if (el) el.placeholder = t('placeholder');
  el = document.getElementById('brandName'); if (el && !CFG.brand) el.textContent = t('brand');
  el = document.getElementById('brandSub'); if (el && !CFG.sub) el.textContent = t('sub');

  // 按钮 tooltip
  el = document.getElementById('btnCamera'); if (el) el.title = t('tipCamera');
  el = document.getElementById('btnMic'); if (el) el.title = t('tipMic');
  el = document.getElementById('btnSend'); if (el) el.title = t('tipSend');

  // 设置面板 labels
  var panel = document.getElementById('configPanel');
  if (panel) {
    var labels = panel.querySelectorAll('label');
    var labelKeys = ['cfgHost','cfgToken','cfgBrand','cfgSub','cfgColor','cfgLogo','cfgWelcome','cfgSession'];
    for (var i = 0; i < labels.length && i < labelKeys.length; i++) {
      labels[i].textContent = t(labelKeys[i]);
    }
    var tokenInput = document.getElementById('cfgToken'); if (tokenInput) tokenInput.placeholder = t('cfgTokenPh');
    var logoInput = document.getElementById('cfgLogo'); if (logoInput) logoInput.placeholder = t('cfgLogoPh');
    var welcomeInput = document.getElementById('cfgWelcome'); if (welcomeInput) welcomeInput.placeholder = t('welcome');
    var sessionInput = document.getElementById('cfgSession'); if (sessionInput) sessionInput.placeholder = t('cfgSessionPh');
    var brandInput = document.getElementById('cfgBrand'); if (brandInput) brandInput.placeholder = t('brand');
    var subInput = document.getElementById('cfgSub'); if (subInput) subInput.placeholder = t('sub');
    var saveBtn = document.getElementById('btnSaveConfig'); if (saveBtn) saveBtn.textContent = t('cfgSave');
  }

  // 重新渲染快捷按钮
  if (typeof renderQuickActions === 'function') renderQuickActions();

  var btn = document.getElementById('btnLang');
  if (btn) {
    btn.textContent = CURRENT_LANG === 'zh' ? 'EN' : '中文';
    if (CURRENT_LANG === 'en') btn.classList.add('active-en');
    else btn.classList.remove('active-en');
  }
  document.documentElement.lang = CURRENT_LANG === 'en' ? 'en' : 'zh-CN';
}

function toggleLanguage() {
  CURRENT_LANG = (CURRENT_LANG === 'zh') ? 'en' : 'zh';
  localStorage.setItem('kiosk_lang', CURRENT_LANG);
  applyLanguage();
}

var DEFAULTS = {
  host: '',
  token: 'd44922c552d66ebf6d52c55c7f4898c4961b983cc9a90112',
  brand: 'AI Assistant',
  sub: 'Powered by OpenClaw',
  color: '#0A6EBD',
  logo: '',
  welcome: '你好，有什么可以帮你？',
  session: ''
};

function loadConfig() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('kiosk_cfg') || '{}')); }
  catch(e) { return Object.assign({}, DEFAULTS); }
}
function persistConfig(cfg) { localStorage.setItem('kiosk_cfg', JSON.stringify(cfg)); }

var CFG = loadConfig();

function applyBrand() {
  document.documentElement.style.setProperty('--brand', CFG.color);
  document.documentElement.style.setProperty('--bg-user', CFG.color);
  var brandName = document.getElementById('brandName');
  var brandSub = document.getElementById('brandSub');
  var welcomeTitle = document.getElementById('welcomeTitle');
  if (brandName) brandName.textContent = CFG.brand || DEFAULTS.brand;
  if (brandSub) brandSub.textContent = CFG.sub || DEFAULTS.sub;
  if (welcomeTitle) welcomeTitle.textContent = CFG.welcome || DEFAULTS.welcome;
  var logoBox = document.getElementById('logoBox');
  var welcomeIcon = document.getElementById('welcomeIcon');
  if (CFG.logo) {
    if (logoBox) logoBox.innerHTML = '<img src="' + CFG.logo + '" alt="logo">';
    if (welcomeIcon) welcomeIcon.innerHTML = '<img src="' + CFG.logo + '" alt="logo">';
  } else {
    var letter = (CFG.brand || 'AI').charAt(0).toUpperCase();
    if (logoBox) { logoBox.innerHTML = '<span>' + letter + '</span>'; logoBox.style.background = CFG.color; }
    if (welcomeIcon) { welcomeIcon.innerHTML = '<span>' + letter + '</span>'; welcomeIcon.style.background = CFG.color; }
  }
  var fields = ['cfgHost','cfgToken','cfgBrand','cfgSub','cfgColor','cfgLogo','cfgWelcome','cfgSession'];
  var vals = [CFG.host, CFG.token, CFG.brand, CFG.sub, CFG.color, CFG.logo, CFG.welcome, CFG.session];
  for (var i = 0; i < fields.length; i++) {
    var f = document.getElementById(fields[i]);
    if (f) f.value = vals[i];
  }
}

function saveConfig() {
  var map = {host:'cfgHost',token:'cfgToken',brand:'cfgBrand',sub:'cfgSub',color:'cfgColor',logo:'cfgLogo',welcome:'cfgWelcome',session:'cfgSession'};
  for (var k in map) { var el = document.getElementById(map[k]); if (el) CFG[k] = el.value; }
  CFG.color = CFG.color || DEFAULTS.color;
  persistConfig(CFG);
  applyBrand();
  toggleConfig();
  reconnect();
}

function toggleConfig() {
  var panel = document.getElementById('configPanel');
  if (panel) panel.classList.toggle('open');
}

var ws = null;
var reqId = 0;
var currentRunId = null;
var connectDone = false;

function nextId() { return 'kiosk-' + (++reqId) + '-' + Date.now(); }

function setStatus(state, label) {
  var dot = document.getElementById('statusDot');
  if (dot) dot.className = 'status-dot ' + state;
  var lbl = document.getElementById('statusLabel');
  if (lbl) lbl.textContent = label;
}

function getWsUrl() {
  if (CFG.host) {
    var p = location.protocol === 'https:' ? 'wss' : 'ws';
    return p + '://' + CFG.host;
  }
  var p = location.protocol === 'https:' ? 'wss' : 'ws';
  return p + '://' + location.host;
}

function connect() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) ws.close();
  var url = getWsUrl();
  console.log('[kiosk] connecting to:', url);
  setStatus('connecting', t('connecting'));
  connectDone = false;
  try { ws = new WebSocket(url); } catch (e) { console.error('[kiosk] WS error:', e); setStatus('off', t('connectFailed')); return; }

  ws.onopen = function() {
    console.log('[kiosk] WS open');
    var token = CFG.token;
    if (!token) { var m = location.hash.match(/token=([^&]+)/); if (m) token = m[1]; }
    var payload = {
      id: nextId(),
      type: 'req',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'openclaw-control-ui',
          version: '2026.3.13',
          platform: 'web',
          mode: 'webchat'
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        commands: [],
        permissions: {},
        auth: {},
        locale: navigator.language || 'zh-CN',
        userAgent: 'kiosk-chat/1.0.0'
      }
    };
    if (token) payload.params.auth.token = token;
    console.log('[kiosk] sending connect, hasToken:', !!token);
    ws.send(JSON.stringify(payload));
  };

  ws.onmessage = function(e) {
    var data;
    try { data = JSON.parse(e.data); } catch(err) { return; }
    // 过滤心跳消息，不打日志也不处理
    if (data.method === 'heartbeat' || data.method === 'ping' || data.method === 'pong'
        || (data.payload && data.payload.type === 'heartbeat_ok')
        || (data.type === 'res' && data.payload && data.payload.status === 'heartbeat_ok')) {
      return;
    }
    console.log('[kiosk] recv:', data.type, data.method || '', data.error ? JSON.stringify(data.error) : '');
    handleFrame(data);
  };

  ws.onerror = function(e) { console.error('[kiosk] WS error event'); setStatus('off', t('connectFailed')); };
  ws.onclose = function(e) {
    console.log('[kiosk] WS closed:', e.code, e.reason);
    setStatus('off', '已断开 (' + e.code + (e.reason ? ' ' + e.reason : '') + ')');
    setTimeout(function() { if (!ws || ws.readyState > 1) connect(); }, 5000);
  };
}

function reconnect() { if (ws) ws.close(); setTimeout(connect, 300); }

function handleFrame(data) {
  // connect response - check multiple ways
  if (data.type === 'res') {
    if (data.method === 'connect' || (data.payload && data.payload.type === 'hello-ok') || data.ok === true) {
      if (data.error) { setStatus('off', data.error.message || '认证失败'); }
      else if (!connectDone) { connectDone = true; console.log('[kiosk] connected!'); setStatus('', t('connected')); }
    }
    if (data.method === 'chat.send') {
      if (data.payload && data.payload.runId) currentRunId = data.payload.runId;
      if (data.error) { hideTyping(); addMessage('发送失败: ' + (data.error.message || '未知错误'), 'bot'); }
    }
    return;
  }
  // events use data.event, not data.method
  if (data.type === 'event') { console.log('[kiosk] event detail:', data.event, JSON.stringify(data.payload || {}).substring(0, 300));
    var evt = data.event;
    var p = data.payload;
    if (!p) return;

    // chat events — contains the actual message content
    if (evt === 'chat') {
      handleChatEvent(p);
      return;
    }

    // agent lifecycle events
    if (evt === 'agent') {
      handleAgentEvent(p);
      return;
    }

    // tick, presence, etc — ignore
    return;
  }
}

var streamingBubble = null;
var streamedText = '';
var ttsAlreadySpoken = false;
var hasFinalSpoken = false;
var lastSpokenText = "";
var pendingFinalText = "";

function handleAgentEvent(payload) {
  var stream = payload.stream || '';
  var phase = payload.data && payload.data.phase || '';

  // lifecycle start — prepare for response
  if (stream === 'lifecycle' && phase === 'start') {
    // 不隐藏 typing，等收到第一条内容时再隐藏
    return;
  }
  // lifecycle error
  if (stream === 'lifecycle' && phase === 'error') {
    hideTyping();
    var errMsg = (payload.data && payload.data.error) || '未知错误';
    addMessage('请求失败: ' + errMsg, 'bot');
    finalizeStream();
    return;
  }
  // lifecycle end - 不清空气泡，等 chat final 事件来处理
  if (stream === 'lifecycle' && (phase === 'end' || phase === 'done')) {
    return;
  }
  // 流式文字输出
  if (stream === 'assistant') {
    hideTyping();
    var text = (payload.data && payload.data.text) || '';
    if (text) {
      if (!streamingBubble) startStreamBubble();
      streamedText = text;
      var b = streamingBubble.querySelector('.bubble');
      if (b) b.textContent = streamedText;
      scrollToBottom();
    }
    return;
  }
  // tool use indicator
  if (stream === 'tool_call' || stream === 'tool_use') {
    var name = (payload.data && payload.data.name) || '';
    if (name) appendStream('\n[调用工具: ' + name + ']\n');
    return;
  }
}

function handleChatEvent(payload) {
  var state = payload.state || '';
  var msg = payload.message;
  if (!msg || msg.role !== 'assistant') return;

  var text = '';
  if (msg.content && Array.isArray(msg.content)) {
    msg.content.forEach(function(c) {
      if (c.type === 'text' && c.text) text += c.text;
    });
  } else if (typeof msg.content === 'string') {
    text = msg.content;
  }

  if (!text) return;

  console.log('[kiosk] chatEvent state=' + state + ' streamingBubble=' + !!streamingBubble + ' text=' + text.substring(0, 30));
  if (state === 'delta') {
    // 只暂存文字，不显示，等 TTS 就绪后再显示
    if (!streamingBubble) {
      startStreamBubble();
      streamingBubble.style.display = 'none';
    }
    streamedText = text;
  } else if (state === 'final') {
    // 不立即显示文字，等 TTS 音频就绪后再显示
    if (text && !hasFinalSpoken) {
      hasFinalSpoken = true;
      // 暂存文字，隐藏流式气泡，重新显示等待动画
      if (streamingBubble) {
        streamingBubble.style.display = 'none';
      }
      showTyping();
      pendingFinalText = text;
      speakText(text);
    } else {
      // 第二次 final 或无文字，正常处理
      if (streamingBubble && text) {
        var b = streamingBubble.querySelector('.bubble');
        if (b) b.textContent = text;
      }
      hideTyping();
      finalizeStream();
    }
  }
}

function startStreamBubble() { streamedText = ''; streamingBubble = addMessage('', 'bot'); }
function appendStream(text) { if (!streamingBubble) startStreamBubble(); streamedText += text; var b = streamingBubble.querySelector('.bubble'); if (b) b.textContent = streamedText; scrollToBottom(); }
function finalizeStream() {
  streamingBubble = null; streamedText = ''; currentRunId = null; hideTyping();
}

function messagesEl() { return document.getElementById('messages'); }
function inputEl() { return document.getElementById('input'); }

function addMessage(text, role, imgSrc) {
  var welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
  var wrapper = document.createElement('div');
  wrapper.className = 'msg ' + role;
  var bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (imgSrc) {
    var img = document.createElement('img'); img.src = imgSrc; bubble.appendChild(img);
    if (text) { var cap = document.createElement('div'); cap.className = 'caption'; cap.textContent = text; bubble.appendChild(cap); }
  } else { bubble.textContent = text; }
  wrapper.appendChild(bubble);
  messagesEl().appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function showTyping() {
  if (document.getElementById('typingIndicator')) return;
  var w = document.createElement('div'); w.className = 'msg bot'; w.id = 'typingIndicator';
  w.innerHTML = '<div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  messagesEl().appendChild(w); scrollToBottom();
}

function hideTyping() { var t = document.getElementById('typingIndicator'); if (t) t.remove(); }
function scrollToBottom() { var m = messagesEl(); requestAnimationFrame(function() { m.scrollTop = m.scrollHeight; }); }

var pendingImage = null;

function sendMessage(text) {
  var el = inputEl(); var msg = text || el.value.trim();
  if (!msg && !pendingImage) return;
  // 意图拦截：如果消息暗含视觉意图且没有待发图片，先开摄像头
  if (msg && !pendingImage && needsCamera(msg)) {
    console.log('[kiosk] camera intent detected:', msg);
    pendingCameraText = msg;
    addMessage(msg, 'user');
    el.value = ''; autoGrow(el); updateSendBtn();
    typewriterThenCamera(t('openingCamera'));
    return;
  }
  if (pendingImage) { addMessage(msg || t('photoAnalyze'), 'user', pendingImage); } else { addMessage(msg, 'user'); }
  el.value = ''; autoGrow(el); updateSendBtn(); showTyping();
  var finalMsg = msg || t('photoAnalyze');
  var hint = t('aiLangHint');
  if (hint) finalMsg = finalMsg + ' ' + hint;
  var payload = { id: nextId(), type: 'req', method: 'chat.send', params: { message: finalMsg, idempotencyKey: nextId(), sessionKey: CFG.session || 'agent:main:control-ui:webchat' } };
  if (pendingImage) {
    var mm = pendingImage.match(/^data:(image\/\w+);/);
    payload.params.attachments = [{type: "image",type: "image",
      name: 'camera-' + Date.now() + '.jpg',
      mimeType: mm ? mm[1] : 'image/jpeg',
      data: pendingImage.replace(/^data:image\/\w+;base64,/, "")
    }];
    pendingImage = null;
  }
  ttsAlreadySpoken = false;
  hasFinalSpoken = false;
  if (ws && ws.readyState === 1) { console.log('[kiosk] sending chat.send'); ws.send(JSON.stringify(payload)); }
  else { hideTyping(); addMessage(t('noServer'), 'bot'); }
}

function quickSend(text) { sendMessage(text); }
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoGrow(el) { el.style.height = '24px'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; updateSendBtn(); }
function updateSendBtn() { var b = document.getElementById('btnSend'); var i = inputEl(); if (b && i) b.disabled = !i.value.trim() && !pendingImage; }

var recognition = null;
var isRecording = false;

var mediaRecorder = null;
var audioChunks = [];
var audioContext = null;
var micStream = null;

function toggleVoice() {
  if (isRecording) { stopVoice(); return; }
  stopSpeak();

  navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 }, video: false })
  .then(function(stream) {
    micStream = stream;
    isRecording = true;
    var btn = document.getElementById('btnMic');
    if (btn) btn.classList.add('recording');

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    var source = audioContext.createMediaStreamSource(stream);
    var processor = audioContext.createScriptProcessor(4096, 1, 1);
    audioChunks = [];

    processor.onaudioprocess = function(e) {
      var float32 = e.inputBuffer.getChannelData(0);
      // 转成 16-bit PCM
      var pcm = new Int16Array(float32.length);
      for (var i = 0; i < float32.length; i++) {
        var s = Math.max(-1, Math.min(1, float32[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      audioChunks.push(pcm);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    console.log('[stt] recording started');
  })
  .catch(function(err) {
    console.error('[stt] mic error:', err);
    addMessage(t('micError'), 'bot');
  });
}

function stopVoice() {
  if (!isRecording) return;
  isRecording = false;
  var btn = document.getElementById('btnMic');
  if (btn) btn.classList.remove('recording');

  // 停止麦克风
  if (micStream) {
    micStream.getTracks().forEach(function(t) { t.stop(); });
    micStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (audioChunks.length === 0) return;

  // 合并 PCM 数据
  var totalLen = 0;
  audioChunks.forEach(function(c) { totalLen += c.length; });
  var merged = new Int16Array(totalLen);
  var offset = 0;
  audioChunks.forEach(function(c) { merged.set(c, offset); offset += c.length; });
  audioChunks = [];

  console.log('[stt] sending audio, samples:', merged.length);
  inputEl().value = t('recognizing');

  // 发送到 STT 服务
  fetch('http://127.0.0.1:9092', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: merged.buffer
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    var text = (data.text || '').trim();
    console.log('[stt] result:', text);
    if (text) {
      inputEl().value = '';
      sendMessage(text);
    } else {
      inputEl().value = '';
      addMessage(t('noSpeech'), 'bot');
    }
  })
  .catch(function(err) {
    console.error('[stt] error:', err);
    inputEl().value = '';
    addMessage(t('sttFailed'), 'bot');
  });
}

var camStream = null;

// ===== TTS 语音播报 =====
var ttsAudio = null;
var ttsEnabled = true;
var ttsSpeaking = false;

// ===== TTS 语音播报 (edge-tts) =====
var ttsQueue = [];
var ttsPlaying = false;
var ttsAudio = null;

function speakText(text) {
  console.log('[tts] speakText entry, text length=' + (text ? text.length : 0) + ' preview=' + (text || '').substring(0, 50));
  if (!text) { console.log('[tts] SKIP: no text'); return false; }

  var clean = text.replace(/\[调用工具:.*?\]/g, '')
                  .replace(/图片路径:.*$/gm, '')
                  .replace(/```[\s\S]*?```/g, '')
                  .trim();
  if (!clean || clean.length < 2) {
    console.log('[tts] SKIP: too short after clean, length=' + (clean ? clean.length : 0) + ' clean=' + (clean || ''));
    return false;
  }

  // 去 emoji 后比较，防重复
  var compareText = clean.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').replace(/[\u2600-\u27BF\u2300-\u23FF\u2B50\u2B55\uFE0F\u200D\u20E3]/g, '').trim();
  if (compareText === lastSpokenText) {
    console.log('[tts] BLOCKED duplicate');
    return false;
  }
  lastSpokenText = compareText;

  stopSpeak();
  ttsQueue = [clean];
  ttsPlaying = true;
  playNextInQueue();
  return true;
}

function playNextInQueue() {
  if (!ttsPlaying || ttsQueue.length === 0) {
    ttsPlaying = false;
    return;
  }
  var sentence = ttsQueue.shift();
  console.log('[tts] synthesizing: ' + sentence.substring(0, 40));

  fetch('http://127.0.0.1:9091', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sentence, voice: t('ttsVoice'), rate: '+20%' })
  })
  .then(function(res) {
    if (!res.ok || res.status === 204) { playNextInQueue(); return; }
    return res.blob();
  })
  .then(function(blob) {
    if (!blob) return;
    var url = URL.createObjectURL(blob);
    ttsAudio = new Audio(url);
    // 第一句音频就绪，显示暂存的文字
    if (pendingFinalText) {
      hideTyping();
      if (streamingBubble) {
        streamingBubble.style.display = '';
        var b = streamingBubble.querySelector('.bubble');
        if (b) b.textContent = pendingFinalText;
        scrollToBottom();
      } else {
        addMessage(pendingFinalText, 'bot');
      }
      pendingFinalText = '';
      finalizeStream();
    }
    ttsAudio.onended = function() {
      URL.revokeObjectURL(url);
      playNextInQueue();
    };
    ttsAudio.onerror = function() { ttsPlaying = false; };
    ttsAudio.play();
  })
  .catch(function(err) {
    console.error('[tts] error:', err);
    ttsPlaying = false;
  });
}

function stopSpeak() {
  ttsQueue = [];
  ttsPlaying = false;
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio.currentTime = 0;
    ttsAudio = null;
  }
}

// ===== 摄像头意图识别 =====
var pendingCameraText = null;  // 暂存用户原始文字，拍照后一起发

var CAMERA_PATTERNS = [
  /这是什么/,
  /这个是什么/,
  /那是什么/,
  /那个是什么/,
  /帮我看/,
  /你看看/,
  /看一下/,
  /看一看/,
  /看看这/,
  /认一下/,
  /识别/,
  /拍个照/,
  /拍一下/,
  /拍照/,
  /扫一下/,
  /扫一扫/,
  /什么东西/,
  /什么型号/,
  /什么牌子/,
  /什么零件/,
  /什么物体/,
  /什么产品/,
  /面前的/,
  /眼前的/,
  /桌上的/,
  /手里的/,
  /手上的/,
  /给你看/,
  /你认识/,
  /你能认出/,
  /看图/,
  /图片分析/,
  /物体识别/,
  // 英文触发词
  /what is this/i,
  /what's this/i,
  /whats this/i,
  /what is that/i,
  /what's that/i,
  /whats that/i,
  /take a (photo|picture|pic|shot)/i,
  /take a look/i,
  /let me show you/i,
  /show you something/i,
  /can you see/i,
  /do you see/i,
  /identify this/i,
  /identify that/i,
  /recognize this/i,
  /recognize that/i,
  /scan this/i,
  /scan that/i,
  /look at this/i,
  /look at that/i,
  /check this out/i,
  /what do you see/i,
  /in front of me/i,
  /on the table/i,
  /in my hand/i,
];

function needsCamera(text) {
  if (!text) return false;
  for (var i = 0; i < CAMERA_PATTERNS.length; i++) {
    if (CAMERA_PATTERNS[i].test(text)) return true;
  }
  return false;
}

function typewriterThenCamera(text) {
  var wrapper = document.createElement('div');
  wrapper.className = 'msg bot';
  var bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = '';
  wrapper.appendChild(bubble);
  messagesEl().appendChild(wrapper);
  scrollToBottom();

  var i = 0;
  var speed = 50; // 每个字50ms
  var timer = setInterval(function() {
    if (i < text.length) {
      bubble.textContent += text.charAt(i);
      i++;
      scrollToBottom();
    } else {
      clearInterval(timer);
      // 打字完成，等500ms再开摄像头
      setTimeout(function() { openCamera(); }, 500);
    }
  }, speed);
}

function openCamera() {
  var modal = document.getElementById('cameraModal');
  var video = document.getElementById('camVideo');
  if (modal) modal.classList.add('open');
  // 延迟一下再请求，给设备释放的时间
  setTimeout(function() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
    .then(function(stream) { camStream = stream; video.srcObject = stream; video.play(); })
    .catch(function(err) { console.error('Camera error:', err); closeCamera(); addMessage(t('micError'), 'bot'); });
  }, 500);
}

function capturePhoto() {
  var video = document.getElementById('camVideo');
  var canvas = document.getElementById('camCanvas');
  // 确保视频已经有画面
  if (video.readyState < 2) {
    console.log('[kiosk] video not ready, waiting...');
    video.addEventListener('loadeddata', function() { capturePhoto(); }, { once: true });
    return;
  }
  // resize to max 800px on longest side
  var maxSize = 800;
  var w = video.videoWidth;
  var h = video.videoHeight;
  if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
  else if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
  canvas.width = w;
  canvas.height = h;
  console.log('[kiosk] capture: videoW=' + video.videoWidth + ' videoH=' + video.videoHeight + ' canvasW=' + w + ' canvasH=' + h + ' readyState=' + video.readyState + ' paused=' + video.paused);
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  // 解决硬件加速导致 drawImage 黑屏的问题
  video.style.transform = 'translateZ(0)';
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(video, 0, 0, w, h);
  var imageDataUrl = canvas.toDataURL('image/jpeg', 0.6);
  console.log('[kiosk] photo size:', Math.round(imageDataUrl.length / 1024) + 'KB');
  console.log('[kiosk] dataUrl start:', imageDataUrl.substring(0, 80));
  closeCamera();

  // 如果有暂存文字（意图触发），用原始文字；否则用默认文字
  var cameraText = pendingCameraText || t('photoAnalyze');
  pendingCameraText = null;

  if (!document.querySelector('.msg.user:last-child')) {
    addMessage(cameraText, 'user', imageDataUrl);
  } else {
    // 意图触发时用户消息已经显示过了，只显示图片
    addMessage(t('photoDone'), 'user', imageDataUrl);
  }
  showTyping();
  // 先保存图片到本地，再告诉 AI 图片路径
  fetch('http://127.0.0.1:9090/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: imageDataUrl })
  }).then(function(r) { return r.json(); }).then(function(res) {
    console.log('[kiosk] photo saved to:', res.path);
    var hint = t('aiLangHint');
    var userPrompt = cameraText + ' 图片路径: ' + res.path + (hint ? ' ' + hint : '');
    var payload = {
      id: nextId(), type: 'req', method: 'chat.send',
      params: {
        message: userPrompt,
        idempotencyKey: nextId(),
        sessionKey: CFG.session || 'agent:main:control-ui:webchat'
      }
    };
    if (ws && ws.readyState === 1) {
      console.log('[kiosk] sending image path via WebSocket');
      hasFinalSpoken = false;
      lastSpokenText = '';
      pendingFinalText = '';
      ws.send(JSON.stringify(payload));
    } else {
      hideTyping();
      addMessage('未连接到服务器', 'bot');
    }
  }).catch(function(err) {
    console.error('[kiosk] save photo error:', err);
    hideTyping();
    addMessage('保存图片失败: ' + err.message, 'bot');
  });
}
function sendImageViaHttp(imageDataUrl, text) {
  var token = CFG.token;
  if (!token) { var m = location.hash.match(/token=([^&]+)/); if (m) token = m[1]; }

  var apiUrl = location.protocol + '//' + location.host + '/v1/chat/completions';

  var body = {
    model: 'openclaw',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: text || t('photoAnalyze') },
        { type: 'image_url', image_url: { url: imageDataUrl } }
      ]
    }],
    stream: false
  };

  console.log('[kiosk] sending image via HTTP API');

  fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(body)
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    hideTyping();
    console.log('[kiosk] HTTP API response:', data);
    if (data.error) {
      addMessage('分析失败: ' + (data.error.message || '未知错误'), 'bot');
      return;
    }
    var reply = '';
    if (data.choices && data.choices[0] && data.choices[0].message) {
      reply = data.choices[0].message.content || '';
    }
    if (reply) {
      addMessage(reply, 'bot');
    } else {
      addMessage('未收到分析结果', 'bot');
    }
  })
  .catch(function(err) {
    hideTyping();
    console.error('[kiosk] HTTP API error:', err);
    addMessage('请求失败: ' + err.message, 'bot');
  });
}

function closeCamera() {
  var modal = document.getElementById('cameraModal');
  var video = document.getElementById('camVideo');
  if (modal) modal.classList.remove('open');
  if (camStream) { camStream.getTracks().forEach(function(t) { t.stop(); }); camStream = null; }
  if (video) video.srcObject = null;
}

applyBrand();
applyLanguage();
var langBtn = document.getElementById('btnLang');
if (langBtn) langBtn.addEventListener('click', toggleLanguage);
connect();
var inp = inputEl();
if (inp) inp.addEventListener('input', updateSendBtn);
