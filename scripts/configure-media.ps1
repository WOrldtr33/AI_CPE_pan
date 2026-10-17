param(
  [string]$BaseUrl = 'https://maas.qianwenaiapi.com/compatible-mode/v1',
  [string]$Model = 'qwen3-omni-flash'
)
$ErrorActionPreference = 'Stop'
$taskUrl = [Uri]$BaseUrl
if ($taskUrl.Scheme -ne 'https' -or $taskUrl.UserInfo -or $taskUrl.Query -or $taskUrl.Fragment) { throw 'HTTPS Base URL required' }
$taskKey = Read-Host 'Qwen API Key' -AsSecureString
$taskRecord = @{ format = 'windows-dpapi-v1'; encryptedKey = (ConvertFrom-SecureString $taskKey); baseUrl = $BaseUrl; model = $Model }
$taskRecord | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'credentials-media.json') -Encoding UTF8
Write-Host 'Saved encrypted media credentials.'
