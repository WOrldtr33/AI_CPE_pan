"""Local wake detection and conservative denoising; no speaker identity. JSON-lines, no network."""
import base64
import io
import json
import sys
import wave
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / 'packages'))
import numpy as np
import sherpa_onnx
from wake_match import find_wake, aligned_span
from voice_denoise import denoise

model = root / 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
kws = sherpa_onnx.KeywordSpotter(
    tokens=str(model / 'tokens.txt'),
    encoder=str(model / 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx'),
    decoder=str(model / 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx'),
    joiner=str(model / 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx'),
    keywords_file=str(Path(__file__).with_name('wake-keywords-en.txt')),
    num_threads=2, keywords_score=5, keywords_threshold=0.10, provider='cpu')
wake_asr = None

def pronunciation_check(samples):
    global wake_asr
    if wake_asr is None:
        wake_asr = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=str(root / 'wake-asr' / 'model.int8.onnx'), tokens=str(root / 'wake-asr' / 'tokens.txt'),
            num_threads=2, language='auto', use_itn=True)
    stream = wake_asr.create_stream()
    stream.accept_waveform(16000, samples)
    wake_asr.decode_stream(stream)
    result = stream.result
    match = find_wake(result.text)
    span = aligned_span(result.text, result.tokens, result.timestamps, match) if match else None
    return result.text, match.group(0) if match else '', span

def analyze(request):
    with wave.open(io.BytesIO(base64.b64decode(request['audio'], validate=True))) as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() != 16000:
            raise ValueError('invalid wav')
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768
    if len(samples) > 16000 * 30:
        raise ValueError('too long')
    samples = denoise(samples)
    wake, times, method, wake_text, alias, fallback_span = False, [], 'none', '', '', None
    if request.get('detectWake', True):
        stream = kws.create_stream()
        stream.accept_waveform(16000, samples)
        stream.accept_waveform(16000, np.zeros(16000, dtype=np.float32))
        stream.input_finished()
        while kws.is_ready(stream):
            kws.decode_stream(stream)
            detection = kws.keyword_spotter.get_result(stream)
            if detection.keyword.strip():
                wake, times = True, list(detection.timestamps)
                method = 'keyword_model'; alias = detection.keyword.strip()
                break
        # Local multilingual recognition only for pronunciation matching. No
        # background audio or transcript is forwarded to cloud ASR or the Agent.
        if not wake:
            wake_text, alias, fallback_span = pronunciation_check(samples)
            wake = bool(alias and fallback_span)
            if wake:
                method = 'local_pronunciation'
    # Phrase timing is diagnostic only; wake no longer needs a speaker embedding.
    selected = samples
    if wake and times:
        start = max(0, int((times[0] - 0.15) * 16000))
        end = min(len(samples), int((times[-1] + 0.35) * 16000))
        selected = samples[start:end]
    elif wake and fallback_span:
        selected = samples[int(fallback_span[0]*16000):min(len(samples), int(fallback_span[1]*16000))]
    frames = len(selected) // 320
    energy = np.sqrt(np.mean(selected[:frames*320].reshape(-1, 320)**2, axis=1)) if frames else np.array([])
    voiced = float(np.sum(energy > 0.001)) * 0.02 if frames else 0
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
        wav.writeframes((samples * 32767).astype('<i2').tobytes())
    return {'wake': wake, 'processedAudio': base64.b64encode(output.getvalue()).decode(),
            'denoise': 'spectral-soft-mask-v1',
            'wakeMethod': method, 'wakeAlias': alias, 'localWakeText': wake_text[:500],
            'wakeAsrUsed': bool(request.get('detectWake', True) and method != 'keyword_model'),
            'voicedSeconds': voiced, 'seconds': len(selected)/16000,
            'clippedFraction': float(np.mean(np.abs(selected) >= 0.99)),
            'wakeOnly': wake and bool(times) and len(samples)/16000 - times[-1] < 1.5}

print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    try:
        request = json.loads(line)
        result = analyze(request)
        print(json.dumps({'id': request['id'], 'result': result}), flush=True)
    except Exception:
        print(json.dumps({'id': request.get('id') if 'request' in locals() else None, 'error': 'MEDIA_VOICE_LOCAL_FAILED'}), flush=True)
