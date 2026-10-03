# Read-only timing observation. Must run in the same interactive Windows session as the receiver.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SmgDwmTiming {
 [StructLayout(LayoutKind.Sequential, Pack=1)] public struct Ratio { public uint numerator, denominator; }
 // dwmapi.h uses packed structures; field order/types follow DWM_TIMING_INFO.
 [StructLayout(LayoutKind.Sequential, Pack=1)] public struct Info {
  public uint cbSize; public Ratio rateRefresh; public ulong qpcRefreshPeriod;
  public Ratio rateCompose; public ulong qpcVBlank,cRefresh; public uint cDXRefresh;
  public ulong qpcCompose,cFrame; public uint cDXPresent;
  public ulong cRefreshFrame,cFrameSubmitted; public uint cDXPresentSubmitted;
  public ulong cFrameConfirmed; public uint cDXPresentConfirmed;
  public ulong cRefreshConfirmed; public uint cDXRefreshConfirmed;
  public ulong cFramesLate; public uint cFramesOutstanding;
  public ulong cFrameDisplayed,qpcFrameDisplayed,cRefreshFrameDisplayed;
  public ulong cFrameComplete,qpcFrameComplete,cFramePending,qpcFramePending;
  public ulong cFramesDisplayed,cFramesComplete,cFramesPending,cFramesAvailable;
  public ulong cFramesDropped,cFramesMissed,cRefreshNextDisplayed,cRefreshNextPresented;
  public ulong cRefreshesDisplayed,cRefreshesPresented,cRefreshStarted;
  public ulong cPixelsReceived,cPixelsDrawn,cBuffersEmpty;
 }
 [DllImport("dwmapi.dll")] public static extern int DwmGetCompositionTimingInfo(IntPtr hwnd,ref Info info);
 [DllImport("wtsapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool WTSQuerySessionInformation(IntPtr server,uint session,int type,out IntPtr buffer,out uint length);
 [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr buffer);
 public static int ReadSessionValue(uint session,int type){IntPtr buffer;uint length;if(!WTSQuerySessionInformation(IntPtr.Zero,session,type,out buffer,out length))return -1;try{return type==16&&length>=2?Marshal.ReadInt16(buffer):length>=4?Marshal.ReadInt32(buffer):-1;}finally{WTSFreeMemory(buffer);}}
 public static int ReadLockFlag(uint session){IntPtr buffer;uint length;if(!WTSQuerySessionInformation(IntPtr.Zero,session,25,out buffer,out length))return -1;try{if(IntPtr.Size!=8||length<20||Marshal.ReadInt32(buffer)!=1||Marshal.ReadInt32(buffer,8)!=(int)session)return -1;return Marshal.ReadInt32(buffer,16);}finally{WTSFreeMemory(buffer);}}
 [StructLayout(LayoutKind.Sequential)] public struct Power {public byte acLineStatus,batteryFlag,batteryLifePercent,systemStatus;public uint batteryLifeTime,batteryFullLifeTime;}
 [DllImport("kernel32.dll")] public static extern bool GetSystemPowerStatus(out Power status);
 public static Info Create(){ var value=new Info(); value.cbSize=(uint)Marshal.SizeOf(typeof(Info));return value; }
}
'@
$session=(Get-Process -Id $PID).SessionId
if($session -eq 0){throw 'Presentation environment requires an interactive Windows session'}
$power=New-Object SmgDwmTiming+Power
$powerAvailable=[SmgDwmTiming]::GetSystemPowerStatus([ref]$power)
$sessionObservation=[pscustomobject]@{protocolType=[SmgDwmTiming]::ReadSessionValue($session,16);connectionState=[SmgDwmTiming]::ReadSessionValue($session,8);lockFlag=[SmgDwmTiming]::ReadLockFlag($session);lockInterpretation='Windows 10/11: 0 locked, 1 unlocked, -1 unavailable; not physical monitor power'}
$display=& (Join-Path $PSScriptRoot 'display-info.ps1') | ConvertFrom-Json
$frequency=[Diagnostics.Stopwatch]::Frequency
$rows=@(for($i=0;$i -lt 30;$i++){
 $info=[SmgDwmTiming]::Create()
 $hr=[SmgDwmTiming]::DwmGetCompositionTimingInfo([IntPtr]::Zero,[ref]$info)
 [pscustomobject]@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();qpc=[Diagnostics.Stopwatch]::GetTimestamp();hresult=$hr;size=$info.cbSize;refreshNumerator=$info.rateRefresh.numerator;refreshDenominator=$info.rateRefresh.denominator;composeNumerator=$info.rateCompose.numerator;composeDenominator=$info.rateCompose.denominator;qpcRefreshPeriod=$info.qpcRefreshPeriod;qpcRefreshPeriodMs=if($hr -eq 0){1000.0*$info.qpcRefreshPeriod/$frequency}else{$null};cRefresh=$info.cRefresh;cFramesDropped=$info.cFramesDropped;cFramesMissed=$info.cFramesMissed}
 Start-Sleep -Milliseconds 100
})
$valid=@($rows | Where-Object {$_.hresult -eq 0})
$refreshRate=$null
if($valid.Count -ge 2){$first=$valid[0];$last=$valid[-1];$duration=($last.qpc-$first.qpc)/$frequency;if($duration -gt 0 -and $last.cRefresh -ge $first.cRefresh){$refreshRate=($last.cRefresh-$first.cRefresh)/$duration}}
[pscustomobject]@{status=if($valid.Count -eq 30){'available'}else{'unavailable'};sessionId=$session;sessionObservation=$sessionObservation;powerStatusAvailable=$powerAvailable;powerStatus=$power;display=$display;qpcFrequency=$frequency;observedDwmRefreshCounterHz=$refreshRate;powerScheme=(powercfg /getactivescheme);battery=@(Get-CimInstance Win32_Battery | Select-Object BatteryStatus,EstimatedChargeRemaining);samples=$rows;scope='DWM reported monitor timing and counter increments; not physical panel scanout certification'} | ConvertTo-Json -Depth 8 -Compress
