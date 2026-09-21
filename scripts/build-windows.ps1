param([string]$NodePath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $NodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath)) {
    throw 'Pass the path to a Windows Node.js executable with -NodePath.'
}
$architecture = & $NodePath -p 'process.arch'
if ($LASTEXITCODE -ne 0 -or $architecture -ne 'x64') { throw 'This package requires Windows x64 Node.js.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler was not found.' }
$runtimeDir = Join-Path $projectRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$runtimeCopy = Join-Path $runtimeDir 'node.exe'
if ([IO.Path]::GetFullPath($NodePath) -ne $runtimeCopy) { Copy-Item -LiteralPath $NodePath -Destination $runtimeCopy -Force }
if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir 'LICENSE'))) { throw 'The Node.js distribution LICENSE must be present in runtime/LICENSE.' }
$executable = Join-Path $projectRoot 'AquaLevelLab.exe'
$source = Join-Path $projectRoot 'desktop\Launcher.cs'
& $compiler /nologo /target:winexe /platform:anycpu /codepage:65001 "/out:$executable" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $source
if ($LASTEXITCODE -ne 0) { throw 'Windows launcher compilation failed.' }
& $NodePath (Join-Path $PSScriptRoot 'build-standalone.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Standalone HTML build failed.' }
$archive = Join-Path $projectRoot 'Aqua-Level-Lab-Windows-x64.zip'
$packageFiles = @('AquaLevelLab.exe', 'Aqua-Level-Lab-Demo.html', 'server.js', 'package.json', 'public', 'runtime', 'START-HERE.txt') |
    ForEach-Object { Join-Path $projectRoot $_ }
Compress-Archive -LiteralPath $packageFiles -DestinationPath $archive -CompressionLevel Optimal -Force
Get-Item -LiteralPath $executable, $archive | Select-Object Name, Length
