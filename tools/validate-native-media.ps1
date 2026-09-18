[CmdletBinding()]
param(
    [string]$Root,
    [switch]$SmokeTest
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Join-Path (Split-Path -Parent $PSScriptRoot) 'native-media\gstreamer'
}

$rootPath = [IO.Path]::GetFullPath($Root)
$launchPath = Join-Path $rootPath 'bin\gst-launch-1.0.exe'
$inspectPath = Join-Path $rootPath 'bin\gst-inspect-1.0.exe'
if (-not (Test-Path $launchPath) -or -not (Test-Path $inspectPath)) {
    throw "Runtime GStreamer não encontrado em $rootPath. Execute prepare-native-media.ps1."
}

$env:GST_PLUGIN_PATH_1_0 = Join-Path $rootPath 'lib\gstreamer-1.0'
$env:GST_PLUGIN_SYSTEM_PATH_1_0 = $env:GST_PLUGIN_PATH_1_0
$env:PATH = "$(Join-Path $rootPath 'bin');$(Join-Path $rootPath 'lib');$env:PATH"

$requiredElements = @(
    'd3d11screencapturesrc', 'd3d11convert', 'mfh264enc', 'mfh265enc',
    'wasapi2src', 'opusenc', 'webrtcbin'
)
$optionalElements = @('nvd3d11h264enc', 'svtav1enc')
$allElements = $requiredElements + $optionalElements

$results = foreach ($element in $allElements) {
    $ErrorActionPreference = 'Continue'
    & $inspectPath $element *> $null
    $inspectionExitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    [pscustomobject]@{
        element = $element
        required = ($requiredElements -contains $element)
        available = ($inspectionExitCode -eq 0)
    }
}

$missing = @($results | Where-Object { $_.required -and -not $_.available } | ForEach-Object element)
$report = [ordered]@{
    root = $rootPath
    gstLaunch = $launchPath
    gstInspect = $inspectPath
    elements = $results
    smokeTest = $false
    smoke = @{}
}

if ($missing.Count -gt 0) {
    $report | ConvertTo-Json -Depth 6
    throw "Plugins GStreamer ausentes: $($missing -join ', ')"
}

if ($SmokeTest) {
    $report.smokeTest = $true
    $pipelines = [ordered]@{
        h264 = @(
            '-e', 'videotestsrc', 'num-buffers=120', '!',
            'video/x-raw,format=NV12,width=1280,height=720,framerate=60/1', '!',
            'mfh264enc', 'bitrate=8000', 'gop-size=120',
            'low-latency=true', 'rc-mode=cbr', '!', 'h264parse', '!', 'fakesink'
        )
        hevc = @(
            '-e', 'videotestsrc', 'num-buffers=120', '!',
            'video/x-raw,format=NV12,width=1280,height=720,framerate=60/1', '!',
            'mfh265enc', 'bitrate=8000', 'gop-size=120',
            'low-latency=true', 'rc-mode=cbr', '!', 'h265parse', '!', 'fakesink'
        )
    }
    if ($report.elements | Where-Object { $_.element -eq 'nvd3d11h264enc' -and $_.available }) {
        $pipelines['nvenc'] = @(
            '-e', 'videotestsrc', 'num-buffers=60', '!',
            'video/x-raw,format=BGRA,width=1280,height=720,framerate=60/1', '!',
            'd3d11upload', '!', 'd3d11convert', '!',
            'video/x-raw(memory:D3D11Memory),format=NV12', '!',
            'nvd3d11h264enc', 'bitrate=8000', 'gop-size=60', 'rc-mode=cbr',
            'tune=ultra-low-latency', 'zerolatency=true', 'repeat-sequence-header=true', '!',
            'video/x-h264,profile=constrained-baseline', '!',
            'h264parse', '!', 'fakesink'
        )
    }
    foreach ($name in $pipelines.Keys) {
        Write-Host "Smoke test $name..."
        $ErrorActionPreference = 'Continue'
        & $launchPath @($pipelines[$name]) *> $null
        $smokeExitCode = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        $report.smoke[$name] = ($smokeExitCode -eq 0)
        if (-not $report.smoke[$name]) {
            $report | ConvertTo-Json -Depth 6
            throw "Smoke test $name falhou; encoder ou aceleração não está utilizável nesta máquina."
        }
    }
}

$report | ConvertTo-Json -Depth 6
