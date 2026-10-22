$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') { $env:PSModulePath = "$PSHOME\Modules;$env:ProgramFiles\WindowsPowerShell\Modules" }
$taskRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:T830_BASE_URL) { $env:T830_BASE_URL = 'http://192.168.0.1' }
if (-not $env:T830_USERNAME) { $env:T830_USERNAME = 'admin' }
$providedPassword = $false
$providedDeveloperKey = $false
$previousAuthMode = $env:T830_AUTH_MODE
$agentArguments = @($args | Where-Object { $_ -ne '--developer' })
try {
    if (-not $env:T830_PASSWORD -and -not $env:T830_PASSWORD_HASH) {
        $devicePassword = Read-Host 'T830 管理密码（隐藏输入；直接回车可跳过设备连接）' -AsSecureString
        $env:T830_PASSWORD = [System.Net.NetworkCredential]::new('', $devicePassword).Password
        Remove-Variable devicePassword
        $providedPassword = $true
    }
    if (-not $env:T830_DEVELOPER_KEY -and ($env:T830_PASSWORD -or $env:T830_PASSWORD_HASH -or ($args -contains '--developer'))) {
        $developerKeyInput = Read-Host '第二个密码：设备开发者密钥（隐藏输入；直接回车使用普通 admin 模式）' -AsSecureString
        $env:T830_DEVELOPER_KEY = [System.Net.NetworkCredential]::new('', $developerKeyInput).Password
        Remove-Variable developerKeyInput
        $providedDeveloperKey = $true
    }
    if (($args -contains '--developer') -and -not $env:T830_DEVELOPER_KEY) { throw '指定 --developer 时开发者密钥不能为空。' }
    if ($env:T830_DEVELOPER_KEY) {
        if (-not $env:T830_PASSWORD -and -not $env:T830_PASSWORD_HASH) { throw '开发者模式需要先提供 T830 管理密码。' }
        $env:T830_AUTH_MODE = 'developer'
        Write-Host '已选择 developer 模式：连接设备时将验证两个凭据，通过后登录 superadmin。'
    } else {
        # 显式选择 admin，防止子进程加载 .env 中的开发者密钥后意外提权。
        $env:T830_AUTH_MODE = 'admin'
        Write-Host '已选择普通 admin 模式。'
    }
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $agentNode = $nodeCommand.Source }
    else { $agentNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    if ($args -contains '--web') { & $agentNode (Join-Path $taskRoot 'scripts\media.mjs') --agent }
    else { & $agentNode (Join-Path $taskRoot 'scripts\agent.mjs') @agentArguments }
    $agentExitCode = $LASTEXITCODE
} finally {
    if ($providedPassword) { Remove-Item Env:T830_PASSWORD -ErrorAction SilentlyContinue }
    if ($providedDeveloperKey) { Remove-Item Env:T830_DEVELOPER_KEY -ErrorAction SilentlyContinue }
    $env:T830_AUTH_MODE = $previousAuthMode
}
exit $agentExitCode
