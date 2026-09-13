use windows::Win32::System::Threading::{
    GetCurrentProcess, SetPriorityClass, HIGH_PRIORITY_CLASS,
};

#[tauri::command]
pub fn set_high_priority() -> Result<bool, String> {
    unsafe {
        let handle = GetCurrentProcess();
        match SetPriorityClass(handle, HIGH_PRIORITY_CLASS) {
            Ok(_) => {
                log::info!("[SeeMyGame Desktop] Prioridade de processo elevada para HIGH_PRIORITY_CLASS!");
                Ok(true)
            }
            Err(e) => {
                log::warn!("[SeeMyGame Desktop] Falha ao elevar prioridade: {:?}", e);
                Err(format!("{:?}", e))
            }
        }
    }
}
