# Read-only DXGI output timing, in the same interactive session as the receiver.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if((Get-Process -Id $PID).SessionId -eq 0){throw 'DXGI probe requires an interactive session'}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class SmgDxgiProbe {
 [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid iid,out IntPtr factory);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Enumerate(IntPtr self,uint index,out IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Description(IntPtr self,IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Wait(IntPtr self);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct OutputInfo {
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string deviceName;
  public Rect coordinates;public int attached;public int rotation;public IntPtr monitor;
 }
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int OutputDescription(IntPtr self,out OutputInfo value);
 public class Sample {public int hresult;public double elapsedMs;}
 public class Output {public string adapter,device;public int adapterIndex,outputIndex,descriptionHresult;public bool attached;public Rect coordinates;public string monitor;public List<Sample> samples=new List<Sample>();}
 static T Slot<T>(IntPtr instance,int index){IntPtr table=Marshal.ReadIntPtr(instance);return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,index*IntPtr.Size),typeof(T));}
 public static List<Output> Run(){
  if(IntPtr.Size!=8)throw new Exception("Use 64-bit reader");
  IntPtr factory;Guid iid=new Guid("770aae78-f26f-4dba-a829-253c83d1b387");int hr=CreateDXGIFactory1(ref iid,out factory);Marshal.ThrowExceptionForHR(hr);
  var rows=new List<Output>();
  try{
   for(uint adapterIndex=0;adapterIndex<16;adapterIndex++){
    IntPtr adapter;hr=Slot<Enumerate>(factory,12)(factory,adapterIndex,out adapter);if((uint)hr==0x887a0002)break;Marshal.ThrowExceptionForHR(hr);
    try{
     string name="unavailable";IntPtr description=Marshal.AllocHGlobal(1024);
     try{for(int i=0;i<1024;i++)Marshal.WriteByte(description,i,0);int descHr=Slot<Description>(adapter,10)(adapter,description);if(descHr==0)name=Marshal.PtrToStringUni(description,128).TrimEnd('\0');}finally{Marshal.FreeHGlobal(description);}
     for(uint outputIndex=0;outputIndex<16;outputIndex++){
      IntPtr output;hr=Slot<Enumerate>(adapter,7)(adapter,outputIndex,out output);if((uint)hr==0x887a0002)break;Marshal.ThrowExceptionForHR(hr);
      try{
       OutputInfo info;int descHr=Slot<OutputDescription>(output,7)(output,out info);Marshal.ThrowExceptionForHR(descHr);
       var row=new Output {adapter=name,adapterIndex=(int)adapterIndex,outputIndex=(int)outputIndex,device=info.deviceName,descriptionHresult=descHr,attached=info.attached!=0,coordinates=info.coordinates,monitor=info.monitor.ToInt64().ToString("X")};
       if(row.attached){var wait=Slot<Wait>(output,10);for(int i=0;i<30;i++){long start=Stopwatch.GetTimestamp();int waitHr=wait(output);double elapsed=1000.0*(Stopwatch.GetTimestamp()-start)/Stopwatch.Frequency;row.samples.Add(new Sample {hresult=waitHr,elapsedMs=elapsed});}}
       rows.Add(row);
      }finally{Marshal.Release(output);}
     }
    }finally{Marshal.Release(adapter);}
   }
  }finally{Marshal.Release(factory);}
  return rows;
 }
}
'@
$result=[SmgDxgiProbe]::Run()
[pscustomobject]@{status='available';sessionId=(Get-Process -Id $PID).SessionId;outputs=@($result);scope='DXGI WaitForVBlank call duration and HRESULT; no monitor settings changes; not physical scanout certification'} | ConvertTo-Json -Depth 8 -Compress
