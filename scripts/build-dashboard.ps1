$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $buildNode = $nodeCommand.Source }
else { $buildNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $buildNode)) { throw '未找到 Node.js，请先安装 Node.js 或配置运行时路径。' }
$frontendPath = Join-Path $taskRoot 'frontend'
if (-not (Test-Path -LiteralPath (Join-Path $frontendPath 'node_modules\vite\bin\vite.js'))) { throw '缺少前端依赖，请先在 frontend 内执行 npm ci。' }
Push-Location $frontendPath
try {
    & $buildNode 'node_modules/typescript/bin/tsc' --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript 检查未通过。' }
    & $buildNode 'node_modules/vite/bin/vite.js' build
    if ($LASTEXITCODE -ne 0) { throw '前端构建未通过。' }
} finally { Pop-Location }
