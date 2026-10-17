// ════════════════════════════════════════
// DOM Event Bindings (no inline handlers)
// ════════════════════════════════════════
document.getElementById('btnCamera').addEventListener('click', openCamera);
document.getElementById('btnMic').addEventListener('click', toggleVoice);
document.getElementById('btnSend').addEventListener('click', function() { sendMessage(); });
document.getElementById('btnCloseCam').addEventListener('click', closeCamera);
document.getElementById('btnShutter').addEventListener('click', capturePhoto);
document.getElementById('btnConfig').addEventListener('click', toggleConfig);
document.getElementById('btnSaveConfig').addEventListener('click', saveConfig);
document.getElementById('input').addEventListener('keydown', handleKey);
document.getElementById('input').addEventListener('input', function() {
  autoGrow(this);
});

// 快捷按钮的多语言定义
var QUICK_ITEMS = {
  zh: [
    { label: '拍照分析', msg: '帮我拍张照片并分析' },
    { label: '你能做什么', msg: '你能做什么？' },
    { label: '今天天气', msg: '今天天气怎么样？' }
  ],
  en: [
    { label: 'Analyze photo', msg: 'Take a photo and analyze it for me' },
    { label: 'What can you do', msg: 'What can you do?' },
    { label: "Today's weather", msg: "How's the weather today?" }
  ]
};

function renderQuickActions() {
  var container = document.getElementById('quickActions');
  if (!container) return;
  container.innerHTML = '';
  var lang = (typeof CURRENT_LANG !== 'undefined') ? CURRENT_LANG : 'en';
  var items = QUICK_ITEMS[lang] || QUICK_ITEMS.en;
  items.forEach(function(item) {
    var btn = document.createElement('button');
    btn.className = 'quick-btn';
    btn.textContent = item.label;
    btn.addEventListener('click', function() { quickSend(item.msg); });
    container.appendChild(btn);
  });
}

renderQuickActions();
