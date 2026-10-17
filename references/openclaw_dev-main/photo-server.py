from http.server import HTTPServer, BaseHTTPRequestHandler
import json, base64, time, os

PHOTO_DIR = '/home/linaro/.openclaw/kiosk/photos'
os.makedirs(PHOTO_DIR, exist_ok=True)

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(length))
        b64 = body.get('data', '').replace('data:image/jpeg;base64,', '').replace('data:image/png;base64,', '')
        fname = 'photo-%d.jpg' % int(time.time() * 1000)
        fpath = os.path.join(PHOTO_DIR, fname)
        with open(fpath, 'wb') as f:
            f.write(base64.b64decode(b64))
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'path': fpath}).encode())
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    def log_message(self, *a): pass

HTTPServer(('127.0.0.1', 9090), Handler).serve_forever()
