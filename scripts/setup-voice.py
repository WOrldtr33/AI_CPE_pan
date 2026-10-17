"""Install local voice models into the workspace, without changing global Python."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import urllib.request

root = Path(__file__).resolve().parents[1] / '.tools' / 'voice'
root.mkdir(parents=True, exist_ok=True)
(root / 'tmp').mkdir(exist_ok=True)
environment = dict(os.environ, TEMP=str(root / 'tmp'), TMP=str(root / 'tmp'))
subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-cache-dir',
                '--no-deps', '--upgrade', '--target', str(root / 'packages'),
                'sherpa-onnx==1.13.8', 'sherpa-onnx-core==1.13.8'], env=environment, check=True)
assets = [
 ('kws-en.tar.bz2', 'kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
  'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a'),
 ('wake-asr/model.int8.onnx', 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
  'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51'),
 ('wake-asr/tokens.txt', 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
  'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc')]
manifest = []
for name, relative, expected in assets:
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    url = relative if relative.startswith('https://') else 'https://github.com/k2-fsa/sherpa-onnx/releases/download/' + relative
    if not target.exists():
        staging = target.with_suffix('.download')
        urllib.request.urlretrieve(url, staging)
        if hashlib.sha256(staging.read_bytes()).hexdigest() != expected:
            raise RuntimeError('Model checksum mismatch: ' + name)
        staging.replace(target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise RuntimeError('Model checksum mismatch: ' + name)
    if name.endswith('bz2'):
        with tarfile.open(target) as archive:
            archive.extractall(root, filter='data')
    manifest.append({'name': name, 'url': url, 'sha256': expected})
(root / 'installation.json').write_text(json.dumps({'runtime': 'sherpa-onnx 1.13.8', 'assets': manifest}, indent=2), encoding='utf-8')
print('Local voice models ready. No cloud credentials required.')
