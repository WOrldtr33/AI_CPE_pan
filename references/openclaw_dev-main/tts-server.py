from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import os
import time
import threading
import sys
import re

TTS_DIR = '/tmp/tts_cache'
os.makedirs(TTS_DIR, exist_ok=True)

last_request = {'text': '', 'time': 0}

EMOJI_RE = re.compile(
    u'[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF'
    u'\U0001F1E0-\U0001F1FF\U0001F900-\U0001F9FF\U0001FA00-\U0001FAFF'
    u'\u2600-\u27BF\u2300-\u23FF\u2B50\u2B55\uFE0F\u200D\u20E3]+',
    re.UNICODE
)

def clean_for_tts(text):
    # 去 emoji
    text = EMOJI_RE.sub('', text)
    # 去 markdown 符号
    text = re.sub(r'\*{1,3}', '', text)
    text = re.sub(r'#{1,6}\s*', '', text)
    text = re.sub(r'`{1,3}[^`]*`{1,3}', '', text)
    text = re.sub(r'\[([^\]]*)\]\([^\)]*\)', r'\1', text)
    text = re.sub(r'[-*+]\s+', '', text)
    text = re.sub(r'>\s+', '', text)
    text = re.sub(r'\\n', ' ', text)
    text = re.sub(r'\n{2,}', '\n', text)
    text = text.strip()
    return text

def cleanup_loop():
    while True:
        time.sleep(300)
        now = time.time()
        for f in os.listdir(TTS_DIR):
            fp = os.path.join(TTS_DIR, f)
            if now - os.path.getmtime(fp) > 600:
                try: os.remove(fp)
                except: pass

threading.Thread(target=cleanup_loop, daemon=True).start()

class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        global last_request
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        text = body.get('text', '').strip()
        voice = body.get('voice', 'zh-CN-XiaoxiaoNeural')
        rate = body.get('rate', '+0%')

        now = time.time()

        # 清理 emoji 和 markdown
        text = clean_for_tts(text)

        print("[tts] request: %s" % repr(text[:80]))

        if not text:
            print("[tts] BLOCKED: empty after cleaning")
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return

        # 10秒内相同文本不重复合成
        if text == last_request['text'] and now - last_request['time'] < 10:
            print("[tts] BLOCKED duplicate")
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return
        last_request = {'text': text, 'time': now}

        filename = 'tts_%d.mp3' % int(now * 1000)
        filepath = os.path.join(TTS_DIR, filename)

        try:
            result = subprocess.run(
                [sys.executable, '-m', 'edge_tts', '--text', text, '--voice', voice, '--rate', rate, '--write-media', filepath],
                check=True, timeout=30, capture_output=True
            )
            with open(filepath, 'rb') as f:
                audio_data = f.read()
            print("[tts] SUCCESS: %d bytes" % len(audio_data))
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(audio_data)))
            self.end_headers()
            self.wfile.write(audio_data)
        except Exception as e:
            print("[tts] ERROR: %s" % str(e))
            self.send_response(500)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass

print("TTS server starting on :9091")
HTTPServer(('0.0.0.0', 9091), TTSHandler).serve_forever()
