$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -eq 'Desktop') { $env:PSModulePath = "$PSHOME\Modules;$env:ProgramFiles\WindowsPowerShell\Modules" }
$taskRoot = Split-Path -Parent $PSScriptRoot
$secureApiKey = Read-Host 'DeepSeek API Key（隐藏输入）' -AsSecureString
$encryptedApiKey = ConvertFrom-SecureString $secureApiKey
@{ format = 'windows-dpapi-v1'; encryptedKey = $encryptedApiKey } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'credentials-agent.json') -Encoding utf8
Remove-Variable secureApiKey, encryptedApiKey
Write-Host 'Key 已使用当前 Windows 用户的 DPAPI 加密保存。'
