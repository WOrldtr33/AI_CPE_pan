$ErrorActionPreference = 'Stop'
$targetRoot = [IO.Path]::GetFullPath('C:\Users\admin\Documents\我在金英托联\项目\AI CPE\src')
$navRoot = Join-Path $targetRoot '00_系统总览与阅读导航'
$catalogRoot = Join-Path $PSScriptRoot 'resource_catalog'
$files = @(Get-ChildItem -LiteralPath $catalogRoot -File)
foreach($file in $files) {
    $target = [IO.Path]::GetFullPath((Join-Path $navRoot $file.Name))
    if(-not $target.StartsWith($navRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {throw 'Unsafe destination'}
    if(Test-Path -LiteralPath $target) {throw "Destination already exists: $target"}
}
$rootReadme = Join-Path $targetRoot 'README.md'
$oldHash = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'catalog_readme_before.sha256') -Raw
if((Get-FileHash -LiteralPath $rootReadme -Algorithm SHA256).Hash.ToLower() -ne $oldHash.Trim()) {throw 'README changed since inspection'}
foreach($file in $files) {Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $navRoot $file.Name)}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'catalog_root_README.md') -Destination $rootReadme -Force
Write-Output "Installed $($files.Count) catalog files and updated root navigation."
