$ErrorActionPreference = 'Stop'
$voiceRoot = Split-Path -Parent $PSScriptRoot
$voicePython = $env:MEDIA_VOICE_PYTHON
if (-not $voicePython) { $voicePython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' }
& $voicePython (Join-Path $PSScriptRoot 'setup-voice.py')
exit $LASTEXITCODE
