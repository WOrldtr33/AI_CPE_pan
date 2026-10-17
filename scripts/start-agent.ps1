$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') { $env:PSModulePath = "$PSHOME\Modules;$env:ProgramFiles\WindowsPowerShell\Modules" }
$taskRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:T830_BASE_URL) { $env:T830_BASE_URL = 'http://192.168.0.1' }
if (-not $env:T830_USERNAME) { $env:T830_USERNAME = 'admin' }
$providedPassword = $false
if (-not $env:T830_PASSWORD -and -not $env:T830_PASSWORD_HASH) {
    $devicePassword = Read-Host 'T830 管理密码（隐藏输入；直接回车可跳过设备连接）' -AsSecureString
    $env:T830_PASSWORD = [System.Net.NetworkCredential]::new('', $devicePassword).Password
    Remove-Variable devicePassword
    $providedPassword = $true
}
try {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $agentNode = $nodeCommand.Source }
    else { $agentNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    if ($args -contains '--web') { & $agentNode (Join-Path $taskRoot 'scripts\media.mjs') --agent }
    else { & $agentNode (Join-Path $taskRoot 'scripts\agent.mjs') @args }
    $agentExitCode = $LASTEXITCODE
} finally {
    if ($providedPassword) { Remove-Item Env:T830_PASSWORD -ErrorAction SilentlyContinue }
}
exit $agentExitCode
