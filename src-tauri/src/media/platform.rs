//! platform; internal to the native media subsystem.
use super::*;

pub(crate) fn process_loopback_supported() -> bool {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct OsVersionInfo {
            size: u32,
            major: u32,
            minor: u32,
            build: u32,
            platform: u32,
            service_pack: [u16; 128],
        }

        unsafe extern "system" {
            fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
        }

        let mut info = OsVersionInfo {
            size: std::mem::size_of::<OsVersionInfo>() as u32,
            major: 0,
            minor: 0,
            build: 0,
            platform: 0,
            service_pack: [0; 128],
        };
        unsafe { RtlGetVersion(&mut info) == 0 && info.build >= 20_348 }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
pub(crate) fn assign_child_to_job_object(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    static JOB_OBJECT: OnceLock<Option<isize>> = OnceLock::new();
    let job_opt = JOB_OBJECT.get_or_init(|| unsafe {
        let handle = match CreateJobObjectW(None, None) {
            Ok(h) => h,
            Err(e) => {
                log::warn!("[JobObject] Falha ao criar Job Object: {e:?}");
                return None;
            }
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let res = SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if let Err(e) = res {
            log::warn!("[JobObject] Falha ao configurar SetInformationJobObject: {e:?}");
        }
        Some(handle.0 as isize)
    });

    if let Some(stored) = *job_opt {
        unsafe {
            let job_handle = HANDLE(stored as *mut std::ffi::c_void);
            let proc_handle = HANDLE(child.as_raw_handle());
            let _ = windows::Win32::System::Threading::SetPriorityClass(
                proc_handle,
                windows::Win32::System::Threading::HIGH_PRIORITY_CLASS,
            );
            if let Err(e) = AssignProcessToJobObject(job_handle, proc_handle) {
                log::warn!("[JobObject] Falha ao associar processo ao Job Object: {e:?}");
            } else {
                log::info!("[JobObject] Processo worker GStreamer associado ao Job Object com HIGH_PRIORITY_CLASS");
            }
        }
    }
}
