$ErrorActionPreference = 'Stop'
$taskPreviousEnvironment = @{}
foreach ($taskName in @('T830_PASSWORD', 'T830_DEVELOPER_KEY', 'T830_AUTH_TRANSPORT')) {
    $taskPreviousEnvironment[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process')
}
try {
    if (-not $env:T830_PASSWORD) {
        $taskPassword = Read-Host '设备管理员密码（隐藏输入）' -AsSecureString
        $env:T830_PASSWORD = [System.Net.NetworkCredential]::new('', $taskPassword).Password
    }
    if (-not $env:T830_DEVELOPER_KEY) {
        $taskDeveloperKey = Read-Host '开发者密钥（隐藏输入，回车使用普通管理员）' -AsSecureString
        $env:T830_DEVELOPER_KEY = [System.Net.NetworkCredential]::new('', $taskDeveloperKey).Password
    }
    if (-not $env:T830_AUTH_TRANSPORT) { $env:T830_AUTH_TRANSPORT = 'ubus' }
    & node (Join-Path $PSScriptRoot 'systematic-live-writes.mjs') --apply @args
    $taskExitCode = $LASTEXITCODE
} finally {
    foreach ($taskName in $taskPreviousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($taskName, $taskPreviousEnvironment[$taskName], 'Process')
    }
    Remove-Variable taskPassword, taskDeveloperKey -ErrorAction SilentlyContinue
}
exit $taskExitCode
