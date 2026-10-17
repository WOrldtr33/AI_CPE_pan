$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath('C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src').TrimEnd('\')
$plan = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'linkfix_plan.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($change in $plan.changes) {
    $target = [IO.Path]::GetFullPath((Join-Path $sourceRoot $change.relative))
    if(-not $target.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {throw 'Target outside src'}
    if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower() -ne $change.before_sha256) {throw "File changed since inspection: $target"}
}
foreach($relative in $plan.outputs) {
    $target = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relative))
    if(-not $target.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {throw 'Target outside src'}
    $source = Join-Path (Join-Path $PSScriptRoot 'linkfix') $relative
    if(-not (Test-Path -LiteralPath $source -PathType Leaf)) {throw "Missing staged file: $source"}
}
foreach($relative in $plan.outputs) {
    $target = Join-Path $sourceRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path (Join-Path $PSScriptRoot 'linkfix') $relative) -Destination $target -Force
}
Write-Output "Updated $($plan.changes.Count) navigation files; total written $($plan.outputs.Count). Original SDKs and documents unchanged."
