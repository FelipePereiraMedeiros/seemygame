// Windows PDH + Toolhelp. No drivers, hooks, process injection or command-line collection.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public sealed class SmgCounter { public string instance; public double value; }
public sealed class SmgProcess {
    public int pid; public int parentPid; public string name;
    public double? cpuTimeMs; public double? cpuSampleMonotonicMs;
    public long? startedAt; public long? workingSetBytes;
}
public sealed class SmgResourceSnapshot {
    public string kind = "sample";
    public long timestamp;
    public int collectorPid;
    public bool gpuAvailable;
    public string gpuStatus;
    public List<SmgCounter> gpuEngines;
    public List<SmgCounter> gpuDedicatedMemory;
    public List<SmgProcess> processes;
    public double collectionMs;
}
public static class SmgResourceCounters {
    [StructLayout(LayoutKind.Explicit, Size=16)] struct Value {
        [FieldOffset(0)] public uint status;
        [FieldOffset(8)] public double number;
    }
    [StructLayout(LayoutKind.Sequential)] struct Item { public IntPtr name; public Value value; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct ProcessEntry {
        public uint size, usage, pid; public UIntPtr heap;
        public uint module, threads, parentPid; public int priority; public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string file;
    }
    [DllImport("pdh.dll", CharSet=CharSet.Unicode)] static extern uint PdhOpenQueryW(string source, UIntPtr user, out IntPtr query);
    [DllImport("pdh.dll", CharSet=CharSet.Unicode)] static extern uint PdhAddEnglishCounterW(IntPtr query, string path, UIntPtr user, out IntPtr counter);
    [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", CharSet=CharSet.Unicode)] static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint format, ref uint size, out uint count, IntPtr buffer);
    [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [StructLayout(LayoutKind.Sequential)] struct MemoryCounters {
        public uint size, pageFaults;
        public UIntPtr peakWorkingSet, workingSet, peakPagedPool, pagedPool, peakNonPagedPool, nonPagedPool, pagefile, peakPagefile, privateUsage;
    }
    [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr process, ref MemoryCounters counters, uint size);
    static IntPtr query, engines, memory;
    public static bool Initialize() {
        if (PdhOpenQueryW(null, UIntPtr.Zero, out query) != 0) return false;
        if (PdhAddEnglishCounterW(query, @"\GPU Engine(*)\Utilization Percentage", UIntPtr.Zero, out engines) != 0) engines = IntPtr.Zero;
        if (PdhAddEnglishCounterW(query, @"\GPU Adapter Memory(*)\Dedicated Usage", UIntPtr.Zero, out memory) != 0) memory = IntPtr.Zero;
        PdhCollectQueryData(query); // Prime rate counters. The first valid interval follows this call.
        return engines != IntPtr.Zero;
    }
    static List<SmgCounter> ReadArray(IntPtr counter) {
        if (counter == IntPtr.Zero) return null;
        uint size=0, count=0;
        uint status=PdhGetFormattedCounterArrayW(counter, 0x8200, ref size, out count, IntPtr.Zero);
        if (status != 0x800007D2 || size == 0 || size > 16*1024*1024) return null;
        IntPtr buffer=Marshal.AllocHGlobal((int)size);
        try {
            status=PdhGetFormattedCounterArrayW(counter, 0x8200, ref size, out count, buffer);
            if (status != 0) return null;
            var result=new List<SmgCounter>();
            int stride=Marshal.SizeOf(typeof(Item));
            for (int i=0;i<count;i++) {
                var item=(Item)Marshal.PtrToStructure(IntPtr.Add(buffer,i*stride),typeof(Item));
                if (item.value.status > 1 || Double.IsNaN(item.value.number) || Double.IsInfinity(item.value.number)) continue;
                result.Add(new SmgCounter { instance=Marshal.PtrToStringUni(item.name), value=item.value.number });
            }
            return result.Count == 0 ? null : result;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static List<SmgProcess> ReadProcesses() {
        var result=new List<SmgProcess>();
        IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
        if (snapshot == new IntPtr(-1)) return result;
        try {
            var entry=new ProcessEntry { size=(uint)Marshal.SizeOf(typeof(ProcessEntry)) };
            if (!Process32FirstW(snapshot,ref entry)) return result;
            do {
                var row=new SmgProcess { pid=(int)entry.pid, parentPid=(int)entry.parentPid, name=entry.file };
                IntPtr process=OpenProcess(0x1000,false,entry.pid); // QUERY_LIMITED_INFORMATION, read-only.
                if (process != IntPtr.Zero) {
                    try {
                        long created,exited,kernel,user;
                        if(GetProcessTimes(process,out created,out exited,out kernel,out user)) {
                            // PDH/collection may stall under load. Time each process counter read,
                            // not the start of the entire snapshot, using a non-adjustable clock.
                            row.cpuSampleMonotonicMs=Stopwatch.GetTimestamp()*1000.0/Stopwatch.Frequency;
                            row.startedAt=created/10000-11644473600000;
                            row.cpuTimeMs=(kernel+user)/10000.0;
                        }
                        var counters=new MemoryCounters { size=(uint)Marshal.SizeOf(typeof(MemoryCounters)) };
                        if(GetProcessMemoryInfo(process,ref counters,counters.size))row.workingSetBytes=(long)counters.workingSet.ToUInt64();
                    } finally { CloseHandle(process); }
                } // Protected/exited processes stay unavailable, never fake zero CPU.
                result.Add(row);
            } while (Process32NextW(snapshot,ref entry));
        } finally { CloseHandle(snapshot); }
        return result;
    }
    public static SmgResourceSnapshot Read() {
        var watch=Stopwatch.StartNew();
        var result=new SmgResourceSnapshot { timestamp=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), collectorPid=Process.GetCurrentProcess().Id };
        uint status=query == IntPtr.Zero ? 1u : PdhCollectQueryData(query);
        result.gpuEngines=status == 0 ? ReadArray(engines) : null;
        result.gpuDedicatedMemory=status == 0 ? ReadArray(memory) : null;
        result.gpuAvailable=result.gpuEngines != null;
        result.gpuStatus=result.gpuAvailable ? "available" : "counter-unavailable-or-unprimed";
        result.processes=ReadProcesses();
        result.collectionMs=watch.Elapsed.TotalMilliseconds;
        return result;
    }
    public static void Dispose() { if(query != IntPtr.Zero) { PdhCloseQuery(query); query=IntPtr.Zero; } }
}
