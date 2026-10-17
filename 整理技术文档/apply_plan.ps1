param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath('C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src').TrimEnd('\')
$stageRoot = Join-Path $PSScriptRoot 'staged'
$moves = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'moves.json') -Raw -Encoding UTF8 | ConvertFrom-Json
function Resolve-SafeTarget([string]$relative) {
    $resolved = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relative))
    if (-not $resolved.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Path outside src: $resolved" }
    return $resolved
}
# Validate all final absolute paths and collisions before creating directories or moving anything.
$seen = @{}
foreach ($item in $moves) {
    $from = Resolve-SafeTarget $item.from
    $to = Resolve-SafeTarget $item.to
    if (-not (Test-Path -LiteralPath $from)) { throw "Source missing: $from" }
    if (Test-Path -LiteralPath $to) { throw "Destination exists: $to" }
    if ($seen.ContainsKey($to)) { throw "Duplicate destination: $to" }
    $seen[$to] = $true
}
$generated = @(Get-ChildItem -LiteralPath $stageRoot -Recurse -File)
foreach ($file in $generated) {
    $relative = $file.FullName.Substring($stageRoot.Length + 1)
    $to = Resolve-SafeTarget $relative
    if (Test-Path -LiteralPath $to) { throw "Navigation destination exists: $to" }
}
Write-Output "Preflight OK: $($moves.Count) moves, $($generated.Count) navigation files. All targets remain inside src."
if (-not $Apply) { exit 0 }
foreach ($item in $moves) {
    $from = Resolve-SafeTarget $item.from
    $to = Resolve-SafeTarget $item.to
    New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
    Move-Item -LiteralPath $from -Destination $to
}
foreach ($file in $generated) {
    $relative = $file.FullName.Substring($stageRoot.Length + 1)
    $to = Resolve-SafeTarget $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $to
}
& 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' (Join-Path $PSScriptRoot 'verify.py')
if ($LASTEXITCODE -ne 0) { throw 'Post-move verification failed; inspect report before further action.' }
