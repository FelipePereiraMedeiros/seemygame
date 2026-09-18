[CmdletBinding()]
param(
    [string]$Version = '1.28.7',
    [ValidateSet('x86_64', 'x86', 'arm64')]
    [string]$Architecture = 'x86_64',
    [string]$Destination,
    [switch]$SkipHash,
    [switch]$IncludeDevelopment
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex([string]$Path) {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

function Remove-UnusedGStreamerPlugins([string]$Root) {
    # gstpython is not used by SeeMyGame and its optional Python dependency is
    # intentionally not shipped. Leaving the plugin in the search path causes
    # a misleading GStreamer warning during startup on clean machines.
    $pythonPlugin = Join-Path $Root 'lib\gstreamer-1.0\gstpython.dll'
    if (Test-Path -LiteralPath $pythonPlugin) {
        Remove-Item -LiteralPath $pythonPlugin -Force
        Write-Host "Removido plugin opcional não utilizado: $pythonPlugin"
    }
}

if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path (Split-Path -Parent $PSScriptRoot) 'native-media\gstreamer'
}

if ($Version -notmatch '^1\.\d+\.\d+$') {
    throw "Versão GStreamer inválida: $Version"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$destinationPath = [IO.Path]::GetFullPath($Destination)
$developmentPath = Join-Path $repoRoot '.native-media-sdk\gstreamer'
$packageRoot = "https://gstreamer.freedesktop.org/data/pkg/windows/$Version/msvc"
$packageName = "gstreamer-1.0-msvc-$Architecture-$Version.exe"
$installerUrl = "$packageRoot/$packageName"
$downloadDir = Join-Path $env:TEMP "seemygame-gstreamer-$Version-$Architecture"
$installerPath = Join-Path $downloadDir $packageName
$hashPath = "$installerPath.sha256sum"

New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null

if (-not (Test-Path -LiteralPath $installerPath)) {
    Write-Host "Baixando runtime GStreamer $Version ($Architecture)..."
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath
}
if (-not $SkipHash) {
    if (-not (Test-Path -LiteralPath $hashPath)) {
        Invoke-WebRequest -Uri "$installerUrl.sha256sum" -OutFile $hashPath
    }
    $expectedHash = ((Get-Content -LiteralPath $hashPath -Raw) -split '\s+')[0].Trim().ToLowerInvariant()
    $actualHash = Get-Sha256Hex $installerPath
    if ($expectedHash -ne $actualHash) {
        throw "SHA-256 do instalador não confere. Esperado: $expectedHash; obtido: $actualHash"
    }
}

if (-not (Test-Path (Join-Path $destinationPath 'bin\gst-launch-1.0.exe'))) {
    Write-Host "Instalando apenas o runtime em $destinationPath..."
    $arguments = @(
        "/DIR=`"$destinationPath`"",
        '/TYPE=runtime',
        '/CURRENTUSER',
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART'
    )
    $process = Start-Process -FilePath $installerPath -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Instalador GStreamer terminou com código $($process.ExitCode)"
    }
}

if ($IncludeDevelopment -and -not (Test-Path (Join-Path $developmentPath 'include\gstreamer-1.0\gst\gst.h'))) {
    New-Item -ItemType Directory -Force -Path $developmentPath | Out-Null
    Write-Host "Instalando arquivos de desenvolvimento GStreamer em $developmentPath..."
    $developmentArguments = @(
        "/DIR=`"$developmentPath`"",
        '/TYPE=devel',
        '/CURRENTUSER',
        '/VERYSILENT',
        '/SUPPRESSMSGBOXES',
        '/NORESTART'
    )
    $developmentProcess = Start-Process -FilePath $installerPath -ArgumentList $developmentArguments -Wait -PassThru
    if ($developmentProcess.ExitCode -ne 0) {
        throw "Instalador GStreamer devel terminou com código $($developmentProcess.ExitCode)"
    }
}

Remove-UnusedGStreamerPlugins $destinationPath
if ($IncludeDevelopment) {
    Remove-UnusedGStreamerPlugins $developmentPath
}

$launchPath = Join-Path $destinationPath 'bin\gst-launch-1.0.exe'
$inspectPath = Join-Path $destinationPath 'bin\gst-inspect-1.0.exe'
if (-not (Test-Path $launchPath) -or -not (Test-Path $inspectPath)) {
    throw "Instalação incompleta: gst-launch-1.0.exe/gst-inspect-1.0.exe não encontrados em $destinationPath"
}

$manifest = [ordered]@{
    provider = 'gstreamer'
    version = $Version
    architecture = $Architecture
    package = $packageName
    source = $installerUrl
    runtimeRoot = 'native-media/gstreamer'
    requiredElements = @(
        'd3d11screencapturesrc', 'd3d11convert', 'mfh264enc', 'mfh265enc',
        'wasapi2src', 'opusenc', 'webrtcbin'
    )
    preparedAtUtc = [DateTime]::UtcNow.ToString('o')
}
$manifestPath = Join-Path $repoRoot 'native-media\manifest.json'
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Runtime nativo preparado em $destinationPath"
if ($IncludeDevelopment) {
    if (-not (Test-Path (Join-Path $developmentPath 'include\gstreamer-1.0\gst\gst.h'))) {
        throw "SDK de desenvolvimento incompleto: headers GStreamer não encontrados em $developmentPath"
    }
    Write-Host "SDK de desenvolvimento preparado em $developmentPath (ignorado pelo Git)"
}
Write-Host "Próximo passo: .\tools\validate-native-media.ps1 -SmokeTest"
