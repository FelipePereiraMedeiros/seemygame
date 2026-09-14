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

#[tauri::command]
pub fn toggle_always_on_top(window: tauri::WebviewWindow) -> Result<bool, String> {
    let current = window.is_always_on_top().map_err(|e| e.to_string())?;
    let new_state = !current;
    window.set_always_on_top(new_state).map_err(|e| e.to_string())?;
    log::info!("[SeeMyGame Desktop] Always-on-top alternado para: {}", new_state);
    Ok(new_state)
}

#[tauri::command]
pub fn is_always_on_top(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_always_on_top().map_err(|e| e.to_string())
}

