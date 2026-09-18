use windows::Win32::System::Threading::{GetCurrentProcess, SetPriorityClass, HIGH_PRIORITY_CLASS};

#[tauri::command]
pub fn set_high_priority() -> Result<bool, String> {
    unsafe {
        let handle = GetCurrentProcess();
        match SetPriorityClass(handle, HIGH_PRIORITY_CLASS) {
            Ok(_) => {
                log::info!(
                    "[SeeMyGame Desktop] Prioridade de processo elevada para HIGH_PRIORITY_CLASS!"
                );
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
    window
        .set_always_on_top(new_state)
        .map_err(|e| e.to_string())?;
    log::info!(
        "[SeeMyGame Desktop] Always-on-top alternado para: {}",
        new_state
    );
    Ok(new_state)
}

#[tauri::command]
pub fn is_always_on_top(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_always_on_top().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn log_diagnostic(message: String) -> Result<(), String> {
    write_debug_log(&message);
    Ok(())
}

pub fn write_debug_log(message: &str) {
    use std::io::Write;
    log::info!("{message}");
    let path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("native_debug.log")))
        .unwrap_or_else(|| std::path::PathBuf::from("native_debug.log"));
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(file, "[{time}] {message}");
    }
}
