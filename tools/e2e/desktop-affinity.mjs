import { spawnSync } from 'node:child_process';

/**
 * Ensures the Node process and all its children (seemygame.exe, Playwright, GStreamer)
 * run on the interactive DWM-composited desktop (WinSta0\Default).
 * In background runner environments (such as CI or virtual sandboxes), processes default
 * to an isolated desktop where DWM is inactive, causing Windows Graphics Capture (WGC)
 * CreateForWindow to fail with 0x80070057 (E_INVALIDARG).
 */
export function ensureDefaultDesktop() {
  if (process.platform !== 'win32') return;
  if (process.env.SMG_ON_DEFAULT_DESKTOP === '1') return;

  const checkScript = `
    Add-Type @'
    using System; using System.Text; using System.Runtime.InteropServices;
    public class DCheck {
        [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(int dwThreadId);
        [DllImport("kernel32.dll")] public static extern int GetCurrentThreadId();
        [DllImport("user32.dll", SetLastError = true)] public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, StringBuilder pvInfo, int nLength, out int lpnLengthNeeded);
        public static string GetName() {
            IntPtr h = GetThreadDesktop(GetCurrentThreadId());
            StringBuilder sb = new StringBuilder(256); int needed;
            if (GetUserObjectInformation(h, 2, sb, 256, out needed)) return sb.ToString();
            return "";
        }
    }
'@
    [DCheck]::GetName()
  `;

  const check = spawnSync('powershell', ['-NoProfile', '-Command', checkScript], { encoding: 'utf8' });
  const currentDesk = check.stdout ? check.stdout.trim() : '';

  if (currentDesk && currentDesk.toLowerCase() !== 'default') {
    console.log(`[Desktop Affinity] Detected desktop "${currentDesk}". Relaunching on WinSta0\\Default for DWM WGC window capture...`);

    const fullCmd = [
      `"${process.execPath}"`,
      `"${process.argv[1]}"`,
      ...process.argv.slice(2).map(a => `"${a}"`)
    ].join(' ');

    const relaunchScript = `
      Add-Type @'
      using System; using System.Runtime.InteropServices;
      public class DRelaunch {
          [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
          public struct STARTUPINFO {
              public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
              public int dwX; public int dwY; public int dwXSize; public int dwYSize;
              public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
              public int dwFlags; public short wShowWindow; public short cbReserved2;
              public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
          }
          [StructLayout(LayoutKind.Sequential)]
          public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
          [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
          public static extern bool CreateProcess(string app, string cmd, IntPtr pa, IntPtr ta, bool ih, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
          [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
          [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
          [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr h, out uint code);
          [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

          public static int Launch(string cmd, string cwd) {
              STARTUPINFO si = new STARTUPINFO();
              si.cb = Marshal.SizeOf(si);
              si.lpDesktop = "WinSta0\\\\Default";
              si.dwFlags = 0x100;
              si.hStdInput = GetStdHandle(-10);
              si.hStdOutput = GetStdHandle(-11);
              si.hStdError = GetStdHandle(-12);
              PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
              bool ok = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, cwd, ref si, out pi);
              if (!ok) {
                  Console.WriteLine("CreateProcess failed: " + Marshal.GetLastWin32Error());
                  return -1;
              }
              WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
              uint code; GetExitCodeProcess(pi.hProcess, out code);
              CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
              return (int)code;
          }
      }
'@
      $env:SMG_ON_DEFAULT_DESKTOP = '1'
      $cmd = @'
${fullCmd}
'@
      $code = [DRelaunch]::Launch($cmd, "$pwd")
      exit $code
    `;

    const relaunch = spawnSync('powershell', ['-NoProfile', '-Command', relaunchScript], { stdio: 'inherit' });
    process.exit(relaunch.status != null ? relaunch.status : 0);
  }
}
