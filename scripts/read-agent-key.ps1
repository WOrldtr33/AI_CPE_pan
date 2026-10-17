# 仅供 Agent 子进程读取；不要直接在终端运行。
$ErrorActionPreference = 'Stop'
$taskCredentialPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'credentials-agent.json'
$savedCredential = Get-Content -LiteralPath $taskCredentialPath -Raw | ConvertFrom-Json
$secureApiKey = ConvertTo-SecureString $savedCredential.encryptedKey
$plainApiKey = [System.Net.NetworkCredential]::new('', $secureApiKey).Password
if (-not $plainApiKey) { throw 'Empty API Key' }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Write-Output $plainApiKey
