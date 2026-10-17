$ErrorActionPreference = 'Stop'
$taskPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'credentials-media.json'
$taskRecord = Get-Content -LiteralPath $taskPath -Raw | ConvertFrom-Json
$taskSecureKey = ConvertTo-SecureString $taskRecord.encryptedKey
$taskPlainKey = [System.Net.NetworkCredential]::new('', $taskSecureKey).Password
if (-not $taskPlainKey) { throw 'Empty media key' }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Write-Output $taskPlainKey
