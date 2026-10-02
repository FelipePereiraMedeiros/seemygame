param([int]$RunnerPid, [int]$IntervalMs = 1000)
$ErrorActionPreference = 'Stop'
if ($RunnerPid -le 0 -or $IntervalMs -lt 500) { throw 'Invalid collector settings' }
Add-Type -Path (Join-Path $PSScriptRoot 'resource-counters.cs')
$gpuInstalled = [SmgResourceCounters]::Initialize()
[Console]::Out.WriteLine((@{ kind = 'ready'; gpuCounterInstalled = $gpuInstalled } | ConvertTo-Json -Compress))
$watch = [Diagnostics.Stopwatch]::StartNew()
$nextSampleMs = $IntervalMs
$runnerStartedAt = (Get-Process -Id $RunnerPid).StartTime
try {
    while ($runnerProcess = Get-Process -Id $RunnerPid -ErrorAction SilentlyContinue) {
        if ($runnerProcess.StartTime -ne $runnerStartedAt) { break }
        $remainingMs = $nextSampleMs - $watch.ElapsedMilliseconds
        if ($remainingMs -gt 0) { Start-Sleep -Milliseconds ([int]$remainingMs) }
        $sample = [SmgResourceCounters]::Read()
        [Console]::Out.WriteLine(($sample | ConvertTo-Json -Depth 7 -Compress))
        # No bursts after a late interval; collector work is included in collectionMs.
        $nextSampleMs = [Math]::Max($nextSampleMs + $IntervalMs, $watch.ElapsedMilliseconds + 1)
    }
} finally { [SmgResourceCounters]::Dispose() }
