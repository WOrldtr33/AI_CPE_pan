import asyncio
import json
import wave
import struct
import sherpa_onnx
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import time
import os

MODEL_DIR = '/home/linaro/.openclaw/kiosk/asr-models'

recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
    encoder=MODEL_DIR + '/encoder-epoch-99-avg-1.onnx',
    decoder=MODEL_DIR + '/decoder-epoch-99-avg-1.onnx',
    joiner=MODEL_DIR + '/joiner-epoch-99-avg-1.onnx',
    tokens=MODEL_DIR + '/tokens.txt',
    num_threads=2,
)

print("[stt] model loaded")

class STTHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        audio_data = self.rfile.read(length)

        # 期望接收 16-bit PCM, 16kHz, mono
        samples = []
        for i in range(0, len(audio_data), 2):
            if i + 1 < len(audio_data):
                sample = struct.unpack('<h', audio_data[i:i+2])[0]
                samples.append(sample / 32768.0)

        if not samples:
            self.send_response(400)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(b'{"error":"no audio"}')
            return

        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)

        tail_paddings = [0.0] * int(16000 * 0.3)
        stream.accept_waveform(16000, tail_paddings)
        stream.input_finished()

        while recognizer.is_ready(stream):
            recognizer.decode_stream(stream)

        result = recognizer.get_result(stream)
        text = result if isinstance(result, str) else str(result)
        text = text.strip()

        print("[stt] result: %s" % text)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({"text": text}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass

print("[stt] STT server starting on :9092")
HTTPServer(('0.0.0.0', 9092), STTHandler).serve_forever()
