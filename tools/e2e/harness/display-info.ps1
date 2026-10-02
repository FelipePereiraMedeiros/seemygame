$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class SmgDisplayMode {
    [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode, Size=220)]
    public struct Mode {
        [FieldOffset(68)] public ushort size;
        [FieldOffset(172)] public uint width;
        [FieldOffset(176)] public uint height;
        [FieldOffset(184)] public uint frequency;
    }
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool EnumDisplaySettingsW(string device,int mode,ref Mode data);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    public static Mode Current(string device) {
        var mode=new Mode {size=220};
        if (!EnumDisplaySettingsW(device,-1,ref mode)) return new Mode();
        return mode;
    }
}
'@
$dpiAware = [SmgDisplayMode]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
$rows = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
    $mode = [SmgDisplayMode]::Current($_.DeviceName)
    @{ device=$_.DeviceName; primary=$_.Primary; x=$_.Bounds.X; y=$_.Bounds.Y; width=$_.Bounds.Width; height=$_.Bounds.Height; modeWidth=$mode.width; modeHeight=$mode.height; reportedRefreshHz=$(if ($mode.frequency -gt 1) { $mode.frequency } else { $null }) }
})
@{displays=$rows; dpiAwarenessSet=$dpiAware; note='Windows reported display mode; not a measurement of physical presentation rate or exact fractional refresh'} | ConvertTo-Json -Depth 5 -Compress
